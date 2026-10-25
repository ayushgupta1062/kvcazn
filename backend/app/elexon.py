"""Thin client for the two Elexon datasets this project uses (FUELHH actuals, WINDFOR forecasts)."""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta

import httpx
import pandas as pd

ACTUAL_COLUMNS = ["startTime", "generation"]
FORECAST_COLUMNS = ["publishTime", "startTime", "generation"]
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class ElexonError(RuntimeError):
    pass


def utc_series(values) -> pd.Series:
    """Parse ISO timestamps to tz-aware UTC with one fixed resolution (keeps merges predictable)."""
    return pd.to_datetime(values, utc=True).astype("datetime64[ns, UTC]")


def get_json(client: httpx.Client, path: str, params: dict, retries: int = 4, backoff: float = 1.6) -> list[dict]:
    """GET a stream endpoint, retrying transient failures. Returns the JSON array."""
    for attempt in range(1, retries + 1):
        try:
            resp = client.get(path, params=params)
        except httpx.TransportError as exc:
            problem = f"{type(exc).__name__}: {exc}"
        else:
            if resp.status_code in RETRYABLE_STATUS:
                problem = f"HTTP {resp.status_code}"
            elif resp.is_success:
                payload = resp.json()
                if not isinstance(payload, list):
                    raise ElexonError(f"Expected a JSON array from {path}, got {type(payload).__name__}")
                return payload
            else:
                raise ElexonError(f"HTTP {resp.status_code} from {path} {params}: {resp.text[:300]}")
        if attempt == retries:
            raise ElexonError(f"Giving up on {path} {params}: {problem}")
        time.sleep(backoff**attempt)
    raise AssertionError("unreachable")


def normalise_actuals(rows: list[dict]) -> pd.DataFrame:
    """FUELHH rows -> one WIND value per half-hour (startTime, generation in MW)."""
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame({"startTime": utc_series([]), "generation": pd.Series(dtype=float)})
    if "fuelType" in df:
        df = df[df["fuelType"] == "WIND"]
    if "publishTime" in df:  # if a half-hour was re-published, keep the latest
        df = df.assign(_pub=utc_series(df["publishTime"])).sort_values("_pub")
    df = df.assign(startTime=utc_series(df["startTime"]), generation=pd.to_numeric(df["generation"], errors="coerce"))
    df = df.dropna(subset=["generation"]).drop_duplicates("startTime", keep="last")
    return df[ACTUAL_COLUMNS].sort_values("startTime").reset_index(drop=True)


def normalise_forecasts(rows: list[dict]) -> pd.DataFrame:
    """WINDFOR rows -> one value per (publishTime, startTime)."""
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(
            {"publishTime": utc_series([]), "startTime": utc_series([]), "generation": pd.Series(dtype=float)}
        )
    df = df.assign(
        publishTime=utc_series(df["publishTime"]),
        startTime=utc_series(df["startTime"]),
        generation=pd.to_numeric(df["generation"], errors="coerce"),
    )
    df = df.dropna(subset=["generation"]).drop_duplicates(["publishTime", "startTime"], keep="last")
    return df[FORECAST_COLUMNS].sort_values(["publishTime", "startTime"]).reset_index(drop=True)


def _iso_z(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_actual_wind(client: httpx.Client, first_day: date, last_day: date, chunk_days: int = 7) -> pd.DataFrame:
    """Actual wind generation for settlement dates first_day..last_day inclusive."""
    rows: list[dict] = []
    day = first_day
    while day <= last_day:
        chunk_end = min(day + timedelta(days=chunk_days - 1), last_day)
        rows += get_json(
            client,
            "/datasets/FUELHH/stream",
            {"settlementDateFrom": day.isoformat(), "settlementDateTo": chunk_end.isoformat(),
             "fuelType": "WIND", "format": "json"},
        )
        day = chunk_end + timedelta(days=1)
    return normalise_actuals(rows)


def fetch_wind_forecasts(
    client: httpx.Client, publish_from: datetime, publish_to: datetime, chunk: timedelta = timedelta(days=1)
) -> pd.DataFrame:
    """Every forecast version published in [publish_from, publish_to), naive datetimes = UTC."""
    rows: list[dict] = []
    start = publish_from
    while start < publish_to:
        end = min(start + chunk, publish_to)
        rows += get_json(
            client,
            "/datasets/WINDFOR/stream",
            {"publishDateTimeFrom": _iso_z(start), "publishDateTimeTo": _iso_z(end), "format": "json"},
        )
        start = end
    return normalise_forecasts(rows)
