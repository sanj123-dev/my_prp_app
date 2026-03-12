import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import { GoalPlannerV2Plan, getGoalPlansV2 } from '../../lib/goalPlannerApi';

const formatInr = (value: number) => `\u20B9${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const formatDate = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function SavingsGoalsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [plans, setPlans] = useState<GoalPlannerV2Plan[]>([]);

  const loadPlans = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const userId = await getSavedUserId();
      if (!userId) {
        router.replace('/login');
        return;
      }

      const nextPlans = await getGoalPlansV2(userId, 20);
      setPlans(nextPlans);
    } catch (error) {
      console.error('Failed to load goals:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans(false);
  }, [loadPlans]);

  const openPlanner = () => {
    router.push('/profile/goal-planner');
  };

  const openGoal = (goalId: string) => {
    router.push({ pathname: '/profile/goal-details', params: { goalId } });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>Goals</Text>
          <Text style={styles.subtitle}>Track and improve your savings plans</Text>
        </View>
        <TouchableOpacity style={styles.iconBtn} onPress={openPlanner}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      ) : (
        <FlatList
          data={plans}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPlans(true)} tintColor="#4CAF50" />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="trophy-outline" size={34} color="#8ea4d8" />
              <Text style={styles.emptyTitle}>No goals yet</Text>
              <Text style={styles.emptyText}>Tap + to create your first smart financial goal plan.</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={openPlanner}>
                <Text style={styles.primaryBtnText}>Create Goal</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => openGoal(item.id)}>
              <View style={styles.cardTopRow}>
                <Text style={styles.goalTitle} numberOfLines={1}>
                  {item.goal_title}
                </Text>
                <Ionicons name="chevron-forward" size={18} color="#8ea4d8" />
              </View>
              <Text style={styles.goalAmount}>{formatInr(item.target_amount)}</Text>
              <View style={styles.metaRow}>
                <View style={styles.metaPill}>
                  <Ionicons name="calendar-outline" size={13} color="#9bb0dc" />
                  <Text style={styles.metaText}>{item.projected_completion_months} months</Text>
                </View>
                <View style={styles.metaPill}>
                  <Ionicons name="time-outline" size={13} color="#9bb0dc" />
                  <Text style={styles.metaText}>{formatDate(item.created_at)}</Text>
                </View>
              </View>
              <Text style={styles.summary} numberOfLines={2}>
                {item.summary}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1022' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8, gap: 10 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a3559',
    backgroundColor: '#1a2240',
  },
  titleWrap: { flex: 1 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#95a1c4', fontSize: 12, marginTop: 2 },
  loaderWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 18, paddingTop: 8, gap: 12, flexGrow: 1 },
  card: {
    backgroundColor: '#171d38',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27345e',
    padding: 14,
    gap: 8,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  goalTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  goalAmount: { color: '#75e7aa', fontSize: 22, fontWeight: '800' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1f294b',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaText: { color: '#9bb0dc', fontSize: 11, fontWeight: '600' },
  summary: { color: '#c7d3f4', fontSize: 13, lineHeight: 19 },
  emptyCard: {
    flex: 1,
    marginTop: 50,
    backgroundColor: '#171d38',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27345e',
    padding: 18,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  emptyText: { color: '#9bb0dc', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  primaryBtn: {
    marginTop: 6,
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
});
