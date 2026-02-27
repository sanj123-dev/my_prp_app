# Multi-Agent Assistant (Orchestrator Pattern)

This module adds a separate advanced assistant under `/api/assistant/*`.

## Architecture
Execution pipeline follows a staged orchestrator flow:

1. `Orchestrator Entry`
2. `Intent Detection Agent`
3. `User State Agent`
4. `Planner Agent`
5. `Clarification Agent` (HITL #1 when required)
6. Specialist execution layer:
   - `Ingestion Agent`
   - `Categorization Agent`
   - `Expense Agent`
   - `Budget Agent` (80/20 model)
   - `Forecasting Agent`
   - `Behaviour Agent`
   - `Sentiment Agent`
   - `Investment Agent` (readiness only, not advice)
   - `Learning Agent`
   - `Financial Health Agent`
7. `Synthesizer Agent`
8. `Human Review Agent` (HITL #2 when required)
9. `Memory Update Agent`
10. `Final Response Agent`

Design notes:
- SOLID-oriented separation: each agent has one focused responsibility.
- Orchestrator coordinates order; agents remain independently testable.
- Dependency injection: `db`, `llm`, and `tools` are passed via shared context.
- Backward compatibility: `AssistantGraph.run()` output contract is unchanged.

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
