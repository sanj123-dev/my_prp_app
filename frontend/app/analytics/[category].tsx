import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, router } from 'expo-router';
import {
  endOfMonth,
  format,
  isToday,
  isYesterday,
  isWithinInterval,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { formatINR } from '../../lib/currency';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type Transaction = {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  source: string;
  transaction_type?: 'credit' | 'debit';
  sentiment?: string;
};

type SimilarPreview = {
  match_count: number;
  merchant_key?: string | null;
  upi_id?: string | null;
};

type MonthOption = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

const CATEGORIES = [
  'Food',
  'Transport',
  'Shopping',
  'Bills',
  'Entertainment',
  'Health',
  'Education',
  'Travel',
  'Other',
];

export default function CategoryDetail() {
  const params = useLocalSearchParams();
  const categoryParam = Array.isArray(params.category)
    ? params.category[0]
    : params.category;
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  const category = decodeURIComponent(String(categoryParam || ''));

  const [allCategoryTransactions, setAllCategoryTransactions] = useState<Transaction[]>([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedMonthKey, setSelectedMonthKey] = useState(
    format(new Date(), 'yyyy-MM')
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editType, setEditType] = useState<'credit' | 'debit'>('debit');
  const [savingEdit, setSavingEdit] = useState(false);

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

  useEffect(() => {
    void loadCategory();
  }, [category]);

  useEffect(() => {
    if (monthParam && /^\d{4}-\d{2}$/.test(String(monthParam))) {
      setSelectedMonthKey(String(monthParam));
    }
  }, [monthParam]);

  const loadCategory = async () => {
    try {
      const savedUserId = await AsyncStorage.getItem('userId');
      if (!savedUserId || !category) {
        setLoading(false);
        return;
      }
      setUserId(savedUserId);

      const response = await axios.get(
        `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${savedUserId}?limit=1000`
      );
      const filtered = (response.data as Transaction[]).filter(
        (t) => t.category === category
      );
      setAllCategoryTransactions(filtered);
    } catch (error) {
      console.error('Error loading category detail:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTransactions = useMemo(() => {
    const selectedMonth = monthOptions.find((item) => item.key === selectedMonthKey);
    return allCategoryTransactions
      .filter((t) => {
        const date = new Date(t.date);
        const matchesMonth = selectedMonth
          ? isWithinInterval(date, {
              start: selectedMonth.start,
              end: selectedMonth.end,
            })
          : true;

        const q = searchQuery.trim().toLowerCase();
        const matchesSearch =
          q.length === 0 ||
          String(t.description || '').toLowerCase().includes(q) ||
          String(t.source || '').toLowerCase().includes(q);

        return matchesMonth && matchesSearch;
      })
      .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }, [allCategoryTransactions, monthOptions, searchQuery, selectedMonthKey]);

  const totalAmount = useMemo(
    () => filteredTransactions.reduce((sum, t) => sum + Number(t.amount || 0), 0),
    [filteredTransactions]
  );

  const getCategoryIcon = (categoryName: string) => {
    const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
      Food: 'restaurant-outline',
      Transport: 'car-outline',
      Shopping: 'bag-outline',
      Bills: 'document-text-outline',
      Entertainment: 'film-outline',
      Health: 'medkit-outline',
      Education: 'school-outline',
      Travel: 'airplane-outline',
      Other: 'pricetag-outline',
    };
    return icons[categoryName] || 'pricetag-outline';
  };

  const toTitleCase = (value: string) =>
    value.replace(/\w\S*/g, (word) => {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });

  const normalizeMerchant = (raw: string) => {
    const trimmed = String(raw || '')
      .replace(/[\[\]\(\)\|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!trimmed) return '';

    const withoutTail = trimmed.split(
      /\b(?:on|via|ref|utr|txn|txnid|available|avl|balance|bal|a\/c|ac)\b/i
    )[0]
      .trim()
      .replace(/[^a-zA-Z0-9&@.\- ]/g, '')
      .replace(/\s+/g, ' ');

    if (!withoutTail) return '';
    if (/^\d+$/.test(withoutTail)) return '';

    const cleaned = withoutTail.length > 30 ? `${withoutTail.slice(0, 30)}...` : withoutTail;
    return /^[A-Z0-9 .&@-]+$/.test(cleaned) ? toTitleCase(cleaned) : cleaned;
  };

  const getMerchantLabel = (description: string) => {
    const message = String(description || '').trim();
    if (!message) return category || 'Merchant';

    const anchorMatch = message.match(
      /\b(?:at|to|from|paid to|merchant|payee)\s*[:\-]?\s*([a-zA-Z0-9@.&\-_ ]{3,48})/i
    );
    const anchorCandidate = normalizeMerchant(anchorMatch?.[1] || '');
    if (anchorCandidate) return anchorCandidate;

    const upiIdMatch = message.match(/\b([a-zA-Z0-9._-]{2,})@([a-zA-Z]{2,})\b/);
    if (upiIdMatch) {
      const upiName = normalizeMerchant(upiIdMatch[1].replace(/[._-]/g, ' '));
      if (upiName) return upiName;
    }

    const firstChunk = normalizeMerchant(message.slice(0, 48));
    const looksLikeSmsNarration = /\b(debited|credited|account|a\/c|txn|utr|available|balance|rs|inr|upi)\b/i.test(
      message
    );
    if (firstChunk && !looksLikeSmsNarration) return firstChunk;

    return category || 'Merchant';
  };

  const getDateLabel = (dateRaw: string) => {
    const date = new Date(dateRaw);
    if (isToday(date)) return `Today, ${format(date, 'p')}`;
    if (isYesterday(date)) return `Yesterday, ${format(date, 'p')}`;
    return format(date, 'MMM d, p');
  };

  const openEditModal = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setEditAmount(String(Number(transaction.amount || 0)));
    setEditCategory(transaction.category || 'Other');
    setEditType(transaction.transaction_type === 'credit' ? 'credit' : 'debit');
    setShowEditModal(true);
  };

  const performSaveTransactionEdit = async (applyToSimilar: boolean) => {
    if (!editingTransaction || !userId) return;
    const parsedAmount = Number(editAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount greater than 0.');
      return;
    }

    try {
      setSavingEdit(true);

      const updateRes = await axios.put(
        `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${editingTransaction.id}`,
        {
          user_id: userId,
          amount: parsedAmount,
          category: editCategory,
          transaction_type: editType,
        }
      );

      if (applyToSimilar) {
        await axios.put(
          `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${editingTransaction.id}/category`,
          {
            user_id: userId,
            category: editCategory,
            apply_to_similar: true,
          }
        );
      }

      const latest = updateRes.data as Transaction;
      setAllCategoryTransactions((prev) => {
        const next = prev.map((item) =>
          item.id === editingTransaction.id ? latest : item
        );
        return next.filter((item) => item.category === category);
      });

      setShowEditModal(false);
      setEditingTransaction(null);
      await loadCategory();
    } catch (error) {
      console.error('Error updating transaction:', error);
      Alert.alert('Update failed', 'Could not update transaction amount/category.');
    } finally {
      setSavingEdit(false);
    }
  };

  const saveTransactionEdit = async () => {
    if (!editingTransaction || !userId) return;

    const categoryChanged = editCategory !== (editingTransaction.category || 'Other');
    if (!categoryChanged) {
      await performSaveTransactionEdit(false);
      return;
    }

    try {
      setSavingEdit(true);
      const preview = await axios.post<SimilarPreview>(
        `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${editingTransaction.id}/similar-preview`,
        { user_id: userId }
      );
      setSavingEdit(false);

      const matchCount = Number(preview.data?.match_count || 0);
      if (matchCount <= 0) {
        await performSaveTransactionEdit(false);
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
              void performSaveTransactionEdit(false);
            },
          },
          {
            text: `Apply to ${matchCount} Similar`,
            onPress: () => {
              void performSaveTransactionEdit(true);
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    } catch (error) {
      setSavingEdit(false);
      console.error('Error previewing similar transactions:', error);
      await performSaveTransactionEdit(false);
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
      <LinearGradient
        colors={['#4f46c6', '#3f3fb3', '#2f378e']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title}>{category || 'Category'}</Text>
            <Text style={styles.subtitle}>
              {filteredTransactions.length} transactions
            </Text>
          </View>
          <View style={styles.totalBadge}>
            <Text style={styles.totalBadgeText}>{formatINR(totalAmount)}</Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.monthRow}
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
      </LinearGradient>

      <View style={styles.body}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color="#8f97b8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search transactions"
            placeholderTextColor="#7f86a4"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {filteredTransactions.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="leaf-outline" size={56} color="#666" />
              <Text style={styles.emptyText}>No transactions found</Text>
              <Text style={styles.emptySubtext}>
                Try another month or search term.
              </Text>
            </View>
          ) : (
            filteredTransactions.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[
                  styles.transactionCard,
                  t.transaction_type === 'credit'
                    ? styles.transactionCardCredit
                    : styles.transactionCardDebit,
                ]}
                onPress={() => openEditModal(t)}
                activeOpacity={0.9}
              >
                <View style={styles.iconWrap}>
                  <Ionicons
                    name={getCategoryIcon(category)}
                    size={17}
                    color="#82e381"
                  />
                </View>
                <View style={styles.cardMeta}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {getMerchantLabel(t.description)}
                  </Text>
                  <Text style={styles.cardSubTitle}>
                    {getDateLabel(t.date)}
                  </Text>
                </View>
                <View style={styles.amountWrap}>
                  <Text
                    style={[
                      styles.cardAmount,
                      t.transaction_type === 'credit' && styles.cardAmountCredit,
                    ]}
                  >
                    {t.transaction_type === 'credit' ? '+' : '-'}
                    {formatINR(Number(t.amount))}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>

      <Modal
        visible={showEditModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Transaction</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Amount</Text>
            <TextInput
              style={styles.input}
              value={editAmount}
              onChangeText={setEditAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#7f86a4"
            />

            <Text style={styles.inputLabel}>Category</Text>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[
                    styles.categoryChip,
                    editCategory === item && styles.categoryChipActive,
                  ]}
                  onPress={() => setEditCategory(item)}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      editCategory === item && styles.categoryChipTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.inputLabel}>Transaction Type</Text>
            <View style={styles.typeRow}>
              <TouchableOpacity
                style={[
                  styles.typeChip,
                  editType === 'debit' && styles.typeChipDebitActive,
                ]}
                onPress={() => setEditType('debit')}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    editType === 'debit' && styles.typeChipTextActive,
                  ]}
                >
                  Debit
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeChip,
                  editType === 'credit' && styles.typeChipCreditActive,
                ]}
                onPress={() => setEditType('credit')}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    editType === 'credit' && styles.typeChipTextActive,
                  ]}
                >
                  Credit
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.saveButton}
              onPress={() => void saveTransactionEdit()}
              disabled={savingEdit}
            >
              {savingEdit ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Save Changes</Text>
              )}
            </TouchableOpacity>
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
  headerGradient: {
    paddingTop: Platform.OS === 'android' ? 12 : 8,
    paddingBottom: 14,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#d8dcff',
    fontSize: 12,
    marginTop: 2,
  },
  totalBadge: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  totalBadgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 11,
  },
  monthRow: {
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
  },
  monthChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  monthChipActive: {
    backgroundColor: '#fff',
  },
  monthChipText: {
    color: '#f0f2ff',
    fontSize: 12,
    fontWeight: '600',
  },
  monthChipTextActive: {
    color: '#34359c',
    fontWeight: '700',
  },
  body: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  searchBar: {
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 22,
  },
  transactionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#1b2a23',
    borderWidth: 1,
    borderColor: '#304f40',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  transactionCardDebit: {
    backgroundColor: '#1b2a23',
    borderColor: '#304f40',
  },
  transactionCardCredit: {
    backgroundColor: '#1b2433',
    borderColor: '#2e3f57',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0f0f1e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cardMeta: {
    flex: 1,
    marginRight: 10,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 3,
  },
  cardSubTitle: {
    color: '#b6bece',
    fontSize: 11,
  },
  amountWrap: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  cardAmount: {
    color: '#a3f7b4',
    fontSize: 14,
    fontWeight: '700',
  },
  cardAmountCredit: {
    color: '#86d4ff',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySubtext: {
    color: '#9ba3c5',
    fontSize: 12,
    marginTop: 8,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#17182c',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  inputLabel: {
    color: '#c9d0ef',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 8,
  },
  input: {
    height: 42,
    borderRadius: 12,
    backgroundColor: '#1f2038',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    color: '#fff',
    paddingHorizontal: 12,
    fontSize: 14,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  categoryChip: {
    borderRadius: 999,
    backgroundColor: '#232543',
    borderWidth: 1,
    borderColor: '#2e3153',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categoryChipActive: {
    backgroundColor: '#2f5d44',
    borderColor: '#4CAF50',
  },
  categoryChipText: {
    color: '#bdc5e7',
    fontSize: 11,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: '#d8ffe0',
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  typeChip: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2e3153',
    backgroundColor: '#232543',
    paddingVertical: 10,
    alignItems: 'center',
  },
  typeChipDebitActive: {
    backgroundColor: '#3a2626',
    borderColor: '#b85b5b',
  },
  typeChipCreditActive: {
    backgroundColor: '#213045',
    borderColor: '#4a8fd1',
  },
  typeChipText: {
    color: '#bdc5e7',
    fontSize: 12,
    fontWeight: '700',
  },
  typeChipTextActive: {
    color: '#fff',
  },
  saveButton: {
    marginTop: 16,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
