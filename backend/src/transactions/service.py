from __future__ import annotations

import json
import logging
import re
from collections import Counter
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import HTTPException

ALLOWED_CATEGORIES = {
    "Food",
    "Groceries",
    "Transport",
    "Shopping",
    "Bills",
    "Entertainment",
    "Health",
    "Medical",
    "Education",
    "Travel",
    "Transfer",
    "Other",
}

CATEGORY_KEYWORDS: Dict[str, List[str]] = {
    "Food": ["swiggy", "zomato", "restaurant", "cafe", "pizza", "burger", "food", "dominos"],
    "Groceries": ["grocer", "grocery", "supermarket", "bigbasket", "blinkit", "instamart", "dmart", "mart"],
    "Transport": ["uber", "ola", "rapido", "metro", "fuel", "petrol", "diesel", "toll", "parking", "cab"],
    "Shopping": ["amazon", "flipkart", "myntra", "ajio", "nykaa", "shopping", "retail", "purchase"],
    "Bills": ["electricity", "water bill", "broadband", "wifi", "recharge", "dth", "emi", "insurance", "utility", "billdesk"],
    "Entertainment": ["netflix", "prime video", "spotify", "hotstar", "bookmyshow", "movie", "cinema", "gaming"],
    "Health": ["gym", "fitness", "yoga", "wellness", "health check"],
    "Medical": ["apollo", "pharmacy", "medicine", "medplus", "1mg", "hospital", "clinic", "doctor"],
    "Education": ["school", "college", "tuition", "course", "udemy", "coursera", "unacademy", "byju", "education"],
    "Travel": ["makemytrip", "goibibo", "airbnb", "hotel", "flight", "airline", "travel", "trip", "booking"],
    "Transfer": ["self transfer", "to own", "own account", "fund transfer", "imps", "neft", "rtgs", "upi transfer", "bank transfer"],
}

BANK_REFERENCE_DATA = [
    {"code": "SBI", "name": "State Bank of India"},
    {"code": "HDFC", "name": "HDFC Bank"},
    {"code": "ICICI", "name": "ICICI Bank"},
    {"code": "AXIS", "name": "Axis Bank"},
    {"code": "KOTAK", "name": "Kotak Mahindra Bank"},
    {"code": "PNB", "name": "Punjab National Bank"},
    {"code": "BOB", "name": "Bank of Baroda"},
    {"code": "YES", "name": "Yes Bank"},
    {"code": "IDFC", "name": "IDFC First Bank"},
    {"code": "INDUSIND", "name": "IndusInd Bank"},
    {"code": "CANARA", "name": "Canara Bank"},
    {"code": "UNION", "name": "Union Bank of India"},
    {"code": "PAYTM", "name": "Paytm Payments Bank"},
    {"code": "AIRTEL", "name": "Airtel Payments Bank"},
    {"code": "FEDERAL", "name": "Federal Bank"},
]

BANK_KEYWORDS = {
    "sbi",
    "state bank",
    "hdfc",
    "icici",
    "axis",
    "kotak",
    "pnb",
    "bank of baroda",
    "bob",
    "yes bank",
    "idfc",
    "indusind",
    "canara",
    "union bank",
    "federal bank",
    "paytm payments bank",
    "airtel payments bank",
}

_db: Any = None
_invoke_llm: Optional[Callable[[str, str, float], Awaitable[str]]] = None


def init_transaction_dependencies(
    db: Any,
    invoke_llm_fn: Callable[[str, str, float], Awaitable[str]],
) -> None:
    global _db, _invoke_llm
    _db = db
    _invoke_llm = invoke_llm_fn


def _require_db() -> Any:
    if _db is None:
        raise RuntimeError("Transaction service DB not initialized")
    return _db


def _require_llm() -> Callable[[str, str, float], Awaitable[str]]:
    if _invoke_llm is None:
        raise RuntimeError("Transaction service LLM not initialized")
    return _invoke_llm


async def categorize_transaction_with_ai(text: str, amount: float) -> Dict[str, str]:
    inferred_type = infer_transaction_type(text)
    rule_based = _categorize_transaction_rule_based(text=text, transaction_type=inferred_type)
    if rule_based:
        return {"category": rule_based, "sentiment": "neutral"}

    try:
        llm = _require_llm()
        prompt = f"""
Analyze transaction:
Amount: ${amount}
Description: {text}

Return ONLY JSON:
{{
 "category":"Food|Groceries|Transport|Shopping|Bills|Entertainment|Health|Medical|Education|Travel|Transfer|Other",
 "sentiment":"positive|neutral|negative"
}}
"""
        response = await llm("You categorize financial transactions.", prompt, 0.1)
        cleaned = response.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(cleaned)
        normalized_category = _normalize_category_name(str(parsed.get("category", "Other")))
        if normalized_category not in ALLOWED_CATEGORIES:
            normalized_category = "Other"
        return {
            "category": normalized_category,
            "sentiment": str(parsed.get("sentiment", "neutral")).strip().lower() or "neutral",
        }
    except Exception as error:
        logging.error(error)
        return {"category": "Other", "sentiment": "neutral"}


def _categorize_transaction_rule_based(text: str, transaction_type: Optional[str] = None) -> Optional[str]:
    lowered = (text or "").lower()
    if not lowered.strip():
        return None

    transfer_patterns = [
        "to own", "self transfer", "fund transfer to self", "to self", "own account", "a/c transfer",
        "account transfer", "upi transfer", "neft", "imps", "rtgs", "bank transfer", "wallet load", "add money",
    ]
    if any(pattern in lowered for pattern in transfer_patterns):
        return "Transfer"

    scores: Dict[str, int] = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword in lowered:
                scores[category] = scores.get(category, 0) + (3 if len(keyword) > 5 else 2)

    if "recharge" in lowered and "mobile" in lowered:
        scores["Bills"] = scores.get("Bills", 0) + 4
    if transaction_type and normalize_transaction_type(transaction_type) == "self_transfer":
        scores["Transfer"] = scores.get("Transfer", 0) + 6

    if not scores:
        return None
    top_category, top_score = max(scores.items(), key=lambda item: item[1])
    if top_score < 3:
        return None
    return top_category if top_category in ALLOWED_CATEGORIES else None


def _normalize_category_name(value: str) -> str:
    raw = (value or "").strip().lower()
    mapping = {
        "self transfer": "Transfer",
        "self_transfer": "Transfer",
        "transfer": "Transfer",
        "medical": "Medical",
        "medicine": "Medical",
        "health": "Health",
        "groceries": "Groceries",
        "grocery": "Groceries",
        "utilities": "Bills",
        "utility": "Bills",
        "transportation": "Transport",
        "traveling": "Travel",
        "shopping/retail": "Shopping",
        "entertainment & subscriptions": "Entertainment",
    }
    if raw in mapping:
        return mapping[raw]
    return (value or "").strip().title() or "Other"


def _is_transaction_sms(text: str) -> bool:
    sms = (text or "").strip().lower()
    if not sms:
        return False
    amount_regex = re.compile(r"(?:rs\.?|inr|mrp|\$)\s*[0-9][0-9,]*(?:\.[0-9]+)?")
    has_amount = bool(amount_regex.search(sms))
    has_txn_signal = bool(re.search(r"\b(debited|credited|withdrawn|spent|purchase|paid|payment|upi|neft|imps|atm|card|txn|transaction|received)\b", sms))
    recharge_or_reminder = bool(re.search(r"\b(recharge|validity|plan|otp|reminder|bill due|due date|promo|offer|discount|loan offer|insurance)\b", sms))
    return has_amount and has_txn_signal and not recharge_or_reminder


def _parse_datetime_from_string(value: Optional[str]) -> Optional[datetime]:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def normalize_transaction_type(value: str) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"self transfer", "self_transfer", "self-transfer"}:
        return "self_transfer"
    if normalized not in {"credit", "debit", "self_transfer"}:
        raise HTTPException(status_code=400, detail="transaction_type must be 'credit', 'debit', or 'self_transfer'")
    return normalized


def infer_transaction_type(text: str) -> str:
    lowered = (text or "").lower()
    if any(k in lowered for k in ["self transfer", "to own", "own account", "fund transfer to self", "a/c transfer", "account transfer"]):
        return "self_transfer"
    if any(k in lowered for k in ["credited", "credit alert", "received", "salary", "refund", "cashback", "deposited", "interest credited", "reversal"]):
        return "credit"
    if any(k in lowered for k in ["debited", "spent", "purchase", "withdrawn", "paid", "bill", "emi", "sent", "transfer to"]):
        return "debit"
    return "debit"


def _normalize_merchant_label(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9@._ -]", " ", value or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
    return cleaned[:80]


def _cleanup_merchant_candidate(raw_value: str) -> str:
    cleaned = re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z0-9&@._ -]", " ", raw_value or "")).strip()
    if not cleaned:
        return ""
    cleaned = re.split(r"\b(?:ref|utr|txn|txnid|available|avl|balance|bal|a/c|account|ending|card|on)\b", cleaned, flags=re.IGNORECASE)[0].strip(" -:,.")
    lowered = cleaned.lower()
    if not lowered:
        return ""
    if any(bank_word in lowered for bank_word in BANK_KEYWORDS):
        return ""
    if lowered in {"upi", "imps", "neft", "rtgs", "merchant"}:
        return ""
    if re.fullmatch(r"\d+", lowered):
        return ""
    return cleaned[:60]


def _extract_ref_id(text: str) -> Optional[str]:
    sms = text or ""
    patterns = [
        r"(?:utr|rrn|ref(?:erence)?(?:\s*no)?|txn(?:\s*id)?|transaction\s*id)\s*[:\-]?\s*([A-Za-z0-9]{6,30})",
        r"\b([A-Z0-9]{10,30})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, sms, flags=re.IGNORECASE)
        if match:
            candidate = (match.group(1) or "").strip()
            if 6 <= len(candidate) <= 30:
                return candidate.upper()
    return None


def _extract_upi_id(text: str) -> Optional[str]:
    match = re.search(r"\b([a-zA-Z0-9._-]{2,})@([a-zA-Z]{2,})\b", text or "")
    if not match:
        return None
    return f"{match.group(1)}@{match.group(2)}".lower()


def _merchant_name_from_upi_id(upi_id: Optional[str]) -> Optional[str]:
    if not upi_id:
        return None
    local_part = str(upi_id).split("@", 1)[0].strip()
    if not local_part:
        return None
    # UPI handles often encode names with separators and digits.
    cleaned_local = re.sub(r"[._-]+", " ", local_part)
    cleaned_local = re.sub(r"\d+", " ", cleaned_local)
    cleaned_local = re.sub(r"\s+", " ", cleaned_local).strip()
    candidate = _cleanup_merchant_candidate(cleaned_local)
    if not candidate:
        return None
    return candidate.title()


def _extract_bank_name(text: str) -> Optional[str]:
    sms = (text or "").lower()
    for key in sorted(BANK_KEYWORDS, key=len, reverse=True):
        if key in sms:
            return key.title()
    return None


def _extract_account_mask(text: str) -> Optional[str]:
    sms = text or ""
    patterns = [
        r"(?:a/c|account)\s*(?:xx|x+|\*+)?\s*([0-9]{3,8})",
        r"(?:ending|end)\s*(?:with)?\s*([0-9]{3,8})",
    ]
    for pattern in patterns:
        match = re.search(pattern, sms, flags=re.IGNORECASE)
        if match:
            last_digits = (match.group(1) or "").strip()
            if len(last_digits) >= 3:
                return f"xx{last_digits[-4:]}" if len(last_digits) >= 4 else f"xx{last_digits}"
    return None


def _extract_merchant_name(text: str) -> Optional[str]:
    sms = text or ""

    patterns = [
        r"(?:paid to|payment to|sent to|to|at|for|towards)\s+([A-Za-z0-9&._ -]{3,64})",
        r"(?:merchant|payee)\s*[:\-]?\s*([A-Za-z0-9&._ -]{3,64})",
        r"(?:credited from|received from)\s+([A-Za-z0-9&._ -]{3,64})",
    ]
    for pattern in patterns:
        match = re.search(pattern, sms, flags=re.IGNORECASE)
        if match:
            merchant = _cleanup_merchant_candidate(match.group(1))
            if merchant:
                return merchant

    upi_id = _extract_upi_id(sms)
    upi_name = _merchant_name_from_upi_id(upi_id)
    if upi_name:
        return upi_name
    return None


def _extract_merchant_key(text: str) -> Optional[str]:
    upi_id = _extract_upi_id(text or "")
    if upi_id:
        return f"upi:{upi_id}"
    merchant_name = _extract_merchant_name(text or "")
    if merchant_name:
        return f"merchant:{_normalize_merchant_label(merchant_name)}"
    return None


def _build_similar_match_query(
    user_id: str,
    base_transaction_id: str,
    merchant_key: Optional[str],
    upi_id: Optional[str],
) -> Dict[str, Any]:
    query: Dict[str, Any] = {"user_id": user_id, "id": {"$ne": base_transaction_id}}
    or_conditions: List[Dict[str, Any]] = []
    if upi_id:
        escaped_upi = re.escape(upi_id)
        or_conditions.append({"upi_id": upi_id})
        or_conditions.append({"description": {"$regex": escaped_upi, "$options": "i"}})
    if merchant_key:
        merchant_label = merchant_key.replace("merchant:", "", 1).strip()
        or_conditions.append({"merchant_key": merchant_key})
        if merchant_label:
            or_conditions.append({"description": {"$regex": re.escape(merchant_label), "$options": "i"}})
    if or_conditions:
        query["$or"] = or_conditions
    return query


async def _extract_sms_fields_with_ai(text: str) -> Dict[str, Any]:
    prompt = f"""
Extract transaction info from this SMS and return STRICT JSON only.
Category mapping guidance:
- Food: restaurants/food delivery/dining
- Groceries: supermarket/daily essentials
- Transport: taxi/metro/fuel/toll/parking
- Shopping: ecommerce/retail purchases
- Bills: utility/recharge/EMI/insurance bill payments
- Entertainment: OTT/movies/gaming/music subscriptions
- Health or Medical: fitness vs pharmacy/hospital/doctor
- Education: fees/courses/coaching
- Travel: flights/hotel/trips
- Transfer: self-transfer/NEFT/IMPS/RTGS/UPI transfer between accounts
- If unclear, use null category (do not guess).

SMS:
{text}

Return:
{{
  "is_transaction": true|false,
  "merchant_name": "string|null",
  "amount": number|null,
  "transaction_datetime": "ISO-8601 or null",
  "upi_id": "string|null",
  "reference_id": "string|null",
  "bank_name": "string|null",
  "category": "Food|Groceries|Transport|Shopping|Bills|Entertainment|Health|Medical|Education|Travel|Transfer|Other|null",
  "transaction_type": "credit|debit|self_transfer|null"
}}
"""
    try:
        llm = _require_llm()
        response = await llm(
            "You extract structured financial transaction entities from SMS. Return strict JSON only.",
            prompt,
            0.0,
        )
        cleaned = response.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(cleaned)
        raw_type = str(parsed.get("transaction_type", "")).strip().lower()
        normalized_type = normalize_transaction_type(raw_type) if raw_type else None
        raw_category = parsed.get("category")
        normalized_category = _normalize_category_name(str(raw_category)) if raw_category else None
        if normalized_category and normalized_category not in ALLOWED_CATEGORIES:
            normalized_category = None
        amount = parsed.get("amount")
        normalized_amount = None
        if amount is not None:
            amount_text = str(amount).replace(",", "").strip()
            if amount_text:
                normalized_amount = float(amount_text)
        return {
            "is_transaction": bool(parsed.get("is_transaction", False)),
            "merchant_name": (str(parsed.get("merchant_name", "")).strip() or None),
            "amount": normalized_amount,
            "transaction_datetime": _parse_datetime_from_string(parsed.get("transaction_datetime")),
            "upi_id": (str(parsed.get("upi_id", "")).strip().lower() or None),
            "reference_id": (str(parsed.get("reference_id", "")).strip().upper() or None),
            "bank_name": (str(parsed.get("bank_name", "")).strip() or None),
            "category": normalized_category,
            "transaction_type": normalized_type,
        }
    except Exception as error:
        logging.warning("SMS field extraction via AI failed: %s", error)
        return {}


async def _learned_category_for_transaction(
    user_id: str,
    merchant_key: Optional[str],
    upi_id: Optional[str],
    description: Optional[str] = None,
) -> Optional[str]:
    db = _require_db()
    if not merchant_key and not upi_id and not description:
        return None

    rule_query: Dict[str, Any] = {"user_id": user_id}
    rule_or_conditions: List[Dict[str, Any]] = []
    if upi_id:
        rule_or_conditions.append({"upi_id": upi_id})
        rule_or_conditions.append({"merchant_key": f"upi:{upi_id}"})
    if merchant_key:
        rule_or_conditions.append({"merchant_key": merchant_key})
    if rule_or_conditions:
        rule_query["$or"] = rule_or_conditions
        rule = await db.transaction_category_rules.find_one(rule_query, sort=[("rule_strength", -1), ("updated_at", -1)])
        if rule:
            category = str(rule.get("category", "")).strip()
            if category in ALLOWED_CATEGORIES:
                return category

    tx_query: Dict[str, Any] = {"user_id": user_id, "category": {"$in": list(ALLOWED_CATEGORIES - {"Other"})}}
    tx_or_conditions: List[Dict[str, Any]] = []
    if upi_id:
        tx_or_conditions.append({"upi_id": upi_id})
        tx_or_conditions.append({"merchant_key": f"upi:{upi_id}"})
    if merchant_key:
        tx_or_conditions.append({"merchant_key": merchant_key})
    merchant_label = ""
    if merchant_key and merchant_key.startswith("merchant:"):
        merchant_label = merchant_key.replace("merchant:", "", 1).strip()
    if merchant_label:
        tx_or_conditions.append({"description": {"$regex": re.escape(merchant_label), "$options": "i"}})
    if not tx_or_conditions:
        return None

    tx_query["$or"] = tx_or_conditions
    history = await db.transactions.find(tx_query).sort("date", -1).limit(40).to_list(40)
    votes: Counter[str] = Counter()
    for item in history:
        cat = str(item.get("category", "")).strip()
        if cat in ALLOWED_CATEGORIES and cat != "Other":
            votes[cat] += 1
    if not votes:
        return None

    top_category, top_count = votes.most_common(1)[0]
    total = sum(votes.values())
    if total <= 0:
        return None
    confidence = top_count / total
    if top_count >= 2 or confidence >= 0.85:
        return top_category
    return None


async def _save_category_rule(
    user_id: str,
    category: str,
    merchant_key: Optional[str],
    upi_id: Optional[str],
    strength_increment: int = 1,
) -> None:
    db = _require_db()
    if category not in ALLOWED_CATEGORIES:
        return
    if not merchant_key and not upi_id:
        return

    selector: Dict[str, Any] = {"user_id": user_id}
    if upi_id:
        selector["upi_id"] = upi_id
    elif merchant_key:
        selector["merchant_key"] = merchant_key
    else:
        return

    await db.transaction_category_rules.update_one(
        selector,
        {
            "$set": {
                "category": category,
                "merchant_key": merchant_key,
                "upi_id": upi_id,
                "updated_at": datetime.utcnow(),
            },
            "$inc": {"rule_strength": max(1, int(strength_increment))},
            "$setOnInsert": {"created_at": datetime.utcnow()},
        },
        upsert=True,
    )


async def _init_bank_reference_data() -> None:
    db = _require_db()
    try:
        await db.bank_reference.create_index("code", unique=True)
        await db.bank_reference.create_index("name")
    except Exception as error:
        logging.warning("Unable to create bank_reference indexes: %s", error)

    for bank in BANK_REFERENCE_DATA:
        try:
            await db.bank_reference.update_one(
                {"code": bank["code"]},
                {"$set": {"name": bank["name"], "updated_at": datetime.utcnow()}},
                upsert=True,
            )
        except Exception as error:
            logging.warning("Unable to upsert bank reference %s: %s", bank["code"], error)


async def _init_transaction_learning_infra() -> None:
    db = _require_db()
    try:
        await db.transaction_category_rules.create_index(
            [("user_id", 1), ("merchant_key", 1)],
            unique=True,
            sparse=True,
        )
        await db.transaction_category_rules.create_index(
            [("user_id", 1), ("upi_id", 1)],
            unique=True,
            sparse=True,
        )
        await db.transaction_category_rules.create_index([("updated_at", -1)])
        await db.transaction_category_rules.create_index([("user_id", 1), ("category", 1)])
        await db.transactions.create_index([("user_id", 1), ("merchant_key", 1), ("date", -1)])
        await db.transactions.create_index([("user_id", 1), ("upi_id", 1), ("date", -1)])
        await db.transactions.create_index([("user_id", 1), ("category", 1), ("date", -1)])
        await db.transactions.create_index([("user_id", 1), ("ref_id", 1)], sparse=True)
    except Exception as error:
        logging.warning("Unable to initialize transaction learning indexes: %s", error)
