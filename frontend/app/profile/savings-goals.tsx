import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import {
  GoalPlannerV2Panel,
  GoalPlannerV2Plan,
  GoalPlannerV2Progress,
  GoalPlannerV2Prompt,
  getGoalPlansV2,
  startGoalPlannerV2,
  submitGoalPlannerTurnV2,
} from '../../lib/goalPlannerApi';

type ChatRow = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
};

const formatInr = (v: unknown) => {
  const n = Number(v ?? 0);
  if (Number.isNaN(n)) return '\u20B90';
  return `\u20B9${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

export default function SavingsGoalsScreen() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [progress, setProgress] = useState<GoalPlannerV2Progress | null>(null);
  const [prompt, setPrompt] = useState<GoalPlannerV2Prompt | null>(null);
  const [panels, setPanels] = useState<GoalPlannerV2Panel[]>([]);
  const [latestPlan, setLatestPlan] = useState<GoalPlannerV2Plan | null>(null);
  const [plans, setPlans] = useState<GoalPlannerV2Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<GoalPlannerV2Plan | null>(null);
  const [chat, setChat] = useState<ChatRow[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    void bootstrap(false);
  }, []);

  const bootstrap = async (forceNew: boolean) => {
    try {
      setLoading(true);
      const saved = await getSavedUserId();
      if (!saved) {
        Alert.alert('Login required', 'Please login to use goal planner.');
        router.replace('/login');
        return;
      }
      setUserId(saved);
      const payload = await startGoalPlannerV2(saved, forceNew);
      hydrate(payload, true);
      const previous = await getGoalPlansV2(saved, 8);
      setPlans(previous);
      setSelectedPlan(previous.length > 0 ? previous[0] : null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load planner';
      Alert.alert('Goal Planner', message);
    } finally {
      setLoading(false);
    }
  };

  const hydrate = (payload: GoalPlannerV2Progress, resetChat = false) => {
    setSessionId(payload.session_id);
    setProgress(payload);
    setPrompt(payload.next_prompt ?? null);
    setPanels(payload.panels ?? []);
    if (payload.plan) setLatestPlan(payload.plan);

    const assistantText = payload.next_prompt ? `${payload.assistant_message}\n\n${payload.next_prompt.prompt}` : payload.assistant_message;
    setChat((prev) => {
      const base = resetChat ? [] : prev;
      const last = base.length > 0 ? base[base.length - 1] : null;
      if (last && last.role === 'assistant' && last.text.trim() === assistantText.trim()) return base;
      return [...base, { id: `a-${Date.now()}-${Math.random()}`, role: 'assistant', text: assistantText }];
    });
  };

  const submitTurn = async (raw: string | boolean) => {
    if (!userId || !sessionId || !prompt) return;
    let outgoing: string | number | boolean = raw;
    if (prompt.input_type === 'number') {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        Alert.alert('Invalid input', 'Please enter a valid number.');
        return;
      }
      outgoing = n;
    }
    if (prompt.input_type === 'text' && `${raw}`.trim().length === 0) {
      Alert.alert('Missing input', 'Please enter your answer.');
      return;
    }

    try {
      setSubmitting(true);
      setChat((prev) => [...prev, { id: `u-${Date.now()}-${Math.random()}`, role: 'user', text: `${raw}` }]);
      setInput('');
      const payload = await submitGoalPlannerTurnV2(sessionId, userId, outgoing);
      hydrate(payload);
      if (payload.plan) {
        const previous = await getGoalPlansV2(userId, 8);
        setPlans(previous);
        setSelectedPlan(previous.length > 0 ? previous[0] : null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send planner message';
      Alert.alert('Goal Planner', message);
    } finally {
      setSubmitting(false);
    }
  };

  const keyboardType = useMemo<'default' | 'numeric'>(
    () => (prompt?.input_type === 'number' ? 'numeric' : 'default'),
    [prompt]
  );
  const isDone = progress?.status === 'completed';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Goal Planner v2</Text>
          <Text style={styles.subtitle}>Adaptive personal planning agent</Text>
        </View>
        <TouchableOpacity style={styles.restartButton} onPress={() => void bootstrap(true)}>
          <Ionicons name="refresh" size={16} color="#fff" />
          <Text style={styles.restartText}>New</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator color="#4CAF50" size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.chatCard}>
            {chat.map((row) => (
              <View key={row.id} style={[styles.bubble, row.role === 'assistant' ? styles.assistantBubble : styles.userBubble]}>
                <Text style={styles.bubbleText}>{row.text}</Text>
              </View>
            ))}
          </View>

          {!isDone && prompt ? (
            <View style={styles.inputCard}>
              {prompt.help_text ? <Text style={styles.helpText}>{prompt.help_text}</Text> : null}
              {prompt.input_type === 'boolean' ? (
                <View style={styles.choiceWrap}>
                  <TouchableOpacity style={styles.choiceBtn} onPress={() => void submitTurn('yes')}>
                    <Text style={styles.choiceText}>Yes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.choiceBtn} onPress={() => void submitTurn('no')}>
                    <Text style={styles.choiceText}>No</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {prompt.input_type === 'choice' ? (
                <View style={styles.choiceWrap}>
                  {prompt.choices.map((item) => (
                    <TouchableOpacity key={item} style={styles.choiceBtn} onPress={() => void submitTurn(item)}>
                      <Text style={styles.choiceText}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
              {prompt.input_type !== 'choice' && prompt.input_type !== 'boolean' ? (
                <View style={styles.inputRow}>
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    placeholder={prompt.placeholder ?? 'Type your answer'}
                    placeholderTextColor="#8087a2"
                    style={styles.input}
                    keyboardType={keyboardType}
                  />
                  <TouchableOpacity style={[styles.sendBtn, submitting && { opacity: 0.6 }]} disabled={submitting} onPress={() => void submitTurn(input)}>
                    <Ionicons name="send" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : null}

          {panels.length > 0 ? (
            <View style={styles.planCard}>
              <Text style={styles.planTitle}>Planner Insights</Text>
              {panels.map((panel) => (
                <View key={panel.id} style={styles.sectionCard}>
                  <Text style={styles.planSubTitle}>{panel.title}</Text>
                  {panel.summary ? <Text style={styles.planLine}>{panel.summary}</Text> : null}
                  {panel.items.map((item, idx) => (
                    <Text key={`${panel.id}-${idx}`} style={styles.planLine}>
                      - {item.label}: {item.value}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          ) : null}

          {latestPlan ? (
            <View style={styles.planCard}>
              <Text style={styles.planTitle}>Final Plan</Text>
              <Text style={styles.planLine}>Goal: {latestPlan.goal_title}</Text>
              <Text style={styles.planLine}>Target: {formatInr(latestPlan.target_amount)}</Text>
              <Text style={styles.planLine}>Required/month: {formatInr(latestPlan.estimated_monthly_required)}</Text>
              <Text style={styles.planLine}>Recommended/month: {formatInr(latestPlan.recommended_monthly)}</Text>
              <Text style={styles.planLine}>Projected completion: {latestPlan.projected_completion_months} months</Text>
              <Text style={styles.planLine}>{latestPlan.summary}</Text>
            </View>
          ) : null}

          {plans.length > 0 ? (
            <View style={styles.planCard}>
              <Text style={styles.planTitle}>Previous Goals</Text>
              <View style={styles.goalGrid}>
                {plans.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.goalCard, selectedPlan?.id === item.id ? styles.goalCardActive : null]}
                    onPress={() => setSelectedPlan(item)}
                  >
                    <Text style={styles.goalCardTitle}>{item.goal_title}</Text>
                    <Text style={styles.goalCardMeta}>{formatInr(item.target_amount)}</Text>
                    <Text style={styles.goalCardMeta}>{item.projected_completion_months} months</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {selectedPlan ? (
                <View style={styles.selectedCard}>
                  <Text style={styles.planSubTitle}>Goal Detail</Text>
                  <Text style={styles.planLine}>Goal: {selectedPlan.goal_title}</Text>
                  <Text style={styles.planLine}>Target: {formatInr(selectedPlan.target_amount)}</Text>
                  <Text style={styles.planLine}>Required/month: {formatInr(selectedPlan.estimated_monthly_required)}</Text>
                  <Text style={styles.planLine}>Recommended/month: {formatInr(selectedPlan.recommended_monthly)}</Text>
                  <Text style={styles.planLine}>Projection: {selectedPlan.projected_completion_months} months</Text>
                  <Text style={styles.planLine}>{selectedPlan.summary}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 10 },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a3e', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#9aa0b4', fontSize: 12, marginTop: 2 },
  restartButton: { backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a3e', borderRadius: 14, paddingHorizontal: 10, height: 32, flexDirection: 'row', alignItems: 'center', gap: 4 },
  restartText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  loaderWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  chatCard: { backgroundColor: '#121a2f', borderRadius: 14, borderWidth: 1, borderColor: '#243252', padding: 12, gap: 8 },
  bubble: { borderRadius: 12, padding: 10 },
  assistantBubble: { backgroundColor: '#1b2740' },
  userBubble: { backgroundColor: '#233f2f', alignSelf: 'flex-end' },
  bubbleText: { color: '#e8ecff', lineHeight: 20, fontSize: 14 },
  inputCard: { backgroundColor: '#1a1a2e', borderRadius: 14, borderWidth: 1, borderColor: '#2a2a3e', padding: 12, gap: 10 },
  helpText: { color: '#8f98b4', fontSize: 12 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceBtn: { backgroundColor: '#273351', borderRadius: 10, borderWidth: 1, borderColor: '#344978', paddingVertical: 8, paddingHorizontal: 12 },
  choiceText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, backgroundColor: '#10182d', borderRadius: 10, borderWidth: 1, borderColor: '#344978', color: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  sendBtn: { height: 42, width: 42, borderRadius: 10, backgroundColor: '#4CAF50', alignItems: 'center', justifyContent: 'center' },
  planCard: { backgroundColor: '#18241f', borderRadius: 14, borderWidth: 1, borderColor: '#2f4c42', padding: 14, gap: 10 },
  sectionCard: { backgroundColor: '#14251f', borderRadius: 12, borderWidth: 1, borderColor: '#29473d', padding: 10, gap: 4 },
  selectedCard: { backgroundColor: '#102018', borderRadius: 12, borderWidth: 1, borderColor: '#2f5d4d', padding: 10, gap: 6 },
  goalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  goalCard: { width: '48%', backgroundColor: '#112036', borderRadius: 12, borderWidth: 1, borderColor: '#243252', padding: 10, gap: 4 },
  goalCardActive: { borderColor: '#4CAF50', backgroundColor: '#142b22' },
  goalCardTitle: { color: '#fff', fontWeight: '700', fontSize: 13 },
  goalCardMeta: { color: '#b8c7ef', fontSize: 12 },
  planTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  planSubTitle: { color: '#d8ffef', fontWeight: '700', marginBottom: 6 },
  planLine: { fontSize: 14, color: '#d8ffef', lineHeight: 20 },
});
