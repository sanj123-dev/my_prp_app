import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BarChart, LineChart } from 'react-native-gifted-charts';
import { endOfMonth, format, isWithinInterval, startOfMonth, subMonths } from 'date-fns';
import { formatINR } from '../../lib/currency';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type TransactionItem = {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  source: string;
  transaction_type?: 'credit' | 'debit' | 'self_transfer';
  sentiment?: string;
};

type AnalyticsPanelProps = {
  variant?: 'full' | 'embedded';
};

type MonthOption = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

type AnalyticsView = {
  total_spending: number;
  total_credit: number;
  transaction_count: number;
  average_transaction: number;
  categories: Record<string, number>;
  daily_spending: Record<string, number>;
};

type InsightCard = {
  title: string;
  bullets: string[];
};

export default function AnalyticsPanel({ variant = 'full' }: AnalyticsPanelProps) {
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [insights, setInsights] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [selectedMonthKey, setSelectedMonthKey] = useState(
    format(new Date(), 'yyyy-MM')
  );

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
    void loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const savedUserId = await AsyncStorage.getItem('userId');
      if (savedUserId) {
        const [transactionsResponse, insightsResponse] = await Promise.all([
          axios.get(`${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${savedUserId}?limit=1000`),
          axios.get(`${EXPO_PUBLIC_BACKEND_URL}/api/insights/${savedUserId}`),
        ]);

        setTransactions(transactionsResponse.data || []);
        setInsights(insightsResponse.data.insights);
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectedMonth = useMemo(
    () => monthOptions.find((item) => item.key === selectedMonthKey),
    [monthOptions, selectedMonthKey]
  );

  const monthTransactions = useMemo(() => {
    if (!selectedMonth) return [];
    return transactions.filter((item) =>
      isWithinInterval(new Date(item.date), {
        start: selectedMonth.start,
        end: selectedMonth.end,
      })
    );
  }, [transactions, selectedMonth]);

  const analytics = useMemo<AnalyticsView>(() => {
    const debitTransactions = monthTransactions.filter(
      (item) => item.transaction_type !== 'credit'
    );
    const creditTransactions = monthTransactions.filter(
      (item) => item.transaction_type === 'credit'
    );

    const categories = debitTransactions.reduce((acc: Record<string, number>, item) => {
      const key = String(item.category || 'Other');
      acc[key] = (acc[key] || 0) + Number(item.amount || 0);
      return acc;
    }, {});

    const dailySpending = debitTransactions.reduce((acc: Record<string, number>, item) => {
      const dayKey = format(new Date(item.date), 'yyyy-MM-dd');
      acc[dayKey] = (acc[dayKey] || 0) + Number(item.amount || 0);
      return acc;
    }, {});

    const totalSpending = debitTransactions.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );
    const totalCredit = creditTransactions.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    return {
      total_spending: totalSpending,
      total_credit: totalCredit,
      transaction_count: monthTransactions.length,
      average_transaction:
        debitTransactions.length > 0 ? totalSpending / debitTransactions.length : 0,
      categories,
      daily_spending: dailySpending,
    };
  }, [monthTransactions]);

  const dailyData = useMemo(() => {
    return Object.entries(analytics.daily_spending)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([dateKey, value]) => ({
        value: Number(value.toFixed(2)),
        label: format(new Date(dateKey), 'd'),
      }));
  }, [analytics.daily_spending]);

  const categoryBars = useMemo(() => {
    return Object.entries(analytics.categories)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([category, value], index) => ({
        value: Number(value.toFixed(2)),
        label: category.length > 9 ? `${category.slice(0, 9)}...` : category,
        frontColor: index % 2 === 0 ? '#33C27F' : '#40A9FF',
      }));
  }, [analytics.categories]);

  const totalSpending = analytics.total_spending;
  const insightCards = useMemo<InsightCard[]>(() => {
    const raw = (insights || '').trim();
    if (!raw) return [];

    const lines = raw
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const normalized = (lines.length > 1 ? lines : raw.split(/\.\s+/))
      .map((line) => line.replace(/^[-*•\d\)\.(\s]+/, '').trim())
      .filter(Boolean);

    return normalized.slice(0, 6).map((line, idx) => {
      const headingMatch = line.match(/^([^:]{4,42}):\s*(.*)$/);
      if (headingMatch) {
        const title = headingMatch[1].trim();
        const detail = headingMatch[2].trim();
        const bullets = detail
          ? detail
              .split(/\s*;\s*|\.\s+/)
              .map((part) => part.trim())
              .filter(Boolean)
              .slice(0, 3)
          : [];
        return {
          title,
          bullets: bullets.length > 0 ? bullets : ['Review this point for your monthly planning.'],
        };
      }

      const bullets = line
        .split(/\s*;\s*|\.\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 3);

      return {
        title: `Insight ${idx + 1}`,
        bullets: bullets.length > 0 ? bullets : [line],
      };
    });
  }, [insights]);

  const financialView = useMemo(() => {
    const debitTransactions = monthTransactions.filter(
      (item) => item.transaction_type !== 'credit'
    );
    const debitCount = debitTransactions.length;
    const daysWithSpend = new Set(
      debitTransactions.map((item) => format(new Date(item.date), 'yyyy-MM-dd'))
    ).size;
    const avgPerActiveDay = daysWithSpend > 0 ? totalSpending / daysWithSpend : 0;
    const netFlow = analytics.total_credit - totalSpending;

    const highestSpendDayEntry = Object.entries(analytics.daily_spending).sort(
      ([, a], [, b]) => b - a
    )[0];
    const highestSpendDay = highestSpendDayEntry
      ? {
          day: format(new Date(highestSpendDayEntry[0]), 'MMM d'),
          amount: highestSpendDayEntry[1],
        }
      : null;

    const previousMonth = monthOptions[1];
    let prevMonthDebit = 0;
    if (previousMonth) {
      prevMonthDebit = transactions
        .filter(
          (item) =>
            item.transaction_type !== 'credit' &&
            isWithinInterval(new Date(item.date), {
              start: previousMonth.start,
              end: previousMonth.end,
            })
        )
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    }

    const spendTrendPct =
      prevMonthDebit > 0 ? ((totalSpending - prevMonthDebit) / prevMonthDebit) * 100 : 0;

    return {
      debitCount,
      daysWithSpend,
      avgPerActiveDay,
      netFlow,
      highestSpendDay,
      spendTrendPct,
    };
  }, [analytics.daily_spending, analytics.total_credit, monthOptions, monthTransactions, totalSpending, transactions]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {variant === 'full' && (
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Analytics Story</Text>
              <Text style={styles.subtitle}>Month-wise spending trends and financial views</Text>
            </View>
            <View style={styles.headerBadge}>
              <Ionicons name="sparkles" size={16} color="#fff" />
              <Text style={styles.headerBadgeText}>AI</Text>
            </View>
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filtersRow}
          contentContainerStyle={styles.filtersRowContent}
        >
          {monthOptions.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.filterChip,
                selectedMonthKey === item.key && styles.filterChipActive,
              ]}
              onPress={() => setSelectedMonthKey(item.key)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  selectedMonthKey === item.key && styles.filterChipTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Total Spend</Text>
          <Text style={styles.heroValue}>{formatINR(totalSpending)}</Text>
          <Text style={styles.heroSubtext}>
            {analytics.transaction_count} transactions - Avg {formatINR(analytics.average_transaction)}
          </Text>
          <Text style={styles.heroSubtextCredit}>
            Credits this month: {formatINR(analytics.total_credit)}
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Amount vs Time</Text>
            <Text style={styles.sectionHint}>
              {selectedMonth ? `${selectedMonth.label} trend` : 'Selected month trend'}
            </Text>
          </View>
          <View style={styles.chartCard}>
            {dailyData.length === 0 ? (
              <Text style={styles.emptyText}>No daily spending data for this month.</Text>
            ) : (
              <LineChart
                data={dailyData}
                color="#33C27F"
                thickness={3}
                curved
                dataPointsColor="#7BF2BF"
                dataPointsRadius={3}
                areaChart
                startFillColor="rgba(51,194,127,0.30)"
                endFillColor="rgba(51,194,127,0.04)"
                hideRules={false}
                rulesColor="rgba(255,255,255,0.08)"
                showVerticalLines
                verticalLinesColor="rgba(255,255,255,0.06)"
                yAxisColor="#2a2a3e"
                xAxisColor="#2a2a3e"
                yAxisTextStyle={styles.chartAxisText}
                xAxisLabelTextStyle={styles.chartAxisText}
                isAnimated
                animationDuration={900}
                maxValue={Math.max(...dailyData.map((d) => d.value), 10)}
                noOfSections={4}
                spacing={26}
                initialSpacing={12}
                endSpacing={12}
              />
            )}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Category Breakdown</Text>
            <Text style={styles.sectionHint}>
              {selectedMonth ? `${selectedMonth.label} snapshot` : 'Selected month snapshot'}
            </Text>
          </View>
          <View style={styles.chartCard}>
            {categoryBars.length === 0 ? (
              <Text style={styles.emptyText}>No category data for this month.</Text>
            ) : (
              <BarChart
                data={categoryBars}
                barWidth={30}
                spacing={16}
                roundedTop
                hideRules={false}
                rulesColor="rgba(255,255,255,0.08)"
                yAxisColor="#2a2a3e"
                xAxisColor="#2a2a3e"
                yAxisTextStyle={styles.chartAxisText}
                xAxisLabelTextStyle={styles.chartAxisText}
                isAnimated
                animationDuration={900}
              />
            )}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Financial Views</Text>
            <Text style={styles.sectionHint}>Helpful monthly understanding</Text>
          </View>
          <View style={styles.financialGrid}>
            <View style={styles.financialCard}>
              <Text style={styles.financialLabel}>Net Cash Flow</Text>
              <Text
                style={[
                  styles.financialValue,
                  financialView.netFlow >= 0 ? styles.positiveValue : styles.negativeValue,
                ]}
              >
                {financialView.netFlow >= 0 ? '+' : '-'}
                {formatINR(Math.abs(financialView.netFlow))}
              </Text>
              <Text style={styles.financialMeta}>
                Credit {formatINR(analytics.total_credit)} vs Debit {formatINR(totalSpending)}
              </Text>
            </View>

            <View style={styles.financialCard}>
              <Text style={styles.financialLabel}>Spending Frequency</Text>
              <Text style={styles.financialValue}>{financialView.daysWithSpend} days</Text>
              <Text style={styles.financialMeta}>
                {financialView.debitCount} debit transactions this month
              </Text>
            </View>

            <View style={styles.financialCard}>
              <Text style={styles.financialLabel}>Burn Rate</Text>
              <Text style={styles.financialValue}>{formatINR(financialView.avgPerActiveDay)}</Text>
              <Text style={styles.financialMeta}>Average spend per active day</Text>
            </View>

            <View style={styles.financialCard}>
              <Text style={styles.financialLabel}>Trend vs Last Month</Text>
              <Text
                style={[
                  styles.financialValue,
                  financialView.spendTrendPct <= 0 ? styles.positiveValue : styles.negativeValue,
                ]}
              >
                {financialView.spendTrendPct >= 0 ? '+' : ''}
                {financialView.spendTrendPct.toFixed(1)}%
              </Text>
              <Text style={styles.financialMeta}>
                {financialView.highestSpendDay
                  ? `Highest day: ${financialView.highestSpendDay.day} (${formatINR(
                      financialView.highestSpendDay.amount
                    )})`
                  : 'No spending day yet'}
              </Text>
            </View>
          </View>
        </View>

        {insights && (
          <View style={styles.section}>
            <View style={styles.insightsHeader}>
              <Ionicons name="bulb" size={18} color="#FFD700" />
              <Text style={styles.sectionTitle}>AI Insights</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.insightCardsRow}
            >
              {insightCards.map((card, index) => (
                <View key={`${card.title}-${index}`} style={styles.insightCard}>
                  <View style={styles.insightCardHeader}>
                    <Ionicons name="sparkles-outline" size={14} color="#74d6ff" />
                    <Text style={styles.insightCardTitle}>{card.title}</Text>
                  </View>
                  {card.bullets.map((bullet, bulletIndex) => (
                    <View key={`${bullet}-${bulletIndex}`} style={styles.insightBulletRow}>
                      <Text style={styles.insightBulletDot}>•</Text>
                      <Text style={styles.insightBulletText}>{bullet}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
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
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 16 : 8,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#999',
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  headerBadgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  heroCard: {
    marginHorizontal: 24,
    marginBottom: 24,
    padding: 20,
    borderRadius: 18,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  filtersRow: {
    maxHeight: 44,
    marginBottom: 14,
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
  heroLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
  },
  heroValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  heroSubtext: {
    fontSize: 12,
    color: '#7f8ba3',
    marginTop: 8,
  },
  heroSubtextCredit: {
    fontSize: 12,
    color: '#4FC3F7',
    marginTop: 4,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  sectionHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  chartCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  chartAxisText: {
    color: '#7d849c',
    fontSize: 10,
  },
  emptyText: {
    color: '#999',
    fontSize: 13,
  },
  financialGrid: {
    gap: 10,
  },
  financialCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  financialLabel: {
    color: '#8f96ae',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  financialValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  financialMeta: {
    color: '#9aa0b4',
    fontSize: 12,
    lineHeight: 18,
  },
  positiveValue: {
    color: '#4FC3F7',
  },
  negativeValue: {
    color: '#FF6B6B',
  },
  insightsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  insightsCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  insightsText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 22,
  },
  insightCardsRow: {
    gap: 12,
    paddingRight: 24,
  },
  insightCard: {
    width: 285,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    padding: 14,
    gap: 8,
  },
  insightCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  insightCardTitle: {
    color: '#d6ecff',
    fontSize: 13,
    fontWeight: '700',
  },
  insightBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  insightBulletDot: {
    color: '#74d6ff',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  insightBulletText: {
    flex: 1,
    color: '#e6ebff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
