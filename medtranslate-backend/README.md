# MedTranslate Backend

FastAPI backend for research-grade clinical translation evaluation.

All translations and metric computations run server-side. The frontend never calls OpenAI directly and never computes BLEU, METEOR, or BERTScore.

## Quick Start

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Download NLTK data
python -m nltk.downloader wordnet omw-1.4 punkt punkt_tab

# Set environment variables
cp .env.example .env
# Edit .env with your OPENAI_API_KEY

# Run the server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Docker

```bash
docker build -t medtranslate-backend .
docker run -p 8000:8000 -e OPENAI_API_KEY=sk-... medtranslate-backend
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/jobs` | Submit CSV + config, returns `job_id` |
| GET | `/v1/jobs/{job_id}` | Poll job status and progress |
| GET | `/v1/jobs/{job_id}/results` | Get full results with metrics |

## Deployment (Render)

1. Create a new Web Service on Render
2. Connect to this repository
3. Set the root directory to `medtranslate-backend`
4. Set environment: Docker
5. Add environment variable: `OPENAI_API_KEY`
6. Add `CORS_ORIGINS` with your Vercel frontend URL
