# Learn Quiz Bank Docs

File: `backend/docs/learn_quiz_bank.json`

## JSON format
Each item must have:
- `id`: unique string
- `question`: question text
- `options`: array of at least 2 options
- `correct_index`: zero-based index into `options`

## Example
```json
{
  "id": "quiz-example",
  "question": "What is diversification?",
  "options": ["One stock only", "Spreading risk", "Timing market daily"],
  "correct_index": 1
}
```

## Notes
- If items are invalid, they are skipped.
- Restart backend after editing this file so seed logic can insert new questions.
