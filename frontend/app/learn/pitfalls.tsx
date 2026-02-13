import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import { getPitfalls, savePitfall, type Pitfall } from '../../lib/learnApi';

export default function PitfallsScreen() {
  const [items, setItems] = useState<Pitfall[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPitfalls = async () => {
      setLoading(true);
      setError(null);
      try {
        const savedUserId = await getSavedUserId();
        if (!savedUserId) {
          setError('Login required to load pitfalls');
          return;
        }
        setUserId(savedUserId);
        const response = await getPitfalls(savedUserId);
        setItems(response.items);
        setSavedCount(response.saved_count);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load pitfalls');
      } finally {
        setLoading(false);
      }
    };
    void loadPitfalls();
  }, []);

  const onToggleSave = async (pitfall: Pitfall) => {
    if (!userId) return;
    const nextSaved = !pitfall.saved;
    setItems((prev) =>
      prev.map((item) =>
        item.id === pitfall.id ? { ...item, saved: nextSaved } : item
      )
    );
    setSavedCount((prev) => prev + (nextSaved ? 1 : -1));

    try {
      const response = await savePitfall(userId, pitfall.id, nextSaved);
      setSavedCount(response.saved_count);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to save habit');
      setItems((prev) =>
        prev.map((item) =>
          item.id === pitfall.id ? { ...item, saved: pitfall.saved } : item
        )
      );
      setSavedCount((prev) => prev + (nextSaved ? -1 : 1));
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
          <Text style={styles.heroTitle}>Pitfalls to Avoid</Text>
          <Text style={styles.heroBody}>Learn what not to do so your future self can win.</Text>
          <Text style={styles.savedText}>Habits saved: {savedCount}</Text>
        </View>

        {loading ? (
          <View style={styles.stateRow}>
            <ActivityIndicator color="#27E2BF" />
            <Text style={styles.stateText}>Loading pitfalls...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {items.map((pit) => (
          <View key={pit.id} style={styles.itemCard}>
            <Text style={styles.itemTitle}>{pit.title}</Text>
            <Text style={styles.itemDetail}>{pit.detail}</Text>
            <View style={styles.habitRow}>
              <Ionicons name="bulb-outline" size={16} color="#27E2BF" />
              <Text style={styles.habitText}>{pit.habit}</Text>
            </View>
            <TouchableOpacity
              style={[styles.saveBtn, pit.saved && styles.saveBtnDone]}
              onPress={() => {
                void onToggleSave(pit);
              }}
            >
              <Text style={styles.saveText}>{pit.saved ? 'Saved' : 'Save habit'}</Text>
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
  savedText: { color: '#27E2BF', fontSize: 13, fontWeight: '700' },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  stateText: { color: '#DDFBF4', fontSize: 12, fontWeight: '600' },
  errorCard: { backgroundColor: '#4C1F25', borderRadius: 12, borderWidth: 1, borderColor: '#9D4652', padding: 12 },
  errorText: { color: '#FFDADF', fontSize: 12, fontWeight: '600' },
  itemCard: { backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 14 },
  itemTitle: { color: '#F3FFFC', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  itemDetail: { color: '#A5CEC7', fontSize: 13, lineHeight: 20, marginBottom: 10 },
  habitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
  habitText: { flex: 1, color: '#DDFBF4', fontSize: 13, lineHeight: 19 },
  saveBtn: { alignSelf: 'flex-start', backgroundColor: '#27E2BF', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 12 },
  saveBtnDone: { opacity: 0.7 },
  saveText: { color: '#073A32', fontSize: 12, fontWeight: '700' },
});
