"""Standalone worker entry point.

For the MVP, the FastAPI app runs background jobs via asyncio tasks in
the same process.  This module exists as a placeholder for future
separation of concerns (e.g., using Celery or a dedicated worker
process with Redis-backed job queues).

To run the API server:
    uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
