import React, { useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SMS from 'expo-sms';
import { format } from 'date-fns';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Transaction {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  source: string;
  sentiment?: string;
}

export default function Transactions() {
  const [userId, setUserId] = useState<string>('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    try {
      const savedUserId = await AsyncStorage.getItem('userId');
      if (savedUserId) {
        setUserId(savedUserId);
        const response = await axios.get(
          `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${savedUserId}`
        );
        setTransactions(response.data);
      }
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const requestSMSPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        Alert.alert(
          'SMS Permission',
          'This feature requires SMS permission to read transaction messages. On Android, you\'ll need to enable this in device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Continue',
              onPress: () => {
                Alert.alert(
                  'Demo Mode',
                  'SMS reading is available on physical Android devices. For now, please add transactions manually.',
                );
              },
            },
          ]
        );
      } catch (error) {
        console.error('Error requesting SMS permission:', error);
      }
    } else {
      Alert.alert(
        'Not Available',
        'SMS reading is only available on Android devices. Please add transactions manually.'
      );
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

      setTransactions([response.data, ...transactions]);
      setAmount('');
      setDescription('');
      setShowAddModal(false);
      Alert.alert('Success', `Transaction added and categorized as ${response.data.category}`);
    } catch (error) {
      console.error('Error adding transaction:', error);
      Alert.alert('Error', 'Failed to add transaction');
    } finally {
      setProcessing(false);
    }
  };

  const getCategoryColor = (category: string) => {
    const colors: any = {
      Food: '#FF6B6B',
      Transport: '#4ECDC4',
      Shopping: '#95E1D3',
      Bills: '#F38181',
      Entertainment: '#AA96DA',
      Health: '#FCBAD3',
      Education: '#FFFFD2',
      Travel: '#A8D8EA',
      Other: '#999',
    };
    return colors[category] || '#999';
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
        <Text style={styles.headerTitle}>Transactions</Text>
        <View style={styles.headerButtons}>
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
        </View>
      </View>

      <ScrollView style={styles.scrollView}>
        {transactions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={64} color="#666" />
            <Text style={styles.emptyText}>No transactions yet</Text>
            <Text style={styles.emptySubtext}>Add your first transaction to get started</Text>
          </View>
        ) : (
          transactions.map((transaction) => (
            <View key={transaction.id} style={styles.transactionCard}>
              <View
                style={[
                  styles.categoryIndicator,
                  { backgroundColor: getCategoryColor(transaction.category) },
                ]}
              />
              <View style={styles.transactionContent}>
                <View style={styles.transactionHeader}>
                  <Text style={styles.transactionCategory}>{transaction.category}</Text>
                  <Text style={styles.transactionAmount}>-${transaction.amount.toFixed(2)}</Text>
                </View>
                <Text style={styles.transactionDescription} numberOfLines={2}>
                  {transaction.description}
                </Text>
                <View style={styles.transactionFooter}>
                  <Text style={styles.transactionDate}>
                    {format(new Date(transaction.date), 'MMM d, yyyy')}
                  </Text>
                  <View style={styles.transactionBadges}>
                    <View style={styles.badge}>
                      <Ionicons
                        name={transaction.source === 'sms' ? 'mail' : 'create'}
                        size={12}
                        color="#999"
                      />
                      <Text style={styles.badgeText}>{transaction.source}</Text>
                    </View>
                    {transaction.sentiment && (
                      <Ionicons
                        name={getSentimentIcon(transaction.sentiment)}
                        size={16}
                        color="#999"
                        style={{ marginLeft: 8 }}
                      />
                    )}
                  </View>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>

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
              <Text style={styles.inputLabel}>Amount ($)</Text>
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
  headerButtons: {
    flexDirection: 'row',
    gap: 12,
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
  transactionCategory: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  transactionAmount: {
    fontSize: 18,
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
    minHeight: 400,
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
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});