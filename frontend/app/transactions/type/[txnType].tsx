import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, router } from 'expo-router';
import {
  endOfMonth,
  format,
  isWithinInterval,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { formatINR } from '../../../lib/currency';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type Transaction = {
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
};

type MonthOption = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

const CATEGORY_OPTIONS = [
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

export default function TransactionTypeDetailScreen() {
  const params = useLocalSearchParams();
  const txnType = String(Array.isArray(params.txnType) ? params.txnType[0] : params.txnType || 'debit');
  const categoryParam = String(Array.isArray(params.category) ? params.category[0] : params.category || '');
  const monthParam = String(Array.isArray(params.month) ? params.month[0] : params.month || '');

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonthKey, setSelectedMonthKey] = useState(format(new Date(), 'yyyy-MM'));
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('Other');
  const [editType, setEditType] = useState<'credit' | 'debit' | 'self_transfer'>('debit');
  const [savingEdit, setSavingEdit] = useState(false);

  const monthOptions = useMemo<MonthOption[]>(() => {
    return Array.from({ length: 24 }).map((_, index) => {
      const date = subMonths(new Date(), index);
      return {
        key: format(date, 'yyyy-MM'),
        label: format(date, 'MMM yyyy'),
        start: startOfMonth(date),
        end: endOfMonth(date),
      };
    });
  }, []);

  useEffect(() => {
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      setSelectedMonthKey(monthParam);
    }
  }, [monthParam]);

  useEffect(() => {
    const load = async () => {
      try {
        const userId = await AsyncStorage.getItem('userId');
        if (!userId) {
          setLoading(false);
          return;
        }
        const response = await axios.get(
          `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${userId}?limit=1200`
        );
        setTransactions(response.data || []);
      } catch (error) {
        console.error('Error loading filtered transactions:', error);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const title = useMemo(() => {
    if (txnType === 'credit') return 'Credit Transactions';
    if (txnType === 'category') return `${categoryParam || 'Category'} Transactions`;
    return 'Debit Transactions';
  }, [categoryParam, txnType]);

  const filteredTransactions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const selectedMonth = monthOptions.find((item) => item.key === selectedMonthKey);

    return transactions
      .filter((item) => {
        const date = new Date(item.date);
        const monthMatch = selectedMonth
          ? isWithinInterval(date, { start: selectedMonth.start, end: selectedMonth.end })
          : true;

        const type = item.transaction_type === 'credit' ? 'credit' : 'debit';
        const typeMatch =
          txnType === 'category'
            ? true
            : txnType === 'credit'
              ? type === 'credit'
              : type === 'debit';

        const categoryTypeMatch =
          txnType !== 'category'
            ? true
            : String(item.category || 'Other').toLowerCase() === categoryParam.toLowerCase();

        const searchable = `${item.description} ${item.merchant_name || ''} ${item.bank_name || ''}`.toLowerCase();
        const searchMatch = query.length === 0 ? true : searchable.includes(query);

        return monthMatch && typeMatch && categoryTypeMatch && searchMatch;
      })
      .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }, [transactions, monthOptions, selectedMonthKey, txnType, categoryParam, searchQuery]);

  const total = useMemo(
    () => filteredTransactions.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [filteredTransactions]
  );

  const openEditModal = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setEditAmount(String(Number(transaction.amount || 0)));
    setEditCategory(transaction.category || 'Other');
    const currentType = transaction.transaction_type || 'debit';
    setEditType(
      currentType === 'credit' || currentType === 'self_transfer' ? currentType : 'debit'
    );
    setShowEditModal(true);
  };

  const saveEdit = async () => {
    if (!editingTransaction) return;
    const parsedAmount = Number(editAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    try {
      setSavingEdit(true);
      const userId = await AsyncStorage.getItem('userId');
      if (!userId) {
        Alert.alert('Session expired', 'Please login again.');
        return;
      }

      const response = await axios.put(
        `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${editingTransaction.id}`,
        {
          user_id: userId,
          amount: parsedAmount,
          category: editCategory,
          transaction_type: editType,
        }
      );

      const updated = response.data as Transaction;
      setTransactions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setShowEditModal(false);
      setEditingTransaction(null);
    } catch (error) {
      console.error('Error updating transaction:', error);
      Alert.alert('Update failed', 'Could not update transaction.');
    } finally {
      setSavingEdit(false);
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
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {filteredTransactions.length} transactions | {formatINR(total)}
          </Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color="#8992aa" />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search merchant, bank, description"
          placeholderTextColor="#8992aa"
          style={styles.searchInput}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRowContainer}
        contentContainerStyle={styles.chipRow}
      >
        {monthOptions.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={[styles.chip, selectedMonthKey === item.key && styles.chipActive]}
            onPress={() => setSelectedMonthKey(item.key)}
          >
            <Text style={[styles.chipText, selectedMonthKey === item.key && styles.chipTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {filteredTransactions.map((item) => {
          const isCredit = item.transaction_type === 'credit';
          return (
            <TouchableOpacity key={item.id} style={styles.card} onPress={() => openEditModal(item)}>
              <View style={styles.cardTop}>
                <View style={styles.bankBadge}>
                  <Ionicons name="business-outline" size={13} color="#80c8ff" />
                  <Text style={styles.bankText} numberOfLines={1}>
                    {item.bank_name || 'Bank'}
                  </Text>
                </View>
                <Text style={[styles.amount, isCredit ? styles.amountCredit : styles.amountDebit]}>
                  {isCredit ? '+' : '-'}
                  {formatINR(Number(item.amount || 0))}
                </Text>
              </View>
              <Text style={styles.merchant} numberOfLines={1}>
                {item.merchant_name || 'Unknown Merchant'}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {format(new Date(item.date), 'MMM d, p')} | {item.category} | {item.account_mask || 'A/C'} | {String(item.source || '').toUpperCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
        {filteredTransactions.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="file-tray-outline" size={42} color="#6c728a" />
            <Text style={styles.emptyText}>No transactions found for current filters.</Text>
          </View>
        )}
      </ScrollView>

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
              {CATEGORY_OPTIONS.map((item) => (
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
              {(['debit', 'credit', 'self_transfer'] as const).map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[
                    styles.typeChip,
                    editType === item && styles.typeChipActive,
                  ]}
                  onPress={() => setEditType(item)}
                >
                  <Text
                    style={[
                      styles.typeChipText,
                      editType === item && styles.typeChipTextActive,
                    ]}
                  >
                    {item === 'self_transfer' ? 'Self Transfer' : item.charAt(0).toUpperCase() + item.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.saveButton} onPress={() => void saveEdit()} disabled={savingEdit}>
              {savingEdit ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save Changes</Text>}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9aa0b4',
    fontSize: 12,
    marginTop: 2,
  },
  searchWrap: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
  },
  chipRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 8,
    paddingTop: 2,
    alignItems: 'flex-start',
  },
  chipRowContainer: {
    height: 44,
    flexGrow: 0,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 11,
    height: 34,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  chipActive: {
    backgroundColor: '#3559a6',
    borderColor: '#4f81e8',
  },
  chipText: {
    color: '#aeb4ca',
    fontSize: 11,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#fff',
  },
  list: {
    flex: 1,
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 4,
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    padding: 12,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bankBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#16283d',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2f4f70',
    paddingHorizontal: 9,
    paddingVertical: 4,
    maxWidth: '68%',
  },
  bankText: {
    color: '#8cc9ff',
    fontSize: 11,
    fontWeight: '700',
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
  },
  amountDebit: {
    color: '#ff6f7f',
  },
  amountCredit: {
    color: '#80d6ff',
  },
  merchant: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 10,
  },
  meta: {
    color: '#9aa0b4',
    fontSize: 11,
    marginTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    color: '#9aa0b4',
    marginTop: 10,
    fontSize: 13,
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
  typeChipActive: {
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
