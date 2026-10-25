"""Vercel entry point: exposes the FastAPI app that lives in backend/.

Docker, Heroku and local development do not use this file (they run `app.main:app` from backend/).
"""
from backend.app.main import app  # noqa: F401
