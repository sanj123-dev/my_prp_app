from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from .semantic import SemanticDoc, SimpleSemanticSearch


class AssistantTools:
    def __init__(self, db: Any) -> None:
        self.db = db
        self.semantic = SimpleSemanticSearch(dims=512)

    async def financial_snapshot(self, user_id: str, days: int = 45) -> Dict[str, Any]:
        cutoff = datetime.utcnow() - timedelta(days=days)
        docs = await self.db.transactions.find({"user_id": user_id}).to_list(2000)
        recent = [d for d in docs if d.get("date", d.get("created_at", datetime.utcnow())) >= cutoff]

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
