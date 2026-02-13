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
  player_profile: PlayerProfile;
  daily_missions: DailyMission[];
  daily_login_reward_claimed: boolean;
  today_content: GameContentCard;
  boss_challenge: BossChallenge;
  leaderboard: LeaderboardEntry[];
  pathways: LearnPathwaySummary[];
  challenge: Challenge;
  tools: LearnTool[];
};

export type GameContentCard = {
  id: string;
  title: string;
  hook: string;
  lesson: string;
  action: string;
  difficulty: string;
  reward_xp: number;
};

export type BossChallenge = {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  reward_xp: number;
  reward_coins: number;
};

export type LeaderboardEntry = {
  rank: number;
  user_name: string;
  level: number;
  total_xp: number;
};

export type PlayerProfile = {
  level: number;
  total_xp: number;
  xp_in_level: number;
  xp_to_next_level: number;
  streak_days: number;
  coins: number;
  last_active_date?: string | null;
};

export type DailyMission = {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  reward_xp: number;
  reward_coins: number;
  completed: boolean;
  claimed: boolean;
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

export type QuizAnswerResult = {
  correct: boolean;
  feedback: string;
  reward_xp: number;
  reward_coins: number;
  profile: PlayerProfile;
  daily_missions: DailyMission[];
};

export type MissionClaimResult = {
  mission: DailyMission;
  profile: PlayerProfile;
};

export type SimulationAvatarOption = {
  id: string;
  name: string;
  title: string;
  emoji: string;
  style: string;
};

export type SimulationRoom = {
  id: string;
  code: string;
  name: string;
  member_count: number;
  is_public: boolean;
  created_by: string;
};

export type SimulationAsset = {
  symbol: string;
  name: string;
  category: string;
  current_price: number;
  price_change_pct: number;
  day_high: number;
  day_low: number;
  volume: number;
};

export type SimulationPosition = {
  symbol: string;
  name: string;
  category: string;
  quantity: number;
  average_buy_price: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
};

export type SimulationTrade = {
  id: string;
  user_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  notional: number;
  fee: number;
  executed_at: string;
};

export type SimulationPortfolioSnapshot = {
  starting_cash: number;
  cash_balance: number;
  invested_value: number;
  total_equity: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  total_pnl_pct: number;
  positions: SimulationPosition[];
  recent_trades: SimulationTrade[];
};

export type SimulationPlayerStanding = {
  rank: number;
  user_id: string;
  user_name: string;
  avatar_id: string;
  total_equity: number;
  total_pnl_pct: number;
  cash_balance: number;
};

export type SimulationFeedPost = {
  id: string;
  user_id: string;
  user_name: string;
  avatar_id: string;
  room_code: string;
  message: string;
  total_equity: number;
  total_pnl_pct: number;
  created_at: string;
};

export type SimulationHome = {
  user_id: string;
  active_avatar_id: string;
  avatar_options: SimulationAvatarOption[];
  active_room: SimulationRoom;
  rooms: SimulationRoom[];
  market: SimulationAsset[];
  portfolio: SimulationPortfolioSnapshot;
  leaderboard: SimulationPlayerStanding[];
  feed: SimulationFeedPost[];
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

export const submitLearnQuizAnswer = async (
  userId: string,
  optionId: string
): Promise<QuizAnswerResult> => {
  requireBackendUrl();
  try {
    const response = await axios.post<QuizAnswerResult>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/game/${userId}/quiz-answer`,
      { option_id: optionId }
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to submit quiz answer'));
  }
};

export const claimLearnMission = async (
  userId: string,
  missionId: string
): Promise<MissionClaimResult> => {
  requireBackendUrl();
  try {
    const response = await axios.post<MissionClaimResult>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/game/${userId}/missions/${missionId}/claim`
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to claim mission reward'));
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

export const getSimulationHome = async (userId: string): Promise<SimulationHome> => {
  requireBackendUrl();
  try {
    const response = await axios.get<SimulationHome>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/simulation/${userId}/home`
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load simulation home'));
  }
};

export const chooseSimulationAvatar = async (
  userId: string,
  avatarId: string
): Promise<SimulationHome> => {
  requireBackendUrl();
  try {
    const response = await axios.put<SimulationHome>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/simulation/${userId}/avatar`,
      { avatar_id: avatarId }
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to choose avatar'));
  }
};

export const joinSimulationRoom = async (
  userId: string,
  payload: { room_code?: string; room_name?: string; is_public?: boolean }
): Promise<SimulationRoom> => {
  requireBackendUrl();
  try {
    const response = await axios.post<SimulationRoom>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/simulation/${userId}/rooms`,
      payload
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to join room'));
  }
};

export const executeSimulationTrade = async (
  userId: string,
  payload: { symbol: string; side: 'buy' | 'sell'; quantity: number }
): Promise<SimulationTrade> => {
  requireBackendUrl();
  try {
    const response = await axios.post<SimulationTrade>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/simulation/${userId}/trade`,
      payload
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to execute trade'));
  }
};

export const getSimulationPortfolio = async (userId: string): Promise<SimulationPortfolioSnapshot> => {
  requireBackendUrl();
  try {
    const response = await axios.get<SimulationPortfolioSnapshot>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/simulation/${userId}/portfolio`
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load portfolio'));
  }
};

export const getSimulationLeaderboard = async (userId: string): Promise<SimulationPlayerStanding[]> => {
  requireBackendUrl();
  try {
    const response = await axios.get<SimulationPlayerStanding[]>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/simulation/${userId}/leaderboard`
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load leaderboard'));
  }
};

export const shareSimulationUpdate = async (
  userId: string,
  message: string
): Promise<SimulationFeedPost> => {
  requireBackendUrl();
  try {
    const response = await axios.post<SimulationFeedPost>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/simulation/${userId}/share`,
      { message }
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to share update'));
  }
};

export const getSimulationFeed = async (
  userId: string,
  limit = 20
): Promise<SimulationFeedPost[]> => {
  requireBackendUrl();
  try {
    const response = await axios.get<SimulationFeedPost[]>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/learn/simulation/${userId}/feed`,
      { params: { limit } }
    );
    return response.data;
  } catch (error) {
    throw new Error(buildMessage(error, 'Unable to load simulation feed'));
  }
};
