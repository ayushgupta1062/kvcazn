# Data

`snapshot/` holds the Elexon data the app serves: `wind_actuals.csv.gz`, `wind_forecasts.csv.gz` and `manifest.json`.
It is created by `python -m app.ingest` (run from `backend/`) and is committed so every deployment shows the same numbers.
