"""Project-wide settings. Every assumption the analysis makes lives here, in one place."""
from __future__ import annotations

import os
from datetime import date, time
from pathlib import Path
from zoneinfo import ZoneInfo

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BACKEND_DIR / "data"))
SNAPSHOT_DIR = DATA_DIR / "snapshot"
STATIC_DIR = Path(os.environ.get("STATIC_DIR", BACKEND_DIR / "static"))

# Elexon BMRS "Insights" API (open, no API key). Dataset docs:
#   https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream  (actuals)
#   https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream (forecasts)
ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"

# Day-ahead trading is done in UK wall-clock time.
MARKET_TZ = ZoneInfo("Europe/London")

# Scope from the brief: "purchase decisions to be made in January 2026".
# Decisions are made on D-1 for delivery on D, so deliveries run 2 Jan -> 1 Feb.
DECISION_START = date(2026, 1, 1)
DECISION_END = date(2026, 1, 31)
DAYS_BEFORE = 1

# Day-ahead gate closures (UK local time). The default is the N2EX auction.
#   N2EX 09:50  - Nord Pool support page "About the N2EX day-ahead auction"
#   EPEX 09:20  - EPEX SPOT trading brochure (GB 60-min day-ahead auction)
# Confirm the client's real cut-off; the UI lets the user change it.
DEFAULT_CUTOFF = time(9, 50)
CUTOFF_PRESETS = (
    {"time": "09:50", "name": "N2EX", "label": "N2EX day-ahead auction closes 09:50"},
    {"time": "09:20", "name": "EPEX", "label": "EPEX GB hourly day-ahead auction closes 09:20"},
)

def env_flag(name: str) -> bool:
    """True for 1/true/yes in any case. Surrounding whitespace is ignored: values piped into a hosting CLI often carry a newline."""
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


# Fail fast instead of silently showing synthetic demo data (set in the Docker image).
REQUIRE_REAL_DATA = env_flag("REQUIRE_REAL_DATA")
