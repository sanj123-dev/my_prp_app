import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  KeyboardAvoidingView,
  PermissionsAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { formatINR } from '../../lib/currency';
import {
  clearSmsAuthTrigger,
  getSmsAuthTrigger,
  startRealtimeSmsSync,
  syncSmsTransactions,
} from '../../lib/smsSync';
import AnalyticsPanel from './AnalyticsPanel';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const LIVE_SMS_SYNC_INTERVAL_MS = 45000;
const TRANSACTION_HISTORY_LIMIT = 1000;
const CATEGORIES = [
  'Food',
  'Groceries',
  'Transport',
  'Shopping',
  'Bills',
  'Entertainment',
  'Health',
  'Medical',
  'Education',
  'Travel',
  'Transfer',
  'Other',
];

interface Transaction {
  id: string;
  amount: number;
  category: string;
  description: string;
  merchant_name?: string;
  bank_name?: string;
  account_mask?: string;
  date: string;
  source: string;
  transaction_type?: 'credit' | 'debit' | 'self_transfer';
  sentiment?: string;
}

type SimilarPreview = {
  match_count: number;
  merchant_key?: string | null;
  upi_id?: string | null;
  sample_descriptions?: string[];
};

type MonthOption = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

export default function Transactions() {
  const [userId, setUserId] = useState<string>('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoImporting, setAutoImporting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(
    null
  );
  const [updatingCategory, setUpdatingCategory] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [processing, setProcessing] = useState(false);
  const [smsText, setSmsText] = useState('');
  const [smsProcessing, setSmsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'transactions' | 'analytics'>(
    'transactions'
  );
  const [selectedMonthKey, setSelectedMonthKey] = useState(
    format(new Date(), 'yyyy-MM')
  );
  const liveSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadTransactionsRef = useRef<() => Promise<void>>(async () => {});
  const realtimeCleanupRef = useRef<(() => void) | null>(null);
  const realtimeStartedForRef = useRef('');

  const monthOptions = useMemo<MonthOption[]>(() => {
    return Array.from({ length: 6 }).map((_, index) => {
      const date = subMonths(new Date(), index);
      return {
        key: format(date, 'yyyy-MM'),
        label: index === 0 ? format(date, 'MMM yyyy') : format(date, 'MMM'),
        start: startOfMonth(date),
        end: endOfMonth(date),
      };
    });
  }, []);

  const dateFilteredTransactions = useMemo(() => {
    const selectedMonth = monthOptions.find((item) => item.key === selectedMonthKey);
    const inRange = (dateRaw: string) => {
      const date = new Date(dateRaw);
      if (selectedMonth) {
        return isWithinInterval(date, {
          start: selectedMonth.start,
          end: selectedMonth.end,
        });
      }
      return true;
    };

    return transactions
      .filter((t) => inRange(t.date))
      .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }, [transactions, monthOptions, selectedMonthKey]);

  const categorySummary = useMemo(() => {
    const bucket = new Map<string, { amount: number; count: number }>();
    for (const t of dateFilteredTransactions) {
      if (t.transaction_type === 'credit') continue;
      const current = bucket.get(t.category) || { amount: 0, count: 0 };
      current.amount += Number(t.amount || 0);
      current.count += 1;
      bucket.set(t.category, current);
    }
    return Array.from(bucket.entries())
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.amount - a.amount);
  }, [dateFilteredTransactions]);

  const weeklyReflection = useMemo(() => {
    const now = new Date();
    const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 });
    const thisWeekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const lastWeekStart = subWeeks(thisWeekStart, 1);
    const lastWeekEnd = addDays(thisWeekStart, -1);

    const thisWeekTotal = transactions
      .filter((t) =>
        isWithinInterval(new Date(t.date), { start: thisWeekStart, end: thisWeekEnd }) &&
        t.transaction_type !== 'credit'
      )
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const lastWeekTotal = transactions
      .filter((t) =>
        isWithinInterval(new Date(t.date), { start: lastWeekStart, end: lastWeekEnd }) &&
        t.transaction_type !== 'credit'
      )
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const deltaPercent =
      lastWeekTotal > 0
        ? ((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100
        : thisWeekTotal > 0
          ? 100
          : 0;

    const topCategory = categorySummary[0];

    return {
      thisWeekTotal,
      lastWeekTotal,
      deltaPercent,
      topCategoryName: topCategory?.category || 'No data',
      topCategoryAmount: topCategory?.amount || 0,
    };
  }, [transactions, categorySummary]);

  const selectedMonthDebit = useMemo(
    () =>
      dateFilteredTransactions.reduce(
        (sum, t) =>
          sum + (t.transaction_type === 'credit' ? 0 : Number(t.amount || 0)),
        0
      ),
    [dateFilteredTransactions]
  );

  const selectedMonthCredit = useMemo(
    () =>
      dateFilteredTransactions.reduce(
        (sum, t) =>
          sum + (t.transaction_type === 'credit' ? Number(t.amount || 0) : 0),
        0
      ),
    [dateFilteredTransactions]
  );

  useEffect(() => {
    return () => {
      if (liveSyncIntervalRef.current) {
        clearInterval(liveSyncIntervalRef.current);
      }
      realtimeCleanupRef.current?.();
      realtimeCleanupRef.current = null;
      realtimeStartedForRef.current = '';
    };
  }, []);

  const loadTransactions = async () => {
    try {
      const savedUserId = await AsyncStorage.getItem('userId');
      if (savedUserId) {
        setUserId(savedUserId);
        if (realtimeStartedForRef.current !== savedUserId) {
          realtimeCleanupRef.current?.();
          const cleanup = await startRealtimeSmsSync({
            userId: savedUserId,
            onTransactionsCreated: (items) => mergeTransactions(items as Transaction[]),
          });
          realtimeCleanupRef.current = cleanup;
          realtimeStartedForRef.current = savedUserId;
        }
        const response = await axios.get(
          `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${savedUserId}?limit=${TRANSACTION_HISTORY_LIMIT}`
        );
        setTransactions(response.data);
        void bootstrapSmsImport(savedUserId);
      }
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  loadTransactionsRef.current = loadTransactions;

  useFocusEffect(
    React.useCallback(() => {
      void loadTransactionsRef.current();
    }, [])
  );

  const mergeTransactions = (created: Transaction[]) => {
    if (created.length === 0) return;
    setTransactions((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      const uniqueCreated = created.filter((item) => !seen.has(item.id));
      return [...uniqueCreated, ...prev];
    });
  };

  async function bootstrapSmsImport(uid: string) {
    try {
      const trigger = await getSmsAuthTrigger();
      if (trigger === 'signup' || trigger === 'login') {
        setAutoImporting(true);
        await syncSmsTransactions({
          userId: uid,
          mode: trigger,
          requestPermission: true,
          onTransactionsCreated: (items) => mergeTransactions(items as Transaction[]),
        });
        await clearSmsAuthTrigger();
      }

      if (!liveSyncIntervalRef.current) {
        liveSyncIntervalRef.current = setInterval(() => {
          void syncSmsTransactions({
            userId: uid,
            mode: 'live',
            onTransactionsCreated: (items) => mergeTransactions(items as Transaction[]),
          });
        }, LIVE_SMS_SYNC_INTERVAL_MS);
      }
    } catch (error) {
      console.error('Error bootstrapping SMS import:', error);
    } finally {
      setAutoImporting(false);
    }
  }

  const requestSMSPermission = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Not Available',
        'SMS reading is only available on Android devices. Please add transactions manually.'
      );
      return;
    }

    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        {
          title: 'SMS Permission',
          message:
            'Allow SpendWise to read SMS messages to import transaction alerts.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
          buttonNeutral: 'Ask Later',
        }
      );

      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        setAutoImporting(true);
        const createdCount = await syncSmsTransactions({
          userId,
          mode: 'manual',
          requestPermission: false,
          onTransactionsCreated: (items) => mergeTransactions(items as Transaction[]),
        });
        if (createdCount === 0) {
          setShowSmsModal(true);
          return;
        }
        Alert.alert('SMS Synced', `Imported ${createdCount} new SMS transactions.`);
      } else {
        Alert.alert(
          'Permission Denied',
          'SMS permission was not granted. You can still add transactions manually.'
        );
      }
    } catch (error) {
      console.error('Error requesting SMS permission:', error);
    } finally {
      setAutoImporting(false);
    }
  };

  const importSmsTransactions = async () => {
    if (!smsText.trim()) {
      Alert.alert('Error', 'Please paste at least one SMS message.');
      return;
    }

    try {
      setSmsProcessing(true);
      const messages = smsText
        .split(/\n+/)
        .map((m) => m.trim())
        .filter(Boolean);

      const responses = await Promise.allSettled(
        messages.map((msg) =>
          axios.post(`${EXPO_PUBLIC_BACKEND_URL}/api/transactions/sms`, {
            user_id: userId,
            sms_text: msg,
          })
        )
      );

      const created: Transaction[] = [];
      for (const result of responses) {
        if (result.status === 'fulfilled') {
          created.push(result.value.data as Transaction);
          continue;
        }
        if (axios.isAxiosError(result.reason) && result.reason.response?.status === 422) {
          continue;
        }
        throw result.reason;
      }
      mergeTransactions(created);

      setSmsText('');
      setShowSmsModal(false);
      Alert.alert('Success', `Imported ${created.length} SMS transaction${created.length === 1 ? '' : 's'}.`);
    } catch (error) {
      console.error('Error importing SMS transactions:', error);
      Alert.alert('Error', 'Failed to import SMS transactions.');
    } finally {
      setSmsProcessing(false);
    }
  };

  const addManualTransaction = async () => {
    if (!amount || !description.trim()) {
      Alert.alert('Error', 'Please enter amount and description');
      return;
    }

    try {
      setProcessing(true);
      const response = await axios.post(
        `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/manual`,
        {
          user_id: userId,
          amount: parseFloat(amount),
          description: description.trim(),
        }
      );

      setTransactions((prev) => [response.data, ...prev]);
      setAmount('');
      setDescription('');
      setShowAddModal(false);
      Alert.alert('Success', `Added in ${response.data.category}`);
    } catch (error) {
      console.error('Error adding transaction:', error);
      Alert.alert('Error', 'Failed to add transaction');
    } finally {
      setProcessing(false);
    }
  };

  const updateTransactionCategory = async (
    category: string,
    applyToSimilar = false
  ) => {
    if (!selectedTransaction) return;
    try {
      setUpdatingCategory(true);
      const response = await axios.put(
        `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${selectedTransaction.id}/category`,
        {
          user_id: userId,
          category,
          apply_to_similar: applyToSimilar,
        }
      );

      if (applyToSimilar) {
        await loadTransactions();
      } else {
        setTransactions((prev) =>
          prev.map((item) =>
            item.id === selectedTransaction.id ? response.data : item
          )
        );
      }
      setShowCategoryModal(false);
      setSelectedTransaction(null);
    } catch (error) {
      console.error('Error updating category:', error);
      Alert.alert('Error', 'Failed to update category.');
    } finally {
      setUpdatingCategory(false);
    }
  };

  const selectCategoryWithConfirmation = async (category: string) => {
    if (!selectedTransaction) return;
    try {
      setUpdatingCategory(true);
      const preview = await axios.post<SimilarPreview>(
        `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${selectedTransaction.id}/similar-preview`,
        { user_id: userId }
      );

      const matchCount = Number(preview.data?.match_count || 0);
      if (matchCount <= 0) {
        await updateTransactionCategory(category, false);
        return;
      }

      const merchantHint = preview.data?.upi_id
        ? `UPI: ${preview.data.upi_id}`
        : preview.data?.merchant_key
          ? String(preview.data.merchant_key).replace('merchant:', '')
          : 'this merchant';

      Alert.alert(
        'Apply Category to Similar Transactions?',
        `${matchCount} other transaction(s) match ${merchantHint}.`,
        [
          {
            text: 'Only This One',
            onPress: () => {
              void updateTransactionCategory(category, false);
            },
          },
          {
            text: `Apply to ${matchCount} Similar`,
            onPress: () => {
              void updateTransactionCategory(category, true);
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    } catch (error) {
      console.error('Error previewing similar transactions:', error);
      await updateTransactionCategory(category, false);
    } finally {
      setUpdatingCategory(false);
    }
  };

  const openCategoryEditor = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setShowCategoryModal(true);
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      Food: '#FF6B6B',
      Groceries: '#6CC24A',
      Transport: '#4ECDC4',
      Shopping: '#95E1D3',
      Bills: '#F38181',
      Entertainment: '#AA96DA',
      Health: '#FCBAD3',
      Medical: '#FF9F9F',
      Education: '#FFFFD2',
      Travel: '#A8D8EA',
      Transfer: '#6FA8DC',
      Other: '#999',
    };
    return colors[category] || '#999';
  };

  const getCategoryIcon = (category: string) => {
    const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
      Food: 'restaurant-outline',
      Groceries: 'basket-outline',
      Transport: 'car-outline',
      Shopping: 'bag-outline',
      Bills: 'document-text-outline',
      Entertainment: 'film-outline',
      Health: 'medkit-outline',
      Medical: 'medkit-outline',
      Education: 'school-outline',
      Travel: 'airplane-outline',
      Transfer: 'swap-horizontal-outline',
      Other: 'pricetag-outline',
    };
    return icons[category] || 'pricetag-outline';
  };

  const getSentimentIcon = (sentiment?: string) => {
    switch (sentiment) {
      case 'positive':
        return 'happy-outline';
      case 'negative':
        return 'sad-outline';
      default:
        return 'ellipse-outline';
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Transactions</Text>
          <Text style={styles.headerSubtitle}>
            Category can be edited from each transaction card
          </Text>
          {autoImporting && <Text style={styles.syncText}>Syncing SMS in background...</Text>}
        </View>
        <View style={styles.headerButtons}>
          {activeTab === 'transactions' && (
            <>
              <TouchableOpacity
                style={styles.headerButton}
                onPress={requestSMSPermission}
              >
                <Ionicons name="mail" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.headerButton, styles.addButton]}
                onPress={() => setShowAddModal(true)}
              >
                <Ionicons name="add" size={20} color="#fff" />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <View style={styles.segmentedControl}>
        <TouchableOpacity
          style={[
            styles.segmentButton,
            activeTab === 'transactions' && styles.segmentButtonActive,
          ]}
          onPress={() => setActiveTab('transactions')}
        >
          <Text
            style={[
              styles.segmentLabel,
              activeTab === 'transactions' && styles.segmentLabelActive,
            ]}
          >
            Transactions
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.segmentButton,
            activeTab === 'analytics' && styles.segmentButtonActive,
          ]}
          onPress={() => setActiveTab('analytics')}
        >
          <Text
            style={[
              styles.segmentLabel,
              activeTab === 'analytics' && styles.segmentLabelActive,
            ]}
          >
            Analytics
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'transactions' ? (
        <ScrollView style={styles.scrollView}>
          <LinearGradient
            colors={['#3d40a8', '#2e2f86', '#252468']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.reflectionCard}
          >
            <View style={styles.reflectionHeader}>
              <Text style={styles.reflectionTitle}>Weekly Reflection</Text>
              <Text style={styles.reflectionDate}>{format(new Date(), 'MMM d')}</Text>
            </View>
            <View style={styles.reflectionStats}>
              <View>
                <Text style={styles.reflectionValue}>
                  {formatINR(weeklyReflection.thisWeekTotal)}
                </Text>
                <Text style={styles.reflectionCaption}>This Week</Text>
              </View>
              <View>
                <Text style={styles.reflectionValue}>
                  {formatINR(weeklyReflection.lastWeekTotal)}
                </Text>
                <Text style={styles.reflectionCaption}>Last Week</Text>
              </View>
              <View>
                <Text style={styles.reflectionValueSmall}>
                  {weeklyReflection.topCategoryName}
                </Text>
                <Text style={styles.reflectionCaption}>Top Category</Text>
              </View>
            </View>
            <View style={styles.reflectionInsightPill}>
              <Ionicons name="sparkles-outline" size={16} color="#63d8ff" />
              <Text style={styles.reflectionInsightText}>
                {weeklyReflection.deltaPercent >= 0 ? 'Up' : 'Down'}{' '}
                {Math.abs(weeklyReflection.deltaPercent).toFixed(0)}% vs last week
              </Text>
            </View>
          </LinearGradient>

          <View style={styles.creditDebitRow}>
            <TouchableOpacity
              style={styles.creditDebitCard}
              onPress={() =>
                router.push({
                  pathname: '/transactions/type/[txnType]',
                  params: {
                    txnType: 'debit',
                    month: selectedMonthKey,
                  },
                })
              }
            >
              <View style={styles.creditDebitHeader}>
                <Ionicons name="arrow-down-circle-outline" size={16} color="#FF6B6B" />
                <Text style={styles.creditDebitLabel}>Total Debit</Text>
              </View>
              <Text style={styles.creditDebitValueDebit}>
                {formatINR(selectedMonthDebit)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.creditDebitCard}
              onPress={() =>
                router.push({
                  pathname: '/transactions/type/[txnType]',
                  params: {
                    txnType: 'credit',
                    month: selectedMonthKey,
                  },
                })
              }
            >
              <View style={styles.creditDebitHeader}>
                <Ionicons name="arrow-up-circle-outline" size={16} color="#4FC3F7" />
                <Text style={styles.creditDebitLabel}>Total Credit</Text>
              </View>
              <Text style={styles.creditDebitValueCredit}>
                {formatINR(selectedMonthCredit)}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.monthRow}
            contentContainerStyle={styles.monthRowContent}
          >
            {monthOptions.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.monthChip,
                  selectedMonthKey === item.key && styles.monthChipActive,
                ]}
                onPress={() => setSelectedMonthKey(item.key)}
              >
                <Text
                  style={[
                    styles.monthChipText,
                    selectedMonthKey === item.key && styles.monthChipTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionHeading}>Categories</Text>
              <Text style={styles.sectionHeadingMeta}>
                {formatINR(
                  categorySummary.reduce((sum, item) => sum + item.amount, 0)
                )}{' '}
                | {dateFilteredTransactions.length} txns
              </Text>
            </View>

            {categorySummary.map((item) => (
              <TouchableOpacity
                key={item.category}
                style={styles.categoryListCard}
                onPress={() =>
                  router.push({
                    pathname: '/transactions/type/[txnType]',
                    params: {
                      txnType: 'category',
                      category: item.category,
                      month: selectedMonthKey,
                    },
                  })
                }
              >
                <View
                  style={[
                    styles.categoryIconCircle,
                    { backgroundColor: `${getCategoryColor(item.category)}22` },
                  ]}
                >
                  <Ionicons
                    name={getCategoryIcon(item.category)}
                    size={18}
                    color={getCategoryColor(item.category)}
                  />
                </View>
                <View style={styles.categoryListTextWrap}>
                  <Text style={styles.categoryListTitle}>{item.category}</Text>
                  <Text style={styles.categoryListMeta}>{item.count} payments</Text>
                </View>
                <Text style={styles.categoryListAmount}>{formatINR(item.amount)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionHeading}>Smart Suggestions</Text>
            <View style={styles.suggestionCard}>
              <View style={styles.suggestionItem}>
                <View style={[styles.suggestionIconWrap, { backgroundColor: '#3a2f0f' }]}>
                  <Ionicons name="flash-outline" size={14} color="#ffcf66" />
                </View>
                <View style={styles.suggestionTextWrap}>
                  <Text style={styles.suggestionTitle}>Weekly Pace</Text>
                  <Text style={styles.suggestionSubtitle}>
                    {weeklyReflection.deltaPercent >= 0 ? 'Higher' : 'Lower'} spend than last week.
                    Focus on {weeklyReflection.topCategoryName.toLowerCase()} this weekend.
                  </Text>
                </View>
              </View>
              <View style={styles.suggestionDivider} />
              <View style={styles.suggestionItem}>
                <View style={[styles.suggestionIconWrap, { backgroundColor: '#103a2f' }]}>
                  <Ionicons name="stats-chart-outline" size={14} color="#63d6b2" />
                </View>
                <View style={styles.suggestionTextWrap}>
                  <Text style={styles.suggestionTitle}>Range Summary</Text>
                  <Text style={styles.suggestionSubtitle}>
                    Tap a category card above to open category-wise transactions.
                  </Text>
                </View>
              </View>
            </View>
          </View>

        </ScrollView>
      ) : (
        <AnalyticsPanel variant="embedded" />
      )}

      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Transaction</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Amount (Rs)</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                placeholderTextColor="#666"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="What did you spend on?"
                placeholderTextColor="#666"
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
              />
            </View>

            <TouchableOpacity
              style={styles.addButton}
              onPress={addManualTransaction}
              disabled={processing}
            >
              {processing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.addButtonText}>Add Transaction</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showSmsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSmsModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Import from SMS</Text>
              <TouchableOpacity onPress={() => setShowSmsModal(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <Text style={styles.smsHelpText}>
              Paste one or more transaction SMS messages (one per line).
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>SMS Messages</Text>
              <TextInput
                style={[styles.input, styles.textArea, styles.smsInput]}
                placeholder="Your account debited Rs. 1250 for AMAZON purchase"
                placeholderTextColor="#666"
                value={smsText}
                onChangeText={setSmsText}
                multiline
                numberOfLines={6}
              />
            </View>

            <TouchableOpacity
              style={styles.addButton}
              onPress={importSmsTransactions}
              disabled={smsProcessing}
            >
              {smsProcessing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.addButtonText}>Import SMS</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showCategoryModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCategoryModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Category</Text>
              <TouchableOpacity onPress={() => setShowCategoryModal(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <Text style={styles.smsHelpText}>
              Select a category for this transaction.
            </Text>

            <View style={styles.categoryList}>
              {CATEGORIES.map((category) => (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.categoryOption,
                    selectedTransaction?.category === category &&
                      styles.categoryOptionActive,
                  ]}
                  onPress={() => void selectCategoryWithConfirmation(category)}
                  disabled={updatingCategory}
                >
                  <Text style={styles.categoryOptionText}>{category}</Text>
                  {selectedTransaction?.category === category && (
                    <Ionicons name="checkmark" size={18} color="#4CAF50" />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {updatingCategory && <ActivityIndicator color="#4CAF50" style={{ marginTop: 12 }} />}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  syncText: {
    fontSize: 11,
    color: '#4CAF50',
    marginTop: 4,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  segmentedControl: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginBottom: 8,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 4,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: '#4CAF50',
  },
  segmentLabel: {
    color: '#999',
    fontSize: 12,
    fontWeight: '600',
  },
  segmentLabelActive: {
    color: '#fff',
  },
  headerButton: {
    width: 40,
    height: 40,
    backgroundColor: '#2a2a3e',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    backgroundColor: '#4CAF50',
  },
  scrollView: {
    flex: 1,
  },
  reflectionCard: {
    marginHorizontal: 24,
    marginBottom: 12,
    borderRadius: 22,
    padding: 16,
  },
  reflectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  reflectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  reflectionDate: {
    color: '#d5dbff',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  reflectionStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  reflectionValue: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
  },
  reflectionValueSmall: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  reflectionCaption: {
    color: '#c4c9ff',
    fontSize: 11,
    marginTop: 4,
  },
  reflectionInsightPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  reflectionInsightText: {
    color: '#eff3ff',
    fontSize: 12,
    fontWeight: '600',
  },
  creditDebitRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 24,
    marginBottom: 12,
  },
  creditDebitCard: {
    flex: 1,
    backgroundColor: '#17182c',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    padding: 12,
  },
  creditDebitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  creditDebitLabel: {
    color: '#9aa0b4',
    fontSize: 11,
    fontWeight: '700',
  },
  creditDebitValueDebit: {
    color: '#FF6B6B',
    fontSize: 16,
    fontWeight: '700',
  },
  creditDebitValueCredit: {
    color: '#4FC3F7',
    fontSize: 16,
    fontWeight: '700',
  },
  filtersRow: {
    maxHeight: 44,
  },
  filtersRowContent: {
    paddingHorizontal: 24,
    gap: 10,
  },
  filterChip: {
    backgroundColor: '#1a1a2e',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterChipActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  filterChipText: {
    color: '#9aa0b4',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  monthRow: {
    maxHeight: 44,
    marginBottom: 4,
  },
  monthRowContent: {
    paddingHorizontal: 24,
    gap: 10,
  },
  monthChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#151629',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  monthChipActive: {
    backgroundColor: '#24325d',
    borderColor: '#4a6fce',
  },
  monthChipText: {
    color: '#9aa0b4',
    fontSize: 12,
    fontWeight: '600',
  },
  monthChipTextActive: {
    color: '#d7e2ff',
  },
  sectionBlock: {
    paddingHorizontal: 24,
    marginTop: 12,
    marginBottom: 12,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionHeading: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  sectionHeadingMeta: {
    color: '#8f95aa',
    fontSize: 11,
    fontWeight: '600',
  },
  categorySummaryRow: {
    gap: 10,
  },
  categorySummaryCard: {
    width: 170,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  categorySummaryCardActive: {
    borderColor: '#4CAF50',
  },
  categorySummaryName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  categorySummaryAmount: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
  },
  categorySummaryCount: {
    color: '#9aa0b4',
    fontSize: 11,
    marginTop: 4,
  },
  categoryListCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#17182c',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    marginBottom: 10,
  },
  categoryListCardActive: {
    borderColor: '#4CAF50',
    backgroundColor: '#1c2b2a',
  },
  categoryIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  categoryListTextWrap: {
    flex: 1,
  },
  categoryListTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  categoryListMeta: {
    color: '#9aa0b4',
    fontSize: 11,
  },
  categoryListAmount: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  suggestionCard: {
    backgroundColor: '#17182c',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    padding: 12,
    gap: 10,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  suggestionIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  suggestionTextWrap: {
    flex: 1,
  },
  suggestionTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 3,
  },
  suggestionSubtitle: {
    color: '#aab0c4',
    fontSize: 12,
    lineHeight: 17,
  },
  suggestionDivider: {
    height: 1,
    backgroundColor: '#2a2a3e',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
  },
  transactionCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    marginHorizontal: 24,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  categoryIndicator: {
    width: 4,
  },
  transactionContent: {
    flex: 1,
    padding: 16,
  },
  transactionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#141428',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  categoryEditButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#141428',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  transactionCategory: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  transactionAmount: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#FF6B6B',
  },
  transactionDescription: {
    fontSize: 14,
    color: '#999',
    marginBottom: 8,
  },
  transactionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  transactionDate: {
    fontSize: 12,
    color: '#666',
  },
  transactionBadges: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a3e',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  badgeText: {
    fontSize: 10,
    color: '#999',
    textTransform: 'uppercase',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: 380,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  smsHelpText: {
    color: '#999',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#2a2a3e',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  smsInput: {
    minHeight: 140,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 16,
  },
  categoryList: {
    gap: 10,
  },
  categoryOption: {
    backgroundColor: '#2a2a3e',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryOptionActive: {
    borderColor: '#4CAF50',
  },
  categoryOptionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
