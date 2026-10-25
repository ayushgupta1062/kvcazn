import pytest
from fastapi.testclient import TestClient

from app import main, store


@pytest.fixture
def client(monkeypatch, demo_ds):
    monkeypatch.setattr(store, "get_dataset", lambda: demo_ds)
    main._table.cache_clear()
    with TestClient(main.app) as c:
        yield c
    main._table.cache_clear()


def test_meta_describes_the_scope(client):
    body = client.get("/api/meta").json()
    assert body["dataSource"] == "synthetic"
    assert body["defaultCutoff"] == "09:50" and body["daysBefore"] == 1
    assert len(body["decisionDays"]) == 31
    assert body["decisionDays"][0] == {"decisionDate": "2026-01-01", "deliveryDate": "2026-01-02"}


def test_decision_uses_the_09_30_forecast_for_a_09_50_cutoff(client):
    body = client.get("/api/decision", params={"decisionDate": "2026-01-14"}).json()
    assert body["deliveryDate"] == "2026-01-15"
    assert len(body["points"]) == 24
    assert len(body["publishTimesOnDecisionDay"]) == 8  # the feed publishes 8 versions a day
    assert body["latestPublishTime"] == "2026-01-14T09:30:00Z"
    assert body["forecastAgeMinutes"] == pytest.approx(20)
    assert all(p["publishTime"] <= body["cutoffUtc"] for p in body["points"])
    assert len(body["actualHalfHourly"]) == 48
    assert body["errorBandQuantiles"]["p10"] < body["errorBandQuantiles"]["p90"]
    point = body["points"][0]
    assert point["errorMw"] == pytest.approx(point["forecastMw"] - point["actualMw"])
    assert point["bandLowMw"] <= point["forecastMw"] <= point["bandHighMw"] or point["bandLowMw"] == 0


def test_an_earlier_cutoff_uses_an_older_forecast(client):
    body = client.get("/api/decision", params={"decisionDate": "2026-01-14", "cutoff": "09:20"}).json()
    assert body["latestPublishTime"] == "2026-01-14T07:30:00Z"
    assert body["forecastAgeMinutes"] == pytest.approx(110)


def test_vintages_flag_which_versions_were_available(client):
    versions = client.get("/api/decision", params={"decisionDate": "2026-01-14"}).json()["vintages"]
    assert [v["available"] for v in versions] == sorted(v["available"] for v in versions)[::-1]
    assert sum(v["used"] for v in versions) == 1
    assert all(v["available"] for v in versions if v["used"])
    assert any(not v["available"] for v in versions)


@pytest.mark.parametrize(
    "params",
    [{"decisionDate": "2026-02-15"}, {"decisionDate": "2025-12-31"}, {"decisionDate": "2026-01-14", "cutoff": "25:99"},
     {"decisionDate": "2026-01-14", "cutoff": "9am"}, {"decisionDate": "2026-01-14", "alignment": "nope"}, {}],
)
def test_bad_input_is_a_422(client, params):
    assert client.get("/api/decision", params=params).status_code == 422


def test_accuracy_report_is_internally_consistent(client):
    body = client.get("/api/accuracy").json()
    n = body["overall"]["n"]
    assert n == 31 * 24
    assert sum(body["histogram"]["counts"]) == n
    assert len(body["byDay"]) == 31 and len(body["byHour"]) == 24
    assert body["riskBuffer"]["p90Mw"] >= 0
    assert body["errorQuantiles"]["p5"] < body["errorQuantiles"]["p95"]
    assert body["decisionHorizonRangeH"] == [14.5, 37.5]
    assert body["byHorizon"][0]["fromH"] == 0


def test_accuracy_responds_to_the_alignment_option(client):
    exact = client.get("/api/accuracy", params={"alignment": "exact"}).json()["overall"]
    hourly = client.get("/api/accuracy", params={"alignment": "hourly_mean"}).json()["overall"]
    assert exact["mae"] != hourly["mae"]


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok", "dataSource": "synthetic"}
