from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from .schemas import (
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantFeedbackRequest,
    AssistantFeedbackResponse,
    AssistantKnowledgeUpsertRequest,
    AssistantMemoryUpsertRequest,
    AssistantSessionStartRequest,
    AssistantSessionStartResponse,
)
from .service import AssistantService


def create_assistant_router(db_provider) -> APIRouter:
    router = APIRouter(prefix="/assistant", tags=["assistant"])
    cache: Dict[str, AssistantService] = {}

    def get_db():
        return db_provider()

    def get_service(db=Depends(get_db)) -> AssistantService:
        cache_key = "assistant_service"
        if cache_key not in cache:
            cache[cache_key] = AssistantService(db)
        return cache[cache_key]

    @router.post("/session/start", response_model=AssistantSessionStartResponse)
    async def start_session(payload: AssistantSessionStartRequest, service: AssistantService = Depends(get_service)):
        session = await service.start_or_reuse_session(
            user_id=payload.user_id,
            language=(payload.language or "English"),
            existing_session_id=payload.existing_session_id,
        )
        return AssistantSessionStartResponse(
            session_id=str(session["id"]),
            reused=bool(session.get("_reused", False)),
            language=str(session.get("language", payload.language or "English")),
        )

    @router.post("/chat", response_model=AssistantChatResponse)
    async def assistant_chat(payload: AssistantChatRequest, service: AssistantService = Depends(get_service)):
        if not payload.message.strip():
            raise HTTPException(status_code=400, detail="Message cannot be empty")
        result = await service.chat(
            user_id=payload.user_id,
            message=payload.message,
            session_id=payload.session_id,
            language=(payload.language or "English"),
        )
        return AssistantChatResponse(**result)

    @router.post("/feedback", response_model=AssistantFeedbackResponse)
    async def assistant_feedback(payload: AssistantFeedbackRequest, service: AssistantService = Depends(get_service)):
        result = await service.submit_feedback(
            user_id=payload.user_id,
            value=payload.value,
            session_id=payload.session_id,
            message_id=payload.message_id,
            feedback_text=payload.feedback_text,
            preferred_style=payload.preferred_style,
            preferred_tone=payload.preferred_tone,
        )
        return AssistantFeedbackResponse(**result)

    @router.get("/chat/{user_id}")
    async def get_assistant_history(
        user_id: str,
        session_id: Optional[str] = None,
        limit: int = Query(80, ge=1, le=300),
        service: AssistantService = Depends(get_service),
    ):
        return await service.get_history(user_id=user_id, session_id=session_id, limit=limit)

    @router.post("/memory/upsert")
    async def upsert_memory(payload: AssistantMemoryUpsertRequest, service: AssistantService = Depends(get_service)):
        if not payload.text.strip():
            raise HTTPException(status_code=400, detail="Memory text cannot be empty")
        return await service.upsert_memory(
            user_id=payload.user_id,
            text=payload.text,
            tags=payload.tags,
            source=payload.source,
        )

    @router.post("/knowledge/upsert")
    async def upsert_knowledge(payload: AssistantKnowledgeUpsertRequest, service: AssistantService = Depends(get_service)):
        if not payload.text.strip():
            raise HTTPException(status_code=400, detail="Knowledge text cannot be empty")
        return await service.upsert_knowledge(
            title=payload.title,
            text=payload.text,
            source=payload.source,
            tags=payload.tags,
        )

    return router
