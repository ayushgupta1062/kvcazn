"""API response shapes. Python uses snake_case; the JSON on the wire is camelCase."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Metrics(CamelModel):
    n: int
    mae: float | None
    rmse: float | None
    bias: float | None
    wape: float | None
    mape: float | None
    r2: float | None
    p50_abs_error: float | None
    p90_abs_error: float | None
    p95_abs_error: float | None
    max_abs_error: float | None
    over_forecast_share: float | None


# ---- /api/meta
class CutoffPreset(CamelModel):
    time: str
    name: str
    label: str


class AlignmentOption(CamelModel):
    value: str
    label: str


class DecisionDay(CamelModel):
    decision_date: date
    delivery_date: date


class Meta(CamelModel):
    data_source: Literal["elexon", "synthetic"]
    fetched_at_utc: str | None
    timezone: str
    decision_start: date
    decision_end: date
    days_before: int
    default_cutoff: str
    cutoff_presets: list[CutoffPreset]
    alignments: list[AlignmentOption]
    decision_days: list[DecisionDay]
    actual_rows: int
    forecast_rows: int
    forecast_versions: int


# ---- /api/decision
class DecisionPoint(CamelModel):
    start_time: str
    forecast_mw: float
    publish_time: str
    horizon_h: float
    actual_mw: float | None
    error_mw: float | None
    band_low_mw: float | None
    band_high_mw: float | None


class ActualPoint(CamelModel):
    start_time: str
    actual_mw: float


class VintagePoint(CamelModel):
    start_time: str
    forecast_mw: float


class Vintage(CamelModel):
    publish_time: str
    available: bool
    used: bool
    points: list[VintagePoint]


class DaySummary(CamelModel):
    forecast_mean_mw: float
    forecast_min_mw: float
    forecast_max_mw: float
    forecast_energy_mwh: float
    actual_mean_mw: float | None
    actual_energy_mwh: float | None
    metrics: Metrics | None


class ErrorBandQuantiles(CamelModel):
    p10: float
    p90: float


class DecisionView(CamelModel):
    decision_date: date
    delivery_date: date
    cutoff_utc: str
    cutoff_local: str
    publish_times_used: list[str]
    publish_times_on_decision_day: list[str]
    latest_publish_time: str
    forecast_age_minutes: float
    points: list[DecisionPoint]
    actual_half_hourly: list[ActualPoint]
    summary: DaySummary
    error_band_quantiles: ErrorBandQuantiles | None
    vintages: list[Vintage]


# ---- /api/accuracy
class DayMetrics(CamelModel):
    delivery_date: date
    n: int
    mae: float | None
    rmse: float | None
    bias: float | None
    mean_forecast: float | None
    mean_actual: float | None


class HourMetrics(CamelModel):
    hour: int
    n: int
    mae: float | None
    rmse: float | None
    bias: float | None


class HorizonMetrics(CamelModel):
    label: str
    from_h: int
    to_h: int
    n: int
    mae: float | None
    rmse: float | None
    bias: float | None


class Histogram(CamelModel):
    bin_edges: list[float]
    counts: list[int]


class RiskBuffer(CamelModel):
    p90_mw: float | None
    p95_mw: float | None


class AccuracyReport(CamelModel):
    cutoff: str
    alignment: str
    overall: Metrics
    error_quantiles: dict[str, float | None]
    risk_buffer: RiskBuffer
    by_day: list[DayMetrics]
    by_hour: list[HourMetrics]
    by_horizon: list[HorizonMetrics]
    histogram: Histogram
    decision_horizon_range_h: list[float]
