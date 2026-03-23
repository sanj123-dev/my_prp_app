import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { isAxiosError } from 'axios';
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

const formatNumber = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return value.toFixed(2);
};

const buildChartHtml = (history: InvestmentOverview['history']) => {
  const safeData = JSON.stringify(history).replace(/</g, '\\u003c');
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/recharts@2.13.3/umd/Recharts.min.js"></script>
    <style>
      body { margin: 0; background: #081126; color: #e8f2ff; font-family: Arial, sans-serif; }
      #root { width: 100vw; height: 540px; }
      .wrap { display: grid; gap: 12px; padding: 8px; }
      .card { background: #111f39; border: 1px solid rgba(140,170,220,0.25); border-radius: 12px; padding: 8px; }
      .title { font-size: 12px; color: #9bb1d9; margin: 0 0 8px 0; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      const data = ${safeData};
      const {
        ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line,
        BarChart, Bar
      } = Recharts;

      const App = () => React.createElement(
        'div',
        { className: 'wrap' },
        React.createElement(
          'div',
          { className: 'card' },
          React.createElement('p', { className: 'title' }, 'Price + Moving Averages (Lifetime)'),
          React.createElement(
            ResponsiveContainer,
            { width: '100%', height: 300 },
            React.createElement(
              LineChart,
              { data: data },
              React.createElement(CartesianGrid, { strokeDasharray: '3 3', stroke: '#2a3b5f' }),
              React.createElement(XAxis, { dataKey: 'date', hide: true }),
              React.createElement(YAxis, { stroke: '#97add8', width: 56 }),
              React.createElement(Tooltip, { contentStyle: { background: '#0f1d35', border: '1px solid #2b4068' } }),
              React.createElement(Legend),
              React.createElement(Line, { type: 'monotone', dataKey: 'close', stroke: '#2ED3A6', dot: false, strokeWidth: 2, name: 'Price' }),
              React.createElement(Line, { type: 'monotone', dataKey: 'ma50', stroke: '#57A9FF', dot: false, strokeWidth: 1.8, name: 'MA50' }),
              React.createElement(Line, { type: 'monotone', dataKey: 'ma200', stroke: '#FFB062', dot: false, strokeWidth: 1.8, name: 'MA200' })
            )
          )
        ),
        React.createElement(
          'div',
          { className: 'card' },
          React.createElement('p', { className: 'title' }, 'Volume'),
          React.createElement(
            ResponsiveContainer,
            { width: '100%', height: 170 },
            React.createElement(
              BarChart,
              { data: data },
              React.createElement(CartesianGrid, { strokeDasharray: '3 3', stroke: '#2a3b5f' }),
              React.createElement(XAxis, { dataKey: 'date', hide: true }),
              React.createElement(YAxis, { stroke: '#97add8', width: 56 }),
              React.createElement(Tooltip, { contentStyle: { background: '#0f1d35', border: '1px solid #2b4068' } }),
              React.createElement(Bar, { dataKey: 'volume', fill: '#5D7DD6', name: 'Volume' })
            )
          )
        )
      );

      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
    </script>
  </body>
</html>`;
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

  const chartHtml = useMemo(() => {
    if (!overview || overview.history.length === 0) return '';
    return buildChartHtml(overview.history);
  }, [overview]);

  const runSearch = async () => {
    const cleaned = query.trim();
    if (!cleaned) return;
    setLoadingSearch(true);
    setErrorText('');
    try {
      const userId = await getSavedUserId();
      if (!userId) throw new Error('Please login again to continue');
      const rows = await searchInvestments(userId, cleaned, 8);
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
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Investment Lab</Text>
        <Text style={styles.subtitle}>
          Search stocks, mutual funds, or crypto. Live data + analytics + AI context.
        </Text>

        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Try Reliance, BTC-USD, INFY"
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

        {searchResults.length > 0 && (
          <View style={styles.resultsCard}>
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
                <Text style={styles.metricItem}>MCap: {formatNumber(overview.snapshot.market_cap)}</Text>
                <Text style={styles.metricItem}>CAGR: {formatNumber(overview.analytics.cagr_pct)}%</Text>
                <Text style={styles.metricItem}>
                  Volatility: {formatNumber(overview.analytics.volatility_pct)}%
                </Text>
                <Text style={styles.metricItem}>
                  Vs {overview.analytics.index_symbol}: {formatNumber(overview.analytics.performance_vs_index_pct)}%
                </Text>
              </View>
            </View>

            {chartHtml ? (
              <View style={styles.chartCard}>
                <WebView
                  source={{ html: chartHtml }}
                  style={styles.webView}
                  originWhitelist={['*']}
                  javaScriptEnabled
                  domStorageEnabled
                  scrollEnabled={false}
                />
              </View>
            ) : null}

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
  resultsCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    backgroundColor: theme.colors.backgroundElevated,
    overflow: 'hidden',
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
    overflow: 'hidden',
    height: 560,
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
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
