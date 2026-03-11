from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query

from .schemas import (
    GoalPlan,
    GoalPlannerAnswerRequest,
    GoalPlannerProgress,
    GoalPlannerStartRequest,
    GoalPlannerV2Plan,
    GoalPlannerV2Progress,
    GoalPlannerV2StartRequest,
    GoalPlannerV2TurnRequest,
)
from .service import GoalPlannerService
from .service_v2 import GoalPlannerV2Service


def create_goal_router(db_provider) -> APIRouter:
    router = APIRouter(prefix="/goals", tags=["goals"])
    cache: Dict[str, Any] = {}

    def get_db():
        return db_provider()

    def get_service(db=Depends(get_db)) -> GoalPlannerService:
        key = "goal_planner_service"
        if key not in cache:
            cache[key] = GoalPlannerService(db)
        return cache[key]

    def get_service_v2(db=Depends(get_db)) -> GoalPlannerV2Service:
        key = "goal_planner_service_v2"
        if key not in cache:
            cache[key] = GoalPlannerV2Service(db)
        return cache[key]

    @router.post("/planner/start", response_model=GoalPlannerProgress)
    async def start_goal_planner(payload: GoalPlannerStartRequest, service: GoalPlannerService = Depends(get_service)):
        return await service.start(user_id=payload.user_id, force_new=payload.force_new)

    @router.get("/planner/{session_id}", response_model=GoalPlannerProgress)
    async def get_goal_planner_progress(
        session_id: str,
        user_id: str = Query(..., min_length=1),
        service: GoalPlannerService = Depends(get_service),
    ):
        try:
            return await service.get_progress(user_id=user_id, session_id=session_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/planner/{session_id}/answer", response_model=GoalPlannerProgress)
    async def answer_goal_planner(
        session_id: str,
        payload: GoalPlannerAnswerRequest,
        user_id: str = Query(..., min_length=1),
        service: GoalPlannerService = Depends(get_service),
    ):
        try:
            return await service.answer(user_id=user_id, session_id=session_id, answer=payload.answer)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("", response_model=List[GoalPlan])
    async def get_user_goal_plans(
        user_id: str = Query(..., min_length=1),
        limit: int = Query(10, ge=1, le=50),
        service: GoalPlannerService = Depends(get_service),
    ):
        return await service.list_user_plans(user_id=user_id, limit=limit)

    @router.post("/v2/session/start", response_model=GoalPlannerV2Progress)
    async def start_goal_planner_v2(
        payload: GoalPlannerV2StartRequest,
        service: GoalPlannerV2Service = Depends(get_service_v2),
    ):
        return await service.start(user_id=payload.user_id, force_new=payload.force_new)

    @router.get("/v2/session/{session_id}", response_model=GoalPlannerV2Progress)
    async def get_goal_planner_progress_v2(
        session_id: str,
        user_id: str = Query(..., min_length=1),
        service: GoalPlannerV2Service = Depends(get_service_v2),
    ):
        try:
            return await service.get_progress(user_id=user_id, session_id=session_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/v2/session/{session_id}/turn", response_model=GoalPlannerV2Progress)
    async def goal_planner_turn_v2(
        session_id: str,
        payload: GoalPlannerV2TurnRequest,
        user_id: str = Query(..., min_length=1),
        service: GoalPlannerV2Service = Depends(get_service_v2),
    ):
        try:
            return await service.turn(user_id=user_id, session_id=session_id, message=payload.message)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/v2/plans", response_model=List[GoalPlannerV2Plan])
    async def get_user_goal_plans_v2(
        user_id: str = Query(..., min_length=1),
        limit: int = Query(10, ge=1, le=50),
        service: GoalPlannerV2Service = Depends(get_service_v2),
    ):
        return await service.list_user_plans(user_id=user_id, limit=limit)

    return router
