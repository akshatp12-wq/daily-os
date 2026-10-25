import * as L from './logic.js';
import { weekBars, spark } from './charts.js';
import * as S from './sync.js';

const SLOT_PX = 28, KEY = 'dailyos', HOLD = 250;
const $ = (s) => document.querySelector(s);
const main = $('#main'), scroller = $('#scroller'), grid = $('#grid'), gutter = $('#gutter'), nowEl = $('#now'), scrim = $('#scrim');
const lotEl = $('#lot'), lotList = $('#lotList'), lotIn = $('#lotIn'), lotHint = $('#lotHint'), dash = $('#dash'), tipEl = $('#tip');
const cols = { plan: grid.querySelector('.col.plan'), actual: grid.querySelector('.col.actual') };
const wide = matchMedia('(min-width:700px)');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
document.documentElement.style.setProperty('--slot', SLOT_PX + 'px');

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false && c !== '') el.append(c.nodeType ? c : String(c));
  return el;
}

// ---- State ----
const fresh = () => ({ v: 2, cats: L.DEFAULT_CATS.map((c) => ({ ...c })), blocks: [], timer: null, lastCat: 'work', lot: [], gapSkip: [] });
let state = load(), saveWarned = false;
function load() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { return fresh(); }
  if (!raw) return fresh();
  let d = null, ver;
  try { const p = JSON.parse(raw); ver = p && p.v; d = L.migrate(p); } catch {}
  if (d && L.validateData(d)) {
    // Keep the untouched v1 original once, before anything is written in the new format.
    if (ver === 1) try { if (localStorage.getItem(KEY + '.pre-v2') == null) localStorage.setItem(KEY + '.pre-v2', raw); } catch {}
    const keep = L.addDays(L.dayKeyOf(Date.now()), -14);
    return { ...fresh(), ...d, gapSkip: d.gapSkip.filter((s) => s.slice(0, 10) >= keep) };
  }
  // Never silently replace data: keep an untouchable copy, then start fresh.
  try { localStorage.setItem(`${KEY}.bad-${Date.now()}`, raw); } catch {}
  setTimeout(() => toast('Couldn’t read saved data — a copy was kept', '', null, 5000), 600);
  return fresh();
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); saveWarned = false; }
  catch { if (!saveWarned) { saveWarned = true; toast('Could not save: storage unavailable'); } }
}
function save() { persist(); if (syncer) syncer.touch(); }
// v2 set aside data that used the old category names; bring it back once.
function recoverStash() {
  try {
    const raw = localStorage.getItem(KEY + '.bad');
    if (!raw) return;
    const d = L.migrate(JSON.parse(raw));
    if (!L.validateData(d)) return;
    const ids = new Set(state.cats.map((c) => c.id));
    const r = L.mergeBlocks(state.blocks, d.blocks.filter((b) => ids.has(b.cat)));
    state.blocks.push(...r.added);
    localStorage.setItem(KEY + '.v1', raw);
    localStorage.removeItem(KEY + '.bad');
    save();
    if (r.added.length) setTimeout(() => toast(`Recovered ${r.added.length} block${r.added.length === 1 ? '' : 's'} from before the category update`, '', null, 4000), 500);
  } catch {}
}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch {}

const catOf = (id) => L.catById(state.cats, id);
const hasCat = (id) => state.cats.some((c) => c.id === id);
const pickCat = () => (hasCat(state.lastCat) ? state.lastCat : state.cats[0].id);

// ---- Formatting ----
const pad = L.pad;
const fmtT = (key, min) => new Date(L.minToMs(key, min)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtH = (m) => { m = Math.round(m); const hh = Math.floor(m / 60), mm = m % 60; return hh ? (mm ? `${hh}h ${mm}m` : `${hh}h`) : `${mm}m`; };
const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return hh ? `${hh}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`; };
const dateOf = (key) => { const [y, m, d] = L.parseKey(key); return new Date(y, m - 1, d); };
const fmtDay = (key) => dateOf(key).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const fmtShort = (key) => dateOf(key).toLocaleDateString([], { month: 'short', day: 'numeric' });
const fmtWd = (key) => `${dateOf(key).toLocaleDateString([], { weekday: 'short' })} ${dateOf(key).getDate()}`;
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const mins = (day, layer, cat) => L.minutesOf(state.blocks, day, layer, cat);
const yOf = (key, ms) => (L.offsetOf(key, ms) / L.STEP) * SLOT_PX;
const today = () => L.dayKeyOf(Date.now());

// ---- Toast ----
const toastEl = $('#toast');
let toastT = 0;
function toast(msg, label, fn, ms = 2500) {
  if (!msg) return;
  toastEl.querySelector('span').textContent = msg;
  const btn = toastEl.querySelector('button');
  btn.textContent = label || '';
  btn.onclick = () => { toastEl.classList.remove('show'); fn && fn(); };
  toastEl.classList.toggle('act', !!fn);
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), ms);
}

// ---- View state ----
let view = today(), mode = 'plan', range = 'week', lotOpen = false;
const monthOf = (key) => L.parseKey(key).slice(0, 2);
const shiftMonth = ([y, m], n) => { const d = new Date(y, m - 1 + n, 1); return [d.getFullYear(), d.getMonth() + 1]; };
let monthCur = monthOf(view);

// ---- Render ----
function render() {
  renderRail();
  renderBar();
  if (mode === 'plan') { renderGrid(); if (lotOpen && !lotDrag) renderLot(); }
  else renderDash();
  tick();
}

function renderRail() {
  $('#dayLabel').replaceChildren(fmtDay(view), view === today() ? h('small', {}, 'Today') : '');
  const planned = mins(view, 'plan'), cap = planned / L.WAKE_MIN, act = mins(view, 'actual');
  $('#capFill').style.width = Math.min(100, cap * 100) + '%';
  $('#cap').className = 'cap' + (cap > 1 ? ' over' : cap > 0.85 ? ' warn' : '');
  $('#capText').textContent = `${fmtH(planned)} planned · ${Math.round(cap * 100)}% of 16h`;
  $('#planTot').textContent = planned ? fmtH(planned) : '';
  $('#actTot').textContent = act ? fmtH(act) : '';
  $('#fireBtn').classList.toggle('off', fireCutoff() == null);
  renderTimers();
  renderMonth();
}

function renderTimers() {
  $('#timers').replaceChildren(
    h('div', { class: 'thead' }, 'Timers', h('button', { class: 'link', onclick: openCats }, 'Edit')),
    ...state.cats.map((c) => {
      const on = !!state.timer && state.timer.cat === c.id;
      return h('button', { class: 'tbtn' + (on ? ' on' : ''), style: `--c:${c.color}`, 'data-cat': c.id, 'aria-pressed': on ? 'true' : 'false', onclick: () => toggleTimer(c.id) },
        h('span', { class: 'tn' }, h('span', { class: 'dot' }), c.name),
        h('span', { class: 'ts' }, on ? '● ' + fmtDur(Date.now() - state.timer.startedAt) : `${fmtH(mins(view, 'actual', c.id))} / ${fmtH(mins(view, 'plan', c.id))} plan`));
    }),
    h('button', { class: 'tedit', onclick: openCats }, 'Edit'));
}

function renderBar() {
  for (const t of document.querySelectorAll('#bar .tab')) {
    const on = t.dataset.mode === mode;
    t.classList.toggle('sel', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  const total = L.findGaps(state.blocks, view, Date.now(), state.timer, state.gapSkip).reduce((s, [a, b]) => s + b - a, 0);
  const chip = $('#gapChip');
  chip.hidden = !total;
  chip.textContent = `${fmtH(total)} untracked`;
  $('#lotCount').textContent = state.lot.length ? String(state.lot.length) : '';
  $('#lotBtn').setAttribute('aria-pressed', lotOpen ? 'true' : 'false');
}

function renderGrid() {
  const n = L.slotCount(view);
  grid.style.height = n * SLOT_PX + 'px';
  const labels = [];
  for (let i = 0; i < n; i += 4) labels.push(h('div', { style: `top:${i === 0 ? 8 : i * SLOT_PX}px` }, new Date(L.minToMs(view, i * L.STEP)).toLocaleTimeString([], { hour: 'numeric' })));
  gutter.replaceChildren(...labels);
  for (const layer of ['plan', 'actual']) cols[layer].replaceChildren(...state.blocks.filter((b) => b.day === view && b.layer === layer).map(blockEl));
  const t = state.timer;
  if (t && L.dayKeyOf(t.startedAt) === view) {
    const c = catOf(t.cat);
    cols.actual.append(h('div', { class: 'run', id: 'run', style: `--c:${c.color};top:${yOf(view, t.startedAt)}px` }, `${c.name} · running`));
  }
}

const place = (el, s, e) => { el.style.top = (s / L.STEP) * SLOT_PX + 1 + 'px'; el.style.height = ((e - s) / L.STEP) * SLOT_PX - 2 + 'px'; };
function blockEl(b) {
  const c = catOf(b.cat), short = b.end - b.start <= L.STEP;
  const el = h('div', { class: `blk ${b.layer}${short ? ' short' : ''}${overlay && overlay.bid === b.id ? ' sel' : ''}`, 'data-id': b.id, style: `--c:${c.color}` },
    h('div', { class: 'bt' }, b.title || c.name),
    h('div', { class: 'bm' }, `${fmtT(b.day, b.start)} – ${fmtT(b.day, b.end)} · ${fmtH(b.end - b.start)}`),
    h('div', { class: 'rh' }));
  place(el, b.start, b.end);
  el.addEventListener('pointerdown', (e) => onBlockDown(e, b, el));
  return el;
}

let lastMinute = 0;
function tick() {
  const now = Date.now();
  if (L.dayKeyOf(now) === view) { nowEl.style.display = 'block'; nowEl.style.top = yOf(view, now) + 'px'; }
  else nowEl.style.display = 'none';
  const minute = Math.floor(now / 60000);
  if (minute !== lastMinute) { lastMinute = minute; renderBar(); $('#fireBtn').classList.toggle('off', fireCutoff() == null); }
  const t = state.timer;
  if (!t) return;
  const ts = document.querySelector(`#timers [data-cat="${CSS.escape(t.cat)}"] .ts`);
  if (ts) ts.textContent = '● ' + fmtDur(now - t.startedAt);
  const run = document.getElementById('run');
  if (run) run.style.height = Math.max(6, yOf(view, Math.min(now, L.dayEnd(view))) - yOf(view, t.startedAt)) + 'px';
}
setInterval(tick, 1000);

function scrollToDefault() {
  const now = Date.now();
  const y = L.dayKeyOf(now) === view ? yOf(view, now) - scroller.clientHeight / 3 : 8 * SLOT_PX - 8;
  scroller.scrollTop = Math.max(0, y);
}

// ---- Month calendar ----
const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function monthEl([y, m], onNav, onPick) {
  const t = today(), has = new Set(state.blocks.map((b) => b.day));
  return h('div', { class: 'month' },
    h('div', { class: 'mhead' },
      h('button', { 'aria-label': 'Previous month', onclick: () => onNav(-1) }, '‹'),
      h('b', {}, new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })),
      h('button', { 'aria-label': 'Next month', onclick: () => onNav(1) }, '›')),
    h('div', { class: 'mgrid' },
      WD.map((d) => h('div', { class: 'mwd', 'aria-hidden': 'true' }, d)),
      L.monthGrid(y, m).map((c) => h('button', {
        class: `mday${c.inMonth ? '' : ' out'}${c.key === t ? ' today' : ''}${c.key === view ? ' sel' : ''}${has.has(c.key) ? ' has' : ''}`,
        'data-key': c.key, 'aria-label': fmtDay(c.key), 'aria-current': c.key === view ? 'date' : null,
        onclick: () => onPick(c.key),
      }, String(c.day)))));
}
function renderMonth() {
  $('#month').replaceChildren(monthEl(monthCur, (n) => { monthCur = shiftMonth(monthCur, n); renderMonth(); }, (k) => goto(k)));
}
// Phone: the rail is hidden, so tapping the date opens the month as a sheet.
function openMonthSheet() {
  let cur = monthOf(view);
  const el = h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Pick a day' });
  const draw = () => el.replaceChildren(monthEl(cur, (n) => { cur = shiftMonth(cur, n); draw(); }, (k) => goto(k)), h('button', { onclick: closeOverlay }, 'Close'));
  draw();
  showOverlay(el, 'month', null, true);
}

// ---- Overlays (popovers / sheets) ----
let overlay = null;
// sel: CSS selector of the anchor (popovers sit beside it); none = centered sheet.
function showOverlay(el, kind, sel, dim, bid) {
  closeOverlay();
  overlay = { el, kind, sel, bid };
  scrim.classList.toggle('dim', !!dim);
  scrim.style.display = 'block';
  document.body.append(el);
  position(el, sel);
}
function closeOverlay() {
  if (!overlay) return;
  if (document.activeElement && overlay.el.contains(document.activeElement)) document.activeElement.blur();
  const o = overlay;
  overlay = null;
  o.el.remove();
  scrim.style.display = 'none';
  if (o.onClose) o.onClose();
  if (o.kind === 'pop') renderGrid();
}
scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); closeOverlay(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });
function position(el, sel) {
  const anchor = sel && document.querySelector(sel);
  el.classList.remove('center');
  if (!anchor) return el.classList.add('center');
  const r = anchor.getBoundingClientRect(), W = el.offsetWidth, H = el.offsetHeight;
  let left;
  if (innerWidth - r.right >= W + 16) left = r.right + 8;
  else if (r.left >= W + 16) left = r.left - W - 8;
  else return el.classList.add('center');
  el.style.left = left + 'px';
  el.style.top = clamp(r.top, 8, innerHeight - H - 8) + 'px';
}
const stepRow = (label, val, minus, plus) => h('div', { class: 'step' }, h('span', { class: 'lab' }, label),
  h('button', { 'aria-label': label + ' less', onclick: minus }, '−'), val, h('button', { 'aria-label': label + ' more', onclick: plus }, '+'));
const catChip = (c, sel, onclick) => h('button', { class: 'chip' + (sel ? ' sel' : ''), 'data-cat': c ? c.id : '', style: c ? `--c:${c.color}` : null, onclick }, c ? h('span', { class: 'dot' }) : null, c ? c.name : 'None');

// ---- Block popover ----
function openPop(b, { ask = false } = {}) {
  const max = L.dayMinutes(b.day);
  const startV = h('span', { class: 'val' }), endV = h('span', { class: 'val' });
  const input = h('input', { type: 'text', value: b.title, autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Title' });
  input.addEventListener('input', () => { b.title = input.value; save(); renderGrid(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  const chips = state.cats.map((c) => catChip(c, false, () => {
    if (!b.title.trim() || b.title === catOf(b.cat).name) { b.title = c.name; input.value = c.name; }
    b.cat = c.id; state.lastCat = c.id; save(); render();
    if (ask) closeOverlay(); else sync();
  }));
  const sync = () => {
    startV.textContent = fmtT(b.day, b.start);
    endV.textContent = `${fmtT(b.day, b.end)} · ${fmtH(b.end - b.start)}`;
    input.placeholder = catOf(b.cat).name;
    chips.forEach((ch) => ch.classList.toggle('sel', !ask && ch.dataset.cat === b.cat));
  };
  const shift = (field, delta) => {
    const nb = { ...b, [field]: b[field] + delta };
    if (nb.start < 0 || nb.end > max || nb.end - nb.start < L.STEP) return;
    if (L.overlaps(state.blocks, nb)) return toast('Overlaps another block');
    b[field] = nb[field]; save(); render(); sync();
  };
  const el = h('div', { class: 'pop', role: 'dialog', 'aria-label': 'Edit block' },
    input, ask ? h('p', { class: 'ask' }, 'Which category?') : null, h('div', { class: 'chips' }, chips),
    stepRow('Start', startV, () => shift('start', -L.STEP), () => shift('start', L.STEP)),
    stepRow('End', endV, () => shift('end', -L.STEP), () => shift('end', L.STEP)),
    b.layer === 'plan' ? h('button', { onclick: () => toLot(b) }, 'Move to parking lot') : null,
    h('div', { class: 'row' }, h('button', { class: 'danger', onclick: () => del(b) }, 'Delete'), h('button', { class: 'primary', onclick: closeOverlay }, 'Done')));
  sync();
  showOverlay(el, 'pop', `#grid [data-id="${CSS.escape(b.id)}"]`, false, b.id);
  renderGrid();
}
function del(b) {
  state.blocks = state.blocks.filter((x) => x !== b);
  save(); closeOverlay(); render();
  toast('Block deleted', 'Undo', () => {
    if (L.overlaps(state.blocks, b)) return toast('Can’t undo: that slot is now taken');
    state.blocks.push(b); save(); render();
  }, 5000);
}
function toLot(b) {
  state.blocks = state.blocks.filter((x) => x !== b);
  const item = { id: uid(), text: (b.title.trim() || catOf(b.cat).name).slice(0, 200), min: Math.min(L.MAX_TASK, b.end - b.start), cat: b.cat, at: Date.now() };
  state.lot.push(item);
  save(); closeOverlay(); setLot(true); render();
  toast('Moved to parking lot', 'Undo', () => {
    state.lot = state.lot.filter((x) => x.id !== item.id);
    if (!L.overlaps(state.blocks, b)) state.blocks.push(b);
    save(); render();
  }, 5000);
}
function createAt(layer, y) {
  const max = L.dayMinutes(view), s = Math.floor(y / SLOT_PX) * L.STEP;
  if (s < 0 || s >= max) return;
  const cat = pickCat();
  const b = { id: uid(), day: view, start: s, end: Math.min(s + 30, max), layer, cat, title: catOf(cat).name, note: '', seq: 0 };
  if (L.overlaps(state.blocks, b)) b.end = s + L.STEP;
  if (L.overlaps(state.blocks, b)) return toast('That slot is taken');
  state.blocks.push(b); save(); render(); openPop(b);
}

// ---- Pointer: tap to create, drag blocks, drag parking-lot items ----
let tap = null, drag = null, lotDrag = null;
const dragging = () => !!(drag || lotDrag);
for (const layer of ['plan', 'actual']) {
  cols[layer].addEventListener('pointerdown', (e) => {
    if (e.target !== cols[layer] || e.button > 0 || dragging()) return;
    tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), layer };
  });
}
function onBlockDown(e, b, el) {
  if (e.button > 0 || dragging()) return;
  e.stopPropagation();
  const mode = e.target.closest('.rh') ? 'resize' : 'move';
  drag = { b, el, mode, type: e.pointerType, id: e.pointerId, x0: e.clientX, y0: e.clientY, s0: scroller.scrollTop, active: false, moved: false, ns: b.start, ne: b.end, timer: 0 };
  if (mode === 'resize' || e.pointerType !== 'touch') activate();
  else drag.timer = setTimeout(activate, HOLD);
}
function activate() {
  if (!drag) return;
  drag.active = true;
  try { drag.el.setPointerCapture(drag.id); } catch {}
  document.body.classList.add('dragging');
  if (drag.type === 'touch') drag.el.classList.add('lifted');
}
function endDrag() {
  if (!drag) return;
  clearTimeout(drag.timer);
  drag.el.classList.remove('lifted', 'bad');
  document.body.classList.remove('dragging');
  drag = null;
}
const edgeScroll = (y) => {
  const r = scroller.getBoundingClientRect();
  if (y < r.top + 36) scroller.scrollTop -= 14;
  else if (y > r.bottom - 36) scroller.scrollTop += 14;
};
addEventListener('pointermove', (e) => {
  if (tap && e.pointerId === tap.id && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap = null;
  if (lotDrag && e.pointerId === lotDrag.id) return lotMove(e);
  if (!drag || e.pointerId !== drag.id) return;
  const dy0 = e.clientY - drag.y0;
  if (!drag.active) { if (Math.hypot(e.clientX - drag.x0, dy0) > 8) endDrag(); return; }
  edgeScroll(e.clientY);
  const dy = dy0 + scroller.scrollTop - drag.s0;
  if (!drag.moved && Math.abs(dy) < 6) return;
  if (!drag.moved) { drag.moved = true; drag.el.classList.add('lifted'); }
  const b = drag.b, d = Math.round(dy / SLOT_PX) * L.STEP, max = L.dayMinutes(b.day), len = b.end - b.start;
  if (drag.mode === 'move') { drag.ns = clamp(b.start + d, 0, max - len); drag.ne = drag.ns + len; }
  else drag.ne = clamp(b.end + d, b.start + L.STEP, max);
  place(drag.el, drag.ns, drag.ne);
  drag.el.classList.toggle('bad', L.overlaps(state.blocks, { ...b, start: drag.ns, end: drag.ne }));
});
addEventListener('pointerup', (e) => {
  if (tap && e.pointerId === tap.id) {
    const t = tap; tap = null;
    if (Date.now() - t.t < 700) createAt(t.layer, e.clientY - cols[t.layer].getBoundingClientRect().top);
  }
  if (lotDrag && e.pointerId === lotDrag.id) return lotUp();
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; endDrag();
  if (!d.moved) return openPop(d.b);
  if (d.ns === d.b.start && d.ne === d.b.end) return renderGrid();
  if (L.overlaps(state.blocks, { ...d.b, start: d.ns, end: d.ne })) { toast('Overlaps another block'); return renderGrid(); }
  d.b.start = d.ns; d.b.end = d.ne; save(); render();
});
addEventListener('pointercancel', (e) => {
  if (tap && e.pointerId === tap.id) tap = null;
  if (lotDrag && e.pointerId === lotDrag.id) endLot();
  if (drag && e.pointerId === drag.id) { const m = drag.moved; endDrag(); if (m) renderGrid(); }
});
// Block native scrolling while a drag is live (iOS ignores touch-action changes mid-gesture).
document.addEventListener('touchmove', (e) => {
  if ((drag && (drag.active || drag.type !== 'touch')) || (lotDrag && lotDrag.active)) e.preventDefault();
}, { passive: false });
grid.addEventListener('contextmenu', (e) => e.preventDefault());
lotEl.addEventListener('contextmenu', (e) => e.preventDefault());

// Parking-lot drag: long-press (touch) or press (Pencil/mouse), drop on the Plan column.
function onItemDown(e, item, el) {
  if (e.button > 0 || dragging() || e.target.closest('button')) return;
  lotDrag = { item, el, type: e.pointerType, id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, moved: false, timer: 0, ghost: null, prev: null, start: null, bad: false };
  if (e.pointerType === 'touch') lotDrag.timer = setTimeout(lotActivate, HOLD);
  else lotActivate();
}
function lotActivate() {
  if (!lotDrag) return;
  lotDrag.active = true;
  try { lotDrag.el.setPointerCapture(lotDrag.id); } catch {}
  document.body.classList.add('dragging');
}
function lotMove(e) {
  const d = lotDrag, dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
  if (!d.active) { if (dist > 8) endLot(); return; }
  if (!d.moved) {
    if (dist < 6) return;
    d.moved = true;
    d.el.classList.add('lifted');
    const c = d.item.cat && hasCat(d.item.cat) ? catOf(d.item.cat) : null;
    d.ghost = h('div', { class: 'ghost', style: c ? `--c:${c.color}` : null }, `${d.item.text} · ${fmtH(d.item.min)}`);
    document.body.append(d.ghost);
  }
  d.ghost.style.left = e.clientX + 'px';
  d.ghost.style.top = e.clientY + 'px';
  const sr = scroller.getBoundingClientRect();
  if (e.clientX >= sr.left && e.clientX <= sr.right) edgeScroll(e.clientY);
  const pr = cols.plan.getBoundingClientRect();
  if (!(e.clientX >= pr.left && e.clientX <= pr.right && e.clientY >= sr.top && e.clientY <= sr.bottom)) {
    d.start = null;
    if (d.prev) { d.prev.remove(); d.prev = null; }
    return;
  }
  const max = L.dayMinutes(view), len = Math.min(d.item.min, max);
  const start = clamp(Math.floor((e.clientY - pr.top) / SLOT_PX) * L.STEP, 0, max - len);
  const c = catOf(d.item.cat && hasCat(d.item.cat) ? d.item.cat : pickCat());
  if (!d.prev) { d.prev = h('div', { class: 'blk plan preview' }, h('div', { class: 'bt' }, d.item.text)); cols.plan.append(d.prev); }
  d.prev.style.setProperty('--c', c.color);
  place(d.prev, start, start + len);
  d.start = start;
  d.bad = L.overlaps(state.blocks, { id: '', day: view, layer: 'plan', start, end: start + len });
  d.prev.classList.toggle('bad', d.bad);
}
function lotUp() {
  const { item, moved, start, bad } = lotDrag;
  endLot();
  if (!moved) return openItemPop(item);
  if (start == null) return;
  if (bad) return toast('That slot is taken');
  schedule(item, start);
}
function endLot() {
  const d = lotDrag;
  if (!d) return;
  clearTimeout(d.timer);
  if (d.ghost) d.ghost.remove();
  if (d.prev) d.prev.remove();
  d.el.classList.remove('lifted');
  document.body.classList.remove('dragging');
  lotDrag = null;
}
function schedule(item, start) {
  const max = L.dayMinutes(view), linked = item.cat && hasCat(item.cat);
  const b = { id: uid(), day: view, start, end: Math.min(start + item.min, max), layer: 'plan', cat: linked ? item.cat : pickCat(), title: item.text, note: '', seq: 0 };
  if (b.end - b.start < L.STEP || L.overlaps(state.blocks, b)) return toast('That slot is taken');
  state.blocks.push(b);
  state.lot = state.lot.filter((x) => x.id !== item.id);
  save(); render();
  if (!linked) openPop(b, { ask: true }); // #tagged items already know their category
  toast(`Scheduled ${fmtH(b.end - b.start)} at ${fmtT(view, b.start)}`, 'Undo', () => {
    state.blocks = state.blocks.filter((x) => x.id !== b.id);
    state.lot.push(item);
    closeOverlay(); save(); render();
  }, 5000);
}

// ---- Swipe left/right on the grid to change day ----
let swipe = null;
function slide(dir) {
  grid.classList.remove('inL', 'inR');
  void grid.offsetWidth;
  grid.classList.add(dir > 0 ? 'inL' : 'inR');
}
grid.addEventListener('animationend', () => grid.classList.remove('inL', 'inR'));
scroller.addEventListener('touchstart', (e) => {
  swipe = dragging() || e.touches.length !== 1 ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, locked: false };
}, { passive: true });
scroller.addEventListener('touchmove', (e) => {
  if (!swipe) return;
  if (dragging() || e.touches.length !== 1) { swipe = null; return; }
  const dx = e.touches[0].clientX - swipe.x, dy = e.touches[0].clientY - swipe.y;
  if (!swipe.locked) {
    if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) swipe = null; // vertical scroll wins
    else if (Math.abs(dx) > 10) swipe.locked = true;
  }
}, { passive: true });
scroller.addEventListener('touchend', (e) => {
  const s = swipe;
  swipe = null;
  if (!s || !s.locked || dragging()) return;
  const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  const n = dx < 0 ? 1 : -1;
  goto(L.addDays(view, n));
  slide(n);
}, { passive: true });
scroller.addEventListener('touchcancel', () => { swipe = null; }, { passive: true });

// ---- Timers ----
function stopTimer(endMs) {
  const t = state.timer;
  if (!t) return '';
  state.timer = null;
  const b = L.timerToBlock(t, endMs, state.blocks, state.cats);
  let msg;
  if (b) { b.id = uid(); state.blocks.push(b); msg = `Logged ${fmtH(b.end - b.start)} of ${catOf(b.cat).name}`; }
  else msg = endMs - t.startedAt < L.STEP * 60000 ? 'Under 15 min, not logged' : 'No free Actual time, not logged';
  save();
  return msg;
}
function toggleTimer(cat) {
  const t = state.timer;
  let msg = t ? stopTimer(Date.now()) : '';
  if (!t || t.cat !== cat) {
    state.timer = { cat, startedAt: Date.now() }; state.lastCat = cat; save();
    msg = (msg ? msg + ' · ' : '') + `${catOf(cat).name} started`;
  }
  render(); toast(msg);
}
function checkLongTimer() {
  const t = state.timer;
  if (!t || t.keep || overlay || Date.now() - t.startedAt < 4 * 3600e3) return;
  let end = t.startedAt + 3600e3;
  const val = h('span', { class: 'val' });
  const sync = () => { val.textContent = `${new Date(end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${fmtH((end - t.startedAt) / 60000)}`; };
  const step = (d) => { const n = end + d * 60000; if (n < t.startedAt + L.STEP * 60000 || n > Date.now()) return; end = n; sync(); };
  const el = h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Long timer' },
    h('h3', {}, `${catOf(t.cat).name} timer has run ${fmtH(Math.floor((Date.now() - t.startedAt) / 60000))}`),
    h('p', { class: 'muted' }, 'Still going, or did it end earlier?'),
    stepRow('Ended', val, () => step(-L.STEP), () => step(L.STEP)),
    h('div', { class: 'row' },
      h('button', { onclick: () => { t.keep = true; save(); closeOverlay(); } }, 'Keep running'),
      h('button', { class: 'primary', onclick: () => { const m = stopTimer(end); closeOverlay(); render(); toast(m); } }, 'Stop at this time')));
  sync();
  showOverlay(el, 'sheet', null, true);
}

// ---- Copy plan, fire drill ----
function copyPlan() {
  let n = 0, skip = 0;
  for (const b of state.blocks.filter((x) => x.day === view && x.layer === 'plan')) {
    const nb = { ...b, id: uid(), layer: 'actual', seq: 0 };
    if (L.overlaps(state.blocks, nb)) skip++; else { state.blocks.push(nb); n++; }
  }
  save(); render();
  toast(n || skip ? `Copied ${n}${skip ? `, skipped ${skip} (overlap)` : ''}` : 'No plan blocks to copy');
}
// Cutoff (minutes) for a fire drill on the viewed day, or null when there's nothing left to push.
function fireCutoff() {
  const t = today();
  if (view !== t) return null;
  const cut = L.ceil15(L.offsetOf(t, Date.now()));
  return cut < L.dayMinutes(t) && state.blocks.some((b) => b.day === t && b.layer === 'plan' && b.end > cut) ? cut : null;
}
function openFire() {
  const cut = fireCutoff(), day = view;
  if (cut == null) return toast('Fire drill works on today’s remaining plan');
  const PRE = [30, 60, 90, 120];
  let delta = 60, tcat = hasCat('work') ? 'work' : state.cats[0].id;
  const info = h('p', { class: 'muted' }), val = h('span', { class: 'val' });
  const presets = PRE.map((m) => h('button', { onclick: () => { delta = m; sync(); } }, fmtH(m)));
  const chips = [...state.cats, null].map((c) => catChip(c, false, () => { tcat = c ? c.id : null; sync(); }));
  const sync = () => {
    val.textContent = fmtH(delta);
    presets.forEach((b, i) => b.classList.toggle('sel', PRE[i] === delta));
    chips.forEach((b) => b.classList.toggle('sel', (b.dataset.cat || null) === tcat));
    const r = L.reflow(state.blocks, day, cut, delta, () => '');
    info.textContent = `Moves ${r.moved.length} block${r.moved.length === 1 ? '' : 's'} from ${fmtT(day, cut)}` +
      (r.split ? ` · splits “${r.split.head.title || catOf(r.split.head.cat).name}”` : '') +
      (r.overflow.length ? ` · ${r.overflow.length} won’t fit → Parking lot` : '');
  };
  const apply = () => {
    const snap = { blocks: state.blocks.slice(), lot: state.lot.slice(), timer: state.timer && { ...state.timer }, lastCat: state.lastCat };
    const r = L.reflow(state.blocks, day, cut, delta, uid);
    state.blocks = r.blocks;
    for (const b of r.overflow) state.lot.push({ id: uid(), text: (b.title.trim() || catOf(b.cat).name).slice(0, 200), min: Math.min(L.MAX_TASK, b.end - b.start), cat: b.cat, at: Date.now() });
    if (tcat && !(state.timer && state.timer.cat === tcat)) {
      if (state.timer) stopTimer(Date.now());
      state.timer = { cat: tcat, startedAt: Date.now() };
      state.lastCat = tcat;
    }
    save(); closeOverlay(); render();
    toast(`Pushed ${r.moved.length} block${r.moved.length === 1 ? '' : 's'} back ${fmtH(delta)}${r.overflow.length ? ` · ${r.overflow.length} to parking lot` : ''}`, 'Undo', () => {
      Object.assign(state, snap); save(); render();
    }, 7000);
  };
  const el = h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Fire drill' },
    h('h3', {}, 'Fire drill'),
    h('p', { class: 'muted' }, 'Push the rest of today’s plan back by'),
    h('div', { class: 'seg' }, presets),
    stepRow('Custom', val, () => { if (delta > L.STEP) { delta -= L.STEP; sync(); } }, () => { if (delta < 600) { delta += L.STEP; sync(); } }),
    h('p', { class: 'muted' }, 'Start a timer for the interruption'),
    h('div', { class: 'chips' }, chips),
    info,
    h('div', { class: 'row' }, h('button', { onclick: closeOverlay }, 'Cancel'), h('button', { class: 'primary', onclick: apply }, 'Apply')));
  sync();
  showOverlay(el, 'sheet', null, true);
}

// ---- Fill the gaps ----
function openGaps() {
  const day = view;
  if (!L.findGaps(state.blocks, day, Date.now(), state.timer, state.gapSkip).length) return;
  const el = h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Fill the gaps' });
  const fill = (s, e, cat) => {
    state.blocks.push({ id: uid(), day, start: s, end: e, layer: 'actual', cat, title: catOf(cat).name, note: '', seq: 0 });
    save(); render(); draw();
  };
  const draw = () => {
    const gaps = L.findGaps(state.blocks, day, Date.now(), state.timer, state.gapSkip);
    if (!gaps.length) { closeOverlay(); return toast('All caught up'); }
    el.replaceChildren(
      h('h3', {}, `Untracked time · ${fmtDay(day)}`),
      h('p', { class: 'muted' }, 'What were you doing? Tap a category to log the whole stretch.'),
      ...gaps.map(([s, e]) => h('div', { class: 'gap' },
        h('div', { class: 'gaprow' }, h('b', {}, `${fmtT(day, s)} – ${fmtT(day, e)}`), h('span', { class: 'muted' }, fmtH(e - s)),
          h('button', { class: 'link', onclick: () => { state.gapSkip.push(`${day}|${s}|${e}`); save(); renderBar(); draw(); } }, 'Skip')),
        h('div', { class: 'chips' }, state.cats.map((c) => catChip(c, false, () => fill(s, e, c.id)))))),
      h('button', { onclick: closeOverlay }, 'Done'));
  };
  draw();
  showOverlay(el, 'sheet', null, true);
}

// ---- Parking lot ----
function setLot(open) {
  lotOpen = open;
  lotEl.hidden = !open;
  if (open) { renderLot(); hint(); }
  renderBar();
}
function renderLot() {
  const g = L.lotGroups(state.lot);
  const sec = (key, title) => {
    const list = g[key];
    if (!list.length) return null;
    return h('div', { class: 'lsec' }, h('h4', {}, h('span', {}, title), h('span', {}, `${list.length} · ${fmtH(list.reduce((s, x) => s + x.min, 0))}`)), list.map(itemEl));
  };
  lotList.replaceChildren(...(state.lot.length
    ? [sec('quick', 'Quick · 30m or less'), sec('medium', 'Medium · 45–75m'), sec('long', 'Long · 90m+')]
    : [h('div', { class: 'lempty' }, 'Type a task and press Enter. Add a time like “20 min” and a category like #Career. Long-press a task and drag it onto the Plan to schedule it.')]));
}
function itemEl(x) {
  const c = x.cat && hasCat(x.cat) ? catOf(x.cat) : null;
  const el = h('div', { class: 'item' + (c ? ' tagged' : ''), style: c ? `--c:${c.color}` : null, 'data-lid': x.id },
    h('span', { class: 'itxt' }, x.text),
    c ? h('span', { class: 'itag' }, c.name) : null,
    h('span', { class: 'idur' }, (x.timed === false ? '~' : '') + fmtH(x.min)),
    h('button', { class: 'idel', 'aria-label': `Delete ${x.text}`, onclick: () => delItem(x) }, '✕'));
  el.addEventListener('pointerdown', (e) => onItemDown(e, x, el));
  return el;
}
function delItem(x) {
  state.lot = state.lot.filter((i) => i.id !== x.id);
  save(); closeOverlay(); renderLot(); renderBar();
  toast('Task deleted', 'Undo', () => { state.lot.push(x); save(); if (lotOpen) renderLot(); renderBar(); }, 5000);
}
function openItemPop(x) {
  const input = h('input', { type: 'text', value: x.text, autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Task' });
  const durV = h('span', { class: 'val' });
  const refresh = () => { save(); renderLot(); renderBar(); sync(); };
  input.addEventListener('change', () => {
    const p = L.parseTask(input.value, state.cats);
    if (p.text) { x.text = p.text; if (p.timed) { x.min = p.min; delete x.timed; } if (p.cat) x.cat = p.cat; }
    input.value = x.text;
    refresh();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  const chips = [...state.cats, null].map((c) => catChip(c, false, () => { if (c) x.cat = c.id; else delete x.cat; refresh(); }));
  const sync = () => {
    durV.textContent = fmtH(x.min);
    chips.forEach((b) => b.classList.toggle('sel', (b.dataset.cat || null) === (x.cat && hasCat(x.cat) ? x.cat : null)));
  };
  const step = (d) => { const n = x.min + d; if (n < L.STEP || n > L.MAX_TASK) return; x.min = n; delete x.timed; refresh(); };
  const el = h('div', { class: 'pop', role: 'dialog', 'aria-label': 'Edit task' },
    input, h('div', { class: 'chips' }, chips),
    stepRow('Time', durV, () => step(-L.STEP), () => step(L.STEP)),
    h('p', { class: 'muted' }, 'Long-press and drag it onto the Plan column to schedule it.'),
    h('div', { class: 'row' }, h('button', { class: 'danger', onclick: () => delItem(x) }, 'Delete'), h('button', { class: 'primary', onclick: closeOverlay }, 'Done')));
  sync();
  showOverlay(el, 'item', `#lot [data-lid="${CSS.escape(x.id)}"]`, false);
}
function hint() {
  const v = lotIn.value.trim();
  if (!v) return lotHint.replaceChildren('Add a time (15 min, 1.5h) and a #category');
  const p = L.parseTask(v, state.cats), c = p.cat ? catOf(p.cat) : null;
  lotHint.replaceChildren(p.text ? `→ ${p.text}` : '→ add a description', ` · ${p.timed ? '' : '~'}${fmtH(p.min)}`,
    c ? h('span', { class: 'itag', style: `--c:${c.color}` }, c.name) : '');
}
lotIn.addEventListener('input', hint);
$('#lotForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = L.parseTask(lotIn.value, state.cats);
  if (!p.text) { if (lotIn.value.trim()) toast('Add a description'); return; }
  const item = { id: uid(), text: p.text, min: p.min, at: Date.now() };
  if (!p.timed) item.timed = false;
  if (p.cat) item.cat = p.cat;
  state.lot.push(item);
  save();
  lotIn.value = '';
  hint(); renderLot(); renderBar();
  lotIn.focus();
});

// ---- Categories editor ----
function openCats() {
  const el = h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Categories' });
  const move = (i, d) => {
    const cs = state.cats, j = i + d;
    if (j < 0 || j >= cs.length) return;
    [cs[i], cs[j]] = [cs[j], cs[i]];
    save(); render(); draw();
  };
  const add = () => {
    if (state.cats.length >= L.MAX_CATS) return;
    const used = new Set(state.cats.map((c) => c.color));
    const c = { id: 'c' + Math.random().toString(36).slice(2, 8), name: 'New category', color: L.PALETTE.find((p) => !used.has(p)) || L.PALETTE[0], drift: false };
    state.cats.push(c);
    save(); render(); draw(c.id);
  };
  const askDelete = (id) => {
    const c = catOf(id);
    if (state.cats.length === 1) return toast('Keep at least one category');
    if (state.timer && state.timer.cat === id) return toast('Stop the timer first');
    const used = state.blocks.filter((b) => b.cat === id).length;
    const doDelete = (to) => {
      const snap = state;
      state = L.deleteCat(state, id, to);
      save(); render(); draw();
      toast(`Deleted ${c.name}`, 'Undo', () => { state = snap; save(); render(); if (overlay && overlay.el === el) draw(); }, 6000);
    };
    if (!used) return doDelete(null);
    el.replaceChildren(h('h3', {}, `Delete ${c.name}?`),
      h('p', { class: 'muted' }, `${used} block${used === 1 ? '' : 's'} use ${c.name}. Move ${used === 1 ? 'it' : 'them'} to:`),
      h('div', { class: 'chips' }, state.cats.filter((x) => x.id !== id).map((x) => catChip(x, false, () => doDelete(x.id)))),
      h('button', { onclick: () => draw() }, 'Cancel'));
  };
  const draw = (focusId) => {
    const rows = state.cats.map((c, i) => {
      const name = h('input', { type: 'text', value: c.name, maxlength: '24', autocomplete: 'off', 'aria-label': 'Category name', 'data-cid': c.id });
      const sw = h('button', { class: 'swatch', style: `--c:${c.color}`, onclick: () => {
        const cur = catOf(c.id);
        cur.color = L.PALETTE[(L.PALETTE.indexOf(cur.color) + 1) % L.PALETTE.length];
        sw.style.setProperty('--c', cur.color);
        save(); render();
      } });
      const drift = h('input', { type: 'checkbox', checked: c.drift });
      drift.addEventListener('change', () => { catOf(c.id).drift = drift.checked; save(); render(); });
      const up = h('button', { class: 'sm', disabled: i === 0, onclick: () => move(i, -1) }, '↑');
      const down = h('button', { class: 'sm', disabled: i === state.cats.length - 1, onclick: () => move(i, 1) }, '↓');
      const rm = h('button', { class: 'sm danger', onclick: () => askDelete(c.id) }, '✕');
      const label = (n) => {
        sw.setAttribute('aria-label', `Change color of ${n}`); drift.setAttribute('aria-label', `Count ${n} as Drift`);
        up.setAttribute('aria-label', `Move ${n} up`); down.setAttribute('aria-label', `Move ${n} down`); rm.setAttribute('aria-label', `Delete ${n}`);
      };
      label(c.name);
      name.addEventListener('input', () => { const v = name.value.trim(); if (v) { state = L.renameCat(state, c.id, v); label(v); save(); render(); } });
      name.addEventListener('blur', () => { if (!name.value.trim()) name.value = catOf(c.id).name; });
      return h('div', { class: 'crow-e' }, sw, name, h('label', {}, drift, 'Drift'), up, down, rm);
    });
    const full = state.cats.length >= L.MAX_CATS;
    el.replaceChildren(h('h3', {}, 'Categories'),
      h('p', { class: 'muted' }, 'Tap a color to change it. “Drift” counts as wasted time on the dashboard. Type #Name in the parking lot to tag a task.'),
      ...rows,
      h('button', { disabled: full, onclick: add }, full ? 'Maximum 10 categories' : '+ Add category'),
      h('button', { class: 'primary', onclick: closeOverlay }, 'Done'));
    if (focusId) { const f = el.querySelector(`[data-cid="${CSS.escape(focusId)}"]`); if (f) { f.focus(); f.select(); } }
  };
  draw();
  showOverlay(el, 'sheet', null, true);
}

// ---- Dashboard ----
function renderDash() {
  tipEl.hidden = true;
  const now = Date.now(), cs = state.cats, t = today();
  const byDay = new Map();
  for (const b of state.blocks) { let a = byDay.get(b.day); if (!a) byDay.set(b.day, (a = [])); a.push(b); }
  const memo = new Map();
  const sum = (d) => { if (!memo.has(d)) memo.set(d, L.daySummary(byDay.get(d) || [], d, cs, now)); return memo.get(d); };
  const roll = (days) => L.rollup(days.map(sum), cs);
  const W = Math.max(260, dash.clientWidth - 32 - 30);
  const seg = h('div', { class: 'seg' }, ['day', 'week'].map((r) => h('button', { class: range === r ? 'sel' : '', onclick: () => { range = r; renderDash(); } }, r === 'day' ? 'Day' : 'Week')));
  const card = (title, ...kids) => h('div', { class: 'card' }, h('h3', {}, title), ...kids);
  const svg = (markup) => { const d = h('div'); d.innerHTML = markup; return d; };
  const out = [];
  if (range === 'week') {
    const days = L.weekDays(view), cur = roll(days), prev = roll(L.weekDays(L.addDays(view, -7)));
    out.push(h('div', { class: 'dhead' }, h('h2', {}, `Week of ${fmtShort(days[0])} – ${fmtShort(days[6])}`), seg));
    if (!cur.planTot && !cur.actTot) out.push(h('div', { class: 'dempty' }, 'No data yet this week. Plan or log some time and it shows up here.'));
    else {
      out.push(kpis(cur, prev, 'last week'));
      const shown = cs.filter((c) => cur.actual[c.id] > 0);
      out.push(card('Each day',
        h('div', { class: 'legend' }, shown.map((c) => h('span', {}, h('i', { class: 'sw', style: `--c:${c.color}` }), c.name)), h('span', {}, h('i', { class: 'pl' }), 'Plan')),
        svg(weekBars(days.map((d) => {
          const s = sum(d), cov = s.wake ? Math.min(1, s.actTot / s.wake) : null;
          const parts = cs.filter((c) => s.actual[c.id]).map((c) => `${c.name} ${fmtH(s.actual[c.id])}`);
          return { label: fmtWd(d), today: d === t, plan: s.planTot, sub: cov == null ? '' : pct(cov),
            segs: cs.map((c) => ({ color: c.color, min: s.actual[c.id] || 0 })),
            tip: `${fmtDay(d)}\n${parts.join(' · ') || 'Nothing logged'}\nLogged ${fmtH(s.actTot)} · Plan ${fmtH(s.planTot)}${cov == null ? '' : ` · ${pct(cov)} covered`}` };
        }), W)),
        h('p', { class: 'muted' }, '% under each day = share of a 16h waking day you logged. Tap a day for details.')));
      out.push(card('By category', catRows(cur)));
      const wide3 = W >= 560, sw = wide3 ? Math.floor((W - 28) / 3) : W;
      const weeks = Array.from({ length: 8 }, (_, i) => { const ds = L.weekDays(L.addDays(view, -7 * (7 - i))); return { label: fmtShort(ds[0]), r: roll(ds) }; });
      const sp = (k, get, fmt, opts) => {
        const pts = weeks.map((w) => ({ v: w.r.actTot || w.r.planTot ? get(w.r) : null, label: `Wk of ${w.label}` }));
        return h('div', { class: 'spark' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, pts.at(-1).v == null ? '—' : fmt(pts.at(-1).v)), svg(spark(pts, sw, { fmt, ...opts })));
      };
      out.push(card('Last 8 weeks', h('div', { class: 'sparks', style: `grid-template-columns:${wide3 ? 'repeat(3,1fr)' : '1fr'}` },
        sp('Coverage', (r) => r.coverage, pct, { lo: 0, hi: 1 }),
        sp('Drift', (r) => (r.wake ? r.drift : null), fmtH, {}),
        sp('Plan accuracy', (r) => r.accuracy, pct, { lo: 0, hi: 1 }))));
    }
  } else {
    const cur = roll([view]), prev = roll([L.addDays(view, -1)]);
    out.push(h('div', { class: 'dhead' }, h('h2', {}, fmtDay(view)), seg));
    if (!cur.planTot && !cur.actTot) out.push(h('div', { class: 'dempty' }, 'Nothing planned or logged on this day.'));
    else {
      out.push(kpis(cur, prev, 'previous day'));
      const gaps = L.findGaps(state.blocks, view, now, state.timer, state.gapSkip), gt = gaps.reduce((s, [a, b]) => s + b - a, 0);
      if (gt) out.push(card('Untracked', h('div', { class: 'gaprow' }, h('b', {}, `${fmtH(gt)} untracked in ${gaps.length} stretch${gaps.length === 1 ? '' : 'es'}`), h('button', { class: 'primary', onclick: openGaps }, 'Fill'))));
      out.push(card('By category', catRows(cur)));
    }
  }
  dash.replaceChildren(...out);
}
function kpis(c, p, vs) {
  const tile = (k, v, sub, delta) => h('div', { class: 'kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, sub ? h('small', {}, sub) : null), delta);
  const dl = (cur, prev, fmt, upIsGood = true) => {
    if (cur == null || prev == null) return h('div', { class: 'd' }, `No data for ${vs}`);
    const diff = cur - prev;
    if (Math.abs(diff) < 1e-9) return h('div', { class: 'd' }, `Same as ${vs}`);
    const up = diff > 0;
    return h('div', { class: 'd ' + (up === upIsGood ? 'good' : 'bad') }, h('b', {}, `${up ? '▲' : '▼'} ${fmt(Math.abs(diff))}`), ` vs ${vs}`);
  };
  const pts = (x) => `${Math.round(x * 100)} pts`;
  return h('div', { class: 'kpis' },
    tile('Logged', fmtH(c.actTot), null, dl(c.actTot, p.actTot, fmtH)),
    tile('Coverage', pct(c.coverage), 'of waking day', dl(c.coverage, p.coverage, pts)),
    tile('Plan accuracy', pct(c.accuracy), null, dl(c.accuracy, p.accuracy, pts)),
    tile('Drift', fmtH(c.drift), c.driftShare == null ? null : `${Math.round(c.driftShare * 100)}% of logged`, dl(c.drift, p.drift, fmtH, false)));
}
function catRows(r) {
  const cs = state.cats, max = Math.max(60, ...cs.map((c) => Math.max(r.plan[c.id], r.actual[c.id])));
  return h('div', {},
    h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'sw', style: '--c:var(--muted)' }), 'Actual'), h('span', {}, h('i', { class: 'pb' }), 'Plan')),
    cs.map((c) => {
      const a = r.actual[c.id], p = r.plan[c.id], d = a - p;
      return h('div', { class: 'crow', style: `--c:${c.color}` },
        h('div', { class: 'cname' }, h('span', { class: 'dot' }), c.name),
        h('div', { class: 'cbar' }, h('i', { class: 'a' + (a ? '' : ' z'), style: `width:${(a / max) * 100}%` }), h('i', { class: 'p' + (p ? '' : ' z'), style: `width:${(p / max) * 100}%` })),
        h('div', { class: 'cval' }, `${fmtH(a)} / ${fmtH(p)}`, h('small', {}, d ? `${d > 0 ? '+' : '−'}${fmtH(Math.abs(d))} vs plan` : 'on plan')));
    }));
}
// Tap a chart mark for its numbers.
dash.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tipEl.hidden = true; return; }
  tipEl.textContent = t.getAttribute('data-tip');
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  tipEl.style.left = clamp(e.clientX - r.width / 2, 8, innerWidth - r.width - 8) + 'px';
  tipEl.style.top = clamp(e.clientY - r.height - 14, 8, innerHeight - r.height - 8) + 'px';
});
dash.addEventListener('scroll', () => { tipEl.hidden = true; }, { passive: true });

// ---- Export, backup, restore, merge ----
function download(file) {
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// Must run synchronously inside the click handler: iOS rejects share() after an await.
function deliver(file) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch((err) => { if (!err || err.name !== 'AbortError') download(file); });
      return;
    }
  } catch {}
  download(file);
}
function openMenu() {
  let scope = 'day', layer = 'plan', list = [], file, backup, fileMode = 'restore';
  const info = h('p', { class: 'muted' });
  const build = () => {
    const days = scope === 'day' ? [view] : Array.from({ length: 7 }, (_, i) => L.addDays(view, i));
    list = state.blocks.filter((b) => b.layer === layer && days.includes(b.day)).sort((a, b) => L.minToMs(a.day, a.start) - L.minToMs(b.day, b.start));
    file = new File([L.buildICS(list, { layer, cats: state.cats })], `daily-os-${layer}-${view}${scope === 'week' ? '-week' : ''}.ics`, { type: 'text/calendar' });
    backup = new File([JSON.stringify(state)], `daily-os-backup-${today()}.json`, { type: 'application/json' });
    info.textContent = `${list.length} event${list.length === 1 ? '' : 's'} · ${scope === 'day' ? fmtDay(view) : `${fmtDay(days[0])} – ${fmtDay(days[6])}`}`;
  };
  const seg = (opts, get, set) => {
    const btns = opts.map(([v, label]) => h('button', { class: get() === v ? 'sel' : '', onclick: () => { set(v); btns.forEach((x, i) => x.classList.toggle('sel', opts[i][0] === v)); build(); } }, label));
    return h('div', { class: 'seg' }, btns);
  };
  const exportWith = (fn) => () => {
    if (!list.length) return toast('Nothing to export');
    fn(file);
    list.forEach((b) => { b.seq = (b.seq || 0) + 1; });
    save(); build();
  };
  const fileIn = h('input', { type: 'file', accept: '.json,application/json' });
  fileIn.addEventListener('change', () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    (fileMode === 'merge' ? mergeFile : restore)(f);
  });
  const pick = (m) => () => { fileMode = m; fileIn.click(); };
  const syncBox = h('div', { class: 'syncbox' });
  const drawSync = () => syncBox.replaceChildren(...syncSection());
  drawSync();
  const el = h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Export and backup' },
    syncBox,
    h('h3', {}, 'Export to Calendar'),
    seg([['day', 'Day'], ['week', 'Week']], () => scope, (v) => { scope = v; }),
    seg([['plan', 'Plan'], ['actual', 'Actual']], () => layer, (v) => { layer = v; }),
    info,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: exportWith(deliver) }, 'Share .ics'), h('button', { onclick: exportWith(download) }, 'Download .ics')),
    h('p', { class: 'muted' }, 'Choose Calendar or Save to Files, then open the file and Add All. Use a dedicated “Daily OS” calendar so you can delete it in one step.'),
    h('hr'),
    h('h3', {}, 'Backup'),
    h('div', { class: 'row' }, h('button', { onclick: () => deliver(backup) }, 'Back up (JSON)'), h('button', { onclick: pick('restore') }, 'Restore…')),
    h('button', { onclick: pick('merge') }, 'Merge from iPhone…'),
    h('p', { class: 'muted' }, syncCfg
      ? 'With sync on, Restore replaces your data on every device. Merge only adds blocks and never overwrites.'
      : 'Restore replaces everything on this device. Merge only adds blocks from the iPhone’s file and never overwrites what’s here.'),
    fileIn,
    h('button', { onclick: closeOverlay }, 'Close'));
  build();
  showOverlay(el, 'menu', null, true);
  overlay.refresh = () => { drawSync(); build(); };
}
async function readFile(f) {
  let d;
  try { d = L.migrate(JSON.parse(await f.text())); } catch { toast('Not a valid Daily OS file'); return null; }
  if (!L.validateData(d)) { toast(d && d.v != null && d.v !== 1 && d.v !== 2 ? 'Unsupported backup version' : 'File failed validation'); return null; }
  return d;
}
async function restore(f) {
  if (!f) return;
  const d = await readFile(f);
  if (!d) return;
  const prev = state;
  state = { ...fresh(), ...d };
  save(); closeOverlay(); render();
  toast(`Restored ${state.blocks.length} blocks`, 'Undo', () => { state = prev; save(); render(); }, 6000);
}
async function mergeFile(f) {
  if (!f) return;
  const d = await readFile(f);
  if (!d) return;
  const catsBefore = state.cats.slice(), ids = new Set(state.cats.map((c) => c.id));
  for (const c of d.cats) if (!ids.has(c.id) && state.cats.length < L.MAX_CATS && d.blocks.some((b) => b.cat === c.id)) { state.cats.push({ ...c }); ids.add(c.id); }
  const r = L.mergeBlocks(state.blocks, d.blocks.filter((b) => ids.has(b.cat)));
  state.blocks.push(...r.added);
  save(); closeOverlay(); render();
  const n = r.added.length, added = new Set(r.added.map((b) => b.id)), lost = d.blocks.length - r.added.length - r.dup - r.clash;
  const msg = (n ? `Merged ${n} block${n === 1 ? '' : 's'}` : 'Nothing new to merge') + (r.clash ? ` · ${r.clash} skipped (overlap)` : '') + (lost ? ` · ${lost} skipped (too many categories)` : '');
  toast(msg, n ? 'Undo' : '', n ? () => { state.blocks = state.blocks.filter((b) => !added.has(b.id)); state.cats = catsBefore; save(); render(); } : null, 6000);
}

// ---- Sync (private GitHub repo, unlocked with a password) ----
const SYNC = KEY + '.sync', BASE = KEY + '.sync.base', SEALED = KEY + '.sync.sealed', SKIP = KEY + '.sync.skip';
const store = {
  get: (k) => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v, keep = true) => { try { (keep ? localStorage : sessionStorage).setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} },
};
let syncCfg = null, syncer = null, sealedKey = null, sync = { s: 'off', msg: '' };
try { syncCfg = JSON.parse(store.get(SYNC)); } catch {}
const ua = navigator.userAgent, device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : 'browser';
const apiBase = () => store.get(KEY + '.syncApi') || S.GH; // test hook
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`; };
const SYNC_TITLE = { ok: 'Synced', syncing: 'Syncing…', offline: 'Offline — will sync when back online', locked: 'Sync locked — open to unlock', auth: 'Sync problem', repo: 'Sync problem', error: 'Sync problem' };
function setSync(s, msg = '') { sync = { s, msg }; renderSyncDot(); if (overlay && overlay.refresh) overlay.refresh(); }
function renderSyncDot() {
  const s = syncCfg ? sync.s : sealedKey ? 'locked' : 'off', dot = $('#syncDot');
  dot.hidden = s === 'off';
  dot.className = 'sdot ' + s;
  dot.title = SYNC_TITLE[s] || '';
  $('#menuBtn').setAttribute('aria-label', `Export / Backup${s === 'off' ? '' : ` (${SYNC_TITLE[s] || s})`}`);
}
function startSync(cfg, keep = true) {
  if (syncer) syncer.stop();
  syncCfg = cfg;
  store.set(SYNC, JSON.stringify(cfg), keep);
  syncer = S.engine(cfg, {
    getState: () => state,
    applyState: (next) => { state = { ...fresh(), ...next }; persist(); render(); },
    // Don't swap data under an open editor or a drag; sheets that don't edit data are safe.
    isBusy: () => dragging() || !!(overlay && !['menu', 'month', 'sealed', 'copy', 'setup', 'unlock'].includes(overlay.kind)),
    onStatus: setSync,
    loadBase: () => { try { const b = JSON.parse(localStorage.getItem(BASE)); return b && b.repo === cfg.repo ? b : null; } catch { return null; } },
    saveBase: (b) => { try { localStorage.setItem(BASE, JSON.stringify({ ...b, repo: cfg.repo })); } catch {} },
    askFirst: askFirstSync,
  }, device);
  setSync('syncing');
  syncer.run();
}
function syncOff() {
  if (syncer) syncer.stop();
  syncer = null; syncCfg = null;
  store.del(SYNC); store.del(BASE);
  setSync('off');
  toast('Sync is off on this device. Your data stays here.');
}
function syncLine() {
  if (sync.s === 'syncing') return 'Syncing…';
  if (sync.s === 'ok') return `Synced ${ago(syncer.lastOk)} · ${syncCfg.repo}`;
  if (sync.s === 'offline') return 'Offline. Changes are saved here and sync when you’re back online.';
  if (sync.s === 'auth') return 'GitHub rejected the access token (it may have expired). Set up sync again with a new token.';
  return sync.msg || 'Waiting to sync';
}
function syncSection() {
  if (syncCfg) {
    const bad = ['auth', 'repo', 'error'].includes(sync.s);
    return [h('h3', {}, 'Sync'), h('p', { class: 'muted' + (bad ? ' err' : '') }, syncLine()),
      h('div', { class: 'row' }, h('button', { onclick: () => syncer && syncer.run() }, 'Sync now'), h('button', { onclick: () => copyText(S.widgetKey(syncCfg), 'Widget key copied. Paste it into Scriptable when asked — treat it like a password.') }, 'Copy widget key')),
      store.get(SEALED) ? h('button', { onclick: () => copyText(store.get(SEALED), 'Sync key copied') }, 'Copy sync key') : null,
      bad ? h('button', { class: 'primary', onclick: openSyncSetup }, 'Set up again…') : null,
      h('button', { class: 'danger', onclick: syncOff }, 'Turn off sync on this device'), h('hr')];
  }
  if (sealedKey) return [h('h3', {}, 'Sync'), h('p', { class: 'muted' }, 'Sync is set up. Enter your password to turn it on for this device.'), h('button', { class: 'primary', onclick: openUnlock }, 'Unlock sync…'), h('hr')];
  return [h('h3', {}, 'Sync across devices'), h('p', { class: 'muted' }, 'Keep your iPad, iPhone and widget in step through a private GitHub repository, unlocked with a password.'), h('button', { onclick: openSyncSetup }, 'Set up sync…'), h('hr')];
}
function copyText(text, msg) {
  const fallback = () => {
    const ta = h('textarea', { class: 'key', readonly: true, 'aria-label': 'Key' }, text);
    showOverlay(h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Copy' }, h('h3', {}, 'Copy this'), ta, h('button', { class: 'primary', onclick: closeOverlay }, 'Done')), 'copy', null, true);
    ta.select();
  };
  try { navigator.clipboard.writeText(text).then(() => toast(msg, '', null, 4000), fallback); } catch { fallback(); }
}
const field = (label, input) => h('label', { class: 'fl' }, label, input);
const checkbox = (label, on = true) => { const i = h('input', { type: 'checkbox', checked: on }); return [h('label', { class: 'chk' }, i, label), i]; };
function openSyncSetup() {
  const owner = /\.github\.io$/.test(location.hostname) ? location.hostname.split('.')[0] : '';
  const repo = h('input', { type: 'text', value: (syncCfg && syncCfg.repo) || (owner ? `${owner}/daily-os-data` : ''), placeholder: 'owner/daily-os-data', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off' });
  // A visible text field: a password field invites iOS to autofill a saved password here.
  const token = h('input', { type: 'text', placeholder: 'github_pat_…', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', class: 'mono' });
  const pw1 = h('input', { type: 'password', placeholder: '12+ characters', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', placeholder: 'Repeat password', autocomplete: 'new-password', 'aria-label': 'Repeat password' });
  const [keepRow, keep] = checkbox('Remember on this device');
  const err = h('p', { class: 'err' });
  const go = h('button', { class: 'primary', onclick: async () => {
    const r = repo.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
    const fail = (m) => { err.textContent = m; go.disabled = false; go.textContent = 'Connect'; };
    if (!/^[\w.-]+\/[\w.-]+$/.test(r)) return fail('Repository should look like owner/name');
    const tok = token.value.replace(/\s+/g, '');
    if (!tok) return fail('Paste the access token');
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(tok) && apiBase() === S.GH) return fail('That doesn’t look like a GitHub token. It should start with github_pat_ — copy it again from GitHub.');
    if (pw1.value.length < S.MIN_PASSWORD) return fail(`Use at least ${S.MIN_PASSWORD} characters — this password protects your data`);
    if (pw1.value !== pw2.value) return fail('The passwords don’t match');
    go.disabled = true; go.textContent = 'Checking…'; err.textContent = '';
    const cfg = { repo: r, token: tok, ...(apiBase() !== S.GH ? { api: apiBase() } : {}) };
    try { await S.client(cfg).list(); } catch (e) {
      return fail(e.kind === 'offline' ? 'Can’t reach GitHub. Check your connection.'
        : e.kind === 'auth' ? `GitHub didn’t accept this token (it starts “${tok.slice(0, 15)}…”, ${tok.length} characters). Make sure you copied all of it, or generate a new one.`
        : e.message);
    }
    const sealed = await S.sealKey(cfg, pw1.value);
    store.set(SEALED, sealed); sealedKey = sealed;
    store.del(BASE);
    closeOverlay();
    startSync(cfg, keep.checked);
    showSealed(sealed);
  } }, 'Connect');
  const el = h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Set up sync' },
    h('h3', {}, 'Set up sync'),
    h('ol', { class: 'steps' },
      h('li', {}, 'On GitHub, create a ', h('b', {}, 'private'), ' repository for your data, e.g. daily-os-data.'),
      h('li', {}, 'Create a fine-grained access token for only that repository, with Contents: Read and write.'),
      h('li', {}, 'Pick a password. You’ll type it once on each device.')),
    field('Repository', repo), field('Access token', token), field('Sync password', pw1), pw2, keepRow, err,
    h('div', { class: 'row' }, h('button', { onclick: closeOverlay }, 'Cancel'), go));
  showOverlay(el, 'setup', null, true);
}
function showSealed(sealed) {
  const ta = h('textarea', { class: 'key', readonly: true, 'aria-label': 'Sync key' }, sealed);
  showOverlay(h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Sync is on' },
    h('h3', {}, 'Sync is on'),
    h('p', { class: 'muted' }, 'So your other devices only need the password, publish this key as sync.key in the app’s repository. It’s encrypted: it opens only with your password.'),
    ta,
    h('div', { class: 'row' }, h('button', { onclick: () => copyText(sealed, 'Sync key copied') }, 'Copy key'), h('button', { class: 'primary', onclick: closeOverlay }, 'Done'))), 'sealed', null, true);
}
function openUnlock() {
  const pw = h('input', { type: 'password', placeholder: 'Sync password', autocomplete: 'current-password', 'aria-label': 'Sync password' });
  const [keepRow, keep] = checkbox('Remember on this device');
  const err = h('p', { class: 'err' });
  const go = async () => {
    btn.disabled = true; btn.textContent = 'Unlocking…'; err.textContent = '';
    try {
      const cfg = await S.openKey(sealedKey, pw.value);
      store.del(SKIP);
      closeOverlay();
      startSync(cfg, keep.checked);
      toast('Sync is on');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Unlock';
      err.textContent = e.message === 'wrong-password' ? 'That password didn’t work' : 'This sync key can’t be read';
    }
  };
  const btn = h('button', { class: 'primary', onclick: go }, 'Unlock');
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  showOverlay(h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Unlock sync' },
    h('h3', {}, 'Unlock sync'),
    h('p', { class: 'muted' }, 'Your data syncs through your private GitHub repository. Enter the password you chose when you set it up.'),
    pw, keepRow, err,
    h('div', { class: 'row' }, h('button', { onclick: () => { store.set(SKIP, '1'); closeOverlay(); } }, 'Not now'), btn)), 'unlock', null, true);
  setTimeout(() => pw.focus(), 50);
}
// First sync on a device that already has its own data.
function askFirstSync(n) {
  return new Promise((resolve) => {
    try { localStorage.setItem(KEY + '.pre-sync', JSON.stringify(state)); } catch {}
    const done = (v) => { resolve(v); closeOverlay(); };
    showOverlay(h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'First sync' },
      h('h3', {}, 'This device already has data'),
      h('p', { class: 'muted' }, `${n} item${n === 1 ? '' : 's'} here aren’t in your synced data yet. Combine them, or replace this device with the synced copy? A copy of this device’s data is kept either way.`),
      h('div', { class: 'row' }, h('button', { onclick: () => done('remote') }, 'Use synced copy'), h('button', { class: 'primary', onclick: () => done('merge') }, 'Combine'))), 'ask', null, true);
    overlay.onClose = () => resolve('merge');
  });
}
async function initSync() {
  if (syncCfg) { let keep = false; try { keep = !!localStorage.getItem(SYNC); } catch {} startSync(syncCfg, keep); }
  try {
    const res = await fetch('./sync.key', { cache: 'no-store' });
    if (res.ok) { const t = (await res.text()).trim(); if (JSON.parse(t).ct) sealedKey = t; }
  } catch {}
  if (!sealedKey) sealedKey = store.get(SEALED);
  renderSyncDot();
  if (!syncCfg && sealedKey && !store.get(SKIP) && !overlay) openUnlock();
}
setInterval(() => { if (syncer && !document.hidden) syncer.run(); }, 20000);
addEventListener('online', () => { if (syncer) syncer.run(); });
// The widget's "Parking lot" button opens …/#lot
function openFromHash() {
  if (location.hash !== '#lot') return;
  history.replaceState(null, '', location.pathname + location.search);
  setMode('plan');
  setLot(true);
  lotIn.focus();
}
addEventListener('hashchange', openFromHash);

// ---- Wiring ----
const goto = (key) => { view = key; monthCur = monthOf(key); closeOverlay(); render(); if (mode === 'plan') scrollToDefault(); };
function setMode(m) {
  if (m === mode) return;
  mode = m;
  main.dataset.mode = m;
  closeOverlay();
  render();
  if (m === 'plan') requestAnimationFrame(scrollToDefault);
}
$('#prev').addEventListener('click', () => goto(L.addDays(view, -1)));
$('#next').addEventListener('click', () => goto(L.addDays(view, 1)));
$('#todayBtn').addEventListener('click', () => goto(today()));
$('#copyBtn').addEventListener('click', copyPlan);
$('#fireBtn').addEventListener('click', openFire);
$('#menuBtn').addEventListener('click', openMenu);
$('#dayLabel').addEventListener('click', () => { if (!wide.matches) openMonthSheet(); });
for (const t of document.querySelectorAll('#bar .tab')) t.addEventListener('click', () => setMode(t.dataset.mode));
$('#gapChip').addEventListener('click', openGaps);
$('#lotBtn').addEventListener('click', () => setLot(!lotOpen));
$('#lotClose').addEventListener('click', () => setLot(false));
addEventListener('resize', () => {
  if (overlay && overlay.sel) position(overlay.el, overlay.sel);
  if (mode === 'dash') renderDash();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (!dragging()) { if (!overlay) render(); checkLongTimer(); }
  if (syncer) syncer.run();
});

try { localStorage.removeItem(KEY + '.tab'); } catch {} // v3 phone-tab setting, no longer used
recoverStash();
render();
requestAnimationFrame(scrollToDefault);
checkLongTimer();
openFromHash();
initSync();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
