// Goals — time spent on what matters, turned into rewards you can actually use.
// Logged Actual time counts toward a goal when the block is linked to it (or its title matches the
// goal's words, in the goal's categories). Practice check-ins count too. Hours fill weekly, monthly
// and quarterly targets (each unlocks a reward you pick), earn guilt-free free time, and buy wishlist items.
// Its own storage key; syncs as goals.json in the private repo when sync is on.
import * as L from './logic.js';
import { pick3, mergeById } from './sync.js';

export const GKEY = 'dailyos.goals';
export const SHAPES = ['event', 'practice', 'project', 'mastery'];
export const STATUSES = ['active', 'paused', 'someday', 'done'];
export const MODES = [['normal', 'Normal'], ['deal', 'Deal week'], ['light', 'Light']];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayNum = (key) => { const [y, m, d] = L.parseKey(key); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
const uid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const filled = (v) => typeof v === 'string' && !!v.trim();

// ---- Defaults ----
export const DEFAULT_REWARDS = {
  week: 480, weekDeal: 120, weekLight: 240, // minutes of goal time
  month: 1800, quarter: 5400,
  rate: 15,          // minutes of free time per goal hour
  dayCap: 240,       // at most this much goal time counts per day
  stepBonus: 30, milestoneBonus: 60,
  menus: { // samples; replace with your own
    week: ['Dinner somewhere good', 'A new book', 'Movie night, no laptop'],
    month: ['Tickets to a game or concert', 'New running gear'],
    quarter: ['A weekend away'],
  },
};
const g0 = (o) => ({ name: '', why: '', floor: '', shape: 'project', status: 'active', date: '', cats: [], words: [], target: 180, phases: [], sessions: [], steps: [], milestones: [], practices: [], ...o });
const ms = (id, text, date = '') => ({ id, text, date, done: false });
// Deterministic ids, so two devices that each start fresh agree after sync.
export function starterGoals() {
  return [
    g0({ id: 'hf', name: 'Hedge fund program', shape: 'project', date: '2027-03-31', cats: ['career'], target: 240,
      words: ['pitch', 'hedge', 'comps', 'investment', 'stock', 'networking', 'coffee chat', 'long/short', 'l/s', 'thesis', '10-k', '10-q'],
      floor: 'Read one 10-K section or one sell-side note. 15 minutes.',
      sessions: [{ name: 'Pitch work', min: 90 }, { name: 'Build the model', min: 60 }, { name: 'Coffee chat', min: 30 }],
      steps: [{ id: 'hf-s1', text: 'Pick the first company to pitch', done: false }],
      milestones: [ms('hf-m1', 'Pitch #1 written', '2026-11-30'), ms('hf-m2', 'Pitch #2 written', '2026-12-31'), ms('hf-m3', 'Pitch #3 written', '2027-01-31'),
        ms('hf-m4', 'Pitch #4 written', '2027-02-28'), ms('hf-m5', 'Pitch #5 written', '2027-03-31'), ms('hf-m6', 'Paper long/short book running'), ms('hf-m7', '30 conversations with people in the seat')] }),
    g0({ id: 'marathon', name: 'Chicago Marathon', shape: 'event', date: '2027-10-10', cats: ['self'], target: 150,
      words: ['run', 'long run', 'tempo', 'interval', 'marathon', 'miles', 'strength'],
      floor: 'Walk or jog 15 minutes. Shoes on counts.',
      phases: [{ name: 'Base', weeks: 0, target: 150 }, { name: 'Build', weeks: 7, target: 300 }, { name: 'Peak', weeks: 8, target: 420 }, { name: 'Taper', weeks: 3, target: 240 }],
      sessions: [{ name: 'Easy run', min: 45 }, { name: 'Long run', min: 90 }, { name: 'Strength', min: 30 }],
      steps: [{ id: 'mar-s1', text: 'Look up the 2027 entry options and dates', done: false }],
      milestones: [ms('mar-m1', 'Entry secured'), ms('mar-m2', 'Run a half marathon'), ms('mar-m3', 'First 16-mile run'), ms('mar-m4', 'First 20-mile run'), ms('mar-m5', 'Race day', '2027-10-10')] }),
    g0({ id: 'satsang', name: 'Satsang', shape: 'practice', cats: ['self', 'life'], target: 150,
      words: ['satsang', 'ahnik', 'mukhpath', 'puja', 'katha', 'sabha', 'vachanamrut', 'lion cubs'],
      floor: 'Ahnik, even a short one.',
      practices: [{ id: 'sat-p1', name: 'Ahnik', credit: 20 }, { id: 'sat-p2', name: 'Mukhpath review', credit: 10 }],
      sessions: [{ name: 'Read or study', min: 30 }, { name: 'New mukhpath', min: 20 }],
      steps: [{ id: 'sat-s1', text: 'Choose the book or topic for this month', done: false }],
      milestones: [ms('sat-m1', 'Teach Lion Cubs this month')] }),
    g0({ id: 'builder', name: 'Build something of my own', shape: 'project', status: 'someday', cats: ['career'] }),
    g0({ id: 'hotel', name: 'Hotel exit', shape: 'project', status: 'someday', cats: ['career'] }),
  ];
}
export const freshGoals = (today) => ({
  v: 1, start: today, pristine: true, goals: starterGoals(), checks: [], claims: [], weekMode: {}, funCat: 'drift',
  rewards: JSON.parse(JSON.stringify(DEFAULT_REWARDS)),
  wish: [{ id: 'w-watch', name: 'GPS running watch', hours: 40 }, { id: 'w-trip', name: 'A weekend trip', hours: 120 }],
});

// Templates for new goals.
export const TEMPLATES = [
  { shape: 'event', name: 'Event', blurb: 'A date you’re working toward: a race, an exam, a launch. Phases count back from the date.',
    make: () => ({ target: 180, phases: [{ name: 'Base', weeks: 0, target: 150 }, { name: 'Build', weeks: 6, target: 240 }, { name: 'Final push', weeks: 2, target: 300 }], sessions: [{ name: 'Session', min: 45 }] }) },
  { shape: 'practice', name: 'Practice', blurb: 'Something you do most days. One tap to check in, no timer needed.',
    make: () => ({ target: 120, practices: [{ id: uid(), name: 'Daily practice', credit: 15 }] }) },
  { shape: 'project', name: 'Project', blurb: 'An outcome with steps. There’s always one next step, small enough to start.',
    make: () => ({ target: 240, sessions: [{ name: 'Deep work', min: 60 }] }) },
  { shape: 'mastery', name: 'Skill', blurb: 'Getting better at something. Hours add up and milestones mark the levels.',
    make: () => ({ target: 180, sessions: [{ name: 'Practice session', min: 45 }] }) },
];
export function newGoal(shape, over = {}) {
  const t = TEMPLATES.find((x) => x.shape === shape) || TEMPLATES[2];
  return g0({ id: uid(), shape: t.shape, ...t.make(), ...over });
}

// ---- Which goal a block counts toward ----
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const wordIn = (title, w) => new RegExp(`(^|[^a-z0-9])${esc(w.toLowerCase())}`).test(title);
// block.goal: an id links it, '' means "not a goal". Otherwise: an active goal whose words appear in the title,
// in one of the goal's categories (so a Work "model" isn't a hedge fund model).
export function goalOf(b, goals) {
  if (typeof b.goal === 'string') return b.goal && goals.some((g) => g.id === b.goal) ? b.goal : null;
  const t = String(b.title || '').toLowerCase();
  for (const g of goals) {
    if (g.status !== 'active' || (g.cats.length && !g.cats.includes(b.cat))) continue;
    if (g.words.some((w) => filled(w) && wordIn(t, w.trim()))) return g.id;
  }
  return null;
}

// ---- Credit: minutes of goal time per day ----
export const sinceKey = (G) => L.weekDays(G.start)[0];
export function credits(G, blocks) {
  const out = new Map(), since = sinceKey(G), ids = new Set(G.goals.map((g) => g.id));
  const add = (day, id, m) => {
    if (day < since || !(m > 0)) return;
    let d = out.get(day);
    if (!d) out.set(day, (d = { byGoal: {}, raw: 0, counted: 0 }));
    d.byGoal[id] = (d.byGoal[id] || 0) + m;
    d.raw += m;
  };
  for (const b of blocks) if (b.layer === 'actual') { const id = goalOf(b, G.goals); if (id) add(b.day, id, b.end - b.start); }
  for (const c of G.checks) if (ids.has(c.goal)) add(c.day, c.goal, c.credit);
  for (const d of out.values()) d.counted = Math.min(d.raw, G.rewards.dayCap);
  return out;
}

// ---- Periods: week (Sun–Sat, as on the dashboard), month, quarter ----
function span(a, b) { const out = []; for (let k = a; k <= b; k = L.addDays(k, 1)) out.push(k); return out; }
const lastOfMonth = (y, m) => L.dateKey(new Date(y, m, 0));
export function periodOf(kind, day) {
  if (kind === 'week') { const days = L.weekDays(day); return { kind, key: days[0], days }; }
  const [y, m] = L.parseKey(day), m0 = kind === 'month' ? m : Math.floor((m - 1) / 3) * 3 + 1, m1 = kind === 'month' ? m : m0 + 2;
  const key = `${y}-${L.pad(m0)}-01`;
  return { kind, key, days: span(key, lastOfMonth(y, m1)), q: Math.ceil(m0 / 3) };
}
export function weekTarget(G, weekKey) {
  const r = G.rewards, mode = G.weekMode[weekKey];
  return mode === 'deal' ? r.weekDeal : mode === 'light' ? r.weekLight : r.week;
}
// Month and quarter targets shrink by whatever deal or light weeks took off, so one hard week doesn't sink the month.
export function periodTarget(G, kind, day) {
  if (kind === 'week') return weekTarget(G, periodOf('week', day).key);
  const p = periodOf(kind, day), base = G.rewards[kind];
  let off = 0;
  for (const d of p.days) if (L.weekDays(d)[0] === d) off += Math.max(0, G.rewards.week - weekTarget(G, d));
  return Math.max(60, base - off);
}
export function progress(G, cr, kind, day) {
  const p = periodOf(kind, day);
  const done = p.days.reduce((s, d) => s + ((cr.get(d) || {}).counted || 0), 0);
  const claim = G.claims.find((c) => c.kind === kind && c.key === p.key) || null;
  return { ...p, done, target: periodTarget(G, kind, day), claim };
}
// Goal time for one goal in a week (raw, before the daily cap).
export function goalWeek(cr, id, day) {
  return L.weekDays(day).reduce((s, d) => s + (((cr.get(d) || {}).byGoal || {})[id] || 0), 0);
}

// ---- Free time earned ----
// Earned: rate per goal hour (counted), doubled on a comeback day (first goal time after 7+ quiet days),
// plus bonuses for finished steps and milestones. Spent: Actual time in the fun category.
// The balance never goes below zero: overspending is forgiven, not carried as debt.
export function freeTime(G, cr, blocks, { now = Date.now(), timer = null } = {}) {
  const r = G.rewards, since = sinceKey(G), earn = new Map(), spend = new Map();
  const bump = (m, k, v) => { if (k >= since && v) m.set(k, (m.get(k) || 0) + v); };
  const days = [...cr.keys()].filter((k) => cr.get(k).raw > 0).sort();
  let comeback = null;
  days.forEach((k, i) => {
    const back = i > 0 && daysBetween(days[i - 1], k) > 7;
    if (back) comeback = k;
    bump(earn, k, (cr.get(k).counted / 60) * r.rate * (back ? 2 : 1));
  });
  for (const g of G.goals) {
    for (const s of g.steps) if (s.done && s.doneAt) bump(earn, L.dayKeyOf(s.doneAt), r.stepBonus);
    for (const m of g.milestones) if (m.done && m.doneAt) bump(earn, L.dayKeyOf(m.doneAt), r.milestoneBonus);
  }
  if (G.funCat) for (const b of blocks) if (b.layer === 'actual' && b.cat === G.funCat) bump(spend, b.day, b.end - b.start);
  let bal = 0, earned = 0, spent = 0;
  for (const k of [...new Set([...earn.keys(), ...spend.keys()])].sort()) {
    const e = earn.get(k) || 0, s = spend.get(k) || 0;
    earned += e; spent += s;
    bal = Math.max(0, bal + e - s);
  }
  const live = timer && G.funCat && timer.cat === G.funCat ? Math.max(0, (now - timer.startedAt) / 60000) : 0;
  return { balance: Math.round(Math.max(0, bal - live)), earned: Math.round(earned), spent: Math.round(spent + live), comeback };
}
// Wishlist: priced in goal hours. Every counted hour adds to the jar; buying something takes its hours out.
export function hoursJar(G, cr) {
  const since = sinceKey(G);
  let total = 0;
  for (const [k, d] of cr) if (k >= since) total += d.counted;
  const spent = G.wish.filter((w) => w.bought).reduce((s, w) => s + w.hours * 60, 0);
  return { total, spent, available: total - spent };
}

// ---- Phases (events): counted back from the date ----
export function phaseOf(g, day) {
  if (!DAY_RE.test(g.date || '')) return null;
  const left = daysBetween(day, g.date), weeks = Math.ceil(left / 7);
  if (left < 0) return { name: 'Past', left, weeks: 0, past: true };
  if (!g.phases.length) return { name: null, left, weeks };
  let acc = 0;
  for (let i = g.phases.length - 1; i > 0; i--) {
    acc += g.phases[i].weeks * 7;
    if (left <= acc) return { ...g.phases[i], left, weeks, index: i };
  }
  return { ...g.phases[0], left, weeks, index: 0, starts: L.addDays(g.date, -acc) };
}
export const targetOf = (g, day) => { const p = phaseOf(g, day); return p && Number.isFinite(p.target) ? p.target : g.target; };
export const nextStep = (g) => g.steps.find((s) => !s.done) || null;

// ---- Parking lot shelf and journal hints ----
export function shelf(G) {
  const out = [];
  for (const g of G.goals) if (g.status === 'active') g.sessions.forEach((s, i) => out.push({ id: `goal:${g.id}:${i}`, text: s.name, min: s.min, cat: g.cats[0], goal: g.id, goalName: g.name, shelf: true, at: 0 }));
  return out;
}
export function hints(G, cr, day) {
  const act = G.goals.filter((g) => g.status === 'active');
  const by = (cr.get(day) || {}).byGoal || {};
  return {
    steps: act.map((g) => ({ goal: g.name, text: (nextStep(g) || {}).text })).filter((x) => x.text),
    counted: act.filter((g) => by[g.id]).map((g) => ({ goal: g.name, min: by[g.id] })),
  };
}

// ---- Parsing list editors ("Long run 90 min", "Garmin watch 40h", "Build 7w 5h") ----
export function parseLines(text, cats) {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const p = L.parseTask(l, cats); return { name: (p.text || l).slice(0, 60), min: p.min, timed: p.timed }; });
}
export function parseWish(text) {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*?)\s*[-–—:·,]?\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\.?$/i);
    return m && m[1].trim() ? { name: m[1].trim().slice(0, 60), hours: Math.max(1, Math.round(+m[2])) } : { name: l.slice(0, 60), hours: 10 };
  });
}
export function parsePhases(text) {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const w = l.match(/(\d+)\s*w(?:ks?|eeks?)?\b/i), t = l.match(/(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\b/i);
    const name = l.replace(/(\d+)\s*w(?:ks?|eeks?)?\b/i, '').replace(/(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\b/gi, '').replace(/[·,/–—-]+/g, ' ').replace(/\s+/g, ' ').trim() || `Phase ${i + 1}`;
    return { name: name.slice(0, 30), weeks: i === 0 ? 0 : Math.max(1, w ? +w[1] : 4), target: t ? Math.round(+t[1] * 60 / 15) * 15 : 180 };
  });
}
const hrs = (m) => { const h = m / 60; return Number.isInteger(h) ? `${h}h` : `${+h.toFixed(2)}h`; };
export const phasesText = (ps) => ps.map((p, i) => `${p.name}${i ? ` ${p.weeks}w` : ''} ${hrs(p.target)}`).join('\n');

// ---- Validation and sync ----
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const validGoal = (g) => isObj(g) && typeof g.id === 'string' && !!g.id && typeof g.name === 'string' && SHAPES.includes(g.shape) && STATUSES.includes(g.status) &&
  ['cats', 'words', 'phases', 'sessions', 'steps', 'milestones', 'practices'].every((k) => Array.isArray(g[k])) && Number.isFinite(g.target) &&
  g.steps.every((s) => isObj(s) && typeof s.id === 'string' && typeof s.text === 'string') &&
  g.milestones.every((s) => isObj(s) && typeof s.id === 'string' && typeof s.text === 'string') &&
  g.practices.every((p) => isObj(p) && typeof p.id === 'string' && typeof p.name === 'string' && Number.isFinite(p.credit)) &&
  g.sessions.every((s) => isObj(s) && typeof s.name === 'string' && Number.isFinite(s.min));
export function validGoals(d) {
  return isObj(d) && d.v === 1 && DAY_RE.test(d.start || '') && Array.isArray(d.goals) && d.goals.every(validGoal) && new Set(d.goals.map((g) => g.id)).size === d.goals.length &&
    Array.isArray(d.checks) && d.checks.every((c) => isObj(c) && typeof c.id === 'string' && typeof c.goal === 'string' && DAY_RE.test(c.day) && Number.isFinite(c.credit)) &&
    Array.isArray(d.claims) && d.claims.every((c) => isObj(c) && typeof c.id === 'string' && typeof c.kind === 'string' && typeof c.key === 'string') &&
    Array.isArray(d.wish) && d.wish.every((w) => isObj(w) && typeof w.id === 'string' && typeof w.name === 'string' && Number.isFinite(w.hours)) &&
    isObj(d.weekMode) && isObj(d.rewards) && ['week', 'weekDeal', 'weekLight', 'month', 'quarter', 'rate', 'dayCap', 'stepBonus', 'milestoneBonus'].every((k) => Number.isFinite(d.rewards[k])) && isObj(d.rewards.menus);
}
// Three-way merge: goals by id, then field by field (steps, milestones and practices by id); everything else by id or key.
export function mergeGoals3(base, local, remote) {
  if (!remote) return local;
  if (!base && local.pristine) return remote; // a device that only has the starter goals takes the synced copy
  const E = { goals: [], checks: [], claims: [], wish: [], weekMode: {}, rewards: {} }, B = base || E;
  const bm = new Map(B.goals.map((g) => [g.id, g])), lm = new Map(local.goals.map((g) => [g.id, g])), rm = new Map(remote.goals.map((g) => [g.id, g]));
  const goals = mergeById(B.goals, local.goals, remote.goals).map((g) => {
    const l = lm.get(g.id), r = rm.get(g.id);
    if (!l || !r) return g;
    const b = bm.get(g.id) || {}, out = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
      if (['steps', 'milestones', 'practices'].includes(k)) out[k] = mergeById(b[k] || [], l[k] || [], r[k] || []);
      else { const v = pick3(b[k], l[k], r[k]); if (v !== undefined) out[k] = v; }
    }
    return out;
  });
  const keyed = (bo = {}, lo = {}, ro = {}) => {
    const out = {};
    for (const k of new Set([...Object.keys(bo), ...Object.keys(lo), ...Object.keys(ro)])) { const v = pick3(bo[k], lo[k], ro[k]); if (v !== undefined) out[k] = v; }
    return out;
  };
  const rewards = keyed(B.rewards, local.rewards, remote.rewards);
  rewards.menus = keyed((B.rewards || {}).menus, local.rewards.menus, remote.rewards.menus);
  const start = [local.start, remote.start].filter((s) => DAY_RE.test(s || '')).sort()[0] || local.start;
  const funCat = pick3(B.funCat, local.funCat, remote.funCat);
  return { v: 1, start, goals, rewards, funCat: funCat === undefined ? null : funCat, weekMode: keyed(B.weekMode, local.weekMode, remote.weekMode),
    checks: mergeById(B.checks, local.checks, remote.checks), claims: mergeById(B.claims, local.claims, remote.claims), wish: mergeById(B.wish, local.wish, remote.wish) };
}

// ---- UI ----
export function createGoals(ctx) {
  const { h, toast, showOverlay, closeOverlay, addToLot, openLot, planner, fmtH, onChange = () => {}, syncOn = () => false } = ctx;
  const root = document.getElementById('goals');
  const today = () => L.dayKeyOf(Date.now());
  let G = load(), saveT = 0, openMs = new Set(), showSomeday = false;
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(GKEY));
      if (validGoals(d)) return d;
      if (d) localStorage.setItem(`${GKEY}.bad-${Date.now()}`, JSON.stringify(d)); // never silently drop data
    } catch {}
    return freshGoals(today());
  }
  const persist = () => { try { localStorage.setItem(GKEY, JSON.stringify(G)); return true; } catch { toast('Couldn’t save just now.'); return false; } };
  const save = () => { clearTimeout(saveT); delete G.pristine; if (persist()) onChange(); };
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 400); };
  const cats = () => planner().cats;
  const catOf = (id) => cats().find((c) => c.id === id);
  const colorOf = (g) => { const c = catOf(g.cats[0]); return c ? c.color : 'var(--muted)'; };
  const cr = () => credits(G, planner().blocks);
  const fmtD = (key) => { const [y, m, d] = L.parseKey(key); return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const bar = (done, target, color) => h('div', { class: 'gbar' }, h('i', { style: `width:${Math.min(100, target ? (done / target) * 100 : 0)}%;${color ? `background:${color}` : ''}` }));
  const btn = (label, onclick, cls = '') => h('button', { class: cls, onclick }, label);

  // ---- Rewards ----
  const PERIODS = [['week', 'This week'], ['month', 'This month'], ['quarter', 'This quarter']];
  function rewardCard(kind, label, c) {
    const p = progress(G, c, kind, today()), hit = p.done >= p.target;
    const name = kind === 'quarter' ? `Q${p.q}` : kind === 'month' ? new Date(...L.parseKey(p.key).map((x, i) => (i === 1 ? x - 1 : x))).toLocaleDateString([], { month: 'long' }) : label;
    return h('div', { class: 'gcardr' + (hit ? ' hit' : ''), 'data-period': kind },
      h('div', { class: 'k' }, kind === 'week' ? label : name),
      h('div', { class: 'v' }, fmtH(p.done), h('small', {}, ` / ${fmtH(p.target)}`)),
      bar(p.done, p.target),
      p.claim ? h('div', { class: 'gsub' }, '★ ', p.claim.text)
        : hit ? h('button', { class: 'primary sm', onclick: () => openClaim(kind, p) }, 'Claim reward')
          : h('div', { class: 'gsub' }, `${fmtH(p.target - p.done)} to go`, h('span', { class: 'gmore' }, ` · then ${G.rewards.menus[kind].length ? 'a reward you pick' : 'set a reward'}`)));
  }
  function openClaim(kind, p) {
    const menu = G.rewards.menus[kind] || [];
    const other = h('input', { type: 'text', placeholder: 'Or name your own', maxlength: '80', autocomplete: 'off', 'aria-label': 'Your own reward' });
    const claim = (text) => {
      if (!filled(text)) return;
      G.claims.push({ id: uid(), kind, key: p.key, text: text.trim(), at: Date.now() });
      save(); closeOverlay(); render();
      toast(`Earned: ${text.trim()}. Enjoy it, fully.`, '', null, 4000);
    };
    showOverlay(h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Claim reward' },
      h('h3', {}, `You put in ${fmtH(p.done)}. Pick your reward.`),
      menu.length ? h('div', { class: 'gmenu' }, menu.map((m) => btn(m, () => claim(m)))) : null,
      menu.length > 1 ? btn('Surprise me', () => claim(menu[Math.floor(Math.random() * menu.length)])) : null,
      h('div', { class: 'row' }, other, btn('Claim', () => claim(other.value), 'primary')),
      btn('Later', closeOverlay)), 'gsheet', null, true);
  }
  function bankCard(c) {
    const st = planner(), f = freeTime(G, c, st.blocks, { timer: st.timer }), jar = hoursJar(G, c), fun = catOf(G.funCat);
    const wish = G.wish.filter((w) => !w.bought);
    const bought = G.wish.filter((w) => w.bought);
    return h('div', { class: 'card gbank' },
      h('div', { class: 'gbankrow' },
        h('div', {}, h('div', { class: 'k' }, 'Free time earned'), h('div', { class: 'v', id: 'gFree' }, fmtH(f.balance)),
          h('div', { class: 'gsub' }, fun ? `Guilt-free. It counts down while you log ${fun.name}.` : 'Guilt-free time, yours to spend.',
            f.comeback === today() ? ' Welcome back: today’s time earns double.' : '')),
        h('div', {}, h('div', { class: 'k' }, 'Hours in the jar'), h('div', { class: 'v' }, fmtH(Math.max(0, jar.available))),
          h('div', { class: 'gsub' }, `${G.rewards.rate} min free time per goal hour · +${G.rewards.stepBonus}m per step done`))),
      wish.length ? h('div', { class: 'gwish' }, wish.map((w) => {
        const have = Math.max(0, jar.available), need = w.hours * 60;
        return h('div', { class: 'gwrow', 'data-wish': w.id },
          h('span', { class: 'gwn' }, w.name), bar(Math.min(have, need), need),
          h('span', { class: 'gwh' }, `${fmtH(Math.min(have, need))} / ${w.hours}h`),
          have >= need ? h('button', { class: 'primary sm', onclick: () => {
            w.bought = today(); save(); render();
            toast(`${w.name}: earned with ${w.hours} hours of real work. Go get it.`, 'Undo', () => { delete w.bought; save(); render(); }, 6000);
          } }, 'Get it') : null);
      })) : h('p', { class: 'gsub' }, 'Add things you want to your wishlist in Reward settings, priced in goal hours.'),
      bought.length ? h('p', { class: 'gsub' }, `Earned so far: ${bought.map((w) => w.name).join(' · ')}`) : null);
  }

  // ---- Goal cards ----
  function goalCard(g, c) {
    const t = today(), ph = phaseOf(g, t), wk = goalWeek(c, g.id, t), tgt = targetOf(g, t), step = nextStep(g);
    const doneToday = new Set(G.checks.filter((x) => x.goal === g.id && x.day === t).map((x) => x.practice));
    const ms_ = g.milestones, open = ms_.filter((m) => !m.done), expanded = openMs.has(g.id);
    const stepIn = h('input', { type: 'text', placeholder: 'What’s the next small step?', maxlength: '160', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': `Next step for ${g.name}` });
    const addStep = () => { const v = stepIn.value.trim(); if (!v) return stepIn.focus(); g.steps.push({ id: uid(), text: v, done: false }); save(); render(); };
    stepIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addStep(); });
    const chip = ph ? (ph.past ? 'Date passed' : `${ph.name ? ph.name + ' · ' : ''}${ph.left === 0 ? 'today' : ph.weeks <= 1 ? `${ph.left} day${ph.left === 1 ? '' : 's'} to go` : `${ph.weeks} weeks to go`}`) : null;
    const msRow = (m) => {
      const box = h('input', { type: 'checkbox', checked: !!m.done, 'aria-label': m.text });
      box.addEventListener('change', () => {
        m.done = box.checked; if (m.done) m.doneAt = Date.now(); else delete m.doneAt;
        save(); render();
        if (m.done) toast(`Milestone: ${m.text}. +${fmtH(G.rewards.milestoneBonus)} free time.`, 'Undo', () => { m.done = false; delete m.doneAt; save(); render(); }, 5000);
      });
      return h('label', { class: 'gms' + (m.done ? ' done' : ''), 'data-ms': m.id }, box, h('span', {}, m.text), m.date ? h('time', {}, fmtD(m.date)) : null);
    };
    const msIn = h('input', { type: 'text', placeholder: 'Add a milestone', maxlength: '120', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'New milestone' });
    msIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && msIn.value.trim()) { g.milestones.push({ id: uid(), text: msIn.value.trim(), date: '', done: false }); save(); render(); } });
    return h('article', { class: 'gcard', style: `--c:${colorOf(g)}`, 'data-goal': g.id },
      h('header', {}, h('h3', {}, g.name || 'Untitled goal'), chip ? h('span', { class: 'gchip' }, chip) : null),
      g.why ? h('p', { class: 'gwhy' }, g.why) : h('button', { class: 'link gaddwhy', onclick: () => openEdit(g, 'why') }, '+ Why this matters to you'),
      h('div', { class: 'gweek' }, h('span', {}, 'This week'), bar(wk, tgt, colorOf(g)), h('b', {}, `${fmtH(wk)} / ${fmtH(tgt)}`)),
      h('div', { class: 'gstep' },
        h('div', { class: 'k' }, 'Next step'),
        step ? [h('p', {}, step.text), h('div', { class: 'row' },
          btn('Done', () => {
            step.done = true; step.doneAt = Date.now(); save(); render();
            toast(`Step done. +${fmtH(G.rewards.stepBonus)} free time. What’s next?`, 'Undo', () => { step.done = false; delete step.doneAt; save(); render(); }, 5000);
            setTimeout(() => { const i = root.querySelector(`[data-goal="${CSS.escape(g.id)}"] .gstep input`); if (i) i.focus(); }, 50);
          }, 'primary'),
          btn('To Parking lot', () => { addToLot(step.text, { goal: g.id, cat: g.cats[0] }); toast('In your Parking lot. Drag it onto the Plan.'); }))]
          : h('div', { class: 'row gadd' }, stepIn, btn('Add', addStep))),
      g.practices.length ? h('div', { class: 'gprac' }, h('div', { class: 'k' }, 'Today'), g.practices.map((p) => {
        const on = doneToday.has(p.id);
        return h('button', { class: 'gpbtn' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', 'data-practice': p.id, onclick: () => {
          if (on) G.checks = G.checks.filter((x) => !(x.goal === g.id && x.practice === p.id && x.day === t));
          else G.checks.push({ id: uid(), goal: g.id, practice: p.id, day: t, credit: p.credit, at: Date.now() });
          save(); render();
        } }, on ? '✓ ' : '', p.name, h('small', {}, ` ${fmtH(p.credit)}`));
      })) : null,
      g.floor ? h('p', { class: 'gfloor' }, h('b', {}, 'Rough day? '), g.floor) : null,
      g.sessions.length ? h('div', { class: 'gsess' }, h('span', { class: 'k' }, 'Sessions'), g.sessions.map((s) => h('button', { class: 'gsbtn', onclick: openLot, title: 'Drag it from the Parking lot onto the Plan' }, `${s.name} · ${fmtH(s.min)}`))) : null,
      ms_.length || expanded ? h('div', { class: 'gmss' },
        h('div', { class: 'k' }, 'Milestones', h('button', { class: 'link', onclick: () => { expanded ? openMs.delete(g.id) : openMs.add(g.id); render(); } }, expanded ? 'Fewer' : `${ms_.length - open.length} of ${ms_.length} · All`)),
        (expanded ? ms_ : open.slice(0, 2)).map(msRow), expanded ? msIn : null) : null,
      h('footer', {},
        btn('Edit', () => openEdit(g), 'link'),
        btn('Pause', () => setStatus(g, 'paused'), 'link'),
        btn('Someday', () => setStatus(g, 'someday'), 'link'),
        ms_.length ? null : btn('+ Milestone', () => { openMs.add(g.id); render(); }, 'link')));
  }
  function setStatus(g, s) {
    const prev = g.status;
    g.status = s; if (s === 'done') g.doneAt = Date.now();
    save(); render();
    const msg = { paused: 'Paused. It waits for you, nothing counts against it.', someday: 'Moved to Someday.', active: 'Back on.', done: 'Done. That’s a real one.' }[s];
    toast(msg, 'Undo', () => { g.status = prev; save(); render(); }, 5000);
  }

  // ---- Edit / new ----
  function openNew() {
    showOverlay(h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'New goal' },
      h('h3', {}, 'What kind of goal?'),
      ...TEMPLATES.map((t) => h('button', { class: 'gtpl', 'data-shape': t.shape, onclick: () => { const g = newGoal(t.shape); G.goals.push(g); save(); render(); openEdit(g, 'name', true); } },
        h('b', {}, t.name), h('span', {}, t.blurb))),
      btn('Cancel', closeOverlay)), 'gsheet', null, true);
  }
  function openEdit(g, focus = 'name', isNew = false) {
    const ta = (v, rows, label, ph) => { const x = h('textarea', { rows: String(rows), class: 'gta', 'aria-label': label, placeholder: ph || '' }); x.value = v; return x; };
    const name = h('input', { type: 'text', value: g.name, maxlength: '60', autocomplete: 'off', 'aria-label': 'Goal name', placeholder: 'Name it' });
    const why = ta(g.why, 2, 'Why it matters', 'Why does this matter to you? Future you reads this on hard days.');
    const floor = h('input', { type: 'text', value: g.floor, maxlength: '120', autocomplete: 'off', 'aria-label': 'Minimum version', placeholder: 'The 15-minute version for a rough day' });
    const words = h('input', { type: 'text', value: g.words.join(', '), autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Words', placeholder: 'run, long run, tempo' });
    const date = h('input', { type: 'date', value: g.date || '', 'aria-label': 'Date' });
    const sessions = ta(g.sessions.map((s) => `${s.name} ${fmtH(s.min)}`).join('\n'), 3, 'Sessions', 'Long run 90m\nEasy run 45m');
    const practices = ta(g.practices.map((p) => `${p.name} ${fmtH(p.credit)}`).join('\n'), 2, 'Check-ins', 'Ahnik 20m');
    const phases = ta(phasesText(g.phases), 4, 'Phases', 'Base 2.5h\nBuild 7w 5h\nPeak 8w 7h\nTaper 3w 4h');
    let target = g.target;
    const tv = h('span', { class: 'val' });
    const stepT = (d) => { target = Math.max(15, Math.min(1200, target + d)); tv.textContent = `${fmtH(target)} a week`; };
    stepT(0);
    const picked = new Set(g.cats.filter((id) => catOf(id)));
    const chips = cats().map((c) => h('button', { class: 'chip' + (picked.has(c.id) ? ' sel' : ''), style: `--c:${c.color}`, 'data-cat': c.id, onclick: (e) => {
      picked.has(c.id) ? picked.delete(c.id) : picked.add(c.id); e.currentTarget.classList.toggle('sel', picked.has(c.id));
    } }, h('span', { class: 'dot' }), c.name));
    let status = g.status;
    const stat = h('div', { class: 'seg' }, STATUSES.map((s) => h('button', { class: status === s ? 'sel' : '', 'data-status': s, onclick: () => {
      status = s; for (const b of stat.children) b.classList.toggle('sel', b.dataset.status === s);
    } }, s[0].toUpperCase() + s.slice(1))));
    const apply = () => {
      g.name = name.value.trim().slice(0, 60) || g.name || TEMPLATES.find((t) => t.shape === g.shape).name;
      g.why = why.value.trim().slice(0, 400);
      g.floor = floor.value.trim().slice(0, 120);
      g.words = words.value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean).slice(0, 30);
      g.date = DAY_RE.test(date.value) ? date.value : '';
      g.cats = cats().filter((c) => picked.has(c.id)).map((c) => c.id);
      g.target = target;
      if (status !== g.status) { g.status = status; if (status === 'done') g.doneAt = Date.now(); }
      g.sessions = parseLines(sessions.value, cats()).slice(0, 8).map((s) => ({ name: s.name, min: s.timed ? Math.max(15, s.min) : 45 }));
      const prevP = g.practices;
      g.practices = parseLines(practices.value, cats()).slice(0, 6).map((p) => ({ id: (prevP.find((x) => x.name === p.name) || {}).id || uid(), name: p.name, credit: p.timed ? p.min : 15 }));
      if (g.shape === 'event') g.phases = parsePhases(phases.value);
      save(); closeOverlay(); render();
    };
    const del = () => {
      const i = G.goals.indexOf(g);
      G.goals = G.goals.filter((x) => x !== g); save(); closeOverlay(); render();
      toast(`Deleted ${g.name || 'goal'}. Logged time stays in your planner.`, 'Undo', () => { G.goals.splice(i, 0, g); save(); render(); }, 6000);
    };
    const lab = (t, el, hint) => h('label', { class: 'fl' }, t, el, hint ? h('span', { class: 'gsub' }, hint) : null);
    const el = h('div', { class: 'pop sheet center gedit', role: 'dialog', 'aria-label': 'Edit goal' },
      h('h3', {}, isNew ? 'New goal' : 'Edit goal'),
      lab('Name', name), lab('Why', why), lab('Minimum version', floor, 'What still counts on a rough day.'),
      h('div', { class: 'fl' }, 'Counts time logged in', h('div', { class: 'chips' }, chips)),
      lab('…with any of these words in the title', words, 'Comma separated. Or link a block directly from its popover.'),
      h('div', { class: 'fl' }, 'Weekly time', h('div', { class: 'step' }, h('button', { 'aria-label': 'Less', onclick: () => stepT(-15) }, '−'), tv, h('button', { 'aria-label': 'More', onclick: () => stepT(15) }, '+'))),
      g.shape === 'event' || g.shape === 'project' || g.date ? lab(g.shape === 'event' ? 'Date' : 'Target date (optional)', date) : null,
      g.shape === 'event' ? lab('Phases, counting back from the date', phases, 'First line is where you are until the next phase starts. “Build 7w 5h” = 7 weeks at 5h a week.') : null,
      lab('Sessions for your Parking lot', sessions, 'One per line, with a length. They wait in the Parking lot, ready to drag onto the Plan.'),
      lab('Check-ins', practices, 'Quick things you don’t time. One tap a day; each counts its minutes.'),
      h('div', { class: 'fl' }, 'Status', stat),
      h('div', { class: 'row' }, isNew ? btn('Cancel', () => { G.goals = G.goals.filter((x) => x !== g); save(); closeOverlay(); render(); }) : btn('Delete', del, 'danger'), btn('Save', apply, 'primary')));
    showOverlay(el, 'gsheet', null, true);
    setTimeout(() => { (focus === 'why' ? why : name).focus(); }, 50);
  }

  // ---- Reward settings ----
  function openSettings() {
    const r = G.rewards, vals = {};
    const row = (key, label, stepBy, lo, hi, fmt = fmtH) => {
      vals[key] = r[key];
      const v = h('span', { class: 'val' });
      const set = (d) => { vals[key] = Math.max(lo, Math.min(hi, vals[key] + d)); v.textContent = fmt(vals[key]); };
      set(0);
      return h('div', { class: 'step gstepr', 'data-key': key }, h('span', { class: 'lab' }, label), h('button', { 'aria-label': `${label} less`, onclick: () => set(-stepBy) }, '−'), v, h('button', { 'aria-label': `${label} more`, onclick: () => set(stepBy) }, '+'));
    };
    const menuTa = (k, ph) => { const x = h('textarea', { rows: '3', class: 'gta', 'aria-label': `${k} rewards`, placeholder: ph }); x.value = r.menus[k].join('\n'); return x; };
    const mw = menuTa('week', 'Dinner somewhere good'), mm = menuTa('month', 'Concert tickets'), mq = menuTa('quarter', 'A weekend away');
    const wishTa = h('textarea', { rows: '4', class: 'gta', 'aria-label': 'Wishlist', placeholder: 'GPS running watch 40h' });
    wishTa.value = G.wish.filter((w) => !w.bought).map((w) => `${w.name} ${w.hours}h`).join('\n');
    let fun = G.funCat;
    const funChips = [...cats(), null].map((c) => h('button', { class: 'chip' + ((c ? c.id : null) === fun ? ' sel' : ''), 'data-cat': c ? c.id : '', style: c ? `--c:${c.color}` : null, onclick: () => {
      fun = c ? c.id : null; funChips.forEach((b) => b.classList.toggle('sel', (b.dataset.cat || null) === fun));
    } }, c ? h('span', { class: 'dot' }) : null, c ? c.name : 'None'));
    const lines = (ta) => ta.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 12);
    const apply = () => {
      Object.assign(r, vals);
      r.menus = { week: lines(mw), month: lines(mm), quarter: lines(mq) };
      const keep = G.wish.filter((w) => w.bought);
      G.wish = [...keep, ...parseWish(wishTa.value).slice(0, 12).map((w) => ({ id: (G.wish.find((x) => !x.bought && x.name === w.name) || {}).id || uid(), ...w }))];
      G.funCat = fun;
      save(); closeOverlay(); render();
    };
    const mins = (m) => `${m}m`;
    showOverlay(h('div', { class: 'pop sheet center gedit', role: 'dialog', 'aria-label': 'Reward settings' },
      h('h3', {}, 'Reward settings'),
      h('p', { class: 'muted' }, 'Targets count goal time: logged Actual blocks linked to a goal, plus check-ins.'),
      row('week', 'Week', 30, 60, 3000), row('weekDeal', 'Deal week', 30, 0, 3000), row('weekLight', 'Light week', 30, 0, 3000),
      row('month', 'Month', 60, 60, 12000), row('quarter', 'Quarter', 120, 120, 36000),
      h('hr'),
      row('rate', 'Earn per goal hour', 5, 0, 60, mins), row('dayCap', 'Count per day, max', 30, 60, 960),
      row('stepBonus', 'Step bonus', 15, 0, 120, mins), row('milestoneBonus', 'Milestone bonus', 15, 0, 240, mins),
      h('div', { class: 'fl' }, 'Free time counts down while you log', h('div', { class: 'chips' }, funChips)),
      h('hr'),
      h('label', { class: 'fl' }, 'Weekly rewards (one per line)', mw),
      h('label', { class: 'fl' }, 'Monthly rewards', mm),
      h('label', { class: 'fl' }, 'Quarterly rewards', mq),
      h('label', { class: 'fl' }, 'Wishlist, priced in goal hours', wishTa, h('span', { class: 'gsub' }, 'One per line: “Garmin watch 40h”.')),
      h('div', { class: 'row' }, btn('Cancel', closeOverlay), btn('Save', apply, 'primary'))), 'gsheet', null, true);
  }

  function render() {
    const c = cr(), t = today(), wk = progress(G, c, 'week', t);
    const act = G.goals.filter((g) => g.status === 'active'), rest = G.goals.filter((g) => g.status !== 'active');
    const mode = G.weekMode[wk.key] || 'normal';
    const seg = h('div', { class: 'seg gmode' }, MODES.map(([id, label]) => h('button', { class: mode === id ? 'sel' : '', 'data-mode': id, onclick: () => {
      if (id === 'normal') delete G.weekMode[wk.key]; else G.weekMode[wk.key] = id;
      save(); render();
    } }, label)));
    root.replaceChildren(...[
      h('div', { class: 'ghead' }, h('h2', {}, 'Goals'), seg),
      mode !== 'normal' ? h('p', { class: 'gsub gnote' }, mode === 'deal' ? 'Deal week: the bar is lower, and the month and quarter targets drop to match. Protect the minimum version.' : 'Light week: a lower bar, on purpose.') : null,
      h('div', { class: 'grewards' }, PERIODS.map(([k, label]) => rewardCard(k, label, c))),
      bankCard(c),
      h('div', { class: 'ggrid' }, act.map((g) => goalCard(g, c))),
      act.length ? null : h('p', { class: 'dempty' }, 'No active goals. Start one below, or bring one back from Someday.'),
      rest.length ? h('div', { class: 'gsome' },
        h('button', { class: 'link', onclick: () => { showSomeday = !showSomeday; render(); } }, `${showSomeday ? 'Hide' : 'Show'} paused, someday and done (${rest.length})`),
        showSomeday ? rest.map((g) => h('div', { class: 'gsrow', 'data-goal': g.id, style: `--c:${colorOf(g)}` },
          h('span', { class: 'dot' }), h('b', {}, g.name || 'Untitled'), h('span', { class: 'gsub' }, g.status),
          btn('Edit', () => openEdit(g), 'link'), g.status === 'done' ? null : btn('Start', () => setStatus(g, 'active'), 'link'))) : null) : null,
      h('div', { class: 'gfoot' }, btn('+ New goal', openNew, 'primary'), btn('Reward settings', openSettings)),
      h('p', { class: 'gsub gcenter' }, syncOn() ? 'Syncs with your other devices through your private repo.' : 'Stays on this device until you turn on sync (Export / Backup).')].filter(Boolean));
  }

  const busy = () => root.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  return {
    render, busy,
    get data() { return G; },
    replace(next) { G = next; persist(); },
    // For the rest of the app:
    weekLine: () => { const p = progress(G, cr(), 'week', today()); return { done: p.done, target: p.target }; },
    freeLeft: (live = true) => { const st = planner(); return freeTime(G, cr(), st.blocks, { timer: live ? st.timer : null }).balance; },
    funCat: () => G.funCat,
    shelf: () => shelf(G),
    active: () => G.goals.filter((g) => g.status === 'active'),
    goalOf: (b) => goalOf(b, G.goals),
    colorOf,
    hints: () => hints(G, cr(), today()),
  };
}
