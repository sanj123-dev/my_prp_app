from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from .schemas import (
    ChallengeCheckInRequest,
    ChallengeResponse,
    DailyDoseClaimResponse,
    DailyDoseResponse,
    GlossaryTerm,
    LearnHomeResponse,
    LearnPathwayDetail,
    LearnPathwaySummary,
    PitfallListResponse,
    PitfallSaveResponse,
    WatchlistCreateRequest,
    WatchlistItem,
    WatchlistUpdateRequest,
)
from .service import (
    claim_daily_dose,
    create_watchlist_item,
    get_challenge,
    get_daily_dose,
    get_home,
    get_pathway_detail,
    get_pitfalls,
    get_watchlist,
    list_glossary_terms,
    list_pathways,
    save_pitfall,
    toggle_challenge_check_in,
    update_pathway_progress,
    update_watchlist_item,
)


def create_learn_router(db_provider) -> APIRouter:
    learn_router = APIRouter(prefix="/learn", tags=["learn"])

    def get_db():
        return db_provider()

    @learn_router.get("/home/{user_id}", response_model=LearnHomeResponse)
    async def get_learn_home(user_id: str, db=Depends(get_db)):
        return await get_home(db, user_id)

    @learn_router.get("/pathways", response_model=List[LearnPathwaySummary])
    async def get_pathways(user_id: Optional[str] = None, db=Depends(get_db)):
        return await list_pathways(db, user_id)

    @learn_router.get("/pathways/{slug}", response_model=LearnPathwayDetail)
    async def get_pathway(slug: str, user_id: str, db=Depends(get_db)):
        return await get_pathway_detail(db, slug, user_id)

    @learn_router.put("/pathways/{slug}/progress", response_model=LearnPathwayDetail)
    async def put_pathway_progress(
        slug: str,
        user_id: str,
        progress: int = Query(..., ge=0, le=100),
        db=Depends(get_db),
    ):
        return await update_pathway_progress(db, user_id, slug, progress)

    @learn_router.get("/daily-dose/{user_id}", response_model=DailyDoseResponse)
    async def get_user_daily_dose(user_id: str, db=Depends(get_db)):
        return await get_daily_dose(db, user_id)

    @learn_router.post("/daily-dose/{user_id}/claim", response_model=DailyDoseClaimResponse)
    async def post_daily_dose_claim(user_id: str, db=Depends(get_db)):
        return await claim_daily_dose(db, user_id)

    @learn_router.get("/challenge/{user_id}", response_model=ChallengeResponse)
    async def get_user_challenge(user_id: str, db=Depends(get_db)):
        return await get_challenge(db, user_id)

    @learn_router.put("/challenge/{user_id}/check-in", response_model=ChallengeResponse)
    async def put_challenge_check_in(
        user_id: str, payload: ChallengeCheckInRequest, db=Depends(get_db)
    ):
        return await toggle_challenge_check_in(db, user_id, payload.day_index)

    @learn_router.get("/glossary", response_model=List[GlossaryTerm])
    async def get_glossary(
        q: str = "",
        limit: int = Query(50, ge=1, le=200),
        db=Depends(get_db),
    ):
        terms = await list_glossary_terms(db, q, limit)
        return [GlossaryTerm(**term) for term in terms]

    @learn_router.get("/watchlist/{user_id}", response_model=List[WatchlistItem])
    async def get_user_watchlist(user_id: str, db=Depends(get_db)):
        return await get_watchlist(db, user_id)

    @learn_router.post("/watchlist/{user_id}", response_model=WatchlistItem)
    async def post_watchlist_item(
        user_id: str, payload: WatchlistCreateRequest, db=Depends(get_db)
    ):
        return await create_watchlist_item(
            db,
            user_id=user_id,
            symbol=payload.symbol,
            note=payload.note or "",
            followed=payload.followed,
        )

    @learn_router.put("/watchlist/{user_id}/{symbol}", response_model=WatchlistItem)
    async def put_watchlist_item(
        user_id: str, symbol: str, payload: WatchlistUpdateRequest, db=Depends(get_db)
    ):
        return await update_watchlist_item(
            db,
            user_id=user_id,
            symbol=symbol,
            note=payload.note,
            followed=payload.followed,
        )

    @learn_router.get("/pitfalls/{user_id}", response_model=PitfallListResponse)
    async def get_user_pitfalls(user_id: str, db=Depends(get_db)):
        return await get_pitfalls(db, user_id)

    @learn_router.post("/pitfalls/{user_id}/{pitfall_id}/save", response_model=PitfallSaveResponse)
    async def post_save_pitfall(
        user_id: str, pitfall_id: str, saved: bool = True, db=Depends(get_db)
    ):
        return await save_pitfall(db, user_id, pitfall_id, saved)

    return learn_router


learn_router = create_learn_router
