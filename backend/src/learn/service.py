from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from pathlib import Path
import json
import logging
import re
import uuid
import hashlib

from fastapi import HTTPException

from .schemas import (
    BossChallenge,
    ChallengeResponse,
    DailyDoseClaimResponse,
    DailyDoseResponse,
    DailyMission,
    GameContentCard,
    LeaderboardEntry,
    LearnHomeResponse,
    LearnPathwayDetail,
    LearnPathwaySummary,
    LearnTool,
    MissionClaimResponse,
    Pitfall,
    PitfallListResponse,
    PitfallSaveResponse,
    PlayerProfile,
    QuizAnswerResponse,
    QuizOption,
    SimulationAsset,
    SimulationAvatarOption,
    SimulationFeedPost,
    SimulationHomeResponse,
    SimulationPlayerStanding,
    SimulationPortfolioSnapshot,
    SimulationPosition,
    SimulationRoom,
    SimulationTrade,
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

MISSION_TEMPLATES: List[Dict[str, Any]] = [
    {
        "id": "daily-login",
        "title": "Daily Login",
        "description": "Open Learn today",
        "target": 1,
        "reward_xp": 15,
        "reward_coins": 5,
    },
    {
        "id": "quiz-master",
        "title": "Quiz Master",
        "description": "Answer today quiz correctly",
        "target": 1,
        "reward_xp": 30,
        "reward_coins": 10,
    },
    {
        "id": "lesson-finisher",
        "title": "Lesson Finisher",
        "description": "Claim today's lesson reward",
        "target": 1,
        "reward_xp": 20,
        "reward_coins": 8,
    },
    {
        "id": "campaign-step",
        "title": "Campaign Step",
        "description": "Advance any campaign progress once",
        "target": 1,
        "reward_xp": 16,
        "reward_coins": 6,
    },
    {
        "id": "mindset-guardian",
        "title": "Mindset Guardian",
        "description": "Save one pitfall habit and lock it in",
        "target": 1,
        "reward_xp": 14,
        "reward_coins": 5,
    },
    {
        "id": "streak-keeper",
        "title": "Streak Keeper",
        "description": "Complete any two quests today",
        "target": 2,
        "reward_xp": 22,
        "reward_coins": 9,
    },
]

DEFAULT_NPC_PLAYERS: List[Dict[str, Any]] = [
    {"id": "npc-finance-arya", "name": "Arya", "email": "arya+learnbot@spendwise.ai", "xp": 460, "coins": 122},
    {"id": "npc-finance-kabir", "name": "Kabir", "email": "kabir+learnbot@spendwise.ai", "xp": 390, "coins": 101},
    {"id": "npc-finance-meera", "name": "Meera", "email": "meera+learnbot@spendwise.ai", "xp": 320, "coins": 88},
]

DEFAULT_CONTENT_CARDS: List[Dict[str, Any]] = [
    {
        "id": "card-50-30-20",
        "title": "Budget Arena: 50/30/20",
        "hook": "Your salary is your character stamina.",
        "lesson": "Split income into needs, wants, and savings so you keep progressing each month.",
        "action": "Move one recurring expense from 'want' to 'need' or cancel it.",
        "difficulty": "easy",
        "reward_xp": 18,
    },
    {
        "id": "card-emergency-fund",
        "title": "Shield Unlock: Emergency Fund",
        "hook": "No shield means one hit can end the run.",
        "lesson": "Build 3-6 months of expenses to handle shocks without debt.",
        "action": "Auto-transfer even a small amount every payday.",
        "difficulty": "medium",
        "reward_xp": 22,
    },
    {
        "id": "card-compounding",
        "title": "Compounding Forge",
        "hook": "Time is your strongest weapon.",
        "lesson": "Start investing early; consistency beats timing the market.",
        "action": "Set a recurring monthly SIP/invest transfer.",
        "difficulty": "hard",
        "reward_xp": 25,
    },
]

ROOT_DIR = Path(__file__).resolve().parents[2]
QUIZ_BANK_DOCS_FILE = ROOT_DIR / "docs" / "learn_quiz_bank.json"

DEFAULT_BOSS_CHALLENGES: List[Dict[str, Any]] = [
    {
        "id": "boss-weekly-no-impulse",
        "title": "Weekly Boss: No Impulse Buys",
        "description": "Defeat the impulse boss by logging 5 no-buy decisions this week.",
        "target": 5,
        "reward_xp": 80,
        "reward_coins": 30,
        "active": True,
    }
]

SIM_STARTING_CASH = 100000.0
SIM_TRADING_FEE_RATE = 0.001
SIM_MAX_LEADERBOARD = 25

SIM_DEFAULT_AVATARS: List[Dict[str, str]] = [
    {"id": "quant-wolf", "name": "Quant Wolf", "title": "Data Hunter", "emoji": "WOLF", "style": "balanced"},
    {"id": "value-owl", "name": "Value Owl", "title": "Long-Term Scout", "emoji": "OWL", "style": "value"},
    {"id": "macro-hawk", "name": "Macro Hawk", "title": "Trend Rider", "emoji": "HAWK", "style": "momentum"},
    {"id": "index-tiger", "name": "Index Tiger", "title": "Steady Builder", "emoji": "TIGER", "style": "index"},
]

SIM_DEFAULT_ASSETS: List[Dict[str, Any]] = [
    {"symbol": "AAPL", "name": "Apple Inc", "category": "stock", "base_price": 182.0},
    {"symbol": "MSFT", "name": "Microsoft Corp", "category": "stock", "base_price": 410.0},
    {"symbol": "NVDA", "name": "NVIDIA Corp", "category": "stock", "base_price": 745.0},
    {"symbol": "SPY", "name": "SPDR S&P 500 ETF", "category": "etf", "base_price": 505.0},
    {"symbol": "QQQ", "name": "Invesco QQQ ETF", "category": "etf", "base_price": 432.0},
    {"symbol": "GLD", "name": "SPDR Gold Shares", "category": "commodity", "base_price": 191.0},
    {"symbol": "USO", "name": "United States Oil Fund", "category": "commodity", "base_price": 78.0},
    {"symbol": "BTCUSD", "name": "Bitcoin", "category": "crypto", "base_price": 47000.0},
]

SIM_DEFAULT_ROOM_CODE = "GLOBAL1"
SIM_DEFAULT_ROOM_NAME = "Global Arena"


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


def _xp_model(total_xp: int) -> tuple[int, int, int]:
    level_size = 100
    level = max(1, (total_xp // level_size) + 1)
    xp_in_level = total_xp % level_size
    xp_to_next = level_size - xp_in_level
    return level, xp_in_level, xp_to_next


def _profile_view(doc: Dict[str, Any]) -> PlayerProfile:
    total_xp = int(doc.get("total_xp", 0) or 0)
    level, xp_in_level, xp_to_next = _xp_model(total_xp)
    return PlayerProfile(
        level=level,
        total_xp=total_xp,
        xp_in_level=xp_in_level,
        xp_to_next_level=xp_to_next,
        streak_days=int(doc.get("streak_days", 1) or 1),
        coins=int(doc.get("coins", 0) or 0),
        last_active_date=doc.get("last_active_date"),
    )


def _mission_view(doc: Dict[str, Any]) -> DailyMission:
    progress = int(doc.get("progress", 0) or 0)
    target = int(doc.get("target", 1) or 1)
    return DailyMission(
        id=str(doc["mission_id"]),
        title=str(doc.get("title", "")),
        description=str(doc.get("description", "")),
        target=target,
        progress=progress,
        reward_xp=int(doc.get("reward_xp", 0) or 0),
        reward_coins=int(doc.get("reward_coins", 0) or 0),
        completed=bool(doc.get("completed", progress >= target)),
        claimed=bool(doc.get("claimed", False)),
    )


def _day_seed(date_key: str) -> int:
    return sum(ord(ch) for ch in date_key if ch.isdigit())


def _build_quiz_options(quiz_doc: Dict[str, Any]) -> List[QuizOption]:
    quiz_id = str(quiz_doc.get("id", "quiz"))
    options = list(quiz_doc.get("options", []))
    correct_index = int(quiz_doc.get("correct_index", 0) or 0)
    built: List[QuizOption] = []
    for idx, label in enumerate(options):
        built.append(
            QuizOption(
                id=f"{quiz_id}:o{idx+1}",
                label=str(label),
                correct=idx == correct_index,
            )
        )
    return built


def _load_quiz_bank_from_docs() -> List[Dict[str, Any]]:
    try:
        raw = QUIZ_BANK_DOCS_FILE.read_text(encoding="utf-8")
        payload = json.loads(raw)
    except FileNotFoundError:
        logging.error("Quiz docs file not found: %s", QUIZ_BANK_DOCS_FILE)
        return []
    except Exception as error:
        logging.error("Unable to parse quiz docs file %s: %s", QUIZ_BANK_DOCS_FILE, error)
        return []

    if not isinstance(payload, list):
        logging.error("Quiz docs file must be a JSON array: %s", QUIZ_BANK_DOCS_FILE)
        return []

    cleaned: List[Dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        options = item.get("options", [])
        correct_index = int(item.get("correct_index", -1))
        if (
            not item.get("id")
            or not item.get("question")
            or not isinstance(options, list)
            or len(options) < 2
            or correct_index < 0
            or correct_index >= len(options)
        ):
            continue
        cleaned.append(
            {
                "id": str(item["id"]),
                "question": str(item["question"]),
                "options": [str(option) for option in options],
                "correct_index": correct_index,
            }
        )

    if not cleaned:
        logging.error("No valid quiz questions found in docs file: %s", QUIZ_BANK_DOCS_FILE)
    return cleaned


async def init_learn_module(db: Any) -> None:
    await _ensure_indexes(db)
    await _ensure_seed_data(db)


async def _ensure_indexes(db: Any) -> None:
    await db.learn_pathways.create_index([("slug", 1)], unique=True)
    await db.learn_daily_lessons.create_index([("id", 1)], unique=True)
    await db.learn_challenges.create_index([("id", 1)], unique=True)
    await db.learn_content_cards.create_index([("id", 1)], unique=True)
    await db.learn_quiz_bank.create_index([("id", 1)], unique=True)
    await db.learn_boss_challenges.create_index([("id", 1)], unique=True)
    await db.learn_mission_templates.create_index([("id", 1)], unique=True)
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
    await db.learn_user_profiles.create_index([("user_id", 1)], unique=True)
    await db.learn_user_missions.create_index(
        [("user_id", 1), ("date_key", 1), ("mission_id", 1)], unique=True
    )
    await db.learn_user_quiz_attempts.create_index(
        [("user_id", 1), ("date_key", 1)], unique=True
    )
    await db.learn_sim_avatar_options.create_index([("id", 1)], unique=True)
    await db.learn_sim_assets.create_index([("symbol", 1)], unique=True)
    await db.learn_sim_rooms.create_index([("code", 1)], unique=True)
    await db.learn_sim_profiles.create_index([("user_id", 1)], unique=True)
    await db.learn_sim_portfolios.create_index([("user_id", 1)], unique=True)
    await db.learn_sim_positions.create_index([("user_id", 1), ("symbol", 1)], unique=True)
    await db.learn_sim_trades.create_index([("user_id", 1), ("executed_at", -1)])
    await db.learn_sim_room_members.create_index([("room_id", 1), ("user_id", 1)], unique=True)
    await db.learn_sim_feed.create_index([("room_code", 1), ("created_at", -1)])


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

    for card in DEFAULT_CONTENT_CARDS:
        await db.learn_content_cards.update_one(
            {"id": card["id"]},
            {"$setOnInsert": {**card, "created_at": now}},
            upsert=True,
        )

    quiz_seed_items = _load_quiz_bank_from_docs()
    for quiz in quiz_seed_items:
        await db.learn_quiz_bank.update_one(
            {"id": quiz["id"]},
            {"$setOnInsert": {**quiz, "created_at": now}},
            upsert=True,
        )

    for boss in DEFAULT_BOSS_CHALLENGES:
        await db.learn_boss_challenges.update_one(
            {"id": boss["id"]},
            {"$setOnInsert": {**boss, "created_at": now}},
            upsert=True,
        )

    for mission in MISSION_TEMPLATES:
        await db.learn_mission_templates.update_one(
            {"id": mission["id"]},
            {"$setOnInsert": {**mission, "active": True, "created_at": now}},
            upsert=True,
        )

    for npc in DEFAULT_NPC_PLAYERS:
        await db.users.update_one(
            {"id": npc["id"]},
            {
                "$setOnInsert": {
                    "id": npc["id"],
                    "name": npc["name"],
                    "email": npc["email"],
                    "phone": None,
                    "created_at": now,
                }
            },
            upsert=True,
        )
        await db.learn_user_profiles.update_one(
            {"user_id": npc["id"]},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "user_id": npc["id"],
                    "total_xp": npc["xp"],
                    "coins": npc["coins"],
                    "streak_days": 12,
                    "last_active_date": _get_today_key(),
                    "last_login_reward_date": _get_today_key(),
                    "created_at": now,
                    "updated_at": now,
                }
            },
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

    for avatar in SIM_DEFAULT_AVATARS:
        await db.learn_sim_avatar_options.update_one(
            {"id": avatar["id"]},
            {"$setOnInsert": {**avatar, "created_at": now}},
            upsert=True,
        )

    for asset in SIM_DEFAULT_ASSETS:
        await db.learn_sim_assets.update_one(
            {"symbol": asset["symbol"]},
            {
                "$setOnInsert": {
                    **asset,
                    "current_price": float(asset["base_price"]),
                    "day_open": float(asset["base_price"]),
                    "day_high": float(asset["base_price"]),
                    "day_low": float(asset["base_price"]),
                    "volume": 0.0,
                    "last_change_pct": 0.0,
                    "last_tick_at": datetime.utcnow(),
                    "created_at": now,
                }
            },
            upsert=True,
        )

    await db.learn_sim_rooms.update_one(
        {"code": SIM_DEFAULT_ROOM_CODE},
        {
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "code": SIM_DEFAULT_ROOM_CODE,
                "name": SIM_DEFAULT_ROOM_NAME,
                "created_by": "system",
                "is_public": True,
                "created_at": now,
            }
        },
        upsert=True,
    )


async def _get_user_name(db: Any, user_id: str) -> str:
    user = await db.users.find_one({"id": user_id})
    if not user:
        return "Alex"
    name = (user.get("name") or "Alex").strip()
    return name.split(" ")[0] if name else "Alex"


async def _get_or_create_profile(db: Any, user_id: str) -> Dict[str, Any]:
    profile = await db.learn_user_profiles.find_one({"user_id": user_id})
    if profile:
        return profile

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "total_xp": 0,
        "coins": 0,
        "streak_days": 1,
        "last_active_date": _get_today_key(),
        "last_login_reward_date": None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    await db.learn_user_profiles.insert_one(doc)
    return doc


async def _grant_profile_rewards(db: Any, user_id: str, xp: int, coins: int) -> PlayerProfile:
    await db.learn_user_profiles.update_one(
        {"user_id": user_id},
        {
            "$inc": {"total_xp": int(max(0, xp)), "coins": int(max(0, coins))},
            "$set": {"updated_at": datetime.utcnow()},
        },
        upsert=True,
    )
    profile = await _get_or_create_profile(db, user_id)
    return _profile_view(profile)


async def _touch_daily_streak(db: Any, user_id: str) -> tuple[PlayerProfile, bool]:
    profile = await _get_or_create_profile(db, user_id)
    today = _get_today_key()
    last_active = profile.get("last_active_date")
    streak_days = int(profile.get("streak_days", 1) or 1)
    login_reward_claimed = False

    if last_active != today:
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        streak_days = (streak_days + 1) if last_active == yesterday else 1
        await db.learn_user_profiles.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "streak_days": streak_days,
                    "last_active_date": today,
                    "updated_at": datetime.utcnow(),
                }
            },
        )

    current = await _get_or_create_profile(db, user_id)
    if current.get("last_login_reward_date") != today:
        await db.learn_user_profiles.update_one(
            {"user_id": user_id},
            {
                "$set": {"last_login_reward_date": today, "updated_at": datetime.utcnow()},
                "$inc": {"total_xp": 10, "coins": 3},
            },
        )
        login_reward_claimed = True

    latest = await _get_or_create_profile(db, user_id)
    return _profile_view(latest), login_reward_claimed


async def _ensure_daily_missions(db: Any, user_id: str, date_key: str) -> None:
    now = datetime.utcnow()
    templates = await db.learn_mission_templates.find({"active": True}).to_list(20)
    selected = templates if templates else MISSION_TEMPLATES

    # Keep quest board focused by selecting up to 5 rotating quests each day.
    if len(selected) > 5:
        core_ids = {"daily-login", "quiz-master", "lesson-finisher"}
        core = [item for item in selected if str(item.get("id")) in core_ids]
        pool = [item for item in selected if str(item.get("id")) not in core_ids]
        seed = _day_seed(date_key)
        for index in range(max(0, 5 - len(core))):
            if not pool:
                break
            core.append(pool[(seed + index) % len(pool)])
        selected = core[:5]

    for template in selected:
        mission_id = str(template.get("id", "mission"))
        await db.learn_user_missions.update_one(
            {"user_id": user_id, "date_key": date_key, "mission_id": mission_id},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "date_key": date_key,
                    "mission_id": mission_id,
                    "title": template["title"],
                    "description": template["description"],
                    "target": int(template.get("target", 1) or 1),
                    "progress": 0,
                    "reward_xp": int(template.get("reward_xp", 10) or 10),
                    "reward_coins": int(template.get("reward_coins", 3) or 3),
                    "completed": False,
                    "claimed": False,
                    "created_at": now,
                    "updated_at": now,
                }
            },
            upsert=True,
        )


async def _increment_mission_progress(
    db: Any, user_id: str, date_key: str, mission_id: str, increment: int
) -> None:
    mission = await db.learn_user_missions.find_one(
        {"user_id": user_id, "date_key": date_key, "mission_id": mission_id}
    )
    if not mission:
        return
    target = int(mission.get("target", 1) or 1)
    current = int(mission.get("progress", 0) or 0)
    next_progress = min(target, current + max(0, increment))
    await db.learn_user_missions.update_one(
        {"id": mission["id"]},
        {
            "$set": {
                "progress": next_progress,
                "completed": next_progress >= target,
                "updated_at": datetime.utcnow(),
            }
        },
    )


async def _refresh_streak_keeper(db: Any, user_id: str, date_key: str) -> None:
    missions = await db.learn_user_missions.find({"user_id": user_id, "date_key": date_key}).to_list(50)
    completed_count = sum(1 for item in missions if bool(item.get("completed")))
    keeper = next((item for item in missions if item.get("mission_id") == "streak-keeper"), None)
    if not keeper:
        return
    target = int(keeper.get("target", 2) or 2)
    progress = min(target, completed_count)
    await db.learn_user_missions.update_one(
        {"id": keeper["id"]},
        {
            "$set": {
                "progress": progress,
                "completed": progress >= target,
                "updated_at": datetime.utcnow(),
            }
        },
    )


async def _get_daily_missions(db: Any, user_id: str, date_key: str) -> List[DailyMission]:
    docs = await db.learn_user_missions.find({"user_id": user_id, "date_key": date_key}).to_list(20)
    docs.sort(key=lambda item: item.get("mission_id", ""))
    return [_mission_view(doc) for doc in docs]


async def _get_daily_content(db: Any, date_key: str) -> GameContentCard:
    cards = await db.learn_content_cards.find({}).to_list(100)
    if not cards:
        card = DEFAULT_CONTENT_CARDS[0]
    else:
        card = cards[_day_seed(date_key) % len(cards)]
    return GameContentCard(
        id=str(card["id"]),
        title=str(card["title"]),
        hook=str(card["hook"]),
        lesson=str(card["lesson"]),
        action=str(card["action"]),
        difficulty=str(card.get("difficulty", "easy")),
        reward_xp=int(card.get("reward_xp", 20)),
    )


async def _get_daily_quiz(db: Any, date_key: str) -> tuple[str, List[QuizOption]]:
    quizzes = await db.learn_quiz_bank.find({}).to_list(100)
    if not quizzes:
        return "Daily quiz is being prepared. Add quiz docs and restart backend.", []
    quiz = quizzes[_day_seed(date_key) % len(quizzes)]
    return str(quiz.get("question", "Daily quiz")), _build_quiz_options(quiz)


async def _get_boss_challenge(db: Any, user_id: str) -> BossChallenge:
    boss = await db.learn_boss_challenges.find_one({"active": True})
    if not boss:
        fallback = DEFAULT_BOSS_CHALLENGES[0]
        boss = fallback
    target = int(boss.get("target", 5) or 5)

    progress_doc = await db.learn_user_challenge_progress.find_one(
        {"user_id": user_id, "challenge_id": str(boss["id"])}
    )
    completed = set((progress_doc or {}).get("completed_days", []))
    progress = min(target, len(completed))
    return BossChallenge(
        id=str(boss["id"]),
        title=str(boss["title"]),
        description=str(boss["description"]),
        target=target,
        progress=progress,
        reward_xp=int(boss.get("reward_xp", 80) or 80),
        reward_coins=int(boss.get("reward_coins", 30) or 30),
    )


async def _advance_boss_progress(db: Any, user_id: str, action_key: str) -> None:
    boss = await db.learn_boss_challenges.find_one({"active": True})
    if not boss:
        return
    target = int(boss.get("target", 5) or 5)
    progress_doc = await db.learn_user_challenge_progress.find_one(
        {"user_id": user_id, "challenge_id": str(boss["id"])}
    )
    completed = set((progress_doc or {}).get("completed_days", []))
    token = f"{_get_today_key()}:{action_key}"
    if token in completed or len(completed) >= target:
        return
    completed.add(token)
    await db.learn_user_challenge_progress.update_one(
        {"user_id": user_id, "challenge_id": str(boss["id"])},
        {
            "$set": {
                "completed_days": sorted(completed),
                "updated_at": datetime.utcnow(),
            },
            "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": datetime.utcnow()},
        },
        upsert=True,
    )


async def _get_leaderboard(db: Any, current_user_id: str) -> List[LeaderboardEntry]:
    # Guarantee baseline players exist for a populated leaderboard experience.
    for npc in DEFAULT_NPC_PLAYERS:
        await db.learn_user_profiles.update_one(
            {"user_id": npc["id"]},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "user_id": npc["id"],
                    "total_xp": npc["xp"],
                    "coins": npc["coins"],
                    "streak_days": 10,
                    "last_active_date": _get_today_key(),
                    "last_login_reward_date": _get_today_key(),
                    "created_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )

    profiles = await db.learn_user_profiles.find({}).sort("total_xp", -1).limit(5).to_list(5)
    leaderboard: List[LeaderboardEntry] = []
    has_current_user = False
    for index, profile in enumerate(profiles):
        if profile.get("user_id") == current_user_id:
            has_current_user = True
        user = await db.users.find_one({"id": profile.get("user_id")})
        user_name = "Player"
        if user and (user.get("name") or "").strip():
            user_name = user["name"].strip().split(" ")[0]
        elif profile.get("user_id") == current_user_id:
            user_name = "You"

        level, _, _ = _xp_model(int(profile.get("total_xp", 0) or 0))
        leaderboard.append(
            LeaderboardEntry(
                rank=index + 1,
                user_name=user_name,
                level=level,
                total_xp=int(profile.get("total_xp", 0) or 0),
            )
        )

    if not has_current_user:
        current_profile = await db.learn_user_profiles.find_one({"user_id": current_user_id})
        if current_profile:
            user = await db.users.find_one({"id": current_user_id})
            display_name = "You"
            if user and (user.get("name") or "").strip():
                display_name = f"You ({user['name'].strip().split(' ')[0]})"
            level, _, _ = _xp_model(int(current_profile.get("total_xp", 0) or 0))
            leaderboard.append(
                LeaderboardEntry(
                    rank=len(leaderboard) + 1,
                    user_name=display_name,
                    level=level,
                    total_xp=int(current_profile.get("total_xp", 0) or 0),
                )
            )
    return leaderboard


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
    profile, login_reward_claimed = await _touch_daily_streak(db, user_id)
    today = _get_today_key()
    await _ensure_daily_missions(db, user_id, today)
    await _increment_mission_progress(db, user_id, today, "daily-login", 1)
    await _refresh_streak_keeper(db, user_id, today)
    missions = await _get_daily_missions(db, user_id, today)
    quiz_question, quiz_options = await _get_daily_quiz(db, today)
    today_content = await _get_daily_content(db, today)
    boss_challenge = await _get_boss_challenge(db, user_id)
    leaderboard = await _get_leaderboard(db, user_id)

    return LearnHomeResponse(
        user_name=await _get_user_name(db, user_id),
        mascot_progress=min(100, 40 + (profile.level * 8)),
        quiz_question=quiz_question,
        quiz_options=quiz_options,
        quiz_feedback_correct="Correct! Diversification cuts concentration risk.",
        quiz_feedback_wrong="Not quite. Diversification is the core investing rule.",
        player_profile=profile,
        daily_missions=missions,
        daily_login_reward_claimed=login_reward_claimed,
        today_content=today_content,
        boss_challenge=boss_challenge,
        leaderboard=leaderboard,
        pathways=sorted(pathway_items, key=lambda item: item.title),
        challenge=challenge,
        tools=DEFAULT_TOOLS,
    )


async def submit_quiz_answer(db: Any, user_id: str, option_id: str) -> QuizAnswerResponse:
    today = _get_today_key()
    await _ensure_daily_missions(db, user_id, today)
    await _get_or_create_profile(db, user_id)
    _, quiz_options = await _get_daily_quiz(db, today)

    selected = next((option for option in quiz_options if option.id == option_id), None)
    if not selected:
        raise HTTPException(status_code=400, detail="Invalid quiz option")

    existing_attempt = await db.learn_user_quiz_attempts.find_one(
        {"user_id": user_id, "date_key": today}
    )
    first_attempt = existing_attempt is None
    if first_attempt:
        await db.learn_user_quiz_attempts.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "date_key": today,
                "selected_option_id": option_id,
                "correct": selected.correct,
                "created_at": datetime.utcnow(),
            }
        )

    if selected.correct:
        await _increment_mission_progress(db, user_id, today, "quiz-master", 1)
        await _refresh_streak_keeper(db, user_id, today)
        await _advance_boss_progress(db, user_id, "quiz")
        reward_xp = 12 if first_attempt else 2
        reward_coins = 4 if first_attempt else 1
        feedback = "Nice! You won this quiz round."
    else:
        reward_xp = 2 if first_attempt else 1
        reward_coins = 0
        feedback = "Close one. Learn card first, then retry tomorrow."

    profile = await _grant_profile_rewards(db, user_id, reward_xp, reward_coins)
    missions = await _get_daily_missions(db, user_id, today)

    return QuizAnswerResponse(
        correct=selected.correct,
        feedback=feedback,
        reward_xp=reward_xp,
        reward_coins=reward_coins,
        profile=profile,
        daily_missions=missions,
    )


async def claim_daily_mission(db: Any, user_id: str, mission_id: str) -> MissionClaimResponse:
    today = _get_today_key()
    await _ensure_daily_missions(db, user_id, today)
    mission_doc = await db.learn_user_missions.find_one(
        {"user_id": user_id, "date_key": today, "mission_id": mission_id}
    )
    if not mission_doc:
        raise HTTPException(status_code=404, detail="Mission not found")

    mission = _mission_view(mission_doc)
    if not mission.completed:
        raise HTTPException(status_code=400, detail="Mission not completed yet")

    if not mission.claimed:
        await db.learn_user_missions.update_one(
            {"id": mission_doc["id"]},
            {"$set": {"claimed": True, "updated_at": datetime.utcnow()}},
        )
        profile = await _grant_profile_rewards(db, user_id, mission.reward_xp, mission.reward_coins)
        await _advance_boss_progress(db, user_id, f"mission-{mission.id}")
        await _refresh_streak_keeper(db, user_id, today)
    else:
        profile = _profile_view(await _get_or_create_profile(db, user_id))

    updated_doc = await db.learn_user_missions.find_one(
        {"user_id": user_id, "date_key": today, "mission_id": mission_id}
    )
    if not updated_doc:
        raise HTTPException(status_code=404, detail="Mission not found")
    return MissionClaimResponse(mission=_mission_view(updated_doc), profile=profile)


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
    today = _get_today_key()
    await _ensure_daily_missions(db, user_id, today)
    await _increment_mission_progress(db, user_id, today, "campaign-step", 1)
    await _refresh_streak_keeper(db, user_id, today)
    await _grant_profile_rewards(db, user_id, xp=5, coins=1)
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
    today = _get_today_key()
    await _ensure_daily_missions(db, user_id, today)
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
        await _grant_profile_rewards(db, user_id, xp=dose.reward_xp, coins=6)
        await _increment_mission_progress(db, user_id, today, "lesson-finisher", 1)
        await _refresh_streak_keeper(db, user_id, today)
        await _advance_boss_progress(db, user_id, "lesson")
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
    await _grant_profile_rewards(db, user_id, xp=4, coins=2)
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
        today = _get_today_key()
        await _ensure_daily_missions(db, user_id, today)
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
        await _increment_mission_progress(db, user_id, today, "mindset-guardian", 1)
        await _refresh_streak_keeper(db, user_id, today)
        await _grant_profile_rewards(db, user_id, xp=3, coins=1)
    else:
        await db.learn_user_saved_pitfalls.delete_one(
            {"user_id": user_id, "pitfall_id": pitfall_id}
        )

    saved_count = await db.learn_user_saved_pitfalls.count_documents({"user_id": user_id})
    return PitfallSaveResponse(saved=bool(saved), saved_count=int(saved_count))


def _sim_round(value: float) -> float:
    return round(float(value), 4)


def _sim_symbol(symbol: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "", (symbol or "").upper().strip())
    if not cleaned:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    return cleaned[:20]


def _sim_side(side: str) -> str:
    normalized = (side or "").strip().lower()
    if normalized not in {"buy", "sell"}:
        raise HTTPException(status_code=400, detail="side must be buy or sell")
    return normalized


def _sim_hash_value(seed_text: str) -> float:
    digest = hashlib.sha256(seed_text.encode("utf-8")).hexdigest()
    raw = int(digest[:8], 16)
    return (raw % 20001) / 10000.0 - 1.0


def _sim_volatility_for_category(category: str) -> float:
    mapping = {
        "stock": 0.006,
        "etf": 0.0022,
        "commodity": 0.0035,
        "crypto": 0.009,
    }
    return mapping.get((category or "").lower(), 0.004)


async def _sync_sim_market_prices(db: Any) -> None:
    assets = await db.learn_sim_assets.find({}).to_list(500)
    if not assets:
        return

    now = datetime.utcnow()
    minute_key = now.strftime("%Y%m%d%H%M")
    day_key = now.strftime("%Y-%m-%d")

    for asset in assets:
        last_tick_key = asset.get("last_tick_key")
        if last_tick_key == minute_key:
            continue

        symbol = str(asset.get("symbol", ""))
        category = str(asset.get("category", "stock"))
        volatility = _sim_volatility_for_category(category)
        wave = _sim_hash_value(f"{symbol}:{minute_key}")
        drift = wave * volatility

        current_price = float(asset.get("current_price", asset.get("base_price", 1.0)) or 1.0)
        next_price = max(0.2, current_price * (1.0 + drift))

        day_open = float(asset.get("day_open", next_price) or next_price)
        last_day_key = str(asset.get("day_key", day_key))
        if last_day_key != day_key:
            day_open = next_price
            day_high = next_price
            day_low = next_price
        else:
            day_high = max(float(asset.get("day_high", next_price) or next_price), next_price)
            day_low = min(float(asset.get("day_low", next_price) or next_price), next_price)

        day_change_pct = ((next_price - day_open) / day_open) * 100 if day_open > 0 else 0.0
        volume = float(asset.get("volume", 0.0) or 0.0) + abs(wave) * 1200.0

        await db.learn_sim_assets.update_one(
            {"symbol": symbol},
            {
                "$set": {
                    "current_price": _sim_round(next_price),
                    "day_open": _sim_round(day_open),
                    "day_high": _sim_round(day_high),
                    "day_low": _sim_round(day_low),
                    "last_change_pct": _sim_round(day_change_pct),
                    "volume": _sim_round(volume),
                    "day_key": day_key,
                    "last_tick_key": minute_key,
                    "last_tick_at": now,
                }
            },
        )


async def _get_sim_avatar_options(db: Any) -> List[SimulationAvatarOption]:
    avatars = await db.learn_sim_avatar_options.find({}).to_list(200)
    avatars.sort(key=lambda item: str(item.get("name", "")))
    return [
        SimulationAvatarOption(
            id=str(item["id"]),
            name=str(item.get("name", "Avatar")),
            title=str(item.get("title", "")),
            emoji=str(item.get("emoji", "")),
            style=str(item.get("style", "balanced")),
        )
        for item in avatars
    ]


async def _get_or_create_sim_profile(db: Any, user_id: str) -> Dict[str, Any]:
    profile = await db.learn_sim_profiles.find_one({"user_id": user_id})
    if profile:
        return profile

    default_avatar = SIM_DEFAULT_AVATARS[0]["id"]
    now = datetime.utcnow()
    profile = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "avatar_id": default_avatar,
        "active_room_code": SIM_DEFAULT_ROOM_CODE,
        "created_at": now,
        "updated_at": now,
    }
    await db.learn_sim_profiles.insert_one(profile)
    return profile


async def _get_or_create_sim_portfolio(db: Any, user_id: str) -> Dict[str, Any]:
    portfolio = await db.learn_sim_portfolios.find_one({"user_id": user_id})
    if portfolio:
        return portfolio
    now = datetime.utcnow()
    portfolio = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "starting_cash": SIM_STARTING_CASH,
        "cash_balance": SIM_STARTING_CASH,
        "realized_pnl": 0.0,
        "created_at": now,
        "updated_at": now,
    }
    await db.learn_sim_portfolios.insert_one(portfolio)
    return portfolio


async def _get_sim_room_by_code(db: Any, room_code: str) -> Optional[Dict[str, Any]]:
    return await db.learn_sim_rooms.find_one({"code": room_code})


async def _ensure_sim_room_membership(db: Any, user_id: str, room_code: str) -> Dict[str, Any]:
    room = await _get_sim_room_by_code(db, room_code)
    if not room:
        raise HTTPException(status_code=404, detail="Simulation room not found")

    now = datetime.utcnow()
    await db.learn_sim_room_members.update_one(
        {"room_id": room["id"], "user_id": user_id},
        {
            "$set": {"last_active_at": now},
            "$setOnInsert": {"id": str(uuid.uuid4()), "joined_at": now},
        },
        upsert=True,
    )
    return room


def _sim_room_code(raw_name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9]", "", (raw_name or "").upper().strip())
    if len(base) >= 6:
        return base[:6]
    suffix = uuid.uuid4().hex[: max(1, 6 - len(base))].upper()
    return f"{base}{suffix}"[:6]


def _sim_normalize_room_code(room_code: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", (room_code or "").upper().strip())
    if not cleaned:
        raise HTTPException(status_code=400, detail="Invalid room code")
    return cleaned[:10]


async def _sim_room_view(db: Any, room_doc: Dict[str, Any]) -> SimulationRoom:
    member_count = await db.learn_sim_room_members.count_documents({"room_id": room_doc["id"]})
    return SimulationRoom(
        id=str(room_doc["id"]),
        code=str(room_doc["code"]),
        name=str(room_doc["name"]),
        member_count=int(member_count),
        is_public=bool(room_doc.get("is_public", True)),
        created_by=str(room_doc.get("created_by", "system")),
    )


def _sim_asset_view(asset_doc: Dict[str, Any]) -> SimulationAsset:
    price = float(asset_doc.get("current_price", asset_doc.get("base_price", 0.0)) or 0.0)
    return SimulationAsset(
        symbol=str(asset_doc.get("symbol", "")),
        name=str(asset_doc.get("name", "")),
        category=str(asset_doc.get("category", "stock")),
        current_price=_sim_round(price),
        price_change_pct=_sim_round(float(asset_doc.get("last_change_pct", 0.0) or 0.0)),
        day_high=_sim_round(float(asset_doc.get("day_high", price) or price)),
        day_low=_sim_round(float(asset_doc.get("day_low", price) or price)),
        volume=_sim_round(float(asset_doc.get("volume", 0.0) or 0.0)),
    )


async def _get_sim_assets_map(db: Any) -> Dict[str, Dict[str, Any]]:
    assets = await db.learn_sim_assets.find({}).to_list(500)
    return {str(item["symbol"]): item for item in assets}


async def _sim_user_name(db: Any, user_id: str) -> str:
    user = await db.users.find_one({"id": user_id})
    if not user:
        return "Player"
    name = str(user.get("name", "")).strip()
    return name if name else "Player"


async def _build_sim_portfolio_snapshot(
    db: Any, user_id: str, assets_map: Optional[Dict[str, Dict[str, Any]]] = None
) -> SimulationPortfolioSnapshot:
    portfolio = await _get_or_create_sim_portfolio(db, user_id)
    if assets_map is None:
        assets_map = await _get_sim_assets_map(db)

    position_docs = await db.learn_sim_positions.find({"user_id": user_id}).to_list(500)
    positions: List[SimulationPosition] = []
    invested_value = 0.0
    unrealized_pnl = 0.0

    for doc in position_docs:
        symbol = str(doc.get("symbol", ""))
        qty = float(doc.get("quantity", 0.0) or 0.0)
        if qty <= 0:
            continue

        asset = assets_map.get(symbol)
        if not asset:
            continue

        avg_price = float(doc.get("average_buy_price", 0.0) or 0.0)
        current_price = float(asset.get("current_price", avg_price) or avg_price)
        market_value = qty * current_price
        pnl = (current_price - avg_price) * qty
        pnl_pct = ((current_price - avg_price) / avg_price) * 100 if avg_price > 0 else 0.0

        invested_value += market_value
        unrealized_pnl += pnl
        positions.append(
            SimulationPosition(
                symbol=symbol,
                name=str(asset.get("name", symbol)),
                category=str(asset.get("category", "stock")),
                quantity=_sim_round(qty),
                average_buy_price=_sim_round(avg_price),
                current_price=_sim_round(current_price),
                market_value=_sim_round(market_value),
                unrealized_pnl=_sim_round(pnl),
                unrealized_pnl_pct=_sim_round(pnl_pct),
            )
        )

    positions.sort(key=lambda item: item.market_value, reverse=True)
    cash_balance = float(portfolio.get("cash_balance", SIM_STARTING_CASH) or SIM_STARTING_CASH)
    starting_cash = float(portfolio.get("starting_cash", SIM_STARTING_CASH) or SIM_STARTING_CASH)
    realized_pnl = float(portfolio.get("realized_pnl", 0.0) or 0.0)
    total_equity = cash_balance + invested_value
    total_pnl = total_equity - starting_cash
    total_pnl_pct = (total_pnl / starting_cash) * 100 if starting_cash > 0 else 0.0

    trades = await db.learn_sim_trades.find({"user_id": user_id}).sort("executed_at", -1).limit(20).to_list(20)
    recent_trades = [
        SimulationTrade(
            id=str(item["id"]),
            user_id=str(item["user_id"]),
            symbol=str(item["symbol"]),
            side=str(item["side"]),
            quantity=_sim_round(float(item.get("quantity", 0.0) or 0.0)),
            price=_sim_round(float(item.get("price", 0.0) or 0.0)),
            notional=_sim_round(float(item.get("notional", 0.0) or 0.0)),
            fee=_sim_round(float(item.get("fee", 0.0) or 0.0)),
            executed_at=item.get("executed_at", datetime.utcnow()),
        )
        for item in trades
    ]

    return SimulationPortfolioSnapshot(
        starting_cash=_sim_round(starting_cash),
        cash_balance=_sim_round(cash_balance),
        invested_value=_sim_round(invested_value),
        total_equity=_sim_round(total_equity),
        realized_pnl=_sim_round(realized_pnl),
        unrealized_pnl=_sim_round(unrealized_pnl),
        total_pnl=_sim_round(total_pnl),
        total_pnl_pct=_sim_round(total_pnl_pct),
        positions=positions,
        recent_trades=recent_trades,
    )


async def _sim_active_room(db: Any, user_id: str) -> Dict[str, Any]:
    profile = await _get_or_create_sim_profile(db, user_id)
    room_code = str(profile.get("active_room_code", SIM_DEFAULT_ROOM_CODE))
    room = await _get_sim_room_by_code(db, room_code)
    if room:
        await _ensure_sim_room_membership(db, user_id, room_code)
        return room

    fallback = await _get_sim_room_by_code(db, SIM_DEFAULT_ROOM_CODE)
    if not fallback:
        raise HTTPException(status_code=500, detail="Simulation room is unavailable")

    await db.learn_sim_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"active_room_code": SIM_DEFAULT_ROOM_CODE, "updated_at": datetime.utcnow()}},
        upsert=True,
    )
    await _ensure_sim_room_membership(db, user_id, SIM_DEFAULT_ROOM_CODE)
    return fallback


async def get_simulation_portfolio(db: Any, user_id: str) -> SimulationPortfolioSnapshot:
    await _sync_sim_market_prices(db)
    await _sim_active_room(db, user_id)
    assets_map = await _get_sim_assets_map(db)
    return await _build_sim_portfolio_snapshot(db, user_id, assets_map)


async def get_simulation_leaderboard(db: Any, user_id: str) -> List[SimulationPlayerStanding]:
    await _sync_sim_market_prices(db)
    room = await _sim_active_room(db, user_id)
    assets_map = await _get_sim_assets_map(db)

    members = await db.learn_sim_room_members.find({"room_id": room["id"]}).to_list(1000)
    standings: List[SimulationPlayerStanding] = []
    for member in members:
        member_user_id = str(member.get("user_id"))
        member_profile = await _get_or_create_sim_profile(db, member_user_id)
        snapshot = await _build_sim_portfolio_snapshot(db, member_user_id, assets_map)
        standings.append(
            SimulationPlayerStanding(
                rank=0,
                user_id=member_user_id,
                user_name=await _sim_user_name(db, member_user_id),
                avatar_id=str(member_profile.get("avatar_id", SIM_DEFAULT_AVATARS[0]["id"])),
                total_equity=snapshot.total_equity,
                total_pnl_pct=snapshot.total_pnl_pct,
                cash_balance=snapshot.cash_balance,
            )
        )

    standings.sort(key=lambda item: item.total_equity, reverse=True)
    ranked: List[SimulationPlayerStanding] = []
    for idx, item in enumerate(standings[:SIM_MAX_LEADERBOARD]):
        ranked.append(
            SimulationPlayerStanding(
                rank=idx + 1,
                user_id=item.user_id,
                user_name=item.user_name,
                avatar_id=item.avatar_id,
                total_equity=item.total_equity,
                total_pnl_pct=item.total_pnl_pct,
                cash_balance=item.cash_balance,
            )
        )
    return ranked


async def get_simulation_feed(db: Any, user_id: str, limit: int = 20) -> List[SimulationFeedPost]:
    room = await _sim_active_room(db, user_id)
    safe_limit = max(1, min(limit, 100))
    docs = await db.learn_sim_feed.find({"room_code": room["code"]}).sort("created_at", -1).limit(safe_limit).to_list(safe_limit)

    feed: List[SimulationFeedPost] = []
    for doc in docs:
        feed.append(
            SimulationFeedPost(
                id=str(doc["id"]),
                user_id=str(doc["user_id"]),
                user_name=str(doc.get("user_name", "Player")),
                avatar_id=str(doc.get("avatar_id", SIM_DEFAULT_AVATARS[0]["id"])),
                room_code=str(doc.get("room_code", "")),
                message=str(doc.get("message", "")),
                total_equity=_sim_round(float(doc.get("total_equity", 0.0) or 0.0)),
                total_pnl_pct=_sim_round(float(doc.get("total_pnl_pct", 0.0) or 0.0)),
                created_at=doc.get("created_at", datetime.utcnow()),
            )
        )
    return feed


async def get_simulation_home(db: Any, user_id: str) -> SimulationHomeResponse:
    await _sync_sim_market_prices(db)
    profile = await _get_or_create_sim_profile(db, user_id)
    await _get_or_create_sim_portfolio(db, user_id)
    active_room_doc = await _sim_active_room(db, user_id)

    membership_docs = await db.learn_sim_room_members.find({"user_id": user_id}).to_list(200)
    room_ids = [doc.get("room_id") for doc in membership_docs]
    room_docs = await db.learn_sim_rooms.find({"id": {"$in": room_ids}}).to_list(200) if room_ids else []
    if not room_docs:
        room_docs = [active_room_doc]

    rooms: List[SimulationRoom] = []
    for room in room_docs:
        rooms.append(await _sim_room_view(db, room))
    rooms.sort(key=lambda item: item.member_count, reverse=True)

    assets = await db.learn_sim_assets.find({}).to_list(500)
    market = [_sim_asset_view(asset) for asset in assets]
    market.sort(key=lambda item: abs(item.price_change_pct), reverse=True)

    assets_map = await _get_sim_assets_map(db)
    portfolio = await _build_sim_portfolio_snapshot(db, user_id, assets_map)
    leaderboard = await get_simulation_leaderboard(db, user_id)
    feed = await get_simulation_feed(db, user_id, limit=12)

    return SimulationHomeResponse(
        user_id=user_id,
        active_avatar_id=str(profile.get("avatar_id", SIM_DEFAULT_AVATARS[0]["id"])),
        avatar_options=await _get_sim_avatar_options(db),
        active_room=await _sim_room_view(db, active_room_doc),
        rooms=rooms,
        market=market,
        portfolio=portfolio,
        leaderboard=leaderboard,
        feed=feed,
    )


async def choose_simulation_avatar(db: Any, user_id: str, avatar_id: str) -> SimulationHomeResponse:
    avatars = await _get_sim_avatar_options(db)
    avatar_ids = {item.id for item in avatars}
    if avatar_id not in avatar_ids:
        raise HTTPException(status_code=404, detail="Avatar not found")

    await _get_or_create_sim_profile(db, user_id)
    await db.learn_sim_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"avatar_id": avatar_id, "updated_at": datetime.utcnow()}},
        upsert=True,
    )
    return await get_simulation_home(db, user_id)


async def join_simulation_room(
    db: Any,
    user_id: str,
    room_code: Optional[str],
    room_name: Optional[str],
    is_public: bool = True,
) -> SimulationRoom:
    await _get_or_create_sim_profile(db, user_id)
    now = datetime.utcnow()
    final_room: Optional[Dict[str, Any]] = None

    if room_code:
        normalized_code = _sim_normalize_room_code(room_code)
        final_room = await _get_sim_room_by_code(db, normalized_code)
        if not final_room:
            raise HTTPException(status_code=404, detail="Room code not found")
    else:
        room_name_clean = (room_name or "").strip()
        if not room_name_clean:
            final_room = await _get_sim_room_by_code(db, SIM_DEFAULT_ROOM_CODE)
        else:
            room_code_candidate = _sim_room_code(room_name_clean)
            room_with_code = await _get_sim_room_by_code(db, room_code_candidate)
            if room_with_code:
                final_room = room_with_code
            else:
                room_doc = {
                    "id": str(uuid.uuid4()),
                    "code": room_code_candidate,
                    "name": room_name_clean[:40],
                    "created_by": user_id,
                    "is_public": bool(is_public),
                    "created_at": now,
                }
                await db.learn_sim_rooms.insert_one(room_doc)
                final_room = room_doc

    if not final_room:
        raise HTTPException(status_code=500, detail="Unable to join room")

    await _ensure_sim_room_membership(db, user_id, str(final_room["code"]))
    await db.learn_sim_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"active_room_code": str(final_room["code"]), "updated_at": now}},
        upsert=True,
    )
    return await _sim_room_view(db, final_room)


async def execute_simulation_trade(
    db: Any, user_id: str, symbol: str, side: str, quantity: float
) -> SimulationTrade:
    await _sync_sim_market_prices(db)
    await _sim_active_room(db, user_id)
    await _get_or_create_sim_profile(db, user_id)
    portfolio = await _get_or_create_sim_portfolio(db, user_id)

    normalized_symbol = _sim_symbol(symbol)
    normalized_side = _sim_side(side)
    qty = float(quantity)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than 0")

    asset = await db.learn_sim_assets.find_one({"symbol": normalized_symbol})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    price = float(asset.get("current_price", 0.0) or 0.0)
    if price <= 0:
        raise HTTPException(status_code=400, detail="Asset price is unavailable")

    notional = qty * price
    fee = notional * SIM_TRADING_FEE_RATE
    cash = float(portfolio.get("cash_balance", SIM_STARTING_CASH) or SIM_STARTING_CASH)
    realized_pnl = float(portfolio.get("realized_pnl", 0.0) or 0.0)
    now = datetime.utcnow()

    position = await db.learn_sim_positions.find_one(
        {"user_id": user_id, "symbol": normalized_symbol}
    )
    current_qty = float((position or {}).get("quantity", 0.0) or 0.0)
    current_avg = float((position or {}).get("average_buy_price", 0.0) or 0.0)

    if normalized_side == "buy":
        total_cost = notional + fee
        if total_cost > cash:
            raise HTTPException(status_code=400, detail="Insufficient virtual cash")

        new_qty = current_qty + qty
        new_avg = ((current_qty * current_avg) + (qty * price)) / new_qty if new_qty > 0 else 0.0
        await db.learn_sim_positions.update_one(
            {"user_id": user_id, "symbol": normalized_symbol},
            {
                "$set": {
                    "name": asset.get("name", normalized_symbol),
                    "category": asset.get("category", "stock"),
                    "quantity": _sim_round(new_qty),
                    "average_buy_price": _sim_round(new_avg),
                    "updated_at": now,
                },
                "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now},
            },
            upsert=True,
        )
        cash -= total_cost
    else:
        if qty > current_qty:
            raise HTTPException(status_code=400, detail="Not enough quantity to sell")

        pnl_for_sell = (price - current_avg) * qty - fee
        realized_pnl += pnl_for_sell
        remaining_qty = current_qty - qty
        cash += notional - fee

        if remaining_qty <= 0.000001:
            await db.learn_sim_positions.delete_one({"user_id": user_id, "symbol": normalized_symbol})
        else:
            await db.learn_sim_positions.update_one(
                {"user_id": user_id, "symbol": normalized_symbol},
                {
                    "$set": {
                        "quantity": _sim_round(remaining_qty),
                        "average_buy_price": _sim_round(current_avg),
                        "updated_at": now,
                    }
                },
            )

    await db.learn_sim_portfolios.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "cash_balance": _sim_round(cash),
                "realized_pnl": _sim_round(realized_pnl),
                "updated_at": now,
            }
        },
        upsert=True,
    )

    trade_doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "symbol": normalized_symbol,
        "side": normalized_side,
        "quantity": _sim_round(qty),
        "price": _sim_round(price),
        "notional": _sim_round(notional),
        "fee": _sim_round(fee),
        "executed_at": now,
        "created_at": now,
    }
    await db.learn_sim_trades.insert_one(trade_doc)
    await _grant_profile_rewards(db, user_id, xp=2, coins=1)

    return SimulationTrade(**trade_doc)


async def share_simulation_update(db: Any, user_id: str, message: str) -> SimulationFeedPost:
    await _sync_sim_market_prices(db)
    cleaned_message = message.strip()
    if not cleaned_message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    active_room = await _sim_active_room(db, user_id)
    sim_profile = await _get_or_create_sim_profile(db, user_id)
    portfolio = await _build_sim_portfolio_snapshot(db, user_id)
    user_name = await _sim_user_name(db, user_id)

    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "user_name": user_name,
        "avatar_id": str(sim_profile.get("avatar_id", SIM_DEFAULT_AVATARS[0]["id"])),
        "room_code": str(active_room["code"]),
        "message": cleaned_message[:280],
        "total_equity": _sim_round(portfolio.total_equity),
        "total_pnl_pct": _sim_round(portfolio.total_pnl_pct),
        "created_at": datetime.utcnow(),
    }
    await db.learn_sim_feed.insert_one(payload)
    return SimulationFeedPost(**payload)

