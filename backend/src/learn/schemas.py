from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field
import uuid


class QuizOption(BaseModel):
    id: str
    label: str
    correct: bool = False


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


class LearnHomeResponse(BaseModel):
    user_name: str
    mascot_progress: int
    quiz_question: str
    quiz_options: List[QuizOption]
    quiz_feedback_correct: str
    quiz_feedback_wrong: str
    pathways: List[LearnPathwaySummary]
    challenge: ChallengeResponse
    tools: List[LearnTool]
