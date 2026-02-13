import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import { getSimulationPortfolio, type SimulationPortfolioSnapshot } from '../../lib/learnApi';

export default function SimulatorPortfolioScreen() {
  const [portfolio, setPortfolio] = React.useState<SimulationPortfolioSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const loadPortfolio = async () => {
      setLoading(true);
      setError(null);
      try {
        const uid = await getSavedUserId();
        if (!uid) {
          setError('Login required to load portfolio');
          return;
        }
        const payload = await getSimulationPortfolio(uid);
        setPortfolio(payload);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load portfolio');
      } finally {
        setLoading(false);
      }
    };
    void loadPortfolio();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#D8FFF7" />
          <Text style={styles.backText}>Back to Simulator</Text>
        </TouchableOpacity>

        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Portfolio Snapshot</Text>
          <Text style={styles.heroBody}>Track holdings, unrealized PnL, and your recent trade actions.</Text>
        </View>

        {loading ? (
          <View style={styles.stateRow}>
            <ActivityIndicator color="#27E2BF" />
            <Text style={styles.stateText}>Loading portfolio...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {portfolio ? (
          <>
            <View style={styles.summaryGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Cash</Text>
                <Text style={styles.metricValue}>Rs {portfolio.cash_balance.toFixed(2)}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Invested</Text>
                <Text style={styles.metricValue}>Rs {portfolio.invested_value.toFixed(2)}</Text>
              </View>
            </View>

            <View style={styles.summaryGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Total Equity</Text>
                <Text style={styles.metricValue}>Rs {portfolio.total_equity.toFixed(2)}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Total PnL</Text>
                <Text style={styles.metricValue}>Rs {portfolio.total_pnl.toFixed(2)}</Text>
                <Text style={styles.metricSub}>{portfolio.total_pnl_pct.toFixed(2)}%</Text>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Open Positions</Text>
              {portfolio.positions.length === 0 ? (
                <Text style={styles.emptyText}>No positions yet. Buy assets from Market screen.</Text>
              ) : (
                portfolio.positions.map((position) => (
                  <View key={position.symbol} style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowTitle}>
                        {position.symbol} ({position.quantity})
                      </Text>
                      <Text style={styles.rowSub}>
                        Avg {position.average_buy_price.toFixed(2)} | Current {position.current_price.toFixed(2)}
                      </Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={styles.rowValue}>Rs {position.market_value.toFixed(2)}</Text>
                      <Text style={styles.rowSub}>{position.unrealized_pnl_pct.toFixed(2)}%</Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Recent Trades</Text>
              {portfolio.recent_trades.length === 0 ? (
                <Text style={styles.emptyText}>No trade history yet.</Text>
              ) : (
                portfolio.recent_trades.map((trade) => (
                  <View key={trade.id} style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowTitle}>
                        {trade.side.toUpperCase()} {trade.symbol} x {trade.quantity}
                      </Text>
                      <Text style={styles.rowSub}>{new Date(trade.executed_at).toLocaleString()}</Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={styles.rowValue}>Rs {trade.notional.toFixed(2)}</Text>
                      <Text style={styles.rowSub}>Fee {trade.fee.toFixed(2)}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#081F24' },
  content: { padding: 20, gap: 12 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  backText: { color: '#D8FFF7', fontSize: 13, fontWeight: '600' },
  heroCard: { backgroundColor: '#0F3138', borderRadius: 16, borderWidth: 1, borderColor: '#1E4E57', padding: 16 },
  heroTitle: { color: '#F3FFFC', fontSize: 21, fontWeight: '700', marginBottom: 8 },
  heroBody: { color: '#A5CEC7', fontSize: 14 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  stateText: { color: '#DDFBF4', fontSize: 12, fontWeight: '600' },
  errorCard: { backgroundColor: '#4C1F25', borderRadius: 12, borderWidth: 1, borderColor: '#9D4652', padding: 12 },
  errorText: { color: '#FFDADF', fontSize: 12, fontWeight: '600' },
  summaryGrid: { flexDirection: 'row', gap: 10 },
  metricCard: { flex: 1, backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 14 },
  metricLabel: { color: '#9BD3C8', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  metricValue: { color: '#F3FFFC', fontSize: 16, fontWeight: '700' },
  metricSub: { color: '#9BD3C8', fontSize: 11, marginTop: 6 },
  sectionCard: { backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 14 },
  sectionTitle: { color: '#F3FFFC', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  emptyText: { color: '#9BD3C8', fontSize: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopColor: '#2A5A64',
    borderTopWidth: 1,
    paddingVertical: 10,
    gap: 8,
  },
  rowLeft: { flex: 1 },
  rowRight: { alignItems: 'flex-end' },
  rowTitle: { color: '#F3FFFC', fontSize: 13, fontWeight: '700' },
  rowSub: { color: '#9BD3C8', fontSize: 11, marginTop: 3 },
  rowValue: { color: '#E2FFF9', fontSize: 13, fontWeight: '700' },
});
