from __future__ import annotations

from typing import Any, Dict

from .orchestrator import AssistantOrchestrator


class AssistantGraph:
    """
    Compatibility wrapper around the new orchestrator pipeline.
    Existing service and router code can keep calling AssistantGraph.run().
    """

    def __init__(self, db: Any, llm: Any) -> None:
        self.orchestrator = AssistantOrchestrator(db=db, llm=llm)

    async def run(
        self,
        *,
        user_id: str,
        session_id: str,
        message: str,
        language: str,
    ) -> Dict[str, Any]:
        initial_state: Dict[str, Any] = {
            "user_id": user_id,
            "session_id": session_id,
            "message": (message or "").strip(),
            "language": (language or "English").strip() or "English",
            "agent_trace": [],
            "citations": [],
        }
        return await self.orchestrator.run(initial_state)

