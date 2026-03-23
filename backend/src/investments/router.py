from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query

from .schemas import (
    InvestmentOverviewResponse,
    InvestmentQaRequest,
    InvestmentQaResponse,
    SearchResult,
)
from .service import InvestmentService


def create_investments_router(db_provider) -> APIRouter:
    router = APIRouter(prefix="/investments", tags=["investments"])
    cache: Dict[str, Any] = {}

    def get_db():
        return db_provider()

    def get_service(db=Depends(get_db)) -> InvestmentService:
        key = "investment_service"
        if key not in cache:
            cache[key] = InvestmentService(db)
        return cache[key]

    @router.get("/search", response_model=List[SearchResult])
    async def search_instruments(
        user_id: str = Query(..., min_length=1),
        q: str = Query(..., min_length=1),
        limit: int = Query(8, ge=1, le=20),
        service: InvestmentService = Depends(get_service),
    ):
        try:
            return await service.search_symbols(user_id=user_id, query=q, limit=limit)
        except ValueError as exc:
            raise HTTPException(status_code=429, detail=str(exc)) from exc

    @router.get("/overview", response_model=InvestmentOverviewResponse)
    async def investment_overview(
        user_id: str = Query(..., min_length=1),
        ticker_or_query: str = Query(..., min_length=1),
        period: str = Query("max"),
        service: InvestmentService = Depends(get_service),
    ):
        try:
            return await service.get_overview(user_id=user_id, ticker_or_query=ticker_or_query, period=period)
        except ValueError as exc:
            message = str(exc)
            status_code = 429 if "Too many requests" in message else 422
            raise HTTPException(status_code=status_code, detail=message) from exc

    @router.post("/qa", response_model=InvestmentQaResponse)
    async def investment_qa(
        payload: InvestmentQaRequest,
        service: InvestmentService = Depends(get_service),
    ):
        try:
            return await service.ask_question(
                user_id=payload.user_id,
                ticker=payload.ticker,
                question=payload.question,
                session_id=payload.session_id,
            )
        except ValueError as exc:
            message = str(exc)
            status_code = 429 if "Too many requests" in message else 422
            raise HTTPException(status_code=status_code, detail=message) from exc

    return router
