"""Core analysis: which forecast was available at decision time, and how accurate was it?

Conventions
-----------
* error = forecast - actual, in MW.  Positive = wind was OVER-forecast = the buyer under-procured.
* Timestamps are tz-aware UTC internally.  "Cut-off" and "delivery day" are UK wall-clock time.
* A forecast is usable if it was published at or before the cut-off.
"""
from __future__ import annotations

import math
from datetime import date, datetime, time, timedelta
from typing import Literal

import numpy as np
import pandas as pd

from . import config
from .store import Dataset

Alignment = Literal["exact", "hourly_mean"]

HALF_HOUR = pd.Timedelta(minutes=30)
QUANTILES = (5, 10, 25, 50, 75, 90, 95)
HISTOGRAM_BIN_MW = 500
HORIZON_BUCKET_H = 6
VINTAGE_SPAN_H = 18  # how far either side of the cut-off to show other forecast versions
MIN_BAND_SAMPLES = 30
TABLE_COLUMNS = ["publishTime", "startTime", "forecast", "horizonH", "decisionDate", "deliveryDate", "actual", "error"]


# ---------------------------------------------------------------- time handling
def parse_cutoff(text: str) -> time:
    try:
        return datetime.strptime(text, "%H:%M").time()
    except ValueError as exc:
        raise ValueError(f"cutoff must be HH:MM in 24h time, got {text!r}") from exc


def _local_to_utc(day: date, at: time) -> pd.Timestamp:
    return pd.Timestamp(datetime.combine(day, at, tzinfo=config.MARKET_TZ)).tz_convert("UTC")


def cutoff_utc(decision_date: date, cutoff: time) -> pd.Timestamp:
    return _local_to_utc(decision_date, cutoff)


def local_day_utc(day: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """[local midnight, next local midnight) as UTC - 24h, except on clock-change days."""
    return _local_to_utc(day, time(0)), _local_to_utc(day + timedelta(days=1), time(0))


def delivery_date_for(decision_date: date) -> date:
    return decision_date + timedelta(days=config.DAYS_BEFORE)


def decision_dates() -> list[date]:
    count = (config.DECISION_END - config.DECISION_START).days + 1
    return [config.DECISION_START + timedelta(days=i) for i in range(count)]


def _iso(moment: pd.Timestamp) -> str:
    return moment.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def _num(value) -> float | None:
    value = float(value)
    return value if math.isfinite(value) else None


# ---------------------------------------------------------------- forecast selection
def select_decision_forecast(forecasts: pd.DataFrame, decision_date: date, cutoff: time) -> pd.DataFrame:
    """For each hour of the delivery day: the newest forecast published at or before the cut-off."""
    delivery_date = delivery_date_for(decision_date)
    start, end = local_day_utc(delivery_date)
    cut = cutoff_utc(decision_date, cutoff)
    pool = forecasts[
        (forecasts["startTime"] >= start) & (forecasts["startTime"] < end) & (forecasts["publishTime"] <= cut)
    ]
    latest = pool.sort_values("publishTime").drop_duplicates("startTime", keep="last").sort_values("startTime")
    latest = latest.rename(columns={"generation": "forecast"}).reset_index(drop=True)
    latest["horizonH"] = (latest["startTime"] - latest["publishTime"]).dt.total_seconds() / 3600
    latest["decisionDate"] = decision_date
    latest["deliveryDate"] = delivery_date
    return latest


def actual_series(actuals: pd.DataFrame, alignment: Alignment) -> pd.Series:
    """Actual MW indexed by the timestamp a forecast point would be compared against.

    exact:       the half-hour that starts at that timestamp (no data is invented).
    hourly_mean: mean of the two half-hours that make up the hour starting at that timestamp.
    """
    series = actuals.set_index("startTime")["generation"].sort_index()
    if alignment == "exact":
        return series
    following = series.reindex(series.index + HALF_HOUR)
    following.index = series.index
    return ((series + following) / 2).dropna()


def decision_table(ds: Dataset, cutoff: time, alignment: Alignment = "exact") -> pd.DataFrame:
    """One row per (decision day, delivery hour): forecast available at the cut-off + what really happened."""
    actual = actual_series(ds.actuals, alignment).rename("actual")
    parts = [select_decision_forecast(ds.forecasts, d, cutoff) for d in decision_dates()]
    parts = [p for p in parts if not p.empty]
    if not parts:
        return pd.DataFrame(columns=TABLE_COLUMNS)
    table = pd.concat(parts, ignore_index=True).merge(actual, left_on="startTime", right_index=True, how="left")
    table["error"] = table["forecast"] - table["actual"]
    return table


def horizon_table(ds: Dataset, alignment: Alignment = "exact") -> pd.DataFrame:
    """Every forecast version published during the decision window, scored against actuals."""
    start = _local_to_utc(config.DECISION_START, time(0))
    end = _local_to_utc(config.DECISION_END + timedelta(days=1), time(0))
    pool = ds.forecasts[(ds.forecasts["publishTime"] >= start) & (ds.forecasts["publishTime"] < end)]
    actual = actual_series(ds.actuals, alignment).rename("actual")
    table = pool.rename(columns={"generation": "forecast"}).merge(
        actual, left_on="startTime", right_index=True, how="inner"
    )
    table["horizonH"] = (table["startTime"] - table["publishTime"]).dt.total_seconds() / 3600
    table["error"] = table["forecast"] - table["actual"]
    return table[table["horizonH"] >= 0].reset_index(drop=True)


# ---------------------------------------------------------------- metrics
def _scored(table: pd.DataFrame) -> pd.DataFrame:
    return table.dropna(subset=["forecast", "actual"])


def error_metrics(table: pd.DataFrame) -> dict | None:
    scored = _scored(table)
    if scored.empty:
        return None
    forecast = scored["forecast"].to_numpy(dtype=float)
    actual = scored["actual"].to_numpy(dtype=float)
    err = forecast - actual
    abs_err = np.abs(err)
    ss_tot = float(((actual - actual.mean()) ** 2).sum())
    positive = actual > 0
    return {
        "n": int(len(err)),
        "mae": _num(abs_err.mean()),
        "rmse": _num(math.sqrt(float((err**2).mean()))),
        "bias": _num(err.mean()),
        "wape": _num(abs_err.sum() / actual.sum() * 100) if actual.sum() > 0 else None,
        "mape": _num((abs_err[positive] / actual[positive]).mean() * 100) if positive.any() else None,
        "r2": _num(1 - float((err**2).sum()) / ss_tot) if ss_tot > 0 else None,
        "p50_abs_error": _num(np.quantile(abs_err, 0.50)),
        "p90_abs_error": _num(np.quantile(abs_err, 0.90)),
        "p95_abs_error": _num(np.quantile(abs_err, 0.95)),
        "max_abs_error": _num(abs_err.max()),
        "over_forecast_share": _num((err > 0).mean()),
    }


def error_quantiles(table: pd.DataFrame) -> dict[str, float | None] | None:
    err = _scored(table)["error"].to_numpy(dtype=float)
    if len(err) == 0:
        return None
    values = np.quantile(err, [q / 100 for q in QUANTILES])
    return {f"p{q}": _num(v) for q, v in zip(QUANTILES, values)}


def risk_buffer(quantiles: dict[str, float | None] | None) -> dict[str, float | None]:
    """MW to hold above the forecast-based need so that 90% / 95% of historical over-forecasts are covered."""
    if not quantiles:
        return {"p90_mw": None, "p95_mw": None}
    return {f"{key}_mw": max(0.0, quantiles[key]) if quantiles[key] is not None else None for key in ("p90", "p95")}


def error_band(table: pd.DataFrame, exclude_delivery_date: date | None = None) -> tuple[float, float] | None:
    """10th/90th percentile of past errors, leaving the selected day out so it is judged out-of-sample."""
    pool = _scored(table)
    if exclude_delivery_date is not None:
        pool = pool[pool["deliveryDate"] != exclude_delivery_date]
    if len(pool) < MIN_BAND_SAMPLES:
        return None
    low, high = np.quantile(pool["error"].to_numpy(dtype=float), [0.10, 0.90])
    return float(low), float(high)


def _by_day(table: pd.DataFrame) -> list[dict]:
    rows = []
    for day, group in _scored(table).groupby("deliveryDate", sort=True):
        m = error_metrics(group)
        rows.append(
            {
                "delivery_date": day,
                "n": m["n"],
                "mae": m["mae"],
                "rmse": m["rmse"],
                "bias": m["bias"],
                "mean_forecast": _num(group["forecast"].mean()),
                "mean_actual": _num(group["actual"].mean()),
            }
        )
    return rows


def _by_hour(table: pd.DataFrame) -> list[dict]:
    scored = _scored(table)
    hour = scored["startTime"].dt.tz_convert(config.MARKET_TZ).dt.hour
    rows = []
    for h, group in scored.groupby(hour, sort=True):
        m = error_metrics(group)
        rows.append({"hour": int(h), "n": m["n"], "mae": m["mae"], "rmse": m["rmse"], "bias": m["bias"]})
    return rows


def _by_horizon(table: pd.DataFrame) -> list[dict]:
    bucket = (np.floor(table["horizonH"] / HORIZON_BUCKET_H) * HORIZON_BUCKET_H).astype(int)
    rows = []
    for lo, group in table.groupby(bucket, sort=True):
        m = error_metrics(group)
        if m:
            rows.append(
                {
                    "label": f"{lo}-{lo + HORIZON_BUCKET_H}h",
                    "from_h": int(lo),
                    "to_h": int(lo + HORIZON_BUCKET_H),
                    "n": m["n"],
                    "mae": m["mae"],
                    "rmse": m["rmse"],
                    "bias": m["bias"],
                }
            )
    return rows


def _histogram(table: pd.DataFrame) -> dict:
    err = _scored(table)["error"].to_numpy(dtype=float)
    if len(err) == 0:
        return {"bin_edges": [], "counts": []}
    low = math.floor(err.min() / HISTOGRAM_BIN_MW) * HISTOGRAM_BIN_MW
    high = max(math.ceil(err.max() / HISTOGRAM_BIN_MW) * HISTOGRAM_BIN_MW, low + HISTOGRAM_BIN_MW)
    edges = np.arange(low, high + HISTOGRAM_BIN_MW, HISTOGRAM_BIN_MW)
    counts, _ = np.histogram(err, bins=edges)
    return {"bin_edges": edges.tolist(), "counts": counts.tolist()}



# ---------------------------------------------------------------- reports
def accuracy_report(ds: Dataset, table: pd.DataFrame, alignment: Alignment) -> dict:
    scored = _scored(table)
    if scored.empty:
        raise LookupError("No decision day has both a forecast and an actual to compare.")
    quantiles = error_quantiles(table)
    return {
        "overall": error_metrics(table),
        "error_quantiles": quantiles,
        "risk_buffer": risk_buffer(quantiles),
        "by_day": _by_day(table),
        "by_hour": _by_hour(table),
        "by_horizon": _by_horizon(horizon_table(ds, alignment)),
        "histogram": _histogram(table),
        "decision_horizon_range_h": [float(scored["horizonH"].min()), float(scored["horizonH"].max())],
    }


def decision_view(ds: Dataset, table: pd.DataFrame, decision_date: date, cutoff: time) -> dict:
    """Everything the UI needs for one purchase decision."""
    day = table[table["decisionDate"] == decision_date]
    if day.empty:
        raise LookupError(f"No forecast was available at the cut-off for decision date {decision_date}.")
    delivery_date = delivery_date_for(decision_date)
    start, end = local_day_utc(delivery_date)
    cut = cutoff_utc(decision_date, cutoff)
    band = error_band(table, exclude_delivery_date=delivery_date)

    points = []
    for row in day.itertuples(index=False):
        forecast = float(row.forecast)
        actual = None if pd.isna(row.actual) else float(row.actual)
        points.append(
            {
                "start_time": _iso(row.startTime),
                "forecast_mw": forecast,
                "publish_time": _iso(row.publishTime),
                "horizon_h": float(row.horizonH),
                "actual_mw": actual,
                "error_mw": None if actual is None else forecast - actual,
                "band_low_mw": None if band is None else max(0.0, forecast - band[1]),
                "band_high_mw": None if band is None else forecast - band[0],
            }
        )

    day_start, day_end = local_day_utc(decision_date)
    published = ds.forecasts.loc[
        (ds.forecasts["publishTime"] >= day_start) & (ds.forecasts["publishTime"] < day_end), "publishTime"
    ]
    half_hourly = ds.actuals[(ds.actuals["startTime"] >= start) & (ds.actuals["startTime"] < end)]
    expected_slots = int((end - start) / HALF_HOUR)
    latest = day["publishTime"].max()
    forecast_mw = day["forecast"].to_numpy(dtype=float)
    actual_complete = len(half_hourly) == expected_slots

    return {
        "decision_date": decision_date,
        "delivery_date": delivery_date,
        "cutoff_utc": _iso(cut),
        "cutoff_local": cut.tz_convert(config.MARKET_TZ).isoformat(),
        "publish_times_used": [_iso(t) for t in sorted(day["publishTime"].unique())],
        "publish_times_on_decision_day": [_iso(t) for t in sorted(published.unique())],
        "latest_publish_time": _iso(latest),
        "forecast_age_minutes": (cut - latest).total_seconds() / 60,
        "points": points,
        "actual_half_hourly": [
            {"start_time": _iso(t), "actual_mw": float(v)}
            for t, v in zip(half_hourly["startTime"], half_hourly["generation"])
        ],
        "summary": {
            "forecast_mean_mw": float(forecast_mw.mean()),
            "forecast_min_mw": float(forecast_mw.min()),
            "forecast_max_mw": float(forecast_mw.max()),
            "forecast_energy_mwh": float(forecast_mw.sum()),  # hourly points x 1 h
            "actual_mean_mw": float(half_hourly["generation"].mean()) if actual_complete else None,
            "actual_energy_mwh": float(half_hourly["generation"].sum() * 0.5) if actual_complete else None,
            "metrics": error_metrics(day),
        },
        "error_band_quantiles": None if band is None else {"p10": band[0], "p90": band[1]},
        "vintages": _vintages(ds, day, start, end, cut),
    }


def _vintages(ds: Dataset, day: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, cut: pd.Timestamp) -> list[dict]:
    """Forecast versions published around the cut-off, so it is obvious which were (not) available."""
    span = pd.Timedelta(hours=VINTAGE_SPAN_H)
    f = ds.forecasts
    pool = f[
        (f["startTime"] >= start) & (f["startTime"] < end) & (f["publishTime"] >= cut - span) & (f["publishTime"] <= cut + span)
    ]
    used = set(day["publishTime"])
    versions = []
    for publish, group in pool.groupby("publishTime", sort=True):
        versions.append(
            {
                "publish_time": _iso(publish),
                "available": bool(publish <= cut),
                "used": publish in used,
                "points": [
                    {"start_time": _iso(t), "forecast_mw": float(v)}
                    for t, v in zip(group["startTime"], group["generation"])
                ],
            }
        )
    return versions
