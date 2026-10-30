// Runs scriptable/daily-os.js against stand-ins for Scriptable's APIs and the fake GitHub.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRepo } = require('./mockgh.cjs');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scriptable', 'daily-os.js'), 'utf8');
const AsyncFunction = (async () => {}).constructor;
const pad = (n) => String(n).padStart(2, '0');
const dayKeyOf = (ms) => { const d = new Date(ms); const x = d.getHours() < 6 ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1) : d; return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const offset = (key, ms) => { const [y, m, d] = key.split('-').map(Number); return Math.round((ms - new Date(y, m - 1, d, 6).getTime()) / 60000); };

function harness({ repo, query = {}, widget = false, family = 'medium', alerts = [], key = null, pasteboard = '', siri = false, pending = null }) {
  const out = { widget: null, presented: null, alerts: [], keychain: new Map(key ? [['dailyos.widget', key]] : []), files: new Map(), pending: pending || new Map(), output: null };
  class Node { constructor(kind) { this.kind = kind; this.kids = []; } addText(s) { const t = new Node('text'); t.text = s; this.kids.push(t); return t; }
    addDate(d) { const t = new Node('date'); t.date = d; t.applyTimerStyle = () => { t.timer = true; }; t.rightAlignText = () => {}; this.kids.push(t); return t; }
    addStack() { const s = new Node('stack'); this.kids.push(s); return s; } addSpacer() { this.kids.push(new Node('spacer')); }
    setPadding() {} layoutHorizontally() {} layoutVertically() {} centerAlignContent() {} }
  class ListWidget extends Node { constructor() { super('widget'); } async presentMedium() { out.presented = this; } }
  class Color { constructor(hex) { this.hex = hex; } static dynamic(l) { return l; } }
  const Font = new Proxy({}, { get: (_, k) => (n) => `${String(k)}(${n})` });
  class Size { constructor(w, h) { this.w = w; this.h = h; } }
  class Request {
    constructor(url) { this.url = url; this.method = 'GET'; this.headers = {}; }
    async loadJSON() {
      const r = repo.handle(this.method, new URL(this.url).pathname.replace(/^\/gh/, ''), this.body, this.headers.Authorization);
      this.response = { statusCode: r.status };
      return r.json;
    }
  }
  class Alert {
    constructor() { this.fields = []; }
    addTextField(p, v) { this.fields.push(v || ''); } addAction() {} addCancelAction() {}
    async presentAlert() { const next = alerts.shift(); out.alerts.push(this.title); if (next === undefined) return 0; if (next === null) return -1; if (typeof next === 'string') this.fields[0] = next; return 0; }
    textFieldValue(i) { return this.fields[i]; }
  }
  const Data = { fromString: (s) => ({ toBase64String: () => Buffer.from(s, 'utf8').toString('base64') }), fromBase64String: (s) => ({ toRawString: () => Buffer.from(s, 'base64').toString('utf8') }) };
  const Keychain = { contains: (k) => out.keychain.has(k), get: (k) => out.keychain.get(k), set: (k, v) => out.keychain.set(k, v), remove: (k) => out.keychain.delete(k) };
  const FileManager = { local: () => ({ documentsDirectory: () => '/docs', joinPath: (a, b) => `${a}/${b}`, fileExists: (p) => out.files.has(p), readString: (p) => out.files.get(p), writeString: (p, s) => out.files.set(p, s) }) };
  class Notification {
    setTriggerDate(d) { this.trigger = d; }
    async schedule() { out.pending.set(this.identifier, this); }
    static async allPending() { return [...out.pending.values()]; }
    static async removePending(ids) { for (const id of ids) out.pending.delete(id); }
  }
  const env = {
    ListWidget, Notification, Color, Font, Size, Request, Alert, Data, Keychain, FileManager,
    Pasteboard: { paste: () => pasteboard },
    URLScheme: { forRunningScript: () => 'scriptable:///run/Daily%20OS' },
    Script: { setWidget: (w) => { out.widget = w; }, complete: () => {}, setShortcutOutput: (v) => { out.output = v; } },
    config: { runsInWidget: widget, runsInAccessoryWidget: widget && family.startsWith('accessory'), widgetFamily: family, runsWithSiri: siri },
    args: { queryParameters: query },
  };
  return { out, run: () => new AsyncFunction(...Object.keys(env), SRC)(...Object.values(env)) };
}
const texts = (n, acc = []) => { if (n.text != null) acc.push(n.text); for (const k of n.kids || []) texts(k, acc); return acc; };
const urls = (n, acc = []) => { if (n.url) acc.push(n.url); for (const k of n.kids || []) urls(k, acc); return acc; };
const has = (n, pred) => pred(n) || (n.kids || []).some((k) => has(k, pred));

function seededRepo() {
  const repo = createRepo({ token: 'tok', repo: 'me/data' });
  const now = Date.now(), day = dayKeyOf(now), off = Math.floor(offset(day, now) / 15) * 15;
  const cats = [{ id: 'work', name: 'Work', color: '#2563eb', drift: false }, { id: 'career', name: 'Career', color: '#059669', drift: false }];
  repo.write('meta.json', { v: 2, cats, timer: { cat: 'work', startedAt: now - 30 * 60000 }, lastCat: 'work', lot: [{ id: 'l', text: 'x', min: 15, at: 1 }], gapSkip: [] });
  const next = Math.min(off + 60, 1380);
  repo.write(`blocks-${day.slice(0, 7)}.json`, { blocks: [
    { id: 'n', day, layer: 'plan', cat: 'career', title: 'Coffee chat', note: '', seq: 0, start: next, end: next + 30 },
    { id: 'p', day, layer: 'plan', cat: 'work', title: 'Past thing', note: '', seq: 0, start: 0, end: 15 },
    { id: 'a', day, layer: 'actual', cat: 'work', title: 'Actual', note: '', seq: 0, start: next, end: next + 30 }] });
  return repo;
}
const KEY = 'dos1:' + Buffer.from(JSON.stringify({ repo: 'me/data', token: 'tok', api: 'http://mock/gh' })).toString('base64');

test('first run in the app asks for the key, then previews the widget', async () => {
  const repo = seededRepo();
  const h = harness({ repo, pasteboard: KEY });
  await h.run();
  assert.equal(h.out.alerts[0], 'Daily OS widget key');
  assert.ok(h.out.keychain.has('dailyos.widget'), 'key saved to Keychain');
  const w = h.out.presented;
  assert.ok(w, 'medium preview shown');
  const t = texts(w);
  assert.ok(t.includes('Work'), t.join('|'));
  assert.ok(has(w, (n) => n.kind === 'date' && n.timer), 'live timer');
  assert.ok(t.some((s) => /^Coffee chat · \d{1,2}:\d{2} (AM|PM)$/.test(s)), t.join('|'));
  assert.ok(!t.some((s) => s.includes('Past thing')) && !t.some((s) => s.includes('Actual')));
  const u = urls(w);
  assert.ok(u.includes('scriptable:///run/Daily%20OS?action=add'));
  assert.ok(u.includes('https://akshatp12-wq.github.io/daily-os/#lot'));
  assert.ok(u.includes('https://akshatp12-wq.github.io/daily-os/'));
  assert.ok(t.includes('Parking lot · 1'));
});

test('widget sizes', async () => {
  const repo = seededRepo();
  for (const family of ['medium', 'small', 'accessoryRectangular', 'accessoryInline']) {
    const h = harness({ repo, widget: true, family, key: JSON.stringify({ repo: 'me/data', token: 'tok', api: 'http://mock/gh' }) });
    await h.run();
    const w = h.out.widget, t = texts(w);
    assert.ok(w, family);
    assert.ok(w.refreshAfterDate instanceof Date, `${family} refresh`);
    if (family === 'accessoryInline') assert.match(t[0], /^Work since \d/);
    else assert.ok(t.some((s) => s.includes('Work')) && t.some((s) => s.includes('Coffee chat')), `${family}: ${t.join('|')}`);
    if (family === 'small' || family.startsWith('accessory')) assert.equal(w.url, 'scriptable:///run/Daily%20OS?action=add');
  }
});

test('no key: widget asks you to set it up', async () => {
  const h = harness({ repo: seededRepo(), widget: true });
  await h.run();
  assert.ok(texts(h.out.widget).includes('Tap to set up the widget'));
  assert.equal(h.out.widget.url, 'scriptable:///run/Daily%20OS');
});

test('Add task writes to the parking lot, retrying if the app saved at the same time', async () => {
  const repo = seededRepo();
  repo.state.failPuts = 1;
  const h = harness({ repo, query: { action: 'add' }, key: JSON.stringify({ repo: 'me/data', token: 'tok', api: 'http://mock/gh' }), alerts: ['call franchise 15 mins #Life'] });
  await h.run();
  const lot = repo.read('meta.json').lot;
  assert.equal(lot.length, 2);
  assert.deepEqual([lot[1].text, lot[1].min, lot[1].raw], ['call franchise 15 mins #Life', 30, true]);
  assert.deepEqual(h.out.alerts, ['Add to parking lot', 'Added to parking lot']);
  // cancel does nothing
  const c = harness({ repo, query: { action: 'add' }, key: JSON.stringify({ repo: 'me/data', token: 'tok', api: 'http://mock/gh' }), alerts: [null] });
  await c.run();
  assert.equal(repo.read('meta.json').lot.length, 2);
});

test('offline or bad key: shows last known data or a clear message', async () => {
  const repo = seededRepo();
  const key = JSON.stringify({ repo: 'me/data', token: 'tok', api: 'http://mock/gh' });
  const h = harness({ repo, widget: true, key });
  await h.run();
  const files = h.out.files;
  repo.state.beforePut = null;
  const broken = { handle: () => ({ status: 0, json: null }) };
  const h2 = harness({ repo: broken, widget: true, key });
  h2.out.files = files;
  await h2.run();
  const t = texts(h2.out.widget);
  assert.ok(t.includes('Offline · last known') && t.includes('Work'), t.join('|'));
  const h3 = harness({ repo, widget: true, key: JSON.stringify({ repo: 'me/data', token: 'wrong', api: 'http://mock/gh' }) });
  await h3.run();
  assert.ok(texts(h3.out.widget).some((s) => /rejected/.test(s)));
});

test('notifications: block start, 5 min left, timer check-ins, evening nudge', async () => {
  const repo = seededRepo();
  const key = JSON.stringify({ repo: 'me/data', token: 'tok', api: 'http://mock/gh' });
  const pending = new Map([['dailyos:old', { identifier: 'dailyos:old' }], ['other-script', { identifier: 'other-script' }]]);
  const h = harness({ repo, widget: true, key, pending });
  await h.run();
  const ids = [...h.out.pending.keys()];
  assert.ok(!ids.includes('dailyos:old'), 'stale ones replaced');
  assert.ok(ids.includes('other-script'), 'other scripts’ notifications untouched');
  const start = [...h.out.pending.values()].find((n) => n.identifier.startsWith('dailyos:start:n:'));
  assert.ok(start && start.title === 'Coffee chat' && /^Starting now · until /.test(start.body), 'block start');
  const left = [...h.out.pending.values()].find((n) => n.identifier.startsWith('dailyos:left:n:'));
  assert.ok(left && left.title === '5 min left: Coffee chat');
  assert.equal(left.trigger.getTime() - start.trigger.getTime(), 25 * 60000);
  assert.ok(!ids.some((i) => i.startsWith('dailyos:start:p:')), 'nothing for the past');
  assert.ok(!ids.some((i) => i.includes(':a:')), 'nothing for Actual blocks');
  const timers = [...h.out.pending.values()].filter((n) => n.identifier.startsWith('dailyos:timer:'));
  assert.deepEqual(timers.map((n) => n.title).sort(), ['Work · 1h 30m so far', 'Work · 2h 30m so far', 'Work · 45 min so far']);
  assert.ok(ids.some((i) => i.startsWith('dailyos:evening:')));
  for (const n of h.out.pending.values()) if (n.identifier.startsWith('dailyos:')) { assert.equal(n.threadIdentifier, 'dailyos'); assert.ok(n.trigger.getTime() > Date.now()); }
  // a second refresh doesn't duplicate
  const n1 = h.out.pending.size;
  const h2 = harness({ repo, widget: true, key, pending: h.out.pending });
  await h2.run();
  assert.equal(h2.out.pending.size, n1);
  // timer stopped elsewhere -> its check-ins go away on the next refresh
  const m = repo.read('meta.json'); m.timer = null; repo.write('meta.json', m);
  const h3 = harness({ repo, widget: true, key, pending: h.out.pending });
  await h3.run();
  assert.ok(![...h3.out.pending.keys()].some((i) => i.startsWith('dailyos:timer:')));
});

test('notifications: Shortcuts automation just refreshes them', async () => {
  const repo = seededRepo();
  const h = harness({ repo, siri: true, key: JSON.stringify({ repo: 'me/data', token: 'tok', api: 'http://mock/gh' }) });
  await h.run();
  assert.match(h.out.output, /^Daily OS: \d+ notifications lined up$/);
  assert.equal(h.out.presented, null);
  assert.ok(h.out.pending.size > 0);
});
