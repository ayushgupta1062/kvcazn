# AGENTS.md

Guidance for AI coding tools (Cursor, Claude Code, Codex, …) working in this repository. Humans: see `README.md`.

## What this is

A day-ahead wind desk for a UK energy buyer. FastAPI + pandas backend (`backend/`), React + Vite + TypeScript frontend (`frontend/`), shipped as one Docker image. Data: Elexon FUELHH (actual wind) and WINDFOR (forecast wind) only, for purchase decisions made in January 2026. Design record: `docs/DECISIONS.md`.

## Commands

```bash
make install        # backend venv + frontend packages
make test           # pytest + vitest  (must stay green)
make data           # download the Elexon snapshot into backend/data/snapshot
make api / make ui  # dev servers on :8000 and :5173
make docker         # production image on :8000
cd frontend && npx tsc --noEmit    # type check (also part of `npm run build`)
cd qa && BASE_URL=http://localhost:8000 node interact.cjs   # browser checks against a running app (setup: qa/README.md)
```

## Invariants: change one only with a failing test written first

1. **Which forecast counts.** For delivery hour T of day D and gate G on D−1 (UK local time): the WINDFOR row with `startTime = T` and the newest `publishTime ≤ G` (inclusive); if the newest version has no row for T, the next newest that does. Never use a version published after the gate. (`analysis.select_decision_forecast`, tested against a brute-force recomputation.)
2. **Sign.** `error = forecast − actual`. Positive means over-forecast, i.e. the desk bought too little.
3. **Real data only in production.** The Docker image sets `REQUIRE_REAL_DATA=1` and must fail to start without `backend/data/snapshot/manifest.json`. Synthetic data (`demo_data.py`) is for tests and local development and is always flagged in the UI. Never commit a synthetic snapshot.
4. **Elexon only.** No other data source, no demand or price data. User-entered numbers are fine.
5. **All assumptions live in `backend/app/config.py`** and are explained in `docs/DECISIONS.md`.
6. **Anonymous repository.** No personal names, emails, company names or machine paths in files, commit messages or git config.

## Conventions

- Python 3.12, pandas 3 (timestamps are tz-aware `datetime64[ns, UTC]`; do not use chained assignment). Keep `analysis.py` free of web code.
- `requirements.txt` at the repo root (read by Vercel) must stay identical to `backend/requirements.txt` (read by Docker). Change both; CI diffs them.
- API JSON is camelCase (`schemas.py`); the TypeScript types in `frontend/src/types.ts` mirror it by hand, so change both together.
- Clock times shown to users are UK local, 24-hour. Format through `frontend/src/format.ts`.
- Forecast is always blue (`--forecast`), actual always orange (`--actual`); greys for context. One y-axis per chart. Every chart has a table twin (`ChartFrame`).
- Plain-language copy: sentence case, no jargon without a gloss, numbers with units.
- A number that appears in the UI should be traceable to a test or to the table view of the same chart.

## Before you finish a change

`make test`, `cd frontend && npm run build`, then look at the page in a browser (light and dark, 1280 px and 390 px wide) when the change touches the UI.
