import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import { GoalPlannerV2Plan, getGoalPlansV2 } from '../../lib/goalPlannerApi';

const formatInr = (value: unknown) => {
  const num = Number(value ?? 0);
  if (Number.isNaN(num)) return '\u20B90';
  return `\u20B9${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const toPairs = (value: Record<string, unknown> | undefined) => {
  if (!value) return [];
  return Object.entries(value).filter(([, v]) => v !== null && v !== undefined && `${v}`.trim().length > 0);
};

const toTitle = (key: string) =>
  key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const toNumber = (v: unknown, fallback = 0) => {
  const n = Number(v ?? fallback);
  return Number.isNaN(n) ? fallback : n;
};

const parseActions = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
};

const parseMilestones = (value: unknown): Array<{ month: number; target_saved_inr: number }> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const month = Number((item as { month?: unknown }).month);
      const target = Number((item as { target_saved_inr?: unknown }).target_saved_inr);
      if (Number.isNaN(month) || Number.isNaN(target)) return null;
      return { month, target_saved_inr: target };
    })
    .filter((item): item is { month: number; target_saved_inr: number } => Boolean(item));
};

export default function GoalDetailScreen() {
  const params = useLocalSearchParams<{ goalId?: string }>();
  const goalId = typeof params.goalId === 'string' ? params.goalId : '';

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<GoalPlannerV2Plan | null>(null);

  useEffect(() => {
    const loadGoal = async () => {
      try {
        setLoading(true);
        const userId = await getSavedUserId();
        if (!userId) {
          router.replace('/login');
          return;
        }

        const all = await getGoalPlansV2(userId, 50);
        const selected = all.find((item) => item.id === goalId) ?? null;
        setPlan(selected);
      } catch (error) {
        console.error('Failed to load goal details:', error);
      } finally {
        setLoading(false);
      }
    };

    if (goalId) {
      void loadGoal();
    } else {
      setLoading(false);
    }
  }, [goalId]);

  const feasibilityItems = useMemo(() => toPairs(plan?.feasibility as Record<string, unknown>), [plan]);

  const timeline = useMemo(() => {
    if (!plan) return null;
    const f = (plan.feasibility ?? {}) as Record<string, unknown>;
    const target = Math.max(0, toNumber(f.target_amount_inr, plan.target_amount));
    const current = Math.max(0, toNumber(f.current_savings_inr, 0));
    const remaining = Math.max(0, target - current);
    const normalMonthly = Math.max(1, toNumber(f.recommended_monthly_inr, plan.recommended_monthly));
    const requiredMonthly = Math.max(1, toNumber(f.required_monthly_inr, plan.estimated_monthly_required));
    const extraMonthly = Math.max(requiredMonthly, normalMonthly * 1.25);
    const normalMonths = Math.max(1, Math.ceil(remaining / normalMonthly));
    const extraMonths = Math.max(1, Math.ceil(remaining / extraMonthly));
    const monthsSaved = Math.max(0, normalMonths - extraMonths);
    const fastWidth = Math.max(12, Math.round((extraMonths / normalMonths) * 100));
    return { normalMonthly, extraMonthly, normalMonths, extraMonths, monthsSaved, fastWidth };
  }, [plan]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Goal Details</Text>
          <Text style={styles.subtitle}>Plan breakdown and execution roadmap</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      ) : !plan ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Goal not found</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/profile/savings-goals')}>
            <Text style={styles.primaryBtnText}>Back to Goals</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.heroCard}>
            <Text style={styles.goalTitle}>{plan.goal_title}</Text>
            <Text style={styles.targetAmount}>{formatInr(plan.target_amount)}</Text>
            <View style={styles.heroRow}>
              <View style={styles.heroPill}>
                <Text style={styles.heroPillLabel}>Required</Text>
                <Text style={styles.heroPillValue}>{formatInr(plan.estimated_monthly_required)}/mo</Text>
              </View>
              <View style={styles.heroPill}>
                <Text style={styles.heroPillLabel}>Recommended</Text>
                <Text style={styles.heroPillValue}>{formatInr(plan.recommended_monthly)}/mo</Text>
              </View>
            </View>
            <Text style={styles.summary}>{plan.summary}</Text>
          </View>

          {timeline ? (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Goal Timeline (Visual)</Text>
              <Text style={styles.timelineHint}>Increase monthly saving by about 25% to reach faster.</Text>

              <View style={styles.timelineStatsRow}>
                <View style={styles.timelinePill}>
                  <Text style={styles.timelinePillLabel}>Current Pace</Text>
                  <Text style={styles.timelinePillValue}>{timeline.normalMonths} months</Text>
                  <Text style={styles.timelinePillSub}>{formatInr(timeline.normalMonthly)}/month</Text>
                </View>
                <View style={[styles.timelinePill, styles.timelinePillFast]}>
                  <Text style={styles.timelinePillLabel}>Extra Effort</Text>
                  <Text style={styles.timelinePillValue}>{timeline.extraMonths} months</Text>
                  <Text style={styles.timelinePillSub}>{formatInr(timeline.extraMonthly)}/month</Text>
                </View>
              </View>

              <View style={styles.trackBlock}>
                <Text style={styles.trackLabel}>Current pace timeline</Text>
                <View style={styles.track}>
                  <View style={styles.trackFillBase} />
                </View>
              </View>

              <View style={styles.trackBlock}>
                <Text style={styles.trackLabel}>With extra effort timeline</Text>
                <View style={styles.track}>
                  <View style={[styles.trackFillFast, { width: `${timeline.fastWidth}%` }]} />
                </View>
              </View>

              <Text style={styles.timelineSummary}>
                You can save about {timeline.monthsSaved} month{timeline.monthsSaved === 1 ? '' : 's'} by raising your monthly contribution.
              </Text>
            </View>
          ) : null}

          {feasibilityItems.length > 0 ? (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Affordability Check</Text>
              {feasibilityItems.map(([key, value]) => (
                <View key={key} style={styles.rowLine}>
                  <Text style={styles.rowLabel}>{key.replace(/_/g, ' ')}</Text>
                  <Text style={styles.rowValue}>{`${value}`}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {plan.alternatives.length > 0 ? (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Alternatives</Text>
              {plan.alternatives.map((item, idx) => (
                <View key={`${idx}-${JSON.stringify(item)}`} style={styles.bulletItem}>
                  <Text style={styles.bulletTitle}>Option {idx + 1}</Text>
                  {Object.entries(item).map(([key, value]) => (
                    <Text key={`${idx}-${key}`} style={styles.bulletText}>
                      {toTitle(key)}: {`${value}`}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          ) : null}

          {plan.execution_phases.length > 0 ? (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Execution Roadmap</Text>
              {plan.execution_phases.map((phase, idx) => {
                const actions = parseActions(phase.actions);
                const milestones = parseMilestones(phase.milestones);
                return (
                  <View key={`${idx}-${JSON.stringify(phase)}`} style={styles.phaseCard}>
                    <View style={styles.phaseHeader}>
                      <Text style={styles.phaseBadge}>Phase {idx + 1}</Text>
                      {typeof phase.duration_months === 'number' ? (
                        <Text style={styles.phaseDuration}>{phase.duration_months} month{phase.duration_months > 1 ? 's' : ''}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.phaseTitle}>
                      {typeof phase.title === 'string' ? phase.title : typeof phase.phase === 'string' ? phase.phase : `Stage ${idx + 1}`}
                    </Text>

                    {actions.length > 0 ? (
                      <View style={styles.phaseBlock}>
                        <Text style={styles.phaseLabel}>Action Steps</Text>
                        {actions.map((action, actionIdx) => (
                          <Text key={`${idx}-action-${actionIdx}`} style={styles.phaseLine}>
                            - {action}
                          </Text>
                        ))}
                      </View>
                    ) : null}

                    {milestones.length > 0 ? (
                      <View style={styles.phaseBlock}>
                        <Text style={styles.phaseLabel}>Milestones</Text>
                        {milestones.map((milestone, msIdx) => (
                          <View key={`${idx}-milestone-${msIdx}`} style={styles.milestoneRow}>
                            <Text style={styles.milestoneMonth}>Month {milestone.month}</Text>
                            <Text style={styles.milestoneValue}>{formatInr(milestone.target_saved_inr)}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {Object.entries(phase)
                      .filter(([k]) => !['phase', 'title', 'duration_months', 'actions', 'milestones'].includes(k))
                      .map(([key, value]) => (
                        <View key={`${idx}-${key}`} style={styles.rowLine}>
                          <Text style={styles.rowLabel}>{toTitle(key)}</Text>
                          <Text style={styles.rowValue}>{`${value}`}</Text>
                        </View>
                      ))}
                  </View>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
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
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#95a1c4', fontSize: 12, marginTop: 2 },
  loaderWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 18, gap: 12 },
  heroCard: {
    backgroundColor: '#171d38',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27345e',
    padding: 14,
    gap: 10,
  },
  goalTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  targetAmount: { color: '#75e7aa', fontSize: 28, fontWeight: '900' },
  heroRow: { flexDirection: 'row', gap: 10 },
  heroPill: { flex: 1, backgroundColor: '#1e2748', borderRadius: 12, borderWidth: 1, borderColor: '#314272', padding: 10, gap: 4 },
  heroPillLabel: { color: '#9bb0dc', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  heroPillValue: { color: '#fff', fontSize: 14, fontWeight: '700' },
  summary: { color: '#c7d3f4', fontSize: 13, lineHeight: 19 },
  sectionCard: {
    backgroundColor: '#171d38',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27345e',
    padding: 14,
    gap: 8,
  },
  sectionTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  rowLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 4 },
  rowLabel: { color: '#9bb0dc', flex: 1, textTransform: 'capitalize' },
  rowValue: { color: '#fff', flex: 1, textAlign: 'right', fontWeight: '600' },
  bulletItem: { backgroundColor: '#1e2748', borderRadius: 12, borderWidth: 1, borderColor: '#314272', padding: 10, gap: 4 },
  bulletTitle: { color: '#dce8ff', fontWeight: '700' },
  bulletText: { color: '#c7d3f4', fontSize: 12, lineHeight: 18 },
  timelineHint: { color: '#9bb0dc', fontSize: 12, lineHeight: 18 },
  timelineStatsRow: { flexDirection: 'row', gap: 8 },
  timelinePill: { flex: 1, backgroundColor: '#1e2748', borderRadius: 12, borderWidth: 1, borderColor: '#314272', padding: 10, gap: 4 },
  timelinePillFast: { borderColor: '#2f8f61', backgroundColor: '#183428' },
  timelinePillLabel: { color: '#9bb0dc', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  timelinePillValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
  timelinePillSub: { color: '#b6c8f2', fontSize: 12, fontWeight: '600' },
  trackBlock: { gap: 6 },
  trackLabel: { color: '#c7d3f4', fontSize: 12, fontWeight: '600' },
  track: { height: 12, borderRadius: 999, backgroundColor: '#28365f', overflow: 'hidden' },
  trackFillBase: { width: '100%', height: '100%', backgroundColor: '#4a5f9f' },
  trackFillFast: { height: '100%', backgroundColor: '#4CAF50' },
  timelineSummary: { color: '#dce8ff', fontSize: 13, lineHeight: 19, fontWeight: '600' },
  phaseCard: { backgroundColor: '#1b2547', borderRadius: 12, borderWidth: 1, borderColor: '#314272', padding: 12, gap: 8 },
  phaseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  phaseBadge: { color: '#dce8ff', fontSize: 12, fontWeight: '800', backgroundColor: '#2a3769', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  phaseDuration: { color: '#9bb0dc', fontSize: 12, fontWeight: '700' },
  phaseTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  phaseBlock: { gap: 6, backgroundColor: '#17203d', borderRadius: 10, borderWidth: 1, borderColor: '#2b3a68', padding: 10 },
  phaseLabel: { color: '#b6c8f2', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  phaseLine: { color: '#e4ecff', fontSize: 13, lineHeight: 18 },
  milestoneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  milestoneMonth: { color: '#c7d3f4', fontSize: 13, fontWeight: '600' },
  milestoneValue: { color: '#75e7aa', fontSize: 13, fontWeight: '800' },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  primaryBtn: { backgroundColor: '#4CAF50', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
});
