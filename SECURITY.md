# Security

This document describes the security posture of MedTranslate, including how sensitive data is handled, API key management, data privacy considerations, and known limitations.

---

## Overview

MedTranslate is a **research tool** designed for use by individual researchers and small clinical teams. It is not designed for production clinical deployment or patient-facing use. The security model reflects this scope: it prioritizes simplicity and researcher convenience while maintaining responsible handling of API credentials and clinical data.

---

## API Key Management

### Storage

API keys are stored as environment variables in `.env.local`, which is:

- **Gitignored**: Listed in `.gitignore` to prevent accidental commits.
- **Server-side only**: Environment variables are accessed only in the Next.js API route (`app/api/translate/route.ts`) which runs on the server. They are never exposed to the browser.

### Required Variables

| Variable | Purpose | Needed When |
|---|---|---|
| `OPENAI_API_KEY` | Authenticate with OpenAI Chat Completions API | Using GPT models |
| `ANTHROPIC_API_KEY` | Authenticate with Anthropic Messages API | Using Claude models |

### Template

A `.env.example` file is provided as a template. It does not contain actual keys.

### Validation

The API route checks for the presence of the required key before making external calls. If the key is missing, it returns a `500` error with the message `"OPENAI_API_KEY not configured"` or `"ANTHROPIC_API_KEY not configured"` — without leaking the key value or any partial key information.

---

## Data Handling

### Clinical Text

MedTranslate processes Spanish-English medical text pairs. Depending on the dataset used:

- **ClinSpEn corpus**: Published, publicly available clinical case reports. No PHI (Protected Health Information).
- **UMass EHR pairs**: Described as de-identified electronic health record notes. The original dataset authors performed de-identification prior to publication.

### Data Flow Security

| Stage | Where Data Lives | Persistence |
|---|---|---|
| File upload | Browser memory (React state) | Volatile — lost on page refresh (before session storage) |
| Session storage | `localStorage` in the browser | Persistent until cleared by user or browser |
| Translation API call | In-flight HTTPS request to LLM provider | Transient |
| LLM provider processing | OpenAI or Anthropic servers | Subject to provider's data retention policy |
| CSV export | Downloaded to user's local filesystem | User-controlled |

### No Server-Side Database

MedTranslate does **not** use a server-side database. All application state is stored in the browser's `localStorage`. This means:

- Data does not leave the user's machine except when sent to LLM providers for translation.
- There is no central server storing research data.
- Multiple users on the same machine share `localStorage` per browser origin.
- Clearing browser data will erase all session state.

---

## Network Security

### External API Calls

All calls to LLM providers use HTTPS:

| Provider | Endpoint | Protocol |
|---|---|---|
| OpenAI | `https://api.openai.com/v1/chat/completions` | HTTPS/TLS |
| Anthropic | `https://api.anthropic.com/v1/messages` | HTTPS/TLS |

API keys are transmitted via:
- **OpenAI**: `Authorization: Bearer ${key}` header
- **Anthropic**: `x-api-key: ${key}` header

### No Authentication on the Web UI

The MedTranslate web application itself does **not** implement user authentication, session tokens, or access control. Anyone who can reach the application's URL can use it. This is acceptable for local development (`localhost:3000`) but should be considered if deploying to a shared or public network.

---

## Input Validation

### File Upload

- File type is validated by extension (`.csv`, `.xlsx`, `.xls`).
- CSV parsing (`lib/csv.ts`) validates that the required `spanish_source` column exists.
- XLSX parsing similarly validates the required column.
- Malformed rows (e.g., insufficient columns) are silently skipped during CSV parsing.

### API Route

- The `POST /api/translate` route validates that the `text` field is present and non-empty.
- Invalid or missing `text` returns a `400` status with `{ error: "Missing text" }`.
- The `model` and `systemPrompt` fields are passed through to the LLM provider without additional sanitization. Since these values are set by the researcher (not by external users), this is acceptable in the research context.

### No SQL or Database Injection Surface

MedTranslate does not use a database, so SQL injection is not applicable. There is no server-side data persistence layer to attack.

---

## Cross-Site Scripting (XSS)

React's default JSX rendering escapes all interpolated values, which provides built-in XSS protection for user-supplied text displayed in the UI (Spanish source, English translations, etc.). The application does not use `dangerouslySetInnerHTML` or similar mechanisms.

---

## HIPAA Considerations

MedTranslate is a **research tool** and is **not HIPAA-compliant** in its current form. Key gaps include:

| HIPAA Requirement | Current Status |
|---|---|
| Access controls and user authentication | Not implemented |
| Audit logging | Not implemented |
| Data encryption at rest | Relies on browser localStorage (not encrypted) |
| Data encryption in transit | HTTPS used for API calls; local app served over HTTP in dev |
| Business Associate Agreements (BAAs) | Not established with LLM providers by default |
| De-identification verification | Relies on upstream dataset authors |

### If Using Real Patient Data

If the research dataset contains any PHI (Protected Health Information):

1. **Do not** use the web UI's LLM translation feature without a BAA with the LLM provider (OpenAI and Anthropic both offer BAAs for enterprise accounts).
2. **Do not** deploy the web application on a publicly accessible server without adding authentication.
3. **Consider** using the offline Python scripts (`translate_batch.py`, `compute_all.py`) in a controlled environment rather than the web UI.
4. **Verify** de-identification of all text before uploading.

---

## Dependency Security

### Node.js Dependencies

Key runtime dependencies and their security relevance:

| Package | Version | Risk Surface |
|---|---|---|
| `next` | ^15.1.0 | Framework — keep updated for security patches |
| `react` / `react-dom` | ^19.0.0 | UI rendering — low risk |
| `@anthropic-ai/sdk` | ^0.39.0 | API client — handles credential transmission |
| `openai` | ^4.77.0 | API client — handles credential transmission |
| `papaparse` | ^5.4.1 | CSV parsing — processes uploaded files |
| `xlsx` | ^0.18.5 | XLSX parsing — processes uploaded files |

### Python Dependencies

| Package | Version | Risk Surface |
|---|---|---|
| `nltk` | >= 3.8 | NLP processing — downloads data from NLTK servers |
| `bert-score` | >= 0.3.13 | Metric computation — downloads model weights |
| `torch` | >= 2.0 | ML framework — large dependency tree |
| `pandas` | >= 2.0 | Data processing |

### Recommendations

- Run `npm audit` periodically to check for known vulnerabilities in Node.js dependencies.
- Pin dependency versions in production deployments.
- Review the `xlsx` package for any known CVEs, as it processes potentially untrusted file uploads.

---

## Gitignore and Sensitive Files

The `.gitignore` file prevents the following from being committed:

| Pattern | What It Protects |
|---|---|
| `.env`, `.env.local`, `.env.*.local` | API keys and secrets |
| `data/*.csv`, `data/*.zip` | Research datasets (potentially containing clinical text) |
| `data/clinspen/`, `data/umass_ehr_pairs.txt` | Raw source corpora |
| `node_modules/`, `__pycache__/` | Build artifacts |
| `.next/`, `dist/`, `build/` | Compiled output |

---

## Deployment Security Checklist

If deploying MedTranslate beyond local development:

- [ ] Serve the application over HTTPS (use a reverse proxy or deploy to a platform that provides TLS).
- [ ] Add authentication to the web application (e.g., basic auth, OAuth, or a VPN).
- [ ] Restrict network access to trusted users/IP ranges.
- [ ] Ensure `.env.local` is not accessible via the web server.
- [ ] Review LLM provider data retention policies and establish BAAs if handling PHI.
- [ ] Set `NODE_ENV=production` for the Next.js build.
- [ ] Run `npm audit fix` before deployment.
- [ ] Consider rate limiting the `/api/translate` endpoint to prevent abuse.
