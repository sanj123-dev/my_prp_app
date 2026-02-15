from __future__ import annotations

from datetime import datetime, timedelta
from statistics import mean, median, pstdev
from typing import Any, Dict, List

from .semantic import SemanticDoc, SimpleSemanticSearch


class AssistantTools:
    def __init__(self, db: Any) -> None:
        self.db = db
        self.semantic = SimpleSemanticSearch(dims=512)

    def _as_datetime(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
            except Exception:
                pass
        return datetime.utcnow()

    async def financial_snapshot(self, user_id: str, days: int = 45) -> Dict[str, Any]:
        cutoff = datetime.utcnow() - timedelta(days=days)
        docs = await self.db.transactions.find({"user_id": user_id}).to_list(2500)
        recent = [d for d in docs if self._as_datetime(d.get("date", d.get("created_at"))) >= cutoff]

        debit = sum(float(d.get("amount", 0.0) or 0.0) for d in recent if d.get("transaction_type", "debit") == "debit")
        credit = sum(float(d.get("amount", 0.0) or 0.0) for d in recent if d.get("transaction_type", "debit") == "credit")

        categories: Dict[str, float] = {}
        for d in recent:
            if d.get("transaction_type", "debit") != "debit":
                continue
            cat = str(d.get("category", "Other"))
            categories[cat] = categories.get(cat, 0.0) + float(d.get("amount", 0.0) or 0.0)

        top_categories = sorted(categories.items(), key=lambda item: item[1], reverse=True)[:5]
        return {
            "window_days": days,
            "transaction_count": len(recent),
            "total_debit": round(debit, 2),
            "total_credit": round(credit, 2),
            "net_cashflow": round(credit - debit, 2),
            "top_categories": [{"name": name, "amount": round(amount, 2)} for name, amount in top_categories],
        }

    async def analytics_report(self, user_id: str, days: int = 90) -> Dict[str, Any]:
        now = datetime.utcnow()
        start_recent = now - timedelta(days=days)
        start_prev = start_recent - timedelta(days=days)

        docs = await self.db.transactions.find({"user_id": user_id}).to_list(4000)
        tx: List[Dict[str, Any]] = []
        for d in docs:
            tx_date = self._as_datetime(d.get("date", d.get("created_at")))
            tx.append({**d, "_dt": tx_date})

        recent = [
            d for d in tx
            if start_recent <= d["_dt"] <= now and str(d.get("transaction_type", "debit")) == "debit"
        ]
        previous = [
            d for d in tx
            if start_prev <= d["_dt"] < start_recent and str(d.get("transaction_type", "debit")) == "debit"
        ]

        def summarize(items: List[Dict[str, Any]]) -> Dict[str, Any]:
            amounts = [float(x.get("amount", 0.0) or 0.0) for x in items]
            total = sum(amounts)
            avg = mean(amounts) if amounts else 0.0
            med = median(amounts) if amounts else 0.0
            largest = max(items, key=lambda x: float(x.get("amount", 0.0) or 0.0)) if items else None
            return {
                "count": len(items),
                "total_spend": round(total, 2),
                "avg_spend": round(avg, 2),
                "median_spend": round(med, 2),
                "largest": {
                    "amount": round(float((largest or {}).get("amount", 0.0) or 0.0), 2),
                    "description": str((largest or {}).get("description", ""))[:120],
                    "category": str((largest or {}).get("category", "Other")),
                    "date": str((largest or {}).get("_dt", "")),
                } if largest else None,
            }

        recent_stats = summarize(recent)
        prev_stats = summarize(previous)

        prev_total = float(prev_stats.get("total_spend", 0.0) or 0.0)
        recent_total = float(recent_stats.get("total_spend", 0.0) or 0.0)
        pct_change = ((recent_total - prev_total) / prev_total * 100.0) if prev_total > 0 else 0.0

        categories: Dict[str, float] = {}
        for d in recent:
            cat = str(d.get("category", "Other"))
            categories[cat] = categories.get(cat, 0.0) + float(d.get("amount", 0.0) or 0.0)

        top_categories = sorted(categories.items(), key=lambda item: item[1], reverse=True)[:6]
        top_categories_share = []
        for name, amount in top_categories:
            share = (amount / recent_total * 100.0) if recent_total > 0 else 0.0
            top_categories_share.append(
                {
                    "name": name,
                    "amount": round(amount, 2),
                    "share_pct": round(share, 1),
                }
            )

        monthly: Dict[str, float] = {}
        for d in recent:
            key = d["_dt"].strftime("%Y-%m")
            monthly[key] = monthly.get(key, 0.0) + float(d.get("amount", 0.0) or 0.0)
        monthly_trend = [{"month": k, "spend": round(v, 2)} for k, v in sorted(monthly.items())]

        seven_start = now - timedelta(days=7)
        prev_seven_start = seven_start - timedelta(days=7)
        spend_7 = sum(float(d.get("amount", 0.0) or 0.0) for d in recent if d["_dt"] >= seven_start)
        spend_prev_7 = sum(
            float(d.get("amount", 0.0) or 0.0)
            for d in tx
            if prev_seven_start <= d["_dt"] < seven_start and str(d.get("transaction_type", "debit")) == "debit"
        )
        velocity_change_pct = ((spend_7 - spend_prev_7) / spend_prev_7 * 100.0) if spend_prev_7 > 0 else 0.0

        anomalies: List[Dict[str, Any]] = []
        amounts_recent = [float(x.get("amount", 0.0) or 0.0) for x in recent]
        if len(amounts_recent) >= 8:
            avg = mean(amounts_recent)
            std = pstdev(amounts_recent)
            threshold = avg + (2 * std)
            outliers = [x for x in recent if float(x.get("amount", 0.0) or 0.0) >= threshold]
            outliers.sort(key=lambda x: float(x.get("amount", 0.0) or 0.0), reverse=True)
            for item in outliers[:5]:
                anomalies.append(
                    {
                        "amount": round(float(item.get("amount", 0.0) or 0.0), 2),
                        "description": str(item.get("description", ""))[:120],
                        "category": str(item.get("category", "Other")),
                        "date": item["_dt"].strftime("%Y-%m-%d"),
                    }
                )

        return {
            "window_days": days,
            "recent_period": recent_stats,
            "previous_period": prev_stats,
            "period_change_pct": round(pct_change, 1),
            "top_categories": top_categories_share,
            "monthly_trend": monthly_trend,
            "spend_velocity_7d": {
                "current_7d_spend": round(spend_7, 2),
                "previous_7d_spend": round(spend_prev_7, 2),
                "change_pct": round(velocity_change_pct, 1),
            },
            "anomalies": anomalies,
        }

    async def semantic_context(self, user_id: str, query: str, limit: int = 6) -> List[Dict[str, Any]]:
        memory_docs = await self.db.assistant_memories.find({"user_id": user_id}).sort("created_at", -1).limit(300).to_list(300)
        knowledge_docs = await self.db.assistant_knowledge.find({}).sort("created_at", -1).limit(300).to_list(300)
        tx_docs = await self.db.transactions.find({"user_id": user_id}).sort("date", -1).limit(200).to_list(200)

        corpus: List[SemanticDoc] = []

        for doc in memory_docs:
            corpus.append(
                SemanticDoc(
                    source="memory",
                    text=str(doc.get("text", "")),
                    metadata={"id": str(doc.get("id", "")), "tags": doc.get("tags", [])},
                )
            )

        for doc in knowledge_docs:
            corpus.append(
                SemanticDoc(
                    source="knowledge",
                    text=f"{doc.get('title', '')}. {doc.get('text', '')}",
                    metadata={"id": str(doc.get("id", "")), "tags": doc.get("tags", [])},
                )
            )

        for doc in tx_docs:
            corpus.append(
                SemanticDoc(
                    source="transaction",
                    text=(
                        f"{doc.get('description', '')}. "
                        f"Category: {doc.get('category', 'Other')}. "
                        f"Amount: {doc.get('amount', 0)}. "
                        f"Type: {doc.get('transaction_type', 'debit')}"
                    ),
                    metadata={"id": str(doc.get("id", "")), "date": str(doc.get("date", ""))},
                )
            )

        return self.semantic.search(query=query, docs=corpus, limit=limit)

    async def user_profile_summary(self, user_id: str) -> Dict[str, Any]:
        user = await self.db.users.find_one({"id": user_id}) or {}
        habits = await self.db.habits.find({"user_id": user_id, "status": {"$in": ["active", "completed"]}}).to_list(20)
        tx = await self.db.transactions.find({"user_id": user_id}).sort("date", -1).limit(30).to_list(30)

        goals: List[Dict[str, Any]] = []
        for h in habits:
            target = float(h.get("target_amount", 0.0) or 0.0)
            current = float(h.get("current_amount", 0.0) or 0.0)
            progress = float(h.get("progress", 0.0) or 0.0)
            if target > 0 and progress <= 0:
                progress = min(100.0, (current / target) * 100)
            goals.append(
                {
                    "goal": str(h.get("goal", "")).strip(),
                    "category": str(h.get("category", "General")),
                    "target_amount": round(target, 2),
                    "current_amount": round(current, 2),
                    "progress": round(progress, 1),
                    "status": str(h.get("status", "active")),
                }
            )

        recent_spend = 0.0
        for d in tx:
            if str(d.get("transaction_type", "debit")) == "debit":
                recent_spend += float(d.get("amount", 0.0) or 0.0)

        name = str(user.get("name", "")).strip() or "there"
        return {
            "name": name,
            "goals": goals[:3],
            "recent_transaction_count": len(tx),
            "recent_spend_30_entries": round(recent_spend, 2),
        }
