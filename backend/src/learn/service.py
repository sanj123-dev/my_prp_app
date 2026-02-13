from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import re
import uuid

from fastapi import HTTPException

from .schemas import (
    ChallengeResponse,
    DailyDoseClaimResponse,
    DailyDoseResponse,
    LearnHomeResponse,
    LearnPathwayDetail,
    LearnPathwaySummary,
    LearnTool,
    Pitfall,
    PitfallListResponse,
    PitfallSaveResponse,
    QuizOption,
    WatchlistItem,
)


DEFAULT_PATHWAYS: List[Dict[str, Any]] = [
    {
        "slug": "budgeting-basics",
        "title": "Budgeting Basics",
        "icon": "wallet-outline",
        "summary": "Build a realistic plan you can stick with every week.",
        "steps": [
            "Track spending by need, want, and debt.",
            "Set a weekly spend cap for variable categories.",
            "Review every Sunday and adjust with one small improvement.",
        ],
        "estimated_minutes": 15,
    },
    {
        "slug": "investing-101",
        "title": "Investing 101",
        "icon": "trending-up-outline",
        "summary": "Understand risk, compounding, and long-term discipline.",
        "steps": [
            "Learn risk vs return with simple examples.",
            "Compare diversified funds vs single stock risk.",
            "Set a monthly auto-invest amount and hold long term.",
        ],
        "estimated_minutes": 24,
    },
    {
        "slug": "debt-management",
        "title": "Debt Management",
        "icon": "shield-checkmark-outline",
        "summary": "Pay down high-interest debt without burning out.",
        "steps": [
            "List balances and interest rates from highest to lowest.",
            "Choose avalanche or snowball method for your personality.",
            "Automate your minimum + one extra payment each cycle.",
        ],
        "estimated_minutes": 18,
    },
]

DEFAULT_DAILY_LESSON: Dict[str, Any] = {
    "id": "daily-diversify",
    "tag": "Today's Lesson",
    "title": "The #1 rule of investing: diversify risk.",
    "body": "Spread money across assets so one bad pick does not break your progress.",
    "steps": [
        "30-second concept card",
        "One quiz with instant feedback",
        "One action you can do today",
    ],
    "reward_xp": 20,
}

DEFAULT_CHALLENGE: Dict[str, Any] = {
    "id": "challenge-no-spend-weekend",
    "title": "No-Spend Weekend",
    "description": "Log one tap per day. Build a streak with tiny wins.",
    "days": ["Fri", "Sat", "Sun", "Mon"],
    "active": True,
}

DEFAULT_GLOSSARY: List[Dict[str, str]] = [
    {
        "id": "compound-interest",
        "term": "Compound Interest",
        "meaning": "Interest earned on both principal and past interest.",
    },
    {
        "id": "etf",
        "term": "ETF",
        "meaning": "A basket of assets traded on stock exchanges like a stock.",
    },
    {
        "id": "bull-market",
        "term": "Bull Market",
        "meaning": "A period when prices trend upward and optimism is high.",
    },
    {
        "id": "diversification",
        "term": "Diversification",
        "meaning": "Spreading investments to lower overall risk.",
    },
    {
        "id": "liquidity",
        "term": "Liquidity",
        "meaning": "How quickly an asset can be sold without large price impact.",
    },
]

DEFAULT_WATCHLIST_ITEMS: List[Dict[str, str]] = [
    {"symbol": "AAPL", "note": "Linked to valuation lesson"},
    {"symbol": "MSFT", "note": "Watch earnings growth trend"},
    {"symbol": "NVDA", "note": "High volatility example"},
    {"symbol": "TSLA", "note": "Behavioral finance case"},
]

DEFAULT_PITFALLS: List[Dict[str, str]] = [
    {
        "id": "fomo-buying",
        "title": "FOMO Buying",
        "detail": "Buying because everyone else is excited, not because of your plan.",
        "habit": "Pause for 24 hours before entering a new position.",
    },
    {
        "id": "panic-selling",
        "title": "Panic Selling",
        "detail": "Selling during short-term drops and locking in losses.",
        "habit": "Review your time horizon before every sell decision.",
    },
    {
        "id": "ignoring-fees",
        "title": "Ignoring Fees",
        "detail": "Small fees compound and quietly reduce long-term returns.",
        "habit": "Check expense ratio and broker fee before investing.",
    },
]

DEFAULT_TOOLS: List[LearnTool] = [
    LearnTool(
        label="Simulator",
        icon="stats-chart-outline",
        route="/learn/simulator",
        blurb="Practice with virtual money before real decisions.",
    ),
    LearnTool(
        label="Glossary",
        icon="book-outline",
        route="/learn/glossary",
        blurb="Understand terms fast with plain language.",
    ),
    LearnTool(
        label="Watchlist",
        icon="eye-outline",
        route="/learn/watchlist",
        blurb="Follow assets and connect them to lessons.",
    ),
    LearnTool(
        label="Pitfalls",
        icon="warning-outline",
        route="/learn/pitfalls",
        blurb="Avoid common emotional money mistakes.",
    ),
]

DEFAULT_QUIZ_OPTIONS: List[QuizOption] = [
    QuizOption(id="o1", label="Always diversify your risk", correct=True),
    QuizOption(id="o2", label="Time the market every week", correct=False),
    QuizOption(id="o3", label="Follow hype before research", correct=False),
]


def _get_today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _time_left(estimated_minutes: int, progress: int) -> str:
    remaining = max(1, int(round(estimated_minutes * (100 - progress) / 100)))
    return f"{remaining} min left"


def _sanitize_symbol(symbol: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "", symbol.strip().upper())
    if len(cleaned) < 1:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    return cleaned[:15]


async def init_learn_module(db: Any) -> None:
    await _ensure_indexes(db)
    await _ensure_seed_data(db)


async def _ensure_indexes(db: Any) -> None:
    await db.learn_pathways.create_index([("slug", 1)], unique=True)
    await db.learn_daily_lessons.create_index([("id", 1)], unique=True)
    await db.learn_challenges.create_index([("id", 1)], unique=True)
    await db.learn_glossary_terms.create_index([("id", 1)], unique=True)
    await db.learn_pitfalls.create_index([("id", 1)], unique=True)

    await db.learn_user_pathway_progress.create_index(
        [("user_id", 1), ("pathway_slug", 1)], unique=True
    )
    await db.learn_user_daily_claims.create_index(
        [("user_id", 1), ("date_key", 1)], unique=True
    )
    await db.learn_user_challenge_progress.create_index(
        [("user_id", 1), ("challenge_id", 1)], unique=True
    )
    await db.learn_watchlist_items.create_index(
        [("user_id", 1), ("symbol", 1)], unique=True
    )
    await db.learn_user_saved_pitfalls.create_index(
        [("user_id", 1), ("pitfall_id", 1)], unique=True
    )


async def _ensure_seed_data(db: Any) -> None:
    now = datetime.utcnow()

    for pathway in DEFAULT_PATHWAYS:
        await db.learn_pathways.update_one(
            {"slug": pathway["slug"]},
            {"$setOnInsert": {**pathway, "created_at": now}},
            upsert=True,
        )

    lesson = {**DEFAULT_DAILY_LESSON, "date_key": _get_today_key()}
    await db.learn_daily_lessons.update_one(
        {"date_key": lesson["date_key"]},
        {"$setOnInsert": {**lesson, "created_at": now}},
        upsert=True,
    )

    await db.learn_challenges.update_one(
        {"id": DEFAULT_CHALLENGE["id"]},
        {"$setOnInsert": {**DEFAULT_CHALLENGE, "created_at": now}},
        upsert=True,
    )

    for term in DEFAULT_GLOSSARY:
        await db.learn_glossary_terms.update_one(
            {"id": term["id"]},
            {"$setOnInsert": {**term, "created_at": now}},
            upsert=True,
        )

    for pitfall in DEFAULT_PITFALLS:
        await db.learn_pitfalls.update_one(
            {"id": pitfall["id"]},
            {"$setOnInsert": {**pitfall, "created_at": now}},
            upsert=True,
        )


async def _get_user_name(db: Any, user_id: str) -> str:
    user = await db.users.find_one({"id": user_id})
    if not user:
        return "Alex"
    name = (user.get("name") or "Alex").strip()
    return name.split(" ")[0] if name else "Alex"


async def _pathway_progress_map(db: Any, user_id: str) -> Dict[str, int]:
    docs = await db.learn_user_pathway_progress.find({"user_id": user_id}).to_list(100)
    mapping: Dict[str, int] = {}
    for item in docs:
        slug = str(item.get("pathway_slug", ""))
        progress = int(item.get("progress", 0) or 0)
        mapping[slug] = max(0, min(100, progress))
    return mapping


def _build_pathway_summary(pathway: Dict[str, Any], progress: int) -> LearnPathwaySummary:
    estimated_minutes = int(pathway.get("estimated_minutes", 10) or 10)
    return LearnPathwaySummary(
        slug=pathway["slug"],
        title=pathway["title"],
        progress=progress,
        time_left=_time_left(estimated_minutes, progress),
        icon=pathway["icon"],
        summary=pathway["summary"],
    )


async def _get_active_challenge_doc(db: Any) -> Dict[str, Any]:
    challenge = await db.learn_challenges.find_one({"active": True})
    if challenge:
        return challenge

    fallback = await db.learn_challenges.find_one({"id": DEFAULT_CHALLENGE["id"]})
    if fallback:
        return fallback

    raise HTTPException(status_code=404, detail="Challenge not found")


async def get_home(db: Any, user_id: str) -> LearnHomeResponse:
    pathways = await db.learn_pathways.find({}).to_list(200)
    progress_map = await _pathway_progress_map(db, user_id)
    pathway_items = [
        _build_pathway_summary(pathway, progress_map.get(pathway["slug"], 0))
        for pathway in pathways
    ]

    challenge = await get_challenge(db, user_id)

    return LearnHomeResponse(
        user_name=await _get_user_name(db, user_id),
        mascot_progress=72,
        quiz_question="Quiz: What's the #1 rule of investing?",
        quiz_options=DEFAULT_QUIZ_OPTIONS,
        quiz_feedback_correct="Great job! Diversification helps reduce portfolio risk.",
        quiz_feedback_wrong="Good try. The best answer is to diversify your risk.",
        pathways=sorted(pathway_items, key=lambda item: item.title),
        challenge=challenge,
        tools=DEFAULT_TOOLS,
    )


async def list_pathways(db: Any, user_id: Optional[str]) -> List[LearnPathwaySummary]:
    pathways = await db.learn_pathways.find({}).to_list(200)
    progress_map = await _pathway_progress_map(db, user_id) if user_id else {}
    items = [
        _build_pathway_summary(pathway, progress_map.get(pathway["slug"], 0))
        for pathway in pathways
    ]
    return sorted(items, key=lambda item: item.title)


async def get_pathway_detail(db: Any, slug: str, user_id: str) -> LearnPathwayDetail:
    pathway = await db.learn_pathways.find_one({"slug": slug})
    if not pathway:
        raise HTTPException(status_code=404, detail="Pathway not found")

    progress_doc = await db.learn_user_pathway_progress.find_one(
        {"user_id": user_id, "pathway_slug": slug}
    )
    progress = int((progress_doc or {}).get("progress", 0))
    progress = max(0, min(100, progress))

    steps = [str(step) for step in pathway.get("steps", [])]
    total_steps = len(steps)
    completed_steps = int(round((progress / 100) * total_steps)) if total_steps else 0

    summary = _build_pathway_summary(pathway, progress)
    return LearnPathwayDetail(
        **summary.model_dump(),
        steps=steps,
        total_steps=total_steps,
        completed_steps=min(total_steps, completed_steps),
    )


async def update_pathway_progress(
    db: Any, user_id: str, slug: str, progress: int
) -> LearnPathwayDetail:
    pathway = await db.learn_pathways.find_one({"slug": slug})
    if not pathway:
        raise HTTPException(status_code=404, detail="Pathway not found")

    clamped = max(0, min(100, progress))
    await db.learn_user_pathway_progress.update_one(
        {"user_id": user_id, "pathway_slug": slug},
        {
            "$set": {
                "progress": clamped,
                "updated_at": datetime.utcnow(),
            },
            "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": datetime.utcnow()},
        },
        upsert=True,
    )
    return await get_pathway_detail(db, slug, user_id)


async def get_daily_dose(db: Any, user_id: str) -> DailyDoseResponse:
    date_key = _get_today_key()
    lesson = await db.learn_daily_lessons.find_one({"date_key": date_key})
    if not lesson:
        lesson = {**DEFAULT_DAILY_LESSON, "date_key": date_key}
        await db.learn_daily_lessons.insert_one({**lesson, "created_at": datetime.utcnow()})

    claim = await db.learn_user_daily_claims.find_one({"user_id": user_id, "date_key": date_key})
    streak_days = await db.learn_user_daily_claims.count_documents({"user_id": user_id})

    return DailyDoseResponse(
        id=lesson["id"],
        date_key=date_key,
        tag=lesson["tag"],
        title=lesson["title"],
        body=lesson["body"],
        steps=[str(step) for step in lesson.get("steps", [])],
        reward_xp=int(lesson.get("reward_xp", 20)),
        claimed=bool(claim),
        streak_days=int(streak_days),
    )


async def claim_daily_dose(db: Any, user_id: str) -> DailyDoseClaimResponse:
    dose = await get_daily_dose(db, user_id)
    if not dose.claimed:
        await db.learn_user_daily_claims.update_one(
            {"user_id": user_id, "date_key": dose.date_key},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "reward_xp": dose.reward_xp,
                    "created_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )
    updated = await get_daily_dose(db, user_id)
    return DailyDoseClaimResponse(
        claimed=updated.claimed,
        reward_xp=updated.reward_xp,
        streak_days=updated.streak_days,
    )


async def get_challenge(db: Any, user_id: str) -> ChallengeResponse:
    challenge = await _get_active_challenge_doc(db)
    days = [str(day) for day in challenge.get("days", [])]

    progress_doc = await db.learn_user_challenge_progress.find_one(
        {"user_id": user_id, "challenge_id": challenge["id"]}
    )
    completed_days = set((progress_doc or {}).get("completed_days", []))
    completed = [index in completed_days for index in range(len(days))]
    progress = int(round((sum(completed) / len(days)) * 100)) if days else 0

    return ChallengeResponse(
        id=challenge["id"],
        title=challenge["title"],
        description=challenge["description"],
        days=days,
        completed=completed,
        progress=progress,
    )


async def toggle_challenge_check_in(
    db: Any, user_id: str, day_index: int
) -> ChallengeResponse:
    challenge = await _get_active_challenge_doc(db)
    days = [str(day) for day in challenge.get("days", [])]
    if day_index < 0 or day_index >= len(days):
        raise HTTPException(status_code=400, detail="Invalid day index")

    progress_doc = await db.learn_user_challenge_progress.find_one(
        {"user_id": user_id, "challenge_id": challenge["id"]}
    )
    completed_days = set((progress_doc or {}).get("completed_days", []))

    if day_index in completed_days:
        completed_days.remove(day_index)
    else:
        completed_days.add(day_index)

    await db.learn_user_challenge_progress.update_one(
        {"user_id": user_id, "challenge_id": challenge["id"]},
        {
            "$set": {
                "completed_days": sorted(completed_days),
                "updated_at": datetime.utcnow(),
            },
            "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": datetime.utcnow()},
        },
        upsert=True,
    )
    return await get_challenge(db, user_id)


async def list_glossary_terms(db: Any, query: str, limit: int) -> List[Dict[str, Any]]:
    safe_limit = max(1, min(limit, 200))
    find_query: Dict[str, Any] = {}
    if query.strip():
        find_query["term"] = {"$regex": re.escape(query.strip()), "$options": "i"}
    terms = await db.learn_glossary_terms.find(find_query).limit(safe_limit).to_list(safe_limit)
    return terms


async def _ensure_default_watchlist(db: Any, user_id: str) -> None:
    existing = await db.learn_watchlist_items.count_documents({"user_id": user_id})
    if existing > 0:
        return
    now = datetime.utcnow()
    docs = []
    for item in DEFAULT_WATCHLIST_ITEMS:
        docs.append(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "symbol": item["symbol"],
                "note": item["note"],
                "followed": item["symbol"] in {"AAPL", "MSFT"},
                "created_at": now,
                "updated_at": now,
            }
        )
    if docs:
        await db.learn_watchlist_items.insert_many(docs)


async def get_watchlist(db: Any, user_id: str) -> List[WatchlistItem]:
    await _ensure_default_watchlist(db, user_id)
    docs = await db.learn_watchlist_items.find({"user_id": user_id}).to_list(200)
    docs.sort(key=lambda item: item.get("symbol", ""))
    return [WatchlistItem(**doc) for doc in docs]


async def create_watchlist_item(
    db: Any, user_id: str, symbol: str, note: str, followed: bool
) -> WatchlistItem:
    sanitized_symbol = _sanitize_symbol(symbol)
    now = datetime.utcnow()

    existing = await db.learn_watchlist_items.find_one(
        {"user_id": user_id, "symbol": sanitized_symbol}
    )
    if existing:
        await db.learn_watchlist_items.update_one(
            {"user_id": user_id, "symbol": sanitized_symbol},
            {
                "$set": {
                    "note": (note or "").strip(),
                    "followed": bool(followed),
                    "updated_at": now,
                }
            },
        )
    else:
        await db.learn_watchlist_items.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "symbol": sanitized_symbol,
                "note": (note or "").strip(),
                "followed": bool(followed),
                "created_at": now,
                "updated_at": now,
            }
        )

    item = await db.learn_watchlist_items.find_one({"user_id": user_id, "symbol": sanitized_symbol})
    if not item:
        raise HTTPException(status_code=500, detail="Unable to create watchlist item")
    return WatchlistItem(**item)


async def update_watchlist_item(
    db: Any,
    user_id: str,
    symbol: str,
    note: Optional[str],
    followed: Optional[bool],
) -> WatchlistItem:
    sanitized_symbol = _sanitize_symbol(symbol)
    update_fields: Dict[str, Any] = {"updated_at": datetime.utcnow()}
    if note is not None:
        update_fields["note"] = note.strip()
    if followed is not None:
        update_fields["followed"] = bool(followed)

    result = await db.learn_watchlist_items.update_one(
        {"user_id": user_id, "symbol": sanitized_symbol},
        {"$set": update_fields},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Watchlist item not found")

    item = await db.learn_watchlist_items.find_one(
        {"user_id": user_id, "symbol": sanitized_symbol}
    )
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    return WatchlistItem(**item)


async def get_pitfalls(db: Any, user_id: str) -> PitfallListResponse:
    pitfalls = await db.learn_pitfalls.find({}).to_list(200)
    saved = await db.learn_user_saved_pitfalls.find({"user_id": user_id}).to_list(500)
    saved_ids = {str(item.get("pitfall_id")) for item in saved}

    items = [
        Pitfall(
            id=str(p["id"]),
            title=str(p["title"]),
            detail=str(p["detail"]),
            habit=str(p["habit"]),
            saved=str(p["id"]) in saved_ids,
        )
        for p in pitfalls
    ]
    items.sort(key=lambda item: item.title)
    return PitfallListResponse(saved_count=len(saved_ids), items=items)


async def save_pitfall(
    db: Any, user_id: str, pitfall_id: str, saved: bool = True
) -> PitfallSaveResponse:
    pitfall = await db.learn_pitfalls.find_one({"id": pitfall_id})
    if not pitfall:
        raise HTTPException(status_code=404, detail="Pitfall not found")

    if saved:
        await db.learn_user_saved_pitfalls.update_one(
            {"user_id": user_id, "pitfall_id": pitfall_id},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "created_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )
    else:
        await db.learn_user_saved_pitfalls.delete_one(
            {"user_id": user_id, "pitfall_id": pitfall_id}
        )

    saved_count = await db.learn_user_saved_pitfalls.count_documents({"user_id": user_id})
    return PitfallSaveResponse(saved=bool(saved), saved_count=int(saved_count))
