from __future__ import annotations

from datetime import datetime
from math import ceil
from typing import Any, Dict, List, Optional
import uuid

from .schemas import (
    GoalPlan,
    GoalPlannerProgress,
    GoalPlannerQuestion,
    GoalPlannerSession,
    GoalPrerequisite,
)


class GoalPlannerService:
    def __init__(self, db: Any) -> None:
        self.db = db
        self.questions: List[GoalPlannerQuestion] = [
            GoalPlannerQuestion(
                key="have_existing_goal",
                prompt="Before we start, do you already have a financial goal in mind?",
                answer_type="boolean",
                help_text="Answer yes/no. If yes, I will align your new plan with that goal.",
            ),
            GoalPlannerQuestion(
                key="existing_goal_details",
                prompt="Great. Tell me your existing goal in one line.",
                answer_type="text",
                placeholder="Example: Save 5,00,000 for home down payment",
                help_text="This helps avoid conflict with your current plan.",
            ),
            GoalPlannerQuestion(
                key="monthly_income",
                prompt="What is your average monthly take-home income?",
                answer_type="number",
                placeholder="Example: 85000",
            ),
            GoalPlannerQuestion(
                key="marital_status",
                prompt="What is your family status?",
                answer_type="choice",
                choices=["single", "married"],
            ),
            GoalPlannerQuestion(
                key="children_count",
                prompt="How many children are financially dependent on you?",
                answer_type="number",
                placeholder="Example: 0",
            ),
            GoalPlannerQuestion(
                key="dependent_parents_count",
                prompt="How many dependent parents do you support?",
                answer_type="number",
                placeholder="Example: 0",
            ),
            GoalPlannerQuestion(
                key="monthly_household_expenses",
                prompt="What are your monthly core household expenses (rent, food, utilities, transport)?",
                answer_type="number",
                placeholder="Example: 45000",
            ),
            GoalPlannerQuestion(
                key="monthly_loan_emi",
                prompt="How much do you currently pay as total monthly loan EMI?",
                answer_type="number",
                placeholder="Example: 12000 (enter 0 if none)",
            ),
            GoalPlannerQuestion(
                key="outstanding_loan_amount",
                prompt="What is your total outstanding loan amount?",
                answer_type="number",
                placeholder="Example: 250000 (enter 0 if none)",
            ),
            GoalPlannerQuestion(
                key="emergency_fund_available",
                prompt="How much emergency fund do you currently have (liquid cash/savings)?",
                answer_type="number",
                placeholder="Example: 100000",
            ),
            GoalPlannerQuestion(
                key="has_health_insurance",
                prompt="Do you have active health insurance for yourself/family?",
                answer_type="boolean",
            ),
            GoalPlannerQuestion(
                key="health_insurance_monthly_premium",
                prompt="What is your monthly health insurance premium?",
                answer_type="number",
                placeholder="Example: 3000",
            ),
            GoalPlannerQuestion(
                key="has_life_insurance",
                prompt="Do you currently have life insurance?",
                answer_type="boolean",
                help_text="Important if spouse/children/parents depend on your income.",
            ),
            GoalPlannerQuestion(
                key="primary_goal_name",
                prompt="Now, what new goal do you want to plan?",
                answer_type="text",
                placeholder="Example: Child education fund",
            ),
            GoalPlannerQuestion(
                key="goal_target_amount",
                prompt="What is the total amount needed for this goal?",
                answer_type="number",
                placeholder="Example: 800000",
            ),
            GoalPlannerQuestion(
                key="goal_target_months",
                prompt="In how many months do you want to complete this goal?",
                answer_type="number",
                placeholder="Example: 24",
            ),
            GoalPlannerQuestion(
                key="preferred_monthly_goal_budget",
                prompt="How much can you comfortably allocate per month for this goal?",
                answer_type="number",
                placeholder="Example: 20000",
            ),
            GoalPlannerQuestion(
                key="risk_comfort",
                prompt="What is your risk comfort for goal planning?",
                answer_type="choice",
                choices=["low", "medium", "high"],
                help_text="This is for planning style only, not investment advice.",
            ),
        ]

    async def start(self, *, user_id: str, force_new: bool = False) -> GoalPlannerProgress:
        if not force_new:
            active = await self.db.goal_planner_sessions.find_one(
                {"user_id": user_id, "status": "active"},
                sort=[("updated_at", -1)],
            )
            if active:
                return self._progress_from_session(GoalPlannerSession(**active))

        session = GoalPlannerSession(user_id=user_id)
        await self.db.goal_planner_sessions.insert_one(session.model_dump())
        return self._progress_from_session(session)

    async def get_progress(self, *, user_id: str, session_id: str) -> GoalPlannerProgress:
        doc = await self.db.goal_planner_sessions.find_one({"id": session_id, "user_id": user_id})
        if not doc:
            raise ValueError("Planner session not found")
        session = GoalPlannerSession(**doc)
        return self._progress_from_session(session)

    async def answer(self, *, user_id: str, session_id: str, answer: Any) -> GoalPlannerProgress:
        doc = await self.db.goal_planner_sessions.find_one({"id": session_id, "user_id": user_id, "status": "active"})
        if not doc:
            raise ValueError("Active planner session not found")
        session = GoalPlannerSession(**doc)
        question = self._current_question(session.answers, session.step_index)
        if not question:
            return self._progress_from_session(session)

        parsed = self._parse_answer(question, answer)
        session.answers[question.key] = parsed
        session.step_index = self._next_step_index(session.answers, session.step_index + 1)
        session.updated_at = datetime.utcnow()

        if session.step_index >= len(self.questions):
            plan = await self._build_plan(user_id=user_id, session=session)
            session.status = "completed"
            session.plan_id = plan.id
            await self.db.goal_planner_sessions.update_one(
                {"id": session.id},
                {"$set": session.model_dump()},
            )
            return GoalPlannerProgress(
                session_id=session.id,
                status="completed",
                progress_pct=100.0,
                assistant_message=plan.summary,
                completed_plan=plan,
            )

        await self.db.goal_planner_sessions.update_one(
            {"id": session.id},
            {"$set": session.model_dump()},
        )
        return self._progress_from_session(session)

    async def list_user_plans(self, *, user_id: str, limit: int = 10) -> List[GoalPlan]:
        docs = await (
            self.db.goal_plans
            .find({"user_id": user_id})
            .sort("created_at", -1)
            .limit(limit)
            .to_list(limit)
        )
        return [GoalPlan(**doc) for doc in docs]

    def _progress_from_session(self, session: GoalPlannerSession) -> GoalPlannerProgress:
        current_idx = self._next_step_index(session.answers, session.step_index)
        if current_idx >= len(self.questions):
            progress = 100.0
            question = None
            message = "I have all required details. Building your complete goal roadmap."
        else:
            session.step_index = current_idx
            answered = len(session.answers.keys())
            progress = round((answered / len(self.questions)) * 100.0, 1)
            question = self.questions[current_idx]
            message = "I will ask a few practical questions, like a financial planner, to build your goal roadmap."

        return GoalPlannerProgress(
            session_id=session.id,
            status="active" if session.status == "active" else "completed",
            progress_pct=progress,
            assistant_message=message,
            question=question,
        )

    def _should_ask(self, key: str, answers: Dict[str, Any]) -> bool:
        if key == "existing_goal_details":
            return bool(answers.get("have_existing_goal", False))
        if key == "health_insurance_monthly_premium":
            return bool(answers.get("has_health_insurance", False))
        return True

    def _next_step_index(self, answers: Dict[str, Any], start: int) -> int:
        idx = max(0, start)
        while idx < len(self.questions):
            q = self.questions[idx]
            if self._should_ask(q.key, answers):
                if q.key not in answers:
                    return idx
            idx += 1
        return len(self.questions)

    def _current_question(self, answers: Dict[str, Any], step_index: int) -> Optional[GoalPlannerQuestion]:
        idx = self._next_step_index(answers, step_index)
        if idx >= len(self.questions):
            return None
        return self.questions[idx]

    def _parse_answer(self, question: GoalPlannerQuestion, raw: Any) -> Any:
        if question.answer_type == "text":
            value = str(raw or "").strip()
            if question.required and not value:
                raise ValueError("Please provide a value")
            return value[:250]

        if question.answer_type == "number":
            text = str(raw).strip()
            if not text:
                raise ValueError("Please enter a number")
            try:
                value = float(text)
            except Exception as exc:
                raise ValueError("Invalid number") from exc
            if value < 0:
                raise ValueError("Value cannot be negative")
            return round(value, 2)

        if question.answer_type == "boolean":
            text = str(raw).strip().lower()
            if text in {"yes", "y", "true", "1"}:
                return True
            if text in {"no", "n", "false", "0"}:
                return False
            if isinstance(raw, bool):
                return raw
            raise ValueError("Please answer yes or no")

        if question.answer_type == "choice":
            text = str(raw or "").strip().lower()
            allowed = {item.lower() for item in question.choices}
            if text not in allowed:
                raise ValueError(f"Please choose one of: {', '.join(question.choices)}")
            return text

        raise ValueError("Unsupported answer type")

    async def _build_plan(self, *, user_id: str, session: GoalPlannerSession) -> GoalPlan:
        a = session.answers
        income = float(a.get("monthly_income", 0.0))
        household = float(a.get("monthly_household_expenses", 0.0))
        emi = float(a.get("monthly_loan_emi", 0.0))
        outstanding_loan = float(a.get("outstanding_loan_amount", 0.0))
        emergency_available = float(a.get("emergency_fund_available", 0.0))
        has_health = bool(a.get("has_health_insurance", False))
        health_premium = float(a.get("health_insurance_monthly_premium", 0.0)) if has_health else 0.0
        has_life = bool(a.get("has_life_insurance", False))
        children = int(float(a.get("children_count", 0)))
        parents = int(float(a.get("dependent_parents_count", 0)))
        marital = str(a.get("marital_status", "single"))
        goal_name = str(a.get("primary_goal_name", "Financial Goal")).strip() or "Financial Goal"
        target_amount = float(a.get("goal_target_amount", 0.0))
        target_months = max(1, int(float(a.get("goal_target_months", 1))))
        preferred_budget = float(a.get("preferred_monthly_goal_budget", 0.0))
        risk = str(a.get("risk_comfort", "medium"))

        dependents = children + parents + (1 if marital == "married" else 0)
        essential = household + emi + health_premium
        surplus = max(0.0, income - essential)
        recommended_emergency_months = 6 if dependents > 0 else 3
        emergency_target = essential * recommended_emergency_months
        emergency_gap = max(0.0, emergency_target - emergency_available)
        loan_ratio = (emi / income) if income > 0 else 0.0
        required_monthly = target_amount / target_months if target_amount > 0 else 0.0
        recommended_budget = min(surplus, preferred_budget if preferred_budget > 0 else surplus)

        prerequisites: List[GoalPrerequisite] = []
        if emergency_gap > 0:
            emergency_monthly = max(1000.0, min(surplus * 0.35, emergency_gap / 12 if emergency_gap > 0 else 0.0))
            prerequisites.append(
                GoalPrerequisite(
                    id=str(uuid.uuid4()),
                    title="Build emergency fund",
                    reason=(
                        f"You should keep {recommended_emergency_months} months of essentials before aggressive goal funding."
                    ),
                    suggested_monthly_allocation=round(emergency_monthly, 2),
                    estimated_months=max(1, ceil(emergency_gap / max(1.0, emergency_monthly))),
                    type="emergency_fund",
                )
            )

        if not has_health:
            prerequisites.append(
                GoalPrerequisite(
                    id=str(uuid.uuid4()),
                    title="Activate health insurance",
                    reason="Health risk without cover can derail any savings goal.",
                    suggested_monthly_allocation=3000.0,
                    estimated_months=1,
                    type="insurance",
                )
            )

        if dependents > 0 and not has_life:
            prerequisites.append(
                GoalPrerequisite(
                    id=str(uuid.uuid4()),
                    title="Start life insurance protection",
                    reason="Dependents need income protection.",
                    suggested_monthly_allocation=2000.0,
                    estimated_months=1,
                    type="protection",
                )
            )

        if outstanding_loan > 0 and loan_ratio >= 0.4:
            debt_monthly = max(2000.0, surplus * 0.2)
            prerequisites.append(
                GoalPrerequisite(
                    id=str(uuid.uuid4()),
                    title="Reduce high debt pressure",
                    reason="Loan EMI is high relative to income; reducing debt improves goal stability.",
                    suggested_monthly_allocation=round(debt_monthly, 2),
                    estimated_months=max(3, ceil(outstanding_loan / max(1.0, debt_monthly + emi))),
                    type="debt_reduction",
                )
            )

        prerequisite_total = sum(item.suggested_monthly_allocation for item in prerequisites)
        goal_monthly_after_prereq = max(0.0, recommended_budget - prerequisite_total)
        feasible = goal_monthly_after_prereq >= required_monthly and required_monthly > 0
        projected_months = target_months if feasible else (
            max(target_months, ceil(target_amount / max(1.0, goal_monthly_after_prereq))) if target_amount > 0 else target_months
        )
        prereq_months = max((item.estimated_months for item in prerequisites), default=0)

        flow_steps: List[Dict[str, Any]] = []
        if prerequisites:
            flow_steps.append(
                {
                    "phase": "Phase 1",
                    "title": "Stability and protection first",
                    "duration_months": prereq_months,
                    "actions": [item.title for item in prerequisites],
                }
            )
        flow_steps.append(
            {
                "phase": "Phase 2",
                "title": f"Fund {goal_name}",
                "duration_months": projected_months,
                "monthly_allocation": round(goal_monthly_after_prereq, 2),
                "required_monthly": round(required_monthly, 2),
            }
        )

        summary = (
            f"Goal plan created for '{goal_name}'. "
            f"Monthly income is {income:.0f}, essentials are {essential:.0f}, and safe surplus is {surplus:.0f}. "
            f"{'We added prerequisite steps first. ' if prerequisites else ''}"
            f"Target needs {required_monthly:.0f}/month; projected completion is about {projected_months} months."
        )

        plan = GoalPlan(
            user_id=user_id,
            session_id=session.id,
            goal_name=goal_name,
            target_amount=round(target_amount, 2),
            target_months=target_months,
            monthly_budget_selected=round(preferred_budget, 2),
            monthly_budget_recommended=round(goal_monthly_after_prereq, 2),
            required_monthly_for_goal=round(required_monthly, 2),
            feasible_now=feasible,
            projected_completion_months=projected_months + prereq_months,
            household_context={
                "marital_status": marital,
                "children_count": children,
                "dependent_parents_count": parents,
                "risk_comfort": risk,
                "dependents_total": dependents,
                "loan_to_income_ratio": round(loan_ratio, 2),
            },
            prerequisites=prerequisites,
            flow_steps=flow_steps,
            summary=summary,
        )
        await self.db.goal_plans.insert_one(plan.model_dump())
        await self._upsert_prerequisite_habits(user_id=user_id, plan=plan)
        return plan

    async def _upsert_prerequisite_habits(self, *, user_id: str, plan: GoalPlan) -> None:
        for item in plan.prerequisites:
            existing = await self.db.habits.find_one(
                {
                    "user_id": user_id,
                    "goal": item.title,
                    "status": {"$in": ["active", "completed"]},
                }
            )
            if existing:
                continue
            target_amount = max(item.suggested_monthly_allocation * max(1, item.estimated_months), 1.0)
            payload = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "goal": item.title,
                "target_amount": round(target_amount, 2),
                "current_amount": 0.0,
                "category": "Protection" if item.type in {"insurance", "protection"} else "Savings",
                "start_date": datetime.utcnow(),
                "end_date": None,
                "status": "active",
                "progress": 0.0,
            }
            await self.db.habits.insert_one(payload)


async def init_goal_module(db: Any) -> None:
    await db.goal_planner_sessions.create_index([("id", 1)], unique=True)
    await db.goal_planner_sessions.create_index([("user_id", 1), ("status", 1), ("updated_at", -1)])
    await db.goal_plans.create_index([("id", 1)], unique=True)
    await db.goal_plans.create_index([("user_id", 1), ("created_at", -1)])

