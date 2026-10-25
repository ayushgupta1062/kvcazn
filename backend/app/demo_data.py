"""SYNTHETIC wind data, for development and tests only.

It mimics the *shape* of the Elexon data (half-hourly actuals; forecasts published 8x/day, each with
73 hourly points, error growing with lead time). The numbers are invented. The UI shows a banner
whenever this is in use, and the Docker image refuses to start on it (REQUIRE_REAL_DATA=1).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

PUBLISH_HOURS = (2, 4, 7, 9, 11, 15, 18, 22)  # hh:30 UTC slots seen in the real WINDFOR feed


def generate(seed: int = 7) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    first = pd.Timestamp("2025-12-28", tz="UTC")
    last = pd.Timestamp("2026-02-04", tz="UTC")

    half_hours = pd.date_range(first, last, freq="30min", inclusive="left")
    z = np.zeros(len(half_hours))
    for i in range(1, len(z)):  # slow weather-like AR(1), ~2 day memory
        z[i] = 0.99 * z[i - 1] + np.sqrt(1 - 0.99**2) * rng.normal()
    clock = half_hours.hour + half_hours.minute / 60
    level = 9500 + 4000 * z + 600 * np.sin(2 * np.pi * (clock - 14) / 24)
    actual = pd.Series(np.clip(level, 500, 17800).round(), index=half_hours)

    publish_rows, start_rows, value_rows = [], [], []
    for day in pd.date_range(first, last, freq="D", inclusive="left"):
        for hour in PUBLISH_HOURS:
            publish = day + pd.Timedelta(hours=hour, minutes=30)
            targets = publish.floor("h") + pd.to_timedelta(np.arange(-12, 61), unit="h")
            truth = actual.reindex(targets).to_numpy()
            lead = np.asarray((targets - publish) / pd.Timedelta(hours=1), dtype=float)
            sigma = np.minimum(300 + 110 * np.clip(lead, 0, None) ** 0.85, 4500)
            shocks = rng.normal(size=len(targets))
            err = np.zeros(len(targets))
            for k in range(1, len(err)):  # errors are correlated from hour to hour
                err[k] = 0.92 * err[k - 1] + np.sqrt(1 - 0.92**2) * shocks[k]
            forecast = np.clip(truth - 150 + sigma * err, 0, 18500).round()
            keep = np.isfinite(truth)
            publish_rows += [publish] * int(keep.sum())
            start_rows += list(targets[keep])
            value_rows += list(forecast[keep])

    forecasts = pd.DataFrame({"publishTime": publish_rows, "startTime": start_rows, "generation": value_rows})
    forecasts["publishTime"] = forecasts["publishTime"].astype("datetime64[ns, UTC]")
    forecasts["startTime"] = forecasts["startTime"].astype("datetime64[ns, UTC]")
    actuals = pd.DataFrame({"startTime": half_hours.astype("datetime64[ns, UTC]"), "generation": actual.to_numpy()})
    return actuals, forecasts
