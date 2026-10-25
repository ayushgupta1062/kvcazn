from datetime import date, time

import numpy as np
import pandas as pd
import pytest

from app import analysis
from app.elexon import normalise_forecasts


def forecast_rows(versions: dict[str, dict[int, float]]) -> pd.DataFrame:
    """versions: publishTime -> {hour of 2026-01-11: MW}"""
    rows = [
        {"publishTime": publish, "startTime": f"2026-01-11T{hour:02d}:00:00Z", "generation": mw}
        for publish, hours in versions.items()
        for hour, mw in hours.items()
    ]
    return normalise_forecasts(rows)


THREE_VERSIONS = {
    "2026-01-10T07:30:00Z": {h: 1000 + h for h in range(6)},
    "2026-01-10T09:30:00Z": {h: 2000 + h for h in range(6)},
    "2026-01-10T11:30:00Z": {h: 3000 + h for h in range(6)},
}
DECISION = date(2026, 1, 10)  # delivery 2026-01-11


# ---------------------------------------------------------------- which forecast is available?
@pytest.mark.parametrize(
    "cutoff, expected_base",
    [
        (time(9, 50), 2000),  # the 09:30 version is the newest one before 09:50
        (time(9, 30), 2000),  # published exactly at the cut-off counts as available
        (time(9, 29), 1000),  # one minute earlier it does not
        (time(23, 0), 3000),  # a late cut-off sees the newest version
    ],
)
def test_latest_forecast_at_or_before_cutoff(cutoff, expected_base):
    chosen = analysis.select_decision_forecast(forecast_rows(THREE_VERSIONS), DECISION, cutoff)
    assert chosen["forecast"].tolist() == [expected_base + h for h in range(6)]


def test_no_forecast_before_first_publication():
    chosen = analysis.select_decision_forecast(forecast_rows(THREE_VERSIONS), DECISION, time(7, 0))
    assert chosen.empty


def test_hour_missing_from_newest_version_falls_back_to_older_one():
    versions = {
        "2026-01-10T07:30:00Z": {h: 1000 + h for h in range(6)},
        "2026-01-10T09:30:00Z": {h: 2000 + h for h in range(5)},  # hour 5 absent
    }
    chosen = analysis.select_decision_forecast(forecast_rows(versions), DECISION, time(9, 50))
    assert chosen["forecast"].tolist() == [2000, 2001, 2002, 2003, 2004, 1005]


def test_horizon_is_hours_between_publication_and_target():
    chosen = analysis.select_decision_forecast(forecast_rows(THREE_VERSIONS), DECISION, time(9, 50))
    assert chosen["horizonH"].iloc[0] == pytest.approx(14.5)  # 09:30 on the 10th -> 00:00 on the 11th


def test_selection_matches_brute_force_on_demo_data(demo_ds):
    f = demo_ds.forecasts
    for decision_date, cutoff in [(date(2026, 1, 1), time(9, 50)), (date(2026, 1, 15), time(9, 20)),
                                  (date(2026, 1, 31), time(15, 30)), (date(2026, 1, 8), time(3, 5))]:
        start, end = analysis.local_day_utc(analysis.delivery_date_for(decision_date))
        cut = analysis.cutoff_utc(decision_date, cutoff)
        best: dict = {}
        for publish, target, mw in zip(f["publishTime"], f["startTime"], f["generation"]):
            if start <= target < end and publish <= cut and (target not in best or publish > best[target][0]):
                best[target] = (publish, mw)
        got = analysis.select_decision_forecast(f, decision_date, cutoff)
        assert dict(zip(got["startTime"], zip(got["publishTime"], got["forecast"]))) == best


# ---------------------------------------------------------------- UK wall-clock time
def test_cutoff_follows_uk_clock_changes():
    assert analysis.cutoff_utc(date(2026, 1, 15), time(9, 50)) == pd.Timestamp("2026-01-15T09:50:00Z")
    assert analysis.cutoff_utc(date(2026, 7, 15), time(9, 50)) == pd.Timestamp("2026-07-15T08:50:00Z")


@pytest.mark.parametrize("day, hours", [(date(2026, 1, 15), 24), (date(2026, 3, 29), 23), (date(2026, 10, 25), 25)])
def test_delivery_day_length(day, hours):
    start, end = analysis.local_day_utc(day)
    assert (end - start) == pd.Timedelta(hours=hours)


@pytest.mark.parametrize("text", ["25:00", "09:60", "0950", "", "ab:cd"])
def test_bad_cutoff_is_rejected(text):
    with pytest.raises(ValueError):
        analysis.parse_cutoff(text)


# ---------------------------------------------------------------- actual alignment
def half_hourly(values: dict[str, float]) -> pd.DataFrame:
    return pd.DataFrame({"startTime": pd.to_datetime(list(values), utc=True).astype("datetime64[ns, UTC]"),
                         "generation": list(values.values())})


def test_alignment_exact_keeps_every_half_hour():
    actuals = half_hourly({"2026-01-11T00:00:00Z": 100, "2026-01-11T00:30:00Z": 200, "2026-01-11T01:00:00Z": 300})
    assert analysis.actual_series(actuals, "exact").tolist() == [100, 200, 300]


def test_alignment_hourly_mean_needs_both_half_hours():
    actuals = half_hourly({"2026-01-11T00:00:00Z": 100, "2026-01-11T00:30:00Z": 200, "2026-01-11T01:00:00Z": 300})
    series = analysis.actual_series(actuals, "hourly_mean")
    assert series[pd.Timestamp("2026-01-11T00:00:00Z")] == 150
    assert pd.Timestamp("2026-01-11T01:00:00Z") not in series.index  # 01:30 missing -> dropped, not guessed


# ---------------------------------------------------------------- metrics
def scored(forecast, actual) -> pd.DataFrame:
    return pd.DataFrame({"forecast": forecast, "actual": actual})


def test_metrics_hand_checked():
    m = analysis.error_metrics(scored([110, 90, 100, 130], [100, 100, 100, 100]))  # errors +10 -10 0 +30
    assert m["n"] == 4
    assert m["mae"] == pytest.approx(12.5)
    assert m["rmse"] == pytest.approx(np.sqrt(275))
    assert m["bias"] == pytest.approx(7.5)
    assert m["wape"] == pytest.approx(12.5)
    assert m["mape"] == pytest.approx(12.5)
    assert m["over_forecast_share"] == pytest.approx(0.5)
    assert m["max_abs_error"] == 30
    assert m["r2"] is None  # actuals are constant, R2 undefined


def test_perfect_forecast_has_zero_error_and_r2_of_one():
    m = analysis.error_metrics(scored([1, 2, 3, 4], [1, 2, 3, 4]))
    assert (m["mae"], m["rmse"], m["bias"]) == (0, 0, 0)
    assert m["r2"] == pytest.approx(1.0)


def test_metrics_ignore_rows_without_actuals_and_handle_empty():
    m = analysis.error_metrics(scored([100, 200, 300], [100, np.nan, 400]))
    assert m["n"] == 2 and m["mae"] == pytest.approx(50)
    assert analysis.error_metrics(scored([100], [np.nan])) is None


def test_risk_buffer_is_never_negative():
    assert analysis.risk_buffer({"p90": -50.0, "p95": 120.0}) == {"p90_mw": 0.0, "p95_mw": 120.0}


# ---------------------------------------------------------------- pipeline on demo data
@pytest.fixture(scope="module")
def table(demo_ds):
    return analysis.decision_table(demo_ds, time(9, 50), "exact")


def test_table_never_uses_a_forecast_published_after_the_cutoff(table):
    for decision_date, group in table.groupby("decisionDate"):
        assert (group["publishTime"] <= analysis.cutoff_utc(decision_date, time(9, 50))).all()


def test_table_covers_every_decision_day_and_hour(table):
    assert table["decisionDate"].nunique() == 31
    assert (table.groupby("decisionDate").size() == 24).all()
    assert table["deliveryDate"].min() == date(2026, 1, 2) and table["deliveryDate"].max() == date(2026, 2, 1)


def test_table_error_is_forecast_minus_actual(table):
    ok = table.dropna(subset=["actual"])
    assert len(ok) == len(table)
    assert np.allclose(ok["error"], ok["forecast"] - ok["actual"])


def test_decision_forecast_horizon_range_matches_09_30_publication(table):
    assert table["horizonH"].min() == pytest.approx(14.5) and table["horizonH"].max() == pytest.approx(37.5)


def test_error_grows_with_forecast_horizon(demo_ds):
    rows = analysis._by_horizon(analysis.horizon_table(demo_ds, "exact"))
    mae = {r["from_h"]: r["mae"] for r in rows}
    assert mae[36] > mae[0]
    assert all(r["from_h"] >= 0 for r in rows)


def test_horizon_table_only_uses_versions_published_in_the_window(demo_ds):
    horizon = analysis.horizon_table(demo_ds, "exact")
    assert horizon["publishTime"].min() >= pd.Timestamp("2026-01-01T00:00:00Z")
    assert horizon["publishTime"].max() < pd.Timestamp("2026-02-01T00:00:00Z")


def test_error_band_leaves_the_selected_day_out(table):
    day = date(2026, 1, 20)
    with_day = analysis.error_band(table)
    without_day = analysis.error_band(table, exclude_delivery_date=day)
    assert with_day != without_day
    assert without_day[0] < without_day[1]


def test_error_band_needs_enough_history(table):
    assert analysis.error_band(table.head(10)) is None
