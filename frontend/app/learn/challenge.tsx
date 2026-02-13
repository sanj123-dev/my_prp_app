import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import { getChallenge, toggleChallengeCheckIn, type Challenge } from '../../lib/learnApi';

export default function ChallengeScreen() {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadChallenge = async () => {
      setLoading(true);
      setError(null);
      try {
        const savedUserId = await getSavedUserId();
        if (!savedUserId) {
          setError('Login required to load challenge');
          return;
        }
        setUserId(savedUserId);
        const response = await getChallenge(savedUserId);
        setChallenge(response);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load challenge');
      } finally {
        setLoading(false);
      }
    };
    void loadChallenge();
  }, []);

  const toggleDay = async (index: number) => {
    if (!userId) return;
    try {
      const response = await toggleChallengeCheckIn(userId, index);
      setChallenge(response);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to update check-in');
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
            <Text style={styles.stateText}>Loading challenge...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {challenge ? (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroTitle}>{challenge.title}</Text>
              <Text style={styles.heroBody}>{challenge.description}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${challenge.progress}%` }]} />
              </View>
              <Text style={styles.progressText}>{challenge.progress}% complete</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Daily check-in</Text>
              {challenge.days.map((day, index) => (
                <TouchableOpacity
                  key={day}
                  style={[styles.dayRow, challenge.completed[index] && styles.dayRowDone]}
                  onPress={() => {
                    void toggleDay(index);
                  }}
                >
                  <Text style={styles.dayText}>{day}</Text>
                  <Ionicons
                    name={challenge.completed[index] ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={challenge.completed[index] ? '#27E2BF' : '#7FA59E'}
                  />
                </TouchableOpacity>
              ))}
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
  heroCard: { backgroundColor: '#0F3138', borderRadius: 16, borderWidth: 1, borderColor: '#1E4E57', padding: 16 },
  heroTitle: { color: '#F3FFFC', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  heroBody: { color: '#A5CEC7', fontSize: 14, lineHeight: 20, marginBottom: 12 },
  progressTrack: { height: 8, backgroundColor: '#27545D', borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#27E2BF' },
  progressText: { marginTop: 8, color: '#A3E7D9', fontSize: 12, fontWeight: '600' },
  card: { backgroundColor: '#113940', borderRadius: 16, borderWidth: 1, borderColor: '#23515A', padding: 16 },
  cardTitle: { color: '#F3FFFC', fontSize: 17, fontWeight: '700', marginBottom: 10 },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0B2A30', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8, borderWidth: 1, borderColor: '#224C54' },
  dayRowDone: { borderColor: '#2D8F7B' },
  dayText: { color: '#E9FFF9', fontSize: 14, fontWeight: '600' },
});
