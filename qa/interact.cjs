// Drives the built app in a real browser and asserts the interactions behave.
const { chromium } = require('playwright');
const base = (process.env.BASE_URL || 'http://127.0.0.1:8000/').replace(/\/?$/, '/');
const out = require('path').resolve(process.env.OUT_DIR || 'qa-out');
require('fs').mkdirSync(out, { recursive: true });
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', locale: 'en-GB', timezoneId: 'Europe/London' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto(base + '?tab=decision&date=2026-01-14&gate=09:50&match=exact', { waitUntil: 'networkidle' });

  const heroFigure = async () => (await page.locator('.hero-figure').innerText()).replace(/\s+/g, ' ');
  const heroNote = async () => (await page.locator('.hero-note').first().innerText()).replace(/\s+/g, ' ');
  const caption = async () => (await page.locator('.gate figcaption').innerText()).replace(/\s+/g, ' ');
  const flag = async () => (await page.locator('.gate-flag').innerText()).trim();
  const url = () => new URL(page.url()).searchParams;
  const settle = () => page.waitForTimeout(450);

  // ---- initial state
  check('hero shows a value', /\d+\.\d\s*GW/.test(await heroFigure()), await heroFigure());
  check('gate flag shows 09:50', (await flag()) === 'Gate 09:50', await flag());
  check('caption names the 09:30 version', (await caption()).includes('Using the 09:30 forecast, issued 20 min before'), await caption());

  // ---- drag the gate to ~06:00 (slider spans the track)
  const track = page.locator('.gate-track');
  const box = await track.boundingBox();
  const xAt = (hh, mm = 0) => box.x + ((hh * 60 + mm) / 1440) * box.width;
  const yMid = box.y + box.height / 2;
  await page.mouse.move(xAt(9, 50), yMid);
  await page.mouse.down();
  await page.mouse.move(xAt(8, 0), yMid, { steps: 6 });
  await page.mouse.move(xAt(6, 0), yMid, { steps: 6 });
  await page.mouse.up();
  await settle();
  const draggedFlag = await flag();
  check('dragging moves the gate near 06:00', /Gate 0[56]:\d\d/.test(draggedFlag), draggedFlag);
  check('URL follows the gate', /^0[56]:\d\d$/.test(url().get('gate') || ''), String(url().get('gate')));
  check('caption now uses the 04:30 version', (await caption()).includes('Using the 04:30 forecast'), await caption());
  check('time box follows the slider', /^0[56]:\d\d$/.test(await page.locator('#gate-time').inputValue()), await page.locator('#gate-time').inputValue());
  await page.screenshot({ path: `${out}/int-gate-0600.png`, clip: { x: 0, y: 560, width: 1280, height: 340 } });

  // ---- keyboard on the slider: ArrowRight adds 5 minutes
  const slider = page.locator('.gate-slider');
  await slider.focus();
  const before = (await flag()).replace('Gate ', '');
  await page.keyboard.press('ArrowRight');
  await settle();
  const after = (await flag()).replace('Gate ', '');
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  check('ArrowRight moves the gate 5 minutes later', toMin(after) - toMin(before) === 5, `${before} -> ${after}`);

  // ---- typing a time
  const timeBox = page.locator('#gate-time');
  await timeBox.fill('0920');
  await timeBox.press('Enter');
  await settle();
  check('typing 0920 + Enter sets 09:20', (await flag()) === 'Gate 09:20' && (await timeBox.inputValue()) === '09:20', `${await flag()} / ${await timeBox.inputValue()}`);
  check('EPEX preset shows pressed', (await page.locator('.seg button', { hasText: 'EPEX' }).getAttribute('aria-pressed')) === 'true');
  check('URL gate=09:20', url().get('gate') === '09:20', String(url().get('gate')));
  check('caption uses the 07:30 version at 09:20', (await caption()).includes('Using the 07:30 forecast'), await caption());
  await timeBox.fill('99:99');
  await timeBox.press('Tab');
  check('invalid time snaps back', (await timeBox.inputValue()) === '09:20', await timeBox.inputValue());
  await timeBox.fill('23:5');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  check('half-typed time snaps back on blur', (await timeBox.inputValue()) === '09:20', await timeBox.inputValue());
  await timeBox.focus();
  await timeBox.press('ArrowUp');
  await settle();
  check('ArrowUp in the time box adds 5 minutes', (await timeBox.inputValue()) === '09:25', await timeBox.inputValue());

  // ---- preset
  await page.locator('.seg button', { hasText: 'N2EX' }).click();
  await settle();
  check('N2EX preset returns to 09:50', (await flag()) === 'Gate 09:50' && url().get('gate') === '09:50');

  // ---- late gate: flag flips to the left of the line and stays inside the track
  await timeBox.fill('23:30');
  await timeBox.press('Enter');
  await settle();
  const flagBox = await page.locator('.gate-flag').boundingBox();
  check('late gate: flag stays inside the strip', flagBox.x >= box.x && flagBox.x + flagBox.width <= box.x + box.width + 1, JSON.stringify({ fx: Math.round(flagBox.x), fr: Math.round(flagBox.x + flagBox.width), tr: Math.round(box.x + box.width) }));
  check('late gate: "Can\'t be used" hides when there is no room', (await page.locator('.gate-after span').count()) === 0);
  await page.screenshot({ path: `${out}/int-gate-2330.png`, clip: { x: 0, y: 560, width: 1280, height: 340 } });

  // ---- gate before the first forecast of the day
  await timeBox.fill('00:10');
  await timeBox.press('Enter');
  await settle();
  check('early gate: caption explains the fallback', (await caption()).includes('Nothing was issued on'), await caption());
  await page.screenshot({ path: `${out}/int-gate-0010.png`, clip: { x: 0, y: 560, width: 1280, height: 340 } });

  // ---- date select + steppers
  await timeBox.fill('09:50');
  await timeBox.press('Enter');
  await settle();
  const dateSelect = page.locator('#decision-date');
  check('date select lists 31 days', (await dateSelect.locator('option').count()) === 31);
  await dateSelect.selectOption('2026-01-20');
  await settle();
  check('choosing a date updates the hero heading', (await page.locator('#hero-title').innerText()).includes('Wednesday 21 January'), await page.locator('#hero-title').innerText());
  await page.getByRole('button', { name: 'Next day' }).click();
  await settle();
  check('next day steps the date', url().get('date') === '2026-01-21', String(url().get('date')));
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await settle();
  check('previous day steps back', url().get('date') === '2026-01-19', String(url().get('date')));
  await dateSelect.selectOption('2026-01-01');
  check('first day disables Previous', await page.getByRole('button', { name: 'Previous day' }).isDisabled());
  await dateSelect.selectOption('2026-01-31');
  check('last day disables Next', await page.getByRole('button', { name: 'Next day' }).isDisabled());
  await settle();
  check('last decision day (31 Jan) loads a delivery day of 1 Feb', (await page.locator('#hero-title').innerText()).includes('Sunday 1 February'), await page.locator('#hero-title').innerText());
  await dateSelect.selectOption('2026-01-14');
  await settle();

  // ---- chart tooltip by pointer and by keyboard
  const chart = page.locator('.frame').nth(0).locator('.chart');
  await chart.scrollIntoViewIfNeeded();
  const cb = await chart.boundingBox();
  await page.mouse.move(cb.x + cb.width * 0.4, cb.y + 100);
  await page.waitForTimeout(200);
  const tipCount = await page.locator('.tip').count();
  const tipText = tipCount ? (await page.locator('.tip').first().innerText()).replace(/\s+/g, ' ') : '(none)';
  check('hovering the forecast chart shows a tooltip', tipCount === 1, tipText);
  await page.screenshot({ path: `${out}/int-tooltip.png`, clip: { x: 0, y: Math.max(0, cb.y - 120), width: 1280, height: Math.min(800 - 0, cb.height + 160) } });
  await page.mouse.move(5, 5);
  await chart.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  check('arrow keys drive the tooltip', (await page.locator('.tip').count()) === 1);
  await page.keyboard.press('Escape');
  check('Escape closes the tooltip', (await page.locator('.tip').count()) === 0);

  // ---- table twin
  await page.locator('.frame').nth(0).getByRole('button', { name: 'Table' }).click();
  const rows = await page.locator('.frame').nth(0).locator('tbody tr').count();
  check('table twin lists 24 hourly rows', rows === 24, String(rows));
  await page.locator('.frame').nth(0).getByRole('button', { name: 'Chart' }).click();
  check('toggle returns to the chart', (await page.locator('.frame').nth(0).locator('svg').count()) >= 1);
  await page.locator('.frame').nth(1).getByRole('button', { name: 'Table' }).click();
  const vrows = await page.locator('.frame').nth(1).locator('tbody tr').count();
  check('revisions table lists every version (11)', vrows === 11, String(vrows));
  await page.locator('.frame').nth(1).getByRole('button', { name: 'Chart' }).click();

  // ---- tabs
  await page.getByRole('button', { name: 'Forecast accuracy' }).click();
  await settle();
  check('accuracy tab shows six headline numbers', (await page.locator('.stat').count()) === 6, String(await page.locator('.stat').count()));
  check('decision-day control is hidden on accuracy', (await page.locator('#decision-date').count()) === 0);
  check('URL has tab=accuracy', url().get('tab') === 'accuracy');
  await page.getByRole('button', { name: 'Method' }).click();
  check('method tab renders its sections', (await page.locator('.ledger').count()) === 4, String(await page.locator('.ledger').count()));
  check('nav marks the current tab', (await page.locator('.nav-item[aria-current="page"]').innerText()) === 'Method');

  // ---- reload keeps the state (deep link)
  await page.goto(base + '?tab=accuracy&date=2026-01-05&gate=09:20&match=hourly_mean', { waitUntil: 'networkidle' });
  check('deep link restores gate', (await page.locator('#gate-time').inputValue()) === '09:20');
  check('deep link restores alignment', (await page.locator('#match').inputValue()) === 'hourly_mean');
  check('deep link opens the right tab', (await page.locator('.nav-item[aria-current="page"]').innerText()) === 'Forecast accuracy');
  check('accuracy reflects the EPEX gate', (await page.locator('main').innerText()).includes('at the 09:20 gate'));
  check('no console errors or warnings in the normal flows', problems.length === 0, problems.join(' | '));

  // ---- a hand-edited link with a bad tab, date and time falls back to sensible defaults
  await page.goto(base + '?tab=nonsense&date=2030-01-01&gate=25:99', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check('bad link: no error banner', (await page.locator('.status.error').count()) === 0);
  check('bad link: opens on Decision', (await page.locator('.nav-item[aria-current="page"]').innerText()) === 'Decision');
  check('bad link: date falls back inside January', /^2026-01-\d\d$/.test(await page.locator('#decision-date').inputValue()), await page.locator('#decision-date').inputValue());
  check('bad link: gate falls back to the default', (await page.locator('#gate-time').inputValue()) === '09:50', await page.locator('#gate-time').inputValue());
  check('bad link: URL is rewritten with valid values', url().get('gate') === '09:50' && /^2026-01-/.test(url().get('date') || ''), page.url());
  check('bad link: no console errors', problems.length === 0, problems.join(' | '));

  // ---- overflow at phone widths
  for (const width of [320, 390]) {
    const c2 = await browser.newContext({ viewport: { width, height: 800 }, locale: 'en-GB' });
    const p2 = await c2.newPage();
    for (const tab of ['decision', 'accuracy', 'method']) {
      await p2.goto(`${base}?tab=${tab}&date=2026-01-14&gate=09:50&match=exact`, { waitUntil: 'networkidle' });
      await p2.waitForTimeout(300);
      const wide = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      check(`no horizontal scroll at ${width}px on ${tab}`, wide.sw <= wide.iw, JSON.stringify(wide));
    }
    await p2.goto(`${base}?tab=decision&date=2026-01-14&gate=09:50&match=exact`, { waitUntil: 'networkidle' });
    await p2.waitForTimeout(300);
    await p2.screenshot({ path: `${out}/int-phone-${width}.png`, fullPage: true });
    await c2.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
