from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SearchResult(BaseModel):
    symbol: str
    name: str
    exchange: Optional[str] = None
    asset_type: str = "equity"
    score: float = 0.0


class HistoricalPoint(BaseModel):
    date: str
    close: float
    volume: float
    ma50: Optional[float] = None
    ma200: Optional[float] = None


class MarketSnapshot(BaseModel):
    ticker: str
    short_name: str
    currency: str
    exchange: str
    asset_type: str
    price: float
    previous_close: Optional[float] = None
    market_cap: Optional[float] = None
    pe_ratio: Optional[float] = None
    day_change_pct: Optional[float] = None
    volume: Optional[float] = None
    fetched_at: datetime = Field(default_factory=datetime.utcnow)


class AnalyticsPayload(BaseModel):
    cagr_pct: Optional[float] = None
    volatility_pct: Optional[float] = None
    trend: str = "sideways"
    index_symbol: str
    performance_vs_index_pct: Optional[float] = None


class NewsItem(BaseModel):
    title: str
    link: str
    source: str
    published_at: Optional[datetime] = None
    sentiment: str = "neutral"
    summary: str


class SuggestionPayload(BaseModel):
    risk_profile: str
    suggestions: List[str]


class InvestmentOverviewResponse(BaseModel):
    snapshot: MarketSnapshot
    analytics: AnalyticsPayload
    history: List[HistoricalPoint]
    ai_insight: str
    news: List[NewsItem]
    suggestion: SuggestionPayload
    disclaimer: str = "This is not financial advice"


class InvestmentOverviewQuery(BaseModel):
    user_id: str
    ticker_or_query: str
    period: str = "max"


class InvestmentQaRequest(BaseModel):
    user_id: str
    ticker: str
    question: str
    session_id: Optional[str] = None


class InvestmentQaResponse(BaseModel):
    answer: str
    session_id: str
    used_context_keys: List[str] = []
    disclaimer: str = "This is not financial advice"


class CachedPayload(BaseModel):
    key: str
    value: Dict[str, Any]
    expires_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)
