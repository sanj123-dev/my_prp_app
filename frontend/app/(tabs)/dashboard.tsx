import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  RefreshControl,
  Linking,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { endOfMonth, format, isSameDay, isWithinInterval, startOfMonth } from 'date-fns';
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

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const FIRST_RUN_COMPLETE_KEY = 'firstRunComplete';
const LIVE_SMS_SYNC_INTERVAL_MS = 45000;

type FinancialNewsItem = {
  title: string;
  summary: string;
  source: string;
  link: string;
  published_at?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
};

type TransactionItem = {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  bank_name?: string;
  account_mask?: string;
  source?: string;
  transaction_type?: 'credit' | 'debit' | 'self_transfer';
};

type InsightCard = {
  title: string;
  bullets: string[];
};

type CategorySpendCard = {
  category: string;
  amount: number;
  percent: number;
};

type BankCardSummary = {
  bankName: string;
  last4: string;
  totalDebit: number;
  totalCredit: number;
  txCount: number;
};

const CATEGORY_GRADIENTS = [
  ['#1f4b99', '#17356d'],
  ['#8a2f6e', '#5a1d46'],
  ['#1a6d64', '#0f4a43'],
  ['#91512b', '#6a3a1f'],
  ['#5754c9', '#3d3ba4'],
  ['#2d6b7e', '#204c59'],
] as const;

const BANK_GRADIENTS = [
  ['#22305a', '#1a2442'],
  ['#2c3f67', '#1c2946'],
  ['#273a6f', '#1a2a4f'],
  ['#32416c', '#222e53'],
] as const;

const FALLBACK_FINANCIAL_NEWS: FinancialNewsItem[] = [
  {
    title: 'Markets hold steady as investors assess inflation and rate signals',
    summary:
      'Global equity benchmarks moved in a narrow range as investors reviewed fresh inflation commentary and central bank guidance. Analysts said risk appetite remained constructive, though short term volatility may persist. Portfolio strategy notes continued to favor diversified exposure, quality earnings, and disciplined cash flow management in uncertain macro conditions.',
    source: 'SpendWise Feed',
    link: 'https://www.reuters.com/markets/',
    sentiment: 'positive',
  },
  {
    title: 'Tech and financial sectors lead selective gains in late session trading',
    summary:
      'Large cap technology and financial stocks outperformed in late trading, supported by resilient earnings expectations and improving liquidity cues. Market observers highlighted selective rotation rather than broad risk on momentum. For retail investors, advisors recommended staying focused on asset allocation targets and avoiding concentrated bets during headline driven swings.',
    source: 'SpendWise Feed',
    link: 'https://finance.yahoo.com/',
    sentiment: 'neutral',
  },
];

export default function Dashboard() {
  const [insights, setInsights] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [allTransactions, setAllTransactions] = useState<TransactionItem[]>([]);
  const [todayTransactions, setTodayTransactions] = useState<TransactionItem[]>([]);
  const [news, setNews] = useState<FinancialNewsItem[]>([]);
  const [showSetupProgress, setShowSetupProgress] = useState(false);
  const [setupProgress, setSetupProgress] = useState(0);
  const [smsSyncInProgress, setSmsSyncInProgress] = useState(false);
  const [smsSyncStatusText, setSmsSyncStatusText] = useState(
    'Reading your SMS transactions...'
  );
  const [smsReadCount, setSmsReadCount] = useState(0);
  const [smsImportedCount, setSmsImportedCount] = useState(0);
  const [smsProgressPercent, setSmsProgressPercent] = useState(0);
  const liveSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadDataRef = useRef<() => Promise<void>>(async () => {});
  const realtimeCleanupRef = useRef<(() => void) | null>(null);
  const realtimeStartedForRef = useRef('');

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

  const loadData = async () => {
    if (!loading) {
      setRefreshing(true);
    }
    try {
      const savedUserId = await AsyncStorage.getItem('userId');
      if (savedUserId) {
        if (realtimeStartedForRef.current !== savedUserId) {
          realtimeCleanupRef.current?.();
          const cleanup = await startRealtimeSmsSync({
            userId: savedUserId,
            onTransactionsCreated: (items) => {
              if (items && items.length > 0) {
                void fetchAllTransactions(savedUserId);
              }
            },
          });
          realtimeCleanupRef.current = cleanup;
          realtimeStartedForRef.current = savedUserId;
        }

        const firstRunComplete = await AsyncStorage.getItem(FIRST_RUN_COMPLETE_KEY);
        const isFirstRun = !firstRunComplete;

        if (isFirstRun) {
          setShowSetupProgress(true);
          setSetupProgress(12);
        }

        await fetchAllTransactions(savedUserId);
        if (isFirstRun) setSetupProgress(40);

        await fetchInsights(savedUserId);
        if (isFirstRun) setSetupProgress(62);

        await fetchFinancialNews();
        if (isFirstRun) setSetupProgress(78);

        await bootstrapSmsFlow(savedUserId, isFirstRun);

        if (isFirstRun) {
          setSetupProgress(100);
          await AsyncStorage.setItem(FIRST_RUN_COMPLETE_KEY, 'true');
          setTimeout(() => setShowSetupProgress(false), 900);
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  loadDataRef.current = loadData;

  useFocusEffect(
    React.useCallback(() => {
      void loadDataRef.current();
    }, [])
  );

  async function bootstrapSmsFlow(uid: string, isFirstRun: boolean) {
    try {
      const authTrigger = await getSmsAuthTrigger();
      if (authTrigger === 'signup' || authTrigger === 'login') {
        setSmsSyncInProgress(true);
        setSmsSyncStatusText('Reading your SMS transactions...');
        setSmsReadCount(0);
        setSmsImportedCount(0);
        setSmsProgressPercent(4);
        const createdCount = await syncSmsTransactions({
          userId: uid,
          mode: authTrigger,
          requestPermission: true,
          onProgress: (progress) => {
            setSmsReadCount(progress.scannedCount);
            setSmsImportedCount(progress.importedCount);
            const pct = Math.max(
              6,
              Math.min(90, Math.round(((progress.page + 1) / progress.maxPages) * 100))
            );
            setSmsProgressPercent(pct);
          },
        });
        await clearSmsAuthTrigger();

        if (isFirstRun) {
          setSetupProgress(92);
        }

        if (createdCount > 0) {
          setSmsSyncStatusText('Processing SMS and updating your dashboard...');
          await fetchAllTransactions(uid);
        }
        setSmsProgressPercent(100);
      }

      if (!liveSyncIntervalRef.current) {
        liveSyncIntervalRef.current = setInterval(() => {
          void syncSmsTransactions({
            userId: uid,
            mode: 'live',
          }).then((createdCount) => {
            if (createdCount > 0) {
              void fetchAllTransactions(uid);
            }
          });
        }, LIVE_SMS_SYNC_INTERVAL_MS);
      }
    } catch (error) {
      console.error('Error bootstrapping SMS flow:', error);
    } finally {
      setSmsSyncInProgress(false);
    }
  }

  const fetchAllTransactions = async (uid: string) => {
    try {
      const response = await axios.get(
        `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${uid}?limit=500`
      );
      const items = response.data || [];
      setAllTransactions(items);
      const today = items.filter((t: TransactionItem) =>
        isSameDay(new Date(t.date), new Date())
      );
      setTodayTransactions(today);
    } catch (error) {
      console.error('Error fetching monthly transactions:', error);
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

  const fetchFinancialNews = async () => {
    try {
      const response = await axios.get(
        `${EXPO_PUBLIC_BACKEND_URL}/api/news/financial?limit=12`
      );
      setNews(response.data || []);
    } catch (error) {
      console.error('Error fetching financial news:', error);
      setNews(FALLBACK_FINANCIAL_NEWS);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    void loadData();
  };

  const positiveNews = useMemo(
    () => news.find((item) => item.sentiment === 'positive') || news[0],
    [news]
  );

  const currentMonthTransactions = useMemo(() => {
    const now = new Date();
    return allTransactions.filter((t) =>
      isWithinInterval(new Date(t.date), {
        start: startOfMonth(now),
        end: endOfMonth(now),
      })
    );
  }, [allTransactions]);

  const totalDebit = useMemo(
    () =>
      currentMonthTransactions.reduce(
        (sum, item) =>
          sum + (item.transaction_type === 'credit' ? 0 : Number(item.amount || 0)),
        0
      ),
    [currentMonthTransactions]
  );

  const totalCredit = useMemo(
    () =>
      currentMonthTransactions.reduce(
        (sum, item) =>
          sum + (item.transaction_type === 'credit' ? Number(item.amount || 0) : 0),
        0
      ),
    [currentMonthTransactions]
  );

  const totalSpending = totalDebit;
  const debitCount = currentMonthTransactions.filter(
    (item) => item.transaction_type !== 'credit'
  ).length;
  const avgTransaction = debitCount > 0 ? totalDebit / debitCount : 0;

  const categorySpendCards = useMemo<CategorySpendCard[]>(() => {
    const buckets = currentMonthTransactions.reduce((acc: Record<string, number>, t: TransactionItem) => {
      if (t.transaction_type === 'credit') return acc;
      const key = String(t.category || 'Other');
      acc[key] = (acc[key] || 0) + Number(t.amount || 0);
      return acc;
    }, {});

    return Object.entries(buckets)
      .map(([category, amount]) => ({
        category,
        amount: Number(amount || 0),
        percent: totalSpending > 0 ? (Number(amount || 0) / totalSpending) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
  }, [currentMonthTransactions]);

  const bankCards = useMemo<BankCardSummary[]>(() => {
    const extractLast4 = (mask?: string) => {
      const digits = String(mask || '').replace(/\D/g, '');
      return digits.length > 0 ? digits.slice(-4) : '0000';
    };

    const bucket = new Map<string, BankCardSummary>();
    for (const tx of currentMonthTransactions) {
      const bankName = String(tx.bank_name || 'Bank').trim() || 'Bank';
      const last4 = extractLast4(tx.account_mask);
      const key = `${bankName.toLowerCase()}|${last4}`;
      const current = bucket.get(key) || {
        bankName,
        last4,
        totalDebit: 0,
        totalCredit: 0,
        txCount: 0,
      };
      const amount = Number(tx.amount || 0);
      if (tx.transaction_type === 'credit') {
        current.totalCredit += amount;
      } else {
        current.totalDebit += amount;
      }
      current.txCount += 1;
      bucket.set(key, current);
    }

    return Array.from(bucket.values())
      .sort((a, b) => b.totalDebit + b.totalCredit - (a.totalDebit + a.totalCredit))
      .slice(0, 8);
  }, [currentMonthTransactions]);

  const getCategoryIcon = (category: string) => {
    const key = String(category || '').toLowerCase();
    if (key.includes('food') || key.includes('grocer')) return 'restaurant-outline';
    if (key.includes('shop')) return 'bag-handle-outline';
    if (key.includes('transport') || key.includes('travel')) return 'car-outline';
    if (key.includes('bill') || key.includes('utility')) return 'receipt-outline';
    if (key.includes('medical') || key.includes('health')) return 'medkit-outline';
    if (key.includes('entertain')) return 'film-outline';
    if (key.includes('transfer')) return 'swap-horizontal-outline';
    return 'pricetag-outline';
  };

  const insightCards = useMemo<InsightCard[]>(() => {
    const raw = (insights || '').trim();
    if (!raw) return [];

    const primaryParts = raw
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean);

    const normalizedParts = (primaryParts.length > 1 ? primaryParts : raw.split(/\.\s+/))
      .map((part) => part.replace(/^[-*•\d\)\.(\s]+/, '').trim())
      .filter(Boolean);

    return normalizedParts.slice(0, 6).map((part, idx) => {
      const titleMatch = part.match(/^([^:]{4,40}):\s*(.*)$/);
      if (titleMatch) {
        const title = titleMatch[1].trim();
        const detail = titleMatch[2].trim();
        const bullets = detail
          ? detail
              .split(/\s*;\s*|\.\s+/)
              .map((line) => line.trim())
              .filter(Boolean)
              .slice(0, 3)
          : [];
        return {
          title,
          bullets: bullets.length > 0 ? bullets : ['Review this insight in your recent spend.'],
        };
      }

      const bullets = part
        .split(/\s*;\s*|\.\s+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3);

      return {
        title: `Insight ${idx + 1}`,
        bullets: bullets.length > 0 ? bullets : [part],
      };
    });
  }, [insights]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </SafeAreaView>
    );
  }

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

        {showSetupProgress && (
          <View style={styles.setupCard}>
            <View style={styles.setupHeader}>
              <Ionicons name="sync-outline" size={16} color="#4CAF50" />
              <Text style={styles.setupTitle}>Setting up your account</Text>
            </View>
            <Text style={styles.setupSubtitle}>
              Syncing SMS and preparing your first dashboard.
            </Text>
            <View style={styles.setupProgressTrack}>
              <View style={[styles.setupProgressFill, { width: `${setupProgress}%` }]} />
            </View>
          </View>
        )}

        <View style={styles.statsContainer}>
          <LinearGradient
            colors={['#2b5db6', '#21488f', '#193668']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.statCard, styles.primaryCard]}
          >
            <View style={styles.heroTopRow}>
              <View style={styles.heroBadge}>
                <Ionicons name="wallet-outline" size={16} color="#deebff" />
                <Text style={styles.heroBadgeText}>This month</Text>
              </View>
              <Text style={styles.heroNetText}>
                Net {formatINR(totalCredit - totalDebit)}
              </Text>
            </View>
            <Text style={styles.statValue}>{formatINR(totalSpending)}</Text>
            <Text style={styles.statLabel}>Total Debit Spend</Text>
          </LinearGradient>

          <View style={styles.statsRow}>
            <View style={[styles.smallStatCard, styles.smallStatCardBlue]}>
              <Ionicons name="arrow-up-circle-outline" size={20} color="#88dcff" />
              <Text style={styles.smallStatValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                {formatINR(totalCredit)}
              </Text>
              <Text style={styles.smallStatLabel}>Total Credit</Text>
            </View>

            <View style={[styles.smallStatCard, styles.smallStatCardViolet]}>
              <Ionicons name="trending-up" size={20} color="#ffd37d" />
              <Text style={styles.smallStatValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                {formatINR(avgTransaction)}
              </Text>
              <Text style={styles.smallStatLabel}>Avg Debit</Text>
            </View>
          </View>
        </View>

        {categorySpendCards.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Spending by Category</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryCardsRow}
            >
              {categorySpendCards.map((item, index) => (
                <LinearGradient
                  key={`${item.category}-${index}`}
                  colors={CATEGORY_GRADIENTS[index % CATEGORY_GRADIENTS.length]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.categorySpendCard}
                >
                  <View style={styles.categoryCardTop}>
                    <View style={styles.categoryIconWrap}>
                      <Ionicons name={getCategoryIcon(item.category) as any} size={16} color="#e7f1ff" />
                    </View>
                    <Text style={styles.categoryPercentBadge}>{item.percent.toFixed(0)}%</Text>
                  </View>
                  <Text style={styles.categorySpendName} numberOfLines={1}>
                    {item.category}
                  </Text>
                  <Text style={styles.categorySpendAmount}>{formatINR(item.amount)}</Text>
                  <View style={styles.categoryMeterTrack}>
                    <View style={[styles.categoryMeterFill, { width: `${Math.min(item.percent, 100)}%` }]} />
                  </View>
                </LinearGradient>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Bank Cards</Text>
            <Text style={styles.bankSubLabel}>Credit and debit totals</Text>
          </View>
          {bankCards.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyCardText}>No bank-linked transactions found for this month.</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bankCardsRow}>
              {bankCards.map((card, index) => (
                <LinearGradient
                  key={`${card.bankName}-${card.last4}-${index}`}
                  colors={BANK_GRADIENTS[index % BANK_GRADIENTS.length]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.bankCard}
                >
                  <View style={styles.bankCardTop}>
                    <View>
                      <Text style={styles.bankNameText} numberOfLines={1}>{card.bankName}</Text>
                      <Text style={styles.bankMaskText}>A/C ••••{card.last4}</Text>
                    </View>
                    <View style={styles.bankTxPill}>
                      <Text style={styles.bankTxPillText}>{card.txCount} txns</Text>
                    </View>
                  </View>
                  <View style={styles.bankTotalsRow}>
                    <View>
                      <Text style={styles.bankLabel}>Debit</Text>
                      <Text style={styles.bankDebitValue}>{formatINR(card.totalDebit)}</Text>
                    </View>
                    <View>
                      <Text style={styles.bankLabel}>Credit</Text>
                      <Text style={styles.bankCreditValue}>{formatINR(card.totalCredit)}</Text>
                    </View>
                  </View>
                </LinearGradient>
              ))}
            </ScrollView>
          )}
        </View>

        {insights && (
          <View style={styles.section}>
            <View style={styles.insightsHeader}>
              <Ionicons name="bulb" size={20} color="#FFD700" />
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

        {news.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Financial News</Text>
              <TouchableOpacity onPress={() => router.push('/news')}>
                <Text style={styles.linkText}>View more</Text>
              </TouchableOpacity>
            </View>

            {positiveNews && (
              <View style={styles.newsInsightCard}>
                <View style={styles.newsInsightHeader}>
                  <Ionicons name="trending-up-outline" size={16} color="#4CAF50" />
                  <Text style={styles.newsInsightTitle}>Good News Insight</Text>
                </View>
                <Text style={styles.newsInsightText} numberOfLines={3}>
                  {positiveNews.title}
                </Text>
              </View>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.newsRow}
            >
              {news.slice(0, 6).map((item) => (
                <TouchableOpacity
                  key={item.link}
                  style={styles.newsCard}
                  activeOpacity={0.9}
                  onPress={() => void Linking.openURL(item.link)}
                >
                  <Text style={styles.newsSource}>{item.source}</Text>
                  <Text style={styles.newsTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.newsSummary} numberOfLines={5}>
                    {item.summary}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Today</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/transactions')}>
              <Text style={styles.linkText}>View all</Text>
            </TouchableOpacity>
          </View>
          {todayTransactions.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyCardText}>
                No transactions today. Keep the momentum going.
              </Text>
            </View>
          ) : (
            todayTransactions.slice(0, 3).map((t) => (
              <View key={t.id} style={styles.transactionRow}>
                <View style={styles.transactionMeta}>
                  <Text style={styles.transactionTitle}>{t.category}</Text>
                  <Text style={styles.transactionSubtitle} numberOfLines={1}>
                    {t.description}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.transactionAmount,
                    t.transaction_type === 'credit' && styles.transactionAmountCredit,
                  ]}
                >
                  {t.transaction_type === 'credit' ? '+' : '-'}
                  {formatINR(Number(t.amount))}
                </Text>
              </View>
            ))
          )}
        </View>

      </ScrollView>

      <Modal visible={smsSyncInProgress} transparent animationType="fade">
        <View style={styles.smsLoaderOverlay}>
          <View style={styles.smsLoaderCard}>
            <ActivityIndicator size="large" color="#4CAF50" />
            <Text style={styles.smsLoaderTitle}>Syncing SMS</Text>
            <Text style={styles.smsLoaderText}>{smsSyncStatusText}</Text>
            <View style={styles.smsProgressTrack}>
              <View style={[styles.smsProgressFill, { width: `${smsProgressPercent}%` }]} />
            </View>
            <View style={styles.smsCountersRow}>
              <Text style={styles.smsCounterText}>Read: {smsReadCount}</Text>
              <Text style={styles.smsCounterText}>Imported: {smsImportedCount}</Text>
            </View>
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
  setupCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    marginHorizontal: 24,
    marginBottom: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  setupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  setupTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  setupSubtitle: {
    color: '#999',
    fontSize: 12,
    marginBottom: 10,
  },
  setupProgressTrack: {
    height: 8,
    backgroundColor: '#2a2a3e',
    borderRadius: 6,
    overflow: 'hidden',
  },
  setupProgressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 6,
  },
  statsContainer: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    overflow: 'hidden',
  },
  primaryCard: {
    borderColor: '#3d6fbe',
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(225,236,255,0.18)',
  },
  heroBadgeText: {
    color: '#deebff',
    fontSize: 11,
    fontWeight: '700',
  },
  heroNetText: {
    color: '#d4e5ff',
    fontSize: 12,
    fontWeight: '700',
  },
  statValue: {
    fontSize: 34,
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
    backgroundColor: '#1a1d35',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#30385f',
  },
  smallStatCardBlue: {
    backgroundColor: '#13263e',
    borderColor: '#1f4b74',
  },
  smallStatCardViolet: {
    backgroundColor: '#261c46',
    borderColor: '#453482',
  },
  smallStatValue: {
    fontSize: 21,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 8,
    marginBottom: 4,
    flexShrink: 1,
    includeFontPadding: false,
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
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  linkText: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: '600',
  },
  bankSubLabel: {
    color: '#8fa1e0',
    fontSize: 12,
    fontWeight: '600',
  },
  categoryCardsRow: {
    gap: 12,
    paddingRight: 24,
  },
  categorySpendCard: {
    width: 182,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: 14,
    gap: 10,
  },
  categoryCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  categoryPercentBadge: {
    fontSize: 11,
    color: '#f2f6ff',
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  categorySpendName: {
    fontSize: 13,
    color: '#e9efff',
    fontWeight: '700',
  },
  categorySpendAmount: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '800',
  },
  categoryMeterTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  categoryMeterFill: {
    height: '100%',
    backgroundColor: '#f9fdff',
    borderRadius: 999,
  },
  bankCardsRow: {
    gap: 12,
    paddingRight: 24,
  },
  bankCard: {
    width: 238,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#3d4f7e',
    padding: 14,
    gap: 14,
  },
  bankCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  bankNameText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  bankMaskText: {
    color: '#bfcdef',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
  bankTxPill: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  bankTxPillText: {
    color: '#e6eeff',
    fontSize: 11,
    fontWeight: '700',
  },
  bankTotalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  bankLabel: {
    color: '#9eb2e1',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  bankDebitValue: {
    color: '#ffd0d0',
    fontSize: 15,
    fontWeight: '800',
  },
  bankCreditValue: {
    color: '#c4f1ff',
    fontSize: 15,
    fontWeight: '800',
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
  emptyCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  emptyCardText: {
    color: '#999',
    fontSize: 13,
  },
  transactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    marginBottom: 12,
  },
  transactionMeta: {
    flex: 1,
    marginRight: 12,
  },
  transactionTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  transactionSubtitle: {
    color: '#999',
    fontSize: 12,
  },
  transactionAmount: {
    color: '#FF6B6B',
    fontSize: 14,
    fontWeight: '700',
  },
  transactionAmountCredit: {
    color: '#4FC3F7',
  },
  newsInsightCard: {
    backgroundColor: '#17261c',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#294632',
    marginBottom: 12,
  },
  newsInsightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  newsInsightTitle: {
    color: '#8ce2a0',
    fontSize: 12,
    fontWeight: '700',
  },
  newsInsightText: {
    color: '#eaf9ee',
    fontSize: 12,
    lineHeight: 18,
  },
  newsRow: {
    gap: 12,
  },
  newsCard: {
    width: 260,
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    padding: 14,
  },
  newsSource: {
    color: '#8fa1e0',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8,
  },
  newsTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginBottom: 8,
  },
  newsSummary: {
    color: '#b5bdd8',
    fontSize: 12,
    lineHeight: 18,
  },
  smsLoaderOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  smsLoaderCard: {
    width: '100%',
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    paddingVertical: 24,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  smsLoaderTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 14,
  },
  smsLoaderText: {
    color: '#9aa0b4',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  smsProgressTrack: {
    width: '100%',
    height: 8,
    backgroundColor: '#2a2a3e',
    borderRadius: 999,
    marginTop: 14,
    overflow: 'hidden',
  },
  smsProgressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 999,
  },
  smsCountersRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  smsCounterText: {
    color: '#b4bbd0',
    fontSize: 12,
    fontWeight: '600',
  },
});
