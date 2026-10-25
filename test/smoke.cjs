// End-to-end smoke test for Daily OS. Guards the layout contract and every behavior.
// Run: NODE_PATH=$(npm root -g) node test/smoke.cjs   (needs Playwright + Chromium)
// Screenshots go to $SHOTS (default: <tmp>/daily-os-shots).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'daily-os-shots');
const NOW = '2026-10-26T13:07:00-05:00'; // Monday 1:07 PM, Chicago -> day key 2026-10-26, offset 427
const DAY = '2026-10-26';
fs.mkdirSync(SHOTS, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const serve = () => new Promise((res) => {
  const s = http.createServer((req, rsp) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
    rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(rsp);
  });
  s.listen(0, () => res(s));
});

const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  [' + extra + ']' : ''}`); return cond; };

const CATS = [
  { id: 'work', name: 'Work', color: '#2563eb', drift: false }, { id: 'career', name: 'Career', color: '#059669', drift: false },
  { id: 'self', name: 'Self', color: '#ea580c', drift: false }, { id: 'life', name: 'Life', color: '#7c3aed', drift: false },
  { id: 'drift', name: 'Drift', color: '#dc2626', drift: true }];
const B = (id, layer, cat, title, start, end, day = DAY) => ({ id, day, layer, cat, title, note: '', seq: 0, start, end });
const FIXTURE = { v: 2, cats: CATS, timer: null, lastCat: 'work', lot: [], gapSkip: [], blocks: [
  B('p1', 'plan', 'work', 'Model comments', 180, 240), B('p2', 'plan', 'work', 'Deck turn', 420, 480),
  B('p3', 'plan', 'career', 'Coffee chat', 540, 600), B('p4', 'plan', 'self', 'Reading', 1380, 1425),
  B('a1', 'actual', 'work', 'Work', 180, 225), B('a2', 'actual', 'drift', 'Drift', 240, 270), B('a3', 'actual', 'life', 'Life', 300, 330),
  B('w1', 'plan', 'work', 'Work', 180, 420, '2026-10-19'), B('w2', 'actual', 'work', 'Work', 180, 360, '2026-10-19'), B('w3', 'actual', 'drift', 'Drift', 360, 420, '2026-10-19')] };
const seed = (data, extra = '') => `(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.clear(); ${data == null ? '' : `localStorage.setItem('dailyos', ${JSON.stringify(typeof data === 'string' ? data : JSON.stringify(data))});`} ${extra} } })();`;

(async () => {
  const server = await serve();
  const BASE = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();

  async function open(w, hgt, { data = FIXTURE, extra = '', dark = false, mobile = false, sw = 'block', clock = true } = {}) {
    const c = await browser.newContext({ viewport: { width: w, height: hgt }, hasTouch: true, isMobile: mobile, deviceScaleFactor: 1, timezoneId: 'America/Chicago', serviceWorkers: sw, colorScheme: dark ? 'dark' : 'light', acceptDownloads: true });
    if (clock) await c.clock.setFixedTime(new Date(NOW));
    await c.addInitScript(seed(data, extra));
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(BASE);
    await p.waitForTimeout(400);
    return { c, p, errs };
  }
  const box = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), vis: !!(r.width && r.height) }; }, sel);
  const label = (p) => p.$eval('#dayLabel', (e) => e.firstChild.textContent);
  const st = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('dailyos')));
  const blk = async (p, id) => (await st(p)).blocks.find((b) => b.id === id);
  const toastText = (p) => p.$eval('#toast span', (e) => e.textContent);
  const esc = (p) => p.keyboard.press('Escape');
  const seeMin = (p, min) => p.evaluate((m) => { document.querySelector('#scroller').scrollTop = Math.max(0, (m / 15) * 28 - 220); }, min);
  const slotXY = (p, layer, min) => p.evaluate(([l, m]) => { const r = document.querySelector(`.col.${l}`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + (m / 15) * 28 + 8 }; }, [layer, min]);
  const center = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 10) }; });
  async function mouseDrag(p, from, to, steps = 10) {
    await p.mouse.move(from.x, from.y); await p.mouse.down();
    for (let i = 1; i <= steps; i++) { await p.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await p.waitForTimeout(12); }
    await p.mouse.up(); await p.waitForTimeout(150);
  }
  async function touchPath(c, p, pts, holdMs = 0) {
    const cdp = await c.newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
    if (holdMs) await p.waitForTimeout(holdMs);
    for (let i = 1; i < pts.length; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pts[i]] }); await p.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(300);
  }
  const line = (a, b, n = 8) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
  async function layout(p, w, hgt, tag) {
    const rail = await box(p, '#rail'), main = await box(p, '#main'), bar = await box(p, '#bar'), pc = await box(p, '.col.plan'), ac = await box(p, '.col.actual');
    ok(`${tag}: rail at x=0, 280px wide`, rail.x === 0 && rail.w === 280, JSON.stringify(rail));
    ok(`${tag}: grid fills the right side`, main.x === 280 && main.w === w - 280, JSON.stringify(main));
    ok(`${tag}: bar is 44px tall`, bar.h === 44, bar.h);
    ok(`${tag}: Plan and Actual equal width`, Math.abs(pc.w - ac.w) <= 1 && pc.x < ac.x, `${pc.w} vs ${ac.w}`);
    const ys = await p.evaluate(() => ['#dayLabel', '#month', '#todayBtn', '#cap', '#copyBtn', '.tbtn'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
    ok(`${tag}: rail order nav → month → Today/Export → capacity → Plan→Actual/Fire drill → timers`, ys.every((y, i) => !i || y > ys[i - 1]), ys.join(','));
    const rows = await p.evaluate(() => [['#todayBtn', '#menuBtn'], ['#copyBtn', '#fireBtn']].map(([a, b]) => Math.round(document.querySelector(a).getBoundingClientRect().top) === Math.round(document.querySelector(b).getBoundingClientRect().top)));
    ok(`${tag}: paired buttons share a row`, rows.every(Boolean));
    ok(`${tag}: no phone tab bar`, !(await p.$('#tabs')) && !(await p.$('#pane-timer')));
    ok(`${tag}: month shows 42 days`, (await p.$$('#month .mday')).length === 42);
  }

  // ======================= iPad landscape: full run =======================
  {
    const { c, p, errs } = await open(1180, 820);
    await layout(p, 1180, 820, '1180×820');
    const last = await p.evaluate(() => { const r = [...document.querySelectorAll('#timers .tbtn')].at(-1).getBoundingClientRect(); return { b: Math.round(r.bottom) }; });
    ok('1180×820: all 5 timers visible without scrolling', last.b <= 820, `last timer bottom ${last.b}`);
    await p.screenshot({ path: path.join(SHOTS, '01-ipad-planner.png') });

    // --- Fill the gaps ---
    ok('gaps: chip shows untracked total', (await p.$eval('#gapChip', (e) => !e.hidden && e.textContent)) === '2h untracked', await p.$eval('#gapChip', (e) => e.textContent));
    await p.click('#gapChip');
    const rows = await p.$$eval('.pop .gap b', (els) => els.map((e) => e.textContent));
    ok('gaps: sheet lists both stretches', rows.length === 2 && rows[0].startsWith('10:30') && rows[1].startsWith('11:30'), rows.join(' | '));
    await p.screenshot({ path: path.join(SHOTS, '02-gaps.png') });
    await p.click('.pop .gap >> nth=0 >> .chip[data-cat="drift"]');
    const filled = (await st(p)).blocks.find((b) => b.layer === 'actual' && b.start === 270 && b.end === 300);
    ok('gaps: tapping a category logs the whole stretch', !!filled && filled.cat === 'drift' && filled.title === 'Drift');
    await p.click('.pop .gap >> nth=0 >> button.link');
    ok('gaps: skip removes it and closes when done', (await p.$$('.pop')).length === 0 && (await p.$eval('#gapChip', (e) => e.hidden)));
    ok('gaps: skip is remembered', (await st(p)).gapSkip.includes(`${DAY}|330|420`));

    // --- Tap to create + popover ---
    await seeMin(p, 375);
    let xy = await slotXY(p, 'plan', 375);
    const n0 = (await st(p)).blocks.length;
    await p.mouse.click(xy.x, xy.y);
    await p.waitForTimeout(150);
    let s = await st(p), nb = s.blocks.find((b) => b.layer === 'plan' && b.start === 375);
    ok('tap empty slot creates a 30-min block in the last category', s.blocks.length === n0 + 1 && nb && nb.end === 405 && nb.cat === 'work' && nb.title === 'Work');
    ok('tap opens the edit popover', (await p.$$('.pop[aria-label="Edit block"]')).length === 1);
    await p.fill('.pop input[type=text]', 'Inbox zero');
    await p.click('.pop .chip[data-cat="career"]');
    await p.click('.pop [aria-label="End more"]');
    nb = await blk(p, nb.id);
    ok('popover edits title, category and end time', nb.title === 'Inbox zero' && nb.cat === 'career' && nb.end === 420, JSON.stringify(nb));
    await p.click('.pop [aria-label="End more"]');
    ok('popover blocks overlapping resize', (await blk(p, nb.id)).end === 420 && (await toastText(p)) === 'Overlaps another block');
    await p.click('.pop button.danger');
    ok('delete removes the block', !(await blk(p, nb.id)));
    await p.click('#toast button');
    ok('delete has Undo', !!(await blk(p, nb.id)));

    // --- Drag move / overlap revert / resize (mouse = immediate) ---
    await seeMin(p, 540);
    let from = await center(p, '#grid [data-id="p3"]');
    await mouseDrag(p, from, { x: from.x, y: from.y + 56 });
    ok('drag moves a block in 15-min steps', JSON.stringify([(await blk(p, 'p3')).start, (await blk(p, 'p3')).end]) === '[570,630]');
    from = await center(p, '#grid [data-id="p3"]');
    await mouseDrag(p, from, { x: from.x, y: from.y - 28 * 7 });
    ok('drag onto another block reverts', (await blk(p, 'p3')).start === 570 && (await toastText(p)) === 'Overlaps another block');
    const rh = await p.$eval('#grid [data-id="p3"] .rh', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await mouseDrag(p, rh, { x: rh.x, y: rh.y + 28 });
    ok('resize handle stretches the block', (await blk(p, 'p3')).end === 645);

    // --- Timers ---
    await p.click('#timers .tbtn[data-cat="work"]');
    ok('timer starts', (await st(p)).timer && (await st(p)).timer.cat === 'work' && (await p.$eval('#timers .tbtn[data-cat="work"]', (e) => e.classList.contains('on'))));
    ok('running timer shows in Actual', (await p.$$('#run')).length === 1);
    await p.click('#timers .tbtn[data-cat="self"]');
    ok('tapping another timer switches', (await st(p)).timer.cat === 'self' && (await toastText(p)).includes('Under 15 min, not logged'));
    await p.click('#timers .tbtn[data-cat="self"]');
    ok('tapping again stops', (await st(p)).timer === null);

    // --- Month, Today, swipe ---
    await p.click('#month .mday[data-key="2026-10-15"]');
    ok('month: tap a date jumps there', (await label(p)) === 'Thu, Oct 15');
    await p.click('#month .mhead button[aria-label="Next month"]');
    ok('month: arrows change month only', (await p.$eval('#month .mhead b', (e) => e.textContent)) === 'November 2026' && (await label(p)) === 'Thu, Oct 15');
    await p.click('#todayBtn');
    ok('Today returns to today', (await label(p)) === 'Mon, Oct 26');
    await seeMin(p, 700);
    const sc = await box(p, '#scroller'), pcol = await box(p, '.col.plan');
    const sx = pcol.x + pcol.w / 2, sy = sc.y + 200, nb0 = (await st(p)).blocks.length;
    await touchPath(c, p, line({ x: sx, y: sy }, { x: sx - 170, y: sy + 6 }));
    ok('swipe left → next day', (await label(p)) === 'Tue, Oct 27', await label(p));
    await touchPath(c, p, line({ x: sx - 100, y: sy }, { x: sx + 90, y: sy - 4 }));
    ok('swipe right → previous day', (await label(p)) === 'Mon, Oct 26');
    await touchPath(c, p, line({ x: sx, y: sy + 200 }, { x: sx + 8, y: sy - 60 }));
    ok('vertical drag does not change day', (await label(p)) === 'Mon, Oct 26');
    ok('swipes create no blocks', (await st(p)).blocks.length === nb0);

    // --- Parking lot ---
    await p.click('#lotBtn');
    const lot = await box(p, '#lot'), act = await box(p, '.col.actual');
    ok('lot: panel exactly covers the Actual column', Math.abs(lot.x - act.x) <= 2 && Math.abs(lot.x + lot.w - (act.x + act.w)) <= 2, `${JSON.stringify(lot)} vs ${JSON.stringify(act)}`);
    ok('lot: Plan stays visible', (await box(p, '.col.plan')).x + (await box(p, '.col.plan')).w <= lot.x + 1);
    await p.type('#lotIn', 'call franchise 15 mins');
    ok('lot: live preview of the parse', (await p.$eval('#lotHint', (e) => e.textContent)) === '→ call franchise · 15m');
    await p.press('#lotIn', 'Enter');
    ok('lot: Enter saves and clears for the next line', (await p.$eval('#lotIn', (e) => e.value === '' && document.activeElement === e)) && (await st(p)).lot.length === 1);
    for (const t of ['#Career update resume 45 min', 'LBO practice 2h', 'email lender']) { await p.fill('#lotIn', t); await p.press('#lotIn', 'Enter'); }
    const secs = await p.$$eval('#lotList .lsec', (els) => els.map((s) => [s.querySelector('h4 span').textContent, [...s.querySelectorAll('.itxt')].map((x) => x.textContent)]));
    ok('lot: sorted into Quick / Medium / Long, shortest first', JSON.stringify(secs) === JSON.stringify([['Quick · 30m or less', ['call franchise', 'email lender']], ['Medium · 45–75m', ['update resume']], ['Long · 90m+', ['LBO practice']]]), JSON.stringify(secs));
    const tagged = await p.$eval('#lotList .item.tagged', (e) => [e.querySelector('.itxt').textContent, e.querySelector('.itag').textContent, e.style.getPropertyValue('--c')]);
    ok('lot: #Career links and colors the task', JSON.stringify(tagged) === JSON.stringify(['update resume', 'Career', '#059669']), JSON.stringify(tagged));
    ok('lot: untimed task shows ~30m', (await p.$$eval('#lotList .idur', (els) => els.map((e) => e.textContent))).includes('~30m'));
    ok('lot: count on the bar button', (await p.$eval('#lotCount', (e) => e.textContent)) === '4');
    await p.screenshot({ path: path.join(SHOTS, '03-parking-lot.png') });
    // untagged -> prompts for a category
    await seeMin(p, 300);
    const itemXY = (txt) => p.$eval(`#lotList .item:has(.itxt:text-is("${txt}"))`, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; }).catch(() => null);
    await mouseDrag(p, await itemXY('call franchise'), await slotXY(p, 'plan', 300), 12);
    s = await st(p);
    let sb = s.blocks.find((b) => b.layer === 'plan' && b.start === 300);
    ok('lot: drop creates a block of the task’s length', !!sb && sb.end === 315 && sb.title === 'call franchise' && !s.lot.some((x) => x.text === 'call franchise'));
    ok('lot: untagged drop asks “Which category?”', (await p.$eval('.pop .ask', (e) => e.textContent).catch(() => '')) === 'Which category?');
    await p.click('.pop .chip[data-cat="life"]');
    ok('lot: picking a category closes the prompt', (await blk(p, sb.id)).cat === 'life' && (await p.$$('.pop')).length === 0);
    // tagged -> no prompt
    await seeMin(p, 660);
    await mouseDrag(p, await itemXY('update resume'), await slotXY(p, 'plan', 660), 12);
    sb = (await st(p)).blocks.find((b) => b.layer === 'plan' && b.start === 660);
    ok('lot: #tagged drop lands categorized with no prompt', !!sb && sb.end === 705 && sb.cat === 'career' && (await p.$$('.pop')).length === 0);
    // overlap -> rejected
    await seeMin(p, 180);
    await mouseDrag(p, await itemXY('LBO practice'), await slotXY(p, 'plan', 180), 12);
    ok('lot: drop onto a taken slot is rejected', (await toastText(p)) === 'That slot is taken' && (await st(p)).lot.some((x) => x.text === 'LBO practice'));
    // touch long-press drag never triggers a swipe
    await seeMin(p, 720);
    const tFrom = await itemXY('email lender'), tTo = await slotXY(p, 'plan', 750);
    await touchPath(c, p, line(tFrom, tTo, 12), 350);
    sb = (await st(p)).blocks.find((b) => b.layer === 'plan' && b.start === 750);
    ok('lot: touch long-press drag schedules', !!sb && sb.title === 'email lender', sb ? '' : 'no block');
    ok('lot: lot drag never changes the day', (await label(p)) === 'Mon, Oct 26');
    if (await p.$('.pop')) await esc(p);
    // tap item -> edit popover; delete + undo
    await p.click('#lotList .item .itxt');
    ok('lot: tap a task to edit it', (await p.$$('.pop[aria-label="Edit task"]')).length === 1);
    await p.click('.pop [aria-label="Time more"]');
    await p.click('.pop .chip[data-cat="self"]');
    let li = (await st(p)).lot.find((x) => x.text === 'LBO practice');
    ok('lot: edit time and category', li.min === 135 && li.cat === 'self');
    await p.click('.pop button.primary');
    await p.click('#lotList .item .idel');
    ok('lot: ✕ deletes', (await st(p)).lot.length === 0);
    await p.click('#toast button');
    ok('lot: delete has Undo', (await st(p)).lot.length === 1);
    // block -> back to the lot
    await seeMin(p, 540);
    await p.click('#grid [data-id="p3"] .bt');
    await p.click('.pop >> text=Move to parking lot');
    li = (await st(p)).lot.find((x) => x.text === 'Coffee chat');
    ok('lot: Move to parking lot keeps title, length, category', !!li && li.min === 75 && li.cat === 'career' && !(await blk(p, 'p3')));

    // --- Categories ---
    await p.click('#timers .thead button');
    ok('categories: Edit opens the editor', (await p.$$('.pop[aria-label="Categories"] .crow-e')).length === 5);
    await p.screenshot({ path: path.join(SHOTS, '04-categories.png') });
    await p.click('.pop >> text=+ Add category');
    ok('categories: new category is focused for naming', await p.evaluate(() => document.activeElement && document.activeElement.value === 'New category'));
    await p.keyboard.type('Satsang');
    const names = await p.$$eval('#timers .tbtn .tn', (els) => els.map((e) => e.textContent));
    ok('categories: added live to the timers', names.at(-1) === 'Satsang', names.join(','));
    const satId = (await st(p)).cats.at(-1).id, col0 = (await st(p)).cats.at(-1).color;
    await p.click(`.pop .crow-e:has([data-cid="${satId}"]) .swatch`);
    ok('categories: tap the swatch to recolor', (await st(p)).cats.at(-1).color !== col0);
    await p.click(`.pop [aria-label="Move Satsang up"]`);
    ok('categories: reorder', (await st(p)).cats.at(-2).id === satId);
    await p.fill('.pop [data-cid="career"]', 'Recruiting');
    s = await st(p);
    ok('categories: rename updates timers, keeps custom titles', s.cats.find((x) => x.id === 'career').name === 'Recruiting' && (await p.$eval('#timers [data-cat="career"] .tn', (e) => e.textContent)) === 'Recruiting' && s.lot.find((x) => x.text === 'Coffee chat').cat === 'career');
    await p.click('.pop [aria-label="Delete Life"]');
    ok('categories: deleting a used category asks where its blocks go', (await p.$eval('.pop h3', (e) => e.textContent)) === 'Delete Life?');
    await p.click('.pop .chip[data-cat="self"]');
    s = await st(p);
    const a3 = s.blocks.find((b) => b.id === 'a3');
    ok('categories: blocks move and default titles follow', !s.cats.some((x) => x.id === 'life') && a3.cat === 'self' && a3.title === 'Self');
    await p.click('#toast button');
    ok('categories: delete has Undo', (await st(p)).cats.some((x) => x.id === 'life') && (await blk(p, 'a3')).cat === 'life');
    await p.click('.pop button.primary');
    await p.fill('#lotIn', '#recruiting prep 20 min');
    await p.press('#lotIn', 'Enter');
    ok('categories: #hashtags follow renamed categories', (await st(p)).lot.find((x) => x.text === 'prep').cat === 'career');
    await p.click('#lotClose');
    ok('lot: Done closes the panel', await p.$eval('#lot', (e) => e.hidden));

    // --- Fire drill ---
    await p.click('#fireBtn');
    ok('fire drill: sheet opens', (await p.$$('.pop[aria-label="Fire drill"]')).length === 1);
    await p.click('.pop .seg >> text="30m"');
    const prev = await p.$eval('.pop[aria-label="Fire drill"] p.muted:last-of-type', (e) => e.textContent);
    ok('fire drill: preview explains the move', /^Moves \d+ blocks? from 1:15 PM · splits “Deck turn” · 1 won’t fit → Parking lot$/.test(prev), prev);
    await p.screenshot({ path: path.join(SHOTS, '05-fire-drill.png') });
    const before = await st(p);
    await p.click('.pop >> text="Apply"');
    s = await st(p);
    const head = s.blocks.find((b) => b.id === 'p2'), tail = s.blocks.find((b) => b.title === 'Deck turn' && b.id !== 'p2');
    ok('fire drill: in-progress block splits at the cutoff', head.end === 435 && tail && tail.start === 465 && tail.end === 510, JSON.stringify([head, tail]));
    ok('fire drill: later blocks move back 30m', s.blocks.find((b) => b.title === 'update resume').start === 690);
    ok('fire drill: what no longer fits goes to the lot', s.lot.some((x) => x.text === 'Reading' && x.min === 45 && x.cat === 'self') && !s.blocks.some((b) => b.id === 'p4'));
    ok('fire drill: earlier blocks untouched', s.blocks.find((b) => b.id === 'p1').start === 180);
    ok('fire drill: starts a Work timer', s.timer && s.timer.cat === 'work');
    await p.click('#toast button');
    s = await st(p);
    ok('fire drill: Undo restores plan, lot and timer', JSON.stringify(s.blocks) === JSON.stringify(before.blocks) && s.lot.length === before.lot.length && s.timer === null);
    await p.click('#next');
    ok('fire drill: dimmed when not today', await p.$eval('#fireBtn', (e) => e.classList.contains('off')));
    await p.click('#fireBtn');
    ok('fire drill: explains when unavailable', (await toastText(p)) === 'Fire drill works on today’s remaining plan' && (await p.$$('.pop')).length === 0);
    await p.click('#todayBtn');

    // --- Copy plan -> actual ---
    await p.click('#copyBtn');
    ok('Plan → Actual copies what fits', /^Copied \d+, skipped \d+ \(overlap\)$/.test(await toastText(p)), await toastText(p));

    // --- Export .ics, backup ---
    await p.click('#menuBtn');
    let [dl] = await Promise.all([p.waitForEvent('download'), p.click('.pop >> text=Download .ics')]);
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    ok('export: .ics has events with category names', ics.includes('BEGIN:VEVENT') && ics.includes('CATEGORIES:Recruiting') && ics.includes('TRIGGER;RELATED=END:-PT5M'));
    ok('export: SEQUENCE bumps after export', (await blk(p, 'p1')).seq === 1);
    [dl] = await Promise.all([p.waitForEvent('download'), p.click('.pop >> text=Back up (JSON)')]);
    const bk = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    ok('backup: JSON in the new format', bk.v === 2 && bk.cats.length === 6 && Array.isArray(bk.lot));
    // restore an old v3 backup (v:1 ids) with Undo
    const v3file = path.join(SHOTS, 'v3-backup.json');
    fs.writeFileSync(v3file, JSON.stringify({ v: 1, timer: null, lastCat: 'job', blocks: [B('o1', 'plan', 'job', 'Job', 0, 60), B('o2', 'actual', 'dev', 'Development', 60, 120)] }));
    let [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.pop >> text=Restore…')]);
    await fc.setFiles(v3file); await p.waitForTimeout(300);
    s = await st(p);
    ok('restore: old backups load and migrate', (await toastText(p)) === 'Restored 2 blocks' && s.blocks.map((b) => b.cat + ':' + b.title).join() === 'work:Work,self:Self');
    await p.click('#toast button');
    ok('restore: Undo brings back current data', (await st(p)).blocks.length === bk.blocks.length);
    // merge from iPhone
    await p.click('#menuBtn');
    const phone = path.join(SHOTS, 'iphone.json');
    fs.writeFileSync(phone, JSON.stringify({ v: 2, cats: [...CATS, { id: 'cx', name: 'Gym', color: '#0891b2', drift: false }], timer: null, lastCat: 'work', lot: [], gapSkip: [],
      blocks: [B('p1', 'plan', 'work', 'dup', 180, 240), B('ph1', 'actual', 'cx', 'Gym', 1200, 1260), B('ph2', 'actual', 'self', 'Clash', 300, 330)] }));
    [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.pop >> text=Merge from iPhone…')]);
    await fc.setFiles(phone); await p.waitForTimeout(300);
    s = await st(p);
    ok('merge: adds new blocks (and their category), skips dup + overlap', (await toastText(p)) === 'Merged 1 block · 1 skipped (overlap)' && s.blocks.some((b) => b.id === 'ph1') && s.cats.some((x) => x.id === 'cx'), await toastText(p));
    await p.click('#toast button');
    s = await st(p);
    ok('merge: Undo', !s.blocks.some((b) => b.id === 'ph1') && !s.cats.some((x) => x.id === 'cx'));

    // --- Dashboard ---
    await p.click('#bar .tab[data-mode="dash"]');
    ok('dashboard: replaces the grid, rail stays', (await box(p, '#dash')).vis && !(await box(p, '#planner')).vis && (await box(p, '#rail')).vis && !(await box(p, '#lotBtn')).vis);
    ok('dashboard: week header', (await p.$eval('#dash h2', (e) => e.textContent)) === 'Week of Oct 25 – Oct 31');
    const k = await p.$$eval('#dash .kpi', (els) => els.map((e) => e.querySelector('.k').textContent));
    ok('dashboard: 4 KPI tiles', k.join('|') === 'Logged|Coverage|Plan accuracy|Drift', k.join('|'));
    ok('dashboard: daily bars for 7 days', (await p.$$('#dash .card svg .ch-hit')).length >= 7 && (await p.$$eval('#dash .card', (cs) => [...cs[0].querySelectorAll('svg text.ch-ax')].filter((e) => /^[A-Z][a-z]{2} \d+$/.test(e.textContent)).length)) === 7);
    ok('dashboard: category table row per category', (await p.$$('#dash .crow')).length === 6);
    ok('dashboard: 3 eight-week trends', (await p.$$('#dash .spark svg')).length === 3);
    ok('dashboard: no NaN/undefined anywhere', !/NaN|undefined|Infinity/.test(await p.$eval('#dash', (e) => e.textContent)));
    const hit = await p.$$('#dash .ch-hit');
    const hb = await hit[1].boundingBox();
    await p.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2);
    ok('dashboard: tap a day for details', (await p.$eval('#tip', (e) => !e.hidden && e.textContent)).startsWith('Mon, Oct 26'), await p.$eval('#tip', (e) => e.textContent));
    await p.screenshot({ path: path.join(SHOTS, '06-dashboard-week.png'), fullPage: false });
    await p.evaluate(() => { document.querySelector('#dash').scrollTop = 9999; });
    await p.screenshot({ path: path.join(SHOTS, '07-dashboard-week-bottom.png') });
    await p.click('#dash .seg >> text=Day');
    ok('dashboard: day view', (await p.$eval('#dash h2', (e) => e.textContent)) === 'Mon, Oct 26' && (await p.$$('#dash .kpi')).length === 4);
    await p.screenshot({ path: path.join(SHOTS, '08-dashboard-day.png') });
    await p.click('#month .mday[data-key="2026-10-19"]');
    ok('dashboard: rail calendar picks the period', (await p.$eval('#dash h2', (e) => e.textContent)) === 'Mon, Oct 19');
    await p.click('#bar .tab[data-mode="plan"]');
    ok('planner tab returns to the grid', (await box(p, '#planner')).vis && (await p.$$('#grid .blk')).length > 0);
    ok('1180×820: no console errors', errs.length === 0, errs.join(' | '));
    await c.close();
  }

  // ======================= Dark mode =======================
  {
    const { c, p, errs } = await open(1180, 820, { dark: true });
    await p.click('#lotBtn'); await p.fill('#lotIn', 'update resume 45 min #Career'); await p.press('#lotIn', 'Enter');
    await p.screenshot({ path: path.join(SHOTS, '09-dark-planner.png') });
    await p.click('#bar .tab[data-mode="dash"]');
    await p.screenshot({ path: path.join(SHOTS, '10-dark-dashboard.png') });
    ok('dark: no console errors', errs.length === 0, errs.join(' | '));
    await c.close();
  }

  // ======================= Other iPad sizes =======================
  for (const [w, hgt, shot] of [[820, 1180, '11-ipad-portrait.png'], [744, 1133, '12-ipad-mini.png']]) {
    const { c, p, errs } = await open(w, hgt);
    await layout(p, w, hgt, `${w}×${hgt}`);
    await p.screenshot({ path: path.join(SHOTS, shot) });
    ok(`${w}×${hgt}: no console errors`, errs.length === 0, errs.join(' | '));
    await c.close();
  }
  {
    const { c, p } = await open(1133, 744);
    const t = await box(p, '#timers'), last = await p.evaluate(() => { const r = [...document.querySelectorAll('#timers .tbtn')].at(-1).getBoundingClientRect(); return { b: Math.round(r.bottom) }; });
    ok('iPad mini landscape: timers fit or scroll inside their list', last.b <= 744 || (t.b <= 744 && (await p.$eval('#timers', (e) => e.scrollHeight > e.clientHeight))), `last ${last.b}, list bottom ${t.b}`);
    await c.close();
  }

  // ======================= iPhone =======================
  {
    const { c, p, errs } = await open(390, 844, { mobile: true });
    ok('phone: no tab bar or Timer tab', !(await p.$('#tabs')) && !(await p.$('#pane-timer')));
    const top = await box(p, '#top'), tm = await box(p, '#timers'), bar = await box(p, '#bar');
    ok('phone: stacked layout (top bar, grid, timer strip)', top.y === 0 && tm.b === 844 && bar.y >= top.b - 1, `${JSON.stringify(top)} ${JSON.stringify(tm)}`);
    await p.click('#timers .tbtn[data-cat="drift"]');
    ok('phone: timers usable', (await st(p)).timer.cat === 'drift');
    ok('phone: category Edit reachable', (await box(p, '#timers .tedit')) !== null);
    await p.screenshot({ path: path.join(SHOTS, '13-phone.png') });
    await p.click('#dayLabel');
    ok('phone: date opens month sheet', (await p.$$('.pop .month')).length === 1);
    await esc(p);
    await p.click('#lotBtn');
    ok('phone: parking lot opens full width', (await box(p, '#lot')).w === 390);
    ok('phone: no console errors', errs.length === 0, errs.join(' | '));
    await c.close();
  }

  // ======================= Data safety =======================
  {
    const v1 = { v: 1, lastCat: 'job', timer: null, blocks: [B('o1', 'plan', 'job', 'Job', 180, 240), B('o2', 'plan', 'personal', 'Gym', 240, 300)] };
    const { c, p, errs } = await open(1180, 820, { data: v1 });
    const titles = await p.$$eval('#grid .blk .bt', (els) => els.map((e) => e.textContent));
    ok('data: v1 data with old categories loads', titles.join() === 'Work,Gym', titles.join());
    ok('data: untouched v1 original kept as dailyos.pre-v2', await p.evaluate(() => JSON.parse(localStorage.getItem('dailyos.pre-v2')).v === 1));
    ok('data: v1 load has no console errors', errs.length === 0, errs.join(' | '));
    await c.close();
  }
  {
    const bad = JSON.stringify({ v: 2, cats: [], blocks: [{ id: 1 }] });
    const { c, p } = await open(1180, 820, { data: bad });
    await p.waitForTimeout(800);
    const kept = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dailyos.bad-')).map((k) => localStorage.getItem(k)));
    ok('data: unreadable data is kept, never replaced', kept.length === 1 && kept[0] === bad && (await toastText(p)) === 'Couldn’t read saved data — a copy was kept');
    ok('data: app still usable after bad data', (await p.$$('#timers .tbtn')).length === 5);
    await c.close();
  }
  {
    const stash = { v: 1, timer: null, blocks: [B('s1', 'plan', 'job', 'Job', 180, 240)] };
    const { c, p } = await open(1180, 820, { data: { ...FIXTURE, blocks: [] }, extra: `localStorage.setItem('dailyos.bad', ${JSON.stringify(JSON.stringify(stash))});` });
    await p.waitForTimeout(800);
    ok('data: v2-era stash recovered once', (await toastText(p)) === 'Recovered 1 block from before the category update' && (await p.evaluate(() => localStorage.getItem('dailyos.bad') === null)));
    await c.close();
  }
  {
    const t5 = new Date(NOW).getTime() - 5 * 3600e3;
    const { c, p } = await open(1180, 820, { data: { ...FIXTURE, timer: { cat: 'work', startedAt: t5 } } });
    ok('long timer: 4h+ check-in sheet', (await p.$eval('.pop h3', (e) => e.textContent).catch(() => '')) === 'Work timer has run 5h');
    await c.close();
  }
  {
    const { c, p } = await open(1180, 820, { sw: 'allow', clock: false });
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload(); await p.waitForTimeout(400);
    await c.setOffline(true);
    await p.reload(); await p.waitForTimeout(400);
    ok('offline: app loads from the service worker', (await box(p, '#rail')).vis && (await p.$$('#timers .tbtn')).length === 5);
    await c.close();
  }

  await browser.close();
  server.close();
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error('\nCRASH:', String(e && e.stack || e).split('\n').slice(0, 4).join('\n')); process.exit(1); });
