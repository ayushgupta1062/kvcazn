"""Load the data snapshot (written by `python -m app.ingest`) into memory."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pandas as pd

from . import config, demo_data
from .elexon import utc_series

log = logging.getLogger(__name__)

ACTUALS_FILE = "wind_actuals.csv.gz"
FORECASTS_FILE = "wind_forecasts.csv.gz"
MANIFEST_FILE = "manifest.json"
TIME_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


@dataclass(frozen=True)
class Dataset:
    actuals: pd.DataFrame  # startTime (UTC), generation (MW) - half-hourly
    forecasts: pd.DataFrame  # publishTime, startTime (UTC), generation (MW) - hourly points per version
    manifest: dict

    @property
    def is_synthetic(self) -> bool:
        return self.manifest.get("dataSource") != "elexon"


def write_snapshot(actuals: pd.DataFrame, forecasts: pd.DataFrame, manifest: dict, directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    actuals.to_csv(directory / ACTUALS_FILE, index=False, date_format=TIME_FORMAT)
    forecasts.to_csv(directory / FORECASTS_FILE, index=False, date_format=TIME_FORMAT)
    (directory / MANIFEST_FILE).write_text(json.dumps(manifest, indent=2) + "\n")


def read_snapshot(directory: Path) -> Dataset:
    actuals = pd.read_csv(directory / ACTUALS_FILE)
    forecasts = pd.read_csv(directory / FORECASTS_FILE)
    actuals["startTime"] = utc_series(actuals["startTime"])
    forecasts["startTime"] = utc_series(forecasts["startTime"])
    forecasts["publishTime"] = utc_series(forecasts["publishTime"])
    manifest = json.loads((directory / MANIFEST_FILE).read_text())
    return Dataset(actuals, forecasts, manifest)


@lru_cache(maxsize=1)
def get_dataset() -> Dataset:
    if (config.SNAPSHOT_DIR / MANIFEST_FILE).exists():
        ds = read_snapshot(config.SNAPSHOT_DIR)
        log.info("Loaded Elexon snapshot fetched %s", ds.manifest.get("fetchedAtUtc"))
        return ds
    if config.REQUIRE_REAL_DATA:
        raise RuntimeError(
            f"No Elexon snapshot in {config.SNAPSHOT_DIR}. Create it with:  python -m app.ingest"
        )
    log.warning("No snapshot found - serving SYNTHETIC demo data. Run `python -m app.ingest` for real data.")
    actuals, forecasts = demo_data.generate()
    return Dataset(actuals, forecasts, {"dataSource": "synthetic"})
