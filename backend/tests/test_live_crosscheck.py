"""Cross-check the app against the real Elexon API.

Independently of ``app.elexon`` and ``app.analysis``, this test fetches raw
WINDFOR and FUELHH JSON, picks the forecast each delivery hour should use with
a plain loop, and asserts that ``/api/decision`` and ``/api/accuracy`` return
the same numbers.

Skipped unless ``RUN_LIVE=1``: pytest should stay green offline.
"""
from __future__ import annotations

import json
import os
import statistics
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app

BASE = "https://data.elexon.co.uk/bmrs/api/v1"
UTC = timezone.utc
TOLERANCE_MW = 0.5

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE", "0") != "1",
    reason="live cross-check hits the real Elexon API; set RUN_LIVE=1 to run",
)


# ------------------------------- helpers -------------------------------

def _z(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _get(client: httpx.Client, path: str, params: dict) -> list[dict]:
    r = client.get(path, params=params, timeout=60)
    r.raise_for_status()
    data = r.json()
    assert isinstance(data, list)
    return data


def _parse_iso(s: str) -> datetime:
    # Elexon returns ``...Z``; make it tz-aware.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def _fetch_windfor_window(client: httpx.Client, pub_from: datetime, pub_to: datetime) -> list[dict]:
    """Fetch WINDFOR in one-day chunks and concatenate."""
    rows: list[dict] = []
    cursor = pub_from
    while cursor < pub_to:
        nxt = min(cursor + timedelta(days=1), pub_to)
        rows += _get(
            client,
            "/datasets/WINDFOR/stream",
            {"publishDateTimeFrom": _z(cursor), "publishDateTimeTo": _z(nxt), "format": "json"},
        )
        cursor = nxt
    return rows


def _fetch_fuelhh_wind_day(client: httpx.Client, day: date) -> list[dict]:
    rows = _get(
        client,
        "/datasets/FUELHH/stream",
        {
            "settlementDateFrom": day.isoformat(),
            "settlementDateTo": day.isoformat(),
            "fuelType": "WIND",
            "format": "json",
        },
    )
    # The API also returns non-WIND fuel types when fuelType filter is honoured, but
    # we double-check in Python so this test does not depend on server-side filtering.
    return [r for r in rows if r.get("fuelType") == "WIND"]


def _pick_forecast_for_hour(windfor_rows: list[dict], delivery_hour: datetime, gate: datetime) -> dict:
    """Plain loop: newest publishTime <= gate with startTime == delivery_hour."""
    best: dict | None = None
    best_pub: datetime | None = None
    for row in windfor_rows:
        pub = _parse_iso(row["publishTime"])
        start = _parse_iso(row["startTime"])
        if start != delivery_hour or pub > gate:
            continue
        if best_pub is None or pub > best_pub:
            best_pub, best = pub, row
    assert best is not None, f"no forecast for {delivery_hour} at gate {gate}"
    return best


def _actual_at(fuelhh_rows: list[dict], delivery_half_hour: datetime) -> float:
    """FUELHH half-hour value at exactly this startTime."""
    for row in fuelhh_rows:
        if _parse_iso(row["startTime"]) == delivery_half_hour:
            return float(row["generation"])
    raise AssertionError(f"no FUELHH row at {delivery_half_hour}")


# ------------------------------- cache ---------------------------------

CACHE = Path(os.environ.get("LIVE_CACHE", Path(__file__).parent / ".live_cache"))


def _cached(name: str, fetch):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if path.exists():
        return json.loads(path.read_text())
    data = fetch()
    path.write_text(json.dumps(data))
    return data


# ------------------------------- tests ---------------------------------

DECISION_DAYS = [date(2026, 1, 1), date(2026, 1, 14), date(2026, 1, 31)]
GATES = ["09:20", "09:50"]


@pytest.fixture(scope="module")
def http_client():
    with httpx.Client(base_url=BASE, timeout=60) as c:
        yield c


@pytest.fixture(scope="module")
def api_client():
    return TestClient(app)


@pytest.mark.live
@pytest.mark.parametrize("decision_date", DECISION_DAYS)
@pytest.mark.parametrize("gate_hhmm", GATES)
def test_decision_matches_raw(http_client, api_client, decision_date, gate_hhmm):
    delivery_date = decision_date + timedelta(days=1)
    hh, mm = (int(x) for x in gate_hhmm.split(":"))
    gate = datetime.combine(decision_date, time(hh, mm), tzinfo=UTC)

    # Fetch raw WINDFOR from 3 days before the decision day up to the day after it.
    windfor_rows = _cached(
        f"windfor_{decision_date.isoformat()}.json",
        lambda: _fetch_windfor_window(
            http_client,
            datetime.combine(decision_date - timedelta(days=3), time(0, 0), tzinfo=UTC),
            datetime.combine(decision_date + timedelta(days=1), time(23, 59, 59), tzinfo=UTC),
        ),
    )
    # Fetch raw FUELHH for the delivery day (plus the first half-hour of the day after,
    # because startTime 23:30 of day D belongs to settlement date D in the API).
    fuelhh_rows = _cached(
        f"fuelhh_{delivery_date.isoformat()}.json",
        lambda: _fetch_fuelhh_wind_day(http_client, delivery_date),
    )

    # Independent expectation per delivery hour.
    expected: dict[datetime, dict] = {}
    for hour in range(24):
        delivery_hour = datetime.combine(delivery_date, time(hour), tzinfo=UTC)
        f_row = _pick_forecast_for_hour(windfor_rows, delivery_hour, gate)
        actual_mw = _actual_at(fuelhh_rows, delivery_hour)
        expected[delivery_hour] = {
            "forecast_mw": float(f_row["generation"]),
            "publish_time": _parse_iso(f_row["publishTime"]),
            "actual_mw": actual_mw,
            "error_mw": float(f_row["generation"]) - actual_mw,
        }

    # Ask the app.
    r = api_client.get(
        "/api/decision",
        params={
            "decisionDate": decision_date.isoformat(),
            "cutoff": gate_hhmm,
            "alignment": "exact",
        },
    )
    assert r.status_code == 200, r.text
    points = r.json()["points"]
    assert len(points) == 24

    for p in points:
        start = _parse_iso(p["startTime"])
        want = expected[start]
        assert abs(p["forecastMw"] - want["forecast_mw"]) < TOLERANCE_MW, (start, p, want)
        assert _parse_iso(p["publishTime"]) == want["publish_time"], (start, p, want)
        assert abs(p["actualMw"] - want["actual_mw"]) < TOLERANCE_MW, (start, p, want)
        assert abs(p["errorMw"] - want["error_mw"]) < TOLERANCE_MW, (start, p, want)


@pytest.mark.live
def test_overall_mae_and_bias_match(http_client, api_client):
    """Independent monthly MAE/bias at 09:50 must match /api/accuracy."""
    gate_hhmm = "09:50"

    # One big WINDFOR fetch for the whole publish window, cached.
    windfor_rows = _cached(
        "windfor_full_january.json",
        lambda: _fetch_windfor_window(
            http_client,
            datetime(2025, 12, 31, 0, 0, tzinfo=UTC),
            datetime(2026, 2, 2, 0, 0, tzinfo=UTC),
        ),
    )

    # FUELHH for every delivery day 2 Jan..1 Feb.
    fuelhh_by_day: dict[date, list[dict]] = {}
    for i in range(31):
        day = date(2026, 1, 2) + timedelta(days=i)
        fuelhh_by_day[day] = _cached(
            f"fuelhh_{day.isoformat()}.json",
            lambda d=day: _fetch_fuelhh_wind_day(http_client, d),
        )

    errors: list[float] = []
    for i in range(31):
        decision_date = date(2026, 1, 1) + timedelta(days=i)
        delivery_date = decision_date + timedelta(days=1)
        gate = datetime.combine(decision_date, time(9, 50), tzinfo=UTC)
        rows = fuelhh_by_day[delivery_date]
        for hour in range(24):
            delivery_hour = datetime.combine(delivery_date, time(hour), tzinfo=UTC)
            f_row = _pick_forecast_for_hour(windfor_rows, delivery_hour, gate)
            actual_mw = _actual_at(rows, delivery_hour)
            errors.append(float(f_row["generation"]) - actual_mw)

    assert len(errors) == 744
    mae_expected = statistics.fmean(abs(e) for e in errors)
    bias_expected = statistics.fmean(errors)

    r = api_client.get("/api/accuracy", params={"cutoff": gate_hhmm, "alignment": "exact"})
    assert r.status_code == 200, r.text
    overall = r.json()["overall"]
    assert overall["n"] == 744
    assert abs(overall["mae"] - mae_expected) < TOLERANCE_MW, (overall["mae"], mae_expected)
    assert abs(overall["bias"] - bias_expected) < TOLERANCE_MW, (overall["bias"], bias_expected)


@pytest.mark.live
def test_sanity_anchors(http_client):
    """The anchor numbers in the prompt must be real.

    First check them in the raw API, then (implicitly) via the decision test
    that the app matches them.
    """
    windfor_rows = _cached(
        "windfor_2026-01-14.json",
        lambda: _fetch_windfor_window(
            http_client,
            datetime(2026, 1, 11, 0, 0, tzinfo=UTC),
            datetime(2026, 1, 15, 23, 59, 59, tzinfo=UTC),
        ),
    )
    fuelhh_15 = _cached(
        "fuelhh_2026-01-15.json",
        lambda: _fetch_fuelhh_wind_day(http_client, date(2026, 1, 15)),
    )

    # Forecast values at the three stated versions.
    def forecast(version_hhmm: str, delivery_hour_utc: int) -> int:
        hh, mm = (int(x) for x in version_hhmm.split(":"))
        pub = datetime(2026, 1, 14, hh, mm, tzinfo=UTC)
        start = datetime(2026, 1, 15, delivery_hour_utc, 0, tzinfo=UTC)
        for row in windfor_rows:
            if _parse_iso(row["publishTime"]) == pub and _parse_iso(row["startTime"]) == start:
                return int(row["generation"])
        raise AssertionError(f"no WINDFOR row for {pub} {start}")

    def actual(hour_utc: int, half: int = 0) -> int:
        want = datetime(2026, 1, 15, hour_utc, 30 if half else 0, tzinfo=UTC)
        for row in fuelhh_15:
            if _parse_iso(row["startTime"]) == want:
                return int(row["generation"])
        raise AssertionError(f"no FUELHH row for {want}")

    # Prompt's table (verify every cell independently).
    assert forecast("07:30", 0) == 15834
    assert forecast("09:30", 0) == 15828
    assert forecast("11:30", 0) == 15813
    assert forecast("07:30", 6) == 14017
    assert forecast("09:30", 6) == 14103
    assert forecast("11:30", 6) == 14223
    assert forecast("07:30", 12) == 11049
    assert forecast("09:30", 12) == 11178
    assert forecast("11:30", 12) == 11351
    assert forecast("07:30", 18) == 8962
    assert forecast("09:30", 18) == 9053
    assert forecast("11:30", 18) == 9151
    assert actual(0) == 14602
    assert actual(6) == 13256
    assert actual(12) == 9742
    assert actual(18) == 7672
    assert actual(0, half=1) == 14311
    assert actual(23, half=1) == 7407
