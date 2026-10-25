# Design decisions

Short records of the choices that shape the portal, why they were made, and what was rejected. Written for a reviewer who wants to challenge them.

## 1. The decision happens at the day-ahead gate, and that time is a setting

The brief says purchases are decided "one day before the delivery day" and gives no clock time. The GB day-ahead auctions close at 09:50 UK time (N2EX) and 09:20 (EPEX hourly), so the portal defaults to **09:50** and offers both as presets, with any other time one drag or keystroke away.

*Rejected:* hard-coding one time (hides the assumption), or using "end of the day before" (nobody trades the day-ahead market at 23:59).

## 2. "The forecast available at decision time" is chosen per delivery hour

For delivery hour T of day D and gate G on D−1: take the WINDFOR rows with `startTime = T` and `publishTime ≤ G`, and keep the one with the newest `publishTime`. If the newest version has no row for T, use the next newest that does. The gate is inclusive.

A version counts as available from its `publishTime`, which the brief defines as "the time at which the forecast was created". Any delay between creation and appearing on the desk's screen is not modelled; to be cautious, move the gate earlier.

*Rejected:* using the newest forecast for each hour regardless of when it was published. That version is usually issued after the decision, so the accuracy numbers would be better than anything the desk could have achieved (look-ahead bias). The revisions chart shows the later versions dashed so the difference is visible, not hidden.

*Verified by:* a test that recomputes the selection by brute force for every decision day, tests for the inclusive gate, the fallback, days with 23 and 25 hours, and the clock change.

## 3. The miss is `forecast − actual`, and the headline numbers are the ones a buyer acts on

| Measure | Why it is there |
|---|---|
| Typical miss (MAE) | The plain "how far off, on an ordinary hour". |
| Big misses count extra (RMSE) | Large errors hurt a buyer more than small ones; the gap to MAE shows how heavy the tail is. |
| Lean (bias) | Whether forecasts run high or low overall. Positive means the desk would have bought too little. |
| Miss as share of wind (WAPE) | A percentage that stays meaningful when wind is near zero. *MAPE was rejected* because it explodes on windless hours. |
| Reserve (90th percentile of the miss, floored at zero) | Turns the error into an action: the extra power that would have covered 9 in 10 past hours. 95th percentile is in the API. |
| Share of hours forecast too high | The side of the error that costs the desk. |

## 4. Hourly forecasts meet half-hourly actuals without inventing data

Forecasts are hourly, actuals half-hourly. The default compares the forecast for 10:00 with the actual for the half-hour starting 10:00. The alternative averages the 10:00 and 10:30 actuals. Both are one dropdown; the default adds nothing that is not in the data.

## 5. Accuracy by horizon uses every forecast version, not only the ones at the gate

To show how the error grows with how early a forecast was issued, all versions published during January are scored against actuals and grouped into 6-hour buckets. The buckets a 09:50 gate actually draws on (about 14–38 hours ahead) are highlighted. The headline numbers still use only the forecasts available at the gate.

## 6. The range on the forecast chart is out-of-sample

"Where 8 in 10 past hours landed" is the 10th–90th percentile of past misses at the same gate, **with the selected day removed**, so a day is never judged by its own errors. It needs at least 30 other hours, otherwise it is not drawn. It describes January, not a guarantee.

## 7. A committed snapshot instead of live Elexon calls

January 2026 is history. `python -m app.ingest` downloads it once (chunked requests, retries, de-duplication, health checks) and the app serves the snapshot. Deployments are reproducible and the demo does not depend on an upstream API being up. The Docker image refuses to start without a snapshot so it cannot show demo data by accident.

*Rejected:* calling Elexon on every request (slow, rate-limited, can fail during a review) and a database (about 20,000 rows fit in memory and a CSV is easy to inspect).

## 8. One container serves everything

FastAPI serves `/api/*` and the built React app. One URL, no CORS, one thing to deploy on Heroku, and the same image runs locally. Vercel is supported as a free alternative through `vercel.json` and `index.py`.

## 9. Hand-built charts

Charts are SVG built on d3 scales (no chart library). This gives exact control of the things a reviewer will test: direct labels without collisions, a legend whenever there are two series, one axis per chart, keyboard-reachable tooltips, a table twin for every chart, and a small bundle. The cost is more code to maintain than a library would need.

## 10. Settings live in the URL

Tab, decision day, gate and matching option are query parameters, so a view can be bookmarked or sent to a colleague, and a reload keeps its place. Bad values in a hand-edited link fall back to defaults.

## 11. Demo data exists, loudly

`demo_data.py` generates synthetic data with the same shape as Elexon's so the UI and tests run without network access. The UI shows a yellow banner whenever the data is synthetic, and the API reports `dataSource: "synthetic"`.

## 12. Elexon's attribution is shown in the app and in the repository

Elexon's BMRS open data licence allows copying, publishing and commercial use if the statement "Contains BMRS data © Elexon Limited copyright and database right [year]" is shown, no endorsement is implied, and the source is not misrepresented. The snapshot committed to git is a republication of that data and the deployed app shows it, so the statement (with 2026, the year of the data) is in the README and in the footer of every page, with a link to the licence.

## 13. Vercel: function lives in `api/index.py`, rewrites handle `/api/*`

Vercel's current Python runtime requires every serverless function to live inside the `api/` directory; the first deploy attempt (with the function at the project root as `index.py`) failed with *"The pattern `index.py` defined in `functions` doesn't match any Serverless Functions inside the `api` directory"*. The function was moved to `api/index.py` (it still just re-exports `backend.app.main:app`), the frontend build output is copied to a top-level `public/` folder for Vercel's static hosting, and `vercel.json` adds `rewrites` so that `/api/*`, `/docs` and `/openapi.json` all route to the one function. Docker and Heroku are unaffected (they still run `backend.app.main:app` directly).

*Rejected:* keeping `index.py` at the root with a `pyproject.toml` entry-point hint. The current Vercel builder ignores that hint and the error above returns.

## What would come next

- A **procurement what-if**: enter expected demand and see wind cover, the residual to buy, and the same residual with the reserve added. Demand is the desk's own number, so it adds no data source.
- Reserve by **time of day** (the miss is larger in some hours), and by wind level.
- Other months and seasons once the scope allows.
