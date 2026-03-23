from __future__ import annotations

from datetime import datetime, timedelta
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter
import re
import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .schemas import (
    CategoryRetrainResponse,
    SMSTransactionRequest,
    StatementImportResponse,
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


def _looks_like_amount(value: str) -> bool:
    return bool(re.search(r"[0-9]", value or ""))


def _to_amount(value: Any) -> Optional[float]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    cleaned = raw.replace(",", "")
    cleaned = re.sub(r"(?i)\b(?:rs|inr)\.?\s*", "", cleaned).strip()
    cleaned = re.sub(r"[^0-9.\-]", "", cleaned)
    if cleaned in {"", "-", ".", "-."}:
        return None
    try:
        return abs(float(cleaned))
    except Exception:
        return None


def _to_statement_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    for fmt in (
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%d-%m-%y",
        "%d/%m/%y",
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d %b %Y",
        "%d %B %Y",
    ):
        try:
            return datetime.strptime(raw, fmt)
        except Exception:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _normalize_column_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").strip().lower())


def _extract_rows_from_excel_or_csv(
    filename: str,
    content_type: str,
    raw_bytes: bytes,
) -> List[Dict[str, Any]]:
    try:
        import pandas as pd  # type: ignore
    except Exception as error:
        raise HTTPException(status_code=500, detail="Excel/CSV support is not installed on backend") from error

    suffix = (filename.rsplit(".", 1)[-1].lower() if "." in filename else "")
    data = BytesIO(raw_bytes)
    if "csv" in (content_type or "").lower() or suffix == "csv":
        frame = pd.read_csv(data)
    else:
        frame = pd.read_excel(data, engine="openpyxl")
    frame = frame.fillna("")
    return frame.to_dict(orient="records")


def _extract_text_from_pdf(raw_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception as error:
        raise HTTPException(status_code=500, detail="PDF parsing support is not installed on backend") from error

    reader = PdfReader(BytesIO(raw_bytes))
    chunks: List[str] = []
    for page in reader.pages:
        page_text = page.extract_text() or ""
        if page_text.strip():
            chunks.append(page_text)
    return "\n".join(chunks).strip()


def _rows_to_candidates(rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    candidates: List[Dict[str, Any]] = []
    notes: List[str] = []
    for row in rows:
        normalized = {_normalize_column_name(str(key)): value for key, value in row.items()}

        date_value = None
        for key in ("date", "txndate", "transactiondate", "valuedate", "posteddate"):
            if key in normalized and str(normalized[key]).strip():
                date_value = normalized[key]
                break

        description = ""
        for key in ("description", "narration", "remarks", "details", "merchant", "particulars"):
            if key in normalized and str(normalized[key]).strip():
                description = str(normalized[key]).strip()
                break

        debit_amount = None
        for key in ("debit", "withdrawal", "withdraw", "debitamount", "dr"):
            if key in normalized and _looks_like_amount(str(normalized[key])):
                debit_amount = _to_amount(normalized[key])
                if debit_amount:
                    break

        credit_amount = None
        for key in ("credit", "deposit", "creditamount", "cr"):
            if key in normalized and _looks_like_amount(str(normalized[key])):
                credit_amount = _to_amount(normalized[key])
                if credit_amount:
                    break

        direct_amount = None
        direct_amount_raw = ""
        for key in ("amount", "txnamount", "transactionamount"):
            if key in normalized and _looks_like_amount(str(normalized[key])):
                direct_amount_raw = str(normalized[key]).strip()
                direct_amount = _to_amount(normalized[key])
                if direct_amount:
                    break

        transaction_type = "debit"
        amount = debit_amount or credit_amount or direct_amount
        if amount is None:
            continue
        if credit_amount and not debit_amount:
            transaction_type = "credit"
        elif debit_amount and not credit_amount:
            transaction_type = "debit"
        else:
            raw_direct = direct_amount_raw
            if raw_direct.startswith("-"):
                transaction_type = "debit"
            elif raw_direct:
                transaction_type = "credit" if "credit" in description.lower() else "debit"

        parsed_date = _to_statement_datetime(date_value) or datetime.utcnow()
        if not description:
            description = "Imported from statement"

        candidates.append(
            {
                "amount": amount,
                "description": description[:220],
                "date": parsed_date,
                "transaction_type": transaction_type,
            }
        )

    if not candidates:
        notes.append("No valid transaction rows found in table-style statement.")
    return candidates, notes


def _extract_line_candidates(text: str) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    if not text.strip():
        return candidates
    date_pattern = r"(?P<date>\d{1,2}[-/]\d{1,2}[-/]\d{2,4})"
    amount_pattern = r"(?P<amount>-?[0-9][0-9,]*(?:\.[0-9]{1,2})?)"
    crdr_pattern = r"(?P<crdr>cr|dr|credit|debit)?"
    pattern = re.compile(
        rf"{date_pattern}\s+(?P<description>.+?)\s+{amount_pattern}\s*{crdr_pattern}\s*$",
        flags=re.IGNORECASE,
    )
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if len(line) < 8:
            continue
        match = pattern.search(line)
        if not match:
            continue
        amount = _to_amount(match.group("amount"))
        if amount is None or amount <= 0:
            continue
        parsed_date = _to_statement_datetime(match.group("date")) or datetime.utcnow()
        crdr = (match.group("crdr") or "").strip().lower()
        transaction_type = "credit" if crdr in {"cr", "credit"} else "debit"
        candidates.append(
            {
                "amount": amount,
                "description": (match.group("description") or "Imported from statement").strip()[:220],
                "date": parsed_date,
                "transaction_type": transaction_type,
            }
        )
    return candidates


async def _extract_candidates_from_text_with_ai(text: str) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    if not text.strip():
        return candidates
    amount_hint_regex = re.compile(r"(?:rs\.?|inr|₹|\$)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?", re.IGNORECASE)
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines() if line.strip()]
    candidate_lines = [line for line in lines if amount_hint_regex.search(line)]
    for line in candidate_lines[:80]:
        try:
            ai_fields = await _extract_sms_fields_with_ai(line)
            if not bool(ai_fields.get("is_transaction")):
                continue
            amount = ai_fields.get("amount")
            if amount is None:
                continue
            normalized_amount = _to_amount(amount)
            if normalized_amount is None or normalized_amount <= 0:
                continue
            description = str(ai_fields.get("merchant_name") or line).strip()[:220]
            transaction_datetime = ai_fields.get("transaction_datetime") or datetime.utcnow()
            transaction_type = ai_fields.get("transaction_type") or infer_transaction_type(line)
            candidates.append(
                {
                    "amount": normalized_amount,
                    "description": description,
                    "date": transaction_datetime if isinstance(transaction_datetime, datetime) else datetime.utcnow(),
                    "transaction_type": normalize_transaction_type(transaction_type),
                }
            )
        except Exception:
            continue
    return candidates


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
            # Prefer deterministic extraction (including UPI fallback) over LLM field guesses.
            merchant_name = _extract_merchant_name(request.sms_text) or ai_fields.get("merchant_name")
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

    @router.post("/transactions/statements/upload", response_model=StatementImportResponse)
    async def upload_statement_transactions(
        user_id: str = Form(...),
        file: UploadFile = File(...),
        extracted_text: Optional[str] = Form(None),
    ):
        try:
            if not user_id.strip():
                raise HTTPException(status_code=400, detail="user_id is required")
            raw_bytes = await file.read()
            if not raw_bytes:
                raise HTTPException(status_code=400, detail="Uploaded file is empty")
            if len(raw_bytes) > 15 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="File is too large. Maximum size is 15MB.")

            filename = file.filename or "statement"
            content_type = (file.content_type or "").lower()
            suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

            candidates: List[Dict[str, Any]] = []
            notes: List[str] = []

            if suffix in {"csv", "xlsx", "xls"} or "spreadsheet" in content_type or "csv" in content_type:
                rows = _extract_rows_from_excel_or_csv(filename, content_type, raw_bytes)
                row_candidates, row_notes = _rows_to_candidates(rows)
                candidates.extend(row_candidates)
                notes.extend(row_notes)
            elif suffix == "pdf" or "pdf" in content_type:
                raw_text = _extract_text_from_pdf(raw_bytes)
                line_candidates = _extract_line_candidates(raw_text)
                if line_candidates:
                    candidates.extend(line_candidates)
                else:
                    ai_candidates = await _extract_candidates_from_text_with_ai(raw_text)
                    candidates.extend(ai_candidates)
                    if not ai_candidates:
                        notes.append("PDF text was read but transaction rows could not be identified.")
            elif content_type.startswith("image/") or suffix in {"jpg", "jpeg", "png", "webp"}:
                text_from_image = (extracted_text or "").strip()
                if not text_from_image:
                    raise HTTPException(
                        status_code=422,
                        detail="No OCR text found for image. Please allow OCR in app and try again.",
                    )
                line_candidates = _extract_line_candidates(text_from_image)
                if line_candidates:
                    candidates.extend(line_candidates)
                else:
                    ai_candidates = await _extract_candidates_from_text_with_ai(text_from_image)
                    candidates.extend(ai_candidates)
                    if not ai_candidates:
                        notes.append("OCR text was received but no transactions matched parser patterns.")
            else:
                raise HTTPException(
                    status_code=415,
                    detail="Unsupported file type. Please upload PDF, Excel/CSV, or image.",
                )

            if not candidates:
                raise HTTPException(status_code=422, detail="No transactions could be extracted from this statement")

            imported: List[Transaction] = []
            skipped_count = 0
            failed_count = 0
            for candidate in candidates[:200]:
                try:
                    amount = float(candidate.get("amount", 0) or 0)
                    if amount <= 0:
                        skipped_count += 1
                        continue
                    description = str(candidate.get("description", "")).strip()[:220]
                    if not description:
                        skipped_count += 1
                        continue
                    transaction_date = candidate.get("date")
                    if not isinstance(transaction_date, datetime):
                        transaction_date = _to_statement_datetime(transaction_date) or datetime.utcnow()
                    raw_type = str(candidate.get("transaction_type", "debit")).strip().lower()
                    transaction_type = normalize_transaction_type(raw_type) if raw_type else infer_transaction_type(description)

                    existing = await db.transactions.find_one(
                        {
                            "user_id": user_id,
                            "source": "statement_upload",
                            "amount": amount,
                            "description": description,
                            "date": transaction_date,
                        }
                    )
                    if existing:
                        skipped_count += 1
                        continue

                    merchant_key = _extract_merchant_key(description)
                    upi_id = _extract_upi_id(description)
                    learned_category = await _learned_category_for_transaction(
                        user_id,
                        merchant_key=merchant_key,
                        upi_id=upi_id,
                        description=description,
                    )
                    ai_result = (
                        {"category": learned_category, "sentiment": "neutral"}
                        if learned_category
                        else await categorize_transaction_with_ai(description, amount)
                    )

                    trans_obj = Transaction(
                        user_id=user_id,
                        amount=amount,
                        category=ai_result["category"],
                        description=description,
                        date=transaction_date,
                        source="statement_upload",
                        transaction_type=transaction_type,
                        sentiment=ai_result.get("sentiment", "neutral"),
                        merchant_key=merchant_key,
                        merchant_name=_extract_merchant_name(description),
                        bank_name=_extract_bank_name(description),
                        account_mask=_extract_account_mask(description),
                        upi_id=upi_id,
                    )
                    await db.transactions.insert_one(trans_obj.dict())
                    imported.append(trans_obj)

                    if trans_obj.category != "Other" and (merchant_key or upi_id):
                        await _save_category_rule(
                            user_id=user_id,
                            category=trans_obj.category,
                            merchant_key=merchant_key,
                            upi_id=upi_id,
                            strength_increment=1,
                        )
                except Exception as item_error:
                    failed_count += 1
                    logging.warning("Statement row import failed for user %s: %s", user_id, item_error)

            if not imported and (skipped_count > 0 or failed_count > 0):
                raise HTTPException(status_code=422, detail="Rows were found but none could be imported")

            return StatementImportResponse(
                imported_count=len(imported),
                skipped_count=skipped_count,
                failed_count=failed_count,
                transactions=imported,
                notes=notes[:5],
            )
        except HTTPException:
            raise
        except Exception as error:
            logging.exception("Statement upload failed for user %s: %s", user_id, error)
            raise HTTPException(status_code=422, detail="Unable to process this statement file safely")

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
        try:
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
            if not updated_transaction:
                raise HTTPException(status_code=404, detail="Transaction not found after update")

            if request.apply_to_similar:
                merchant_key = updated_transaction.get("merchant_key") or _extract_merchant_key(updated_transaction.get("description", ""))
                upi_id = updated_transaction.get("upi_id") or _extract_upi_id(updated_transaction.get("description", ""))
                bulk_query = _build_similar_match_query(
                    user_id=request.user_id,
                    base_transaction_id=transaction_id,
                    merchant_key=merchant_key,
                    upi_id=upi_id,
                )
                if bulk_query.get("$or"):
                    await db.transactions.update_many(bulk_query, {"$set": {"category": normalized_category}})

            # Rule learning should not break category update response.
            try:
                derived_merchant_key = updated_transaction.get("merchant_key") or _extract_merchant_key(updated_transaction.get("description", ""))
                derived_upi_id = updated_transaction.get("upi_id") or _extract_upi_id(updated_transaction.get("description", ""))
                await _save_category_rule(
                    user_id=request.user_id,
                    category=normalized_category,
                    merchant_key=derived_merchant_key,
                    upi_id=derived_upi_id,
                    strength_increment=3 if request.apply_to_similar else 1,
                )
            except Exception as rule_error:
                logging.warning(
                    "Category rule save failed for user=%s tx=%s: %s",
                    request.user_id,
                    transaction_id,
                    rule_error,
                )

            return Transaction(**updated_transaction)
        except HTTPException:
            raise
        except Exception as error:
            logging.exception(
                "Category update failed for user=%s tx=%s: %s",
                request.user_id,
                transaction_id,
                error,
            )
            raise HTTPException(status_code=500, detail="Failed to update transaction category")

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
