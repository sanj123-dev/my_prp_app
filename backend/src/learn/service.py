from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import re
import uuid

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

DEFAULT_QUIZ_BANK: List[Dict[str, Any]] = [
    {
        "id": "quiz-diversification",
        "question": "Your first investing skill should be:",
        "options": [
            "Put all money in one fast-growing stock",
            "Diversify across assets",
            "Trade daily for quick gains",
        ],
        "correct_index": 1,
    },
    {
        "id": "quiz-emergency-fund",
        "question": "Best first step before risky investing:",
        "options": [
            "Build an emergency fund",
            "Buy options contracts",
            "Take a personal loan to invest",
        ],
        "correct_index": 0,
    },
    {
        "id": "quiz-budgeting",
        "question": "A realistic budget should be reviewed:",
        "options": [
            "Once every 5 years",
            "Only when broke",
            "Weekly or monthly",
        ],
        "correct_index": 2,
    },
]

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

    for quiz in DEFAULT_QUIZ_BANK:
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
        return "Quiz Battle: What's the #1 rule of investing?", DEFAULT_QUIZ_OPTIONS
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
