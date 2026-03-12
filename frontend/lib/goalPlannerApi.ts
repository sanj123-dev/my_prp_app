import axios, { AxiosError } from 'axios';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const requireBackendUrl = () => {
  if (!EXPO_PUBLIC_BACKEND_URL) {
    throw new Error('Backend URL is not configured');
  }
};

const buildMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const detail = (error as AxiosError<{ detail?: string | { msg?: string }[] }>).response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first.msg === 'string' && first.msg.trim()) {
        return first.msg;
      }
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

export type GoalPlannerQuestion = {
  key: string;
  prompt: string;
  answer_type: 'text' | 'number' | 'boolean' | 'choice';
  required: boolean;
  choices: string[];
  placeholder?: string | null;
  help_text?: string | null;
};

export type GoalPrerequisite = {
  id: string;
  title: string;
  reason: string;
  suggested_monthly_allocation: number;
  estimated_months: number;
  type: 'emergency_fund' | 'insurance' | 'debt_reduction' | 'protection';
};

export type GoalPlan = {
  id: string;
  user_id: string;
  session_id: string;
  goal_name: string;
  target_amount: number;
  target_months: number;
  monthly_budget_selected: number;
  monthly_budget_recommended: number;
  required_monthly_for_goal: number;
  feasible_now: boolean;
  projected_completion_months: number;
  household_context: Record<string, unknown>;
  prerequisites: GoalPrerequisite[];
  flow_steps: Record<string, unknown>[];
  actionable_insights: string[];
  summary: string;
  created_at: string;
};

export type GoalPlannerProgress = {
  session_id: string;
  status: 'active' | 'completed';
  progress_pct: number;
  assistant_message: string;
  question?: GoalPlannerQuestion | null;
  completed_plan?: GoalPlan | null;
};

export const startGoalPlanner = async (userId: string, forceNew = false): Promise<GoalPlannerProgress> => {
  requireBackendUrl();
  try {
    const response = await axios.post<GoalPlannerProgress>(`${EXPO_PUBLIC_BACKEND_URL}/api/goals/planner/start`, {
      user_id: userId,
      force_new: forceNew,
    });
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to start goal planner'));
  }
};

export const submitGoalPlannerAnswer = async (
  sessionId: string,
  userId: string,
  answer: string | number | boolean
): Promise<GoalPlannerProgress> => {
  requireBackendUrl();
  try {
    const response = await axios.post<GoalPlannerProgress>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/goals/planner/${sessionId}/answer`,
      { answer },
      { params: { user_id: userId } }
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to submit answer'));
  }
};

export const getGoalPlans = async (userId: string, limit = 10): Promise<GoalPlan[]> => {
  requireBackendUrl();
  try {
    const response = await axios.get<GoalPlan[]>(`${EXPO_PUBLIC_BACKEND_URL}/api/goals`, {
      params: { user_id: userId, limit },
    });
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load goal plans'));
  }
};

export type GoalPlannerV2Prompt = {
  key: string;
  prompt: string;
  input_type: 'text' | 'number' | 'boolean' | 'choice';
  required: boolean;
  choices: string[];
  placeholder?: string | null;
  help_text?: string | null;
};

export type GoalPlannerV2Panel = {
  id: string;
  title: string;
  summary?: string | null;
  items: Array<{ label: string; value: string }>;
};

export type GoalPlannerV2Plan = {
  id: string;
  user_id: string;
  session_id: string;
  source: 'v1' | 'v2';
  goal_type: string;
  goal_title: string;
  target_amount: number;
  target_months: number;
  estimated_monthly_required: number;
  recommended_monthly: number;
  projected_completion_months: number;
  feasible_now: boolean;
  confidence: number;
  cost_model: Record<string, unknown>;
  feasibility: Record<string, unknown>;
  alternatives: Array<Record<string, unknown>>;
  execution_phases: Array<Record<string, unknown>>;
  panels: GoalPlannerV2Panel[];
  summary: string;
  created_at: string;
};

export type GoalPlannerV2Progress = {
  session_id: string;
  status: 'collecting' | 'planning' | 'completed';
  assistant_message: string;
  next_prompt?: GoalPlannerV2Prompt | null;
  panels: GoalPlannerV2Panel[];
  progress: Record<string, unknown>;
  plan?: GoalPlannerV2Plan | null;
};

export const startGoalPlannerV2 = async (userId: string, forceNew = false): Promise<GoalPlannerV2Progress> => {
  requireBackendUrl();
  try {
    const response = await axios.post<GoalPlannerV2Progress>(`${EXPO_PUBLIC_BACKEND_URL}/api/goals/v2/session/start`, {
      user_id: userId,
      force_new: forceNew,
    });
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to start goal planner v2'));
  }
};

export const submitGoalPlannerTurnV2 = async (
  sessionId: string,
  userId: string,
  message: string | number | boolean
): Promise<GoalPlannerV2Progress> => {
  requireBackendUrl();
  try {
    const response = await axios.post<GoalPlannerV2Progress>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/goals/v2/session/${sessionId}/turn`,
      { message },
      { params: { user_id: userId } }
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to send goal planner turn'));
  }
};

export const getGoalPlansV2 = async (userId: string, limit = 10): Promise<GoalPlannerV2Plan[]> => {
  requireBackendUrl();
  try {
    const response = await axios.get<GoalPlannerV2Plan[]>(`${EXPO_PUBLIC_BACKEND_URL}/api/goals/v2/plans`, {
      params: { user_id: userId, limit },
    });
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load goal planner v2 plans'));
  }
};

export type GoalPlannerV2PlanUpdatePayload = {
  goal_title?: string;
  target_amount?: number;
  target_months?: number;
  recommended_monthly?: number;
};

export const updateGoalPlanV2 = async (
  planId: string,
  userId: string,
  payload: GoalPlannerV2PlanUpdatePayload
): Promise<GoalPlannerV2Plan> => {
  requireBackendUrl();
  try {
    const response = await axios.put<GoalPlannerV2Plan>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/goals/v2/plans/${planId}`,
      payload,
      { params: { user_id: userId } }
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to update goal plan'));
  }
};

export const deleteGoalPlanV2 = async (planId: string, userId: string): Promise<boolean> => {
  requireBackendUrl();
  try {
    await axios.delete(`${EXPO_PUBLIC_BACKEND_URL}/api/goals/v2/plans/${planId}`, {
      params: { user_id: userId },
    });
    return true;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to delete goal plan'));
  }
};
