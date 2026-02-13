import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import { getWatchlist, updateWatchlistItem, type WatchlistItem } from '../../lib/learnApi';

export default function WatchlistScreen() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      const loadWatchlist = async () => {
        setLoading(true);
        setError(null);
        try {
          const savedUserId = await getSavedUserId();
          if (!savedUserId) {
            setError('Login required to load watchlist');
            return;
          }
          setUserId(savedUserId);
          const response = await getWatchlist(savedUserId);
          setItems(response);
        } catch (loadError) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load watchlist');
        } finally {
          setLoading(false);
        }
      };

      void loadWatchlist();
    }, [])
  );

  const followedCount = useMemo(() => items.filter((i) => i.followed).length, [items]);

  const onToggle = async (item: WatchlistItem) => {
    if (!userId) return;
    setItems((prev) =>
      prev.map((p) =>
        p.symbol === item.symbol ? { ...p, followed: !p.followed } : p
      )
    );
    try {
      await updateWatchlistItem(userId, item.symbol, { followed: !item.followed });
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to update watchlist');
      setItems((prev) =>
        prev.map((p) =>
          p.symbol === item.symbol ? { ...p, followed: item.followed } : p
        )
      );
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
          <Text style={styles.heroTitle}>Watchlist</Text>
          <Text style={styles.heroBody}>Follow assets and connect movement to what you learn.</Text>
          <Text style={styles.heroStat}>{followedCount} assets actively followed</Text>
        </View>

        {loading ? (
          <View style={styles.stateRow}>
            <ActivityIndicator color="#27E2BF" />
            <Text style={styles.stateText}>Loading watchlist...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {items.map((item) => (
          <View key={item.symbol} style={styles.itemRow}>
            <View>
              <Text style={styles.symbol}>{item.symbol}</Text>
              <Text style={styles.note}>{item.note}</Text>
            </View>
            <TouchableOpacity
              style={[styles.toggleBtn, item.followed && styles.toggleBtnOn]}
              onPress={() => {
                void onToggle(item);
              }}
            >
              <Text style={[styles.toggleText, item.followed && styles.toggleTextOn]}>
                {item.followed ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
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
  heroTitle: { color: '#F3FFFC', fontSize: 24, fontWeight: '700', marginBottom: 8 },
  heroBody: { color: '#A5CEC7', fontSize: 14, marginBottom: 8 },
  heroStat: { color: '#27E2BF', fontSize: 13, fontWeight: '700' },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  stateText: { color: '#DDFBF4', fontSize: 12, fontWeight: '600' },
  errorCard: { backgroundColor: '#4C1F25', borderRadius: 12, borderWidth: 1, borderColor: '#9D4652', padding: 12 },
  errorText: { color: '#FFDADF', fontSize: 12, fontWeight: '600' },
  itemRow: { backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  symbol: { color: '#F3FFFC', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  note: { color: '#9BD3C8', fontSize: 12 },
  toggleBtn: { borderWidth: 1, borderColor: '#2D8F7B', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  toggleBtnOn: { backgroundColor: '#27E2BF' },
  toggleText: { color: '#9DE2D5', fontWeight: '700', fontSize: 12 },
  toggleTextOn: { color: '#073A32' },
});
