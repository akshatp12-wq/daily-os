// Pure logic for Daily OS. No DOM access.

// ---- Constants ----
export const STEP = 15;
export const WAKE_MIN = 960; // 16h waking day: capacity bar and coverage
export const MAX_CATS = 10;
export const MAX_TASK = 480;
export const PALETTE = ['#2563eb', '#059669', '#ea580c', '#7c3aed', '#dc2626', '#0891b2', '#a16207', '#db2777', '#4d7c0f', '#6d28d9']; // validated: adjacent pairs pass CVD + normal-vision checks
export const DEFAULT_CATS = [
  { id: 'work', name: 'Work', color: '#2563eb', drift: false },
  { id: 'career', name: 'Career', color: '#059669', drift: false },
  { id: 'self', name: 'Self', color: '#ea580c', drift: false },
  { id: 'life', name: 'Life', color: '#7c3aed', drift: false },
  { id: 'drift', name: 'Drift', color: '#dc2626', drift: true },
];
export const catById = (cats, id) => cats.find((c) => c.id === id) || cats[0];
export const catName = (cats, id) => catById(cats, id).name;

// ---- Days and time (a day runs 06:00 -> 06:00 local; key = date of the 06:00 start) ----
export const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (key) => key.split('-').map(Number);
export function dayStart(key) { const [y, m, d] = parseKey(key); return new Date(y, m - 1, d, 6).getTime(); }
export function dayEnd(key) { const [y, m, d] = parseKey(key); return new Date(y, m - 1, d + 1, 6).getTime(); }
export const dayMinutes = (key) => Math.round((dayEnd(key) - dayStart(key)) / 60000);
export const slotCount = (key) => dayMinutes(key) / STEP;
export function addDays(key, n) { const [y, m, d] = parseKey(key); return dateKey(new Date(y, m - 1, d + n)); }
export function dayKeyOf(ms) {
  const d = new Date(ms);
  return d.getHours() < 6 ? dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)) : dateKey(d);
}
export const minToMs = (key, min) => dayStart(key) + min * 60000;
export const offsetOf = (key, ms) => (ms - dayStart(key)) / 60000;
export const snap = (min) => Math.round(min / STEP) * STEP;
export const floor15 = (min) => Math.floor(min / STEP) * STEP;
export const ceil15 = (min) => Math.ceil(min / STEP) * STEP;

// ---- Blocks ----
export function overlaps(blocks, c) {
  return blocks.some((b) => b.id !== c.id && b.day === c.day && b.layer === c.layer && b.start < c.end && c.start < b.end);
}
export function minutesOf(blocks, day, layer, cat) {
  let s = 0;
  for (const b of blocks) if (b.day === day && b.layer === layer && (!cat || b.cat === cat)) s += b.end - b.start;
  return s;
}
// Fit [start,end) into free space of a layer: skip past blocks covering start, stop at the next block.
export function clampFree(blocks, key, layer, start, end) {
  const same = blocks.filter((b) => b.day === key && b.layer === layer).sort((a, b) => a.start - b.start);
  let moved = true;
  while (moved) {
    moved = false;
    for (const b of same) if (b.start <= start && start < b.end) { start = b.end; moved = true; }
  }
  for (const b of same) if (b.start >= start && b.start < end) end = b.start;
  end = Math.min(end, dayMinutes(key));
  return end - start >= STEP ? { start, end } : null;
}
// Running timer -> Actual block, or null if under 15 min / no room.
export function timerToBlock(timer, nowMs, blocks, cats) {
  if (!timer || nowMs - timer.startedAt < STEP * 60000) return null;
  const day = dayKeyOf(timer.startedAt);
  const start = snap(offsetOf(day, timer.startedAt));
  const dur = Math.max(STEP, snap((nowMs - timer.startedAt) / 60000));
  const fit = clampFree(blocks, day, 'actual', start, start + dur);
  if (!fit) return null;
  return { day, start: fit.start, end: fit.end, layer: 'actual', cat: timer.cat, title: catName(cats, timer.cat), note: '', seq: 0 };
}
// Merge another device's blocks: never overwrites; skips duplicate ids and overlaps.
export function mergeBlocks(existing, incoming) {
  const ids = new Set(existing.map((b) => b.id)), all = existing.slice(), added = [];
  let dup = 0, clash = 0;
  for (const b of incoming) {
    if (ids.has(b.id)) { dup++; continue; }
    if (overlaps(all, b)) { clash++; continue; }
    const nb = { ...b };
    all.push(nb); added.push(nb); ids.add(nb.id);
  }
  return { added, dup, clash };
}

// ---- Fire drill: push today's remaining plan back by delta ----
// Blocks starting at/after cutoff move; the block in progress splits; blocks past day end overflow.
export function reflow(blocks, day, cutoff, delta, newId) {
  const max = dayMinutes(day), out = [], moved = [], overflow = [];
  let split = null;
  for (const b of blocks) {
    if (b.day !== day || b.layer !== 'plan' || b.end <= cutoff || delta <= 0) { out.push(b); continue; }
    if (b.start < cutoff) {
      const head = { ...b, end: cutoff };
      const rest = { ...b, id: newId(), start: cutoff, end: b.end, seq: 0 };
      out.push(head);
      split = { head, rest };
      if (rest.end + delta > max) overflow.push(rest);
      else { const t = { ...rest, start: rest.start + delta, end: rest.end + delta }; out.push(t); moved.push(t); }
      continue;
    }
    if (b.end + delta > max) { overflow.push(b); continue; }
    const nb = { ...b, start: b.start + delta, end: b.end + delta };
    out.push(nb); moved.push(nb);
  }
  return { blocks: out, moved, split, overflow };
}

// ---- Fill the gaps: untracked Actual time on a day ----
export function findGaps(blocks, day, nowMs, timer, skips = [], min = 30) {
  const today = dayKeyOf(nowMs);
  if (day > today) return [];
  const acts = blocks.filter((b) => b.day === day && b.layer === 'actual');
  const iv = acts.map((b) => [b.start, b.end]);
  if (timer && dayKeyOf(timer.startedAt) === day) iv.push([snap(offsetOf(day, timer.startedAt)), Infinity]);
  if (!iv.length) return [];
  iv.sort((a, b) => a[0] - b[0]);
  const end = Math.min(dayMinutes(day), day === today ? floor15(offsetOf(day, nowMs)) : Math.max(...acts.map((b) => b.end), iv[0][0]));
  const gaps = [], skip = new Set(skips);
  let cur = iv[0][0];
  for (const [s, e] of iv) {
    if (cur >= end) break;
    if (s > cur) { const ge = Math.min(s, end); if (ge - cur >= min) gaps.push([cur, ge]); }
    cur = Math.max(cur, e);
  }
  if (cur < end && end - cur >= min) gaps.push([cur, end]);
  return gaps.filter(([s, e]) => !skip.has(`${day}|${s}|${e}`));
}

// ---- Parking lot ----
const H = '[Hh](?:[Oo][Uu][Rr][Ss]?|[Rr][Ss]?)?';
const M = '(?:[Mm][Ii][Nn](?:[Uu][Tt][Ee])?[Ss]?|m)'; // lone uppercase M (millions) is never minutes
const DUR = new RegExp(`(^|[^A-Za-z0-9$£€.])(?:(\\d+)\\s*${H}\\s*(\\d{1,2})\\s*${M}|(\\d+)\\s*${H}(\\d{1,2})|(\\d+(?:\\.\\d+)?)\\s*(${H}|${M}))(?![A-Za-z0-9])`, 'g');
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// "call franchise 15 mins #Life" -> { text: 'call franchise', min: 15, timed: true, cat: 'life' }
export function parseTask(line, cats = []) {
  let text = String(line).replace(/\s+/g, ' ').trim(), cat = null;
  text = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (all, lead, tag) => {
    if (cat) return all;
    const c = cats.find((x) => norm(x.name) === norm(tag));
    if (!c) return all;
    cat = c.id;
    return lead;
  });
  let hit = null;
  for (const m of text.matchAll(DUR)) {
    const v = m[2] ? +m[2] * 60 + +m[3] : m[4] ? +m[4] * 60 + +m[5] : /^[Hh]/.test(m[7]) ? +m[6] * 60 : +m[6];
    hit = { start: m.index + m[1].length, end: m.index + m[0].length, v };
  }
  let min = 30;
  if (hit) {
    min = Math.min(MAX_TASK, Math.max(STEP, ceil15(hit.v)));
    const before = text.slice(0, hit.start).replace(/\s*(?:\b(?:for|about|approx\.?)\s*)?[-–—,:(~]*\s*$/i, '');
    const after = text.slice(hit.end).replace(/^\s*\)/, '');
    text = `${before} ${after}`;
  }
  text = text.replace(/\s+/g, ' ').replace(/^[\s\-–—,:]+|[\s\-–—,:]+$/g, '').slice(0, 200);
  return { text, min, timed: !!hit, cat };
}
export const lotBucket = (min) => (min <= 30 ? 'quick' : min <= 75 ? 'medium' : 'long');
export function lotGroups(items) {
  const g = { quick: [], medium: [], long: [] };
  for (const x of [...items].sort((a, b) => a.min - b.min || a.at - b.at)) g[lotBucket(x.min)].push(x);
  return g;
}

// ---- Categories ----
export function renameCat(d, id, name) {
  const old = d.cats.find((c) => c.id === id);
  if (!old || !name.trim()) return d;
  return { ...d, cats: d.cats.map((c) => (c.id === id ? { ...c, name } : c)),
    blocks: d.blocks.map((b) => (b.cat === id && b.title === old.name ? { ...b, title: name } : b)) };
}
// Remove a category, moving its blocks to `toId` (default titles follow).
export function deleteCat(d, id, toId) {
  const old = d.cats.find((c) => c.id === id), cats = d.cats.filter((c) => c.id !== id);
  if (!old || !cats.length) return d;
  const to = cats.find((c) => c.id === toId) || cats[0];
  return { ...d, cats,
    blocks: d.blocks.map((b) => (b.cat === id ? { ...b, cat: to.id, title: b.title === old.name ? to.name : b.title } : b)),
    lot: d.lot.map((x) => { if (x.cat !== id) return x; const { cat, ...rest } = x; return rest; }),
    lastCat: d.lastCat === id ? to.id : d.lastCat };
}

// ---- Month grid: 42 cells (6 weeks), Sunday first ----
export function monthGrid(y, m) {
  const off = new Date(y, m - 1, 1).getDay();
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(y, m - 1, 1 - off + i);
    return { key: dateKey(d), day: d.getDate(), inMonth: d.getMonth() === m - 1 };
  });
}
export function weekDays(key) {
  const [y, m, d] = parseKey(key), dow = new Date(y, m - 1, d).getDay();
  return Array.from({ length: 7 }, (_, i) => addDays(key, i - dow));
}

// ---- Dashboard metrics ----
// dayBlocks: blocks of that day only.
export function daySummary(dayBlocks, day, cats, nowMs) {
  const today = dayKeyOf(nowMs), future = day > today, nowOff = day === today ? offsetOf(day, nowMs) : Infinity;
  const plan = {}, actual = {};
  for (const c of cats) { plan[c.id] = 0; actual[c.id] = 0; }
  const drifty = new Set(cats.filter((c) => c.drift).map((c) => c.id));
  let planTot = 0, actTot = 0, drift = 0, planned = 0, matched = 0;
  const acts = dayBlocks.filter((b) => b.layer === 'actual');
  for (const b of dayBlocks) {
    const len = b.end - b.start;
    if (b.layer === 'plan') { plan[b.cat] = (plan[b.cat] || 0) + len; planTot += len; }
    else { actual[b.cat] = (actual[b.cat] || 0) + len; actTot += len; if (drifty.has(b.cat)) drift += len; }
  }
  if (!future) for (const p of dayBlocks) {
    if (p.layer !== 'plan') continue;
    for (let s = p.start; s < p.end && s < nowOff; s += STEP) {
      planned++;
      if (acts.some((a) => a.cat === p.cat && a.start <= s && s < a.end)) matched++;
    }
  }
  const wake = future ? 0 : day === today ? Math.min(WAKE_MIN, Math.max(0, Math.floor(nowOff))) : WAKE_MIN;
  return { day, future, plan, actual, planTot, actTot, drift, wake, planned, matched };
}
export function rollup(sums, cats) {
  const r = { plan: {}, actual: {}, planTot: 0, actTot: 0, drift: 0, wake: 0, planned: 0, matched: 0 };
  for (const c of cats) { r.plan[c.id] = 0; r.actual[c.id] = 0; }
  for (const s of sums) {
    r.planTot += s.planTot;
    for (const c of cats) r.plan[c.id] += s.plan[c.id] || 0;
    if (s.future) continue; // the future can have a plan, not a log
    for (const k of ['actTot', 'drift', 'wake', 'planned', 'matched']) r[k] += s[k];
    for (const c of cats) r.actual[c.id] += s.actual[c.id] || 0;
  }
  r.coverage = r.wake ? Math.min(1, r.actTot / r.wake) : null;
  r.accuracy = r.planned ? r.matched / r.planned : null;
  r.driftShare = r.actTot ? r.drift / r.actTot : null;
  return r;
}

// ---- ICS ----
export const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const enc = new TextEncoder();
export function fold(line) {
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', len = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > limit) { out.push(cur); cur = ''; len = 0; limit = 74; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
export const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function buildICS(blocks, { layer = 'plan', now = Date.now(), cats = DEFAULT_CATS } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daily OS//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:Daily OS ${layer === 'actual' ? 'Actual' : 'Plan'}`];
  for (const b of blocks) {
    const title = b.title && b.title.trim() ? b.title : catName(cats, b.cat);
    L.push('BEGIN:VEVENT', `UID:${b.id}@dailyos`, `DTSTAMP:${icsTime(now)}`,
      `DTSTART:${icsTime(minToMs(b.day, b.start))}`, `DTEND:${icsTime(minToMs(b.day, b.end))}`,
      `SEQUENCE:${b.seq || 0}`, `SUMMARY:${icsEscape(title)}`, `CATEGORIES:${icsEscape(catName(cats, b.cat))}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape('Starting: ' + title)}`, 'TRIGGER:PT0M', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape('5 min left: ' + title)}`, 'TRIGGER;RELATED=END:-PT5M', 'END:VALARM',
      'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

// ---- Data: migration (v1 -> v2) and validation ----
const LEGACY = { job: ['work', 'Job'], admin: ['life', 'Admin'], personal: ['life', 'Personal'], dev: ['self', 'Development'] };
export function migrate(d) {
  if (!d || typeof d !== 'object' || d.v !== 1 || !Array.isArray(d.blocks)) return d;
  const cats = DEFAULT_CATS.map((c) => ({ ...c }));
  const cat = (c) => (LEGACY[c] ? LEGACY[c][0] : c);
  const blocks = d.blocks.map((b) => {
    if (!b || typeof b !== 'object' || !LEGACY[b.cat]) return b;
    const [id, old] = LEGACY[b.cat];
    return { ...b, cat: id, title: b.title === old ? catName(cats, id) : b.title };
  });
  const timer = d.timer && typeof d.timer === 'object' ? { ...d.timer, cat: cat(d.timer.cat) } : d.timer ?? null;
  return { v: 2, cats, blocks, timer, lastCat: d.lastCat === undefined ? 'work' : cat(d.lastCat), lot: [], gapSkip: [] };
}
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/, HEX = /^#[0-9a-f]{6}$/i;
export function validCats(cats) {
  return Array.isArray(cats) && cats.length >= 1 && cats.length <= MAX_CATS &&
    cats.every((c) => !!c && typeof c.id === 'string' && !!c.id && typeof c.name === 'string' && !!c.name.trim() &&
      c.name.length <= 24 && HEX.test(c.color) && typeof c.drift === 'boolean') &&
    new Set(cats.map((c) => c.id)).size === cats.length;
}
export function validBlock(b, ids) {
  return !!b && typeof b.id === 'string' && KEY_RE.test(b.day) && Number.isInteger(b.start) && Number.isInteger(b.end) &&
    b.start % STEP === 0 && b.end % STEP === 0 && b.start >= 0 && b.end - b.start >= STEP &&
    (b.layer === 'plan' || b.layer === 'actual') && ids.has(b.cat) && typeof b.title === 'string';
}
const validItem = (x, ids) => !!x && typeof x.id === 'string' && typeof x.text === 'string' && x.text.length >= 1 && x.text.length <= 200 &&
  Number.isInteger(x.min) && x.min % STEP === 0 && x.min >= STEP && x.min <= MAX_TASK && (x.cat == null || ids.has(x.cat)) && Number.isFinite(x.at);
export function validateData(d) {
  if (!d || typeof d !== 'object' || d.v !== 2 || !validCats(d.cats) || !Array.isArray(d.blocks) || !Array.isArray(d.lot) || !Array.isArray(d.gapSkip)) return false;
  const ids = new Set(d.cats.map((c) => c.id));
  if (d.timer != null && !(ids.has(d.timer.cat) && Number.isFinite(d.timer.startedAt))) return false;
  return d.blocks.every((b) => validBlock(b, ids)) && d.lot.every((x) => validItem(x, ids)) && d.gapSkip.every((s) => typeof s === 'string');
}
