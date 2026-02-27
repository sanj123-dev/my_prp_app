from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query

from .schemas import GoalPlan, GoalPlannerAnswerRequest, GoalPlannerProgress, GoalPlannerStartRequest
from .service import GoalPlannerService


def create_goal_router(db_provider) -> APIRouter:
    router = APIRouter(prefix="/goals", tags=["goals"])
    cache: Dict[str, GoalPlannerService] = {}

    def get_db():
        return db_provider()

    def get_service(db=Depends(get_db)) -> GoalPlannerService:
        key = "goal_planner_service"
        if key not in cache:
            cache[key] = GoalPlannerService(db)
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

    return router

