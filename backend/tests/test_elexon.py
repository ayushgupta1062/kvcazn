from datetime import date, datetime

import httpx
import pytest

from app import analysis, config, elexon, ingest, store


def make_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), base_url=config.ELEXON_BASE_URL)


def fuelhh(start: str, mw, fuel="WIND") -> dict:
    return {"dataset": "FUELHH", "startTime": start, "settlementDate": start[:10], "settlementPeriod": 1,
            "fuelType": fuel, "generation": mw}


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(elexon.time, "sleep", lambda _: None)


def test_actuals_are_requested_in_week_chunks_and_filtered_to_wind():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(dict(request.url.params))
        return httpx.Response(200, json=[fuelhh("2026-01-01T00:00:00Z", 100), fuelhh("2026-01-01T00:00:00Z", 5, "CCGT")])

    df = elexon.fetch_actual_wind(make_client(handler), date(2026, 1, 1), date(2026, 1, 10))
    assert [(c["settlementDateFrom"], c["settlementDateTo"]) for c in calls] == [
        ("2026-01-01", "2026-01-07"), ("2026-01-08", "2026-01-10")]
    assert all(c["fuelType"] == "WIND" for c in calls)
    assert df["generation"].tolist() == [100.0]  # CCGT dropped, duplicate half-hour collapsed


def test_forecasts_are_requested_one_day_at_a_time():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        calls.append(params)
        return httpx.Response(200, json=[{"dataset": "WINDFOR", "publishTime": params["publishDateTimeFrom"],
                                          "startTime": "2026-01-02T00:00:00Z", "generation": 7}])

    df = elexon.fetch_wind_forecasts(make_client(handler), datetime(2025, 12, 31), datetime(2026, 1, 3))
    assert [c["publishDateTimeFrom"] for c in calls] == ["2025-12-31T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"]
    assert calls[-1]["publishDateTimeTo"] == "2026-01-03T00:00:00Z"
    assert len(df) == 3 and str(df["publishTime"].dtype) == "datetime64[ns, UTC]"


def test_null_generation_rows_are_dropped():
    df = elexon.normalise_forecasts([
        {"publishTime": "2026-01-01T09:30:00Z", "startTime": "2026-01-02T00:00:00Z", "generation": None},
        {"publishTime": "2026-01-01T09:30:00Z", "startTime": "2026-01-02T01:00:00Z", "generation": "250"},
    ])
    assert df["generation"].tolist() == [250.0]


def test_transient_errors_are_retried():
    attempts = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        return httpx.Response(503) if len(attempts) < 3 else httpx.Response(200, json=[])

    assert elexon.get_json(make_client(handler), "/x", {}) == []
    assert len(attempts) == 3


def test_client_errors_fail_immediately_with_the_server_message():
    attempts = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        return httpx.Response(400, text="range too large")

    with pytest.raises(elexon.ElexonError, match="range too large"):
        elexon.get_json(make_client(handler), "/x", {})
    assert len(attempts) == 1


def test_gives_up_after_repeated_failures():
    with pytest.raises(elexon.ElexonError, match="Giving up"):
        elexon.get_json(make_client(lambda r: httpx.Response(500)), "/x", {}, retries=3)


def test_snapshot_round_trip(tmp_path, demo_ds):
    manifest = {"dataSource": "elexon", "fetchedAtUtc": "2026-02-02T00:00:00Z"}
    store.write_snapshot(demo_ds.actuals, demo_ds.forecasts, manifest, tmp_path)
    back = store.read_snapshot(tmp_path)
    assert not back.is_synthetic
    assert back.forecasts.equals(demo_ds.forecasts) and back.actuals.equals(demo_ds.actuals)


def test_ingest_health_checks_pass_on_complete_data_and_flag_gaps(demo_ds):
    checks, warnings = ingest._health_checks(demo_ds.actuals, demo_ds.forecasts)
    assert checks["missingHalfHourlyActuals"] == 0 and warnings == []
    gappy = demo_ds.actuals.iloc[::2]
    _, warnings = ingest._health_checks(gappy, demo_ds.forecasts)
    assert any("missing" in w for w in warnings)
