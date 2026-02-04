import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { format } from 'date-fns';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function Dashboard() {
  const [userId, setUserId] = useState<string>('');
  const [analytics, setAnalytics] = useState<any>(null);
  const [insights, setInsights] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const savedUserId = await AsyncStorage.getItem('userId');
      if (savedUserId) {
        setUserId(savedUserId);
        await fetchAnalytics(savedUserId);
        await fetchInsights(savedUserId);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchAnalytics = async (uid: string) => {
    try {
      const response = await axios.get(
        `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${uid}/analytics?days=30`
      );
      setAnalytics(response.data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    }
  };

  const fetchInsights = async (uid: string) => {
    try {
      const response = await axios.get(
        `${EXPO_PUBLIC_BACKEND_URL}/api/insights/${uid}`
      );
      setInsights(response.data.insights);
    } catch (error) {
      console.error('Error fetching insights:', error);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </SafeAreaView>
    );
  }

  const totalSpending = analytics?.total_spending || 0;
  const transactionCount = analytics?.transaction_count || 0;
  const avgTransaction = analytics?.average_transaction || 0;
  const categories = analytics?.categories || {};

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#4CAF50"
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.welcomeText}>Dashboard</Text>
            <Text style={styles.headerSubtext}>{format(new Date(), 'MMMM d, yyyy')}</Text>
          </View>
          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="notifications-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.statsContainer}>
          <View style={[styles.statCard, styles.primaryCard]}>
            <Ionicons name="wallet" size={32} color="#fff" />
            <Text style={styles.statValue}>${totalSpending.toFixed(2)}</Text>
            <Text style={styles.statLabel}>Total Spending (30 days)</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.smallStatCard}>
              <Ionicons name="receipt" size={24} color="#2196F3" />
              <Text style={styles.smallStatValue}>{transactionCount}</Text>
              <Text style={styles.smallStatLabel}>Transactions</Text>
            </View>

            <View style={styles.smallStatCard}>
              <Ionicons name="trending-up" size={24} color="#FF9800" />
              <Text style={styles.smallStatValue}>${avgTransaction.toFixed(2)}</Text>
              <Text style={styles.smallStatLabel}>Avg Amount</Text>
            </View>
          </View>
        </View>

        {Object.keys(categories).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Spending by Category</Text>
            {Object.entries(categories).map(([category, amount]: any) => {
              const percentage = (amount / totalSpending) * 100;
              return (
                <View key={category} style={styles.categoryItem}>
                  <View style={styles.categoryHeader}>
                    <Text style={styles.categoryName}>{category}</Text>
                    <Text style={styles.categoryAmount}>${amount.toFixed(2)}</Text>
                  </View>
                  <View style={styles.progressBarContainer}>
                    <View
                      style={[
                        styles.progressBar,
                        { width: `${Math.min(percentage, 100)}%` },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {insights && (
          <View style={styles.section}>
            <View style={styles.insightsHeader}>
              <Ionicons name="bulb" size={20} color="#FFD700" />
              <Text style={styles.sectionTitle}>AI Insights</Text>
            </View>
            <View style={styles.insightsCard}>
              <Text style={styles.insightsText}>{insights}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1e',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 16 : 0,
    paddingBottom: 16,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  headerSubtext: {
    fontSize: 14,
    color: '#999',
  },
  iconButton: {
    padding: 8,
  },
  statsContainer: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  primaryCard: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  statValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 12,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  smallStatCard: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  smallStatValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 8,
    marginBottom: 4,
  },
  smallStatLabel: {
    fontSize: 12,
    color: '#999',
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  categoryItem: {
    marginBottom: 16,
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryName: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  categoryAmount: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: '#2a2a3e',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 4,
  },
  insightsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  insightsCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  insightsText: {
    fontSize: 14,
    color: '#fff',
    lineHeight: 22,
  },
});