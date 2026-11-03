// Goals — two kinds, one weekly loop.
//   Habit goals: hours per week (gym, ahnik).  Milestone goals: hours per week + milestones with tasks and rewards.
//   Loop: set up the week (hours, deal week, the reward) → do sessions (Planner bars) → a missed session gets
//   "did it / move / skip" right away → hit the week's hours, claim the reward → next week's setup shows how it went.
// Logged Actual time counts when the block is linked to a goal, or its title has one of the goal's words in the goal's categories.
// Its own storage key; syncs as goals.json in the private repo when sync is on.
import * as L from './logic.js';
import { pick3, mergeById } from './sync.js';

export const GKEY = 'dailyos.goals';
export const KINDS = ['habit', 'milestone'];
export const SKIPS = 2; // per goal per week
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const uid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const filled = (v) => typeof v === 'string' && !!v.trim();
const r15 = (m) => Math.round(m / 15) * 15;
export const weekOf = (day) => L.weekDays(day)[0];

// ---- Data ----
const goal0 = (o) => ({ name: '', kind: 'habit', status: 'active', hours: 180, cats: [], words: [], cue: '', rough: '', sessions: [], milestones: [], ...o });
const task = (id, text) => ({ id, text, done: false });
const ms = (id, text, date, reward, tasks = []) => ({ id, text, date, done: false, tasks, ...(reward ? { reward } : {}) });
// Two examples, one of each kind, with fixed ids so fresh devices agree after sync.
export function exampleGoals() {
  return [
    goal0({ id: 'ex-job', example: true, kind: 'milestone', name: 'Land a hedge fund role', hours: 360, cats: ['career'],
      words: ['pitch', 'model', 'coverage', 'earnings', 'headhunter', '10-k', 'thesis'],
      cue: 'Weeknights 9–10:30pm at my desk', rough: 'Read one earnings transcript. 15 minutes.',
      sessions: [{ name: 'Pitch work', min: 90 }, { name: 'Model a company', min: 60 }],
      milestones: [
        ms('ex-job-m1', 'Coverage list: 15 names', '2026-11-30', '', [task('ex-job-t1', 'Pick the sub-sector'), task('ex-job-t2', 'List 15 names with tickers')]),
        ms('ex-job-m2', 'First long pitch, stress-tested', '2027-01-15', 'Dinner somewhere good', [task('ex-job-t3', 'Choose the company'), task('ex-job-t4', 'Build the model'), task('ex-job-t5', 'Write the one-page pitch')]),
        ms('ex-job-m3', 'Offer', '2027-03-31', 'A real trip'),
      ] }),
    goal0({ id: 'ex-gym', example: true, kind: 'habit', name: 'Gym', hours: 240, cats: ['self'],
      words: ['gym', 'lift', 'strength', 'run', 'workout'],
      cue: 'Mon, Wed, Fri at 7am, before work', rough: '20-minute walk or a bodyweight circuit.',
      sessions: [{ name: 'Strength', min: 60 }, { name: 'Run', min: 45 }] }),
  ];
}
export const freshGoals = (start) => ({ v: 3, start, pristine: true, goals: exampleGoals(), adds: [], weeks: {}, menu: ['Dinner somewhere good', 'A new book', 'Movie night, no laptop'] });
// Anything older starts over with the examples (you asked to clear the old goals); the old copy is kept on the device.
export const migrateGoals = (d) => (d && typeof d === 'object' && d.v !== 3 && DAY_RE.test(d.start || '') ? freshGoals(d.start) : d);
export const newGoal = (kind) => goal0({ id: uid(), kind, hours: kind === 'milestone' ? 240 : 180 });

// ---- What counts ----
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const wordIn = (title, w) => new RegExp(`(^|[^a-z0-9])${esc(w.toLowerCase())}`).test(title);
// block.goal: an id links it, '' means "not a goal". Otherwise: an active goal with a matching word, in its categories.
export function goalOf(b, goals) {
  if (typeof b.goal === 'string') return b.goal && goals.some((g) => g.id === b.goal) ? b.goal : null;
  const t = String(b.title || '').toLowerCase();
  for (const g of goals) {
    if (g.status !== 'active' || (g.cats.length && !g.cats.includes(b.cat))) continue;
    if (g.words.some((w) => filled(w) && wordIn(t, w.trim()))) return g.id;
  }
  return null;
}
// Minutes per goal per day: Actual blocks + time added by hand.
export function credits(G, blocks) {
  const out = new Map(), ids = new Set(G.goals.map((g) => g.id));
  const add = (day, id, m) => { if (!(m > 0)) return; const d = out.get(day) || {}; d[id] = (d[id] || 0) + m; out.set(day, d); };
  for (const b of blocks) if (b.layer === 'actual') { const id = goalOf(b, G.goals); if (id) add(b.day, id, b.end - b.start); }
  for (const a of G.adds) if (ids.has(a.goal)) add(a.day, a.goal, a.min);
  return out;
}
export const doneIn = (cr, id, wk) => L.weekDays(wk).reduce((s, d) => s + ((cr.get(d) || {})[id] || 0), 0);

// ---- The week ----
export const active = (G) => G.goals.filter((g) => g.status === 'active');
export const weekRec = (G, wk) => G.weeks[wk] || {};
export const skipsOf = (G, wk, id) => (weekRec(G, wk).skips || []).filter((s) => s.goal === id);
// This week's hours for a goal: what you set in the week's setup, else its usual hours (a quarter in a deal week), minus skips.
export function targetFor(G, g, wk) {
  const w = weekRec(G, wk), set = w.hours && w.hours[g.id];
  const base = Number.isFinite(set) ? set : w.deal ? r15(g.hours / 4) : g.hours;
  return Math.max(0, base - skipsOf(G, wk, g.id).reduce((s, x) => s + x.min, 0));
}
export function week(G, cr, wk) {
  const goals = active(G).map((g) => ({ id: g.id, name: g.name, done: doneIn(cr, g.id, wk), target: targetFor(G, g, wk) }));
  const done = goals.reduce((s, g) => s + Math.min(g.done, g.target), 0), target = goals.reduce((s, g) => s + g.target, 0);
  const w = weekRec(G, wk);
  return { key: wk, goals, done, target, hit: target > 0 && done >= target, reward: w.reward || '', claimed: !!w.claimed, setup: !!w.setup, deal: !!w.deal };
}
// Next week's setup suggests hours you'll actually hit: a bit above last week when you fell short.
export function suggest(last) {
  if (!last.target || last.done >= last.target * 0.8) return null;
  return Math.max(30, Math.min(last.target - 30, Math.ceil((last.done * 1.25) / 30) * 30));
}

// ---- Missed sessions: planned goal blocks this week whose time has passed with little logged ----
export function missed(G, blocks, nowMs) {
  const today = L.dayKeyOf(nowMs), days = new Set(L.weekDays(today).filter((d) => d <= today)), wk = weekOf(today);
  const cr = credits(G, blocks), handled = new Set((weekRec(G, wk).skips || []).map((s) => s.block));
  const act = new Set(active(G).map((g) => g.id));
  return blocks.filter((b) => {
    if (b.layer !== 'plan' || !days.has(b.day) || handled.has(b.id) || L.minToMs(b.day, b.end) > nowMs) return false;
    const id = goalOf(b, G.goals);
    return id && act.has(id) && ((cr.get(b.day) || {})[id] || 0) < (b.end - b.start) / 2;
  }).map((b) => ({ block: b, goal: goalOf(b, G.goals) }));
}

// ---- Milestones ----
export const currentMs = (g) => g.milestones.find((m) => !m.done) || null;
export const nextTask = (m) => (m && m.tasks.find((t) => !t.done)) || null;

// ---- Parking lot shelf, journal hints, fire drill ----
export const shelf = (G) => active(G).flatMap((g) => g.sessions.map((s, i) => ({ id: `goal:${g.id}:${i}`, text: s.name, min: s.min, cat: g.cats[0], goal: g.id, goalName: g.name, shelf: true, at: 0 })));
export function hints(G, cr, day) {
  const by = cr.get(day) || {};
  return {
    steps: active(G).map((g) => ({ goal: g.name, text: (nextTask(currentMs(g)) || {}).text })).filter((x) => x.text),
    counted: active(G).filter((g) => by[g.id]).map((g) => ({ goal: g.name, min: by[g.id] })),
  };
}
export const roughDay = (G) => active(G).filter((g) => filled(g.rough)).map((g) => ({ goal: g.name, text: g.rough }));
export function parseLines(text, cats) {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const p = L.parseTask(l, cats); return { name: (p.text || l).slice(0, 60), min: p.timed ? Math.max(15, p.min) : 45 }; });
}

// ---- Validation and sync ----
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const validMs = (m) => isObj(m) && typeof m.id === 'string' && typeof m.text === 'string' && Array.isArray(m.tasks) && m.tasks.every((t) => isObj(t) && typeof t.id === 'string' && typeof t.text === 'string');
const validGoal = (g) => isObj(g) && typeof g.id === 'string' && !!g.id && typeof g.name === 'string' && KINDS.includes(g.kind) && ['active', 'inactive'].includes(g.status) &&
  Number.isFinite(g.hours) && ['cats', 'words', 'sessions', 'milestones'].every((k) => Array.isArray(g[k])) && g.milestones.every(validMs) &&
  g.sessions.every((s) => isObj(s) && typeof s.name === 'string' && Number.isFinite(s.min));
export function validGoals(d) {
  return isObj(d) && d.v === 3 && DAY_RE.test(d.start || '') && Array.isArray(d.goals) && d.goals.every(validGoal) && new Set(d.goals.map((g) => g.id)).size === d.goals.length &&
    Array.isArray(d.adds) && d.adds.every((a) => isObj(a) && typeof a.id === 'string' && typeof a.goal === 'string' && DAY_RE.test(a.day) && Number.isFinite(a.min)) &&
    isObj(d.weeks) && Object.entries(d.weeks).every(([k, w]) => DAY_RE.test(k) && isObj(w)) && Array.isArray(d.menu);
}
// Three-way merge: by id, then field by field (milestones and their tasks by id).
function mergeMap(B, Lo, R, deep) {
  const bm = new Map(B.map((x) => [x.id, x])), lm = new Map(Lo.map((x) => [x.id, x])), rm = new Map(R.map((x) => [x.id, x]));
  return mergeById(B, Lo, R).map((x) => {
    const l = lm.get(x.id), r = rm.get(x.id);
    if (!l || !r) return x;
    const b = bm.get(x.id) || {}, out = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
      if (deep[k]) out[k] = mergeMap(b[k] || [], l[k] || [], r[k] || [], deep[k]);
      else { const v = pick3(b[k], l[k], r[k]); if (v !== undefined) out[k] = v; }
    }
    return out;
  });
}
function mergeWeeks(B = {}, Lo = {}, R = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(B), ...Object.keys(Lo), ...Object.keys(R)])) {
    const b = B[k] || {}, l = Lo[k] || {}, r = R[k] || {}, w = {};
    if (!(k in Lo) && !(k in R)) continue;
    for (const f of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) { const v = pick3(b[f], l[f], r[f]); if (v !== undefined) w[f] = v; }
    out[k] = w;
  }
  return out;
}
export function mergeGoals3(base, local, remote) {
  base = base && migrateGoals(base); local = migrateGoals(local); remote = remote && migrateGoals(remote);
  if (!remote) return local;
  if (!base && local.pristine) return remote; // a device with only the examples takes the synced copy
  const B = base || { goals: [], adds: [], weeks: {} };
  return { v: 3, start: [local.start, remote.start].filter((s) => DAY_RE.test(s || '')).sort()[0] || local.start,
    goals: mergeMap(B.goals, local.goals, remote.goals, { milestones: { tasks: {} } }),
    adds: mergeById(B.adds, local.adds, remote.adds),
    weeks: mergeWeeks(B.weeks, local.weeks, remote.weeks),
    menu: pick3(B.menu, local.menu, remote.menu) || local.menu };
}

// ---- UI ----
export function createGoals(ctx) {
  const { h, toast, showOverlay, closeOverlay, onClose = () => {}, openLot, planner, fmtH, onChange = () => {}, syncOn = () => false } = ctx;
  const root = document.getElementById('goals');
  const today = () => L.dayKeyOf(Date.now());
  let G = load(), saveT = 0, showInactive = false;
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(GKEY));
      if (raw && raw.v !== 3) localStorage.setItem(`${GKEY}.v${raw.v}`, JSON.stringify(raw)); // keep the old goals, just in case
      const d = migrateGoals(raw);
      if (validGoals(d)) return d;
      if (raw) localStorage.setItem(`${GKEY}.bad-${Date.now()}`, JSON.stringify(raw));
    } catch {}
    return freshGoals(today());
  }
  const persist = () => { try { localStorage.setItem(GKEY, JSON.stringify(G)); return true; } catch { toast('Couldn’t save just now.'); return false; } };
  const save = () => { clearTimeout(saveT); delete G.pristine; if (persist()) onChange(); };
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 400); };
  const cats = () => planner().cats;
  const catOf = (id) => cats().find((c) => c.id === id);
  const colorOf = (g) => { const c = g && catOf(g.cats[0]); return c ? c.color : 'var(--muted)'; };
  const cr = () => credits(G, planner().blocks);
  const byId = (id) => G.goals.find((g) => g.id === id);
  const wkRec = (wk) => (G.weeks[wk] ||= {});
  const fmtD = (key) => { const [y, m, d] = L.parseKey(key); return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const bar = (done, target, color) => h('div', { class: 'gbar' }, h('i', { style: `width:${Math.min(100, target ? (done / target) * 100 : 0)}%;${color ? `background:${color}` : ''}` }));
  const btn = (label, onclick, cls = '') => h('button', { class: cls, onclick }, label);
  const tick = (label, fn) => h('button', { class: 'gtick', 'aria-label': label, onclick: fn });
  const touched = (g) => { delete g.example; };

  // ---- Week setup: how last week went, this week's hours, deal week, the reward ----
  function openWeek(wk = weekOf(today())) {
    const c = cr(), prev = L.addDays(wk, -7), last = prev >= weekOf(G.start) ? week(G, c, prev) : { goals: [], target: 0 }, rec = wkRec(wk);
    const hours = { ...(rec.hours || {}) };
    let deal = !!rec.deal, reward = rec.reward || '';
    const rows = h('div', { class: 'glist' });
    const base = (g) => (Number.isFinite(hours[g.id]) ? hours[g.id] : deal ? r15(g.hours / 4) : g.hours);
    const draw = () => rows.replaceChildren(...active(G).map((g) => {
      const l = last.goals.find((x) => x.id === g.id), s = l && suggest(l), v = h('span', { class: 'val' }, fmtH(base(g)));
      const set = (m) => { hours[g.id] = Math.max(0, Math.min(2400, m)); draw(); };
      return h('div', { class: 'gwrow', 'data-goal': g.id, style: `--c:${colorOf(g)}` },
        h('div', { class: 'gwn' }, h('span', { class: 'dot' }), h('b', {}, g.name), l && l.target ? h('span', { class: 'gsub' }, ` last week ${fmtH(l.done)} / ${fmtH(l.target)}`) : null),
        h('div', { class: 'step' }, h('button', { 'aria-label': `${g.name} less`, onclick: () => set(base(g) - 30) }, '−'), v, h('button', { 'aria-label': `${g.name} more`, onclick: () => set(base(g) + 30) }, '+')),
        s && s !== base(g) ? h('button', { class: 'link gsug', onclick: () => set(s) }, `Try ${fmtH(s)}: a target you’ll hit builds the habit faster`) : null);
    }));
    draw();
    const dealBtn = h('button', { class: 'gdeal' + (deal ? ' on' : ''), 'aria-pressed': deal ? 'true' : 'false', onclick: () => {
      deal = !deal; dealBtn.classList.toggle('on', deal); dealBtn.setAttribute('aria-pressed', deal ? 'true' : 'false'); dealBtn.textContent = deal ? '✓ Deal week' : 'Deal week';
      for (const k of Object.keys(hours)) delete hours[k];
      draw();
    } }, deal ? '✓ Deal week' : 'Deal week');
    const own = h('input', { type: 'text', value: G.menu.includes(reward) ? '' : reward, maxlength: '80', autocomplete: 'off', placeholder: 'Or your own', 'aria-label': 'Your own reward' });
    const chips = h('div', { class: 'chips' });
    const drawChips = () => chips.replaceChildren(...G.menu.map((m) => h('button', { class: 'chip' + (reward === m ? ' sel' : ''), onclick: () => { reward = m; own.value = ''; drawChips(); } }, m)));
    drawChips();
    own.addEventListener('input', () => { reward = own.value.trim(); drawChips(); });
    const lastLine = last.target ? `Last week: ${fmtH(last.done)} of ${fmtH(last.target)}${last.hit ? (last.claimed ? ` · earned ${last.reward}` : ' · hit it') : ''}.` : 'First week. Start small; you can raise it next Sunday.';
    showOverlay(h('div', { class: 'pop sheet center gwide', role: 'dialog', 'aria-label': 'Set up your week' },
      h('h3', {}, `Week of ${fmtD(wk)}`), h('p', { class: 'muted' }, lastLine),
      h('div', { class: 'gsec' }, h('h4', {}, 'Hours this week'), dealBtn, rows),
      h('div', { class: 'gsec' }, h('h4', {}, 'Hit them and you get'), chips, own),
      h('div', { class: 'row' }, btn('Cancel', closeOverlay), btn('Start the week', () => {
        Object.assign(rec, { setup: true, deal, reward, hours });
        if (filled(reward) && !G.menu.includes(reward)) G.menu = [...G.menu, reward].slice(-8);
        save(); closeOverlay();
        toast('Week set. Drag sessions from the Parking lot onto your days.', 'Plan now', openLot, 5000);
      }, 'primary'))), 'gsheet', null, true);
    onClose(render);
  }
  function claim(wk = weekOf(today())) {
    const rec = wkRec(wk);
    rec.claimed = Date.now(); save(); render();
    toast(rec.reward ? `You earned it: ${rec.reward}. Enjoy it fully.` : 'Week done. Treat yourself.', 'Undo', () => { delete rec.claimed; save(); render(); }, 6000);
  }

  // ---- Cards ----
  function card(g, c, wk) {
    const done = doneIn(c, g.id, wk), tgt = targetFor(G, g, wk), m = g.kind === 'milestone' ? currentMs(g) : null, t = nextTask(m);
    const kids = [
      h('header', {}, h('button', { class: 'gname', onclick: () => openGoal(g) }, g.name || 'Untitled'), g.example ? h('span', { class: 'gchip' }, 'Example') : null,
        g.kind === 'milestone' && g.milestones.length ? h('span', { class: 'gchip' }, `${g.milestones.filter((x) => x.done).length} of ${g.milestones.length}`) : null),
      h('div', { class: 'gweek' }, bar(done, tgt, colorOf(g)), h('b', {}, `${fmtH(done)} / ${fmtH(tgt)}`)),
    ];
    if (g.kind === 'habit') kids.push(g.cue ? h('p', { class: 'gcue' }, h('span', { class: 'k' }, 'When '), g.cue) : h('button', { class: 'link gmore', onclick: () => openGoal(g, 'cue') }, '+ When and where?'));
    else if (m) {
      const inp = h('input', { type: 'text', placeholder: 'Next task…', maxlength: '160', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': `Next task for ${m.text}` });
      const add = () => { const v = inp.value.trim(); if (!v) return inp.focus(); m.tasks.push({ id: uid(), text: v, done: false }); touched(g); save(); render(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      kids.push(h('div', { class: 'gms' },
        h('div', { class: 'gmsh' }, h('span', {}, h('span', { class: 'k' }, 'Milestone '), m.text, m.date ? ` · ${fmtD(m.date)}` : '', m.reward ? h('span', { class: 'grw' }, ` → ${m.reward}`) : null),
          btn('Done', () => finishMs(g, m), 'sm')),
        t ? h('div', { class: 'gnext' }, tick(`Done: ${t.text}`, () => finishTask(g, m, t)), h('p', {}, t.text))
          : h('div', { class: 'gnext empty' }, inp, btn('Add', add, 'sm'))));
    } else kids.push(h('button', { class: 'link gmore', onclick: () => openGoal(g, 'ms') }, '+ Add a milestone'));
    kids.push(h('button', { class: 'link gmore', onclick: () => openGoal(g) }, 'Details'));
    return h('article', { class: 'gcard', style: `--c:${colorOf(g)}`, 'data-goal': g.id }, ...kids);
  }
  function finishTask(g, m, t) {
    t.done = true; t.doneAt = Date.now(); touched(g); save(); render();
    toast(nextTask(m) ? 'Done. Next one’s up.' : `Last task for “${m.text}”. Mark the milestone done when it is.`, 'Undo', () => { t.done = false; delete t.doneAt; save(); render(); }, 5000);
    if (!nextTask(m)) setTimeout(() => { const i = root.querySelector(`[data-goal="${CSS.escape(g.id)}"] .gnext input`); if (i) i.focus(); }, 50);
  }
  function finishMs(g, m) {
    m.done = true; m.doneAt = Date.now(); touched(g); save(); render();
    toast(m.reward ? `${m.text}. You earned: ${m.reward}.` : `Milestone done: ${m.text}.`, 'Undo', () => { m.done = false; delete m.doneAt; save(); render(); }, 6000);
  }

  // ---- Details: everything about one goal, edited in place ----
  function openGoal(g, focus = '') {
    const el = h('div', { class: 'pop sheet center gwide', role: 'dialog', 'aria-label': 'Goal details' });
    const edit = () => { touched(g); saveSoon(); };
    const live = (input, set, ev = 'input') => { input.addEventListener(ev, () => { set(input.value); edit(); }); return input; };
    const text = (v, label, ph = '', max = 120) => h('input', { type: 'text', value: v || '', maxlength: String(max), autocomplete: 'off', 'aria-label': label, placeholder: ph });
    const sec = (title, ...kids) => h('section', { class: 'gsec' }, h('h4', {}, title), ...kids);
    const rm = (label, fn) => h('button', { class: 'sm gx', 'aria-label': label, onclick: fn }, '✕');
    const lab = (t, input, hint) => h('label', { class: 'fl' }, t, input, hint ? h('span', { class: 'gsub' }, hint) : null);
    const name = live(text(g.name, 'Goal name', 'Name it', 60), (v) => { g.name = v.trim(); });
    const status = h('div', { class: 'seg' }, [['active', 'Active'], ['inactive', 'Inactive']].map(([s, l]) => h('button', { class: g.status === s ? 'sel' : '', 'data-status': s, onclick: () => {
      g.status = s; save(); for (const b of status.children) b.classList.toggle('sel', b.dataset.status === s);
    } }, l)));
    const hv = h('span', { class: 'val' }, `${fmtH(g.hours)} a week`);
    const stepH = (d) => { g.hours = Math.max(15, Math.min(2400, g.hours + d)); hv.textContent = `${fmtH(g.hours)} a week`; touched(g); save(); };
    const cue = live(text(g.cue, 'When and where', 'Mon, Wed, Fri at 7am, before work'), (v) => { g.cue = v.trim(); });
    const rough = live(text(g.rough, 'Rough-day version', 'The 15-minute version'), (v) => { g.rough = v.trim(); });

    // Milestones, each with its tasks and an optional reward
    const mss = h('div', { class: 'glist' });
    const drawMs = () => {
      const addM = text('', 'New milestone', 'Add a milestone');
      addM.addEventListener('keydown', (e) => { if (e.key === 'Enter' && addM.value.trim()) { g.milestones.push({ id: uid(), text: addM.value.trim(), date: '', done: false, tasks: [] }); touched(g); save(); drawMs(); mss.querySelector('input[aria-label="New milestone"]').focus(); } });
      mss.replaceChildren(...g.milestones.map((m) => {
        const box = h('input', { type: 'checkbox', checked: !!m.done, 'aria-label': `Done: ${m.text}` });
        box.addEventListener('change', () => { m.done = box.checked; if (m.done) m.doneAt = Date.now(); else delete m.doneAt; touched(g); save(); });
        const date = h('input', { type: 'date', value: m.date || '', 'aria-label': `Date for ${m.text}` });
        date.addEventListener('change', () => { m.date = DAY_RE.test(date.value) ? date.value : ''; edit(); });
        const addT = text('', `New task for ${m.text}`, '+ Task');
        addT.addEventListener('keydown', (e) => { if (e.key === 'Enter' && addT.value.trim()) { m.tasks.push({ id: uid(), text: addT.value.trim(), done: false }); touched(g); save(); drawMs(); mss.querySelector(`[data-ms="${CSS.escape(m.id)}"] .gaddt`).focus(); } });
        addT.classList.add('gaddt');
        return h('div', { class: 'gmrow' + (m.done ? ' done' : ''), 'data-ms': m.id },
          h('div', { class: 'grow' }, box, live(text(m.text, 'Milestone'), (v) => { if (v.trim()) m.text = v.trim(); }), rm(`Remove milestone ${m.text}`, () => { g.milestones = g.milestones.filter((x) => x !== m); touched(g); save(); drawMs(); })),
          h('div', { class: 'grow sub' }, date, live(text(m.reward, `Reward for ${m.text}`, 'Reward (optional)', 80), (v) => { if (v.trim()) m.reward = v.trim(); else delete m.reward; })),
          h('div', { class: 'gtasks' }, ...m.tasks.map((t) => {
            const tb = h('input', { type: 'checkbox', checked: !!t.done, 'aria-label': `Done: ${t.text}` });
            tb.addEventListener('change', () => { t.done = tb.checked; if (t.done) t.doneAt = Date.now(); else delete t.doneAt; touched(g); save(); });
            return h('div', { class: 'grow', 'data-task': t.id }, tb, live(text(t.text, 'Task', '', 160), (v) => { if (v.trim()) t.text = v.trim(); }), rm(`Remove task ${t.text}`, () => { m.tasks = m.tasks.filter((x) => x !== t); touched(g); save(); drawMs(); }));
          }), addT));
      }), addM);
    };
    if (g.kind === 'milestone') drawMs();
    const sessions = live(h('textarea', { rows: '2', class: 'gta', 'aria-label': 'Sessions', placeholder: 'Strength 60m' }), (v) => { g.sessions = parseLines(v, cats()).slice(0, 6); }, 'change');
    sessions.value = g.sessions.map((s) => `${s.name} ${fmtH(s.min)}`).join('\n');
    const picked = new Set(g.cats);
    const chips = cats().map((c) => h('button', { class: 'chip' + (picked.has(c.id) ? ' sel' : ''), style: `--c:${c.color}`, 'data-cat': c.id, onclick: (e) => {
      picked.has(c.id) ? picked.delete(c.id) : picked.add(c.id); e.currentTarget.classList.toggle('sel', picked.has(c.id));
      g.cats = cats().filter((x) => picked.has(x.id)).map((x) => x.id); touched(g); save();
    } }, h('span', { class: 'dot' }), c.name));
    const words = live(text(g.words.join(', '), 'Words', 'gym, lift, run', 400), (v) => { g.words = v.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean).slice(0, 30); });
    el.append(
      h('div', { class: 'gsheethead' }, name, status),
      sec('Hours a week', h('div', { class: 'step' }, h('button', { 'aria-label': 'Fewer hours', onclick: () => stepH(-30) }, '−'), hv, h('button', { 'aria-label': 'More hours', onclick: () => stepH(30) }, '+'))),
      g.kind === 'milestone' ? sec('Milestones', mss) : null,
      sec('Plan', lab('When and where', cue, 'A fixed cue (“after X, I…”) makes it automatic.'), lab('Rough-day version', rough, 'Shown on Fire drill, so a bad day still counts.')),
      h('details', { class: 'gmorebox' }, h('summary', {}, 'Sessions and what counts'),
        lab('Sessions in your Parking lot', sessions, 'One per line, with a length.'),
        h('div', { class: 'fl' }, 'Counts time logged in', h('div', { class: 'chips' }, chips)),
        lab('…with any of these words in the title', words, 'Comma separated. Or link a block from its popover.')),
      h('div', { class: 'row' },
        btn('Delete', () => {
          const i = G.goals.indexOf(g);
          G.goals = G.goals.filter((x) => x !== g); save(); closeOverlay();
          toast(`Deleted ${g.name || 'goal'}. Logged time stays in your planner.`, 'Undo', () => { G.goals.splice(i, 0, g); save(); render(); }, 6000);
        }, 'danger'),
        btn('Done', closeOverlay, 'primary')));
    showOverlay(el, 'gsheet', null, true);
    onClose(() => { clearTimeout(saveT); if (!g.name.trim() && G.goals.includes(g)) g.name = g.kind === 'milestone' ? 'New goal' : 'New habit'; save(); render(); });
    setTimeout(() => { const f = focus === 'cue' ? cue : focus === 'ms' ? mss.querySelector('input[aria-label="New milestone"]') : !g.name ? name : null; if (f) f.focus(); }, 50);
  }
  function openNew() {
    const make = (kind) => { const g = newGoal(kind); G.goals.push(g); save(); openGoal(g); };
    showOverlay(h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'New goal' },
      h('h3', {}, 'What kind?'),
      h('button', { class: 'gtpl', 'data-kind': 'habit', onclick: () => make('habit') }, h('b', {}, 'Habit'), h('span', {}, 'Hours each week. Gym, ahnik, reading.')),
      h('button', { class: 'gtpl', 'data-kind': 'milestone', onclick: () => make('milestone') }, h('b', {}, 'Milestone goal'), h('span', {}, 'An outcome: milestones with tasks and rewards, plus hours each week.')),
      btn('Cancel', closeOverlay)), 'gsheet', null, true);
  }

  // ---- The tab ----
  function weekLine(w) {
    if (!w.setup) return btn('Set up your week', () => openWeek(w.key), 'primary sm');
    if (w.claimed) return h('span', { class: 'gsub' }, `★ ${w.reward || 'Earned'}`);
    if (w.hit) return h('button', { class: 'primary sm', 'data-claim': '1', onclick: () => claim(w.key) }, `Claim: ${w.reward || 'your reward'}`);
    return h('span', { class: 'gsub' }, w.reward ? `${fmtH(w.target - w.done)} to ${w.reward}` : `${fmtH(w.target - w.done)} to go`);
  }
  function render() {
    const c = cr(), wk = weekOf(today()), w = week(G, c, wk), act = active(G), rest = G.goals.filter((g) => g.status !== 'active');
    root.replaceChildren(...[
      h('div', { class: 'ghead' }, h('h2', {}, 'Goals'), w.setup ? btn('Edit week', () => openWeek(wk), 'link') : null),
      h('div', { class: 'gsum' }, h('span', { class: 'k' }, w.deal ? 'Deal week' : 'This week'), bar(w.done, w.target), h('b', {}, `${fmtH(w.done)} / ${fmtH(w.target)}`), weekLine(w)),
      h('div', { class: 'ggrid' }, act.map((g) => card(g, c, wk))),
      act.length ? null : h('p', { class: 'dempty' }, 'No active goals. Add one, or make one active below.'),
      rest.length ? h('div', { class: 'gsome' },
        h('button', { class: 'link', onclick: () => { showInactive = !showInactive; render(); } }, `Inactive (${rest.length})`),
        ...(showInactive ? rest.map((g) => h('div', { class: 'gsrow', 'data-goal': g.id, style: `--c:${colorOf(g)}` }, h('span', { class: 'dot' }), h('b', {}, g.name || 'Untitled'),
          btn('Make active', () => setActive(g.id, true), 'link'))) : [])) : null,
      h('div', { class: 'gfoot' }, btn('+ Add goal', openNew)),
      h('p', { class: 'gsub gcenter' }, syncOn() ? 'Syncs with your other devices through your private repo.' : 'Stays on this device until you turn on sync (Export / Backup).')].filter(Boolean));
  }
  function setActive(id, on) {
    const g = byId(id);
    if (!g) return;
    g.status = on ? 'active' : 'inactive'; save(); render();
    toast(on ? `${g.name} is active.` : `${g.name} is inactive. Bring it back any time from Goals.`, 'Undo', () => { g.status = on ? 'inactive' : 'active'; save(); render(); }, 5000);
  }

  const busy = () => root.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  return {
    render, busy, openWeek, claim, setActive,
    get data() { return G; },
    replace(next) { G = next; persist(); },
    week: (day) => week(G, cr(), weekOf(day)),
    bars: (day) => week(G, cr(), weekOf(day)).goals.map((b) => ({ ...b, color: colorOf(byId(b.id)) })),
    hoursOf: (id) => (byId(id) || {}).hours || 0,
    setHours: (id, min) => { const g = byId(id); if (!g) return; g.hours = min; const w = G.weeks[weekOf(today())]; if (w && w.hours) delete w.hours[id]; touched(g); save(); },
    addTime: (id, min, day) => { const a = { id: uid(), goal: id, day, min, at: Date.now() }; G.adds.push(a); save(); return a.id; },
    removeAdd: (aid) => { G.adds = G.adds.filter((a) => a.id !== aid); save(); },
    missed: (nowMs = Date.now()) => missed(G, planner().blocks, nowMs),
    skipsLeft: (id, day) => SKIPS - skipsOf(G, weekOf(day), id).filter((s) => s.min > 0).length,
    skip: (b, id, letGo) => { const w = wkRec(weekOf(b.day)); (w.skips ||= []).push({ block: b.id, goal: id, min: letGo ? 0 : b.end - b.start }); save(); },
    unskip: (bid, day) => { const w = wkRec(weekOf(day)); w.skips = (w.skips || []).filter((s) => s.block !== bid); save(); },
    open: (id) => { const g = byId(id); if (g) openGoal(g); },
    shelf: () => shelf(G),
    active: () => active(G),
    goalOf: (b) => goalOf(b, G.goals),
    colorOf: (g) => colorOf(g),
    nameOf: (id) => (byId(id) || {}).name || '',
    hints: () => hints(G, cr(), today()),
    rough: () => roughDay(G),
  };
}
