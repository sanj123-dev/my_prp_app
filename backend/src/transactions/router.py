from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List
from collections import Counter
import re
import logging

from fastapi import APIRouter, HTTPException

from .schemas import (
    CategoryRetrainResponse,
    SMSTransactionRequest,
    Transaction,
    TransactionAmountUpdate,
    TransactionCategoryUpdate,
    TransactionCreate,
    TransactionSimilarityRequest,
    TransactionSimilarityResponse,
    TransactionUpdateRequest,
)
from .service import (
    ALLOWED_CATEGORIES,
    _build_similar_match_query,
    _categorize_transaction_rule_based,
    _extract_account_mask,
    _extract_bank_name,
    _extract_merchant_key,
    _extract_merchant_name,
    _extract_ref_id,
    _extract_sms_fields_with_ai,
    _extract_upi_id,
    _is_transaction_sms,
    _learned_category_for_transaction,
    _normalize_category_name,
    _normalize_merchant_label,
    _save_category_rule,
    categorize_transaction_with_ai,
    infer_transaction_type,
    normalize_transaction_type,
)


def _transaction_datetime(item: Dict[str, Any]) -> datetime:
    value = item.get("date") or item.get("created_at") or datetime.utcnow()
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return datetime.utcnow()
    return datetime.utcnow()


def create_transactions_router(db_provider) -> APIRouter:
    router = APIRouter(tags=["transactions"])
    db = db_provider()

    @router.post("/transactions/manual", response_model=Transaction)
    async def create_manual_transaction(transaction: TransactionCreate):
        merchant_key = _extract_merchant_key(transaction.description)
        upi_id = _extract_upi_id(transaction.description)
        learned_category = await _learned_category_for_transaction(
            transaction.user_id,
            merchant_key=merchant_key,
            upi_id=upi_id,
            description=transaction.description,
        )
        ai_result = (
            {"category": learned_category, "sentiment": "neutral"}
            if learned_category
            else await categorize_transaction_with_ai(transaction.description, transaction.amount)
        )

        trans_dict = transaction.dict()
        trans_dict["date"] = trans_dict.get("date") or datetime.utcnow()
        trans_dict["source"] = "manual"
        trans_dict["category"] = ai_result["category"]
        trans_dict["sentiment"] = ai_result["sentiment"]
        trans_dict["transaction_type"] = (
            normalize_transaction_type(transaction.transaction_type)
            if transaction.transaction_type
            else infer_transaction_type(transaction.description)
        )
        trans_dict["upi_id"] = upi_id
        trans_dict["merchant_key"] = merchant_key
        trans_dict["merchant_name"] = _extract_merchant_name(transaction.description)
        trans_dict["bank_name"] = _extract_bank_name(transaction.description)
        trans_dict["account_mask"] = _extract_account_mask(transaction.description)

        trans_obj = Transaction(**trans_dict)
        await db.transactions.insert_one(trans_obj.dict())
        if trans_obj.category != "Other" and (merchant_key or upi_id):
            await _save_category_rule(
                user_id=transaction.user_id,
                category=trans_obj.category,
                merchant_key=merchant_key,
                upi_id=upi_id,
                strength_increment=1,
            )
        return trans_obj

    @router.post("/transactions/sms", response_model=Transaction)
    async def create_sms_transaction(request: SMSTransactionRequest):
        try:
            ai_fields = await _extract_sms_fields_with_ai(request.sms_text)
            if not bool(ai_fields.get("is_transaction")) and not _is_transaction_sms(request.sms_text):
                raise HTTPException(status_code=422, detail="SMS is not a financial transaction alert")

            amount = None
            if ai_fields.get("amount") is not None:
                try:
                    amount = float(ai_fields.get("amount"))
                except Exception:
                    amount = None
            if amount is None:
                amount_match = re.search(r"(?:Rs\.?|INR|\$)\s*([0-9,]+\.?[0-9]*)", request.sms_text, re.IGNORECASE)
                if not amount_match:
                    raise HTTPException(status_code=422, detail="Amount not found in SMS")
                amount = float(amount_match.group(1).replace(",", ""))

            transaction_date = request.date or ai_fields.get("transaction_datetime") or datetime.utcnow()
            description = request.sms_text[:140]
            ref_id = ai_fields.get("reference_id") or _extract_ref_id(request.sms_text)
            upi_id = ai_fields.get("upi_id") or _extract_upi_id(request.sms_text)
            merchant_name = ai_fields.get("merchant_name") or _extract_merchant_name(request.sms_text)
            merchant_key = f"merchant:{_normalize_merchant_label(merchant_name)}" if merchant_name else _extract_merchant_key(request.sms_text)
            bank_name = ai_fields.get("bank_name") or _extract_bank_name(request.sms_text)
            account_mask = _extract_account_mask(request.sms_text)

            learned_category = await _learned_category_for_transaction(
                request.user_id,
                merchant_key=merchant_key,
                upi_id=upi_id,
                description=request.sms_text,
            )
            category_from_ai = ai_fields.get("category")
            transaction_type = ai_fields.get("transaction_type") or infer_transaction_type(request.sms_text)
            rule_category = _categorize_transaction_rule_based(text=request.sms_text, transaction_type=transaction_type)

            ai_result = {"category": "Other", "sentiment": "neutral"}
            category_strategy = "fallback_other"
            if learned_category:
                ai_result["category"] = learned_category
                category_strategy = "learned_rule_or_history"
            elif rule_category and rule_category in ALLOWED_CATEGORIES:
                ai_result["category"] = rule_category
                category_strategy = "deterministic_rule"
            elif category_from_ai and category_from_ai in ALLOWED_CATEGORIES:
                ai_result["category"] = category_from_ai
                category_strategy = "entity_extraction_ai"
            else:
                ai_result = await categorize_transaction_with_ai(request.sms_text, amount)
                category_strategy = "llm_classifier"

            if ref_id:
                existing_by_ref = await db.transactions.find_one({"user_id": request.user_id, "source": "sms", "ref_id": ref_id})
                if existing_by_ref:
                    return Transaction(**existing_by_ref)

            start_window = transaction_date - timedelta(minutes=3)
            end_window = transaction_date + timedelta(minutes=3)
            fallback_query: Dict[str, Any] = {
                "user_id": request.user_id,
                "source": "sms",
                "amount": amount,
                "date": {"$gte": start_window, "$lte": end_window},
            }
            if merchant_key:
                fallback_query["$or"] = [{"merchant_key": merchant_key}, {"description": description}]
            else:
                fallback_query["description"] = description

            existing_sms_transaction = await db.transactions.find_one(fallback_query)
            if existing_sms_transaction:
                return Transaction(**existing_sms_transaction)

            trans_obj = Transaction(
                user_id=request.user_id,
                amount=amount,
                category=ai_result["category"],
                description=description,
                date=transaction_date,
                source="sms",
                transaction_type=transaction_type,
                sentiment=ai_result["sentiment"],
                ref_id=ref_id,
                merchant_key=merchant_key,
                merchant_name=merchant_name,
                bank_name=bank_name,
                account_mask=account_mask,
                upi_id=upi_id,
            )
            await db.transactions.insert_one(trans_obj.dict())

            if ai_result["category"] != "Other" and (merchant_key or upi_id):
                await _save_category_rule(
                    user_id=request.user_id,
                    category=ai_result["category"],
                    merchant_key=merchant_key,
                    upi_id=upi_id,
                    strength_increment=2 if category_strategy in {"learned_rule_or_history", "deterministic_rule"} else 1,
                )
            return trans_obj
        except HTTPException:
            raise
        except Exception as error:
            logging.exception("SMS transaction import failed for user %s: %s", request.user_id, error)
            raise HTTPException(status_code=422, detail="Unable to process this SMS safely")

    @router.post("/transactions/{transaction_id}/similar-preview", response_model=TransactionSimilarityResponse)
    async def preview_similar_transactions(transaction_id: str, request: TransactionSimilarityRequest):
        selected_transaction = await db.transactions.find_one({"id": transaction_id, "user_id": request.user_id})
        if not selected_transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")

        merchant_key = selected_transaction.get("merchant_key") or _extract_merchant_key(selected_transaction.get("description", ""))
        upi_id = selected_transaction.get("upi_id") or _extract_upi_id(selected_transaction.get("description", ""))
        if not merchant_key and not upi_id:
            return TransactionSimilarityResponse(match_count=0, merchant_key=None, upi_id=None, sample_descriptions=[])

        query = _build_similar_match_query(user_id=request.user_id, base_transaction_id=transaction_id, merchant_key=merchant_key, upi_id=upi_id)
        similar_transactions = await db.transactions.find(query).sort("date", -1).limit(5).to_list(5)
        match_count = await db.transactions.count_documents(query)
        return TransactionSimilarityResponse(
            match_count=match_count,
            merchant_key=merchant_key,
            upi_id=upi_id,
            sample_descriptions=[str(item.get("description", ""))[:80] for item in similar_transactions],
        )

    @router.post("/transactions/{user_id}/categorization/retrain", response_model=CategoryRetrainResponse)
    async def retrain_transaction_categorization(user_id: str, min_samples: int = 2):
        if min_samples < 1 or min_samples > 10:
            raise HTTPException(status_code=400, detail="min_samples must be between 1 and 10")

        transactions = await db.transactions.find(
            {
                "user_id": user_id,
                "category": {"$in": list(ALLOWED_CATEGORIES - {"Other"})},
                "$or": [{"merchant_key": {"$exists": True, "$ne": None}}, {"upi_id": {"$exists": True, "$ne": None}}],
            }
        ).sort("date", -1).limit(5000).to_list(5000)

        votes_by_key: Dict[str, Counter[str]] = {}
        for item in transactions:
            category = str(item.get("category", "")).strip()
            if category not in ALLOWED_CATEGORIES or category == "Other":
                continue
            upi_id = str(item.get("upi_id", "") or "").strip().lower()
            merchant_key = str(item.get("merchant_key", "") or "").strip()
            identity_key = f"upi:{upi_id}" if upi_id else merchant_key
            if not identity_key:
                continue
            if identity_key not in votes_by_key:
                votes_by_key[identity_key] = Counter()
            votes_by_key[identity_key][category] += 1

        rules_upserted = 0
        for identity_key, category_votes in votes_by_key.items():
            top_category, top_count = category_votes.most_common(1)[0]
            total = sum(category_votes.values())
            if top_count < min_samples:
                continue
            if total > 0 and (top_count / total) < 0.65:
                continue

            upi_id = identity_key.replace("upi:", "", 1).strip() if identity_key.startswith("upi:") else None
            await _save_category_rule(
                user_id=user_id,
                category=top_category,
                merchant_key=identity_key,
                upi_id=upi_id,
                strength_increment=max(1, top_count),
            )
            rules_upserted += 1

        return CategoryRetrainResponse(
            user_id=user_id,
            scanned_transactions=len(transactions),
            rules_upserted=rules_upserted,
        )

    @router.get("/transactions/{user_id}", response_model=List[Transaction])
    async def get_user_transactions(user_id: str, limit: int = 50):
        raw_transactions = await db.transactions.find({"user_id": user_id}).to_list(2000)
        normalized: List[Dict[str, Any]] = []
        for item in raw_transactions:
            doc = dict(item)
            doc["date"] = doc.get("date") or doc.get("created_at") or datetime.utcnow()
            description = str(doc.get("description", ""))
            if not doc.get("merchant_name"):
                doc["merchant_name"] = _extract_merchant_name(description)
            if not doc.get("bank_name"):
                doc["bank_name"] = _extract_bank_name(description)
            if not doc.get("account_mask"):
                doc["account_mask"] = _extract_account_mask(description)
            normalized.append(doc)
        normalized.sort(key=lambda tx: _transaction_datetime(tx), reverse=True)
        return [Transaction(**t) for t in normalized[: max(1, limit)]]

    @router.put("/transactions/{transaction_id}/category", response_model=Transaction)
    async def update_transaction_category(transaction_id: str, request: TransactionCategoryUpdate):
        normalized_category = _normalize_category_name(request.category)
        if normalized_category not in ALLOWED_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category")

        update_result = await db.transactions.update_one(
            {"id": transaction_id, "user_id": request.user_id},
            {"$set": {"category": normalized_category}},
        )
        if update_result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Transaction not found")

        updated_transaction = await db.transactions.find_one({"id": transaction_id, "user_id": request.user_id})
        if request.apply_to_similar and updated_transaction:
            merchant_key = updated_transaction.get("merchant_key") or _extract_merchant_key(updated_transaction.get("description", ""))
            upi_id = updated_transaction.get("upi_id") or _extract_upi_id(updated_transaction.get("description", ""))
            bulk_query = _build_similar_match_query(user_id=request.user_id, base_transaction_id=transaction_id, merchant_key=merchant_key, upi_id=upi_id)
            if bulk_query.get("$or"):
                await db.transactions.update_many(bulk_query, {"$set": {"category": normalized_category}})

        if updated_transaction:
            derived_merchant_key = updated_transaction.get("merchant_key") or _extract_merchant_key(updated_transaction.get("description", ""))
            derived_upi_id = updated_transaction.get("upi_id") or _extract_upi_id(updated_transaction.get("description", ""))
            await _save_category_rule(
                user_id=request.user_id,
                category=normalized_category,
                merchant_key=derived_merchant_key,
                upi_id=derived_upi_id,
                strength_increment=3 if request.apply_to_similar else 1,
            )
        return Transaction(**updated_transaction)

    @router.put("/transactions/{transaction_id}/amount", response_model=Transaction)
    async def update_transaction_amount(transaction_id: str, request: TransactionAmountUpdate):
        if request.amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be greater than 0")
        update_result = await db.transactions.update_one(
            {"id": transaction_id, "user_id": request.user_id},
            {"$set": {"amount": float(request.amount)}},
        )
        if update_result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Transaction not found")
        updated_transaction = await db.transactions.find_one({"id": transaction_id, "user_id": request.user_id})
        return Transaction(**updated_transaction)

    @router.put("/transactions/{transaction_id}", response_model=Transaction)
    async def update_transaction(transaction_id: str, request: TransactionUpdateRequest):
        update_fields: Dict[str, object] = {}
        if request.amount is not None:
            if request.amount <= 0:
                raise HTTPException(status_code=400, detail="Amount must be greater than 0")
            update_fields["amount"] = float(request.amount)
        if request.category is not None:
            normalized_category = _normalize_category_name(request.category)
            if normalized_category not in ALLOWED_CATEGORIES:
                raise HTTPException(status_code=400, detail="Invalid category")
            update_fields["category"] = normalized_category
        if request.transaction_type is not None:
            update_fields["transaction_type"] = normalize_transaction_type(request.transaction_type)
        if request.description is not None:
            cleaned_description = request.description.strip()
            if not cleaned_description:
                raise HTTPException(status_code=400, detail="Description cannot be empty")
            update_fields["description"] = cleaned_description
            update_fields["upi_id"] = _extract_upi_id(cleaned_description)
            update_fields["merchant_key"] = _extract_merchant_key(cleaned_description)
            update_fields["merchant_name"] = _extract_merchant_name(cleaned_description)
            update_fields["bank_name"] = _extract_bank_name(cleaned_description)
            update_fields["account_mask"] = _extract_account_mask(cleaned_description)
        if request.date is not None:
            update_fields["date"] = request.date
        if not update_fields:
            raise HTTPException(status_code=400, detail="No fields provided to update")

        update_result = await db.transactions.update_one(
            {"id": transaction_id, "user_id": request.user_id},
            {"$set": update_fields},
        )
        if update_result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Transaction not found")

        updated_transaction = await db.transactions.find_one({"id": transaction_id, "user_id": request.user_id})
        if request.category is not None and updated_transaction:
            derived_merchant_key = updated_transaction.get("merchant_key") or _extract_merchant_key(updated_transaction.get("description", ""))
            derived_upi_id = updated_transaction.get("upi_id") or _extract_upi_id(updated_transaction.get("description", ""))
            await _save_category_rule(
                user_id=request.user_id,
                category=str(updated_transaction.get("category", "Other")),
                merchant_key=derived_merchant_key,
                upi_id=derived_upi_id,
                strength_increment=2,
            )
        return Transaction(**updated_transaction)

    @router.get("/transactions/{user_id}/analytics")
    async def get_transaction_analytics(user_id: str, days: int = 30):
        start_date = datetime.utcnow() - timedelta(days=days)
        raw_transactions = await db.transactions.find({"user_id": user_id}).to_list(3000)
        transactions = [t for t in raw_transactions if _transaction_datetime(t) >= start_date]

        total_debit = sum(t.get("amount", 0) for t in transactions if t.get("transaction_type", "debit") == "debit")
        total_credit = sum(t.get("amount", 0) for t in transactions if t.get("transaction_type", "debit") == "credit")
        categories: Dict[str, float] = {}
        by_day: Dict[str, float] = {}
        for t in transactions:
            cat = t.get("category", "Other")
            categories[cat] = categories.get(cat, 0) + t.get("amount", 0)
            day_key = _transaction_datetime(t).strftime("%Y-%m-%d")
            by_day[day_key] = by_day.get(day_key, 0) + t.get("amount", 0)
        return {
            "period_days": days,
            "transaction_count": len(transactions),
            "total_debit": round(total_debit, 2),
            "total_credit": round(total_credit, 2),
            "net_cashflow": round(total_credit - total_debit, 2),
            "categories": dict(sorted(categories.items(), key=lambda item: item[1], reverse=True)),
            "daily_spend": dict(sorted(by_day.items(), key=lambda item: item[0])),
        }

    return router
