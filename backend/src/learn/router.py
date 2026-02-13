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
    MissionClaimResponse,
    PitfallListResponse,
    PitfallSaveResponse,
    QuizAnswerRequest,
    QuizAnswerResponse,
    SimulationAvatarSelectRequest,
    SimulationFeedPost,
    SimulationFeedShareRequest,
    SimulationHomeResponse,
    SimulationPlayerStanding,
    SimulationPortfolioSnapshot,
    SimulationRoom,
    SimulationRoomJoinRequest,
    SimulationTradeRequest,
    SimulationTrade,
    WatchlistCreateRequest,
    WatchlistItem,
    WatchlistUpdateRequest,
)
from .service import (
    claim_daily_mission,
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
    submit_quiz_answer,
    toggle_challenge_check_in,
    update_pathway_progress,
    update_watchlist_item,
    choose_simulation_avatar,
    execute_simulation_trade,
    get_simulation_feed,
    get_simulation_home,
    get_simulation_leaderboard,
    get_simulation_portfolio,
    join_simulation_room,
    share_simulation_update,
)


def create_learn_router(db_provider) -> APIRouter:
    learn_router = APIRouter(prefix="/learn", tags=["learn"])

    def get_db():
        return db_provider()

    @learn_router.get("/home/{user_id}", response_model=LearnHomeResponse)
    async def get_learn_home(user_id: str, db=Depends(get_db)):
        return await get_home(db, user_id)

    @learn_router.post("/game/{user_id}/quiz-answer", response_model=QuizAnswerResponse)
    async def post_quiz_answer(user_id: str, payload: QuizAnswerRequest, db=Depends(get_db)):
        return await submit_quiz_answer(db, user_id, payload.option_id)

    @learn_router.post("/game/{user_id}/missions/{mission_id}/claim", response_model=MissionClaimResponse)
    async def post_claim_mission(user_id: str, mission_id: str, db=Depends(get_db)):
        return await claim_daily_mission(db, user_id, mission_id)

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

    @learn_router.get("/simulation/{user_id}/home", response_model=SimulationHomeResponse)
    async def get_user_simulation_home(user_id: str, db=Depends(get_db)):
        return await get_simulation_home(db, user_id)

    @learn_router.put("/simulation/{user_id}/avatar", response_model=SimulationHomeResponse)
    async def put_simulation_avatar(
        user_id: str, payload: SimulationAvatarSelectRequest, db=Depends(get_db)
    ):
        return await choose_simulation_avatar(db, user_id, payload.avatar_id)

    @learn_router.post("/simulation/{user_id}/rooms", response_model=SimulationRoom)
    async def post_simulation_room(
        user_id: str, payload: SimulationRoomJoinRequest, db=Depends(get_db)
    ):
        return await join_simulation_room(
            db,
            user_id=user_id,
            room_code=payload.room_code,
            room_name=payload.room_name,
            is_public=payload.is_public,
        )

    @learn_router.post("/simulation/{user_id}/trade", response_model=SimulationTrade)
    async def post_simulation_trade(
        user_id: str, payload: SimulationTradeRequest, db=Depends(get_db)
    ):
        return await execute_simulation_trade(
            db,
            user_id=user_id,
            symbol=payload.symbol,
            side=payload.side,
            quantity=payload.quantity,
        )

    @learn_router.get("/simulation/{user_id}/portfolio", response_model=SimulationPortfolioSnapshot)
    async def get_user_simulation_portfolio(user_id: str, db=Depends(get_db)):
        return await get_simulation_portfolio(db, user_id)

    @learn_router.get("/simulation/{user_id}/leaderboard", response_model=List[SimulationPlayerStanding])
    async def get_user_simulation_leaderboard(user_id: str, db=Depends(get_db)):
        return await get_simulation_leaderboard(db, user_id)

    @learn_router.post("/simulation/{user_id}/share", response_model=SimulationFeedPost)
    async def post_simulation_share(
        user_id: str, payload: SimulationFeedShareRequest, db=Depends(get_db)
    ):
        return await share_simulation_update(db, user_id, payload.message)

    @learn_router.get("/simulation/{user_id}/feed", response_model=List[SimulationFeedPost])
    async def get_user_simulation_feed(user_id: str, limit: int = Query(20, ge=1, le=100), db=Depends(get_db)):
        return await get_simulation_feed(db, user_id, limit)

    return learn_router


learn_router = create_learn_router
