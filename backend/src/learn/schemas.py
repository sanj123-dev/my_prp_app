from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field
import uuid


class QuizOption(BaseModel):
    id: str
    label: str
    correct: bool = False


class PlayerProfile(BaseModel):
    level: int
    total_xp: int
    xp_in_level: int
    xp_to_next_level: int
    streak_days: int
    coins: int
    last_active_date: Optional[str] = None


class DailyMission(BaseModel):
    id: str
    title: str
    description: str
    target: int
    progress: int
    reward_xp: int
    reward_coins: int
    completed: bool
    claimed: bool


class GameContentCard(BaseModel):
    id: str
    title: str
    hook: str
    lesson: str
    action: str
    difficulty: str
    reward_xp: int


class BossChallenge(BaseModel):
    id: str
    title: str
    description: str
    target: int
    progress: int
    reward_xp: int
    reward_coins: int


class LeaderboardEntry(BaseModel):
    rank: int
    user_name: str
    level: int
    total_xp: int


class LearnTool(BaseModel):
    label: str
    icon: str
    route: str
    blurb: str


class LearnPathwaySummary(BaseModel):
    slug: str
    title: str
    progress: int = 0
    time_left: str
    icon: str
    summary: str


class LearnPathwayDetail(LearnPathwaySummary):
    steps: List[str]
    total_steps: int
    completed_steps: int


class DailyDoseResponse(BaseModel):
    id: str
    date_key: str
    tag: str
    title: str
    body: str
    steps: List[str]
    reward_xp: int
    claimed: bool
    streak_days: int


class DailyDoseClaimResponse(BaseModel):
    claimed: bool
    reward_xp: int
    streak_days: int


class ChallengeResponse(BaseModel):
    id: str
    title: str
    description: str
    days: List[str]
    completed: List[bool]
    progress: int


class ChallengeCheckInRequest(BaseModel):
    day_index: int


class ChallengeCheckInResponse(BaseModel):
    completed: List[bool]
    progress: int


class GlossaryTerm(BaseModel):
    id: str
    term: str
    meaning: str


class WatchlistItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    symbol: str
    note: str
    followed: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class WatchlistCreateRequest(BaseModel):
    symbol: str
    note: Optional[str] = ""
    followed: bool = True


class WatchlistUpdateRequest(BaseModel):
    note: Optional[str] = None
    followed: Optional[bool] = None


class Pitfall(BaseModel):
    id: str
    title: str
    detail: str
    habit: str
    saved: bool = False


class PitfallListResponse(BaseModel):
    saved_count: int
    items: List[Pitfall]


class PitfallSaveResponse(BaseModel):
    saved_count: int
    saved: bool


class QuizAnswerRequest(BaseModel):
    option_id: str


class QuizAnswerResponse(BaseModel):
    correct: bool
    feedback: str
    reward_xp: int
    reward_coins: int
    profile: PlayerProfile
    daily_missions: List[DailyMission]


class MissionClaimResponse(BaseModel):
    mission: DailyMission
    profile: PlayerProfile


class LearnHomeResponse(BaseModel):
    user_name: str
    mascot_progress: int
    quiz_question: str
    quiz_options: List[QuizOption]
    quiz_feedback_correct: str
    quiz_feedback_wrong: str
    player_profile: PlayerProfile
    daily_missions: List[DailyMission]
    daily_login_reward_claimed: bool
    today_content: GameContentCard
    boss_challenge: BossChallenge
    leaderboard: List[LeaderboardEntry]
    pathways: List[LearnPathwaySummary]
    challenge: ChallengeResponse
    tools: List[LearnTool]


class SimulationAvatarOption(BaseModel):
    id: str
    name: str
    title: str
    emoji: str
    style: str


class SimulationRoom(BaseModel):
    id: str
    code: str
    name: str
    member_count: int
    is_public: bool
    created_by: str


class SimulationAsset(BaseModel):
    symbol: str
    name: str
    category: str
    current_price: float
    price_change_pct: float
    day_high: float
    day_low: float
    volume: float


class SimulationPosition(BaseModel):
    symbol: str
    name: str
    category: str
    quantity: float
    average_buy_price: float
    current_price: float
    market_value: float
    unrealized_pnl: float
    unrealized_pnl_pct: float


class SimulationTrade(BaseModel):
    id: str
    user_id: str
    symbol: str
    side: str
    quantity: float
    price: float
    notional: float
    fee: float
    executed_at: datetime


class SimulationPortfolioSnapshot(BaseModel):
    starting_cash: float
    cash_balance: float
    invested_value: float
    total_equity: float
    realized_pnl: float
    unrealized_pnl: float
    total_pnl: float
    total_pnl_pct: float
    positions: List[SimulationPosition]
    recent_trades: List[SimulationTrade]


class SimulationPlayerStanding(BaseModel):
    rank: int
    user_id: str
    user_name: str
    avatar_id: str
    total_equity: float
    total_pnl_pct: float
    cash_balance: float


class SimulationFeedPost(BaseModel):
    id: str
    user_id: str
    user_name: str
    avatar_id: str
    room_code: str
    message: str
    total_equity: float
    total_pnl_pct: float
    created_at: datetime


class SimulationHomeResponse(BaseModel):
    user_id: str
    active_avatar_id: str
    avatar_options: List[SimulationAvatarOption]
    active_room: SimulationRoom
    rooms: List[SimulationRoom]
    market: List[SimulationAsset]
    portfolio: SimulationPortfolioSnapshot
    leaderboard: List[SimulationPlayerStanding]
    feed: List[SimulationFeedPost]


class SimulationAvatarSelectRequest(BaseModel):
    avatar_id: str


class SimulationRoomJoinRequest(BaseModel):
    room_code: Optional[str] = None
    room_name: Optional[str] = None
    is_public: bool = True


class SimulationTradeRequest(BaseModel):
    symbol: str
    side: str
    quantity: float = Field(..., gt=0)


class SimulationFeedShareRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=280)
