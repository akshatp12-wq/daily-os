// Daily OS widget for Scriptable — shows the running timer (live) and what's planned next,
// with buttons to add a task to the parking lot, open the parking lot, or open the app.
//
// Setup (once): in Daily OS open Export / Backup → Copy widget key. In Scriptable, create a
// script named "Daily OS", paste this file, run it once and paste the key when asked.
// Then add a Scriptable widget (medium works best) and choose the "Daily OS" script.
// Lock Screen widgets work too. Run with ?action=reset to remove the saved key.

const APP = 'https://akshatp12-wq.github.io/daily-os/';
const KC = 'dailyos.widget';
const CACHE = 'dailyos-widget-cache.json';

// ---- Day math (same as the app: a day runs 06:00 -> 06:00) ----
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parts = (key) => key.split('-').map(Number);
function dayKeyOf(ms) {
  const d = new Date(ms);
  return d.getHours() < 6 ? dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)) : dateKey(d);
}
function addDays(key, n) { const [y, m, d] = parts(key); return dateKey(new Date(y, m - 1, d + n)); }
function minToMs(key, min) { const [y, m, d] = parts(key); return new Date(y, m - 1, d, 6).getTime() + min * 60000; }
function fmtTime(ms) { const d = new Date(ms); const h = d.getHours(); return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`; }

// ---- What to show ----
function status(meta, blocks, nowMs) {
  const cats = (meta && meta.cats) || [];
  const cat = (id) => cats.find((c) => c.id === id) || { name: 'Timer', color: '#2563eb' };
  const t = meta && meta.timer;
  const timer = t ? { name: cat(t.cat).name, color: cat(t.cat).color, startedAt: t.startedAt } : null;
  const today = dayKeyOf(nowMs), tomorrow = addDays(today, 1);
  const plans = blocks
    .filter((b) => b.layer === 'plan' && (b.day === today || b.day === tomorrow))
    .map((b) => ({ title: b.title || cat(b.cat).name, color: cat(b.cat).color, at: minToMs(b.day, b.start), end: minToMs(b.day, b.end) }))
    .sort((a, b) => a.at - b.at);
  return {
    timer,
    current: plans.find((p) => p.at <= nowMs && nowMs < p.end) || null,
    next: plans.find((p) => p.at > nowMs) || null,
    lot: ((meta && meta.lot) || []).length,
  };
}

// ---- GitHub ----
const b64e = (s) => Data.fromString(s).toBase64String();
const b64d = (s) => Data.fromBase64String(String(s).replace(/\s/g, '')).toRawString();
async function gh(k, path, method = 'GET', body) {
  const r = new Request(`${k.api || 'https://api.github.com'}/repos/${k.repo}/contents/${path}`);
  r.method = method;
  r.headers = { Authorization: `Bearer ${k.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  if (body) r.body = JSON.stringify(body);
  let json = null;
  try { json = await r.loadJSON(); } catch (e) { json = null; }
  return { status: r.response ? r.response.statusCode : 0, json };
}
async function getFile(k, name) {
  const r = await gh(k, name);
  if (r.status === 404) return null;
  if (r.status === 401) throw new Error('Widget key rejected — copy a new one from Daily OS');
  if (r.status !== 200 || !r.json) throw new Error(r.status ? `GitHub error ${r.status}` : 'Offline');
  return { data: JSON.parse(b64d(r.json.content)), sha: r.json.sha };
}
async function load(k, nowMs) {
  const meta = await getFile(k, 'meta.json');
  const today = dayKeyOf(nowMs), months = [...new Set([today, addDays(today, 1)].map((d) => d.slice(0, 7)))];
  let blocks = [];
  for (const m of months) { const f = await getFile(k, `blocks-${m}.json`); if (f) blocks = blocks.concat(f.data.blocks || []); }
  return { meta: meta && meta.data, blocks };
}

// ---- Key ----
function savedKey() {
  if (!Keychain.contains(KC)) return null;
  try { return JSON.parse(Keychain.get(KC)); } catch (e) { return null; }
}
async function askKey() {
  const a = new Alert();
  a.title = 'Daily OS widget key';
  a.message = 'In Daily OS open Export / Backup → Copy widget key, then paste it here.';
  const clip = (Pasteboard.paste() || '').trim();
  a.addTextField('dos1:…', clip.startsWith('dos1:') ? clip : '');
  a.addAction('Save');
  a.addCancelAction('Cancel');
  if ((await a.presentAlert()) === -1) return null;
  const raw = a.textFieldValue(0).trim();
  let k = null;
  try { k = raw.startsWith('dos1:') ? JSON.parse(b64d(raw.slice(5))) : null; } catch (e) { k = null; }
  if (!k || !k.repo || !k.token) { await say('That isn’t a Daily OS widget key', 'Copy it again from Export / Backup in the app.'); return null; }
  Keychain.set(KC, JSON.stringify(k));
  return k;
}
async function say(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message || '';
  a.addAction('OK');
  await a.presentAlert();
}

// ---- Add to parking lot (the app parses the time and #category on its next sync) ----
async function addTask(k) {
  const a = new Alert();
  a.title = 'Add to parking lot';
  a.message = 'Include a time and #category, e.g. “call franchise 15 mins #Life”.';
  a.addTextField('Task', '');
  a.addAction('Add');
  a.addCancelAction('Cancel');
  if ((await a.presentAlert()) === -1) return;
  const text = a.textFieldValue(0).trim().slice(0, 200);
  if (!text) return;
  for (let i = 0; i < 4; i++) {
    const f = await getFile(k, 'meta.json');
    if (!f) return say('Turn on sync in Daily OS first', 'The widget adds tasks through your synced data.');
    f.data.lot = f.data.lot || [];
    f.data.lot.push({ id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, min: 30, at: Date.now(), raw: true });
    const r = await gh(k, 'meta.json', 'PUT', { message: 'Parking lot: added from widget', content: b64e(JSON.stringify(f.data)), sha: f.sha });
    if (r.status === 200 || r.status === 201) return say('Added to parking lot', text);
    if (r.status !== 409 && r.status !== 422) throw new Error(`GitHub error ${r.status}`);
  }
  throw new Error('Couldn’t save — try again');
}

// ---- Widget ----
const C = {
  bg: Color.dynamic(new Color('#ffffff'), new Color('#1f2024')),
  fg: Color.dynamic(new Color('#1b1c1f'), new Color('#ececee')),
  muted: Color.dynamic(new Color('#6b6e76'), new Color('#9a9ca3')),
  btn: Color.dynamic(new Color('#f1f1ee'), new Color('#2c2d32')),
};
const mono = (n) => (Font.boldMonospacedSystemFont ? Font.boldMonospacedSystemFont(n) : Font.boldSystemFont(n));
function text(stack, s, font, color, lines = 1) {
  const t = stack.addText(s);
  t.font = font; t.textColor = color || C.fg; t.lineLimit = lines; t.minimumScaleFactor = 0.7;
  return t;
}
function dot(stack, color, n = 10) {
  const d = stack.addStack();
  d.size = new Size(n, n); d.cornerRadius = n / 2; d.backgroundColor = new Color(color);
}
function button(stack, label, url) {
  const b = stack.addStack();
  b.setPadding(6, 10, 6, 10); b.cornerRadius = 10; b.backgroundColor = C.btn; b.url = url;
  text(b, label, Font.semiboldSystemFont(13));
}
function cache(data) {
  const fm = FileManager.local(), p = fm.joinPath(fm.documentsDirectory(), CACHE);
  if (data) { fm.writeString(p, JSON.stringify(data)); return data; }
  return fm.fileExists(p) ? JSON.parse(fm.readString(p)) : null;
}

async function build(k, family, nowMs = Date.now()) {
  const w = new ListWidget();
  const addUrl = `${URLScheme.forRunningScript()}?action=add`;
  w.backgroundColor = C.bg;
  w.url = addUrl;
  if (!k) {
    w.url = URLScheme.forRunningScript();
    text(w, 'Daily OS', Font.boldSystemFont(15));
    text(w, 'Tap to set up the widget', Font.systemFont(13), C.muted, 2);
    return w;
  }
  let data, note = '';
  try { data = cache(await load(k, nowMs)); } catch (e) { data = cache(); note = data ? 'Offline · last known' : e.message; }
  if (!data) { text(w, 'Daily OS', Font.boldSystemFont(15)); text(w, note, Font.systemFont(12), C.muted, 3); return w; }
  const s = status(data.meta, data.blocks, nowMs);
  const nextLine = s.next ? `${s.next.title} · ${fmtTime(s.next.at)}` : 'Nothing else planned';
  w.refreshAfterDate = new Date(Math.min(s.next ? s.next.at + 1000 : Infinity, nowMs + 15 * 60000));

  if (family === 'accessoryInline') {
    text(w, s.timer ? `${s.timer.name} since ${fmtTime(s.timer.startedAt)}` : `Next: ${nextLine}`, Font.systemFont(12));
    return w;
  }
  if (family === 'accessoryRectangular') {
    const row = w.addStack(); row.centerAlignContent(); row.spacing = 4;
    if (s.timer) { text(row, `● ${s.timer.name}`, Font.boldSystemFont(14)); const d = row.addDate(new Date(s.timer.startedAt)); d.applyTimerStyle(); d.font = mono(14); }
    else text(row, 'No timer', Font.boldSystemFont(14));
    text(w, `Next: ${nextLine}`, Font.systemFont(12), null, 2);
    return w;
  }

  const small = family === 'small';
  w.setPadding(14, 14, 12, 14);
  const head = w.addStack(); head.centerAlignContent();
  text(head, 'DAILY OS', Font.semiboldSystemFont(11), C.muted);
  head.addSpacer();
  if (note) text(head, note, Font.systemFont(10), C.muted);
  w.addSpacer(6);

  const row = w.addStack(); row.centerAlignContent(); row.spacing = 8;
  if (s.timer) {
    dot(row, s.timer.color);
    text(row, s.timer.name, Font.boldSystemFont(small ? 15 : 17));
    row.addSpacer();
    const d = row.addDate(new Date(s.timer.startedAt));
    d.applyTimerStyle(); d.font = mono(small ? 16 : 22); d.textColor = C.fg; d.rightAlignText();
  } else {
    text(row, 'No timer running', Font.semiboldSystemFont(small ? 14 : 16), C.muted);
    if (s.current && !small) { row.addSpacer(); text(row, `Plan: ${s.current.title}`, Font.systemFont(13), C.muted); }
  }
  w.addSpacer(small ? 6 : 4);
  const nx = w.addStack(); nx.centerAlignContent(); nx.spacing = 6;
  text(nx, 'Next', Font.semiboldSystemFont(12), C.muted);
  if (s.next) dot(nx, s.next.color, 7);
  text(nx, nextLine, Font.systemFont(13), null, small ? 2 : 1);

  if (small) return w; // whole small widget opens "Add task"
  w.addSpacer();
  const bar = w.addStack(); bar.spacing = 8;
  button(bar, '+ Add task', addUrl);
  button(bar, `Parking lot${s.lot ? ` · ${s.lot}` : ''}`, `${APP}#lot`);
  bar.addSpacer();
  button(bar, 'Open', APP);
  return w;
}

// ---- Main ----
const q = (args && args.queryParameters) || {};
try {
  if (q.action === 'reset') {
    if (Keychain.contains(KC)) Keychain.remove(KC);
    await say('Widget key removed', 'Run the script again to paste a new one.');
  } else if (q.action === 'add') {
    const k = savedKey() || (await askKey());
    if (k) await addTask(k);
  } else if (config.runsInWidget || config.runsInAccessoryWidget) {
    Script.setWidget(await build(savedKey(), config.widgetFamily));
  } else {
    const k = savedKey() || (await askKey());
    const w = await build(k, 'medium');
    await w.presentMedium();
  }
} catch (e) {
  if (config.runsInWidget || config.runsInAccessoryWidget) {
    const w = new ListWidget();
    w.backgroundColor = C.bg;
    text(w, 'Daily OS', Font.boldSystemFont(15));
    text(w, String(e.message || e), Font.systemFont(12), C.muted, 3);
    Script.setWidget(w);
  } else await say('Daily OS', String(e.message || e));
}
Script.complete();
