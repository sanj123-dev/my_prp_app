import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

const PRICES = [10200, 10480, 10110, 10890, 11240, 11030, 11620];

export default function SimulatorScreen() {
  const [holding, setHolding] = useState(0);
  const [cash, setCash] = useState(10000);
  const currentPrice = PRICES[PRICES.length - 1];

  const portfolio = useMemo(() => cash + holding * currentPrice, [cash, holding, currentPrice]);

  const buyOne = () => {
    if (cash >= currentPrice) {
      setCash((prev) => prev - currentPrice);
      setHolding((prev) => prev + 1);
    }
  };

  const sellOne = () => {
    if (holding > 0) {
      setCash((prev) => prev + currentPrice);
      setHolding((prev) => prev - 1);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#D8FFF7" />
          <Text style={styles.backText}>Back to Learn</Text>
        </TouchableOpacity>

        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Risk-Free Simulator</Text>
          <Text style={styles.heroBody}>Practice with virtual cash before real money.</Text>
          <Text style={styles.priceText}>Current Price: Rs {currentPrice}</Text>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Cash</Text>
            <Text style={styles.metricValue}>Rs {cash}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Holdings</Text>
            <Text style={styles.metricValue}>{holding} unit</Text>
          </View>
        </View>

        <View style={styles.metricCardLarge}>
          <Text style={styles.metricLabel}>Portfolio Value</Text>
          <Text style={styles.metricValue}>Rs {portfolio}</Text>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.buyBtn} onPress={buyOne}>
            <Text style={styles.buyText}>Buy 1</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sellBtn} onPress={sellOne}>
            <Text style={styles.sellText}>Sell 1</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#081F24' },
  content: { padding: 20, gap: 14 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  backText: { color: '#D8FFF7', fontSize: 13, fontWeight: '600' },
  heroCard: { backgroundColor: '#0F3138', borderRadius: 16, borderWidth: 1, borderColor: '#1E4E57', padding: 16 },
  heroTitle: { color: '#F3FFFC', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  heroBody: { color: '#A5CEC7', fontSize: 14, marginBottom: 10 },
  priceText: { color: '#27E2BF', fontSize: 16, fontWeight: '700' },
  metricsRow: { flexDirection: 'row', gap: 10 },
  metricCard: { flex: 1, backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 14 },
  metricCardLarge: { backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 14 },
  metricLabel: { color: '#9BD3C8', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  metricValue: { color: '#F3FFFC', fontSize: 20, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 10 },
  buyBtn: { flex: 1, backgroundColor: '#27E2BF', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  buyText: { color: '#073A32', fontWeight: '700', fontSize: 14 },
  sellBtn: { flex: 1, backgroundColor: '#D7FFF6', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  sellText: { color: '#0B6D5D', fontWeight: '700', fontSize: 14 },
});
