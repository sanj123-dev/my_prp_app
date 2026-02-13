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
import { getSimulationHome, joinSimulationRoom, type SimulationHome } from '../../lib/learnApi';

export default function SimulatorScreen() {
  const [home, setHome] = React.useState<SimulationHome | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [roomCode, setRoomCode] = React.useState('');
  const [roomName, setRoomName] = React.useState('');
  const [joining, setJoining] = React.useState(false);

  const loadHome = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const uid = await getSavedUserId();
      if (!uid) {
        setError('Login required to access simulation');
        return;
      }
      setUserId(uid);
      const payload = await getSimulationHome(uid);
      setHome(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load simulation');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadHome();
  }, [loadHome]);

  const onJoinOrCreateRoom = async () => {
    if (!userId || joining) return;
    setJoining(true);
    setError(null);
    try {
      await joinSimulationRoom(userId, {
        room_code: roomCode.trim() || undefined,
        room_name: roomName.trim() || undefined,
        is_public: true,
      });
      setRoomCode('');
      setRoomName('');
      await loadHome();
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Unable to join room');
    } finally {
      setJoining(false);
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
          <Text style={styles.heroTitle}>Investment Simulation Arena</Text>
          <Text style={styles.heroBody}>Choose avatar, join rooms, trade assets, and share progress.</Text>
          <Text style={styles.priceText}>
            Active Room: {home?.active_room.name ?? '--'} ({home?.active_room.code ?? '--'})
          </Text>
        </View>

        {loading ? (
          <View style={styles.stateRow}>
            <ActivityIndicator color="#27E2BF" />
            <Text style={styles.stateText}>Loading simulation...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Cash Balance</Text>
            <Text style={styles.metricValue}>Rs {home?.portfolio.cash_balance.toFixed(2) ?? '0.00'}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Total Equity</Text>
            <Text style={styles.metricValue}>Rs {home?.portfolio.total_equity.toFixed(2) ?? '0.00'}</Text>
          </View>
        </View>

        <View style={styles.metricCardLarge}>
          <Text style={styles.metricLabel}>PnL</Text>
          <Text style={styles.metricValue}>Rs {home?.portfolio.total_pnl.toFixed(2) ?? '0.00'}</Text>
          <Text style={styles.metricSubValue}>{home?.portfolio.total_pnl_pct.toFixed(2) ?? '0.00'}%</Text>
        </View>

        <View style={styles.roomCard}>
          <Text style={styles.roomTitle}>Join or Create Multiplayer Room</Text>
          <TextInput
            value={roomCode}
            onChangeText={setRoomCode}
            placeholder="Existing room code (optional)"
            placeholderTextColor="#7FB3AA"
            style={styles.input}
            autoCapitalize="characters"
          />
          <TextInput
            value={roomName}
            onChangeText={setRoomName}
            placeholder="New room name (optional)"
            placeholderTextColor="#7FB3AA"
            style={styles.input}
          />
          <TouchableOpacity style={styles.joinBtn} onPress={onJoinOrCreateRoom} disabled={joining}>
            <Text style={styles.joinText}>{joining ? 'Updating...' : 'Join / Create Room'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.navBtn} onPress={() => router.push('/learn/simulator-avatar')}>
          <Ionicons name="person-circle-outline" size={18} color="#073A32" />
          <Text style={styles.navBtnText}>1. Choose Avatar</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navBtn} onPress={() => router.push('/learn/simulator-market')}>
          <Ionicons name="bar-chart-outline" size={18} color="#073A32" />
          <Text style={styles.navBtnText}>2. Trade Market Assets</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navBtn} onPress={() => router.push('/learn/simulator-portfolio')}>
          <Ionicons name="wallet-outline" size={18} color="#073A32" />
          <Text style={styles.navBtnText}>3. Portfolio & Trade History</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navBtn} onPress={() => router.push('/learn/simulator-social')}>
          <Ionicons name="people-outline" size={18} color="#073A32" />
          <Text style={styles.navBtnText}>4. Leaderboard & Social Feed</Text>
        </TouchableOpacity>
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
  heroTitle: { color: '#F3FFFC', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  heroBody: { color: '#A5CEC7', fontSize: 14, marginBottom: 10 },
  priceText: { color: '#27E2BF', fontSize: 13, fontWeight: '700' },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  stateText: { color: '#DDFBF4', fontSize: 12, fontWeight: '600' },
  errorCard: { backgroundColor: '#4C1F25', borderRadius: 12, borderWidth: 1, borderColor: '#9D4652', padding: 12 },
  errorText: { color: '#FFDADF', fontSize: 12, fontWeight: '600' },
  metricsRow: { flexDirection: 'row', gap: 10 },
  metricCard: { flex: 1, backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 14 },
  metricCardLarge: { backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 14 },
  metricLabel: { color: '#9BD3C8', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  metricValue: { color: '#F3FFFC', fontSize: 18, fontWeight: '700' },
  metricSubValue: { color: '#9BD3C8', fontSize: 12, marginTop: 6 },
  roomCard: { backgroundColor: '#0F3138', borderRadius: 14, borderWidth: 1, borderColor: '#1E4E57', padding: 14, gap: 8 },
  roomTitle: { color: '#F3FFFC', fontSize: 14, fontWeight: '700' },
  input: {
    backgroundColor: '#0B2830',
    borderColor: '#1F535E',
    borderWidth: 1,
    borderRadius: 10,
    color: '#E4FFF9',
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  joinBtn: { backgroundColor: '#27E2BF', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  joinText: { color: '#073A32', fontWeight: '700', fontSize: 13 },
  navBtn: {
    backgroundColor: '#27E2BF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  navBtnText: { color: '#073A32', fontWeight: '700', fontSize: 14 },
});
