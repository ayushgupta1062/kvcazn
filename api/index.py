"""Vercel entry point: exposes the FastAPI app that lives in backend/.

Docker, Heroku and local development do not use this file (they run `app.main:app` from backend/).

Vercel's current Python runtime requires serverless functions to live under `api/`;
rewrites in `vercel.json` route every other path to this function so the FastAPI app
can serve both the JSON API under `/api/*` and the built React UI from `/`.
"""
from backend.app.main import app  # noqa: F401
