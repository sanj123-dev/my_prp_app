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
  getSimulationFeed,
  getSimulationHome,
  getSimulationLeaderboard,
  shareSimulationUpdate,
  type SimulationFeedPost,
  type SimulationPlayerStanding,
} from '../../lib/learnApi';

export default function SimulatorSocialScreen() {
  const [userId, setUserId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [leaderboard, setLeaderboard] = React.useState<SimulationPlayerStanding[]>([]);
  const [feed, setFeed] = React.useState<SimulationFeedPost[]>([]);
  const [message, setMessage] = React.useState('');
  const [posting, setPosting] = React.useState(false);
  const [roomLabel, setRoomLabel] = React.useState('--');

  const loadData = React.useCallback(async (uid: string) => {
    setLoading(true);
    setError(null);
    try {
      const [home, board, posts] = await Promise.all([
        getSimulationHome(uid),
        getSimulationLeaderboard(uid),
        getSimulationFeed(uid, 30),
      ]);
      setLeaderboard(board);
      setFeed(posts);
      setRoomLabel(`${home.active_room.name} (${home.active_room.code})`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load social data');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const init = async () => {
      const uid = await getSavedUserId();
      if (!uid) {
        setError('Login required to access social feed');
        setLoading(false);
        return;
      }
      setUserId(uid);
      await loadData(uid);
    };
    void init();
  }, [loadData]);

  const onShare = async () => {
    if (!userId || posting) return;
    if (!message.trim()) {
      setError('Write a short update before sharing');
      return;
    }
    setPosting(true);
    setError(null);
    try {
      await shareSimulationUpdate(userId, message.trim());
      setMessage('');
      await loadData(userId);
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : 'Unable to share update');
    } finally {
      setPosting(false);
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
          <Text style={styles.heroTitle}>Room Social</Text>
          <Text style={styles.heroBody}>Share strategy updates with friends and compete on equity leaderboard.</Text>
          <Text style={styles.heroStat}>Room: {roomLabel}</Text>
        </View>

        <View style={styles.shareCard}>
          <TextInput
            value={message}
            onChangeText={setMessage}
            style={styles.input}
            placeholder="Share your strategy update..."
            placeholderTextColor="#7FB3AA"
            maxLength={280}
            multiline
          />
          <TouchableOpacity style={styles.shareBtn} onPress={onShare} disabled={posting}>
            <Text style={styles.shareText}>{posting ? 'Posting...' : 'Share to Room'}</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.stateRow}>
            <ActivityIndicator color="#27E2BF" />
            <Text style={styles.stateText}>Loading leaderboard and feed...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Leaderboard</Text>
          {leaderboard.map((entry) => (
            <View key={`${entry.rank}-${entry.user_id}`} style={styles.row}>
              <Text style={styles.rank}>#{entry.rank}</Text>
              <View style={styles.rowBody}>
                <Text style={styles.name}>{entry.user_name}</Text>
                <Text style={styles.meta}>
                  Equity {entry.total_equity.toFixed(2)} | PnL {entry.total_pnl_pct.toFixed(2)}%
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Feed</Text>
          {feed.length === 0 ? <Text style={styles.emptyText}>No posts yet. Share your first update.</Text> : null}
          {feed.map((post) => (
            <View key={post.id} style={styles.postCard}>
              <Text style={styles.postName}>{post.user_name}</Text>
              <Text style={styles.postMessage}>{post.message}</Text>
              <Text style={styles.postMeta}>
                Equity {post.total_equity.toFixed(2)} | PnL {post.total_pnl_pct.toFixed(2)}% |{' '}
                {new Date(post.created_at).toLocaleString()}
              </Text>
            </View>
          ))}
        </View>
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
  shareCard: { backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 12, gap: 8 },
  input: {
    minHeight: 76,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2B616D',
    backgroundColor: '#0B2830',
    color: '#E4FFF9',
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
    fontSize: 13,
  },
  shareBtn: { backgroundColor: '#27E2BF', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  shareText: { color: '#073A32', fontSize: 13, fontWeight: '700' },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  stateText: { color: '#DDFBF4', fontSize: 12, fontWeight: '600' },
  errorCard: { backgroundColor: '#4C1F25', borderRadius: 12, borderWidth: 1, borderColor: '#9D4652', padding: 12 },
  errorText: { color: '#FFDADF', fontSize: 12, fontWeight: '600' },
  sectionCard: { backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 14 },
  sectionTitle: { color: '#F3FFFC', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  rank: { color: '#27E2BF', fontWeight: '700', width: 32 },
  rowBody: { flex: 1 },
  name: { color: '#F3FFFC', fontSize: 14, fontWeight: '700' },
  meta: { color: '#9BD3C8', fontSize: 11, marginTop: 2 },
  emptyText: { color: '#9BD3C8', fontSize: 12 },
  postCard: { borderTopColor: '#2A5A64', borderTopWidth: 1, paddingTop: 10, marginTop: 6 },
  postName: { color: '#F3FFFC', fontSize: 13, fontWeight: '700' },
  postMessage: { color: '#D8FFF7', fontSize: 13, marginTop: 4 },
  postMeta: { color: '#9BD3C8', fontSize: 11, marginTop: 5 },
});
