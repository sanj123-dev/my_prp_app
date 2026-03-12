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
    actionable_insights: List[str] = Field(default_factory=list)
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


V2InputType = Literal["text", "number", "boolean", "choice"]
V2SessionStatus = Literal["collecting", "planning", "completed", "cancelled"]


class GoalPlannerV2Prompt(BaseModel):
    key: str
    prompt: str
    input_type: V2InputType
    required: bool = True
    choices: List[str] = Field(default_factory=list)
    placeholder: Optional[str] = None
    help_text: Optional[str] = None


class GoalPlannerV2Panel(BaseModel):
    id: str
    title: str
    summary: Optional[str] = None
    items: List[Dict[str, Any]] = Field(default_factory=list)


class GoalPlannerV2Plan(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    session_id: str
    source: Literal["v1", "v2"] = "v2"
    goal_type: str
    goal_title: str
    target_amount: float
    target_months: int
    estimated_monthly_required: float
    recommended_monthly: float
    projected_completion_months: int
    feasible_now: bool
    confidence: float = 0.0
    cost_model: Dict[str, Any] = Field(default_factory=dict)
    feasibility: Dict[str, Any] = Field(default_factory=dict)
    alternatives: List[Dict[str, Any]] = Field(default_factory=list)
    execution_phases: List[Dict[str, Any]] = Field(default_factory=list)
    panels: List[GoalPlannerV2Panel] = Field(default_factory=list)
    summary: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GoalPlannerV2Session(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    status: V2SessionStatus = "collecting"
    turn_count: int = 0
    max_turns: int = 10
    goal_context: Dict[str, Any] = Field(default_factory=dict)
    unresolved_fields: List[str] = Field(default_factory=list)
    agent_outputs: Dict[str, Any] = Field(default_factory=dict)
    dialogue: List[Dict[str, Any]] = Field(default_factory=list)
    confidence: float = 0.0
    plan_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class GoalPlannerV2StartRequest(BaseModel):
    user_id: str
    force_new: bool = False


class GoalPlannerV2TurnRequest(BaseModel):
    message: Any


class GoalPlannerV2PlanUpdateRequest(BaseModel):
    goal_title: Optional[str] = None
    target_amount: Optional[float] = Field(default=None, ge=0)
    target_months: Optional[int] = Field(default=None, ge=1, le=600)
    recommended_monthly: Optional[float] = Field(default=None, ge=0)


class GoalPlannerV2Progress(BaseModel):
    session_id: str
    status: Literal["collecting", "planning", "completed"]
    assistant_message: str
    next_prompt: Optional[GoalPlannerV2Prompt] = None
    panels: List[GoalPlannerV2Panel] = Field(default_factory=list)
    progress: Dict[str, Any] = Field(default_factory=dict)
    plan: Optional[GoalPlannerV2Plan] = None
