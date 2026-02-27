# Multi-Agent Assistant (LangGraph)

This module adds a separate advanced assistant under `/api/assistant/*`.

## Architecture
- `router` agent: classifies intent (`data_query`, `planning`, `education`, `smalltalk`)
- `retriever` agent: semantic retrieval across user memories, knowledge docs, and transactions
- `analyst` agent: builds financial analysis from user snapshot + retrieved context
- `coach` agent: final natural response with actionable guidance

The runtime uses:
- `langgraph` for multi-agent flow/state and session thread memory
- `langchain` prompt composition
- `langchain-openai` with Groq OpenAI-compatible endpoint

## Endpoints
- `POST /api/assistant/session/start`
- `POST /api/assistant/chat`
- `POST /api/assistant/feedback`
- `GET /api/assistant/chat/{user_id}?session_id=...&limit=...`
- `POST /api/assistant/memory/upsert`
- `POST /api/assistant/knowledge/upsert`

## Environment
Required:
- `GROQ_API_KEY`

Optional:
- `GROQ_BASE_URL` (default: `https://api.groq.com/openai/v1`)
- `ASSISTANT_MODEL` (default: `llama-3.3-70b-versatile`)
