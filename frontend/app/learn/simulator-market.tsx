import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import {
  executeSimulationTrade,
  getSimulationHome,
  type SimulationAsset,
  type SimulationHome,
} from '../../lib/learnApi';

export default function SimulatorMarketScreen() {
  const [home, setHome] = React.useState<SimulationHome | null>(null);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [quantities, setQuantities] = React.useState<Record<string, string>>({});
  const [processingKey, setProcessingKey] = React.useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const uid = await getSavedUserId();
      if (!uid) {
        setError('Login required to trade');
        return;
      }
      setUserId(uid);
      const payload = await getSimulationHome(uid);
      setHome(payload);
      const quantityDefaults: Record<string, string> = {};
      payload.market.forEach((asset) => {
        quantityDefaults[asset.symbol] = '1';
      });
      setQuantities((prev) => ({ ...quantityDefaults, ...prev }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load market');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const onTrade = async (asset: SimulationAsset, side: 'buy' | 'sell') => {
    if (!userId || processingKey) return;
    const qty = Number(quantities[asset.symbol] || '0');
    if (!Number.isFinite(qty) || qty <= 0) {
      setError(`Quantity for ${asset.symbol} must be greater than 0`);
      return;
    }
    const key = `${asset.symbol}:${side}`;
    setProcessingKey(key);
    setError(null);
    try {
      await executeSimulationTrade(userId, {
        symbol: asset.symbol,
        side,
        quantity: qty,
      });
      await loadData();
    } catch (tradeError) {
      setError(tradeError instanceof Error ? tradeError.message : 'Trade failed');
    } finally {
      setProcessingKey(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#D8FFF7" />
          <Text style={styles.backText}>Back to Simulator</Text>
        </TouchableOpacity>

        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Live Simulation Market</Text>
          <Text style={styles.heroBody}>Buy and sell stocks, ETFs, commodities, and crypto with virtual cash.</Text>
          <Text style={styles.heroStat}>Cash: Rs {home?.portfolio.cash_balance.toFixed(2) ?? '0.00'}</Text>
        </View>

        {loading ? (
          <View style={styles.stateRow}>
            <ActivityIndicator color="#27E2BF" />
            <Text style={styles.stateText}>Loading market data...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {(home?.market ?? []).map((asset) => {
          const changePositive = asset.price_change_pct >= 0;
          const buyKey = `${asset.symbol}:buy`;
          const sellKey = `${asset.symbol}:sell`;
          return (
            <View key={asset.symbol} style={styles.assetCard}>
              <View style={styles.assetHeader}>
                <View>
                  <Text style={styles.assetSymbol}>{asset.symbol}</Text>
                  <Text style={styles.assetName}>{asset.name}</Text>
                </View>
                <View style={styles.assetTag}>
                  <Text style={styles.assetTagText}>{asset.category.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.assetPrice}>Rs {asset.current_price.toFixed(2)}</Text>
              <Text style={[styles.assetChange, changePositive ? styles.assetUp : styles.assetDown]}>
                {changePositive ? '+' : ''}
                {asset.price_change_pct.toFixed(2)}%
              </Text>
              <Text style={styles.assetMeta}>
                Day H/L: {asset.day_high.toFixed(2)} / {asset.day_low.toFixed(2)} | Vol {asset.volume.toFixed(0)}
              </Text>

              <View style={styles.tradeRow}>
                <TextInput
                  value={quantities[asset.symbol] ?? '1'}
                  onChangeText={(text) => {
                    setQuantities((prev) => ({ ...prev, [asset.symbol]: text }));
                  }}
                  keyboardType="numeric"
                  style={styles.qtyInput}
                />
                <TouchableOpacity
                  style={styles.buyBtn}
                  onPress={() => {
                    void onTrade(asset, 'buy');
                  }}
                  disabled={processingKey !== null}
                >
                  <Text style={styles.buyText}>
                    {processingKey === buyKey ? 'Buying...' : 'Buy'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.sellBtn}
                  onPress={() => {
                    void onTrade(asset, 'sell');
                  }}
                  disabled={processingKey !== null}
                >
                  <Text style={styles.sellText}>
                    {processingKey === sellKey ? 'Selling...' : 'Sell'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
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
  heroBody: { color: '#A5CEC7', fontSize: 14, marginBottom: 8 },
  heroStat: { color: '#27E2BF', fontSize: 13, fontWeight: '700' },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  stateText: { color: '#DDFBF4', fontSize: 12, fontWeight: '600' },
  errorCard: { backgroundColor: '#4C1F25', borderRadius: 12, borderWidth: 1, borderColor: '#9D4652', padding: 12 },
  errorText: { color: '#FFDADF', fontSize: 12, fontWeight: '600' },
  assetCard: { backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 14 },
  assetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assetSymbol: { color: '#F3FFFC', fontSize: 16, fontWeight: '700' },
  assetName: { color: '#9BD3C8', fontSize: 12, marginTop: 3 },
  assetTag: { backgroundColor: '#0B2830', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 8, borderWidth: 1, borderColor: '#2B616D' },
  assetTagText: { color: '#A7E7DB', fontSize: 10, fontWeight: '700' },
  assetPrice: { color: '#F3FFFC', fontSize: 18, fontWeight: '700', marginTop: 10 },
  assetChange: { fontSize: 12, fontWeight: '700', marginTop: 3 },
  assetUp: { color: '#38EE9D' },
  assetDown: { color: '#FF8E9E' },
  assetMeta: { color: '#8CCABF', fontSize: 11, marginTop: 4 },
  tradeRow: { marginTop: 10, flexDirection: 'row', gap: 8, alignItems: 'center' },
  qtyInput: {
    width: 58,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2C626B',
    backgroundColor: '#0B2830',
    color: '#F3FFFC',
    textAlign: 'center',
    paddingVertical: 8,
    fontSize: 13,
  },
  buyBtn: { flex: 1, backgroundColor: '#27E2BF', borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  buyText: { color: '#073A32', fontSize: 13, fontWeight: '700' },
  sellBtn: { flex: 1, backgroundColor: '#D7FFF6', borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  sellText: { color: '#0B6D5D', fontSize: 13, fontWeight: '700' },
});
