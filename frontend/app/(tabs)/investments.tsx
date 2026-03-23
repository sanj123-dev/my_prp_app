import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarChart, LineChart } from 'react-native-gifted-charts';
import { Ionicons } from '@expo/vector-icons';
import { isAxiosError } from 'axios';
import { router } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import {
  askInvestmentQuestion,
  getInvestmentOverview,
  searchInvestments,
  type InvestmentOverview,
  type InvestmentSearchResult,
} from '../../lib/investmentApi';
import { theme } from '../../theme/tokens';

type QaItem = {
  role: 'user' | 'assistant';
  text: string;
};

const QUICK_SUGGESTIONS = ['RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'BTC-USD'];

const formatNumber = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return value.toFixed(2);
};

const toLineData = (history: InvestmentOverview['history'], key: 'close' | 'ma50' | 'ma200') => {
  const points = history.filter((item) => Number(item[key]) > 0);
  if (points.length <= 70) {
    return points.map((item, idx) => ({
      value: Number(item[key] || 0),
      label: idx % 14 === 0 ? item.date.slice(5) : '',
    }));
  }

  const step = Math.max(1, Math.floor(points.length / 70));
  const reduced = points.filter((_, idx) => idx % step === 0 || idx === points.length - 1);
  return reduced.map((item, idx) => ({
    value: Number(item[key] || 0),
    label: idx % 8 === 0 ? item.date.slice(5) : '',
  }));
};

const toVolumeBars = (history: InvestmentOverview['history']) => {
  const points = history.filter((item) => Number(item.volume) > 0);
  const step = Math.max(1, Math.floor(points.length / 35));
  return points
    .filter((_, idx) => idx % step === 0 || idx === points.length - 1)
    .map((item, idx) => ({
      value: Number(item.volume || 0),
      label: idx % 6 === 0 ? item.date.slice(5) : '',
      frontColor: '#4B74D8',
    }));
};

export default function InvestmentsScreen() {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<InvestmentSearchResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState('');
  const [overview, setOverview] = useState<InvestmentOverview | null>(null);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaSessionId, setQaSessionId] = useState<string | undefined>(undefined);
  const [qaHistory, setQaHistory] = useState<QaItem[]>([]);
  const [askingQa, setAskingQa] = useState(false);
  const [errorText, setErrorText] = useState('');

  const priceData = useMemo(() => {
    if (!overview) return [];
    return toLineData(overview.history, 'close');
  }, [overview]);

  const ma50Data = useMemo(() => {
    if (!overview) return [];
    return toLineData(overview.history, 'ma50');
  }, [overview]);

  const ma200Data = useMemo(() => {
    if (!overview) return [];
    return toLineData(overview.history, 'ma200');
  }, [overview]);

  const volumeData = useMemo(() => {
    if (!overview) return [];
    return toVolumeBars(overview.history);
  }, [overview]);

  const explainers = useMemo(() => {
    if (!overview) return [];

    const pe = overview.snapshot.pe_ratio;
    const cagr = overview.analytics.cagr_pct;
    const vol = overview.analytics.volatility_pct;
    const trend = overview.analytics.trend;

    return [
      `PE Ratio: ${formatNumber(pe)}. Lower PE can mean cheaper valuation, but it depends on sector quality.`,
      `CAGR: ${formatNumber(cagr)}%. This shows long-term annualized growth from historical price movement.`,
      `Volatility: ${formatNumber(vol)}%. Higher volatility means larger price swings and potentially higher risk.`,
      `Trend: ${trend}. Use trend with risk profile, not as a standalone buy/sell signal.`,
    ];
  }, [overview]);

  const runSearch = async () => {
    const cleaned = query.trim();
    setLoadingSearch(true);
    setErrorText('');
    try {
      const userId = await getSavedUserId();
      if (!userId) throw new Error('Please login again to continue');
      const q = cleaned || 'reliance';
      const rows = await searchInvestments(userId, q, 8);
      setSearchResults(rows);
    } catch (error) {
      const message = isAxiosError(error)
        ? String(error.response?.data?.detail || error.message)
        : error instanceof Error
          ? error.message
          : 'Unable to search right now';
      setErrorText(message);
    } finally {
      setLoadingSearch(false);
    }
  };

  const loadOverview = async (tickerOrQuery: string) => {
    setLoadingOverview(true);
    setErrorText('');
    try {
      const userId = await getSavedUserId();
      if (!userId) throw new Error('Please login again to continue');
      const payload = await getInvestmentOverview(userId, tickerOrQuery, 'max');
      setSelectedTicker(payload.snapshot.ticker);
      setOverview(payload);
      setQaHistory([]);
      setQaSessionId(undefined);
    } catch (error) {
      const message = isAxiosError(error)
        ? String(error.response?.data?.detail || error.message)
        : error instanceof Error
          ? error.message
          : 'Unable to fetch investment data';
      setErrorText(message);
    } finally {
      setLoadingOverview(false);
    }
  };

  const askQa = async () => {
    if (!overview || !selectedTicker || !qaQuestion.trim()) return;
    setAskingQa(true);
    setErrorText('');
    const question = qaQuestion.trim();
    setQaQuestion('');
    setQaHistory((prev) => [...prev, { role: 'user', text: question }]);
    try {
      const userId = await getSavedUserId();
      if (!userId) throw new Error('Please login again to continue');
      const response = await askInvestmentQuestion({
        userId,
        ticker: selectedTicker,
        question,
        sessionId: qaSessionId,
      });
      setQaSessionId(response.session_id);
      setQaHistory((prev) => [...prev, { role: 'assistant', text: response.answer }]);
    } catch (error) {
      const message = isAxiosError(error)
        ? String(error.response?.data?.detail || error.message)
        : error instanceof Error
          ? error.message
          : 'Unable to answer right now';
      setQaHistory((prev) => [...prev, { role: 'assistant', text: message }]);
      setErrorText(message);
    } finally {
      setAskingQa(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Investment Lab</Text>
              <Text style={styles.subtitle}>Smarter research before taking any position.</Text>
            </View>
            <Pressable style={styles.profileIconBtn} onPress={() => router.push('/(tabs)/profile')}>
              <Ionicons name="person-circle-outline" size={30} color={theme.colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search stock / mutual fund / crypto"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
              onSubmitEditing={() => {
                void runSearch();
              }}
            />
            <Pressable style={styles.searchBtn} onPress={() => void runSearch()}>
              {loadingSearch ? (
                <ActivityIndicator color={theme.colors.accentContrast} />
              ) : (
                <Ionicons name="search" size={18} color={theme.colors.accentContrast} />
              )}
            </Pressable>
          </View>

          <View style={styles.quickWrap}>
            <Text style={styles.quickTitle}>Quick Picks</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {QUICK_SUGGESTIONS.map((item) => (
                <Pressable
                  key={item}
                  style={styles.quickChip}
                  onPress={() => {
                    setQuery(item);
                    void loadOverview(item);
                  }}
                >
                  <Text style={styles.quickChipText}>{item}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {searchResults.length > 0 && (
            <View style={styles.resultsCard}>
              <Text style={styles.resultsTitle}>Suggested Stocks</Text>
              {searchResults.map((item) => (
                <Pressable
                  key={item.symbol}
                  style={styles.resultRow}
                  onPress={() => void loadOverview(item.symbol)}
                >
                  <View style={styles.resultMeta}>
                    <Text style={styles.resultSymbol}>{item.symbol}</Text>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </View>
                  <Text style={styles.resultBadge}>{item.asset_type}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {!!errorText && <Text style={styles.errorText}>{errorText}</Text>}

          {loadingOverview && (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={theme.colors.accent} size="large" />
              <Text style={styles.loadingText}>Fetching market data and analytics...</Text>
            </View>
          )}

          {overview && !loadingOverview && (
            <>
              <View style={styles.metricsCard}>
                <View style={styles.metricTop}>
                  <Text style={styles.metricTicker}>
                    {overview.snapshot.short_name} ({overview.snapshot.ticker})
                  </Text>
                  <Text style={styles.metricTrend}>{overview.analytics.trend.toUpperCase()}</Text>
                </View>
                <Text style={styles.metricPrice}>
                  {overview.snapshot.price} {overview.snapshot.currency}
                </Text>
                <View style={styles.metricGrid}>
                  <Text style={styles.metricItem}>PE: {formatNumber(overview.snapshot.pe_ratio)}</Text>
                  <Text style={styles.metricItem}>Market Cap: {formatNumber(overview.snapshot.market_cap)}</Text>
                  <Text style={styles.metricItem}>CAGR: {formatNumber(overview.analytics.cagr_pct)}%</Text>
                  <Text style={styles.metricItem}>
                    Volatility: {formatNumber(overview.analytics.volatility_pct)}%
                  </Text>
                  <Text style={styles.metricItem}>
                    Vs {overview.analytics.index_symbol}: {formatNumber(overview.analytics.performance_vs_index_pct)}%
                  </Text>
                </View>
              </View>

              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Price Trend (Lifetime)</Text>
                {priceData.length > 1 ? (
                  <LineChart
                    data={priceData}
                    color="#2ED3A6"
                    thickness={2}
                    dataPointsColor="#2ED3A6"
                    yAxisTextStyle={{ color: '#aab7d8', fontSize: 10 }}
                    xAxisLabelTextStyle={{ color: '#d5e1ff', fontSize: 10 }}
                    rulesColor="#27304a"
                    hideRules={false}
                    adjustToWidth
                  />
                ) : (
                  <Text style={styles.emptyChartText}>Not enough points for price chart.</Text>
                )}
              </View>

              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Moving Averages (MA50 / MA200)</Text>
                {ma50Data.length > 1 && ma200Data.length > 1 ? (
                  <>
                    <LineChart
                      data={ma50Data}
                      color="#57A9FF"
                      thickness={2}
                      dataPointsColor="#57A9FF"
                      yAxisTextStyle={{ color: '#aab7d8', fontSize: 10 }}
                      xAxisLabelTextStyle={{ color: '#d5e1ff', fontSize: 10 }}
                      rulesColor="#27304a"
                      hideRules={false}
                      adjustToWidth
                    />
                    <View style={styles.maLegendRow}>
                      <View style={styles.maLegendItem}>
                        <View style={[styles.maLegendDot, { backgroundColor: '#57A9FF' }]} />
                        <Text style={styles.maLegendText}>MA50</Text>
                      </View>
                      <View style={styles.maLegendItem}>
                        <View style={[styles.maLegendDot, { backgroundColor: '#FFB062' }]} />
                        <Text style={styles.maLegendText}>MA200</Text>
                      </View>
                    </View>
                    <LineChart
                      data={ma200Data}
                      color="#FFB062"
                      thickness={2}
                      dataPointsColor="#FFB062"
                      yAxisTextStyle={{ color: '#aab7d8', fontSize: 10 }}
                      xAxisLabelTextStyle={{ color: '#d5e1ff', fontSize: 10 }}
                      rulesColor="#27304a"
                      hideRules={false}
                      adjustToWidth
                    />
                  </>
                ) : (
                  <Text style={styles.emptyChartText}>Moving averages need longer history.</Text>
                )}
              </View>

              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Volume</Text>
                {volumeData.length > 1 ? (
                  <BarChart
                    data={volumeData}
                    barWidth={16}
                    spacing={14}
                    roundedTop
                    yAxisTextStyle={{ color: '#aab7d8', fontSize: 10 }}
                    xAxisLabelTextStyle={{ color: '#d5e1ff', fontSize: 10 }}
                    noOfSections={4}
                    hideRules={false}
                    rulesColor="#27304a"
                  />
                ) : (
                  <Text style={styles.emptyChartText}>Not enough volume data.</Text>
                )}
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Understand These Metrics</Text>
                {explainers.map((line, idx) => (
                  <Text key={`${line}-${idx}`} style={styles.bullet}>
                    {`\u2022 ${line}`}
                  </Text>
                ))}
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>AI Insight</Text>
                <Text style={styles.sectionText}>{overview.ai_insight}</Text>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>
                  Suggestion Agent ({overview.suggestion.risk_profile})
                </Text>
                {overview.suggestion.suggestions.map((line, idx) => (
                  <Text key={`${line}-${idx}`} style={styles.bullet}>
                    {`\u2022 ${line}`}
                  </Text>
                ))}
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Global Data + Sentiment</Text>
                {overview.news.slice(0, 6).map((item) => (
                  <Pressable key={item.link} style={styles.newsItem} onPress={() => void Linking.openURL(item.link)}>
                    <Text style={styles.newsTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.newsMeta}>
                      {item.source} | {item.sentiment}
                    </Text>
                    <Text style={styles.newsSummary} numberOfLines={2}>
                      {item.summary}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Q&A Agent</Text>
                {qaHistory.length > 0 && (
                  <View style={styles.chatBox}>
                    {qaHistory.map((item, idx) => (
                      <View
                        key={`${item.role}-${idx}`}
                        style={[styles.chatBubble, item.role === 'assistant' ? styles.assistantBubble : styles.userBubble]}
                      >
                        <Text style={styles.chatText}>{item.text}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <View style={styles.askRow}>
                  <TextInput
                    value={qaQuestion}
                    onChangeText={setQaQuestion}
                    placeholder="Ask follow-up: risk, valuation, trend..."
                    placeholderTextColor={theme.colors.textMuted}
                    style={styles.askInput}
                    onSubmitEditing={() => {
                      void askQa();
                    }}
                  />
                  <Pressable
                    style={[styles.askBtn, askingQa && styles.askBtnDisabled]}
                    disabled={askingQa}
                    onPress={() => void askQa()}
                  >
                    {askingQa ? (
                      <ActivityIndicator color={theme.colors.accentContrast} />
                    ) : (
                      <Ionicons name="send" size={16} color={theme.colors.accentContrast} />
                    )}
                  </Pressable>
                </View>
              </View>
            </>
          )}

          <Text style={styles.disclaimer}>This is not financial advice</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.backgroundBase,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 34,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.display,
    marginTop: Platform.OS === 'android' ? 4 : 0,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
  },
  profileIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    borderRadius: 12,
    backgroundColor: theme.colors.backgroundElevated,
    color: theme.colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  searchBtn: {
    width: 42,
    height: 42,
    borderRadius: 11,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickWrap: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    backgroundColor: theme.colors.backgroundElevated,
    padding: 10,
    gap: 8,
  },
  quickTitle: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(78,135,221,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(117,164,239,0.35)',
  },
  quickChipText: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  resultsCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    backgroundColor: theme.colors.backgroundElevated,
    overflow: 'hidden',
  },
  resultsTitle: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  resultRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(130,160,210,0.2)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  resultMeta: {
    flex: 1,
  },
  resultSymbol: {
    color: theme.colors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  resultName: {
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  resultBadge: {
    color: theme.colors.info,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 12,
  },
  loadingWrap: {
    paddingVertical: 22,
    alignItems: 'center',
  },
  loadingText: {
    color: theme.colors.textSecondary,
    marginTop: 8,
    fontSize: 12,
  },
  metricsCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    backgroundColor: theme.colors.backgroundCard,
    padding: 14,
    gap: 8,
  },
  metricTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  metricTicker: {
    color: theme.colors.textPrimary,
    fontWeight: '700',
    fontSize: 13,
    flex: 1,
  },
  metricTrend: {
    color: theme.colors.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  metricPrice: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  metricGrid: {
    gap: 4,
  },
  metricItem: {
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  chartCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    backgroundColor: theme.colors.backgroundCard,
    padding: 12,
    gap: 8,
  },
  chartTitle: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyChartText: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  maLegendRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 4,
    marginBottom: 2,
  },
  maLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  maLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  maLegendText: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  sectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    backgroundColor: theme.colors.backgroundElevated,
    padding: 12,
    gap: 8,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  sectionText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  bullet: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  newsItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(140,170,220,0.2)',
    backgroundColor: 'rgba(14,25,46,0.65)',
    padding: 10,
    gap: 4,
  },
  newsTitle: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  newsMeta: {
    color: theme.colors.info,
    fontSize: 11,
  },
  newsSummary: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  askRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  askInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    borderRadius: 10,
    backgroundColor: theme.colors.backgroundCard,
    color: theme.colors.textPrimary,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 12,
  },
  askBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  askBtnDisabled: {
    opacity: 0.7,
  },
  chatBox: {
    gap: 8,
  },
  chatBubble: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: '92%',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#174f41',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a2b49',
  },
  chatText: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    lineHeight: 17,
  },
  disclaimer: {
    color: theme.colors.danger,
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
