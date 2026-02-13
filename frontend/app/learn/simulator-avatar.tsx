import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import { chooseSimulationAvatar, getSimulationHome, type SimulationHome } from '../../lib/learnApi';

export default function SimulatorAvatarScreen() {
  const [home, setHome] = React.useState<SimulationHome | null>(null);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [updatingAvatarId, setUpdatingAvatarId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const uid = await getSavedUserId();
      if (!uid) {
        setError('Login required to choose avatar');
        return;
      }
      setUserId(uid);
      const payload = await getSimulationHome(uid);
      setHome(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load avatars');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const onChooseAvatar = async (avatarId: string) => {
    if (!userId || updatingAvatarId) return;
    setUpdatingAvatarId(avatarId);
    setError(null);
    try {
      const payload = await chooseSimulationAvatar(userId, avatarId);
      setHome(payload);
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'Unable to set avatar');
    } finally {
      setUpdatingAvatarId(null);
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
          <Text style={styles.heroTitle}>Choose Your Avatar</Text>
          <Text style={styles.heroBody}>Your avatar appears in rooms, leaderboard, and feed posts.</Text>
        </View>

        {loading ? (
          <View style={styles.stateRow}>
            <ActivityIndicator color="#27E2BF" />
            <Text style={styles.stateText}>Loading avatars...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {(home?.avatar_options ?? []).map((avatar) => {
          const selected = home?.active_avatar_id === avatar.id;
          const choosing = updatingAvatarId === avatar.id;
          return (
            <TouchableOpacity
              key={avatar.id}
              style={[styles.avatarCard, selected && styles.avatarCardSelected]}
              onPress={() => {
                void onChooseAvatar(avatar.id);
              }}
              disabled={Boolean(updatingAvatarId)}
            >
              <View>
                <Text style={styles.avatarEmoji}>{avatar.emoji}</Text>
              </View>
              <View style={styles.avatarBody}>
                <Text style={styles.avatarName}>{avatar.name}</Text>
                <Text style={styles.avatarTitle}>{avatar.title}</Text>
                <Text style={styles.avatarStyle}>Style: {avatar.style}</Text>
              </View>
              <View style={styles.avatarAction}>
                <Text style={styles.avatarActionText}>
                  {selected ? 'Selected' : choosing ? 'Updating...' : 'Choose'}
                </Text>
              </View>
            </TouchableOpacity>
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
  heroBody: { color: '#A5CEC7', fontSize: 14 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  stateText: { color: '#DDFBF4', fontSize: 12, fontWeight: '600' },
  errorCard: { backgroundColor: '#4C1F25', borderRadius: 12, borderWidth: 1, borderColor: '#9D4652', padding: 12 },
  errorText: { color: '#FFDADF', fontSize: 12, fontWeight: '600' },
  avatarCard: {
    backgroundColor: '#113940',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#23515A',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarCardSelected: { borderColor: '#27E2BF' },
  avatarEmoji: { fontSize: 32 },
  avatarBody: { flex: 1 },
  avatarName: { color: '#F3FFFC', fontSize: 16, fontWeight: '700' },
  avatarTitle: { color: '#B4D8D0', fontSize: 12, marginTop: 2 },
  avatarStyle: { color: '#80C6BA', fontSize: 11, marginTop: 4 },
  avatarAction: {
    backgroundColor: '#27E2BF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  avatarActionText: { color: '#073A32', fontSize: 12, fontWeight: '700' },
});
