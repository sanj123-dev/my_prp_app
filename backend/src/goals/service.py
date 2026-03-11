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
    return ChatOpenAI(model=model, api_key=api_key, base_url=base_url, temperature=0.2)


GOAL_PRICE_CATALOG: List[Dict[str, Any]] = [
    {"kind": "bike", "name": "Hero Splendor Plus", "aliases": ["splendor", "hero splendor"], "price": 95000},
    {"kind": "bike", "name": "Honda Shine", "aliases": ["shine", "honda shine"], "price": 110000},
    {"kind": "bike", "name": "TVS Raider", "aliases": ["raider", "tvs raider"], "price": 125000},
    {"kind": "bike", "name": "Royal Enfield Classic 350", "aliases": ["classic 350", "royal enfield"], "price": 245000},
    {"kind": "car", "name": "Maruti Alto K10", "aliases": ["alto", "alto k10"], "price": 550000},
    {"kind": "car", "name": "Maruti Baleno", "aliases": ["baleno"], "price": 850000},
    {"kind": "car", "name": "Hyundai Creta", "aliases": ["creta"], "price": 1400000},
    {"kind": "phone", "name": "Redmi Note Series", "aliases": ["redmi", "note"], "price": 20000},
    {"kind": "phone", "name": "OnePlus Nord Series", "aliases": ["nord", "oneplus"], "price": 32000},
    {"kind": "phone", "name": "iPhone 15", "aliases": ["iphone"], "price": 80000},
    {"kind": "laptop", "name": "Acer Aspire 5", "aliases": ["aspire", "acer"], "price": 52000},
    {"kind": "laptop", "name": "MacBook Air", "aliases": ["macbook"], "price": 110000},
]


class GoalPlannerService:
    def __init__(self, db: Any) -> None:
        self.db = db
        self.llm = _build_llm()
        self.questions: List[GoalPlannerQuestion] = [
            GoalPlannerQuestion(
                key="goal_name",
                prompt="What goal do you want to achieve?",
                answer_type="text",
                placeholder="Example: Buy a bike / Emergency fund / Vacation",
            ),
            GoalPlannerQuestion(
                key="goal_model",
                prompt="Any specific model or option in mind? (optional)",
                answer_type="text",
                required=False,
                placeholder="Example: TVS Raider / iPhone 15",
                help_text="If you provide a model, I can compare affordability and suggest alternatives.",
            ),
            GoalPlannerQuestion(
                key="goal_target_amount",
                prompt="Target amount for this goal? (enter 0 if not sure)",
                answer_type="number",
                placeholder="Example: 120000",
            ),
            GoalPlannerQuestion(
                key="goal_target_months",
                prompt="In how many months do you want to complete this goal?",
                answer_type="number",
                placeholder="Example: 12",
            ),
            GoalPlannerQuestion(
                key="current_goal_savings",
                prompt="How much have you already saved for this goal?",
                answer_type="number",
                placeholder="Example: 20000 (or 0)",
            ),
            GoalPlannerQuestion(
                key="monthly_budget_commitment",
                prompt="How much can you commit every month for this goal?",
                answer_type="number",
                placeholder="Example: 12000",
            ),
            GoalPlannerQuestion(
                key="open_to_alternatives",
                prompt="If this goal is not affordable in your timeline, can I suggest alternatives?",
                answer_type="boolean",
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
                assistant_message="I have enough context. Building your achievable plan from your real cashflow.",
                question=None,
            )

        answered = sum(1 for q in self.questions if q.key in session.answers)
        total = len(self.questions)
        progress = round((answered / max(1, total)) * 100.0, 1)
        question = self.questions[current_idx]
        message = self._build_turn_message(question=question)

        return GoalPlannerProgress(
            session_id=session.id,
            status="active" if session.status == "active" else "completed",
            progress_pct=progress,
            assistant_message=message,
            question=question,
        )

    def _build_turn_message(self, *, question: GoalPlannerQuestion) -> str:
        key = question.key
        if key == "goal_name":
            return "I will use your profile and transaction history so we avoid irrelevant questions."
        if key == "goal_model":
            return "Model helps me estimate realistic cost and suggest better alternatives if needed."
        if key == "goal_target_amount":
            return "If you are not sure, enter 0. I can estimate from market references."
        if key == "goal_target_months":
            return "I will keep timeline practical and avoid unrealistic long plans."
        if key == "monthly_budget_commitment":
            return "This will be matched with your spending pattern before finalizing your plan."
        if key == "open_to_alternatives":
            return "Last check. I will now prepare affordability verdict and action steps."
        return "One quick input and I will continue."

    def _next_step_index(self, answers: Dict[str, Any], start: int) -> int:
        idx = max(0, start)
        while idx < len(self.questions):
            q = self.questions[idx]
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

    def _as_datetime(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
            except Exception:
                return datetime.utcnow()
        return datetime.utcnow()

    async def _build_financial_snapshot(self, *, user_id: str, user_doc: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.utcnow()
        docs = await self.db.transactions.find({"user_id": user_id}).sort("date", -1).limit(3000).to_list(3000)

        recent: List[Dict[str, Any]] = []
        for item in docs:
            dt = self._as_datetime(item.get("date", item.get("created_at")))
            if (now - dt).days <= 120:
                recent.append({**item, "_dt": dt})

        months = {(it["_dt"].year, it["_dt"].month) for it in recent}
        month_count = max(1, len(months))

        debit_total = 0.0
        credit_total = 0.0
        by_category: Dict[str, float] = {}
        for item in recent:
            tx_type = str(item.get("transaction_type", "debit")).strip().lower()
            amount = float(item.get("amount", 0.0) or 0.0)
            if tx_type in {"debit", "self_transfer"}:
                debit_total += amount
                category = str(item.get("category", "Other")).strip() or "Other"
                by_category[category] = by_category.get(category, 0.0) + amount
            elif tx_type == "credit":
                credit_total += amount

        monthly_spend = round(debit_total / month_count, 2)
        monthly_credit = round(credit_total / month_count, 2)
        profile_income = float(user_doc.get("monthly_income", 0.0) or 0.0)
        monthly_income = round(profile_income if profile_income > 0 else monthly_credit, 2)
        if monthly_income <= 0 and monthly_spend > 0:
            monthly_income = round(monthly_spend * 1.2, 2)

        top_categories = [
            {"name": name, "amount": round(amount, 2)}
            for name, amount in sorted(by_category.items(), key=lambda x: x[1], reverse=True)[:5]
        ]

        return {
            "window_days": 120,
            "transaction_count": len(recent),
            "month_count": month_count,
            "monthly_income_estimate": monthly_income,
            "monthly_spend_estimate": monthly_spend,
            "monthly_surplus_estimate": round(max(0.0, monthly_income - monthly_spend), 2),
            "top_spend_categories": top_categories,
        }

    def _detect_goal_kind(self, text: str) -> str:
        lowered = (text or "").lower()
        if any(token in lowered for token in ["bike", "scooter", "motorcycle"]):
            return "bike"
        if any(token in lowered for token in ["car", "vehicle"]):
            return "car"
        if any(token in lowered for token in ["phone", "mobile", "iphone"]):
            return "phone"
        if any(token in lowered for token in ["laptop", "macbook"]):
            return "laptop"
        if "wedding" in lowered:
            return "wedding"
        if any(token in lowered for token in ["trip", "travel", "vacation", "holiday"]):
            return "vacation"
        if any(token in lowered for token in ["emergency", "corpus"]):
            return "emergency_fund"
        return "general"

    def _match_market_item(self, *, goal_name: str, model_name: str) -> Optional[Dict[str, Any]]:
        query = f"{goal_name} {model_name}".lower().strip()
        if not query:
            return None
        for item in GOAL_PRICE_CATALOG:
            name = str(item.get("name", "")).lower()
            aliases = [str(x).lower() for x in item.get("aliases", [])]
            if name in query or any(alias in query for alias in aliases):
                return dict(item)
        return None

    def _build_alternatives(
        self,
        *,
        goal_kind: str,
        selected_name: str,
        affordable_amount: float,
    ) -> List[Dict[str, Any]]:
        if goal_kind not in {"bike", "car", "phone", "laptop"}:
            return []
        selected_lower = selected_name.lower()
        rows = [item for item in GOAL_PRICE_CATALOG if str(item.get("kind")) == goal_kind]
        rows.sort(key=lambda item: float(item.get("price", 0.0)))

        matched = [
            item for item in rows
            if float(item.get("price", 0.0)) <= max(0.0, affordable_amount * 1.1)
            and str(item.get("name", "")).lower() != selected_lower
        ]
        if not matched:
            matched = [item for item in rows if str(item.get("name", "")).lower() != selected_lower][:3]

        return [
            {
                "name": str(item.get("name", "")),
                "estimated_price": round(float(item.get("price", 0.0)), 2),
                "fit": "strong" if float(item.get("price", 0.0)) <= affordable_amount else "stretch",
            }
            for item in matched[:3]
        ]

    async def _build_plan(self, *, user_id: str, session: GoalPlannerSession) -> GoalPlan:
        user = await self.db.users.find_one({"id": user_id}) or {}
        a = session.answers

        goal_name = str(a.get("goal_name", "Financial Goal")).strip() or "Financial Goal"
        goal_model = str(a.get("goal_model", "")).strip()
        target_amount_input = float(a.get("goal_target_amount", 0.0) or 0.0)
        target_months = max(1, int(float(a.get("goal_target_months", 1) or 1)))
        current_goal_savings = max(0.0, float(a.get("current_goal_savings", 0.0) or 0.0))
        monthly_budget_commitment = max(0.0, float(a.get("monthly_budget_commitment", 0.0) or 0.0))
        open_to_alternatives = bool(a.get("open_to_alternatives", True))

        snapshot = await self._build_financial_snapshot(user_id=user_id, user_doc=user)
        monthly_income = float(snapshot.get("monthly_income_estimate", 0.0) or 0.0)
        monthly_spend = float(snapshot.get("monthly_spend_estimate", 0.0) or 0.0)
        monthly_surplus = max(0.0, monthly_income - monthly_spend)
        safe_goal_budget = max(0.0, monthly_surplus * 0.7)
        if monthly_budget_commitment > 0:
            recommended_monthly = min(monthly_budget_commitment, max(safe_goal_budget, monthly_surplus * 0.9))
        else:
            recommended_monthly = safe_goal_budget
        recommended_monthly = round(max(0.0, recommended_monthly), 2)

        goal_kind = self._detect_goal_kind(f"{goal_name} {goal_model}")
        matched_item = self._match_market_item(goal_name=goal_name, model_name=goal_model)
        market_price = float((matched_item or {}).get("price", 0.0) or 0.0)
        target_amount = target_amount_input if target_amount_input > 0 else market_price
        if target_amount <= 0:
            if goal_kind == "emergency_fund":
                target_amount = monthly_spend * 4
            elif goal_kind == "vacation":
                target_amount = max(60000.0, monthly_income * 0.8)
            else:
                target_amount = 100000.0
        target_amount = round(max(1.0, target_amount), 2)

        net_goal_needed = round(max(0.0, target_amount - current_goal_savings), 2)
        required_monthly = round(net_goal_needed / max(1, target_months), 2)

        profile_savings = float(user.get("saving_amount", 0.0) or 0.0)
        emergency_target = round(monthly_spend * 3, 2)
        emergency_gap = max(0.0, emergency_target - profile_savings)

        prerequisites: List[GoalPrerequisite] = []
        if emergency_gap > 0 and monthly_surplus > 0:
            emergency_monthly = round(min(max(1500.0, recommended_monthly * 0.2), emergency_gap), 2)
            if emergency_monthly > 0:
                prerequisites.append(
                    GoalPrerequisite(
                        id=str(uuid.uuid4()),
                        title="Build minimum emergency cushion",
                        reason="Protecting 3 months of expenses prevents goal disruption during cash shocks.",
                        suggested_monthly_allocation=emergency_monthly,
                        estimated_months=max(1, ceil(emergency_gap / max(1.0, emergency_monthly))),
                        type="emergency_fund",
                    )
                )

        prereq_total = sum(item.suggested_monthly_allocation for item in prerequisites)
        goal_monthly_after_prereq = round(max(0.0, recommended_monthly - prereq_total), 2)
        if goal_monthly_after_prereq <= 0 and recommended_monthly > 0:
            goal_monthly_after_prereq = round(recommended_monthly * 0.8, 2)

        raw_projected_months = max(1, ceil(net_goal_needed / max(1.0, goal_monthly_after_prereq)))
        max_projection_months = 60
        projected_months = min(raw_projected_months, max_projection_months)
        feasible_now = goal_monthly_after_prereq >= required_monthly and raw_projected_months <= target_months

        affordable_in_timeline = round(current_goal_savings + (goal_monthly_after_prereq * target_months), 2)
        affordability_gap = round(max(0.0, target_amount - affordable_in_timeline), 2)
        affordability_status = "affordable" if affordability_gap <= 0 else "stretch"

        alternatives: List[Dict[str, Any]] = []
        if open_to_alternatives and affordability_gap > 0:
            alternatives = self._build_alternatives(
                goal_kind=goal_kind,
                selected_name=str((matched_item or {}).get("name", "") or goal_name),
                affordable_amount=affordable_in_timeline,
            )

        flow_steps: List[Dict[str, Any]] = []
        if prerequisites:
            flow_steps.append(
                {
                    "phase": "Phase 1",
                    "title": "Stability Layer",
                    "duration_months": max(item.estimated_months for item in prerequisites),
                    "actions": [item.title for item in prerequisites],
                }
            )

        milestone_1 = round(current_goal_savings + (net_goal_needed * 0.25), 2)
        milestone_2 = round(current_goal_savings + (net_goal_needed * 0.6), 2)
        milestone_3 = round(target_amount, 2)
        flow_steps.append(
            {
                "phase": "Phase 2",
                "title": f"Goal Execution - {goal_name}",
                "duration_months": projected_months,
                "monthly_allocation": goal_monthly_after_prereq,
                "required_monthly": required_monthly,
                "milestones": [
                    {"month": max(1, projected_months // 4), "target_saved": milestone_1},
                    {"month": max(2, (projected_months * 2) // 3), "target_saved": milestone_2},
                    {"month": projected_months, "target_saved": milestone_3},
                ],
                "actions": [
                    "Set auto-transfer on salary day.",
                    "Cut top one discretionary category by 10-15%.",
                    "Review progress monthly and increase SIP/savings after any income jump.",
                ],
            }
        )

        top_cat = ""
        top_cat_amount = 0.0
        top_categories = list(snapshot.get("top_spend_categories", []))
        if top_categories:
            top_cat = str(top_categories[0].get("name", "Other"))
            top_cat_amount = float(top_categories[0].get("amount", 0.0) or 0.0)

        actionable_insights: List[str] = [
            f"Auto-save around \u20B9{goal_monthly_after_prereq:,.0f}/month into a dedicated '{goal_name}' bucket.",
            (
                f"Your target needs \u20B9{required_monthly:,.0f}/month; current safe pace is \u20B9{goal_monthly_after_prereq:,.0f}/month."
                if required_monthly > 0
                else "Your goal is already funded; now maintain discipline and avoid withdrawals."
            ),
            (
                f"Reduce '{top_cat}' spend by 10% (about \u20B9{(top_cat_amount * 0.1):,.0f}/month) and redirect it to this goal."
                if top_cat and top_cat_amount > 0
                else "Track your top spending category weekly and redirect leakages to this goal."
            ),
        ]

        if affordability_gap > 0:
            actionable_insights.append(
                f"In {target_months} months your current pace supports about \u20B9{affordable_in_timeline:,.0f}; gap is \u20B9{affordability_gap:,.0f}."
            )
            actionable_insights.append(
                "Use one of these levers: increase monthly budget, extend timeline, or choose a more affordable variant."
            )
        else:
            actionable_insights.append(f"You are on a feasible track to finish within about {projected_months} months.")

        summary = await self._build_summary_text(
            user_name=str(user.get("name", "")).strip() or "there",
            goal_name=goal_name,
            target_amount=target_amount,
            target_months=target_months,
            required_monthly=required_monthly,
            recommended_monthly=goal_monthly_after_prereq,
            affordability_status=affordability_status,
            projected_months=projected_months,
            alternatives=alternatives,
        )

        household_context: Dict[str, Any] = {
            "name": str(user.get("name", "")).strip(),
            "profession": str(user.get("profession", "")).strip(),
            "city": str(user.get("city", "")).strip(),
            "financial_snapshot": snapshot,
            "affordability": {
                "status": affordability_status,
                "affordable_in_target_timeline": affordable_in_timeline,
                "gap_amount": affordability_gap,
                "timeline_requested_months": target_months,
            },
            "market_reference": {
                "matched_item": str((matched_item or {}).get("name", "") or ""),
                "matched_price": round(market_price, 2) if market_price > 0 else 0.0,
                "catalog_source": "Internal India benchmark catalog (2026 Q1)",
            },
            "alternatives": alternatives,
            "open_to_alternatives": open_to_alternatives,
        }

        plan = GoalPlan(
            user_id=user_id,
            session_id=session.id,
            goal_name=goal_name,
            target_amount=target_amount,
            target_months=target_months,
            monthly_budget_selected=round(monthly_budget_commitment, 2),
            monthly_budget_recommended=goal_monthly_after_prereq,
            required_monthly_for_goal=required_monthly,
            feasible_now=feasible_now,
            projected_completion_months=projected_months,
            household_context=household_context,
            prerequisites=prerequisites,
            flow_steps=flow_steps,
            actionable_insights=actionable_insights[:6],
            summary=summary,
        )
        await self.db.goal_plans.insert_one(plan.model_dump())
        await self._upsert_prerequisite_habits(user_id=user_id, plan=plan)
        return plan

    async def _build_summary_text(
        self,
        *,
        user_name: str,
        goal_name: str,
        target_amount: float,
        target_months: int,
        required_monthly: float,
        recommended_monthly: float,
        affordability_status: str,
        projected_months: int,
        alternatives: List[Dict[str, Any]],
    ) -> str:
        if self.llm is not None and ChatPromptTemplate is not None:
            try:
                prompt = ChatPromptTemplate.from_messages(
                    [
                        (
                            "system",
                            "You are a practical financial coach. Keep it concise, clear, and optimistic. No fluff.",
                        ),
                        (
                            "human",
                            "User {user_name}. Goal {goal_name}. target_amount={target_amount}. "
                            "target_months={target_months}. required_monthly={required_monthly}. "
                            "recommended_monthly={recommended_monthly}. affordability={affordability_status}. "
                            "projected_months={projected_months}. alternatives={alternatives}. "
                            "Return exactly 5 lines, easy language, with rupee symbol.",
                        ),
                    ]
                )
                response = await (prompt | self.llm).ainvoke(
                    {
                        "user_name": user_name,
                        "goal_name": goal_name,
                        "target_amount": round(target_amount, 2),
                        "target_months": target_months,
                        "required_monthly": round(required_monthly, 2),
                        "recommended_monthly": round(recommended_monthly, 2),
                        "affordability_status": affordability_status,
                        "projected_months": projected_months,
                        "alternatives": alternatives,
                    }
                )
                text = str(response.content).strip()
                if text:
                    return text
            except Exception:
                pass

        alternatives_note = (
            f" I also found {len(alternatives)} affordable alternative option(s)."
            if alternatives
            else ""
        )
        feasibility_text = "on track" if affordability_status == "affordable" else "needs a stretch plan"
        return (
            f"{user_name.title()}, your goal '{goal_name}' is {feasibility_text}.\n"
            f"Target amount: \u20B9{target_amount:,.0f} in {target_months} months.\n"
            f"Required pace: \u20B9{required_monthly:,.0f}/month.\n"
            f"Recommended safe pace from your data: \u20B9{recommended_monthly:,.0f}/month.\n"
            f"Estimated completion: around {projected_months} months.{alternatives_note}"
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
                "category": "Savings",
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
