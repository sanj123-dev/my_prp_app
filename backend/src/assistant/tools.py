from __future__ import annotations

from datetime import datetime, timedelta
from statistics import mean, median, pstdev
from typing import Any, Dict, List
import re
import uuid

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

    async def transaction_summary(
        self,
        user_id: str,
        *,
        start_iso: str,
        end_iso: str,
        limit: int = 12,
    ) -> Dict[str, Any]:
        start = self._as_datetime(start_iso)
        end = self._as_datetime(end_iso)
        docs = await self.db.transactions.find({"user_id": user_id}).to_list(5000)

        selected: List[Dict[str, Any]] = []
        for doc in docs:
            dt = self._as_datetime(doc.get("date", doc.get("created_at")))
            if start <= dt < end:
                selected.append({**doc, "_dt": dt})

        selected.sort(key=lambda item: item["_dt"], reverse=True)
        debit = sum(
            float(d.get("amount", 0.0) or 0.0)
            for d in selected
            if str(d.get("transaction_type", "debit")) == "debit"
        )
        credit = sum(
            float(d.get("amount", 0.0) or 0.0)
            for d in selected
            if str(d.get("transaction_type", "debit")) == "credit"
        )

        category_totals: Dict[str, float] = {}
        for d in selected:
            if str(d.get("transaction_type", "debit")) != "debit":
                continue
            cat = str(d.get("category", "Other"))
            category_totals[cat] = category_totals.get(cat, 0.0) + float(d.get("amount", 0.0) or 0.0)

        top_categories = [
            {"name": name, "amount": round(amount, 2)}
            for name, amount in sorted(category_totals.items(), key=lambda item: item[1], reverse=True)[:6]
        ]

        transactions = []
        for item in selected[:max(5, min(limit, 20))]:
            transactions.append(
                {
                    "date": item["_dt"].strftime("%Y-%m-%d"),
                    "description": str(item.get("description", ""))[:120],
                    "category": str(item.get("category", "Other")),
                    "transaction_type": str(item.get("transaction_type", "debit")),
                    "amount": round(float(item.get("amount", 0.0) or 0.0), 2),
                }
            )

        return {
            "start_date": start.strftime("%Y-%m-%d"),
            "end_date_exclusive": end.strftime("%Y-%m-%d"),
            "days": max(1, int((end - start).total_seconds() // 86400)),
            "transaction_count": len(selected),
            "total_debit": round(debit, 2),
            "total_credit": round(credit, 2),
            "net_cashflow": round(credit - debit, 2),
            "top_debit_categories": top_categories,
            "transactions": transactions,
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

    async def recent_dialogue(self, user_id: str, session_id: str, limit: int = 8) -> List[Dict[str, str]]:
        docs = await (
            self.db.assistant_messages
            .find({"user_id": user_id, "session_id": session_id})
            .sort("created_at", -1)
            .limit(limit)
            .to_list(limit)
        )
        docs.reverse()
        dialogue: List[Dict[str, str]] = []
        for doc in docs:
            role = str(doc.get("role", "")).strip().lower()
            if role not in {"user", "assistant"}:
                continue
            content = str(doc.get("content", "")).strip()
            if not content:
                continue
            dialogue.append({"role": role, "content": content[:320]})
        return dialogue

    async def user_style_preferences(self, user_id: str) -> Dict[str, Any]:
        pref = await self.db.assistant_user_prefs.find_one({"user_id": user_id}) or {}
        style_preference = str(pref.get("style_preference", "")).strip()
        if style_preference not in {"concise", "detailed", "example_driven", "balanced"}:
            style_preference = "balanced"
        tone_preference = str(pref.get("tone_preference", "")).strip() or "neutral"
        style_scores = pref.get("style_scores", {}) or {}
        return {
            "style_preference": style_preference,
            "tone_preference": tone_preference,
            "style_scores": {
                "concise": int(style_scores.get("concise", 0) or 0),
                "detailed": int(style_scores.get("detailed", 0) or 0),
                "example_driven": int(style_scores.get("example_driven", 0) or 0),
                "balanced": int(style_scores.get("balanced", 0) or 0),
            },
        }

    async def behaviour_profile(self, user_id: str, days: int = 180) -> Dict[str, Any]:
        cutoff = datetime.utcnow() - timedelta(days=days)
        docs = await self.db.transactions.find({"user_id": user_id}).to_list(6000)

        debit_rows: List[Dict[str, Any]] = []
        for row in docs:
            dt = self._as_datetime(row.get("date", row.get("created_at")))
            if dt < cutoff:
                continue
            tx_type = str(row.get("transaction_type", "debit")).strip().lower()
            if tx_type not in {"debit", "self_transfer"}:
                continue
            debit_rows.append({**row, "_dt": dt, "_amount": float(row.get("amount", 0.0) or 0.0)})

        total_spend = sum(item["_amount"] for item in debit_rows)
        weekend_spend = sum(
            item["_amount"] for item in debit_rows if int(item["_dt"].weekday()) in {5, 6}
        )
        late_night_spend = sum(
            item["_amount"] for item in debit_rows if int(item["_dt"].hour) >= 21 or int(item["_dt"].hour) < 6
        )

        weekend_ratio = (weekend_spend / total_spend * 100.0) if total_spend > 0 else 0.0
        late_night_ratio = (late_night_spend / total_spend * 100.0) if total_spend > 0 else 0.0

        merchant_counts: Dict[str, int] = {}
        category_counts: Dict[str, int] = {}
        for item in debit_rows:
            merchant = str(item.get("merchant_name", "")).strip().lower()
            if merchant:
                merchant_counts[merchant] = merchant_counts.get(merchant, 0) + 1
            category = str(item.get("category", "Other")).strip()
            category_counts[category] = category_counts.get(category, 0) + 1

        recurring_merchants = [
            {"merchant": name.title(), "count": count}
            for name, count in sorted(merchant_counts.items(), key=lambda pair: pair[1], reverse=True)
            if count >= 3
        ][:6]

        top_categories = [
            {"name": name, "count": count}
            for name, count in sorted(category_counts.items(), key=lambda pair: pair[1], reverse=True)[:5]
        ]

        habit_flags: List[str] = []
        if weekend_ratio >= 35:
            habit_flags.append("weekend_spike")
        if late_night_ratio >= 18:
            habit_flags.append("late_night_spending")
        if recurring_merchants:
            habit_flags.append("recurring_merchants")
        if not habit_flags:
            habit_flags.append("stable_pattern")

        return {
            "window_days": days,
            "transaction_count": len(debit_rows),
            "weekend_spend_ratio_pct": round(weekend_ratio, 1),
            "late_night_spend_ratio_pct": round(late_night_ratio, 1),
            "recurring_merchants": recurring_merchants,
            "top_category_frequency": top_categories,
            "habit_flags": habit_flags,
        }

    def detect_dissatisfaction(self, text: str) -> bool:
        lowered = (text or "").strip().lower()
        if not lowered:
            return False
        phrases = [
            "boring",
            "bore",
            "same thing",
            "repeat",
            "repetitive",
            "not helpful",
            "didn't help",
            "did not help",
            "you always",
            "stop repeating",
            "bad answer",
            "wrong answer",
            "not satisfied",
            "useless",
            "annoying",
            "frustrated",
        ]
        return any(phrase in lowered for phrase in phrases)

    def infer_user_tone(self, text: str) -> str:
        lowered = (text or "").strip().lower()
        if not lowered:
            return "neutral"
        if any(token in lowered for token in ["urgent", "asap", "quick", "immediately", "now"]):
            return "urgent"
        if any(token in lowered for token in ["worried", "stress", "anxious", "overwhelmed"]):
            return "stressed"
        if any(token in lowered for token in ["hey", "buddy", "bro", "chill", "casual"]):
            return "casual"
        if "?" in lowered or any(token in lowered for token in ["explain", "why", "how", "what"]):
            return "curious"
        return "neutral"

    def preferred_response_style(self, message: str, dialogue: List[Dict[str, str]]) -> str:
        prior_user_text = " ".join(item.get("content", "") for item in dialogue if item.get("role") == "user")
        text = f"{prior_user_text} {message}".lower()
        if any(token in text for token in ["short", "brief", "quick answer", "just answer", "tldr"]):
            return "concise"
        if any(token in text for token in ["detailed", "in detail", "deep", "step by step"]):
            return "detailed"
        if any(token in text for token in ["example", "sample", "show me"]):
            return "example_driven"
        return "balanced"

    def _try_parse_date_token(self, token: str, now: datetime) -> datetime | None:
        cleaned = token.strip().lower().replace(",", " ")
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if not cleaned:
            return None

        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y"):
            try:
                return datetime.strptime(cleaned, fmt)
            except Exception:
                pass

        for fmt in ("%d-%m-%y", "%d/%m/%y", "%m/%d/%y"):
            try:
                return datetime.strptime(cleaned, fmt)
            except Exception:
                pass

        for fmt in ("%b %d %Y", "%B %d %Y", "%d %b %Y", "%d %B %Y"):
            try:
                return datetime.strptime(cleaned.title(), fmt)
            except Exception:
                pass

        for fmt in ("%b %d", "%B %d", "%d %b", "%d %B"):
            try:
                parsed = datetime.strptime(cleaned.title(), fmt)
                return parsed.replace(year=now.year)
            except Exception:
                pass

        return None

    def extract_time_range(self, message: str) -> Dict[str, Any]:
        now = datetime.utcnow()
        text = (message or "").strip().lower()
        start: datetime | None = None
        end: datetime | None = None
        label = "last_45_days"
        explicit = False

        if "today" in text:
            start = datetime(now.year, now.month, now.day)
            end = start + timedelta(days=1)
            label = "today"
            explicit = True
        elif "yesterday" in text:
            end = datetime(now.year, now.month, now.day)
            start = end - timedelta(days=1)
            label = "yesterday"
            explicit = True
        elif "this week" in text:
            start = datetime(now.year, now.month, now.day) - timedelta(days=now.weekday())
            end = now
            label = "this_week"
            explicit = True
        elif "last week" in text or "previous week" in text:
            end = now
            start = now - timedelta(days=7)
            label = "last_week"
            explicit = True
        elif "last two week" in text or "last 2 week" in text or "past 2 week" in text:
            end = now
            start = now - timedelta(days=14)
            label = "last_2_weeks"
            explicit = True
        elif "this month" in text:
            start = datetime(now.year, now.month, 1)
            end = now
            label = "this_month"
            explicit = True
        elif "last month" in text or "previous month" in text:
            current_month_start = datetime(now.year, now.month, 1)
            prev_month_anchor = current_month_start - timedelta(days=1)
            start = datetime(prev_month_anchor.year, prev_month_anchor.month, 1)
            end = current_month_start
            label = "last_month"
            explicit = True
        else:
            match = re.search(r"last\s+(\d+)\s+(day|days|week|weeks|month|months)", text)
            if match:
                value = int(match.group(1))
                unit = match.group(2)
                days = value
                if "week" in unit:
                    days = value * 7
                elif "month" in unit:
                    days = value * 30
                end = now
                start = now - timedelta(days=days)
                label = f"last_{value}_{unit}"
                explicit = True

        date_tokens = re.findall(
            r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{2,4})?)\b",
            text,
            flags=re.IGNORECASE,
        )
        parsed_dates: List[datetime] = []
        for token in date_tokens[:3]:
            parsed = self._try_parse_date_token(token, now=now)
            if parsed:
                parsed_dates.append(parsed)

        if len(parsed_dates) >= 2:
            parsed_dates.sort()
            start = datetime(parsed_dates[0].year, parsed_dates[0].month, parsed_dates[0].day)
            end = datetime(parsed_dates[1].year, parsed_dates[1].month, parsed_dates[1].day) + timedelta(days=1)
            label = "custom_date_range"
            explicit = True
        elif len(parsed_dates) == 1:
            only = parsed_dates[0]
            start = datetime(only.year, only.month, only.day)
            end = start + timedelta(days=1)
            label = "single_date"
            explicit = True

        if not start or not end:
            start = now - timedelta(days=45)
            end = now

        return {
            "explicit": explicit,
            "label": label,
            "start_iso": start.isoformat(),
            "end_iso": end.isoformat(),
            "window_days": max(1, int((end - start).total_seconds() // 86400)),
        }

    def finance_query_focus(self, message: str) -> Dict[str, Any]:
        text = (message or "").strip().lower()
        focus: List[str] = []
        explicit_cashflow = any(token in text for token in ["net cashflow", "cashflow", "cash flow", "income vs expense"])
        rules = [
            ("cashflow", ["cash flow", "cashflow", "income vs expense"]),
            ("spending_trend", ["trend", "month over month", "pattern"]),
            ("category_breakdown", ["category", "breakdown", "where i spend", "spent most"]),
            ("anomalies", ["anomaly", "unusual", "outlier", "suspicious", "unexpected"]),
            ("velocity_7d", ["last 7 days", "weekly", "this week", "velocity"]),
            ("savings_actions", ["save", "reduce", "cut", "optimize", "improve"]),
            ("goal_progress", ["goal", "target", "progress"]),
            ("education", ["what is", "meaning", "explain"]),
            ("transaction_summary", ["transaction", "transactions", "summary", "history", "debit", "credit"]),
        ]
        for name, keys in rules:
            if any(key in text for key in keys):
                focus.append(name)

        if not focus:
            focus = ["savings_actions"]

        time_range = self.extract_time_range(message)
        if bool(time_range.get("explicit")) and "transaction_summary" not in focus:
            focus.append("transaction_summary")

        money_hits = re.findall(r"(?:rs\.?|inr|\$|\u20B9)\s*([0-9]+(?:\.[0-9]+)?)", text, flags=re.IGNORECASE)
        return {
            "focus": focus[:5],
            "explicit_cashflow_request": explicit_cashflow,
            "time_range": time_range,
            "has_amount_constraint": bool(money_hits),
            "amount_values": [float(match) for match in money_hits[:4]],
        }

    async def store_feedback_memory(self, user_id: str, text: str, tags: List[str]) -> Dict[str, Any]:
        payload = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "text": text.strip()[:500],
            "tags": tags[:20],
            "source": "assistant_feedback",
            "created_at": datetime.utcnow(),
        }
        await self.db.assistant_memories.insert_one(payload)
        return payload
