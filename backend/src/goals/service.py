from __future__ import annotations

from datetime import datetime
from math import ceil
from typing import Any, Dict, List, Optional
import os
import uuid

from .schemas import GoalPlan, GoalPlannerProgress, GoalPlannerQuestion, GoalPlannerSession, GoalPrerequisite

try:
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_openai import ChatOpenAI
except Exception:  # pragma: no cover
    ChatPromptTemplate = None  # type: ignore[assignment]
    ChatOpenAI = None  # type: ignore[assignment]


def _build_llm() -> Any:
    if ChatOpenAI is None:
        return None
    api_key = (os.environ.get("GROQ_API_KEY", "") or "").strip()
    if not api_key:
        return None
    base_url = (os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1") or "").strip()
    model = (os.environ.get("ASSISTANT_MODEL", "llama-3.3-70b-versatile") or "").strip()
    return ChatOpenAI(model=model, api_key=api_key, base_url=base_url, temperature=0.25)


class GoalPlannerService:
    def __init__(self, db: Any) -> None:
        self.db = db
        self.llm = _build_llm()
        self.questions: List[GoalPlannerQuestion] = [
            GoalPlannerQuestion(
                key="have_existing_goal",
                prompt="Do you already have an active financial goal?",
                answer_type="boolean",
                help_text="If yes, I will align the new plan so goals do not clash.",
            ),
            GoalPlannerQuestion(
                key="existing_goal_details",
                prompt="Share your current goal in one line.",
                answer_type="text",
                placeholder="Example: 3 lakh emergency corpus by Dec",
            ),
            GoalPlannerQuestion(
                key="age",
                prompt="What is your age?",
                answer_type="number",
                placeholder="Example: 31",
            ),
            GoalPlannerQuestion(
                key="marital_status",
                prompt="What best describes your family status?",
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
                key="monthly_income",
                prompt="What is your average monthly take-home income?",
                answer_type="number",
                placeholder="Example: 85000",
            ),
            GoalPlannerQuestion(
                key="income_stability",
                prompt="How stable is your monthly income?",
                answer_type="choice",
                choices=["stable", "moderate", "variable"],
                help_text="This helps set a realistic pace and safety buffer.",
            ),
            GoalPlannerQuestion(
                key="monthly_household_expenses",
                prompt="Your core monthly household expenses (rent, food, utilities, transport)?",
                answer_type="number",
                placeholder="Example: 45000",
            ),
            GoalPlannerQuestion(
                key="monthly_loan_emi",
                prompt="Total monthly EMI payments?",
                answer_type="number",
                placeholder="Example: 12000 (enter 0 if none)",
            ),
            GoalPlannerQuestion(
                key="outstanding_loan_amount",
                prompt="Total outstanding loan amount?",
                answer_type="number",
                placeholder="Example: 250000 (enter 0 if none)",
            ),
            GoalPlannerQuestion(
                key="emergency_fund_available",
                prompt="How much emergency fund do you currently have (liquid)?",
                answer_type="number",
                placeholder="Example: 100000",
            ),
            GoalPlannerQuestion(
                key="has_health_insurance",
                prompt="Do you have active health insurance?",
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
                prompt="Do you have life insurance coverage?",
                answer_type="boolean",
                help_text="Needed when someone depends on your income.",
            ),
            GoalPlannerQuestion(
                key="primary_goal_name",
                prompt="What exact goal do you want to achieve now?",
                answer_type="text",
                placeholder="Example: Buy a car",
            ),
            GoalPlannerQuestion(
                key="goal_priority",
                prompt="How important is this goal right now?",
                answer_type="choice",
                choices=["must_have", "important", "nice_to_have"],
            ),
            GoalPlannerQuestion(
                key="goal_target_amount",
                prompt="What total amount do you need for this goal?",
                answer_type="number",
                placeholder="Example: 800000",
            ),
            GoalPlannerQuestion(
                key="current_goal_savings",
                prompt="How much have you already saved toward this goal?",
                answer_type="number",
                placeholder="Example: 120000 (0 if not started)",
            ),
            GoalPlannerQuestion(
                key="goal_target_months",
                prompt="In how many months do you want to complete this goal?",
                answer_type="number",
                placeholder="Example: 24",
            ),
            GoalPlannerQuestion(
                key="preferred_monthly_goal_budget",
                prompt="How much can you comfortably allocate every month for this goal?",
                answer_type="number",
                placeholder="Example: 20000",
            ),
            GoalPlannerQuestion(
                key="risk_comfort",
                prompt="Your risk comfort for planning this goal?",
                answer_type="choice",
                choices=["low", "medium", "high"],
                help_text="Used only for planning style, not investment advice.",
            ),
        ]
        self._question_index = {q.key: i for i, q in enumerate(self.questions)}

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
        return self._progress_from_session(GoalPlannerSession(**doc))

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
            await self.db.goal_planner_sessions.update_one({"id": session.id}, {"$set": session.model_dump()})
            return GoalPlannerProgress(
                session_id=session.id,
                status="completed",
                progress_pct=100.0,
                assistant_message=plan.summary,
                completed_plan=plan,
            )

        await self.db.goal_planner_sessions.update_one({"id": session.id}, {"$set": session.model_dump()})
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
            return GoalPlannerProgress(
                session_id=session.id,
                status="active" if session.status == "active" else "completed",
                progress_pct=100.0,
                assistant_message="I have everything required. Building your practical goal roadmap now.",
                question=None,
            )

        answered = sum(1 for q in self.questions if q.key in session.answers and self._should_ask(q.key, session.answers))
        askable_total = max(1, sum(1 for q in self.questions if self._should_ask(q.key, session.answers) or q.key in session.answers))
        progress = round((answered / askable_total) * 100.0, 1)
        question = self.questions[current_idx]
        message = self._build_turn_message(question=question, answers=session.answers, progress_pct=progress)

        return GoalPlannerProgress(
            session_id=session.id,
            status="active" if session.status == "active" else "completed",
            progress_pct=progress,
            assistant_message=message,
            question=question,
        )

    def _build_turn_message(self, *, question: GoalPlannerQuestion, answers: Dict[str, Any], progress_pct: float) -> str:
        key = question.key
        if key == "have_existing_goal":
            return "Let us build a realistic plan step-by-step. I will keep this simple and actionable."
        if key == "monthly_income":
            return "Good start. Next I need your cashflow baseline so the plan stays achievable."
        if key in {"children_count", "dependent_parents_count"}:
            return "I am mapping family responsibility so the plan protects what matters most."
        if key in {"monthly_loan_emi", "outstanding_loan_amount"}:
            return "Now I will account for loan pressure before deciding your safe goal budget."
        if key in {"emergency_fund_available", "has_health_insurance", "has_life_insurance"}:
            return "We are on the safety layer now. This avoids goal failure during emergencies."
        if key in {"goal_target_amount", "goal_target_months", "preferred_monthly_goal_budget"}:
            return "Great. Now I will shape your goal timeline and monthly execution plan."
        if key == "risk_comfort":
            return "Final calibration. After this, I will return a complete roadmap with actions."
        return f"Progress {int(progress_pct)}%. One focused question at a time so your plan is realistic."

    def _should_ask(self, key: str, answers: Dict[str, Any]) -> bool:
        if key == "existing_goal_details":
            return bool(answers.get("have_existing_goal", False))
        if key == "health_insurance_monthly_premium":
            return bool(answers.get("has_health_insurance", False))
        if key == "has_life_insurance":
            marital = str(answers.get("marital_status", "single"))
            children = int(float(answers.get("children_count", 0) or 0))
            parents = int(float(answers.get("dependent_parents_count", 0) or 0))
            return marital == "married" or children > 0 or parents > 0
        return True

    def _next_step_index(self, answers: Dict[str, Any], start: int) -> int:
        idx = max(0, start)
        while idx < len(self.questions):
            q = self.questions[idx]
            if self._should_ask(q.key, answers) and q.key not in answers:
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
        user = await self.db.users.find_one({"id": user_id}) or {}
        a = session.answers

        age = int(float(a.get("age", 0) or 0))
        income = float(a.get("monthly_income", 0.0))
        income_stability = str(a.get("income_stability", "moderate"))
        household = float(a.get("monthly_household_expenses", 0.0))
        emi = float(a.get("monthly_loan_emi", 0.0))
        outstanding_loan = float(a.get("outstanding_loan_amount", 0.0))
        emergency_available = float(a.get("emergency_fund_available", 0.0))
        has_health = bool(a.get("has_health_insurance", False))
        health_premium = float(a.get("health_insurance_monthly_premium", 0.0)) if has_health else 0.0
        has_life = bool(a.get("has_life_insurance", False))
        children = int(float(a.get("children_count", 0) or 0))
        parents = int(float(a.get("dependent_parents_count", 0) or 0))
        marital = str(a.get("marital_status", "single"))
        goal_name = str(a.get("primary_goal_name", "Financial Goal")).strip() or "Financial Goal"
        goal_priority = str(a.get("goal_priority", "important"))
        target_amount = float(a.get("goal_target_amount", 0.0))
        current_goal_savings = float(a.get("current_goal_savings", 0.0))
        target_months = max(1, int(float(a.get("goal_target_months", 1))))
        preferred_budget = float(a.get("preferred_monthly_goal_budget", 0.0))
        risk = str(a.get("risk_comfort", "medium"))

        dependents = children + parents + (1 if marital == "married" else 0)
        essential = household + emi + health_premium
        surplus = max(0.0, income - essential)
        emergency_months = 6 if dependents > 0 else 3
        if income_stability == "variable":
            emergency_months += 2
        emergency_target = essential * emergency_months
        emergency_gap = max(0.0, emergency_target - emergency_available)
        loan_ratio = (emi / income) if income > 0 else 0.0

        net_goal_needed = max(0.0, target_amount - current_goal_savings)
        required_monthly = net_goal_needed / target_months if target_months > 0 else 0.0
        recommended_budget = min(surplus, preferred_budget if preferred_budget > 0 else surplus)

        prerequisites: List[GoalPrerequisite] = []
        if emergency_gap > 0:
            emergency_monthly = max(2000.0, min(max(0.0, surplus) * 0.35, emergency_gap / 12 if emergency_gap > 0 else 0.0))
            prerequisites.append(
                GoalPrerequisite(
                    id=str(uuid.uuid4()),
                    title="Build emergency fund",
                    reason=f"Keep {emergency_months} months of essentials protected before aggressive goal funding.",
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
                    reason="Medical shocks are the fastest way to break goal momentum.",
                    suggested_monthly_allocation=3500.0,
                    estimated_months=1,
                    type="insurance",
                )
            )

        if (dependents > 0) and not has_life:
            prerequisites.append(
                GoalPrerequisite(
                    id=str(uuid.uuid4()),
                    title="Start life insurance protection",
                    reason="Income protection is essential when dependents rely on you.",
                    suggested_monthly_allocation=2200.0,
                    estimated_months=1,
                    type="protection",
                )
            )

        if outstanding_loan > 0 and loan_ratio >= 0.4:
            debt_monthly = max(3000.0, surplus * 0.2)
            prerequisites.append(
                GoalPrerequisite(
                    id=str(uuid.uuid4()),
                    title="Reduce debt pressure first",
                    reason="High EMI ratio limits safe goal execution; reduce debt stress first.",
                    suggested_monthly_allocation=round(debt_monthly, 2),
                    estimated_months=max(3, ceil(outstanding_loan / max(1.0, debt_monthly + emi))),
                    type="debt_reduction",
                )
            )

        prerequisite_total = sum(item.suggested_monthly_allocation for item in prerequisites)
        goal_monthly_after_prereq = max(0.0, recommended_budget - prerequisite_total)
        feasible = goal_monthly_after_prereq >= required_monthly and required_monthly > 0
        projected_months = target_months if feasible else (
            max(target_months, ceil(net_goal_needed / max(1.0, goal_monthly_after_prereq))) if net_goal_needed > 0 else target_months
        )
        prereq_months = max((item.estimated_months for item in prerequisites), default=0)
        total_projection = projected_months + prereq_months

        flow_steps: List[Dict[str, Any]] = []
        if prerequisites:
            flow_steps.append(
                {
                    "phase": "Phase 1",
                    "title": "Stability first",
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
                "milestones": [
                    {"month": max(1, projected_months // 3), "target_saved": round(net_goal_needed * 0.33, 2)},
                    {"month": max(2, (projected_months * 2) // 3), "target_saved": round(net_goal_needed * 0.66, 2)},
                    {"month": projected_months, "target_saved": round(net_goal_needed, 2)},
                ],
            }
        )

        insights = self._build_actionable_insights(
            goal_name=goal_name,
            goal_priority=goal_priority,
            feasible=feasible,
            required_monthly=required_monthly,
            recommended_monthly=goal_monthly_after_prereq,
            prereq_count=len(prerequisites),
            projected_months=total_projection,
            income_stability=income_stability,
        )

        summary = await self._build_summary_text(
            name=str(user.get("name", "")).strip() or "there",
            age=age,
            goal_name=goal_name,
            net_goal_needed=net_goal_needed,
            target_months=target_months,
            required_monthly=required_monthly,
            recommended_monthly=goal_monthly_after_prereq,
            prerequisites=prerequisites,
            projected_months=total_projection,
            feasible=feasible,
            insights=insights,
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
            projected_completion_months=total_projection,
            household_context={
                "name": str(user.get("name", "")).strip(),
                "age": age,
                "marital_status": marital,
                "children_count": children,
                "dependent_parents_count": parents,
                "dependents_total": dependents,
                "income_stability": income_stability,
                "risk_comfort": risk,
                "loan_to_income_ratio": round(loan_ratio, 2),
                "goal_priority": goal_priority,
                "current_goal_savings": round(current_goal_savings, 2),
            },
            prerequisites=prerequisites,
            flow_steps=flow_steps,
            actionable_insights=insights,
            summary=summary,
        )
        await self.db.goal_plans.insert_one(plan.model_dump())
        await self._upsert_prerequisite_habits(user_id=user_id, plan=plan)
        return plan

    def _build_actionable_insights(
        self,
        *,
        goal_name: str,
        goal_priority: str,
        feasible: bool,
        required_monthly: float,
        recommended_monthly: float,
        prereq_count: int,
        projected_months: int,
        income_stability: str,
    ) -> List[str]:
        insights: List[str] = []
        if prereq_count > 0:
            insights.append("Complete safety prerequisites first so this goal does not collapse during shocks.")
        if feasible:
            insights.append(
                f"Auto-transfer around \u20B9{recommended_monthly:,.0f} monthly into a dedicated '{goal_name}' bucket on salary day."
            )
        else:
            insights.append(
                f"Current budget supports \u20B9{recommended_monthly:,.0f}/month; target needs \u20B9{required_monthly:,.0f}/month. "
                "Either extend timeline or increase monthly savings."
            )
        if income_stability == "variable":
            insights.append("Use a 2-step transfer: 60% on income day, 40% after 10 days to handle variable cashflow.")
        else:
            insights.append("Track monthly progress on 3 milestones (33%, 66%, 100%) and review once every month.")
        if goal_priority == "must_have":
            insights.append(f"Treat this as non-negotiable: keep discretionary spending capped until ~{projected_months} months.")
        else:
            insights.append("Protect momentum by capping impulse spends in your top 2 categories each month.")
        return insights[:5]

    async def _build_summary_text(
        self,
        *,
        name: str,
        age: int,
        goal_name: str,
        net_goal_needed: float,
        target_months: int,
        required_monthly: float,
        recommended_monthly: float,
        prerequisites: List[GoalPrerequisite],
        projected_months: int,
        feasible: bool,
        insights: List[str],
    ) -> str:
        if self.llm is not None and ChatPromptTemplate is not None:
            try:
                prompt = ChatPromptTemplate.from_messages(
                    [
                        (
                            "system",
                            "You are a practical, encouraging financial goal planner. "
                            "Write clear, non-judgmental output. No scare language. No lectures. "
                            "Keep it concise and actionable.",
                        ),
                        (
                            "human",
                            "User: {name}, age={age}. Goal={goal_name}. "
                            "Net goal amount={net_goal_needed}. target_months={target_months}. "
                            "required_monthly={required_monthly}. recommended_monthly={recommended_monthly}. "
                            "prereq_count={prereq_count}. projected_months={projected_months}. feasible={feasible}. "
                            "insights={insights}. "
                            "Return 5-7 lines:\n"
                            "1) supportive opening\n"
                            "2) realistic plan statement\n"
                            "3) prerequisite note if any\n"
                            "4) monthly action\n"
                            "5) milestone rhythm\n"
                            "6) confidence-building close",
                        ),
                    ]
                )
                response = await (prompt | self.llm).ainvoke(
                    {
                        "name": name,
                        "age": age,
                        "goal_name": goal_name,
                        "net_goal_needed": round(net_goal_needed, 2),
                        "target_months": target_months,
                        "required_monthly": round(required_monthly, 2),
                        "recommended_monthly": round(recommended_monthly, 2),
                        "prereq_count": len(prerequisites),
                        "projected_months": projected_months,
                        "feasible": feasible,
                        "insights": insights,
                    }
                )
                text = str(response.content).strip()
                if text:
                    return text
            except Exception:
                pass

        prereq_note = (
            "We will complete safety prerequisites first, then accelerate goal funding."
            if prerequisites
            else "Your base is stable enough to directly focus on this goal."
        )
        feasibility_note = (
            "Your current monthly capacity supports the target timeline."
            if feasible
            else "Your plan is still achievable by adjusting timeline and monthly allocation."
        )
        return (
            f"{name.title()}, this goal is achievable with a clear system.\n"
            f"For {goal_name}, net amount to build is \u20B9{net_goal_needed:,.0f}.\n"
            f"Target pace needs about \u20B9{required_monthly:,.0f}/month; current safe plan is \u20B9{recommended_monthly:,.0f}/month.\n"
            f"{prereq_note}\n"
            f"{feasibility_note}\n"
            f"Projected completion is around {projected_months} months with monthly milestone reviews."
        )

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

