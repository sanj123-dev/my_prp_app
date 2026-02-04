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
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { format } from 'date-fns';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Credit {
  id: string;
  card_name: string;
  credit_score?: number;
  card_balance: number;
  credit_limit: number;
  utilization: number;
  payment_due_date?: string;
}

export default function Credit() {
  const [userId, setUserId] = useState<string>('');
  const [credits, setCredits] = useState<Credit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [cardName, setCardName] = useState('');
  const [creditScore, setCreditScore] = useState('');
  const [cardBalance, setCardBalance] = useState('');
  const [creditLimit, setCreditLimit] = useState('');

  useEffect(() => {
    loadCredits();
  }, []);

  const loadCredits = async () => {
    try {
      const savedUserId = await AsyncStorage.getItem('userId');
      if (savedUserId) {
        setUserId(savedUserId);
        const response = await axios.get(
          `${EXPO_PUBLIC_BACKEND_URL}/api/credits/${savedUserId}`
        );
        setCredits(response.data);
      }
    } catch (error) {
      console.error('Error loading credits:', error);
    } finally {
      setLoading(false);
    }
  };

  const addCreditCard = async () => {
    if (!cardName.trim() || !cardBalance || !creditLimit) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      setProcessing(true);
      const response = await axios.post(`${EXPO_PUBLIC_BACKEND_URL}/api/credits`, {
        user_id: userId,
        card_name: cardName.trim(),
        credit_score: creditScore ? parseInt(creditScore) : null,
        card_balance: parseFloat(cardBalance),
        credit_limit: parseFloat(creditLimit),
      });

      setCredits([...credits, response.data]);
      setCardName('');
      setCreditScore('');
      setCardBalance('');
      setCreditLimit('');
      setShowAddModal(false);
      Alert.alert('Success', 'Credit card added successfully');
    } catch (error) {
      console.error('Error adding credit:', error);
      Alert.alert('Error', 'Failed to add credit card');
    } finally {
      setProcessing(false);
    }
  };

  const getUtilizationColor = (utilization: number) => {
    if (utilization < 30) return '#4CAF50';
    if (utilization < 70) return '#FF9800';
    return '#FF6B6B';
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
        <Text style={styles.headerTitle}>Credit Cards</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowAddModal(true)}
        >
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView}>
        {credits.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="card-outline" size={64} color="#666" />
            <Text style={styles.emptyText}>No credit cards added</Text>
            <Text style={styles.emptySubtext}>Track your credit card balances and utilization</Text>
          </View>
        ) : (
          credits.map((credit) => (
            <View key={credit.id} style={styles.creditCard}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardName}>{credit.card_name}</Text>
                  {credit.credit_score && (
                    <Text style={styles.creditScore}>Score: {credit.credit_score}</Text>
                  )}
                </View>
                <Ionicons name="card" size={32} color="#4CAF50" />
              </View>

              <View style={styles.cardBody}>
                <View style={styles.balanceRow}>
                  <Text style={styles.balanceLabel}>Balance</Text>
                  <Text style={styles.balanceValue}>${credit.card_balance.toFixed(2)}</Text>
                </View>
                <View style={styles.balanceRow}>
                  <Text style={styles.balanceLabel}>Limit</Text>
                  <Text style={styles.limitValue}>${credit.credit_limit.toFixed(2)}</Text>
                </View>
              </View>

              <View style={styles.utilizationContainer}>
                <View style={styles.utilizationHeader}>
                  <Text style={styles.utilizationLabel}>Credit Utilization</Text>
                  <Text
                    style={[
                      styles.utilizationValue,
                      { color: getUtilizationColor(credit.utilization) },
                    ]}
                  >
                    {credit.utilization.toFixed(1)}%
                  </Text>
                </View>
                <View style={styles.progressBarContainer}>
                  <View
                    style={[
                      styles.progressBar,
                      {
                        width: `${Math.min(credit.utilization, 100)}%`,
                        backgroundColor: getUtilizationColor(credit.utilization),
                      },
                    ]}
                  />
                </View>
                <Text style={styles.utilizationTip}>
                  {credit.utilization < 30
                    ? 'Excellent! Keep it below 30%'
                    : credit.utilization < 70
                    ? 'Consider paying down your balance'
                    : 'High utilization may affect your score'}
                </Text>
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
              <Text style={styles.modalTitle}>Add Credit Card</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Card Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Chase Sapphire"
                  placeholderTextColor="#666"
                  value={cardName}
                  onChangeText={setCardName}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Credit Score (Optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., 750"
                  placeholderTextColor="#666"
                  value={creditScore}
                  onChangeText={setCreditScore}
                  keyboardType="number-pad"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Current Balance ($) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0.00"
                  placeholderTextColor="#666"
                  value={cardBalance}
                  onChangeText={setCardBalance}
                  keyboardType="decimal-pad"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Credit Limit ($) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0.00"
                  placeholderTextColor="#666"
                  value={creditLimit}
                  onChangeText={setCreditLimit}
                  keyboardType="decimal-pad"
                />
              </View>

              <TouchableOpacity
                style={styles.submitButton}
                onPress={addCreditCard}
                disabled={processing}
              >
                {processing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>Add Card</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
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
  addButton: {
    width: 40,
    height: 40,
    backgroundColor: '#4CAF50',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
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
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  creditCard: {
    backgroundColor: '#1a1a2e',
    marginHorizontal: 24,
    marginBottom: 16,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  cardName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  creditScore: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
  },
  cardBody: {
    marginBottom: 20,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#999',
  },
  balanceValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FF6B6B',
  },
  limitValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4CAF50',
  },
  utilizationContainer: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#2a2a3e',
  },
  utilizationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  utilizationLabel: {
    fontSize: 14,
    color: '#999',
  },
  utilizationValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: '#2a2a3e',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  utilizationTip: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
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
    maxHeight: '80%',
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
    marginBottom: 16,
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
  submitButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});