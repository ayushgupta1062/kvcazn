const { chromium } = require('playwright');
const base = (process.env.BASE_URL || 'http://127.0.0.1:8000/').replace(/\/?$/, '/');
const out = require('path').resolve(process.env.OUT_DIR || 'qa-out');
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const jobs = [
    ['decision-desktop', 'tab=decision&date=2026-01-14&gate=09:50&match=exact', { width: 1280, height: 900 }, 'light'],
    ['accuracy-desktop', 'tab=accuracy&date=2026-01-14&gate=09:50&match=exact', { width: 1280, height: 900 }, 'light'],
    ['method-desktop', 'tab=method&date=2026-01-14&gate=09:50&match=exact', { width: 1280, height: 900 }, 'light'],
    ['decision-mobile', 'tab=decision&date=2026-01-14&gate=09:50&match=exact', { width: 390, height: 844 }, 'light'],
    ['decision-dark', 'tab=decision&date=2026-01-14&gate=09:50&match=exact', { width: 1280, height: 900 }, 'dark'],
    ['decision-tablet', 'tab=decision&date=2026-01-14&gate=09:50&match=exact', { width: 768, height: 1000 }, 'light'],
    ['method-mobile', 'tab=method&date=2026-01-14&gate=09:50&match=exact', { width: 390, height: 844 }, 'light'],
    ['decision-320', 'tab=decision&date=2026-01-14&gate=09:50&match=exact', { width: 320, height: 700 }, 'light'],
    ['accuracy-320', 'tab=accuracy&date=2026-01-14&gate=09:50&match=exact', { width: 320, height: 700 }, 'light'],
    ['accuracy-mobile', 'tab=accuracy&date=2026-01-14&gate=09:50&match=exact', { width: 390, height: 844 }, 'light'],
  ];
  for (const [name, qs, viewport, scheme] of jobs) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(`[${name}] ${m.type()}: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[${name}] pageerror: ${e.message}`));
    await page.goto(base + '?' + qs, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    await ctx.close();
  }
  console.log(errors.length ? errors.join('\n') : 'no console errors/warnings');
  await browser.close();
})();
