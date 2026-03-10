from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, Field


class Transaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    amount: float
    category: str
    description: str
    date: datetime
    source: str
    transaction_type: str = "debit"
    sentiment: Optional[str] = None
    ref_id: Optional[str] = None
    merchant_key: Optional[str] = None
    merchant_name: Optional[str] = None
    bank_name: Optional[str] = None
    account_mask: Optional[str] = None
    upi_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TransactionCreate(BaseModel):
    user_id: str
    amount: float
    description: str
    date: Optional[datetime] = None
    transaction_type: Optional[str] = None


class SMSTransactionRequest(BaseModel):
    user_id: str
    sms_text: str
    date: Optional[datetime] = None


class TransactionCategoryUpdate(BaseModel):
    user_id: str
    category: str
    apply_to_similar: bool = False


class TransactionAmountUpdate(BaseModel):
    user_id: str
    amount: float


class TransactionUpdateRequest(BaseModel):
    user_id: str
    amount: Optional[float] = None
    category: Optional[str] = None
    transaction_type: Optional[str] = None
    description: Optional[str] = None
    date: Optional[datetime] = None


class TransactionSimilarityRequest(BaseModel):
    user_id: str


class TransactionSimilarityResponse(BaseModel):
    match_count: int
    merchant_key: Optional[str] = None
    upi_id: Optional[str] = None
    sample_descriptions: List[str] = []


class CategoryRetrainResponse(BaseModel):
    user_id: str
    scanned_transactions: int
    rules_upserted: int
