from __future__ import annotations

from typing import Any, Dict, List, Literal, TypedDict
import json
import re

from langchain_core.prompts import ChatPromptTemplate
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from .tools import AssistantTools


Intent = Literal["data_query", "planning", "education", "smalltalk"]


class AssistantGraphState(TypedDict, total=False):
    user_id: str
    session_id: str
    language: str
    message: str
    intent: Intent
    retrieved_context: str
    citations: List[Dict[str, Any]]
    financial_snapshot: Dict[str, Any]
    analytics_report: Dict[str, Any]
    user_profile: Dict[str, Any]
    analysis: str
    response: str
    daily_checkin: bool
    goal_change: bool
    requires_professional_disclaimer: bool
    dissatisfied: bool
    user_tone: str
    response_style: str
    query_focus: Dict[str, Any]
    recent_dialogue: List[Dict[str, str]]
    user_style_preferences: Dict[str, Any]
    agent_trace: List[str]


class AssistantGraph:
    def __init__(self, db: Any, llm: Any) -> None:
        self.db = db
        self.llm = llm
        self.tools = AssistantTools(db)
        self.graph = self._build().compile(checkpointer=MemorySaver())

    async def run(
        self,
        *,
        user_id: str,
        session_id: str,
        message: str,
        language: str,
    ) -> AssistantGraphState:
        initial_state: AssistantGraphState = {
            "user_id": user_id,
            "session_id": session_id,
            "message": message.strip(),
            "language": language.strip() or "English",
            "agent_trace": [],
            "citations": [],
        }
        return await self.graph.ainvoke(
            initial_state,
            config={"configurable": {"thread_id": session_id}},
        )

    def _build(self):
        builder = StateGraph(AssistantGraphState)
        builder.add_node("router", self._router_agent)
        builder.add_node("retriever", self._retriever_agent)
        builder.add_node("analyst", self._analyst_agent)
        builder.add_node("coach", self._coach_agent)
        builder.add_node("validator", self._validator_agent)

        builder.set_entry_point("router")
        builder.add_edge("router", "retriever")
        builder.add_conditional_edges(
            "retriever",
            self._after_retriever,
            {"coach": "coach", "analyst": "analyst"},
        )
        builder.add_edge("analyst", "coach")
        builder.add_edge("coach", "validator")
        builder.add_edge("validator", END)
        return builder

    def _after_retriever(self, state: AssistantGraphState) -> str:
        intent = state.get("intent", "planning")
        if intent == "smalltalk":
            return "coach"
        return "analyst"

    async def _router_agent(self, state: AssistantGraphState) -> AssistantGraphState:
        message = state.get("message", "")
        trace = list(state.get("agent_trace", []))
        lowered = message.lower()
        user_tone = self.tools.infer_user_tone(message)
        dissatisfied = self.tools.detect_dissatisfaction(message)
        query_focus = self.tools.finance_query_focus(message)

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "Classify the user message into one intent: data_query, planning, education, smalltalk. "
                    "Return strict JSON: {\"intent\":\"...\"}.",
                ),
                ("human", "{message}"),
            ]
        )

        intent: Intent = "planning"
        try:
            response = await (prompt | self.llm).ainvoke({"message": message})
            payload = json.loads(self._extract_json(str(response.content)))
            candidate = str(payload.get("intent", "")).strip().lower()
            if candidate in {"data_query", "planning", "education", "smalltalk"}:
                intent = candidate  # type: ignore[assignment]
        except Exception:
            if any(
                word in lowered
                for word in ["how much", "spent", "balance", "total", "last month", "trend", "analytics", "compare"]
            ):
                intent = "data_query"
            elif any(word in lowered for word in ["what is", "explain", "meaning", "learn"]):
                intent = "education"
            elif any(word in lowered for word in ["hi", "hello", "hey", "namaste"]):
                intent = "smalltalk"

        daily_checkin = any(
            phrase in lowered
            for phrase in ["check in", "check-in", "daily check", "today update", "today status", "morning update"]
        )
        goal_change = any(
            phrase in lowered
            for phrase in ["new goal", "change my goal", "update my goal", "my goal is", "i want a new goal"]
        )
        requires_professional_disclaimer = any(
            phrase in lowered
            for phrase in [
                "legal advice",
                "tax filing",
                "lawsuit",
                "regulated advice",
                "guaranteed return",
            ]
        )

        trace.append(f"router:{intent}")
        return {
            "intent": intent,
            "daily_checkin": daily_checkin,
            "goal_change": goal_change,
            "requires_professional_disclaimer": requires_professional_disclaimer,
            "dissatisfied": dissatisfied,
            "user_tone": user_tone,
            "query_focus": query_focus,
            "agent_trace": trace,
        }

    async def _retriever_agent(self, state: AssistantGraphState) -> AssistantGraphState:
        user_id = state["user_id"]
        session_id = state["session_id"]
        message = state["message"]
        trace = list(state.get("agent_trace", []))

        hits = await self.tools.semantic_context(user_id=user_id, query=message, limit=6)
        profile = await self.tools.user_profile_summary(user_id)
        recent_dialogue = await self.tools.recent_dialogue(user_id=user_id, session_id=session_id, limit=8)
        user_style_preferences = await self.tools.user_style_preferences(user_id=user_id)
        response_style = self.tools.preferred_response_style(message=message, dialogue=recent_dialogue)
        preferred_style = str(user_style_preferences.get("style_preference", "balanced"))
        if response_style == "balanced" and preferred_style in {"concise", "detailed", "example_driven", "balanced"}:
            response_style = preferred_style
        context_lines = []
        citations: List[Dict[str, Any]] = []
        for item in hits[:4]:
            snippet = str(item.get("text", "")).strip().replace("\n", " ")
            context_lines.append(f"[{item.get('source', 'context')}] {snippet[:280]}")
            citations.append(
                {
                    "source": str(item.get("source", "context")),
                    "snippet": snippet[:180],
                    "score": round(float(item.get("score", 0.0) or 0.0), 4),
                }
            )

        trace.append(f"retriever:{len(citations)}")
        return {
            "retrieved_context": "\n".join(context_lines) if context_lines else "No relevant context found.",
            "citations": citations,
            "user_profile": profile,
            "recent_dialogue": recent_dialogue,
            "user_style_preferences": user_style_preferences,
            "response_style": response_style,
            "agent_trace": trace,
        }

    async def _analyst_agent(self, state: AssistantGraphState) -> AssistantGraphState:
        user_id = state["user_id"]
        message = state["message"]
        context = state.get("retrieved_context", "")
        intent = state.get("intent", "planning")
        query_focus = state.get("query_focus", {})
        trace = list(state.get("agent_trace", []))

        snapshot = await self.tools.financial_snapshot(user_id=user_id, days=45)
        analytics = await self.tools.analytics_report(user_id=user_id, days=90)
        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a senior financial analyst assistant. "
                    "Use provided metrics exactly. Prioritize trend insight and practical explanation. "
                    "Avoid repeating only net cashflow unless the user explicitly asked for it.",
                ),
                (
                    "human",
                    "Intent: {intent}\n"
                    "Query focus: {query_focus}\n"
                    "User message:\n{message}\n\n"
                    "Financial snapshot:\n{snapshot}\n\n"
                    "Analytics report:\n{analytics}\n\n"
                    "Retrieved context:\n{context}\n\n"
                    "Return a concise analysis with:\n"
                    "1) direct answer to user ask\n"
                    "2) strongest metric for requested focus\n"
                    "3) trend direction\n"
                    "4) one action the user can choose.\n"
                    "If focus includes category_breakdown/anomalies/velocity_7d/goal_progress, prioritize those over generic net cashflow.",
                ),
            ]
        )
        response = await (prompt | self.llm).ainvoke(
            {
                "intent": intent,
                "query_focus": json.dumps(query_focus),
                "message": message,
                "snapshot": json.dumps(snapshot),
                "analytics": json.dumps(analytics),
                "context": context,
            }
        )
        trace.append("analyst:done")
        return {
            "financial_snapshot": snapshot,
            "analytics_report": analytics,
            "analysis": str(response.content).strip(),
            "agent_trace": trace,
        }

    async def _coach_agent(self, state: AssistantGraphState) -> AssistantGraphState:
        message = state.get("message", "")
        intent = state.get("intent", "planning")
        language = state.get("language", "English")
        context = state.get("retrieved_context", "")
        analysis = state.get("analysis", "")
        snapshot = state.get("financial_snapshot", {})
        analytics = state.get("analytics_report", {})
        profile = state.get("user_profile", {})
        daily_checkin = bool(state.get("daily_checkin", False))
        goal_change = bool(state.get("goal_change", False))
        needs_disclaimer = bool(state.get("requires_professional_disclaimer", False))
        dissatisfied = bool(state.get("dissatisfied", False))
        user_tone = state.get("user_tone", "neutral")
        response_style = state.get("response_style", "balanced")
        recent_dialogue = state.get("recent_dialogue", [])
        query_focus = state.get("query_focus", {})
        user_style_preferences = state.get("user_style_preferences", {})
        trace = list(state.get("agent_trace", []))

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are CalmCoach. Warm, concise, non-judgmental, friend-like money coach.\n"
                    "Always personalize with profile context naturally.\n"
                    "For data/analytics queries, mention concrete numbers from snapshot/analytics.\n"
                    "Adapt tone to user emotional state and prior conversation style.\n"
                    "Vary phrasing and structure so replies do not feel repetitive.\n"
                    "Never recommend risky investing, loans, gambling, or fear-based action.\n"
                    "Ask before any financial action/automation.",
                ),
                (
                    "human",
                    "Intent: {intent}\nLanguage: {language}\nUser message: {message}\n\n"
                    "User tone: {user_tone}\n"
                    "Preferred response style: {response_style}\n"
                    "Dissatisfied signal: {dissatisfied}\n"
                    "Query focus: {query_focus}\n\n"
                    "Persisted user style preferences: {user_style_preferences}\n\n"
                    "Daily check-in requested: {daily_checkin}\n"
                    "Goal-change detected: {goal_change}\n"
                    "Needs professional disclaimer: {needs_disclaimer}\n\n"
                    "Recent dialogue window: {recent_dialogue}\n\n"
                    "User profile context: {profile}\n\n"
                    "Financial snapshot: {snapshot}\n\n"
                    "Analytics report: {analytics}\n\n"
                    "Analysis draft: {analysis}\n\n"
                    "Retrieved context: {context}\n\n"
                    "Output format:\n"
                    "- Use \\u20B9 for money values.\n"
                    "- Normal response: 2-5 short sentences and one gentle follow-up question.\n"
                    "- If intent=data_query, include at least one trend insight.\n"
                    "- If dissatisfied=true, start with a short apology and then provide a fresher style response.\n"
                    "- Avoid repeating the phrase 'net cash flow' unless explicitly requested.\n"
                    "- If daily_checkin is true, use 4 short lines:\n"
                    "1) greeting with user's name\n"
                    "2) quick status update tied to goal\n"
                    "3) one small action to take now\n"
                    "4) ask if they want to do it\n",
                ),
            ]
        )
        response = await (prompt | self.llm).ainvoke(
            {
                "intent": intent,
                "language": language,
                "message": message,
                "user_tone": user_tone,
                "response_style": response_style,
                "dissatisfied": dissatisfied,
                "query_focus": json.dumps(query_focus),
                "user_style_preferences": json.dumps(user_style_preferences),
                "daily_checkin": daily_checkin,
                "goal_change": goal_change,
                "needs_disclaimer": needs_disclaimer,
                "recent_dialogue": json.dumps(recent_dialogue),
                "profile": json.dumps(profile),
                "snapshot": json.dumps(snapshot),
                "analytics": json.dumps(analytics),
                "analysis": analysis,
                "context": context,
            }
        )

        final_text = str(response.content).strip()
        final_text = re.sub(r"\bINR\b", "\u20B9", final_text, flags=re.IGNORECASE)
        final_text = re.sub(r"\bRs\.?\s*", "\u20B9", final_text, flags=re.IGNORECASE)
        trace.append("coach:finalized")
        return {"response": final_text, "agent_trace": trace}

    async def _validator_agent(self, state: AssistantGraphState) -> AssistantGraphState:
        message = state.get("message", "")
        response = state.get("response", "").strip()
        language = state.get("language", "English")
        daily_checkin = bool(state.get("daily_checkin", False))
        goal_change = bool(state.get("goal_change", False))
        needs_disclaimer = bool(state.get("requires_professional_disclaimer", False))
        dissatisfied = bool(state.get("dissatisfied", False))
        user_id = state.get("user_id", "")
        query_focus = state.get("query_focus", {})
        trace = list(state.get("agent_trace", []))

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a strict response validator for CalmCoach.\n"
                    "Rewrite only if needed so response follows rules exactly.\n"
                    "Rules:\n"
                    "- Warm, supportive, non-judgmental.\n"
                    "- Ask before any financial action/automation.\n"
                    "- No pressure/fear/urgency.\n"
                    "- No loans, risky investments, gambling suggestions.\n"
                    "- No password/OTP content.\n"
                    "- Use \\u20B9 for money.\n"
                    "- If daily_checkin=true: return exactly 4 short lines in required structure.\n"
                    "- Else: 2-5 short sentences + one gentle follow-up question.\n"
                    "- If dissatisfied=true include a brief apology and ensure wording is clearly different from repetitive style.\n"
                    "- Prefer metrics aligned with query_focus over generic net cashflow.\n"
                    "- If needs_disclaimer=true include this exact sentence:\n"
                    "I can share general information, but for legal or regulated financial decisions, please consult a licensed professional.\n"
                    "- If goal_change=true include this exact sentence:\n"
                    "Want me to update your profile with this new goal?\n"
                    "- Return only final user-facing text.",
                ),
                (
                    "human",
                    "Language: {language}\n"
                    "User message: {message}\n"
                    "query_focus: {query_focus}\n"
                    "daily_checkin: {daily_checkin}\n"
                    "goal_change: {goal_change}\n"
                    "needs_disclaimer: {needs_disclaimer}\n\n"
                    "dissatisfied: {dissatisfied}\n\n"
                    "Candidate response:\n{response}",
                ),
            ]
        )

        try:
            checked = await (prompt | self.llm).ainvoke(
                {
                    "language": language,
                    "message": message,
                    "query_focus": json.dumps(query_focus),
                    "daily_checkin": daily_checkin,
                    "goal_change": goal_change,
                    "needs_disclaimer": needs_disclaimer,
                    "dissatisfied": dissatisfied,
                    "response": response,
                }
            )
            final_text = str(checked.content).strip() or response
        except Exception:
            final_text = response

        final_text = re.sub(r"\bINR\b", "\u20B9", final_text, flags=re.IGNORECASE)
        final_text = re.sub(r"\bRs\.?\s*", "\u20B9", final_text, flags=re.IGNORECASE)

        if needs_disclaimer:
            required = (
                "I can share general information, but for legal or regulated financial decisions, "
                "please consult a licensed professional."
            )
            if required not in final_text:
                final_text = f"{final_text}\n{required}".strip()

        if goal_change:
            required_goal = "Want me to update your profile with this new goal?"
            if required_goal not in final_text:
                final_text = f"{final_text}\n{required_goal}".strip()

        if dissatisfied:
            lowered = final_text.lower()
            if "sorry" not in lowered:
                final_text = f"Sorry about that. {final_text}".strip()
            if user_id:
                try:
                    await self.tools.store_feedback_memory(
                        user_id=user_id,
                        text=f"User disliked repetitive reply pattern. Message: {message[:220]}",
                        tags=["feedback", "dissatisfied", "style", "avoid-repetition"],
                    )
                except Exception:
                    pass

        trace.append("validator:checked")
        return {"response": final_text, "agent_trace": trace}

    @staticmethod
    def _extract_json(text: str) -> str:
        text = text.strip()
        if text.startswith("{") and text.endswith("}"):
            return text
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return text[start : end + 1]
        raise ValueError("No JSON object found")
