from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from collections import deque
from datetime import datetime, timedelta
from math import sqrt
from statistics import stdev
from typing import Any, Deque, Dict, List, Optional, Tuple
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

import yfinance as yf
from langchain_openai import ChatOpenAI

from .schemas import (
    AnalyticsPayload,
    HistoricalPoint,
    InvestmentOverviewResponse,
    InvestmentQaResponse,
    MarketSnapshot,
    NewsItem,
    SearchResult,
    SuggestionPayload,
)

DISCLAIMER_TEXT = "This is not financial advice"
_POSITIVE_TERMS = {"beat", "growth", "rally", "surge", "record", "strong", "bullish", "upgrade"}
_NEGATIVE_TERMS = {"drop", "slump", "miss", "loss", "downgrade", "lawsuit", "risk", "bearish"}


class InMemoryTTLCache:
    def __init__(self) -> None:
        self._items: Dict[str, Tuple[datetime, Any]] = {}

    def get(self, key: str) -> Optional[Any]:
        entry = self._items.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if datetime.utcnow() >= expires_at:
            self._items.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any, ttl_seconds: int) -> None:
        self._items[key] = (datetime.utcnow() + timedelta(seconds=max(1, ttl_seconds)), value)


class SlidingWindowRateLimiter:
    def __init__(self, max_calls: int, window_seconds: int) -> None:
        self.max_calls = max_calls
        self.window_seconds = window_seconds
        self._buckets: Dict[str, Deque[float]] = {}

    def allow(self, key: str) -> bool:
        now = datetime.utcnow().timestamp()
        bucket = self._buckets.setdefault(key, deque())
        floor = now - self.window_seconds
        while bucket and bucket[0] < floor:
            bucket.popleft()
        if len(bucket) >= self.max_calls:
            return False
        bucket.append(now)
        return True


class SymbolSearchAgent:
    def __init__(self, cache: InMemoryTTLCache) -> None:
        self.cache = cache

    async def search(self, query: str, limit: int = 8) -> List[SearchResult]:
        cleaned = (query or "").strip()
        if not cleaned:
            return []
        cache_key = f"symbol-search:{cleaned.lower()}:{limit}"
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        def _run_search() -> List[SearchResult]:
            results: List[SearchResult] = []
            try:
                rows = (yf.Search(cleaned, max_results=max(5, limit)).quotes or [])[:limit]
                for row in rows:
                    symbol = str(row.get("symbol", "")).strip().upper()
                    if not symbol:
                        continue
                    name = str(row.get("shortname") or row.get("longname") or symbol).strip()
                    exchange = str(row.get("exchange", "")).strip() or None
                    quote_type = str(row.get("quoteType", "equity")).strip().lower() or "equity"
                    score = 0.6
                    if cleaned.lower() in name.lower():
                        score += 0.2
                    if cleaned.lower() in symbol.lower():
                        score += 0.2
                    results.append(
                        SearchResult(
                            symbol=symbol,
                            name=name,
                            exchange=exchange,
                            asset_type=quote_type,
                            score=round(min(1.0, score), 3),
                        )
                    )
            except Exception as error:
                logging.warning("symbol search failed for query=%s: %s", cleaned, error)
            if not results:
                normalized = re.sub(r"[^A-Za-z0-9]", "", cleaned).upper()
                if normalized:
                    fallback = [normalized, f"{normalized}.NS", f"{normalized}.BO"]
                    for idx, symbol in enumerate(fallback):
                        results.append(
                            SearchResult(
                                symbol=symbol,
                                name=cleaned.title(),
                                exchange="NSE" if symbol.endswith(".NS") else ("BSE" if symbol.endswith(".BO") else None),
                                asset_type="equity",
                                score=round(0.7 - (idx * 0.1), 3),
                            )
                        )
            return results[:limit]

        items = await asyncio.to_thread(_run_search)
        self.cache.set(cache_key, items, ttl_seconds=30 * 60)
        return items

    async def resolve(self, ticker_or_query: str) -> SearchResult:
        cleaned = (ticker_or_query or "").strip()
        if not cleaned:
            raise ValueError("ticker_or_query is required")
        # If the input looks like a direct market symbol, trust it.
        if re.match(r"^[A-Za-z0-9^._-]{1,20}$", cleaned) and any(ch in cleaned for ch in ".-^"):
            symbol = cleaned.upper()
            return SearchResult(symbol=symbol, name=symbol, asset_type="equity", score=0.9)
        # Otherwise resolve through search so names like "Reliance" map to the right ticker.
        results = await self.search(cleaned, limit=5)
        if not results:
            if re.match(r"^[A-Za-z0-9]{1,20}$", cleaned):
                symbol = cleaned.upper()
                return SearchResult(symbol=symbol, name=symbol, asset_type="equity", score=0.5)
            raise ValueError(f"No ticker found for '{cleaned}'")
        return sorted(results, key=lambda item: item.score, reverse=True)[0]


class MarketDataAgent:
    def __init__(self, cache: InMemoryTTLCache) -> None:
        self.cache = cache

    async def fetch_snapshot_and_history(self, symbol: str, period: str = "max") -> Tuple[MarketSnapshot, List[HistoricalPoint]]:
        normalized_period = period if period in {"1y", "2y", "5y", "10y", "max"} else "max"
        cache_key = f"market-data:{symbol}:{normalized_period}"
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        def _fetch() -> Tuple[MarketSnapshot, List[HistoricalPoint]]:
            ticker = yf.Ticker(symbol)
            info = ticker.info or {}
            history = ticker.history(period=normalized_period, interval="1d", auto_adjust=False)
            if history is None or history.empty:
                history = ticker.history(period="1y", interval="1d", auto_adjust=False)
            if history is None or history.empty:
                raise ValueError(f"No historical data available for {symbol}")

            points: List[HistoricalPoint] = []
            closes: List[float] = []
            for idx in history.index:
                row = history.loc[idx]
                close = float(row.get("Close") or 0.0)
                volume = float(row.get("Volume") or 0.0)
                if close <= 0:
                    continue
                closes.append(close)
                ma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
                ma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None
                iso_date = idx.to_pydatetime().strftime("%Y-%m-%d")
                points.append(
                    HistoricalPoint(
                        date=iso_date,
                        close=round(close, 4),
                        volume=round(volume, 2),
                        ma50=round(ma50, 4) if ma50 is not None else None,
                        ma200=round(ma200, 4) if ma200 is not None else None,
                    )
                )

            if not points:
                raise ValueError(f"No usable historical prices for {symbol}")

            latest_close = points[-1].close
            previous_close = points[-2].close if len(points) > 1 else None
            day_change = None
            if previous_close and previous_close > 0:
                day_change = ((latest_close - previous_close) / previous_close) * 100

            snapshot = MarketSnapshot(
                ticker=symbol,
                short_name=str(info.get("shortName") or info.get("longName") or symbol),
                currency=str(info.get("currency") or "USD"),
                exchange=str(info.get("exchange") or ""),
                asset_type=str(info.get("quoteType") or "equity"),
                price=round(latest_close, 4),
                previous_close=round(float(previous_close), 4) if previous_close is not None else None,
                market_cap=float(info["marketCap"]) if info.get("marketCap") else None,
                pe_ratio=float(info["trailingPE"]) if info.get("trailingPE") else None,
                day_change_pct=round(day_change, 3) if day_change is not None else None,
                volume=points[-1].volume,
            )
            return snapshot, points

        payload = await asyncio.to_thread(_fetch)
        self.cache.set(cache_key, payload, ttl_seconds=2 * 60)
        return payload


class AnalyticsAgent:
    async def analyze(self, symbol: str, history: List[HistoricalPoint]) -> AnalyticsPayload:
        if len(history) < 2:
            return AnalyticsPayload(index_symbol=self._index_for_symbol(symbol))

        closes = [item.close for item in history if item.close > 0]
        if len(closes) < 2:
            return AnalyticsPayload(index_symbol=self._index_for_symbol(symbol))

        start = closes[0]
        end = closes[-1]
        years = max(1 / 252, len(closes) / 252)
        cagr = ((end / start) ** (1 / years) - 1) * 100 if start > 0 else None

        returns: List[float] = []
        for i in range(1, len(closes)):
            prev = closes[i - 1]
            if prev <= 0:
                continue
            returns.append((closes[i] - prev) / prev)
        volatility = stdev(returns) * sqrt(252) * 100 if len(returns) >= 2 else None

        ma50 = history[-1].ma50
        ma200 = history[-1].ma200
        trend = "sideways"
        if ma50 and ma200:
            if closes[-1] > ma50 > ma200:
                trend = "bullish"
            elif closes[-1] < ma50 < ma200:
                trend = "bearish"

        index_symbol = self._index_for_symbol(symbol)
        index_perf = await self._compare_with_index(index_symbol=index_symbol, reference_days=len(closes))
        perf_vs_index = None
        if index_perf is not None:
            base_perf = ((end / start) - 1) * 100 if start > 0 else None
            if base_perf is not None:
                perf_vs_index = base_perf - index_perf

        return AnalyticsPayload(
            cagr_pct=round(cagr, 3) if cagr is not None else None,
            volatility_pct=round(volatility, 3) if volatility is not None else None,
            trend=trend,
            index_symbol=index_symbol,
            performance_vs_index_pct=round(perf_vs_index, 3) if perf_vs_index is not None else None,
        )

    def _index_for_symbol(self, symbol: str) -> str:
        if symbol.endswith(".NS") or symbol.endswith(".BO"):
            return "^NSEI"
        return "^GSPC"

    async def _compare_with_index(self, index_symbol: str, reference_days: int) -> Optional[float]:
        period = "5y" if reference_days > 252 * 5 else ("2y" if reference_days > 252 * 2 else "1y")

        def _fetch_index_perf() -> Optional[float]:
            try:
                ticker = yf.Ticker(index_symbol)
                history = ticker.history(period=period, interval="1d", auto_adjust=False)
                if history is None or history.empty:
                    return None
                closes = [float(v) for v in history["Close"].tolist() if float(v) > 0]
                if len(closes) < 2:
                    return None
                return ((closes[-1] / closes[0]) - 1) * 100
            except Exception:
                return None

        return await asyncio.to_thread(_fetch_index_perf)


class NewsSentimentAgent:
    def __init__(self, cache: InMemoryTTLCache) -> None:
        self.cache = cache

    async def fetch(self, symbol: str, limit: int = 6) -> List[NewsItem]:
        cache_key = f"news:{symbol}:{limit}"
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        def _load_news() -> List[NewsItem]:
            query = symbol.replace("^", "")
            url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={query}&region=US&lang=en-US"
            req = Request(url, headers={"User-Agent": "SpendWise/1.0"})
            try:
                with urlopen(req, timeout=10) as response:
                    xml_bytes = response.read()
            except Exception as error:
                logging.warning("news fetch failed for %s: %s", symbol, error)
                return []

            try:
                root = ET.fromstring(xml_bytes)
            except Exception:
                return []

            rows: List[NewsItem] = []
            for item in root.findall(".//item")[: max(1, limit)]:
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                desc = (item.findtext("description") or "").strip()
                pub_date = (item.findtext("pubDate") or "").strip()
                if not title or not link:
                    continue
                published_at = None
                if pub_date:
                    try:
                        published_at = datetime.strptime(pub_date, "%a, %d %b %Y %H:%M:%S %z")
                    except Exception:
                        published_at = None
                summary = re.sub(r"<[^>]+>", " ", desc)
                summary = re.sub(r"\s+", " ", summary).strip()[:240]
                sentiment = self._sentiment_from_text(f"{title} {summary}")
                rows.append(
                    NewsItem(
                        title=title,
                        link=link,
                        source="Yahoo Finance",
                        published_at=published_at,
                        sentiment=sentiment,
                        summary=summary or title,
                    )
                )
            return rows

        news = await asyncio.to_thread(_load_news)
        self.cache.set(cache_key, news, ttl_seconds=10 * 60)
        return news

    def _sentiment_from_text(self, text: str) -> str:
        lowered = (text or "").lower()
        pos = sum(1 for term in _POSITIVE_TERMS if term in lowered)
        neg = sum(1 for term in _NEGATIVE_TERMS if term in lowered)
        if pos > neg:
            return "positive"
        if neg > pos:
            return "negative"
        return "neutral"


class InsightAgent:
    def build(self, snapshot: MarketSnapshot, analytics: AnalyticsPayload, news: List[NewsItem]) -> str:
        trend_line = f"{snapshot.short_name} appears to be in a {analytics.trend} trend."
        risk_bits: List[str] = []
        if analytics.volatility_pct is not None:
            if analytics.volatility_pct >= 45:
                risk_bits.append("high volatility")
            elif analytics.volatility_pct >= 25:
                risk_bits.append("moderate volatility")
            else:
                risk_bits.append("relatively stable volatility")
        if analytics.performance_vs_index_pct is not None:
            if analytics.performance_vs_index_pct >= 5:
                risk_bits.append("outperforming its index recently")
            elif analytics.performance_vs_index_pct <= -5:
                risk_bits.append("underperforming its index recently")
            else:
                risk_bits.append("moving close to index performance")
        pos_news = sum(1 for item in news if item.sentiment == "positive")
        neg_news = sum(1 for item in news if item.sentiment == "negative")
        news_line = "news sentiment is mixed"
        if pos_news > neg_news:
            news_line = "news sentiment is mostly positive"
        elif neg_news > pos_news:
            news_line = "news sentiment is mostly cautious"

        return (
            f"{trend_line} Latest price is {snapshot.price} {snapshot.currency}. "
            f"Risk view: {', '.join(risk_bits) if risk_bits else 'insufficient data'}. "
            f"Compared with market signals, {news_line}."
        )


class SuggestionAgent:
    def __init__(self, db: Any) -> None:
        self.db = db

    async def recommend(self, user_id: str, analytics: AnalyticsPayload, symbol: str) -> SuggestionPayload:
        user = await self.db.users.find_one({"id": user_id}) or {}
        monthly_income = float(user.get("monthly_income") or 0.0)
        savings = float(user.get("saving_amount") or 0.0)
        risk_profile = self._infer_risk_profile(monthly_income, savings, analytics.volatility_pct or 0.0)
        suggestions: List[str] = []
        if risk_profile == "conservative":
            suggestions.append("Limit single-stock exposure and prefer SIPs into diversified index funds.")
            suggestions.append("Keep an emergency fund of at least 6 months before increasing equity allocation.")
        elif risk_profile == "moderate":
            suggestions.append("Balance holdings across equity, debt, and one global or sector ETF.")
            suggestions.append("Use monthly SIP installments instead of lump-sum entries in volatile phases.")
        else:
            suggestions.append("You may consider a growth allocation, but cap high-volatility bets per position.")
            suggestions.append("Rebalance quarterly and track drawdowns against your risk tolerance.")

        if analytics.trend == "bearish":
            suggestions.append(f"{symbol} is in a bearish phase; stagger entries and set risk limits.")
        elif analytics.trend == "bullish":
            suggestions.append(f"{symbol} momentum is positive; avoid overconcentration and keep diversification.")

        return SuggestionPayload(risk_profile=risk_profile, suggestions=suggestions[:4])

    def _infer_risk_profile(self, monthly_income: float, savings: float, volatility_pct: float) -> str:
        savings_ratio = (savings / monthly_income) if monthly_income > 0 else 0.0
        if savings_ratio < 0.15 or volatility_pct > 40:
            return "conservative"
        if savings_ratio < 0.30 or volatility_pct > 25:
            return "moderate"
        return "aggressive"


class QaAgent:
    def __init__(self, db: Any) -> None:
        self.db = db
        self.llm = self._build_llm()

    def _build_llm(self) -> Optional[ChatOpenAI]:
        api_key = (os.environ.get("GROQ_API_KEY", "") or "").strip()
        base_url = (os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1") or "").strip()
        model = (os.environ.get("ASSISTANT_MODEL", "llama-3.3-70b-versatile") or "").strip()
        if not api_key:
            return None
        try:
            return ChatOpenAI(
                model=model,
                api_key=api_key,
                base_url=base_url,
                temperature=0.2,
            )
        except Exception as error:
            logging.warning("QA LLM init failed: %s", error)
            return None

    async def ask(
        self,
        *,
        user_id: str,
        ticker: str,
        question: str,
        snapshot: MarketSnapshot,
        analytics: AnalyticsPayload,
        insight: str,
        session_id: Optional[str],
    ) -> InvestmentQaResponse:
        sid = (session_id or str(uuid.uuid4())).strip()
        session_doc = await self.db.investment_qa_sessions.find_one({"id": sid, "user_id": user_id}) or {}
        history: List[Dict[str, str]] = list(session_doc.get("history", []))[-8:]
        context = {
            "ticker": ticker,
            "price": snapshot.price,
            "currency": snapshot.currency,
            "pe_ratio": snapshot.pe_ratio,
            "market_cap": snapshot.market_cap,
            "trend": analytics.trend,
            "cagr_pct": analytics.cagr_pct,
            "volatility_pct": analytics.volatility_pct,
            "performance_vs_index_pct": analytics.performance_vs_index_pct,
            "insight": insight,
        }
        answer = await self._answer_with_context(question=question, context=context, history=history)

        history.append({"role": "user", "text": question.strip()[:600]})
        history.append({"role": "assistant", "text": answer[:1200]})

        await self.db.investment_qa_sessions.update_one(
            {"id": sid, "user_id": user_id},
            {
                "$set": {
                    "ticker": ticker,
                    "updated_at": datetime.utcnow(),
                    "history": history[-20:],
                },
                "$setOnInsert": {"id": sid, "user_id": user_id, "created_at": datetime.utcnow()},
            },
            upsert=True,
        )

        return InvestmentQaResponse(
            answer=answer,
            session_id=sid,
            used_context_keys=list(context.keys()),
            disclaimer=DISCLAIMER_TEXT,
        )

    async def _answer_with_context(
        self, *, question: str, context: Dict[str, Any], history: List[Dict[str, str]]
    ) -> str:
        if not self.llm:
            return self._fallback_answer(question, context)

        history_text = "\n".join(
            f"{item.get('role', 'user')}: {str(item.get('text', '')).strip()[:240]}" for item in history
        )
        prompt = (
            "You are an investment Q&A assistant. Answer strictly from the provided context. "
            "If data is missing, say it clearly. Keep response under 120 words.\n\n"
            f"Context JSON:\n{json.dumps(context, default=str)}\n\n"
            f"Conversation history:\n{history_text or 'None'}\n\n"
            f"User question:\n{question}\n\n"
            f"Always end with: {DISCLAIMER_TEXT}."
        )
        try:
            response = await self.llm.ainvoke(prompt)
            text = str(getattr(response, "content", "") or "").strip()
            if not text:
                return self._fallback_answer(question, context)
            if DISCLAIMER_TEXT not in text:
                return f"{text}\n{DISCLAIMER_TEXT}"
            return text
        except Exception as error:
            logging.warning("investment qa failed: %s", error)
            return self._fallback_answer(question, context)

    def _fallback_answer(self, question: str, context: Dict[str, Any]) -> str:
        lowered = (question or "").lower()
        if "risk" in lowered or "safe" in lowered:
            risk_band = "high" if (context.get("volatility_pct") or 0) > 35 else "moderate"
            return (
                f"Based on current volatility ({context.get('volatility_pct')}%), risk looks {risk_band}. "
                f"Trend is {context.get('trend')}. {DISCLAIMER_TEXT}"
            )
        if "grow" in lowered or "cagr" in lowered:
            return f"Estimated CAGR is {context.get('cagr_pct')}% with trend {context.get('trend')}. {DISCLAIMER_TEXT}"
        return (
            f"{context.get('ticker')} is trading near {context.get('price')} {context.get('currency')}. "
            f"Trend: {context.get('trend')}, volatility: {context.get('volatility_pct')}%. {DISCLAIMER_TEXT}"
        )


class InvestmentService:
    def __init__(self, db: Any) -> None:
        self.db = db
        self.cache = InMemoryTTLCache()
        self.rate_limiter = SlidingWindowRateLimiter(max_calls=80, window_seconds=60)
        self.search_agent = SymbolSearchAgent(cache=self.cache)
        self.market_agent = MarketDataAgent(cache=self.cache)
        self.analytics_agent = AnalyticsAgent()
        self.news_agent = NewsSentimentAgent(cache=self.cache)
        self.insight_agent = InsightAgent()
        self.suggestion_agent = SuggestionAgent(db=db)
        self.qa_agent = QaAgent(db=db)

    async def search_symbols(self, user_id: str, query: str, limit: int = 8) -> List[SearchResult]:
        self._enforce_rate_limit(user_id, "search")
        return await self.search_agent.search(query=query, limit=limit)

    async def get_overview(self, user_id: str, ticker_or_query: str, period: str = "max") -> InvestmentOverviewResponse:
        self._enforce_rate_limit(user_id, "overview")
        return await self._build_overview(user_id=user_id, ticker_or_query=ticker_or_query, period=period)

    async def _build_overview(self, user_id: str, ticker_or_query: str, period: str = "max") -> InvestmentOverviewResponse:
        resolved = await self.search_agent.resolve(ticker_or_query)
        snapshot, history = await self.market_agent.fetch_snapshot_and_history(resolved.symbol, period=period)
        analytics = await self.analytics_agent.analyze(resolved.symbol, history)
        news = await self.news_agent.fetch(resolved.symbol, limit=8)
        insight = self.insight_agent.build(snapshot, analytics, news)
        suggestion = await self.suggestion_agent.recommend(user_id=user_id, analytics=analytics, symbol=resolved.symbol)
        return InvestmentOverviewResponse(
            snapshot=snapshot,
            analytics=analytics,
            history=history,
            ai_insight=insight,
            news=news,
            suggestion=suggestion,
            disclaimer=DISCLAIMER_TEXT,
        )

    async def ask_question(
        self,
        *,
        user_id: str,
        ticker: str,
        question: str,
        session_id: Optional[str],
    ) -> InvestmentQaResponse:
        self._enforce_rate_limit(user_id, "qa")
        overview = await self._build_overview(user_id=user_id, ticker_or_query=ticker, period="1y")
        return await self.qa_agent.ask(
            user_id=user_id,
            ticker=overview.snapshot.ticker,
            question=question,
            snapshot=overview.snapshot,
            analytics=overview.analytics,
            insight=overview.ai_insight,
            session_id=session_id,
        )

    def _enforce_rate_limit(self, user_id: str, action: str) -> None:
        key = f"{user_id}:{action}"
        if not self.rate_limiter.allow(key):
            raise ValueError("Too many requests. Please try again shortly.")


async def init_investments_module(db: Any) -> None:
    await db.investment_qa_sessions.create_index([("id", 1)], unique=True)
    await db.investment_qa_sessions.create_index([("user_id", 1), ("updated_at", -1)])
    await db.investment_qa_sessions.create_index([("ticker", 1)])
    await db.investment_cache.create_index([("key", 1)], unique=True)
    await db.investment_cache.create_index([("expires_at", 1)])
