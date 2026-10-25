"""Pin the real Elexon response shape as of January 2026.

The samples under tests/fixtures/ are a few rows copied verbatim from the live
API, so if Elexon changes its field names or value types the cleaning code
breaks here first instead of silently in production.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from app.elexon import (
    ACTUAL_COLUMNS,
    FORECAST_COLUMNS,
    normalise_actuals,
    normalise_forecasts,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> list[dict]:
    return json.loads((FIXTURES / name).read_text())


def test_fuelhh_wind_raw_shape_parses():
    rows = _load("fuelhh_wind_sample.json")
    # The raw fields the client depends on must all be present.
    expected_keys = {
        "dataset",
        "publishTime",
        "startTime",
        "settlementDate",
        "settlementPeriod",
        "fuelType",
        "generation",
    }
    assert expected_keys.issubset(rows[0].keys())
    assert all(r["fuelType"] == "WIND" for r in rows)
    assert all(r["dataset"] == "FUELHH" for r in rows)

    df = normalise_actuals(rows)
    assert list(df.columns) == ACTUAL_COLUMNS
    assert len(df) == len(rows)
    # Timestamps are tz-aware UTC.
    assert str(df["startTime"].dtype) == "datetime64[ns, UTC]"
    # Generation is numeric and matches one of the raw values.
    assert df["generation"].dtype == float or pd.api.types.is_numeric_dtype(df["generation"])
    assert 15538 in set(df["generation"].astype(int).tolist())


def test_windfor_raw_shape_parses():
    rows = _load("windfor_sample.json")
    expected_keys = {"dataset", "publishTime", "startTime", "generation"}
    assert expected_keys.issubset(rows[0].keys())
    assert all(r["dataset"] == "WINDFOR" for r in rows)

    df = normalise_forecasts(rows)
    assert list(df.columns) == FORECAST_COLUMNS
    assert len(df) == len(rows)
    assert str(df["publishTime"].dtype) == "datetime64[ns, UTC]"
    assert str(df["startTime"].dtype) == "datetime64[ns, UTC]"
    # The 09:30 version is well before its first hour of coverage: the sample's
    # first startTime is 12.5 hours earlier than publishTime, which is the real
    # pattern (the first ~12 hours of every version are in the past).
    row = df.iloc[0]
    delta_h = (row["publishTime"] - row["startTime"]).total_seconds() / 3600.0
    assert delta_h > 0
    # The anchor value from the brief: 09:30 on 14 Jan, startTime 13 Jan 21:00Z.
    assert int(row["generation"]) == 12079
