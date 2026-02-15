from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
import uuid

from pydantic import BaseModel, Field


class AssistantSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    language: str = "English"
    status: Literal["active", "closed"] = "active"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_activity_at: datetime = Field(default_factory=datetime.utcnow)
    message_count: int = 0


class AssistantMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    session_id: str
    role: Literal["user", "assistant", "system"]
    content: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AssistantSessionStartRequest(BaseModel):
    user_id: str
    language: Optional[str] = "English"
    existing_session_id: Optional[str] = None


class AssistantSessionStartResponse(BaseModel):
    session_id: str
    reused: bool = False
    language: str


class AssistantChatRequest(BaseModel):
    user_id: str
    message: str
    session_id: Optional[str] = None
    language: Optional[str] = "English"


class AssistantCitation(BaseModel):
    source: str
    snippet: str
    score: float


class AssistantChatResponse(BaseModel):
    session_id: str
    response: str
    agent_trace: List[str] = Field(default_factory=list)
    citations: List[AssistantCitation] = Field(default_factory=list)


class AssistantMemoryUpsertRequest(BaseModel):
    user_id: str
    text: str
    tags: List[str] = Field(default_factory=list)
    source: str = "user_memory"


class AssistantKnowledgeUpsertRequest(BaseModel):
    title: str
    text: str
    source: str = "knowledge_base"
    tags: List[str] = Field(default_factory=list)
