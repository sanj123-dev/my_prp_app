import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BarChart, LineChart, PieChart } from 'react-native-gifted-charts';
import { endOfMonth, format, isWithinInterval, startOfMonth, subMonths } from 'date-fns';
import { router } from 'expo-router';
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

type FinanceTermKey =
  | 'net_cash_flow'
  | 'burn_rate'
  | 'savings_rate'
  | 'spend_trend'
  | 'category_concentration';

type FinanceTermMeta = {
  label: string;
  meaning: string;
  whyItMatters: string;
  improveTip: string;
};

const FINANCE_TERMS: Record<FinanceTermKey, FinanceTermMeta> = {
  net_cash_flow: {
    label: 'Net Cash Flow',
    meaning: 'Income minus spending in the selected month.',
    whyItMatters: 'Positive cash flow means you are building financial room.',
    improveTip: 'Increase income or cut non-essential categories with highest spend.',
  },
  burn_rate: {
    label: 'Burn Rate',
    meaning: 'Average amount you spend per active spending day.',
    whyItMatters: 'Shows your day-to-day spending speed.',
    improveTip: 'Set a daily cap and review large transactions quickly.',
  },
  savings_rate: {
    label: 'Savings Rate',
    meaning: 'Percentage of income left after spending.',
    whyItMatters: 'Higher savings rate helps long-term stability and goals.',
    improveTip: 'Automate savings first, then spend from the remaining amount.',
  },
  spend_trend: {
    label: 'Spend Trend',
    meaning: 'How this month compares with last month in percentage terms.',
    whyItMatters: 'Detects if spending is improving or drifting higher.',
    improveTip: 'If trend is rising, focus on top 1-2 categories this week.',
  },
  category_concentration: {
    label: 'Category Concentration',
    meaning: 'How much of total spend is coming from your top category.',
    whyItMatters: 'High concentration often indicates one controllable money leak.',
    improveTip: 'Reduce top category by 10-15% and redirect to savings.',
  },
};

const CATEGORY_PALETTE = ['#33C27F', '#40A9FF', '#FFB547', '#FF7A9E', '#B38CFF', '#66D0D6'];

const formatCompactAmount = (value: number) => {
  const amount = Math.abs(Number(value || 0));
  if (amount >= 10000000) return `${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return `${amount.toFixed(0)}`;
};

const formatKAmount = (value: number) => {
  const amount = Math.abs(Number(value || 0));
  if (amount >= 1000) {
    const k = amount / 1000;
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `${amount.toFixed(0)}`;
};

export default function AnalyticsPanel({ variant = 'full' }: AnalyticsPanelProps) {
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [insights, setInsights] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [selectedMonthKey, setSelectedMonthKey] = useState(
    format(new Date(), 'yyyy-MM')
  );
  const [activeTerm, setActiveTerm] = useState<FinanceTermKey | null>(null);

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
      .map(([dateKey, value]) => {
        return {
        value: Number(value.toFixed(2)),
          label: format(new Date(dateKey), 'd'),
          dayLabel: format(new Date(dateKey), 'MMM d'),
        };
      });
  }, [analytics.daily_spending]);

  const lineChartMax = useMemo(
    () => Math.max(...dailyData.map((item) => Number(item.value || 0)), 0),
    [dailyData]
  );

  const lineYAxisLabels = useMemo(() => {
    if (lineChartMax <= 0) return ['0', '0', '0', '0', '0'];
    const sections = 4;
    return Array.from({ length: sections + 1 }, (_, idx) => {
      const val = (lineChartMax / sections) * idx;
      return formatKAmount(val);
    });
  }, [lineChartMax]);

  const linePeak = useMemo(() => {
    if (!dailyData.length) return null;
    return dailyData.reduce((top, item) => (item.value > top.value ? item : top), dailyData[0]);
  }, [dailyData]);

  const categoryBars = useMemo(() => {
    return Object.entries(analytics.categories)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([category, value], index) => ({
        value: Number(value.toFixed(2)),
        label: category.length > 9 ? `${category.slice(0, 9)}...` : category,
        frontColor: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
        fullLabel: category,
      }));
  }, [analytics.categories]);

  const categoryBarMax = useMemo(
    () => Math.max(...categoryBars.map((item) => Number(item.value || 0)), 0),
    [categoryBars]
  );

  const categoryPieData = useMemo(() => {
    const sorted = Object.entries(analytics.categories).sort(([, a], [, b]) => b - a);
    if (!sorted.length) return [];
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((sum, [, value]) => sum + Number(value || 0), 0);
    const slices = top.map(([category, value], index) => ({
      value: Number(Number(value || 0).toFixed(2)),
      text: category,
      color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
    }));
    if (rest > 0) {
      slices.push({
        value: Number(rest.toFixed(2)),
        text: 'Other',
        color: '#7b8aa8',
      });
    }
    return slices;
  }, [analytics.categories]);

  const categoryPieTotal = useMemo(
    () => categoryPieData.reduce((sum, slice) => sum + Number(slice.value || 0), 0),
    [categoryPieData]
  );

  const barYAxisLabels = useMemo(() => {
    const max = categoryBarMax;
    if (max <= 0) return ['0', '0', '0', '0', '0'];
    const sections = 4;
    return Array.from({ length: sections + 1 }, (_, idx) => {
      const val = (max / sections) * idx;
      return formatCompactAmount(val);
    });
  }, [categoryBarMax]);

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
    const savingsRate =
      analytics.total_credit > 0
        ? ((analytics.total_credit - totalSpending) / analytics.total_credit) * 100
        : 0;
    const sortedCategories = Object.entries(analytics.categories).sort(([, a], [, b]) => b - a);
    const topCategorySharePct =
      totalSpending > 0 && sortedCategories.length > 0
        ? (Number(sortedCategories[0][1]) / totalSpending) * 100
        : 0;
    const topCategoryName = sortedCategories.length > 0 ? String(sortedCategories[0][0]) : '';

    return {
      avgPerActiveDay,
      netFlow,
      highestSpendDay,
      spendTrendPct,
      savingsRate,
      topCategorySharePct,
      topCategoryName,
    };
  }, [analytics.categories, analytics.daily_spending, analytics.total_credit, monthOptions, monthTransactions, totalSpending, transactions]);

  const smartActions = useMemo(() => {
    const actions: string[] = [];
    if (financialView.spendTrendPct > 8) {
      actions.push('Your spending is rising vs last month. Freeze non-essential spends for 7 days.');
    } else if (financialView.spendTrendPct < -5) {
      actions.push('Great trend improvement. Move part of this surplus into savings now.');
    }

    if (financialView.savingsRate < 20) {
      actions.push('Savings rate is below 20%. Set an auto-transfer right after salary credit.');
    } else {
      actions.push('Savings rate looks healthy. Maintain this pace and avoid category spikes.');
    }

    if (financialView.topCategorySharePct > 35 && financialView.topCategoryName) {
      actions.push(
        `${financialView.topCategoryName} drives ${financialView.topCategorySharePct.toFixed(0)}% of spend. Cut this by 10% for fastest impact.`
      );
    }

    if (actions.length === 0) {
      actions.push('Spending is stable. Keep weekly check-ins and preserve current discipline.');
    }
    return actions.slice(0, 3);
  }, [financialView.savingsRate, financialView.spendTrendPct, financialView.topCategoryName, financialView.topCategorySharePct]);

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
            <View style={styles.headerRight}>
              <View style={styles.headerBadge}>
                <Ionicons name="sparkles" size={16} color="#fff" />
                <Text style={styles.headerBadgeText}>AI</Text>
              </View>
              <TouchableOpacity
                style={styles.headerProfileButton}
                onPress={() => router.push('/(tabs)/profile')}
              >
                <Ionicons name="person-circle-outline" size={24} color="#fff" />
              </TouchableOpacity>
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
          <View style={styles.heroKpiRow}>
            <View style={styles.heroKpiPill}>
              <Text style={styles.heroKpiLabel}>Savings Rate</Text>
              <Text
                style={[
                  styles.heroKpiValue,
                  financialView.savingsRate >= 0 ? styles.positiveValue : styles.negativeValue,
                ]}
              >
                {financialView.savingsRate.toFixed(1)}%
              </Text>
            </View>
            <View style={styles.heroKpiPill}>
              <Text style={styles.heroKpiLabel}>Top Category Share</Text>
              <Text style={styles.heroKpiValue}>{financialView.topCategorySharePct.toFixed(0)}%</Text>
            </View>
          </View>
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
                yAxisLabelTexts={lineYAxisLabels}
                isAnimated
                animationDuration={900}
                maxValue={lineChartMax > 0 ? lineChartMax * 1.12 : 10}
                noOfSections={4}
                spacing={26}
                initialSpacing={12}
                endSpacing={12}
              />
            )}
          </View>
          {dailyData.length > 0 && (
            <View style={styles.graphExplainCard}>
              <Text style={styles.graphExplainAxis}>
                X-axis: Day of month | Y-axis: Spend amount (K)
              </Text>
              <Text style={styles.graphExplainText}>
                Peak spend {linePeak?.dayLabel ? `on ${linePeak.dayLabel}` : ''}:{' '}
                {linePeak ? formatINR(linePeak.value) : formatINR(0)}. Daily average:{' '}
                {formatINR(financialView.avgPerActiveDay)}.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Category Breakdown</Text>
            <Text style={styles.sectionHint}>
              {selectedMonth ? `${selectedMonth.label} snapshot` : 'Selected month snapshot'}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChartsRow}>
            <View style={[styles.chartCard, styles.categoryChartCard]}>
              <Text style={styles.chartCardTitle}>Category Spend (Bar)</Text>
              {categoryBars.length === 0 ? (
                <Text style={styles.emptyText}>No category data for this month.</Text>
              ) : (
                <View style={styles.barChartWrap}>
                  <BarChart
                    data={categoryBars}
                    barWidth={28}
                    spacing={20}
                    roundedTop
                    height={220}
                    hideRules={false}
                    rulesColor="rgba(255,255,255,0.08)"
                    yAxisColor="#2a2a3e"
                    xAxisColor="#2a2a3e"
                    yAxisTextStyle={styles.chartAxisText}
                    xAxisLabelTextStyle={styles.chartAxisText}
                    yAxisLabelTexts={barYAxisLabels}
                    noOfSections={4}
                    isAnimated
                    animationDuration={900}
                    maxValue={categoryBarMax > 0 ? categoryBarMax * 1.12 : 10}
                  />
                </View>
              )}
              {categoryBars.length > 0 && (
                <View style={styles.barLegendWrap}>
                  {categoryBars.map((bar, idx) => (
                    <View key={`${bar.fullLabel}-${idx}`} style={styles.barLegendItem}>
                      <View style={[styles.pieLegendDot, { backgroundColor: bar.frontColor }]} />
                      <Text style={styles.barLegendName} numberOfLines={1}>
                        {bar.fullLabel}
                      </Text>
                      <Text style={styles.barLegendAmount}>{formatINR(Number(bar.value || 0))}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.chartCard, styles.categoryChartCard]}>
              <Text style={styles.chartCardTitle}>Category Share (Pie)</Text>
              {categoryPieData.length === 0 ? (
                <Text style={styles.emptyText}>No category data for this month.</Text>
              ) : (
                <>
                  <View style={styles.pieWrap}>
                    <PieChart
                      data={categoryPieData}
                      donut
                      radius={86}
                      innerRadius={54}
                      innerCircleColor="#101a31"
                      focusOnPress
                    />
                    <View style={styles.pieCenterBadge}>
                      <Text style={styles.pieCenterLabel}>TOTAL SPEND</Text>
                      <Text style={styles.pieCenterValue}>Rs {formatCompactAmount(categoryPieTotal)}</Text>
                      <Text style={styles.pieCenterSubValue}>{formatINR(categoryPieTotal)}</Text>
                    </View>
                  </View>
                  <View style={styles.pieLegendWrap}>
                    {categoryPieData.map((slice) => (
                      <View key={`${slice.text}-${slice.value}`} style={styles.pieLegendItem}>
                        <View style={[styles.pieLegendDot, { backgroundColor: slice.color }]} />
                        <Text style={styles.pieLegendText}>
                          {slice.text} {categoryPieTotal > 0
                            ? `(${((Number(slice.value || 0) / categoryPieTotal) * 100).toFixed(0)}%)`
                            : '(0%)'}
                        </Text>
                        <Text style={styles.pieLegendAmount}>
                          {formatINR(Number(slice.value || 0))}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>
          </ScrollView>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Financial Views</Text>
            <Text style={styles.sectionHint}>Helpful monthly understanding</Text>
          </View>
          <View style={styles.financialGrid}>
            <View style={styles.financialCard}>
              <View style={styles.termLabelRow}>
                <Text style={styles.financialLabel}>Net Cash Flow</Text>
                <TouchableOpacity onPress={() => setActiveTerm('net_cash_flow')}>
                  <Ionicons name="information-circle-outline" size={16} color="#90b3ff" />
                </TouchableOpacity>
              </View>
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
              <View style={styles.termLabelRow}>
                <Text style={styles.financialLabel}>Burn Rate</Text>
                <TouchableOpacity onPress={() => setActiveTerm('burn_rate')}>
                  <Ionicons name="information-circle-outline" size={16} color="#90b3ff" />
                </TouchableOpacity>
              </View>
              <Text style={styles.financialValue}>{formatINR(financialView.avgPerActiveDay)}</Text>
              <Text style={styles.financialMeta}>Average spend per active day</Text>
            </View>

            <View style={styles.financialCard}>
              <View style={styles.termLabelRow}>
                <Text style={styles.financialLabel}>Trend vs Last Month</Text>
                <TouchableOpacity onPress={() => setActiveTerm('spend_trend')}>
                  <Ionicons name="information-circle-outline" size={16} color="#90b3ff" />
                </TouchableOpacity>
              </View>
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

            <View style={styles.financialCard}>
              <View style={styles.termLabelRow}>
                <Text style={styles.financialLabel}>Category Concentration</Text>
                <TouchableOpacity onPress={() => setActiveTerm('category_concentration')}>
                  <Ionicons name="information-circle-outline" size={16} color="#90b3ff" />
                </TouchableOpacity>
              </View>
              <Text style={styles.financialValue}>{financialView.topCategorySharePct.toFixed(0)}%</Text>
              <Text style={styles.financialMeta}>
                Share of spend from your top category
              </Text>
            </View>

            <View style={styles.financialCard}>
              <View style={styles.termLabelRow}>
                <Text style={styles.financialLabel}>Savings Rate</Text>
                <TouchableOpacity onPress={() => setActiveTerm('savings_rate')}>
                  <Ionicons name="information-circle-outline" size={16} color="#90b3ff" />
                </TouchableOpacity>
              </View>
              <Text
                style={[
                  styles.financialValue,
                  financialView.savingsRate >= 0 ? styles.positiveValue : styles.negativeValue,
                ]}
              >
                {financialView.savingsRate.toFixed(1)}%
              </Text>
              <Text style={styles.financialMeta}>
                Portion of income left after this month&apos;s spend
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>What To Do Next</Text>
            <Text style={styles.sectionHint}>Personalized actions to save more</Text>
          </View>
          <View style={styles.actionCard}>
            {smartActions.map((tip, idx) => (
              <View key={`${tip}-${idx}`} style={styles.actionRow}>
                <View style={styles.actionDot} />
                <Text style={styles.actionText}>{tip}</Text>
              </View>
            ))}
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

      <Modal visible={!!activeTerm} transparent animationType="fade" onRequestClose={() => setActiveTerm(null)}>
        <View style={styles.termModalOverlay}>
          <View style={styles.termModalCard}>
            <View style={styles.termModalHeader}>
              <Text style={styles.termModalTitle}>
                {activeTerm ? FINANCE_TERMS[activeTerm].label : 'Finance term'}
              </Text>
              <TouchableOpacity onPress={() => setActiveTerm(null)}>
                <Ionicons name="close-circle" size={24} color="#b9c9f0" />
              </TouchableOpacity>
            </View>
            {activeTerm && (
              <>
                <Text style={styles.termModalText}>
                  <Text style={styles.termModalKey}>Meaning: </Text>
                  {FINANCE_TERMS[activeTerm].meaning}
                </Text>
                <Text style={styles.termModalText}>
                  <Text style={styles.termModalKey}>Why it matters: </Text>
                  {FINANCE_TERMS[activeTerm].whyItMatters}
                </Text>
                <Text style={styles.termModalText}>
                  <Text style={styles.termModalKey}>How to improve: </Text>
                  {FINANCE_TERMS[activeTerm].improveTip}
                </Text>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerProfileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2946',
    borderWidth: 1,
    borderColor: '#314272',
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
  heroKpiRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  heroKpiPill: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30456e',
    backgroundColor: '#141f35',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  heroKpiLabel: {
    color: '#89a2d1',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 3,
  },
  heroKpiValue: {
    color: '#f2f8ff',
    fontSize: 14,
    fontWeight: '800',
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
    overflow: 'visible',
  },
  categoryChartsRow: {
    gap: 12,
    paddingRight: 24,
  },
  categoryChartCard: {
    width: 352,
  },
  chartCardTitle: {
    color: '#d9e4ff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  barChartWrap: {
    paddingTop: 14,
    overflow: 'visible',
  },
  chartTooltip: {
    backgroundColor: '#101b32',
    borderWidth: 1,
    borderColor: '#2c4372',
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
    maxWidth: 170,
  },
  chartTooltipTitle: {
    color: '#c6d8ff',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  chartTooltipValue: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  pieWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    paddingVertical: 8,
    position: 'relative',
  },
  pieCenterBadge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101a31',
    borderWidth: 1,
    borderColor: '#2f436f',
    borderRadius: 999,
    minWidth: 106,
    minHeight: 106,
    paddingHorizontal: 10,
    zIndex: 2,
    elevation: 2,
  },
  pieCenterLabel: {
    color: '#8ea4cf',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  pieCenterValue: {
    color: '#f5f9ff',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 4,
  },
  pieCenterSubValue: {
    color: '#c9d8f7',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  pieLegendWrap: {
    gap: 9,
  },
  pieLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: '#2c3b62',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#14213d',
  },
  pieLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pieLegendText: {
    color: '#d9e5ff',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  pieLegendAmount: {
    color: '#f7fbff',
    fontSize: 11,
    fontWeight: '800',
  },
  chartAxisText: {
    color: '#7d849c',
    fontSize: 10,
  },
  graphExplainCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#2a3f6a',
    borderRadius: 12,
    backgroundColor: '#12203a',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  graphExplainAxis: {
    color: '#9fc3ff',
    fontSize: 11,
    fontWeight: '700',
  },
  graphExplainText: {
    color: '#dce8ff',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  barLegendWrap: {
    marginTop: 12,
    gap: 8,
  },
  barLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#2c3b62',
    borderRadius: 10,
    backgroundColor: '#14213d',
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  barLegendName: {
    flex: 1,
    color: '#d9e5ff',
    fontSize: 11,
    fontWeight: '600',
  },
  barLegendAmount: {
    color: '#f5f9ff',
    fontSize: 11,
    fontWeight: '800',
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
  termLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
    gap: 8,
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
  actionCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  actionDot: {
    marginTop: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#33C27F',
  },
  actionText: {
    flex: 1,
    color: '#dfe8ff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  termModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  termModalCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2f436f',
    backgroundColor: '#101a31',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  termModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  termModalTitle: {
    color: '#f1f6ff',
    fontSize: 18,
    fontWeight: '800',
  },
  termModalText: {
    color: '#d2def8',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  termModalKey: {
    color: '#9cc2ff',
    fontWeight: '800',
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
