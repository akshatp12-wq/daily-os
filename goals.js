// Goals — time spent on what matters, turned into rewards you can actually use.
// Each active goal has weekly hours. Logged Actual time counts when the block is linked to the goal
// (or its title has one of the goal's words, in the goal's categories); check-ins and time added by hand count too.
// The week's hours unlock a reward you pick, earn guilt-free free time, and fill a wishlist jar.
// Its own storage key; syncs as goals.json in the private repo when sync is on.
import * as L from './logic.js';
import { pick3, mergeById } from './sync.js';

export const GKEY = 'dailyos.goals';
export const SHAPES = ['event', 'practice', 'project', 'mastery'];
export const STATUSES = ['active', 'inactive'];
export const DEAL_FACTOR = 0.25, LIGHT_FACTOR = 0.5;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayNum = (key) => { const [y, m, d] = L.parseKey(key); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
const uid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const filled = (v) => typeof v === 'string' && !!v.trim();
const r15 = (m) => Math.round(m / 15) * 15;

// ---- Defaults ----
export const DEFAULT_REWARDS = {
  rate: 15,          // minutes of free time per goal hour
  dayCap: 240,       // at most this much goal time counts per day
  stepBonus: 30, milestoneBonus: 60,
  menus: { // samples; replace with your own
    week: ['Dinner somewhere good', 'A new book', 'Movie night, no laptop'],
    month: ['Tickets to a game or concert', 'New gym gear'],
    quarter: ['A weekend away'],
  },
};
const g0 = (o) => ({ name: '', why: '', floor: '', shape: 'project', status: 'active', date: '', cats: [], words: [], target: 180, phases: [], sessions: [], steps: [], milestones: [], practices: [], ...o });
const ms = (id, text, date = '', reward = '') => ({ id, text, date, done: false, ...(reward ? { reward } : {}) });
// Deterministic ids, so two devices that each start fresh agree after sync.
export function starterGoals() {
  return [
    // Lead measures that actually get an IB analyst hired at an L/S pod: a real coverage universe, two pitches that
    // survive pushback (one long, one short), earnings-season reps, timed model tests, and the headhunter funnel.
    g0({ id: 'hf', name: 'Hedge fund seat', shape: 'project', date: '2027-03-31', cats: ['career'], target: 720,
      words: ['pitch', 'hedge', 'coverage', 'model', 'comps', 'earnings', 'transcript', '10-k', '10-q', 'thesis', 'short idea', 'long/short', 'l/s', 'tear sheet', 'headhunter', 'coffee chat', 'networking', 'industrials', 'model test'],
      floor: 'Read one earnings call transcript or one 10-K section. 15 minutes.',
      phases: [{ name: 'Coverage', weeks: 0, target: 720 }, { name: 'Pitches + earnings', weeks: 9, target: 720 }, { name: 'Recruiting push', weeks: 4, target: 600 }],
      sessions: [{ name: 'Model a coverage name', min: 90 }, { name: 'Pitch work', min: 90 }, { name: 'Earnings note', min: 30 }, { name: 'Timed model test', min: 180 }, { name: 'Headhunter or coffee chat', min: 30 }],
      steps: [{ id: 'hf2-s1', text: 'Write the list of 15 Industrials & Business Services names to cover', done: false }],
      milestones: [
        ms('hf2-m1', 'Coverage list: 15 Industrials & Business Services names', '2026-11-15'),
        ms('hf2-m2', 'Meet 5 headhunters who place at multi-managers', '2026-12-15'),
        ms('hf2-m3', 'Tear sheet and simple model on 10 names', '2026-12-20'),
        ms('hf2-m4', 'Long pitch, stress-tested by someone in the seat', '2027-01-10'),
        ms('hf2-m5', 'Short pitch, stress-tested', '2027-01-31'),
        ms('hf2-m6', '3 timed model tests', '2027-02-15'),
        ms('hf2-m7', 'Q4 earnings: preview and recap on 5 coverage names', '2027-02-28'),
        ms('hf2-m8', '20 conversations with people in the seat', '2027-03-15'),
        ms('hf2-m9', 'Get into the 6-week program'),
        ms('hf2-m10', 'Offer: analyst at an L/S fundamental multi-manager', '2027-03-31', 'A real trip before you start'),
      ] }),
    // HYROX: 8 × 1 km runs with a functional station after each. Strength and running, the whole body, and a real start line.
    g0({ id: 'fitness', name: 'HYROX', shape: 'event', date: '2027-05-27', cats: ['self'], target: 270,
      words: ['run', 'strength', 'lift', 'squat', 'deadlift', 'bench', 'press', 'pull-up', 'interval', 'tempo', 'zone 2', 'hyrox', 'sled', 'wall ball', 'rowing', 'ski erg', 'gym', 'workout', 'conditioning'],
      floor: '20 minutes: walk-jog, or 3 rounds of squats, push-ups and rows.',
      phases: [{ name: 'Foundation', weeks: 0, target: 270 }, { name: 'Build', weeks: 10, target: 330 }, { name: 'Race-specific', weeks: 8, target: 360 }, { name: 'Taper', weeks: 1, target: 180 }],
      sessions: [{ name: 'Strength A (squat, bench, row)', min: 60 }, { name: 'Strength B (deadlift, press, pull-ups)', min: 60 }, { name: 'Run intervals', min: 45 }, { name: 'Hybrid stations', min: 60 }, { name: 'Easy run', min: 45 }],
      steps: [{ id: 'fit-s1', text: 'Test your starting numbers: a 5K, and 5-rep squat, bench and deadlift', done: false }],
      milestones: [
        ms('fit-m1', 'Starting numbers tested', '2026-11-15'),
        ms('fit-m2', '20 training sessions logged', '', 'New training shoes'),
        ms('fit-m3', '5K under 25 minutes'),
        ms('fit-m4', 'Squat 1.5× and deadlift 2× bodyweight', '', 'A sports massage'),
        ms('fit-m5', '10 strict pull-ups'),
        ms('fit-m6', 'Benchmark race: HYROX Chicago, Navy Pier', '2027-02-11', 'Race-day kit'),
        ms('fit-m7', 'Race HYROX New York', '2027-05-27', 'GPS running watch'),
      ] }),
    g0({ id: 'satsang', name: 'Satsang', shape: 'practice', cats: ['self', 'life'], target: 150,
      words: ['satsang', 'ahnik', 'mukhpath', 'puja', 'katha', 'sabha', 'vachanamrut', 'lion cubs'],
      floor: 'Ahnik, even a short one.',
      practices: [{ id: 'sat-p1', name: 'Ahnik', credit: 20 }, { id: 'sat-p2', name: 'Mukhpath review', credit: 10 }],
      sessions: [{ name: 'Read or study', min: 30 }, { name: 'New mukhpath', min: 20 }],
      steps: [{ id: 'sat-s1', text: 'Choose the book or topic for this month', done: false }],
      milestones: [ms('sat-m1', 'Teach Lion Cubs this month')] }),
    g0({ id: 'builder', name: 'Build something of my own', shape: 'project', status: 'inactive', cats: ['career'] }),
    g0({ id: 'hotel', name: 'Hotel exit', shape: 'project', status: 'inactive', cats: ['career'] }),
  ];
}
export const freshGoals = (today) => ({
  v: 2, start: today, pristine: true, goals: starterGoals(), checks: [], claims: [], weekMode: {}, funCat: 'drift',
  rewards: JSON.parse(JSON.stringify(DEFAULT_REWARDS)),
  wish: [{ id: 'w-trip', name: 'A weekend trip', hours: 120 }],
});
// v1 -> v2: two statuses (active / inactive), weekly hours per goal, the reworked hedge fund goal,
// and the marathon replaced by HYROX. Deterministic, so every device migrates to the same data.
export function migrateGoals(d) {
  if (!d || typeof d !== 'object' || d.v !== 1 || !Array.isArray(d.goals)) return d;
  const S = starterGoals(), starter = (id) => S.find((g) => g.id === id);
  const goals = [];
  for (const g of d.goals) {
    if (g.id === 'marathon') continue;
    const status = g.status === 'active' ? 'active' : 'inactive';
    if (g.id === 'hf') {
      const n = starter('hf');
      const mine = g.steps.filter((s) => !s.done && s.id !== 'hf-s1');
      goals.push({ ...n, why: g.why || '', status, steps: [...g.steps.filter((s) => s.done), ...mine, ...n.steps], milestones: [...g.milestones.filter((m) => m.done), ...n.milestones] });
    } else goals.push({ ...g, status });
  }
  if (!goals.some((g) => g.id === 'fitness')) goals.splice(Math.min(1, goals.length), 0, starter('fitness'));
  const { rate = 15, dayCap = 240, stepBonus = 30, milestoneBonus = 60, menus = DEFAULT_REWARDS.menus } = d.rewards || {};
  return { ...d, v: 2, goals, checks: (d.checks || []).filter((c) => c.goal !== 'marathon'), rewards: { rate, dayCap, stepBonus, milestoneBonus, menus },
    wish: (d.wish || []).filter((w) => w.id !== 'w-watch' || w.bought) };
}

// Templates for new goals.
export const TEMPLATES = [
  { shape: 'event', name: 'Event', blurb: 'A date you’re working toward: a race, an exam, a launch.',
    make: () => ({ target: 180, phases: [{ name: 'Base', weeks: 0, target: 150 }, { name: 'Build', weeks: 6, target: 240 }, { name: 'Final push', weeks: 2, target: 300 }], sessions: [{ name: 'Session', min: 45 }] }) },
  { shape: 'practice', name: 'Practice', blurb: 'Something you do most days. One tap to check in.',
    make: () => ({ target: 120, practices: [{ id: uid(), name: 'Daily practice', credit: 15 }] }) },
  { shape: 'project', name: 'Project', blurb: 'An outcome with steps. Always one small next step.',
    make: () => ({ target: 240, sessions: [{ name: 'Deep work', min: 60 }] }) },
  { shape: 'mastery', name: 'Skill', blurb: 'Getting better at something. Hours add up.',
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

// ---- Phases: counted back from the date ----
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
// A goal's own weekly hours (its current phase's, when it has phases).
export const targetOf = (g, day) => { const p = phaseOf(g, day); return p && Number.isFinite(p.target) ? p.target : g.target; };
export const modeFactor = (G, day) => { const m = G.weekMode[L.weekDays(day)[0]]; return m === 'deal' ? DEAL_FACTOR : m === 'light' ? LIGHT_FACTOR : 1; };
// This week's target for a goal, after a deal week lowers it.
export const goalTarget = (G, g, day) => r15(targetOf(g, day) * modeFactor(G, day));
export const nextStep = (g) => g.steps.find((s) => !s.done) || null;
// Next milestone: the earliest dated one not done, else the first undated one.
export function nextMilestone(g) {
  const open = g.milestones.filter((m) => !m.done);
  return open.filter((m) => DAY_RE.test(m.date || '')).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0] || open[0] || null;
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
export const active = (G) => G.goals.filter((g) => g.status === 'active');
// The week's reward target is the sum of the active goals' weekly hours.
export const weekTarget = (G, day) => active(G).reduce((s, g) => s + goalTarget(G, g, day), 0);
// Month and quarter: the weekly targets spread over their days, so deal weeks lower them too.
export function periodTarget(G, kind, day) {
  if (kind === 'week') return weekTarget(G, day);
  const memo = new Map();
  let sum = 0;
  for (const d of periodOf(kind, day).days) { const w = L.weekDays(d)[0]; if (!memo.has(w)) memo.set(w, weekTarget(G, w)); sum += memo.get(w) / 7; }
  return Math.max(60, r15(sum));
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
// The bars on the Planner: one per active goal, for the week of `day`.
export const weekBars = (G, cr, day) => active(G).map((g) => ({ id: g.id, name: g.name, done: goalWeek(cr, g.id, day), target: goalTarget(G, g, day) }));

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

// ---- Parking lot shelf and journal hints ----
export function shelf(G) {
  const out = [];
  for (const g of active(G)) g.sessions.forEach((s, i) => out.push({ id: `goal:${g.id}:${i}`, text: s.name, min: s.min, cat: g.cats[0], goal: g.id, goalName: g.name, shelf: true, at: 0 }));
  return out;
}
export function hints(G, cr, day) {
  const by = (cr.get(day) || {}).byGoal || {};
  return {
    steps: active(G).map((g) => ({ goal: g.name, text: (nextStep(g) || {}).text })).filter((x) => x.text),
    counted: active(G).filter((g) => by[g.id]).map((g) => ({ goal: g.name, min: by[g.id] })),
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
    const name = l.replace(/(\d+)\s*w(?:ks?|eeks?)?\b/i, '').replace(/(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\b/gi, '').replace(/(^|\s)[·,/–—-]+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim() || `Phase ${i + 1}`;
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
  return isObj(d) && d.v === 2 && DAY_RE.test(d.start || '') && Array.isArray(d.goals) && d.goals.every(validGoal) && new Set(d.goals.map((g) => g.id)).size === d.goals.length &&
    Array.isArray(d.checks) && d.checks.every((c) => isObj(c) && typeof c.id === 'string' && typeof c.goal === 'string' && DAY_RE.test(c.day) && Number.isFinite(c.credit)) &&
    Array.isArray(d.claims) && d.claims.every((c) => isObj(c) && typeof c.id === 'string' && typeof c.kind === 'string' && typeof c.key === 'string') &&
    Array.isArray(d.wish) && d.wish.every((w) => isObj(w) && typeof w.id === 'string' && typeof w.name === 'string' && Number.isFinite(w.hours)) &&
    isObj(d.weekMode) && isObj(d.rewards) && ['rate', 'dayCap', 'stepBonus', 'milestoneBonus'].every((k) => Number.isFinite(d.rewards[k])) && isObj(d.rewards.menus);
}
// Three-way merge: goals by id, then field by field (steps, milestones and practices by id); everything else by id or key.
export function mergeGoals3(base, local, remote) {
  base = base && migrateGoals(base); local = migrateGoals(local); remote = remote && migrateGoals(remote);
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
  return { v: 2, start, goals, rewards, funCat: funCat === undefined ? null : funCat, weekMode: keyed(B.weekMode, local.weekMode, remote.weekMode),
    checks: mergeById(B.checks, local.checks, remote.checks), claims: mergeById(B.claims, local.claims, remote.claims), wish: mergeById(B.wish, local.wish, remote.wish) };
}

// ---- UI ----
export function createGoals(ctx) {
  const { h, toast, showOverlay, closeOverlay, onClose = () => {}, addToLot, openLot, planner, fmtH, onChange = () => {}, syncOn = () => false } = ctx;
  const root = document.getElementById('goals');
  const today = () => L.dayKeyOf(Date.now());
  let G = load(), saveT = 0, showInactive = false;
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(GKEY)), d = migrateGoals(raw);
      if (validGoals(d)) {
        if (raw && raw.v === 1) { try { localStorage.setItem(`${GKEY}.v1`, JSON.stringify(raw)); localStorage.setItem(GKEY, JSON.stringify(d)); } catch {} }
        return d;
      }
      if (raw) localStorage.setItem(`${GKEY}.bad-${Date.now()}`, JSON.stringify(raw)); // never silently drop data
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
  const byId = (id) => G.goals.find((g) => g.id === id);
  const fmtD = (key) => { const [y, m, d] = L.parseKey(key); return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const bar = (done, target, color) => h('div', { class: 'gbar' }, h('i', { style: `width:${Math.min(100, target ? (done / target) * 100 : 0)}%;${color ? `background:${color}` : ''}` }));
  const btn = (label, onclick, cls = '') => h('button', { class: cls, onclick }, label);
  const isDeal = () => G.weekMode[L.weekDays(today())[0]] === 'deal';
  const phaseChip = (g) => {
    const ph = phaseOf(g, today());
    if (!ph) return null;
    return ph.past ? 'Date passed' : `${ph.name ? ph.name + ' · ' : ''}${ph.left === 0 ? 'today' : ph.weeks <= 1 ? `${ph.left} day${ph.left === 1 ? '' : 's'} to go` : `${ph.weeks} weeks to go`}`;
  };

  // ---- Steps and milestones (shared by the card and the sheet) ----
  function finishStep(g, s) {
    s.done = true; s.doneAt = Date.now(); save(); render();
    toast(`Step done. +${fmtH(G.rewards.stepBonus)} free time.`, 'Undo', () => { s.done = false; delete s.doneAt; save(); render(); }, 5000);
    if (!nextStep(g)) setTimeout(() => { const i = root.querySelector(`[data-goal="${CSS.escape(g.id)}"] .gnext input`); if (i) i.focus(); }, 50);
  }
  function toggleMilestone(g, m, done) {
    m.done = done; if (done) m.doneAt = Date.now(); else delete m.doneAt;
    save();
    if (done) toast(m.reward ? `${m.text}. You earned: ${m.reward}.` : `Milestone: ${m.text}. +${fmtH(G.rewards.milestoneBonus)} free time.`, 'Undo', () => { m.done = false; delete m.doneAt; save(); render(); }, 6000);
  }

  // ---- Goal card: name, this week, next step, (check-ins), next milestone. Everything else lives in Details. ----
  function goalCard(g, c) {
    const t = today(), wk = goalWeek(c, g.id, t), tgt = goalTarget(G, g, t), step = nextStep(g), m = nextMilestone(g), chip = phaseChip(g);
    const doneToday = new Set(G.checks.filter((x) => x.goal === g.id && x.day === t).map((x) => x.practice));
    let next;
    if (step) next = h('div', { class: 'gnext' }, h('button', { class: 'gtick', 'aria-label': `Done: ${step.text}`, onclick: () => finishStep(g, step) }), h('p', {}, step.text));
    else {
      const inp = h('input', { type: 'text', placeholder: 'Next small step…', maxlength: '160', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': `Next step for ${g.name}` });
      const add = () => { const v = inp.value.trim(); if (!v) return inp.focus(); g.steps.push({ id: uid(), text: v, done: false }); save(); render(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      next = h('div', { class: 'gnext empty' }, inp, btn('Add', add, 'sm'));
    }
    return h('article', { class: 'gcard', style: `--c:${colorOf(g)}`, 'data-goal': g.id },
      h('header', {}, h('button', { class: 'gname', onclick: () => openGoal(g) }, g.name || 'Untitled goal'), chip ? h('span', { class: 'gchip' }, chip) : null),
      h('div', { class: 'gweek' }, bar(wk, tgt, colorOf(g)), h('b', {}, `${fmtH(wk)} / ${fmtH(tgt)}`)),
      next,
      g.practices.length ? h('div', { class: 'gprac' }, g.practices.map((p) => {
        const on = doneToday.has(p.id);
        return h('button', { class: 'gpbtn' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', 'data-practice': p.id, onclick: () => {
          if (on) G.checks = G.checks.filter((x) => !(x.goal === g.id && x.practice === p.id && x.day === t));
          else G.checks.push({ id: uid(), goal: g.id, practice: p.id, day: t, credit: p.credit, at: Date.now() });
          save(); render();
        } }, on ? '✓ ' : '', p.name, h('small', {}, ` ${fmtH(p.credit)}`));
      })) : null,
      m ? h('p', { class: 'gms1' }, h('span', { class: 'k' }, 'Next milestone '), m.text, m.date ? ` · ${fmtD(m.date)}` : '', m.reward ? h('span', { class: 'grw' }, ` → ${m.reward}`) : null) : null,
      h('button', { class: 'link gmore', onclick: () => openGoal(g) }, 'Details'));
  }

  // ---- Details sheet: everything about one goal, edited in place ----
  function openGoal(g, isNew = false) {
    const el = h('div', { class: 'pop sheet center gwide', role: 'dialog', 'aria-label': 'Goal details' });
    const live = (input, set, ev = 'input') => { input.addEventListener(ev, () => { set(input.value); saveSoon(); }); return input; };
    const text = (value, label, ph, max = 120) => h('input', { type: 'text', value: value || '', maxlength: String(max), autocomplete: 'off', 'aria-label': label, placeholder: ph || '' });
    const area = (value, rows, label, ph) => { const x = h('textarea', { rows: String(rows), class: 'gta', 'aria-label': label, placeholder: ph || '' }); x.value = value; return x; };
    const sec = (title, ...kids) => h('section', { class: 'gsec' }, h('h4', {}, title), ...kids);
    const rm = (label, fn) => h('button', { class: 'sm gx', 'aria-label': label, onclick: fn }, '✕');

    const name = live(text(g.name, 'Goal name', 'Name it', 60), (v) => { g.name = v.trim().slice(0, 60); });
    const status = h('div', { class: 'seg' }, STATUSES.map((s) => h('button', { class: g.status === s ? 'sel' : '', 'data-status': s, onclick: () => {
      g.status = s; save(); for (const b of status.children) b.classList.toggle('sel', b.dataset.status === s);
    } }, s === 'active' ? 'Active' : 'Inactive')));

    // Weekly hours (the current phase's, when there are phases)
    const tv = h('span', { class: 'val' });
    const ph = () => phaseOf(g, today());
    const getT = () => { const p = ph(); return p && Number.isFinite(p.target) && p.index != null ? g.phases[p.index].target : g.target; };
    const setT = (v) => { const p = ph(); if (p && Number.isFinite(p.target) && p.index != null) g.phases[p.index].target = v; else g.target = v; };
    const paintT = () => { const p = ph(); tv.textContent = `${fmtH(getT())} a week${p && p.name && p.index != null ? ` · ${p.name}` : ''}`; };
    const stepT = (d) => { setT(Math.max(15, Math.min(2400, getT() + d))); paintT(); save(); };
    paintT();

    // Next steps: the first open one is "next"; ↑ makes another one next
    const steps = h('div', { class: 'glist' });
    const drawSteps = () => {
      const open = g.steps.filter((s) => !s.done), done = g.steps.filter((s) => s.done);
      const add = text('', 'New step', 'Add a step');
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter' && add.value.trim()) { g.steps.push({ id: uid(), text: add.value.trim().slice(0, 160), done: false }); save(); drawSteps(); steps.querySelector('input[aria-label="New step"]').focus(); } });
      steps.replaceChildren(...open.map((s, i) => h('div', { class: 'grow', 'data-step': s.id },
        h('button', { class: 'gtick', 'aria-label': `Done: ${s.text}`, onclick: () => { s.done = true; s.doneAt = Date.now(); save(); drawSteps(); } }),
        live(text(s.text, 'Step', '', 160), (v) => { if (v.trim()) s.text = v.trim(); }),
        i ? h('button', { class: 'sm gx', 'aria-label': `Make next: ${s.text}`, onclick: () => { g.steps = [s, ...g.steps.filter((x) => x !== s)]; save(); drawSteps(); } }, '↑') : h('span', { class: 'gtag' }, 'next'),
        rm(`Remove step ${s.text}`, () => { g.steps = g.steps.filter((x) => x !== s); save(); drawSteps(); }))),
      add, ...(done.length ? [h('p', { class: 'gsub' }, `${done.length} done`)] : []));
    };
    drawSteps();

    // Milestones: text, date, reward — all editable
    const mss = h('div', { class: 'glist' });
    const drawMs = () => {
      const add = text('', 'New milestone', 'Add a milestone');
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter' && add.value.trim()) { g.milestones.push({ id: uid(), text: add.value.trim().slice(0, 120), date: '', done: false }); save(); drawMs(); mss.querySelector('input[aria-label="New milestone"]').focus(); } });
      mss.replaceChildren(...g.milestones.map((m) => {
        const box = h('input', { type: 'checkbox', checked: !!m.done, 'aria-label': `Done: ${m.text}` });
        box.addEventListener('change', () => toggleMilestone(g, m, box.checked));
        const date = h('input', { type: 'date', value: m.date || '', 'aria-label': `Date for ${m.text}` });
        date.addEventListener('change', () => { m.date = DAY_RE.test(date.value) ? date.value : ''; save(); });
        const reward = live(text(m.reward, `Reward for ${m.text}`, 'Reward when you hit it (optional)', 80), (v) => { if (v.trim()) m.reward = v.trim(); else delete m.reward; });
        return h('div', { class: 'gmrow' + (m.done ? ' done' : ''), 'data-ms': m.id },
          h('div', { class: 'grow' }, box, live(text(m.text, 'Milestone', '', 120), (v) => { if (v.trim()) m.text = v.trim(); }),
            rm(`Remove milestone ${m.text}`, () => { g.milestones = g.milestones.filter((x) => x !== m); save(); drawMs(); })),
          h('div', { class: 'grow sub' }, date, reward));
      }), add);
    };
    drawMs();

    const why = live(area(g.why, 2, 'Why it matters', 'Why does this matter to you? You’ll reread this on hard days.'), (v) => { g.why = v.trim().slice(0, 400); });
    const floor = live(text(g.floor, 'Minimum version', 'The 15-minute version for a rough day'), (v) => { g.floor = v.trim().slice(0, 120); });
    const sessions = live(area(g.sessions.map((s) => `${s.name} ${fmtH(s.min)}`).join('\n'), 3, 'Sessions', 'Long run 90m'),
      (v) => { g.sessions = parseLines(v, cats()).slice(0, 8).map((s) => ({ name: s.name, min: s.timed ? Math.max(15, s.min) : 45 })); }, 'change');
    const practices = live(area(g.practices.map((p) => `${p.name} ${fmtH(p.credit)}`).join('\n'), 2, 'Check-ins', 'Ahnik 20m'),
      (v) => { const prev = g.practices; g.practices = parseLines(v, cats()).slice(0, 6).map((p) => ({ id: (prev.find((x) => x.name === p.name) || {}).id || uid(), name: p.name, credit: p.timed ? p.min : 15 })); }, 'change');
    const picked = new Set(g.cats.filter((id) => catOf(id)));
    const chips = cats().map((c) => h('button', { class: 'chip' + (picked.has(c.id) ? ' sel' : ''), style: `--c:${c.color}`, 'data-cat': c.id, onclick: (e) => {
      picked.has(c.id) ? picked.delete(c.id) : picked.add(c.id); e.currentTarget.classList.toggle('sel', picked.has(c.id));
      g.cats = cats().filter((x) => picked.has(x.id)).map((x) => x.id); save();
    } }, h('span', { class: 'dot' }), c.name));
    const words = live(text(g.words.join(', '), 'Words', 'run, long run, tempo', 400), (v) => { g.words = v.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean).slice(0, 30); });
    const date = h('input', { type: 'date', value: g.date || '', 'aria-label': 'Date' });
    date.addEventListener('change', () => { g.date = DAY_RE.test(date.value) ? date.value : ''; save(); paintT(); });
    const phases = live(area(phasesText(g.phases), 4, 'Phases', 'Base 2.5h\nBuild 7w 5h'), (v) => { g.phases = parsePhases(v); paintT(); }, 'change');
    const lab = (t, input, hint) => h('label', { class: 'fl' }, t, input, hint ? h('span', { class: 'gsub' }, hint) : null);

    el.append(
      h('div', { class: 'gsheethead' }, name, status),
      sec('Weekly hours', h('div', { class: 'step' }, h('button', { 'aria-label': 'Less', onclick: () => stepT(-30) }, '−'), tv, h('button', { 'aria-label': 'More', onclick: () => stepT(30) }, '+'))),
      sec('Next steps', steps),
      sec('Milestones', mss),
      sec('Why', why, lab('Rough-day version', floor)),
      h('details', { class: 'gmorebox' }, h('summary', {}, 'Sessions, check-ins, what counts, dates'),
        lab('Sessions for your Parking lot', sessions, 'One per line, with a length.'),
        lab('Check-ins', practices, 'Quick things you don’t time. One tap a day.'),
        h('div', { class: 'fl' }, 'Counts time logged in', h('div', { class: 'chips' }, chips)),
        lab('…with any of these words in the title', words, 'Comma separated. Or link a block from its popover.'),
        lab(g.shape === 'event' ? 'Date' : 'Target date (optional)', date),
        g.phases.length || g.shape === 'event' ? lab('Phases, counting back from the date', phases, '“Build 7w 5h” = the 7 weeks before the next phase, at 5h a week.') : null),
      h('div', { class: 'row' },
        isNew ? btn('Cancel', () => { G.goals = G.goals.filter((x) => x !== g); save(); closeOverlay(); }) : btn('Delete goal', () => {
          const i = G.goals.indexOf(g);
          G.goals = G.goals.filter((x) => x !== g); save(); closeOverlay();
          toast(`Deleted ${g.name || 'goal'}. Logged time stays in your planner.`, 'Undo', () => { G.goals.splice(i, 0, g); save(); render(); }, 6000);
        }, 'danger'),
        btn('Done', closeOverlay, 'primary')));
    showOverlay(el, 'gsheet', null, true);
    onClose(() => { clearTimeout(saveT); if (!g.name.trim() && G.goals.includes(g)) g.name = (TEMPLATES.find((t) => t.shape === g.shape) || {}).name || 'Goal'; save(); render(); });
    if (isNew) setTimeout(() => name.focus(), 50);
  }
  function openNew() {
    showOverlay(h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'New goal' },
      h('h3', {}, 'What kind of goal?'),
      ...TEMPLATES.map((t) => h('button', { class: 'gtpl', 'data-shape': t.shape, onclick: () => { const g = newGoal(t.shape); G.goals.push(g); save(); openGoal(g, true); } },
        h('b', {}, t.name), h('span', {}, t.blurb))),
      btn('Cancel', closeOverlay)), 'gsheet', null, true);
  }

  // ---- Rewards: one line on the tab; the rest in a sheet ----
  const PERIODS = [['week', 'This week'], ['month', 'This month'], ['quarter', 'This quarter']];
  function openClaim(kind, p) {
    const menu = G.rewards.menus[kind] || [];
    const other = h('input', { type: 'text', placeholder: 'Or name your own', maxlength: '80', autocomplete: 'off', 'aria-label': 'Your own reward' });
    const claim = (txt) => {
      if (!filled(txt)) return;
      G.claims.push({ id: uid(), kind, key: p.key, text: txt.trim(), at: Date.now() });
      save(); closeOverlay();
      toast(`Earned: ${txt.trim()}. Enjoy it, fully.`, '', null, 4000);
    };
    showOverlay(h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Claim reward' },
      h('h3', {}, `You put in ${fmtH(p.done)}. Pick your reward.`),
      menu.length ? h('div', { class: 'gmenu' }, menu.map((m) => btn(m, () => claim(m)))) : null,
      menu.length > 1 ? btn('Surprise me', () => claim(menu[Math.floor(Math.random() * menu.length)])) : null,
      h('div', { class: 'row' }, other, btn('Claim', () => claim(other.value), 'primary')),
      btn('Later', closeOverlay)), 'gsheet', null, true);
    onClose(render);
  }
  function claimBtn(kind, p) {
    if (p.claim) return h('span', { class: 'gsub' }, '★ ', p.claim.text);
    if (p.done >= p.target) return h('button', { class: 'primary sm', 'data-claim': kind, onclick: () => openClaim(kind, p) }, 'Claim reward');
    return h('span', { class: 'gsub' }, `${fmtH(p.target - p.done)} to go`);
  }
  function openRewards() {
    const c = cr(), t = today(), st = planner(), f = freeTime(G, c, st.blocks, { timer: st.timer }), jar = hoursJar(G, c), fun = catOf(G.funCat);
    const el = h('div', { class: 'pop sheet center gwide', role: 'dialog', 'aria-label': 'Rewards' },
      h('h3', {}, 'Rewards'),
      ...PERIODS.map(([k, label]) => { const p = progress(G, c, k, t); return h('div', { class: 'gprow', 'data-period': k }, h('span', { class: 'k' }, label), bar(p.done, p.target), h('b', {}, `${fmtH(p.done)} / ${fmtH(p.target)}`), claimBtn(k, p)); }),
      h('p', { class: 'gsub' }, 'Targets add up the weekly hours of your active goals. A deal week lowers them to a quarter.'),
      h('hr'),
      h('div', { class: 'gprow' }, h('span', { class: 'k' }, 'Free time'), h('b', {}, fmtH(f.balance)), h('span', { class: 'gsub' }, `${G.rewards.rate} min per goal hour${fun ? `, spent while you log ${fun.name}` : ''}`)),
      h('hr'),
      h('h4', { class: 'gh4' }, `Wishlist · ${fmtH(Math.max(0, jar.available))} in the jar`),
      ...G.wish.filter((w) => !w.bought).map((w) => {
        const have = Math.max(0, jar.available), need = w.hours * 60;
        return h('div', { class: 'gprow', 'data-wish': w.id }, h('span', { class: 'gwn' }, w.name), bar(Math.min(have, need), need), h('b', {}, `${fmtH(Math.min(have, need))} / ${w.hours}h`),
          have >= need ? h('button', { class: 'primary sm', onclick: () => { w.bought = today(); save(); closeOverlay(); toast(`${w.name}: earned with ${w.hours} hours of real work. Go get it.`, 'Undo', () => { delete w.bought; save(); render(); }, 6000); } }, 'Get it') : h('span'));
      }),
      G.wish.some((w) => w.bought) ? h('p', { class: 'gsub' }, `Earned so far: ${G.wish.filter((w) => w.bought).map((w) => w.name).join(' · ')}`) : null,
      h('div', { class: 'row' }, btn('Reward settings', openSettings), btn('Done', closeOverlay, 'primary')));
    showOverlay(el, 'gsheet', null, true);
    onClose(render);
  }
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
    const wishTa = h('textarea', { rows: '4', class: 'gta', 'aria-label': 'Wishlist', placeholder: 'Noise-cancelling headphones 30h' });
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
      save(); closeOverlay();
    };
    const mins = (m) => `${m}m`;
    showOverlay(h('div', { class: 'pop sheet center gedit', role: 'dialog', 'aria-label': 'Reward settings' },
      h('h3', {}, 'Reward settings'),
      row('rate', 'Earn per goal hour', 5, 0, 60, mins), row('dayCap', 'Count per day, max', 30, 60, 960),
      row('stepBonus', 'Step bonus', 15, 0, 120, mins), row('milestoneBonus', 'Milestone bonus', 15, 0, 240, mins),
      h('div', { class: 'fl' }, 'Free time counts down while you log', h('div', { class: 'chips' }, funChips)),
      h('hr'),
      h('label', { class: 'fl' }, 'Weekly rewards (one per line)', mw),
      h('label', { class: 'fl' }, 'Monthly rewards', mm),
      h('label', { class: 'fl' }, 'Quarterly rewards', mq),
      h('label', { class: 'fl' }, 'Wishlist, priced in goal hours', wishTa, h('span', { class: 'gsub' }, 'One per line: “Headphones 30h”.')),
      h('div', { class: 'row' }, btn('Cancel', closeOverlay), btn('Save', apply, 'primary'))), 'gsheet', null, true);
    onClose(render);
  }

  // ---- The tab: one summary line, then the active goals. ----
  function render() {
    const c = cr(), t = today(), wk = progress(G, c, 'week', t), st = planner(), f = freeTime(G, c, st.blocks, { timer: st.timer });
    const act = active(G), rest = G.goals.filter((g) => g.status !== 'active'), deal = isDeal();
    root.replaceChildren(...[
      h('div', { class: 'ghead' }, h('h2', {}, 'Goals'),
        h('button', { class: 'gdeal' + (deal ? ' on' : ''), 'aria-pressed': deal ? 'true' : 'false', onclick: () => {
          if (deal) delete G.weekMode[wk.key]; else G.weekMode[wk.key] = 'deal';
          save(); render(); toast(deal ? 'Back to normal weekly hours.' : 'Deal week: every goal’s hours drop to a quarter. Protect the rough-day version.', '', null, 3500);
        } }, deal ? '✓ Deal week' : 'Deal week')),
      h('div', { class: 'gsum', 'data-period': 'week' },
        h('div', { class: 'gsumw' }, h('span', { class: 'k' }, 'This week'), bar(wk.done, wk.target), h('b', {}, `${fmtH(wk.done)} / ${fmtH(wk.target)}`), claimBtn('week', wk)),
        h('div', { class: 'gsumf' }, h('span', { class: 'k' }, 'Free time'), h('b', { id: 'gFree' }, fmtH(f.balance))),
        btn('Rewards', openRewards, 'link gopen')),
      h('div', { class: 'ggrid' }, act.map((g) => goalCard(g, c))),
      act.length ? null : h('p', { class: 'dempty' }, 'No active goals. Start one, or make one active below.'),
      rest.length ? h('div', { class: 'gsome' },
        h('button', { class: 'link', 'aria-expanded': showInactive ? 'true' : 'false', onclick: () => { showInactive = !showInactive; render(); } }, `Inactive (${rest.length})`),
        showInactive ? rest.map((g) => h('div', { class: 'gsrow', 'data-goal': g.id, style: `--c:${colorOf(g)}` },
          h('span', { class: 'dot' }), h('b', {}, g.name || 'Untitled'),
          btn('Details', () => openGoal(g), 'link'), btn('Make active', () => setActive(g.id, true), 'link'))) : null) : null,
      h('div', { class: 'gfoot' }, btn('+ New goal', openNew)),
      h('p', { class: 'gsub gcenter' }, syncOn() ? 'Syncs with your other devices through your private repo.' : 'Stays on this device until you turn on sync (Export / Backup).')].filter(Boolean));
  }
  function setActive(id, on) {
    const g = byId(id);
    if (!g) return;
    g.status = on ? 'active' : 'inactive'; save(); render();
    toast(on ? `${g.name} is active.` : `${g.name} is inactive. Make it active again any time from Goals.`, 'Undo', () => { g.status = on ? 'inactive' : 'active'; save(); render(); }, 5000);
  }

  const busy = () => root.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  return {
    render, busy,
    get data() { return G; },
    replace(next) { G = next; persist(); },
    // For the rest of the app:
    bars: (day) => weekBars(G, cr(), day).map((b) => ({ ...b, color: colorOf(byId(b.id)) })),
    baseTarget: (id, day) => { const g = byId(id); return g ? targetOf(g, day) : 0; },
    setTarget: (id, min, day) => { const g = byId(id); if (!g) return; const p = phaseOf(g, day); if (p && Number.isFinite(p.target) && p.index != null) g.phases[p.index].target = min; else g.target = min; save(); },
    addTime: (id, min, day) => { const c = { id: uid(), goal: id, practice: 'manual', day, credit: min, at: Date.now() }; G.checks.push(c); save(); return c.id; },
    removeCheck: (cid) => { G.checks = G.checks.filter((c) => c.id !== cid); save(); },
    isDeal: (day) => G.weekMode[L.weekDays(day)[0]] === 'deal',
    setActive, open: (id) => { const g = byId(id); if (g) openGoal(g); },
    freeLeft: (live = true) => { const st = planner(); return freeTime(G, cr(), st.blocks, { timer: live ? st.timer : null }).balance; },
    funCat: () => G.funCat,
    shelf: () => shelf(G),
    active: () => active(G),
    goalOf: (b) => goalOf(b, G.goals),
    colorOf,
    hints: () => hints(G, cr(), today()),
  };
}
