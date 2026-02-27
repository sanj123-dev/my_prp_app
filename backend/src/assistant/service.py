from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
import os
import uuid

from langchain_openai import ChatOpenAI

from .graph import AssistantGraph
from .schemas import AssistantMessage, AssistantSession


def _build_llm() -> ChatOpenAI:
    api_key = (os.environ.get("GROQ_API_KEY", "") or "").strip()
    base_url = (os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1") or "").strip()
    model = (os.environ.get("ASSISTANT_MODEL", "llama-3.3-70b-versatile") or "").strip()
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is missing for assistant module")
    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=base_url,
        temperature=0.25,
    )


class AssistantService:
    def __init__(self, db: Any) -> None:
        self.db = db
        self.graph = AssistantGraph(db=db, llm=_build_llm())

    async def start_or_reuse_session(
        self,
        *,
        user_id: str,
        language: str = "English",
        existing_session_id: Optional[str] = None,
        reuse_window_minutes: int = 20,
    ) -> Dict[str, Any]:
        now = datetime.utcnow()

        if existing_session_id:
            existing = await self.db.assistant_sessions.find_one(
                {"id": existing_session_id, "user_id": user_id, "status": "active"}
            )
            if existing:
                last_activity = existing.get("last_activity_at", now)
                if now - last_activity <= timedelta(minutes=reuse_window_minutes):
                    return {**existing, "_reused": True}

        latest = await self.db.assistant_sessions.find_one(
            {"user_id": user_id, "status": "active"},
            sort=[("last_activity_at", -1)],
        )
        if latest:
            last_activity = latest.get("last_activity_at", now)
            if now - last_activity <= timedelta(minutes=reuse_window_minutes):
                return {**latest, "_reused": True}

        session = AssistantSession(user_id=user_id, language=language.strip() or "English")
        await self.db.assistant_sessions.insert_one(session.model_dump())
        return {**session.model_dump(), "_reused": False}

    async def chat(
        self,
        *,
        user_id: str,
        message: str,
        session_id: Optional[str],
        language: str,
        source: str = "text",
    ) -> Dict[str, Any]:
        active_session = await self.start_or_reuse_session(
            user_id=user_id,
            language=language,
            existing_session_id=session_id,
        )
        active_session_id = str(active_session["id"])
        preferred_language = str(active_session.get("language", language) or "English")

        user_msg = AssistantMessage(
            user_id=user_id,
            session_id=active_session_id,
            role="user",
            content=message,
            metadata={
                "idempotency_key": str(uuid.uuid4()),
                "source": source,
            },
        )
        await self.db.assistant_messages.insert_one(user_msg.model_dump())

        output = await self.graph.run(
            user_id=user_id,
            session_id=active_session_id,
            message=message,
            language=preferred_language,
        )

        response = str(output.get("response", "")).strip()
        citations = list(output.get("citations", []))
        agent_trace = list(output.get("agent_trace", []))
        response_style = str(output.get("response_style", "balanced"))
        detected_tone = str(output.get("user_tone", "neutral"))
        query_focus = dict(output.get("query_focus", {}))

        assistant_msg = AssistantMessage(
            user_id=user_id,
            session_id=active_session_id,
            role="assistant",
            content=response,
            metadata={
                "agent_trace": agent_trace,
                "citations": citations,
                "response_style": response_style,
                "detected_user_tone": detected_tone,
                "query_focus": query_focus,
                "source": source,
            },
        )
        await self.db.assistant_messages.insert_one(assistant_msg.model_dump())

        await self.db.assistant_sessions.update_one(
            {"id": active_session_id, "user_id": user_id},
            {
                "$set": {"last_activity_at": datetime.utcnow(), "language": preferred_language},
                "$inc": {"message_count": 2},
            },
        )

        return {
            "session_id": active_session_id,
            "response": response,
            "agent_trace": agent_trace,
            "citations": citations,
        }

    async def submit_feedback(
        self,
        *,
        user_id: str,
        value: str,
        session_id: Optional[str],
        message_id: Optional[str],
        feedback_text: Optional[str],
        preferred_style: Optional[str],
        preferred_tone: Optional[str],
    ) -> Dict[str, Any]:
        target_message: Dict[str, Any] = {}
        if message_id:
            target_message = await self.db.assistant_messages.find_one(
                {"id": message_id, "user_id": user_id, "role": "assistant"}
            ) or {}
        elif session_id:
            target_message = await self.db.assistant_messages.find_one(
                {"user_id": user_id, "session_id": session_id, "role": "assistant"},
                sort=[("created_at", -1)],
            ) or {}

        metadata = dict(target_message.get("metadata", {})) if target_message else {}
        applied_style = str(metadata.get("response_style", "balanced"))
        if applied_style not in {"concise", "detailed", "example_driven", "balanced"}:
            applied_style = "balanced"

        pref_doc = await self.db.assistant_user_prefs.find_one({"user_id": user_id}) or {}
        scores = {
            "concise": int((pref_doc.get("style_scores", {}) or {}).get("concise", 0)),
            "detailed": int((pref_doc.get("style_scores", {}) or {}).get("detailed", 0)),
            "example_driven": int((pref_doc.get("style_scores", {}) or {}).get("example_driven", 0)),
            "balanced": int((pref_doc.get("style_scores", {}) or {}).get("balanced", 0)),
        }

        if value == "up":
            if preferred_style and preferred_style in scores:
                scores[preferred_style] += 2
            else:
                scores[applied_style] += 1
        else:
            scores[applied_style] -= 2
            if preferred_style and preferred_style in scores:
                scores[preferred_style] += 1

        chosen_style = max(scores.items(), key=lambda item: item[1])[0]
        effective_tone = preferred_tone or str(pref_doc.get("tone_preference", "")).strip() or None

        feedback_id = str(uuid.uuid4())
        feedback_payload = {
            "id": feedback_id,
            "user_id": user_id,
            "session_id": session_id or str(target_message.get("session_id", "")),
            "message_id": message_id or str(target_message.get("id", "")),
            "value": value,
            "applied_style": applied_style,
            "preferred_style": preferred_style,
            "preferred_tone": preferred_tone,
            "feedback_text": (feedback_text or "").strip()[:500],
            "created_at": datetime.utcnow(),
        }
        await self.db.assistant_feedback.insert_one(feedback_payload)

        await self.db.assistant_user_prefs.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "style_scores": scores,
                    "style_preference": chosen_style,
                    "tone_preference": effective_tone,
                    "updated_at": datetime.utcnow(),
                },
                "$setOnInsert": {"created_at": datetime.utcnow()},
            },
            upsert=True,
        )

        memory_text = (
            f"Feedback={value}. "
            f"Applied style={applied_style}. "
            f"Preferred style={preferred_style or 'none'}. "
            f"Note={((feedback_text or '').strip() or 'none')[:220]}"
        )
        await self.upsert_memory(
            user_id=user_id,
            text=memory_text,
            tags=["feedback", "style", value],
            source="user_feedback",
        )

        return {
            "status": "recorded",
            "user_id": user_id,
            "feedback_id": feedback_id,
            "updated_style_preference": chosen_style,
            "style_scores": scores,
            "updated_tone_preference": effective_tone,
        }

    async def get_history(self, user_id: str, session_id: Optional[str], limit: int = 80) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {"user_id": user_id}
        if session_id:
            query["session_id"] = session_id
        docs = await self.db.assistant_messages.find(query).sort("created_at", -1).limit(limit).to_list(limit)
        docs.reverse()
        return docs

    async def upsert_memory(self, user_id: str, text: str, tags: List[str], source: str) -> Dict[str, Any]:
        payload = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "text": text.strip(),
            "tags": tags[:20],
            "source": source,
            "created_at": datetime.utcnow(),
        }
        await self.db.assistant_memories.insert_one(payload)
        return payload

    async def upsert_knowledge(self, title: str, text: str, source: str, tags: List[str]) -> Dict[str, Any]:
        payload = {
            "id": str(uuid.uuid4()),
            "title": title.strip()[:140],
            "text": text.strip(),
            "source": source,
            "tags": tags[:20],
            "created_at": datetime.utcnow(),
        }
        await self.db.assistant_knowledge.insert_one(payload)
        return payload


async def init_assistant_module(db: Any) -> None:
    await db.assistant_sessions.create_index([("id", 1)], unique=True)
    await db.assistant_sessions.create_index([("user_id", 1), ("status", 1), ("last_activity_at", -1)])
    await db.assistant_messages.create_index([("id", 1)], unique=True)
    await db.assistant_messages.create_index([("user_id", 1), ("session_id", 1), ("created_at", -1)])
    await db.assistant_memories.create_index([("id", 1)], unique=True)
    await db.assistant_memories.create_index([("user_id", 1), ("created_at", -1)])
    await db.assistant_knowledge.create_index([("id", 1)], unique=True)
    await db.assistant_feedback.create_index([("id", 1)], unique=True)
    await db.assistant_feedback.create_index([("user_id", 1), ("created_at", -1)])
    await db.assistant_user_prefs.create_index([("user_id", 1)], unique=True)
