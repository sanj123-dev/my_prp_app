import axios, { AxiosError } from 'axios';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export type QuizOption = {
  id: string;
  label: string;
  correct: boolean;
};

export type LearnPathwaySummary = {
  slug: string;
  title: string;
  progress: number;
  time_left: string;
  icon: 'wallet-outline' | 'trending-up-outline' | 'shield-checkmark-outline';
  summary: string;
};

export type LearnPathwayDetail = LearnPathwaySummary & {
  steps: string[];
  total_steps: number;
  completed_steps: number;
};

export type Challenge = {
  id: string;
  title: string;
  description: string;
  days: string[];
  completed: boolean[];
  progress: number;
};

export type LearnTool = {
  label: string;
  icon: 'stats-chart-outline' | 'book-outline' | 'eye-outline' | 'warning-outline';
  route: string;
  blurb: string;
};

export type LearnHome = {
  user_name: string;
  mascot_progress: number;
  quiz_question: string;
  quiz_options: QuizOption[];
  quiz_feedback_correct: string;
  quiz_feedback_wrong: string;
  pathways: LearnPathwaySummary[];
  challenge: Challenge;
  tools: LearnTool[];
};

export type DailyDose = {
  id: string;
  date_key: string;
  tag: string;
  title: string;
  body: string;
  steps: string[];
  reward_xp: number;
  claimed: boolean;
  streak_days: number;
};

export type DailyDoseClaim = {
  claimed: boolean;
  reward_xp: number;
  streak_days: number;
};

export type GlossaryTerm = {
  id: string;
  term: string;
  meaning: string;
};

export type WatchlistItem = {
  id: string;
  user_id: string;
  symbol: string;
  note: string;
  followed: boolean;
};

export type Pitfall = {
  id: string;
  title: string;
  detail: string;
  habit: string;
  saved: boolean;
};

export type PitfallList = {
  saved_count: number;
  items: Pitfall[];
};

const requireBackendUrl = () => {
  if (!EXPO_PUBLIC_BACKEND_URL) {
    throw new Error('Backend URL is not configured');
  }
};

const buildMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const detail = (error as AxiosError<{ detail?: string }>).response?.data?.detail;
    return detail || fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

export const getLearnHome = async (userId: string): Promise<LearnHome> => {
  requireBackendUrl();
  try {
    const response = await axios.get<LearnHome>(`${EXPO_PUBLIC_BACKEND_URL}/api/learn/home/${userId}`);
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load learn home'));
  }
};

export const getLearnPathway = async (slug: string, userId: string): Promise<LearnPathwayDetail> => {
  requireBackendUrl();
  try {
    const response = await axios.get<LearnPathwayDetail>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/pathways/${slug}`,
      {
        params: { user_id: userId },
      }
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load pathway'));
  }
};

export const updateLearnPathwayProgress = async (
  slug: string,
  userId: string,
  progress: number
): Promise<LearnPathwayDetail> => {
  requireBackendUrl();
  try {
    const response = await axios.put<LearnPathwayDetail>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/pathways/${slug}/progress`,
      null,
      {
        params: { user_id: userId, progress },
      }
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to update pathway progress'));
  }
};

export const getDailyDose = async (userId: string): Promise<DailyDose> => {
  requireBackendUrl();
  try {
    const response = await axios.get<DailyDose>(`${EXPO_PUBLIC_BACKEND_URL}/api/learn/daily-dose/${userId}`);
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load daily dose'));
  }
};

export const claimDailyDose = async (userId: string): Promise<DailyDoseClaim> => {
  requireBackendUrl();
  try {
    const response = await axios.post<DailyDoseClaim>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/daily-dose/${userId}/claim`
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to claim reward'));
  }
};

export const getChallenge = async (userId: string): Promise<Challenge> => {
  requireBackendUrl();
  try {
    const response = await axios.get<Challenge>(`${EXPO_PUBLIC_BACKEND_URL}/api/learn/challenge/${userId}`);
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load challenge'));
  }
};

export const toggleChallengeCheckIn = async (userId: string, dayIndex: number): Promise<Challenge> => {
  requireBackendUrl();
  try {
    const response = await axios.put<Challenge>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/challenge/${userId}/check-in`,
      { day_index: dayIndex }
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to update challenge'));
  }
};

export const getGlossaryTerms = async (query: string): Promise<GlossaryTerm[]> => {
  requireBackendUrl();
  try {
    const response = await axios.get<GlossaryTerm[]>(`${EXPO_PUBLIC_BACKEND_URL}/api/learn/glossary`, {
      params: { q: query, limit: 100 },
    });
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load glossary'));
  }
};

export const getWatchlist = async (userId: string): Promise<WatchlistItem[]> => {
  requireBackendUrl();
  try {
    const response = await axios.get<WatchlistItem[]>(`${EXPO_PUBLIC_BACKEND_URL}/api/learn/watchlist/${userId}`);
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load watchlist'));
  }
};

export const updateWatchlistItem = async (
  userId: string,
  symbol: string,
  payload: { followed?: boolean; note?: string }
): Promise<WatchlistItem> => {
  requireBackendUrl();
  try {
    const response = await axios.put<WatchlistItem>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/watchlist/${userId}/${symbol}`,
      payload
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to update watchlist'));
  }
};

export const getPitfalls = async (userId: string): Promise<PitfallList> => {
  requireBackendUrl();
  try {
    const response = await axios.get<PitfallList>(`${EXPO_PUBLIC_BACKEND_URL}/api/learn/pitfalls/${userId}`);
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load pitfalls'));
  }
};

export const savePitfall = async (
  userId: string,
  pitfallId: string,
  saved: boolean
): Promise<{ saved_count: number; saved: boolean }> => {
  requireBackendUrl();
  try {
    const response = await axios.post<{ saved_count: number; saved: boolean }>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/pitfalls/${userId}/${pitfallId}/save`,
      null,
      { params: { saved } }
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to save pitfall'));
  }
};
