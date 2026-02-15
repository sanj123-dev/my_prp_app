from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from typing import Any, Dict, Iterable, List
import re


TOKEN_RE = re.compile(r"[a-zA-Z0-9]+")


@dataclass
class SemanticDoc:
    source: str
    text: str
    metadata: Dict[str, Any]


class SimpleSemanticSearch:
    """
    Lightweight semantic-ish retrieval using hashed bag-of-words + cosine similarity.
    Useful when you want zero extra vector DB infrastructure.
    """

    def __init__(self, dims: int = 512) -> None:
        self.dims = dims

    def _tokenize(self, text: str) -> List[str]:
        return TOKEN_RE.findall((text or "").lower())

    def _embed(self, text: str) -> List[float]:
        vec = [0.0] * self.dims
        for token in self._tokenize(text):
            slot = hash(token) % self.dims
            vec[slot] += 1.0
        norm = sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def _cosine(self, a: List[float], b: List[float]) -> float:
        return float(sum(x * y for x, y in zip(a, b)))

    def search(self, query: str, docs: Iterable[SemanticDoc], limit: int = 5) -> List[Dict[str, Any]]:
        query_vec = self._embed(query)
        scored: List[Dict[str, Any]] = []
        for doc in docs:
            text = (doc.text or "").strip()
            if not text:
                continue
            score = self._cosine(query_vec, self._embed(text))
            scored.append(
                {
                    "score": score,
                    "source": doc.source,
                    "text": text,
                    "metadata": doc.metadata,
                }
            )
        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored[: max(1, limit)]
