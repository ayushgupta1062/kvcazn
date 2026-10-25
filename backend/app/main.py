"""FastAPI app: JSON API under /api, the built React UI served from /."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import date
from functools import lru_cache
from typing import Annotated, Literal

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from . import analysis, config, schemas, store

log = logging.getLogger("uvicorn.error")

DEFAULT_CUTOFF = config.DEFAULT_CUTOFF.strftime("%H:%M")
ALIGNMENTS = [
    {"value": "exact", "label": "Same timestamp"},
    {"value": "hourly_mean", "label": "Hourly average"},
]

CutoffParam = Annotated[str, Query(pattern=r"^\d{2}:\d{2}$", description="Decision cut-off, UK local time HH:MM")]
AlignmentParam = Annotated[Literal["exact", "hourly_mean"], Query(description="How actuals are matched to forecasts")]


@asynccontextmanager
async def lifespan(_: FastAPI):
    ds = store.get_dataset()  # fails fast if there is no data and REQUIRE_REAL_DATA is set
    log.info("Data source: %s (%d forecast rows, %d actual rows)", "synthetic" if ds.is_synthetic else "elexon",
             len(ds.forecasts), len(ds.actuals))
    yield


app = FastAPI(title="Wind Forecast Decision Portal", version="1.0.0", lifespan=lifespan)


def _canonical_cutoff(text: str) -> str:
    try:
        return analysis.parse_cutoff(text).strftime("%H:%M")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@lru_cache(maxsize=64)
def _table(cutoff: str, alignment: str) -> pd.DataFrame:
    return analysis.decision_table(store.get_dataset(), analysis.parse_cutoff(cutoff), alignment)


@app.get("/api/health")
def health() -> dict:
    ds = store.get_dataset()
    return {"status": "ok", "dataSource": "synthetic" if ds.is_synthetic else "elexon"}


@app.get("/api/meta", response_model=schemas.Meta)
def meta() -> dict:
    ds = store.get_dataset()
    return {
        "data_source": "synthetic" if ds.is_synthetic else "elexon",
        "fetched_at_utc": ds.manifest.get("fetchedAtUtc"),
        "timezone": str(config.MARKET_TZ),
        "decision_start": config.DECISION_START,
        "decision_end": config.DECISION_END,
        "days_before": config.DAYS_BEFORE,
        "default_cutoff": DEFAULT_CUTOFF,
        "cutoff_presets": list(config.CUTOFF_PRESETS),
        "alignments": ALIGNMENTS,
        "decision_days": [
            {"decision_date": d, "delivery_date": analysis.delivery_date_for(d)} for d in analysis.decision_dates()
        ],
        "actual_rows": len(ds.actuals),
        "forecast_rows": len(ds.forecasts),
        "forecast_versions": int(ds.forecasts["publishTime"].nunique()),
    }


@app.get("/api/decision", response_model=schemas.DecisionView)
def decision(
    decision_date: Annotated[date, Query(alias="decisionDate", description="Day the purchase is decided (D-1)")],
    cutoff: CutoffParam = DEFAULT_CUTOFF,
    alignment: AlignmentParam = "exact",
) -> dict:
    if not config.DECISION_START <= decision_date <= config.DECISION_END:
        raise HTTPException(422, f"decisionDate must be between {config.DECISION_START} and {config.DECISION_END}")
    cutoff = _canonical_cutoff(cutoff)
    try:
        return analysis.decision_view(
            store.get_dataset(), _table(cutoff, alignment), decision_date, analysis.parse_cutoff(cutoff)
        )
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/accuracy", response_model=schemas.AccuracyReport)
def accuracy(cutoff: CutoffParam = DEFAULT_CUTOFF, alignment: AlignmentParam = "exact") -> dict:
    cutoff = _canonical_cutoff(cutoff)
    try:
        report = analysis.accuracy_report(store.get_dataset(), _table(cutoff, alignment), alignment)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"cutoff": cutoff, "alignment": alignment, **report}


# Mounted last so /api/* wins. Only present in the Docker image / after `npm run build`.
if config.STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=config.STATIC_DIR, html=True), name="ui")
