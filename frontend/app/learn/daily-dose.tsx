import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import { claimDailyDose, getDailyDose, type DailyDose } from '../../lib/learnApi';

export default function DailyDoseScreen() {
  const [dailyDose, setDailyDose] = useState<DailyDose | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDailyDose = async () => {
      setLoading(true);
      setError(null);
      try {
        const savedUserId = await getSavedUserId();
        if (!savedUserId) {
          setError('Login required to load lesson');
          return;
        }
        setUserId(savedUserId);
        const response = await getDailyDose(savedUserId);
        setDailyDose(response);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load lesson');
      } finally {
        setLoading(false);
      }
    };

    void loadDailyDose();
  }, []);

  const onClaim = async () => {
    if (!userId || !dailyDose || dailyDose.claimed || claiming) return;
    setClaiming(true);
    try {
      const claim = await claimDailyDose(userId);
      setDailyDose((prev) =>
        prev
          ? {
              ...prev,
              claimed: claim.claimed,
              reward_xp: claim.reward_xp,
              streak_days: claim.streak_days,
            }
          : prev
      );
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : 'Unable to claim reward');
    } finally {
      setClaiming(false);
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
            <Text style={styles.stateText}>Loading today&apos;s lesson...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {dailyDose ? (
          <>
            <LinearGradient colors={['#0F8A73', '#1DBB9F']} style={styles.heroCard}>
              <Text style={styles.heroTag}>{dailyDose.tag}</Text>
              <Text style={styles.heroTitle}>{dailyDose.title}</Text>
              <Text style={styles.heroBody}>{dailyDose.body}</Text>
            </LinearGradient>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Micro-learning loop</Text>
              {dailyDose.steps.map((step, idx) => (
                <View key={step} style={styles.row}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{idx + 1}</Text>
                  </View>
                  <Text style={styles.rowText}>{step}</Text>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Reward</Text>
              <Text style={styles.cardBody}>
                +{dailyDose.reward_xp} XP and streak: {dailyDose.streak_days} day
                {dailyDose.streak_days === 1 ? '' : 's'}.
              </Text>
              <TouchableOpacity
                style={[styles.cta, dailyDose.claimed && styles.ctaDisabled]}
                onPress={onClaim}
                disabled={dailyDose.claimed || claiming}
              >
                <Text style={styles.ctaText}>
                  {dailyDose.claimed ? 'Reward claimed' : claiming ? 'Claiming...' : 'Claim reward'}
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
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0F3138',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E4E57',
    padding: 12,
  },
  stateText: { color: '#DDFBF4', fontSize: 13, fontWeight: '600' },
  errorCard: { backgroundColor: '#4C1F25', borderRadius: 12, borderWidth: 1, borderColor: '#9D4652', padding: 12 },
  errorText: { color: '#FFDADF', fontSize: 12, fontWeight: '600' },
  heroCard: { borderRadius: 18, padding: 18 },
  heroTag: { color: '#DFFFF7', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  heroTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', lineHeight: 30, marginBottom: 8 },
  heroBody: { color: '#EDFFF9', fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: '#0F3138', borderRadius: 16, borderWidth: 1, borderColor: '#1E4E57', padding: 16 },
  cardTitle: { color: '#F3FFFC', fontSize: 17, fontWeight: '700', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  badge: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#D5FFF6', justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: '#0B6D5D', fontSize: 12, fontWeight: '700' },
  rowText: { color: '#DDFBF4', fontSize: 14 },
  cardBody: { color: '#A5CEC7', fontSize: 14, lineHeight: 20, marginBottom: 14 },
  cta: { backgroundColor: '#27E2BF', alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999 },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: '#073A32', fontWeight: '700', fontSize: 13 },
});
