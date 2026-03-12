import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Platform, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import { GoalPlannerV2Plan, deleteGoalPlanV2, getGoalPlansV2, updateGoalPlanV2 } from '../../lib/goalPlannerApi';

const formatInr = (value: number) => `\u20B9${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const formatDate = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function SavingsGoalsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState('');
  const [plans, setPlans] = useState<GoalPlannerV2Plan[]>([]);
  const [editVisible, setEditVisible] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [editingPlan, setEditingPlan] = useState<GoalPlannerV2Plan | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editMonths, setEditMonths] = useState('');

  const loadPlans = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const userId = await getSavedUserId();
      if (!userId) {
        router.replace('/login');
        return;
      }
      setUserId(userId);

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

  const openEditModal = (plan: GoalPlannerV2Plan) => {
    setEditingPlan(plan);
    setEditTitle(plan.goal_title);
    setEditAmount(`${Math.round(plan.target_amount)}`);
    setEditMonths(`${plan.target_months}`);
    setEditVisible(true);
  };

  const submitEdit = async () => {
    if (!editingPlan || !userId) return;
    const title = editTitle.trim();
    const amount = Number(editAmount);
    const months = Number(editMonths);

    if (!title) {
      Alert.alert('Invalid input', 'Goal title is required.');
      return;
    }
    if (Number.isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid input', 'Target amount must be greater than zero.');
      return;
    }
    if (Number.isNaN(months) || months <= 0) {
      Alert.alert('Invalid input', 'Target months must be a positive number.');
      return;
    }

    try {
      setSavingEdit(true);
      await updateGoalPlanV2(editingPlan.id, userId, {
        goal_title: title,
        target_amount: amount,
        target_months: months,
      });
      setEditVisible(false);
      setEditingPlan(null);
      await loadPlans(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to update goal';
      Alert.alert('Goal Update', msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const deletePlan = (plan: GoalPlannerV2Plan) => {
    if (!userId) return;
    Alert.alert('Delete Goal', `Delete "${plan.goal_title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setDeletingId(plan.id);
            await deleteGoalPlanV2(plan.id, userId);
            await loadPlans(true);
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unable to delete goal';
            Alert.alert('Goal Delete', msg);
          } finally {
            setDeletingId('');
          }
        },
      },
    ]);
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
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/(tabs)/profile')}>
            <Ionicons name="person-circle-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
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
                <View style={styles.cardActions}>
                  <TouchableOpacity style={styles.cardActionBtn} onPress={() => openEditModal(item)}>
                    <Ionicons name="create-outline" size={16} color="#b9d4ff" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cardActionBtn} onPress={() => deletePlan(item)} disabled={deletingId === item.id}>
                    {deletingId === item.id ? (
                      <ActivityIndicator size="small" color="#ff8f9d" />
                    ) : (
                      <Ionicons name="trash-outline" size={16} color="#ff8f9d" />
                    )}
                  </TouchableOpacity>
                  <Ionicons name="chevron-forward" size={18} color="#8ea4d8" />
                </View>
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

      {!loading ? (
        <TouchableOpacity style={styles.fabAddButton} onPress={openPlanner}>
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      ) : null}

      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Goal</Text>
              <TouchableOpacity onPress={() => setEditVisible(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={styles.inputLabel}>Goal Title</Text>
            <TextInput style={styles.input} value={editTitle} onChangeText={setEditTitle} placeholder="Goal title" placeholderTextColor="#8393ba" />
            <Text style={styles.inputLabel}>Target Amount (INR)</Text>
            <TextInput style={styles.input} value={editAmount} onChangeText={setEditAmount} keyboardType="numeric" placeholder="150000" placeholderTextColor="#8393ba" />
            <Text style={styles.inputLabel}>Target Months</Text>
            <TextInput style={styles.input} value={editMonths} onChangeText={setEditMonths} keyboardType="numeric" placeholder="12" placeholderTextColor="#8393ba" />
            <TouchableOpacity style={styles.saveBtn} onPress={() => void submitEdit()} disabled={savingEdit}>
              {savingEdit ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1022' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8, gap: 10 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a3559',
    backgroundColor: '#1a2240',
  },
  titleWrap: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#95a1c4', fontSize: 12, marginTop: 2 },
  loaderWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 18, paddingTop: 8, gap: 12, flexGrow: 1, paddingBottom: 108 },
  card: {
    backgroundColor: '#171d38',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27345e',
    padding: 14,
    gap: 8,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardActionBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#314272',
    backgroundColor: '#1f294b',
  },
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
  fabAddButton: {
    position: 'absolute',
    right: 24,
    bottom: Platform.OS === 'android' ? 50 : 88,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#65d06d',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.28,
    shadowRadius: 9,
    elevation: 9,
    zIndex: 22,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 8, 22, 0.75)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: {
    backgroundColor: '#171d38',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2c3d67',
    padding: 14,
    gap: 8,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  inputLabel: { color: '#9bb0dc', fontSize: 12, marginTop: 4 },
  input: {
    backgroundColor: '#10182d',
    borderWidth: 1,
    borderColor: '#334c7e',
    borderRadius: 10,
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  saveBtn: {
    marginTop: 8,
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  saveBtnText: { color: '#fff', fontWeight: '700' },
});
