from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from statistics import mean
from typing import Any, Dict, List, Literal, Protocol
import json
import re
import uuid

from langchain_core.prompts import ChatPromptTemplate

from .tools import AssistantTools


IntentType = Literal[
    "expense_question",
    "budget_question",
    "investment_question",
    "education_request",
    "behaviour_analysis",
    "emotional_spending",
    "forecasting",
    "general",
]


@dataclass
class AgentContext:
    db: Any
    llm: Any
    tools: AssistantTools


class AssistantAgent(Protocol):
    name: str

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        ...


class BaseAgent:
    name = "base"

    def _trace(self, state: Dict[str, Any], marker: str | None = None) -> None:
        trace = list(state.get("agent_trace", []))
        trace.append(marker or self.name)
        state["agent_trace"] = trace


class IntentDetectionAgent(BaseAgent):
    name = "intent_detection"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        message = str(state.get("message", "")).strip()
        lowered = message.lower()
        tone = ctx.tools.infer_user_tone(message)
        focus = ctx.tools.finance_query_focus(message)

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "Classify into one intent only and return strict JSON {\"intent\":\"...\"}. "
                    "Allowed: expense_question, budget_question, investment_question, education_request, "
                    "behaviour_analysis, emotional_spending, forecasting, general.",
                ),
                ("human", "{message}"),
            ]
        )

        intent: IntentType = "general"
        try:
            resp = await (prompt | ctx.llm).ainvoke({"message": message})
            payload = json.loads(self._extract_json(str(resp.content)))
            candidate = str(payload.get("intent", "")).strip().lower()
            if candidate in {
                "expense_question",
                "budget_question",
                "investment_question",
                "education_request",
                "behaviour_analysis",
                "emotional_spending",
                "forecasting",
                "general",
            }:
                intent = candidate  # type: ignore[assignment]
        except Exception:
            if any(k in lowered for k in ["spend", "expense", "where did i spend", "transaction"]):
                intent = "expense_question"
            elif any(k in lowered for k in ["budget", "limit", "overspend", "80/20"]):
                intent = "budget_question"
            elif any(k in lowered for k in ["invest", "allocation", "portfolio", "risk profile"]):
                intent = "investment_question"
            elif any(k in lowered for k in ["learn", "teach", "what is", "explain"]):
                intent = "education_request"
            elif any(k in lowered for k in ["habit", "discipline", "behavior", "behaviour"]):
                intent = "behaviour_analysis"
            elif any(k in lowered for k in ["stress", "emotional", "impulse", "panic"]):
                intent = "emotional_spending"
            elif any(k in lowered for k in ["forecast", "next month", "end of month", "projection"]):
                intent = "forecasting"

        state["intent"] = intent
        state["user_tone"] = tone
        state["query_focus"] = focus
        state["dissatisfied"] = ctx.tools.detect_dissatisfaction(message)
        time_label = str(((focus.get("time_range") or {}).get("label", "")) or "")
        state["show_net_cashflow"] = bool(focus.get("explicit_cashflow_request", False)) or time_label == "this_month"
        self._trace(state, f"{self.name}:{intent}")
        return state

    @staticmethod
    def _extract_json(text: str) -> str:
        content = text.strip()
        if content.startswith("{") and content.endswith("}"):
            return content
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end > start:
            return content[start : end + 1]
        raise ValueError("No JSON object found")


class UserStateAgent(BaseAgent):
    name = "user_state"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        user_id = str(state["user_id"])
        session_id = str(state["session_id"])
        message = str(state.get("message", ""))

        snapshot_45 = await ctx.tools.financial_snapshot(user_id=user_id, days=45)
        analytics_90 = await ctx.tools.analytics_report(user_id=user_id, days=90)
        profile = await ctx.tools.user_profile_summary(user_id=user_id)
        dialogue = await ctx.tools.recent_dialogue(user_id=user_id, session_id=session_id, limit=8)
        prefs = await ctx.tools.user_style_preferences(user_id=user_id)
        sem_hits = await ctx.tools.semantic_context(user_id=user_id, query=message, limit=6)

        response_style = ctx.tools.preferred_response_style(message=message, dialogue=dialogue)
        preferred_style = str(prefs.get("style_preference", "balanced"))
        if response_style == "balanced" and preferred_style in {"concise", "detailed", "example_driven", "balanced"}:
            response_style = preferred_style

        debit = float(snapshot_45.get("total_debit", 0.0) or 0.0)
        credit = float(snapshot_45.get("total_credit", 0.0) or 0.0)
        savings_rate = ((credit - debit) / credit * 100.0) if credit > 0 else 0.0
        anomalies = list((analytics_90.get("anomalies") or []))
        monthly_trend = list((analytics_90.get("monthly_trend") or []))
        lifecycle_stage = "starter"
        if credit > 0 and savings_rate > 20:
            lifecycle_stage = "growth"
        if credit > 0 and savings_rate > 35:
            lifecycle_stage = "stability"

        sentiment_history = self._derive_sentiment_history(dialogue)
        risk_profile = self._derive_risk_profile(profile=profile, analytics=analytics_90, sentiment=sentiment_history)

        citations: List[Dict[str, Any]] = []
        for item in sem_hits[:4]:
            snippet = str(item.get("text", "")).replace("\n", " ").strip()
            citations.append(
                {
                    "source": str(item.get("source", "context")),
                    "snippet": snippet[:180],
                    "score": round(float(item.get("score", 0.0) or 0.0), 4),
                }
            )

        state["financial_snapshot"] = snapshot_45
        state["analytics_report"] = analytics_90
        state["user_profile"] = profile
        state["recent_dialogue"] = dialogue
        state["user_style_preferences"] = prefs
        state["response_style"] = response_style
        state["citations"] = citations
        state["user_state"] = {
            "cash_flow": {"income": round(credit, 2), "expense": round(debit, 2), "net": round(credit - debit, 2)},
            "savings_rate_pct": round(savings_rate, 1),
            "goals": list(profile.get("goals", [])),
            "risk_profile": risk_profile,
            "habits": self._habit_signals(analytics_90),
            "sentiment_history": sentiment_history,
            "anomalies": anomalies[:5],
            "lifecycle_stage": lifecycle_stage,
            "monthly_trend": monthly_trend,
        }
        self._trace(state, self.name)
        return state

    def _derive_sentiment_history(self, dialogue: List[Dict[str, str]]) -> Dict[str, Any]:
        markers = {"stressed": 0, "neutral": 0, "confident": 0}
        for item in dialogue:
            if item.get("role") != "user":
                continue
            text = str(item.get("content", "")).lower()
            if any(k in text for k in ["stress", "worried", "anxious", "panic", "overwhelmed"]):
                markers["stressed"] += 1
            elif any(k in text for k in ["good", "better", "confident", "on track"]):
                markers["confident"] += 1
            else:
                markers["neutral"] += 1
        dominant = max(markers.items(), key=lambda x: x[1])[0] if dialogue else "neutral"
        return {"dominant": dominant, "distribution": markers}

    def _derive_risk_profile(self, profile: Dict[str, Any], analytics: Dict[str, Any], sentiment: Dict[str, Any]) -> str:
        anomaly_count = len(list(analytics.get("anomalies") or []))
        goals = list(profile.get("goals", []))
        stressed = int((sentiment.get("distribution") or {}).get("stressed", 0))
        if anomaly_count >= 3 or stressed >= 2:
            return "conservative"
        if goals and anomaly_count <= 1:
            return "balanced"
        return "moderate"

    def _habit_signals(self, analytics: Dict[str, Any]) -> Dict[str, Any]:
        velocity = float(((analytics.get("spend_velocity_7d") or {}).get("change_pct", 0.0) or 0.0))
        discipline = max(0.0, min(100.0, 65.0 - (velocity / 3.0)))
        return {
            "velocity_change_pct": round(velocity, 1),
            "discipline_score": round(discipline, 1),
        }


class PlannerAgent(BaseAgent):
    name = "planner"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        intent = str(state.get("intent", "general"))
        user_state = dict(state.get("user_state", {}))
        message = str(state.get("message", "")).lower()
        needs_review = False
        review_reason = ""

        plan: List[str] = [
            "ingestion",
            "categorization",
            "transaction_query",
            "expense",
            "budget",
            "forecasting",
            "behaviour",
            "sentiment",
            "investment",
            "learning",
            "financial_health",
            "synthesizer",
        ]

        missing_fields: List[str] = []
        has_goals = bool(user_state.get("goals"))
        cash_flow = dict(user_state.get("cash_flow", {}))
        income = float(cash_flow.get("income", 0.0) or 0.0)
        if intent in {"budget_question", "investment_question", "forecasting"} and not has_goals:
            missing_fields.append("goal")
        if intent in {"budget_question", "forecasting"} and income <= 0:
            missing_fields.append("income")
        if intent == "investment_question" and "horizon" not in message:
            missing_fields.append("investment_horizon")

        if intent == "education_request":
            plan = ["learning", "financial_health", "synthesizer"]
        elif intent == "emotional_spending":
            plan = ["transaction_query", "expense", "behaviour", "sentiment", "budget", "learning", "financial_health", "synthesizer"]

        anomalies = list(user_state.get("anomalies", []))
        if len(anomalies) >= 3:
            needs_review = True
            review_reason = "large_anomalies"
        if intent == "investment_question":
            needs_review = True
            review_reason = "investment_readiness_confirmation"

        state["plan"] = plan
        state["needs_clarification"] = bool(missing_fields)
        state["missing_fields"] = missing_fields
        state["needs_human_review"] = needs_review
        state["human_review_reason"] = review_reason
        self._trace(state, f"{self.name}:{','.join(plan)}")
        return state


class ClarificationAgent(BaseAgent):
    name = "clarification"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        missing = list(state.get("missing_fields", []))
        questions = {
            "goal": "What financial goal should I optimize for right now?",
            "income": "Could you share your approximate monthly income so I can make a realistic plan?",
            "investment_horizon": "What is your investment horizon (for example 1, 3, or 5+ years)?",
        }
        prompts = [questions[item] for item in missing if item in questions]
        state["clarification_questions"] = prompts
        self._trace(state, self.name)
        return state


class IngestionAgent(BaseAgent):
    name = "ingestion"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        message = str(state.get("message", "")).lower()
        ingestion = {"triggered": False, "mode": "none", "status": "not_requested"}
        if any(k in message for k in ["csv", "statement", "upload", "ocr", "sync bank"]):
            ingestion = {"triggered": True, "mode": "user_requested", "status": "pending_input"}
        state["ingestion_report"] = ingestion
        self._trace(state, self.name)
        return state


class CategorizationAgent(BaseAgent):
    name = "categorization"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        snapshot = dict(state.get("financial_snapshot", {}))
        top_categories = list(snapshot.get("top_categories", []))
        recurring = [c for c in top_categories if str(c.get("name", "")).lower() in {"subscriptions", "bills", "utilities"}]
        state["categorization_report"] = {
            "top_categories": top_categories[:5],
            "possible_recurring": recurring[:3],
            "merchant_detection": "heuristic",
        }
        self._trace(state, self.name)
        return state


class TransactionQueryAgent(BaseAgent):
    name = "transaction_query"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        query_focus = dict(state.get("query_focus", {}))
        focus_list = list(query_focus.get("focus", []))
        time_range = dict(query_focus.get("time_range", {}))
        intent = str(state.get("intent", "general"))
        message = str(state.get("message", "")).lower()

        needs_tx = "transaction_summary" in focus_list or bool(time_range.get("explicit", False))
        if not needs_tx and intent == "expense_question":
            needs_tx = any(token in message for token in ["transaction", "history", "debit", "credit", "spent"])

        report: Dict[str, Any] = {}
        if needs_tx:
            report = await ctx.tools.transaction_summary(
                user_id=str(state.get("user_id", "")),
                start_iso=str(time_range.get("start_iso", "")),
                end_iso=str(time_range.get("end_iso", "")),
                limit=20,
            )
        state["transaction_report"] = report
        self._trace(state, f"{self.name}:{int(report.get('transaction_count', 0) or 0)}")
        return state


class ExpenseAgent(BaseAgent):
    name = "expense"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        analytics = dict(state.get("analytics_report", {}))
        period_change = float(analytics.get("period_change_pct", 0.0) or 0.0)
        direction = "up" if period_change > 0 else "down" if period_change < 0 else "flat"
        state["expense_report"] = {
            "period_change_pct": round(period_change, 1),
            "trend_direction": direction,
            "anomalies": list(analytics.get("anomalies", []))[:5],
            "spend_velocity_7d": dict(analytics.get("spend_velocity_7d", {})),
        }
        self._trace(state, self.name)
        return state


class BudgetAgent(BaseAgent):
    name = "budget"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        user_state = dict(state.get("user_state", {}))
        cash = dict(user_state.get("cash_flow", {}))
        income = float(cash.get("income", 0.0) or 0.0)
        expense = float(cash.get("expense", 0.0) or 0.0)
        essentials_limit = income * 0.8
        savings_target = income * 0.2
        overspending = expense > essentials_limit if income > 0 else False
        state["budget_report"] = {
            "model": "80/20",
            "income_estimate": round(income, 2),
            "essential_spend_limit": round(essentials_limit, 2),
            "savings_target": round(savings_target, 2),
            "current_spend": round(expense, 2),
            "overspending_detected": overspending,
            "adaptive_adjustment_hint": "tighten variable categories by 10%" if overspending else "on_track",
        }
        self._trace(state, self.name)
        return state


class ForecastingAgent(BaseAgent):
    name = "forecasting"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        snapshot = dict(state.get("financial_snapshot", {}))
        days = int(snapshot.get("window_days", 45) or 45)
        debit = float(snapshot.get("total_debit", 0.0) or 0.0)
        credit = float(snapshot.get("total_credit", 0.0) or 0.0)
        daily_debit = debit / max(1, days)
        daily_credit = credit / max(1, days)

        now = datetime.utcnow()
        days_left = max(1, 30 - now.day)
        projected_outflow = daily_debit * days_left
        projected_inflow = daily_credit * days_left
        state["forecast_report"] = {
            "days_left_in_month": days_left,
            "projected_inflow": round(projected_inflow, 2),
            "projected_outflow": round(projected_outflow, 2),
            "projected_net": round(projected_inflow - projected_outflow, 2),
            "confidence": "medium",
        }
        self._trace(state, self.name)
        return state


class BehaviourAgent(BaseAgent):
    name = "behaviour"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        expense = dict(state.get("expense_report", {}))
        anomalies = list(expense.get("anomalies", []))
        velocity = float((expense.get("spend_velocity_7d", {}) or {}).get("change_pct", 0.0) or 0.0)
        impulse = min(100.0, max(0.0, len(anomalies) * 18.0 + max(0.0, velocity)))
        discipline = max(0.0, 100.0 - impulse)
        state["behaviour_report"] = {
            "impulse_spending_score": round(impulse, 1),
            "discipline_score": round(discipline, 1),
            "pattern_summary": "spike-driven" if impulse >= 55 else "stable",
        }
        self._trace(state, self.name)
        return state


class SentimentAgent(BaseAgent):
    name = "sentiment"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        message = str(state.get("message", "")).lower()
        tone = str(state.get("user_tone", "neutral"))
        emotional = any(k in message for k in ["stress", "panic", "sad", "frustrated", "overwhelmed", "impulse"])
        score = 0.75 if emotional or tone in {"stressed", "urgent"} else 0.35
        mood_label = "calm"
        if tone in {"stressed", "urgent"} or emotional:
            mood_label = "support_needed"
        elif tone in {"curious"}:
            mood_label = "curious"
        elif tone in {"casual"}:
            mood_label = "casual"
        state["sentiment_report"] = {
            "emotional_spending_flag": emotional,
            "stress_spending_flag": tone in {"stressed", "urgent"} or emotional,
            "confidence_score": round(score, 2),
            "mood_label": mood_label,
        }
        self._trace(state, self.name)
        return state


class InvestmentAgent(BaseAgent):
    name = "investment"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        user_state = dict(state.get("user_state", {}))
        intent = str(state.get("intent", "general"))
        sentiment = dict(state.get("sentiment_report", {}))
        mood = str(sentiment.get("mood_label", "calm"))
        cash = dict(user_state.get("cash_flow", {}))
        net = float(cash.get("net", 0.0) or 0.0)
        risk = str(user_state.get("risk_profile", "moderate"))
        surplus = max(0.0, net * 0.5)
        readiness = "not_ready" if net <= 0 else "emergency_fund_first" if net < 5000 else "ready_to_explore"
        alloc = "60/30/10 (core/diversified/learning bucket)"
        if risk == "conservative":
            alloc = "70/20/10 (safer/diversified/learning bucket)"
        readiness_reason = "negative_or_zero_surplus"
        if readiness == "emergency_fund_first":
            readiness_reason = "surplus_exists_but_buffer_thin"
        elif readiness == "ready_to_explore":
            readiness_reason = "positive_surplus_and_stability"

        engagement_hook = "Would you like a conservative, balanced, or growth-oriented sample roadmap?"
        if mood == "support_needed":
            engagement_hook = "Want me to keep this very low-risk and explain it in simple steps?"
        if intent != "investment_question":
            engagement_hook = "If you want, I can also show how this fits your current goal timeline."
        state["investment_report"] = {
            "investable_surplus": round(surplus, 2),
            "risk_score": risk,
            "readiness": readiness,
            "readiness_reason": readiness_reason,
            "illustrative_allocation": alloc,
            "engagement_hook": engagement_hook,
            "advice_disclaimer": "informational_only_not_financial_advice",
        }
        self._trace(state, self.name)
        return state


class LearningAgent(BaseAgent):
    name = "learning"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        intent = str(state.get("intent", "general"))
        tips = {
            "expense_question": ["Use weekly category caps to control variance."],
            "budget_question": ["Try 80/20: auto-save 20% before discretionary spend."],
            "investment_question": ["Build emergency cash before increasing risk exposure."],
            "education_request": ["Focus on cashflow, savings rate, and risk first."],
            "behaviour_analysis": ["Use a 24-hour pause rule for impulse purchases."],
            "emotional_spending": ["Create a low-cost stress alternative list before spending."],
            "forecasting": ["Review forecast weekly and compare with actuals."],
            "general": ["Track top 3 categories monthly to improve control."],
        }
        state["learning_report"] = {
            "tips": tips.get(intent, tips["general"]),
            "learning_path": ["Foundations", "Budgeting", "Risk", "Automation"],
        }
        self._trace(state, self.name)
        return state


class FinancialHealthAgent(BaseAgent):
    name = "financial_health"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        user_state = dict(state.get("user_state", {}))
        behaviour = dict(state.get("behaviour_report", {}))
        budget = dict(state.get("budget_report", {}))
        investment = dict(state.get("investment_report", {}))
        sentiment = dict(state.get("sentiment_report", {}))

        savings_rate = float(user_state.get("savings_rate_pct", 0.0) or 0.0)
        discipline = float(behaviour.get("discipline_score", 50.0) or 50.0)
        overspending = bool(budget.get("overspending_detected", False))
        emotional = bool(sentiment.get("emotional_spending_flag", False))
        readiness = str(investment.get("readiness", "not_ready"))

        savings_score = max(0.0, min(100.0, savings_rate * 2.0))
        stability_score = max(0.0, min(100.0, discipline - (20.0 if overspending else 0.0)))
        risk_score = 40.0
        if readiness == "ready_to_explore":
            risk_score = 65.0
        if emotional:
            risk_score -= 15.0

        overall = mean([savings_score, stability_score, risk_score])
        band = "good" if overall >= 70 else "watch" if overall >= 45 else "needs_attention"

        state["financial_health_report"] = {
            "savings_score": round(savings_score, 1),
            "stability_score": round(stability_score, 1),
            "risk_score": round(risk_score, 1),
            "overall_health_score": round(overall, 1),
            "health_band": band,
        }
        self._trace(state, self.name)
        return state


class SynthesizerAgent(BaseAgent):
    name = "synthesizer"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a highly engaging financial assistant synthesizer. "
                    "Write like a smart, warm coach. Never sound robotic or repetitive. "
                    "Adapt tone using user_tone and mood_label: "
                    "supportive when stressed, crisp when urgent, curious when user is curious. "
                    "Do not mention net cashflow unless show_net_cashflow is true. "
                    "For transaction questions, use transaction_report values exactly and never invent counts/totals. "
                    "If transaction_report has entries, include a small markdown table (up to 5 rows). "
                    "If intent is investment_question, be especially engaging: "
                    "explain readiness clearly, show 2-3 practical options, and ask one follow-up question. "
                    "For all intents, return: "
                    "1) direct answer, 2) strongest insight, 3) practical next action. "
                    "End with one short follow-up question when it helps continue the conversation. "
                    "Do not provide regulated investment advice. Use currency symbol \\u20B9 for amounts.",
                ),
                (
                    "human",
                    "User message: {message}\nIntent: {intent}\nLanguage: {language}\n"
                    "User tone: {user_tone}\nMood: {mood_label}\nDissatisfied: {dissatisfied}\n"
                    "explicit_cashflow_request: {explicit_cashflow_request}\n"
                    "show_net_cashflow: {show_net_cashflow}\n"
                    "User state: {user_state}\n"
                    "Expense report: {expense}\nBudget report: {budget}\nForecast: {forecast}\n"
                    "Behaviour: {behaviour}\nSentiment: {sentiment}\nInvestment: {investment}\n"
                    "Learning: {learning}\nFinancial health: {health}\n"
                    "Transaction report: {transaction_report}",
                ),
            ]
        )
        text = ""
        try:
            resp = await (prompt | ctx.llm).ainvoke(
                {
                    "message": state.get("message", ""),
                    "intent": state.get("intent", "general"),
                    "language": state.get("language", "English"),
                    "user_tone": state.get("user_tone", "neutral"),
                    "mood_label": (state.get("sentiment_report", {}) or {}).get("mood_label", "calm"),
                    "dissatisfied": bool(state.get("dissatisfied", False)),
                    "explicit_cashflow_request": bool((state.get("query_focus", {}) or {}).get("explicit_cashflow_request", False)),
                    "show_net_cashflow": bool(state.get("show_net_cashflow", False)),
                    "user_state": json.dumps(state.get("user_state", {})),
                    "expense": json.dumps(state.get("expense_report", {})),
                    "budget": json.dumps(state.get("budget_report", {})),
                    "forecast": json.dumps(state.get("forecast_report", {})),
                    "behaviour": json.dumps(state.get("behaviour_report", {})),
                    "sentiment": json.dumps(state.get("sentiment_report", {})),
                    "investment": json.dumps(state.get("investment_report", {})),
                    "learning": json.dumps(state.get("learning_report", {})),
                    "health": json.dumps(state.get("financial_health_report", {})),
                    "transaction_report": json.dumps(state.get("transaction_report", {})),
                }
            )
            text = str(resp.content).strip()
        except Exception:
            text = self._fallback_summary(state)

        if not bool(state.get("show_net_cashflow", False)):
            text = re.sub(r"(?im)^.*\bnet cashflow\b.*$", "", text)
            text = re.sub(r"(?im)^.*\bprojected_net\b.*$", "", text)
            text = re.sub(r"\n{3,}", "\n\n", text).strip()

        text = re.sub(r"\bINR\b", "\u20B9", text, flags=re.IGNORECASE)
        text = re.sub(r"\bRs\.?\s*", "\u20B9", text, flags=re.IGNORECASE)
        state["synthesized_response"] = text
        self._trace(state, self.name)
        return state

    def _fallback_summary(self, state: Dict[str, Any]) -> str:
        intent = str(state.get("intent", "general"))
        sentiment = dict(state.get("sentiment_report", {}))
        investment = dict(state.get("investment_report", {}))
        health = dict(state.get("financial_health_report", {}))
        budget = dict(state.get("budget_report", {}))
        forecast = dict(state.get("forecast_report", {}))
        tx = dict(state.get("transaction_report", {}))
        mood = str(sentiment.get("mood_label", "calm"))
        intro = "You are on the right track."
        if mood == "support_needed":
            intro = "You are doing better than you think. We can keep this simple and safe."
        if mood == "curious":
            intro = "Great question. Here is the clearest path."

        if intent == "investment_question":
            return (
                f"{intro}\n"
                f"- Readiness: {investment.get('readiness', 'unknown')} ({investment.get('readiness_reason', 'context')}).\n"
                f"- Suggested approach: {investment.get('illustrative_allocation', 'balanced staged allocation')}.\n"
                "- Next action: decide your horizon and monthly amount, then start with a low-risk base.\n"
                f"- {investment.get('engagement_hook', 'Want me to build a step-by-step beginner plan?')}"
            )
        tx_count = int(tx.get("transaction_count", 0) or 0)
        if tx_count > 0:
            lines = [
                f"{intro}",
                f"- Transactions found: {tx_count} in {tx.get('start_date', '')} to {tx.get('end_date_exclusive', '')}.",
                f"- Debit: \u20B9{float(tx.get('total_debit', 0) or 0):,.0f}, Credit: \u20B9{float(tx.get('total_credit', 0) or 0):,.0f}.",
            ]
            if bool(state.get("show_net_cashflow", False)):
                lines.append(f"- Net cashflow: \u20B9{float(tx.get('net_cashflow', 0) or 0):,.0f}.")
            lines.append("Here are recent transactions:")
            lines.append(self._format_transaction_table(tx))
            lines.append("- Want me to break this down by category and suggest one optimization?")
            return "\n".join(lines)
        return (
            f"{intro}\n"
            f"- Overall health score: {health.get('overall_health_score', 0)} ({health.get('health_band', 'watch')}).\n"
            f"- Budget model: 80/20, overspending={budget.get('overspending_detected', False)}.\n"
            f"- Forecast: inflow \u20B9{forecast.get('projected_inflow', 0)} vs outflow \u20B9{forecast.get('projected_outflow', 0)}.\n"
            "- Next action: review top 2 spending categories and set one cap for this week.\n"
            "- Want a focused 7-day action plan?"
        )

    def _format_transaction_table(self, tx: Dict[str, Any]) -> str:
        rows = list(tx.get("transactions", []))[:5]
        if not rows:
            return "_No transactions in this range._"
        table = [
            "| Date | Description | Category | Type | Amount |",
            "|---|---|---|---|---:|",
        ]
        for item in rows:
            desc = str(item.get("description", "")).replace("|", " ").strip()[:30]
            cat = str(item.get("category", "Other")).replace("|", " ").strip()
            typ = str(item.get("transaction_type", "debit")).strip()
            amt = float(item.get("amount", 0) or 0)
            table.append(f"| {item.get('date', '')} | {desc} | {cat} | {typ} | \u20B9{amt:,.0f} |")
        return "\n".join(table)


class HumanReviewAgent(BaseAgent):
    name = "human_review"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        if not bool(state.get("needs_human_review", False)):
            return state
        reason = str(state.get("human_review_reason", "policy_guardrail"))
        review_note = (
            "Review needed before applying changes."
            if reason == "investment_readiness_confirmation"
            else "Review suggested due to unusually large anomalies."
        )
        state["review_note"] = review_note
        self._trace(state, f"{self.name}:{reason}")
        return state


class MemoryUpdateAgent(BaseAgent):
    name = "memory_update"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        user_id = str(state.get("user_id", "")).strip()
        if not user_id:
            return state

        health = dict(state.get("financial_health_report", {}))
        sentiment = dict(state.get("sentiment_report", {}))
        investment = dict(state.get("investment_report", {}))

        memory_text = (
            f"Health={health.get('overall_health_score', 0)} ({health.get('health_band', 'watch')}). "
            f"SentimentFlag={sentiment.get('emotional_spending_flag', False)}. "
            f"RiskReadiness={investment.get('readiness', 'unknown')}."
        )
        payload = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "text": memory_text[:500],
            "tags": ["orchestrator", "health", "sentiment", "risk"],
            "source": "assistant_orchestrator",
            "created_at": datetime.utcnow(),
        }
        await ctx.db.assistant_memories.insert_one(payload)
        self._trace(state, self.name)
        return state


class FinalResponseAgent(BaseAgent):
    name = "final_response"

    async def run(self, state: Dict[str, Any], ctx: AgentContext) -> Dict[str, Any]:
        if bool(state.get("needs_clarification", False)):
            questions = list(state.get("clarification_questions", []))
            response = "Before I proceed, I need a couple of details:\n" + "\n".join(
                [f"- {q}" for q in questions]
            )
        else:
            response = str(state.get("synthesized_response", "")).strip()
            note = str(state.get("review_note", "")).strip()
            if note:
                response = f"{response}\n\n{note}\nReply 'approve' to continue or tell me what to change."

        state["response"] = response
        self._trace(state, self.name)
        return state


class AssistantOrchestrator:
    def __init__(self, *, db: Any, llm: Any) -> None:
        self.ctx = AgentContext(db=db, llm=llm, tools=AssistantTools(db))
        self.intent = IntentDetectionAgent()
        self.user_state = UserStateAgent()
        self.planner = PlannerAgent()
        self.clarification = ClarificationAgent()
        self.agents: Dict[str, AssistantAgent] = {
            "ingestion": IngestionAgent(),
            "categorization": CategorizationAgent(),
            "transaction_query": TransactionQueryAgent(),
            "expense": ExpenseAgent(),
            "budget": BudgetAgent(),
            "forecasting": ForecastingAgent(),
            "behaviour": BehaviourAgent(),
            "sentiment": SentimentAgent(),
            "investment": InvestmentAgent(),
            "learning": LearningAgent(),
            "financial_health": FinancialHealthAgent(),
            "synthesizer": SynthesizerAgent(),
        }
        self.review = HumanReviewAgent()
        self.memory = MemoryUpdateAgent()
        self.final = FinalResponseAgent()

    async def run(self, initial_state: Dict[str, Any]) -> Dict[str, Any]:
        state = dict(initial_state)
        state.setdefault("agent_trace", [])
        state.setdefault("citations", [])

        state = await self.intent.run(state, self.ctx)
        state = await self.user_state.run(state, self.ctx)
        state = await self.planner.run(state, self.ctx)

        if bool(state.get("needs_clarification", False)):
            state = await self.clarification.run(state, self.ctx)
            state = await self.final.run(state, self.ctx)
            return state

        for step in list(state.get("plan", [])):
            agent = self.agents.get(step)
            if agent:
                state = await agent.run(state, self.ctx)

        state = await self.review.run(state, self.ctx)
        state = await self.memory.run(state, self.ctx)
        state = await self.final.run(state, self.ctx)
        return state
