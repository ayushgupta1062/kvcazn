# Browser checks

Scripted checks that drive the built app in a real browser (Playwright, Chromium) and print PASS or FAIL for each. They are not part of `make test` because they need a running app and a browser download.

```bash
# the app must be running, for example: docker compose up --build   (then it is on http://localhost:8000)
cd qa
npm i --no-save playwright && npx playwright install chromium      # once; nothing is added to package.json
BASE_URL=http://localhost:8000 node interact.cjs                   # about 56 checks: gate slider, typed times, dates, tooltips, tables, deep links, no sideways scroll
BASE_URL=http://localhost:8000 node shots.cjs                      # screenshots at several widths, light and dark, into qa-out/ (git-ignored)
```

`BASE_URL` can also be the deployed address. `OUT_DIR` changes where screenshots go.

Some checks assume things that are true of the real feeds (eight forecast versions a day, 31 decision days in January 2026); a failure means either a real bug or a changed assumption, so read the message before changing code or checks.
