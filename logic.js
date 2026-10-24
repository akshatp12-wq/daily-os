// Pure logic for Daily OS. No DOM access.
export const STEP = 15;
export const CAPACITY_MIN = 960;
export const CATS = [
  { id: 'work', name: 'Work', color: '#2563eb' },
  { id: 'career', name: 'Career', color: '#059669' },
  { id: 'self', name: 'Self', color: '#ea580c' },
  { id: 'life', name: 'Life', color: '#7c3aed' },
  { id: 'drift', name: 'Drift', color: '#dc2626' },
];
export const catName = (id) => (CATS.find((c) => c.id === id) || CATS[0]).name;

const pad = (n) => String(n).padStart(2, '0');
const keyFromDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (key) => key.split('-').map(Number);

// Epoch ms of 06:00 local on the day key.
export function dayStart(key) {
  const [y, m, d] = parseKey(key);
  return new Date(y, m - 1, d, 6).getTime();
}
export function dayEnd(key) {
  const [y, m, d] = parseKey(key);
  return new Date(y, m - 1, d + 1, 6).getTime();
}
export const dayMinutes = (key) => Math.round((dayEnd(key) - dayStart(key)) / 60000);
export const slotCount = (key) => dayMinutes(key) / STEP;
export function addDays(key, n) {
  const [y, m, d] = parseKey(key);
  return keyFromDate(new Date(y, m - 1, d + n));
}
// Day key that contains the given instant (days start at 06:00).
export function dayKeyOf(ms) {
  const d = new Date(ms);
  if (d.getHours() < 6) return keyFromDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
  return keyFromDate(d);
}
export const minToMs = (key, min) => dayStart(key) + min * 60000;
export const snap = (min) => Math.round(min / STEP) * STEP;

export function overlaps(blocks, c) {
  return blocks.some((b) => b.id !== c.id && b.day === c.day && b.layer === c.layer && b.start < c.end && c.start < b.end);
}

export function plannedMinutes(blocks, key) {
  return blocks.filter((b) => b.day === key && b.layer === 'plan').reduce((s, b) => s + b.end - b.start, 0);
}
export const capacity = (blocks, key) => plannedMinutes(blocks, key) / CAPACITY_MIN;

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

// Convert a running timer into an actual block, or null if it should be discarded.
export function timerToBlock(timer, nowMs, blocks) {
  if (!timer || nowMs - timer.startedAt < STEP * 60000) return null;
  const day = dayKeyOf(timer.startedAt);
  const start = snap((timer.startedAt - dayStart(day)) / 60000);
  const dur = Math.max(STEP, snap((nowMs - timer.startedAt) / 60000));
  const fit = clampFree(blocks, day, 'actual', start, start + dur);
  if (!fit) return null;
  return { day, start: fit.start, end: fit.end, layer: 'actual', cat: timer.cat, title: catName(timer.cat), note: '', seq: 0 };
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

export function buildICS(blocks, { layer = 'plan', now = Date.now() } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daily OS//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:Daily OS ${layer === 'actual' ? 'Actual' : 'Plan'}`];
  for (const b of blocks) {
    const title = b.title && b.title.trim() ? b.title : catName(b.cat);
    L.push('BEGIN:VEVENT', `UID:${b.id}@dailyos`, `DTSTAMP:${icsTime(now)}`,
      `DTSTART:${icsTime(minToMs(b.day, b.start))}`, `DTEND:${icsTime(minToMs(b.day, b.end))}`,
      `SEQUENCE:${b.seq || 0}`, `SUMMARY:${icsEscape(title)}`, `CATEGORIES:${icsEscape(catName(b.cat))}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape('Starting: ' + title)}`, 'TRIGGER:PT0M', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape('5 min left: ' + title)}`, 'TRIGGER;RELATED=END:-PT5M', 'END:VALARM',
      'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

// ---- Data validation ----
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function validBlock(b) {
  return !!b && typeof b.id === 'string' && KEY_RE.test(b.day) && Number.isInteger(b.start) && Number.isInteger(b.end) &&
    b.start % STEP === 0 && b.end % STEP === 0 && b.start >= 0 && b.end - b.start >= STEP &&
    (b.layer === 'plan' || b.layer === 'actual') && CATS.some((c) => c.id === b.cat) && typeof b.title === 'string';
}
export function validateData(d) {
  if (!d || typeof d !== 'object' || d.v !== 1 || !Array.isArray(d.blocks)) return false;
  if (d.timer != null && !(CATS.some((c) => c.id === d.timer.cat) && Number.isFinite(d.timer.startedAt))) return false;
  return d.blocks.every(validBlock);
}
