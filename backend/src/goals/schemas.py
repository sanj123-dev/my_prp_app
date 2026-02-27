from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
import uuid

from pydantic import BaseModel, Field


AnswerType = Literal["text", "number", "boolean", "choice"]


class GoalPlannerQuestion(BaseModel):
    key: str
    prompt: str
    answer_type: AnswerType
    required: bool = True
    choices: List[str] = Field(default_factory=list)
    placeholder: Optional[str] = None
    help_text: Optional[str] = None


class GoalPlannerSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    status: Literal["active", "completed", "cancelled"] = "active"
    step_index: int = 0
    answers: Dict[str, Any] = Field(default_factory=dict)
    plan_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class GoalPrerequisite(BaseModel):
    id: str
    title: str
    reason: str
    suggested_monthly_allocation: float = 0.0
    estimated_months: int = 0
    type: Literal["emergency_fund", "insurance", "debt_reduction", "protection"]


class GoalPlan(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    session_id: str
    goal_name: str
    target_amount: float
    target_months: int
    monthly_budget_selected: float
    monthly_budget_recommended: float
    required_monthly_for_goal: float
    feasible_now: bool
    projected_completion_months: int
    household_context: Dict[str, Any] = Field(default_factory=dict)
    prerequisites: List[GoalPrerequisite] = Field(default_factory=list)
    flow_steps: List[Dict[str, Any]] = Field(default_factory=list)
    summary: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GoalPlannerStartRequest(BaseModel):
    user_id: str
    force_new: bool = False


class GoalPlannerAnswerRequest(BaseModel):
    answer: Any


class GoalPlannerProgress(BaseModel):
    session_id: str
    status: Literal["active", "completed"]
    progress_pct: float
    assistant_message: str
    question: Optional[GoalPlannerQuestion] = None
    completed_plan: Optional[GoalPlan] = None

