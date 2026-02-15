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
            metadata={"idempotency_key": str(uuid.uuid4())},
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

        assistant_msg = AssistantMessage(
            user_id=user_id,
            session_id=active_session_id,
            role="assistant",
            content=response,
            metadata={"agent_trace": agent_trace, "citations": citations},
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
