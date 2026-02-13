import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { getSavedUserId } from '../../../lib/auth';
import {
  getLearnPathway,
  updateLearnPathwayProgress,
  type LearnPathwayDetail,
} from '../../../lib/learnApi';

export default function PathwayDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const [pathway, setPathway] = useState<LearnPathwayDetail | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPathway = async () => {
      setLoading(true);
      setError(null);
      try {
        const savedUserId = await getSavedUserId();
        if (!savedUserId || !slug) {
          setError('Missing user or pathway');
          return;
        }
        setUserId(savedUserId);
        const response = await getLearnPathway(slug, savedUserId);
        setPathway(response);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load pathway');
      } finally {
        setLoading(false);
      }
    };

    void loadPathway();
  }, [slug]);

  const progressText = useMemo(() => {
    if (!pathway) return '';
    return `${pathway.progress}% complete`;
  }, [pathway]);

  const onContinue = async () => {
    if (!pathway || !userId || !slug || isUpdating) return;
    setIsUpdating(true);
    try {
      const nextProgress = Math.min(100, pathway.progress + 10);
      const updated = await updateLearnPathwayProgress(slug, userId, nextProgress);
      setPathway(updated);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update progress');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#D8FFF7" />
          <Text style={styles.backText}>Back to Learn</Text>
        </TouchableOpacity>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color="#27E2BF" />
            <Text style={styles.stateText}>Loading pathway...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {pathway ? (
          <>
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View style={styles.iconWrap}>
                  <Ionicons name={pathway.icon as any} size={18} color="#0E7C66" />
                </View>
                <Text style={styles.timeText}>{pathway.time_left}</Text>
              </View>
              <Text style={styles.heroTitle}>{pathway.title}</Text>
              <Text style={styles.heroBody}>{pathway.summary}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pathway.progress}%` }]} />
              </View>
              <Text style={styles.progressText}>{progressText}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Next bite-size tasks</Text>
              {pathway.steps.map((step, idx) => (
                <View key={step} style={styles.row}>
                  <Text style={styles.rowIndex}>{idx + 1}.</Text>
                  <Text style={styles.rowText}>{step}</Text>
                </View>
              ))}
              <TouchableOpacity style={styles.cta} onPress={onContinue} disabled={isUpdating}>
                <Text style={styles.ctaText}>
                  {isUpdating ? 'Updating...' : pathway.progress >= 100 ? 'Completed' : 'Continue lesson'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#081F24' },
  content: { padding: 20, gap: 14 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  backText: { color: '#D8FFF7', fontSize: 13, fontWeight: '600' },
  stateCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    backgroundColor: '#0F3138',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E4E57',
    padding: 12,
  },
  stateText: { color: '#DDFBF4', fontSize: 13, fontWeight: '600' },
  errorCard: { backgroundColor: '#4C1F25', borderRadius: 12, borderWidth: 1, borderColor: '#9D4652', padding: 12 },
  errorText: { color: '#FFDADF', fontSize: 12, fontWeight: '600' },
  heroCard: { backgroundColor: '#0F3138', borderRadius: 16, borderWidth: 1, borderColor: '#1E4E57', padding: 16 },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#D7FFF6', justifyContent: 'center', alignItems: 'center' },
  timeText: { color: '#9DE2D5', fontSize: 12, fontWeight: '600' },
  heroTitle: { color: '#F3FFFC', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  heroBody: { color: '#A5CEC7', fontSize: 14, lineHeight: 20, marginBottom: 12 },
  progressTrack: { height: 8, backgroundColor: '#27545D', borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#27E2BF' },
  progressText: { marginTop: 8, color: '#A3E7D9', fontSize: 12, fontWeight: '600' },
  card: { backgroundColor: '#113940', borderRadius: 16, borderWidth: 1, borderColor: '#23515A', padding: 16 },
  cardTitle: { color: '#F3FFFC', fontSize: 17, fontWeight: '700', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  rowIndex: { color: '#27E2BF', fontSize: 14, fontWeight: '700', marginTop: 1 },
  rowText: { flex: 1, color: '#DDFBF4', fontSize: 14, lineHeight: 20 },
  cta: { marginTop: 4, backgroundColor: '#27E2BF', alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999 },
  ctaText: { color: '#073A32', fontWeight: '700', fontSize: 13 },
});
