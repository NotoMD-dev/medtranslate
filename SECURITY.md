# Security

This document describes the security posture of MedTranslate, including API key management, data handling, and deployment considerations.

---

## Overview

MedTranslate is a **research tool** designed for individual researchers and small clinical teams. The two-service architecture (Next.js frontend + FastAPI backend) separates concerns: the frontend handles UI and CSV parsing; the backend handles API keys, XLSX parsing, translations, and metrics.

---

## API Key Management

### No API Keys Client-Side

The OpenAI API key is configured as an environment variable on the backend server only. It is:

- **Never included** in the frontend bundle
- **Never transmitted** to the browser
- **Never logged** in API responses

The frontend communicates with the backend via REST API calls. The backend then calls OpenAI on behalf of the frontend.

### Backend Environment Variables

| Variable | Storage Location | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Backend `.env` / Render environment | Authenticate with OpenAI API |
| `CORS_ORIGINS` | Backend `.env` / Render environment | Restrict frontend origins |

### Frontend Environment Variables

| Variable | Storage Location | Contains Secrets |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | Frontend `.env` / Vercel environment | No — just a URL |

---

## HTTPS Required

All communication must use HTTPS in production:

| Connection | Protocol | Notes |
|---|---|---|
| User → Frontend (Vercel) | HTTPS | Provided by Vercel |
| Frontend → Backend (Render) | HTTPS | Provided by Render |
| Backend → OpenAI API | HTTPS | Required by OpenAI |

---

## File Upload Security

### XLSX Vulnerability Fix

Client-side XLSX parsing was identified as a **high-severity vulnerability**. The `xlsx` (SheetJS) npm package used for browser-side Excel parsing had known security issues. This was resolved by:

1. **Removing** the `xlsx` npm dependency from the frontend
2. **Moving** all Excel parsing to the backend using `openpyxl` (Python)
3. The frontend now sends raw XLSX files to the backend via multipart upload
4. The backend validates and parses XLSX files server-side in a controlled environment

### File Type Validation

| Layer | Validation |
|---|---|
| Frontend | File extension check (`.csv`, `.xlsx`) before upload |
| Backend | File format validation; rejects unsupported types with `400 Bad Request` |

### CSV Parsing

- Frontend: PapaParse for CSV files (client-side, safe string parsing)
- Backend: pandas/csv for CSV files (server-side validation)
- Required column `spanish_source` validated on both sides

---

## No Persistent PHI Storage

### Backend

The backend uses an **in-memory job store**. Job data exists only while the server process is running. There is:

- No database
- No persistent file storage
- No disk writes of clinical text

When the server restarts, all job data is cleared.

### Frontend

Clinical text is stored in the browser's `localStorage` and `IndexedDB`. This is:

- Local to the user's machine
- Cleared when the user clicks "Remove file" or clears browser data
- Not transmitted anywhere except to the backend for translation

### LLM Provider

Clinical text is sent to OpenAI for translation. This is subject to OpenAI's data retention policy. Researchers handling PHI should:

1. Establish a BAA with OpenAI
2. Verify dataset de-identification before uploading
3. Consider using the offline Python scripts in a controlled environment

---

## Log Scrubbing

The backend logs job progress (job ID, row counts, error types) but does **not** log:

- Clinical text content
- Translation outputs
- API keys or tokens

Error messages from OpenAI API failures may contain partial request information. In production, configure log levels appropriately.

---

## CORS Configuration

The backend uses FastAPI's CORS middleware. By default, only `http://localhost:3000` is allowed. In production, set `CORS_ORIGINS` to your Vercel deployment URL.

```
CORS_ORIGINS=https://your-app.vercel.app
```

---

## No Authentication (Internal Tool)

MedTranslate does not implement user authentication, session tokens, or access control. This is by design for an internal research tool. If deploying to a shared network:

1. Add authentication (basic auth, OAuth, or VPN)
2. Restrict network access to trusted users/IP ranges
3. Use Render's IP allowlisting for the backend

---

## Input Validation

### Frontend

- File type validated by extension (`.csv`, `.xlsx`)
- CSV parsing validates required `spanish_source` column
- Malformed rows are silently skipped

### Backend

- CSV and XLSX files validated for required `spanish_source` column
- Non-CSV/XLSX uploads rejected with `400 Bad Request`
- Empty datasets rejected with `400 Bad Request`
- XLSX parsing uses openpyxl (safe, no macro execution)

---

## Cross-Site Scripting (XSS)

React's default JSX rendering escapes all interpolated values, providing built-in XSS protection. The application does not use `dangerouslySetInnerHTML`.

---

## Client-Side Storage Security

| Store | Data | Risk | Mitigation |
|---|---|---|---|
| localStorage | Dataset text, grades, session metadata | Accessible to same-origin scripts | No third-party scripts loaded besides Vercel Analytics |
| IndexedDB | Full job results, grades backup | Accessible to same-origin scripts | Same-origin policy; cleared on "Remove file" |

Both stores are cleared when the user removes their uploaded file.

---

## Deployment Security Checklist

- [ ] Backend served over HTTPS (Render provides this)
- [ ] Frontend served over HTTPS (Vercel provides this)
- [ ] `OPENAI_API_KEY` set as environment variable, not in code
- [ ] `CORS_ORIGINS` set to production frontend URL only
- [ ] No API keys in frontend bundle (verify with browser dev tools)
- [ ] `xlsx` npm package removed from frontend dependencies
- [ ] XLSX parsing confirmed to run server-side only
- [ ] Consider adding authentication for non-localhost deployments
- [ ] Review OpenAI data retention policy if handling PHI
- [ ] Run `npm audit fix` before deployment
