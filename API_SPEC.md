# API Specification

This document describes the HTTP API exposed by MedTranslate. The application has a single API endpoint used for translating Spanish clinical text into English via LLM providers.

## Base URL

```
http://localhost:3000   (development)
```

---

## `POST /api/translate`

Translates a single Spanish clinical text string into English using the specified LLM provider.

**Source file**: `app/api/translate/route.ts`

### Request

**Content-Type**: `application/json`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | `string` | Yes | — | The Spanish clinical text to translate |
| `systemPrompt` | `string` | No | *(see below)* | System prompt instructing the LLM on translation behavior |
| `model` | `string` | No | `"gpt-4o"` (OpenAI) or `"claude-sonnet-4-20250514"` (Anthropic) | The LLM model identifier |

**Default system prompt** (used by the UI if not overridden):

```
You are a medical interpreter. Translate the following Spanish clinical text
into English, preserving all medical terminology and clinical meaning.
Output ONLY the English translation, nothing else.
```

### Provider Routing

The API route determines the provider based on the `model` field:

| Condition | Provider | API Endpoint |
|---|---|---|
| `model` starts with `"claude"` | Anthropic | `https://api.anthropic.com/v1/messages` |
| All other values | OpenAI | `https://api.openai.com/v1/chat/completions` |

### Response — Success

**Status**: `200 OK`

```json
{
  "translation": "The patient presents with acute abdominal pain..."
}
```

| Field | Type | Description |
|---|---|---|
| `translation` | `string` | The English translation returned by the LLM |

### Response — Validation Error

**Status**: `400 Bad Request`

Returned when the `text` field is missing or empty.

```json
{
  "error": "Missing text"
}
```

### Response — Configuration Error

**Status**: `500 Internal Server Error`

Returned when the required API key environment variable is not set.

```json
{
  "error": "OPENAI_API_KEY not configured"
}
```

```json
{
  "error": "ANTHROPIC_API_KEY not configured"
}
```

### Response — Provider Error

**Status**: `500 Internal Server Error`

Returned when the upstream LLM API returns a non-OK response.

```json
{
  "error": "OpenAI API error: 429 {\"error\":{\"message\":\"Rate limit exceeded\"}}"
}
```

```json
{
  "error": "Anthropic API error: 400 {\"error\":{\"message\":\"Invalid model\"}}"
}
```

---

## Provider API Details

### OpenAI

The route calls the OpenAI Chat Completions API with the following parameters:

| Parameter | Value |
|---|---|
| `model` | Passed from request (default: `"gpt-4o"`) |
| `temperature` | `0` (deterministic output) |
| `max_tokens` | `1024` |
| `messages[0]` | `{ role: "system", content: systemPrompt }` |
| `messages[1]` | `{ role: "user", content: text }` |

**Authentication**: `Authorization: Bearer ${OPENAI_API_KEY}`

### Anthropic

The route calls the Anthropic Messages API with the following parameters:

| Parameter | Value |
|---|---|
| `model` | Passed from request (default: `"claude-sonnet-4-20250514"`) |
| `max_tokens` | `1024` |
| `system` | `systemPrompt` |
| `messages[0]` | `{ role: "user", content: text }` |

**Authentication**: `x-api-key: ${ANTHROPIC_API_KEY}`, `anthropic-version: 2023-06-01`

---

## Environment Variables

| Variable | Required For | Description |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI models | OpenAI API key (starts with `sk-`) |
| `ANTHROPIC_API_KEY` | Anthropic models | Anthropic API key (starts with `sk-ant-`) |

These must be set in `.env.local` (gitignored). A template is provided in `.env.example`.

---

## Client Usage

The web UI calls this endpoint from `app/translate/page.tsx` during batch translation:

```typescript
const resp = await fetch("/api/translate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    text: row.spanish_source,
    systemPrompt,
    model: "gpt-4o",
  }),
});

const data = await resp.json();
// data.translation contains the English translation
// data.error contains an error message if the request failed
```

Translations are executed sequentially (one row at a time) with no built-in retry logic. The UI tracks success and failure states per row and allows the user to abort the batch at any point.

---

## Rate Limits and Throughput

The API does not implement its own rate limiting. Throughput is constrained by the upstream LLM provider's rate limits:

- **OpenAI**: Varies by plan and model. Typically 500–10,000 RPM for paid accounts.
- **Anthropic**: Varies by tier. Typically 50–4,000 RPM.

The Python batch script (`scripts/translate_batch.py`) includes a configurable `--delay` parameter (default 0.1s) between API calls to help manage rate limits during large-scale offline runs.

---

## Offline Translation Script

For headless batch translation without the web UI, use `scripts/translate_batch.py`:

```bash
python scripts/translate_batch.py \
  --input data/unified_translation_dataset.csv \
  --output data/results_with_translations.csv \
  --model gpt-4o \
  --api openai \
  --delay 0.1 \
  --start 0 \
  --limit 100
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--input` | `string` | *(required)* | Input CSV file path |
| `--output` | `string` | *(required)* | Output CSV file path |
| `--model` | `string` | `"gpt-4o"` | Model name |
| `--api` | `string` | `"openai"` | Provider (`openai` or `anthropic`) |
| `--start` | `int` | `0` | Row index to start from (for resuming) |
| `--limit` | `int` | `None` | Maximum rows to translate |
| `--delay` | `float` | `0.1` | Seconds between API calls |

The script checkpoints progress to the output file every 50 rows, allowing resumption from the last checkpoint if interrupted.
