import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import {
  GoalPlan,
  GoalPlannerProgress,
  GoalPlannerQuestion,
  getGoalPlans,
  startGoalPlanner,
  submitGoalPlannerAnswer,
} from '../../lib/goalPlannerApi';

type ChatRow = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
};

export default function SavingsGoalsScreen() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [progress, setProgress] = useState<GoalPlannerProgress | null>(null);
  const [question, setQuestion] = useState<GoalPlannerQuestion | null>(null);
  const [input, setInput] = useState('');
  const [chat, setChat] = useState<ChatRow[]>([]);
  const [latestPlan, setLatestPlan] = useState<GoalPlan | null>(null);
  const [previousPlans, setPreviousPlans] = useState<GoalPlan[]>([]);

  useEffect(() => {
    void bootstrap(false);
  }, []);

  const bootstrap = async (forceNew: boolean) => {
    try {
      setLoading(true);
      const savedUserId = await getSavedUserId();
      if (!savedUserId) {
        Alert.alert('Login required', 'Please login to use goal planner.');
        router.replace('/login');
        return;
      }
      setUserId(savedUserId);
      const payload = await startGoalPlanner(savedUserId, forceNew);
      hydrateFromProgress(payload, true);
      const plans = await getGoalPlans(savedUserId, 5);
      setPreviousPlans(plans);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load planner';
      Alert.alert('Goal Planner', message);
    } finally {
      setLoading(false);
    }
  };

  const hydrateFromProgress = (payload: GoalPlannerProgress, resetChat = false) => {
    setSessionId(payload.session_id);
    setProgress(payload);
    setQuestion(payload.question ?? null);
    if (payload.completed_plan) {
      setLatestPlan(payload.completed_plan);
    }
    const assistantText = payload.question
      ? `${payload.assistant_message}\n\n${payload.question.prompt}`
      : payload.assistant_message;
    setChat((prev) => {
      const base = resetChat ? [] : prev;
      return [
        ...base,
        {
          id: `a-${Date.now()}-${Math.random()}`,
          role: 'assistant',
          text: assistantText,
        },
      ];
    });
  };

  const submitAnswer = async (rawAnswer: string | boolean) => {
    if (!question || !sessionId || !userId) {
      return;
    }
    let answer: string | number | boolean = rawAnswer;
    if (question.answer_type === 'number') {
      const numeric = Number(rawAnswer);
      if (Number.isNaN(numeric)) {
        Alert.alert('Invalid input', 'Please enter a valid number.');
        return;
      }
      answer = numeric;
    }
    if (question.answer_type === 'text' && `${rawAnswer}`.trim().length === 0) {
      Alert.alert('Missing input', 'Please enter your answer.');
      return;
    }

    try {
      setSubmitting(true);
      setChat((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}-${Math.random()}`,
          role: 'user',
          text: `${rawAnswer}`,
        },
      ]);
      setInput('');
      const payload = await submitGoalPlannerAnswer(sessionId, userId, answer);
      hydrateFromProgress(payload);
      if (payload.completed_plan) {
        const plans = await getGoalPlans(userId, 5);
        setPreviousPlans(plans);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit answer';
      Alert.alert('Goal Planner', message);
    } finally {
      setSubmitting(false);
    }
  };

  const keyboardType = useMemo<'default' | 'numeric'>(
    () => (question?.answer_type === 'number' ? 'numeric' : 'default'),
    [question]
  );
  const isCompleted = progress?.status === 'completed';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Goal Planner</Text>
          <Text style={styles.subtitle}>Human-like budget planning</Text>
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
          <View style={styles.progressCard}>
            <Text style={styles.progressLabel}>Planner progress</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress?.progress_pct ?? 0}%` }]} />
            </View>
            <Text style={styles.progressValue}>{Math.round(progress?.progress_pct ?? 0)}%</Text>
          </View>

          <View style={styles.chatCard}>
            {chat.map((row) => (
              <View key={row.id} style={[styles.bubble, row.role === 'assistant' ? styles.assistantBubble : styles.userBubble]}>
                <Text style={styles.bubbleText}>{row.text}</Text>
              </View>
            ))}
          </View>

          {!isCompleted && question && (
            <View style={styles.inputCard}>
              {question.help_text ? <Text style={styles.helpText}>{question.help_text}</Text> : null}
              {question.answer_type === 'boolean' ? (
                <View style={styles.choiceWrap}>
                  <TouchableOpacity style={styles.choiceBtn} onPress={() => void submitAnswer('yes')}>
                    <Text style={styles.choiceText}>Yes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.choiceBtn} onPress={() => void submitAnswer('no')}>
                    <Text style={styles.choiceText}>No</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {question.answer_type === 'choice' ? (
                <View style={styles.choiceWrap}>
                  {question.choices.map((item) => (
                    <TouchableOpacity key={item} style={styles.choiceBtn} onPress={() => void submitAnswer(item)}>
                      <Text style={styles.choiceText}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              {question.answer_type !== 'boolean' && question.answer_type !== 'choice' ? (
                <View style={styles.inputRow}>
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    placeholder={question.placeholder ?? 'Type your answer'}
                    placeholderTextColor="#8087a2"
                    style={styles.input}
                    keyboardType={keyboardType}
                  />
                  <TouchableOpacity
                    style={[styles.sendBtn, submitting && { opacity: 0.6 }]}
                    disabled={submitting}
                    onPress={() => void submitAnswer(input)}
                  >
                    <Ionicons name="send" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          )}

          {latestPlan ? (
            <View style={styles.planCard}>
              <Text style={styles.planTitle}>Generated Plan: {latestPlan.goal_name}</Text>
              <Text style={styles.planLine}>Required monthly: {'\u20B9'}{latestPlan.required_monthly_for_goal.toFixed(0)}</Text>
              <Text style={styles.planLine}>Recommended monthly: {'\u20B9'}{latestPlan.monthly_budget_recommended.toFixed(0)}</Text>
              <Text style={styles.planLine}>
                Completion estimate: {latestPlan.projected_completion_months} months ({latestPlan.feasible_now ? 'feasible' : 'needs adjustment'})
              </Text>
              {latestPlan.prerequisites.length > 0 ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.planSubTitle}>Prerequisites first</Text>
                  {latestPlan.prerequisites.map((item) => (
                    <Text key={item.id} style={styles.planLine}>
                      - {item.title} - {'\u20B9'}{item.suggested_monthly_allocation.toFixed(0)}/mo for ~{item.estimated_months} months
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {previousPlans.length > 0 ? (
            <View style={styles.planCard}>
              <Text style={styles.planSubTitle}>Previous Plans</Text>
              {previousPlans.map((item) => (
                <Text key={item.id} style={styles.planLine}>
                  - {item.goal_name} ({item.projected_completion_months} months)
                </Text>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 10,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    color: '#9aa0b4',
    fontSize: 12,
    marginTop: 2,
  },
  restartButton: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 14,
    paddingHorizontal: 10,
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  restartText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  loaderWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  progressCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    padding: 16,
  },
  progressLabel: {
    color: '#9aa0b4',
    fontSize: 12,
    marginBottom: 8,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#111629',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
  },
  progressValue: {
    color: '#fff',
    marginTop: 8,
    fontSize: 13,
    fontWeight: '700',
  },
  chatCard: {
    backgroundColor: '#121a2f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#243252',
    padding: 12,
    gap: 8,
  },
  bubble: {
    borderRadius: 12,
    padding: 10,
  },
  assistantBubble: {
    backgroundColor: '#1b2740',
  },
  userBubble: {
    backgroundColor: '#233f2f',
    alignSelf: 'flex-end',
  },
  bubbleText: {
    color: '#e8ecff',
    lineHeight: 20,
    fontSize: 14,
  },
  inputCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    padding: 12,
    gap: 10,
  },
  helpText: {
    color: '#8f98b4',
    fontSize: 12,
  },
  choiceWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceBtn: {
    backgroundColor: '#273351',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#344978',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  choiceText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#10182d',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#344978',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  sendBtn: {
    height: 42,
    width: 42,
    borderRadius: 10,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planCard: {
    backgroundColor: '#18241f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2f4c42',
    padding: 14,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  planSubTitle: {
    color: '#d8ffef',
    fontWeight: '700',
    marginBottom: 6,
  },
  planLine: {
    fontSize: 14,
    color: '#d8ffef',
    lineHeight: 20,
  },
});
