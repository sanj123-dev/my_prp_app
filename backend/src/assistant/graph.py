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
    analysis: str
    response: str
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

        builder.set_entry_point("router")
        builder.add_edge("router", "retriever")
        builder.add_conditional_edges(
            "retriever",
            self._after_retriever,
            {"coach": "coach", "analyst": "analyst"},
        )
        builder.add_edge("analyst", "coach")
        builder.add_edge("coach", END)
        return builder

    def _after_retriever(self, state: AssistantGraphState) -> str:
        intent = state.get("intent", "planning")
        if intent == "smalltalk":
            return "coach"
        return "analyst"

    async def _router_agent(self, state: AssistantGraphState) -> AssistantGraphState:
        message = state.get("message", "")
        trace = list(state.get("agent_trace", []))

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
            lowered = message.lower()
            if any(word in lowered for word in ["how much", "spent", "balance", "total", "last month"]):
                intent = "data_query"
            elif any(word in lowered for word in ["what is", "explain", "meaning", "learn"]):
                intent = "education"
            elif any(word in lowered for word in ["hi", "hello", "hey", "namaste"]):
                intent = "smalltalk"

        trace.append(f"router:{intent}")
        return {"intent": intent, "agent_trace": trace}

    async def _retriever_agent(self, state: AssistantGraphState) -> AssistantGraphState:
        user_id = state["user_id"]
        message = state["message"]
        trace = list(state.get("agent_trace", []))

        hits = await self.tools.semantic_context(user_id=user_id, query=message, limit=6)
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
            "agent_trace": trace,
        }

    async def _analyst_agent(self, state: AssistantGraphState) -> AssistantGraphState:
        user_id = state["user_id"]
        message = state["message"]
        context = state.get("retrieved_context", "")
        trace = list(state.get("agent_trace", []))

        snapshot = await self.tools.financial_snapshot(user_id=user_id, days=45)
        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a senior financial analyst assistant. "
                    "Use provided snapshot values exactly. Be practical, specific, and concise.",
                ),
                (
                    "human",
                    "User message:\n{message}\n\nFinancial snapshot:\n{snapshot}\n\nRetrieved context:\n{context}\n\n"
                    "Return a short analysis (3-6 lines) with one concrete recommendation.",
                ),
            ]
        )
        response = await (prompt | self.llm).ainvoke(
            {"message": message, "snapshot": json.dumps(snapshot), "context": context}
        )
        trace.append("analyst:done")
        return {
            "financial_snapshot": snapshot,
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
        trace = list(state.get("agent_trace", []))

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are SpendWise multi-agent financial assistant. "
                    "Respond naturally, avoid robotic tone, and keep the answer practical.",
                ),
                (
                    "human",
                    "Intent: {intent}\nLanguage: {language}\nUser message: {message}\n\n"
                    "Financial snapshot: {snapshot}\n\n"
                    "Analysis draft: {analysis}\n\n"
                    "Retrieved context: {context}\n\n"
                    "Write the final response in 4-8 lines max. "
                    "Use rupee symbol for money values when amounts are mentioned. "
                    "Close with one forward-looking follow-up question.",
                ),
            ]
        )
        response = await (prompt | self.llm).ainvoke(
            {
                "intent": intent,
                "language": language,
                "message": message,
                "snapshot": json.dumps(snapshot),
                "analysis": analysis,
                "context": context,
            }
        )

        final_text = str(response.content).strip()
        final_text = re.sub(r"\bINR\b", "₹", final_text, flags=re.IGNORECASE)
        trace.append("coach:finalized")
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
