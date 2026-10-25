"""Download the wind data for the decision window from Elexon into a local snapshot.

    python -m app.ingest --check    # one small request per dataset; prints what came back, writes nothing
    python -m app.ingest            # full window -> data/snapshot/  (commit this folder)
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd

from . import analysis, config, elexon, store


def _windows() -> dict:
    last_delivery = analysis.delivery_date_for(config.DECISION_END)
    return {
        "actual_first": config.DECISION_START,
        "actual_last": last_delivery,
        # Forecasts published from the day before the first decision until the end of the last delivery day
        # (the extra tail only feeds the "later versions you could not use" chart). Naive datetimes = UTC.
        "publish_from": datetime.combine(config.DECISION_START - timedelta(days=1), time.min),
        "publish_to": datetime.combine(last_delivery + timedelta(days=1), time.min),
    }


def _health_checks(actuals: pd.DataFrame, forecasts: pd.DataFrame) -> tuple[dict, list[str]]:
    warnings: list[str] = []
    w = _windows()
    start, _ = analysis.local_day_utc(w["actual_first"])
    _, end = analysis.local_day_utc(w["actual_last"])
    expected = int((end - start) / pd.Timedelta(minutes=30))
    in_range = actuals[(actuals["startTime"] >= start) & (actuals["startTime"] < end)]
    missing = expected - len(in_range)
    if missing:
        warnings.append(f"{missing} of {expected} expected half-hourly actuals are missing")

    per_version = forecasts.groupby("publishTime").size()
    off_hour = int((forecasts["startTime"].dt.minute != 0).sum())
    if off_hour:
        warnings.append(f"{off_hour} forecast points are not on the hour - check the alignment option")

    default_cutoff = config.DEFAULT_CUTOFF
    incomplete = [
        d.isoformat()
        for d in analysis.decision_dates()
        if len(analysis.select_decision_forecast(forecasts, d, default_cutoff)) < 23  # 23 = clock-change day
    ]
    if incomplete:
        warnings.append(f"decision days with an incomplete forecast at {default_cutoff:%H:%M}: {', '.join(incomplete)}")

    checks = {
        "expectedHalfHourlyActuals": expected,
        "missingHalfHourlyActuals": missing,
        "forecastVersions": int(per_version.size),
        "pointsPerVersionMin": int(per_version.min()) if len(per_version) else 0,
        "pointsPerVersionMax": int(per_version.max()) if len(per_version) else 0,
        "forecastPointsOffTheHour": off_hour,
        "decisionDaysWithIncompleteForecast": incomplete,
    }
    return checks, warnings


def run_check(client: httpx.Client) -> int:
    day = config.DECISION_START
    actuals = elexon.fetch_actual_wind(client, day, day)
    forecasts = elexon.fetch_wind_forecasts(
        client, datetime.combine(day - timedelta(days=1), time.min), datetime.combine(day, time.min)
    )
    print(f"FUELHH WIND {day}: {len(actuals)} rows (expect 48)\n{actuals.head(3)}\n")
    print(f"WINDFOR published {day - timedelta(days=1)}: {len(forecasts)} rows, "
          f"{forecasts['publishTime'].nunique()} versions\n{forecasts.head(3)}\n")
    ok = len(actuals) > 0 and len(forecasts) > 0
    print("CHECK OK" if ok else "CHECK FAILED - nothing returned")
    return 0 if ok else 1


def run_full(client: httpx.Client, out: Path) -> int:
    w = _windows()
    print(f"Fetching actuals (FUELHH, WIND) {w['actual_first']} -> {w['actual_last']} ...")
    actuals = elexon.fetch_actual_wind(client, w["actual_first"], w["actual_last"])
    print(f"  {len(actuals)} half-hourly rows")
    print(f"Fetching forecasts (WINDFOR) published {w['publish_from']:%Y-%m-%d} -> {w['publish_to']:%Y-%m-%d} ...")
    forecasts = elexon.fetch_wind_forecasts(client, w["publish_from"], w["publish_to"])
    print(f"  {len(forecasts)} rows in {forecasts['publishTime'].nunique()} forecast versions")

    checks, warnings = _health_checks(actuals, forecasts)
    manifest = {
        "dataSource": "elexon",
        "schemaVersion": 1,
        "fetchedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "api": config.ELEXON_BASE_URL,
        "actuals": {"dataset": "FUELHH", "fuelType": "WIND", "settlementDateFrom": str(w["actual_first"]),
                    "settlementDateTo": str(w["actual_last"]), "rows": int(len(actuals))},
        "forecasts": {"dataset": "WINDFOR", "publishDateTimeFrom": w["publish_from"].isoformat() + "Z",
                      "publishDateTimeTo": w["publish_to"].isoformat() + "Z", "rows": int(len(forecasts))},
        "checks": checks,
    }
    store.write_snapshot(actuals, forecasts, manifest, out)
    print(f"Snapshot written to {out}")
    for message in warnings:
        print(f"WARNING: {message}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="small test request; write nothing")
    parser.add_argument("--out", type=Path, default=config.SNAPSHOT_DIR, help="snapshot folder")
    args = parser.parse_args(argv)
    with httpx.Client(base_url=config.ELEXON_BASE_URL, timeout=60, headers={"Accept": "application/json"}) as client:
        return run_check(client) if args.check else run_full(client, args.out)


if __name__ == "__main__":
    sys.exit(main())
