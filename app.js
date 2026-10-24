import * as L from './logic.js';

const SLOT_PX = 28, KEY = 'dailyos';
const $ = (s) => document.querySelector(s);
const scroller = $('#scroller'), grid = $('#grid'), gutter = $('#gutter'), nowEl = $('#now'), scrim = $('#scrim');
const cols = { plan: grid.querySelector('.col.plan'), actual: grid.querySelector('.col.actual') };
const catOf = (id) => L.CATS.find((c) => c.id === id) || L.CATS[0];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pad = (n) => String(n).padStart(2, '0');
document.documentElement.style.setProperty('--slot', SLOT_PX + 'px');

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
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
const fresh = () => ({ v: 1, blocks: [], timer: null, lastCat: 'job' });
let state = load(), saveWarned = false;
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const d = JSON.parse(raw);
    if (L.validateData(d)) return { ...fresh(), ...d };
    localStorage.setItem(KEY + '.bad', raw);
  } catch {}
  return fresh();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); saveWarned = false; }
  catch { if (!saveWarned) { saveWarned = true; toast('Could not save: storage unavailable'); } }
}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch {}

let view = L.dayKeyOf(Date.now());

// ---- Formatting ----
const fmtT = (key, min) => new Date(L.minToMs(key, min)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtH = (m) => { const hh = Math.floor(m / 60), mm = m % 60; return hh ? (mm ? `${hh}h ${mm}m` : `${hh}h`) : `${mm}m`; };
const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return hh ? `${hh}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`; };
const fmtDay = (key) => { const [y, m, d] = L.parseKey(key); return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
const mins = (key, layer, cat) => state.blocks.filter((b) => b.day === key && b.layer === layer && (!cat || b.cat === cat)).reduce((s, b) => s + b.end - b.start, 0);
const yOf = (key, ms) => ((ms - L.dayStart(key)) / 60000 / L.STEP) * SLOT_PX;

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

// ---- Render ----
function render() {
  const today = L.dayKeyOf(Date.now());
  $('#dayLabel').replaceChildren(fmtDay(view), view === today ? h('small', {}, 'Today') : '');
  const planned = L.plannedMinutes(state.blocks, view), cap = planned / L.CAPACITY_MIN, act = mins(view, 'actual');
  $('#capFill').style.width = Math.min(100, cap * 100) + '%';
  $('#cap').className = 'cap' + (cap > 1 ? ' over' : cap > 0.85 ? ' warn' : '');
  $('#capText').textContent = `${fmtH(planned)} planned · ${Math.round(cap * 100)}% of 16h`;
  $('#planTot').textContent = planned ? fmtH(planned) : '';
  $('#actTot').textContent = act ? fmtH(act) : '';
  renderTimers();
  renderGrid();
  tick();
}

function renderTimers() {
  $('#timers').replaceChildren(...L.CATS.map((c) => {
    const on = !!state.timer && state.timer.cat === c.id;
    return h('button', { class: 'tbtn' + (on ? ' on' : ''), style: `--c:${c.color}`, 'data-cat': c.id, 'aria-pressed': on ? 'true' : 'false', onclick: () => toggleTimer(c.id) },
      h('span', { class: 'tn' }, h('span', { class: 'dot' }), c.name),
      h('span', { class: 'ts' }, on ? '● ' + fmtDur(Date.now() - state.timer.startedAt) : `${fmtH(mins(view, 'actual', c.id))} / ${fmtH(mins(view, 'plan', c.id))} plan`));
  }));
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
  const el = h('div', { class: `blk ${b.layer}${short ? ' short' : ''}${overlay && overlay.id === b.id ? ' sel' : ''}`, 'data-id': b.id, style: `--c:${c.color}` },
    h('div', { class: 'bt' }, b.title || c.name),
    h('div', { class: 'bm' }, `${fmtT(b.day, b.start)} – ${fmtT(b.day, b.end)} · ${fmtH(b.end - b.start)}`),
    h('div', { class: 'rh' }));
  place(el, b.start, b.end);
  el.addEventListener('pointerdown', (e) => onBlockDown(e, b, el));
  return el;
}

function tick() {
  const now = Date.now();
  if (L.dayKeyOf(now) === view) { nowEl.style.display = 'block'; nowEl.style.top = yOf(view, now) + 'px'; }
  else nowEl.style.display = 'none';
  const t = state.timer;
  if (!t) return;
  const ts = document.querySelector(`#timers [data-cat="${t.cat}"] .ts`);
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

// ---- Overlays (popover / sheets) ----
let overlay = null;
function showOverlay(el, kind, id, dim) {
  closeOverlay();
  overlay = { el, kind, id };
  scrim.classList.toggle('dim', dim);
  scrim.style.display = 'block';
  document.body.append(el);
}
function closeOverlay() {
  if (!overlay) return;
  if (document.activeElement && overlay.el.contains(document.activeElement)) document.activeElement.blur();
  const wasPop = overlay.kind === 'pop';
  overlay.el.remove();
  overlay = null;
  scrim.style.display = 'none';
  if (wasPop) renderGrid();
}
scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); closeOverlay(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });
addEventListener('resize', () => { if (overlay && overlay.kind === 'pop') { overlay.el.classList.remove('center'); position(overlay.el, overlay.id); } });

function position(el, id) {
  const anchor = grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!anchor) return el.classList.add('center');
  const r = anchor.getBoundingClientRect(), W = el.offsetWidth, H = el.offsetHeight;
  let left;
  if (innerWidth - r.right >= W + 16) left = r.right + 8;
  else if (r.left >= W + 16) left = r.left - W - 8;
  else return el.classList.add('center');
  el.style.left = left + 'px';
  el.style.top = clamp(r.top, 8, innerHeight - H - 8) + 'px';
}

function openPop(b) {
  const max = L.dayMinutes(b.day);
  const startV = h('span', { class: 'val' }), endV = h('span', { class: 'val' });
  const input = h('input', { type: 'text', value: b.title, autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Title' });
  input.addEventListener('input', () => { b.title = input.value; save(); renderGrid(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  const chips = L.CATS.map((c) => h('button', { class: 'chip', 'data-cat': c.id, style: `--c:${c.color}`, onclick: () => {
    if (!b.title.trim() || b.title === catOf(b.cat).name) { b.title = c.name; input.value = c.name; }
    b.cat = c.id; state.lastCat = c.id; save(); render(); sync();
  } }, h('span', { class: 'dot' }), c.name));
  const sync = () => {
    startV.textContent = fmtT(b.day, b.start);
    endV.textContent = `${fmtT(b.day, b.end)} · ${fmtH(b.end - b.start)}`;
    input.placeholder = catOf(b.cat).name;
    chips.forEach((ch) => ch.classList.toggle('sel', ch.dataset.cat === b.cat));
  };
  const shift = (field, delta) => {
    const nb = { ...b, [field]: b[field] + delta };
    if (nb.start < 0 || nb.end > max || nb.end - nb.start < L.STEP) return;
    if (L.overlaps(state.blocks, nb)) return toast('Overlaps another block');
    b[field] = nb[field]; save(); render(); sync();
  };
  const stepRow = (label, field, val) => h('div', { class: 'step' }, h('span', { class: 'lab' }, label),
    h('button', { 'aria-label': label + ' earlier', onclick: () => shift(field, -L.STEP) }, '−'), val,
    h('button', { 'aria-label': label + ' later', onclick: () => shift(field, L.STEP) }, '+'));
  const el = h('div', { class: 'pop', role: 'dialog', 'aria-label': 'Edit block' },
    input, h('div', { class: 'chips' }, chips),
    stepRow('Start', 'start', startV), stepRow('End', 'end', endV),
    h('div', { class: 'row' }, h('button', { class: 'danger', onclick: () => del(b) }, 'Delete'), h('button', { class: 'primary', onclick: closeOverlay }, 'Done')));
  sync();
  showOverlay(el, 'pop', b.id, false);
  renderGrid();
  position(el, b.id);
}

function del(b) {
  state.blocks = state.blocks.filter((x) => x !== b);
  save(); closeOverlay(); render();
  toast('Block deleted', 'Undo', () => {
    if (L.overlaps(state.blocks, b)) return toast('Can’t undo: that slot is now taken');
    state.blocks.push(b); save(); render();
  }, 5000);
}

function createAt(layer, y) {
  const max = L.dayMinutes(view), s = Math.floor(y / SLOT_PX) * L.STEP;
  if (s < 0 || s >= max) return;
  const cat = L.CATS.some((c) => c.id === state.lastCat) ? state.lastCat : 'job';
  const b = { id: uid(), day: view, start: s, end: Math.min(s + 30, max), layer, cat, title: catOf(cat).name, note: '', seq: 0 };
  if (L.overlaps(state.blocks, b)) b.end = s + L.STEP;
  if (L.overlaps(state.blocks, b)) return toast('That slot is taken');
  state.blocks.push(b); save(); render(); openPop(b);
}

// ---- Pointer: tap to create, drag to move/resize ----
let tap = null, drag = null;
for (const layer of ['plan', 'actual']) {
  cols[layer].addEventListener('pointerdown', (e) => {
    if (e.target !== cols[layer] || e.button > 0) return;
    tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), layer };
  });
}
function onBlockDown(e, b, el) {
  if (e.button > 0 || drag) return;
  e.stopPropagation();
  const mode = e.target.closest('.rh') ? 'resize' : 'move';
  drag = { b, el, mode, type: e.pointerType, id: e.pointerId, x0: e.clientX, y0: e.clientY, s0: scroller.scrollTop, active: false, moved: false, ns: b.start, ne: b.end, timer: 0 };
  if (mode === 'resize' || e.pointerType !== 'touch') activate();
  else drag.timer = setTimeout(activate, 250);
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
addEventListener('pointermove', (e) => {
  if (tap && e.pointerId === tap.id && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap = null;
  if (!drag || e.pointerId !== drag.id) return;
  const dy0 = e.clientY - drag.y0;
  if (!drag.active) { if (Math.hypot(e.clientX - drag.x0, dy0) > 8) endDrag(); return; }
  const r = scroller.getBoundingClientRect();
  if (e.clientY < r.top + 36) scroller.scrollTop -= 14;
  else if (e.clientY > r.bottom - 36) scroller.scrollTop += 14;
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
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; endDrag();
  if (!d.moved) return openPop(d.b);
  if (d.ns === d.b.start && d.ne === d.b.end) return renderGrid();
  if (L.overlaps(state.blocks, { ...d.b, start: d.ns, end: d.ne })) { toast('Overlaps another block'); return renderGrid(); }
  d.b.start = d.ns; d.b.end = d.ne; save(); render();
});
addEventListener('pointercancel', (e) => {
  if (tap && e.pointerId === tap.id) tap = null;
  if (drag && e.pointerId === drag.id) { const m = drag.moved; endDrag(); if (m) renderGrid(); }
});
// Block native scrolling while a drag is live (iOS ignores touch-action changes mid-gesture).
scroller.addEventListener('touchmove', (e) => { if (drag && (drag.active || drag.type !== 'touch')) e.preventDefault(); }, { passive: false });
grid.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- Timer ----
function stopTimer(endMs) {
  const t = state.timer;
  if (!t) return '';
  state.timer = null;
  const b = L.timerToBlock(t, endMs, state.blocks);
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
  const sync = () => { val.textContent = `${new Date(end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${fmtH(Math.round((end - t.startedAt) / 60000))}`; };
  const step = (d) => { const n = end + d * 60000; if (n < t.startedAt + L.STEP * 60000 || n > Date.now()) return; end = n; sync(); };
  const el = h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Long timer' },
    h('h3', {}, `${catOf(t.cat).name} timer has run ${fmtH(Math.floor((Date.now() - t.startedAt) / 60000))}`),
    h('p', { class: 'muted' }, 'Still going, or did it end earlier?'),
    h('div', { class: 'step' }, h('span', { class: 'lab' }, 'Ended'), h('button', { 'aria-label': 'Earlier', onclick: () => step(-L.STEP) }, '−'), val, h('button', { 'aria-label': 'Later', onclick: () => step(L.STEP) }, '+')),
    h('div', { class: 'row' },
      h('button', { onclick: () => { t.keep = true; save(); closeOverlay(); } }, 'Keep running'),
      h('button', { class: 'primary', onclick: () => { const m = stopTimer(end); closeOverlay(); render(); toast(m); } }, 'Stop at this time')));
  sync();
  showOverlay(el, 'sheet', null, true);
}

// ---- Copy, export, backup ----
function copyPlan() {
  let n = 0, skip = 0;
  for (const b of state.blocks.filter((x) => x.day === view && x.layer === 'plan')) {
    const nb = { ...b, id: uid(), layer: 'actual', seq: 0 };
    if (L.overlaps(state.blocks, nb)) skip++; else { state.blocks.push(nb); n++; }
  }
  save(); render();
  toast(n || skip ? `Copied ${n}${skip ? `, skipped ${skip} (overlap)` : ''}` : 'No plan blocks to copy');
}

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
  let scope = 'day', layer = 'plan', list = [], file, backup;
  const info = h('p', { class: 'muted' });
  const build = () => {
    const days = scope === 'day' ? [view] : Array.from({ length: 7 }, (_, i) => L.addDays(view, i));
    list = state.blocks.filter((b) => b.layer === layer && days.includes(b.day)).sort((a, b) => L.minToMs(a.day, a.start) - L.minToMs(b.day, b.start));
    file = new File([L.buildICS(list, { layer })], `daily-os-${layer}-${view}${scope === 'week' ? '-week' : ''}.ics`, { type: 'text/calendar' });
    backup = new File([JSON.stringify(state)], `daily-os-backup-${L.dayKeyOf(Date.now())}.json`, { type: 'application/json' });
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
  fileIn.addEventListener('change', () => restore(fileIn.files && fileIn.files[0]));
  const el = h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Export and backup' },
    h('h3', {}, 'Export to Calendar'),
    seg([['day', 'Day'], ['week', 'Week']], () => scope, (v) => { scope = v; }),
    seg([['plan', 'Plan'], ['actual', 'Actual']], () => layer, (v) => { layer = v; }),
    info,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: exportWith(deliver) }, 'Share .ics'), h('button', { onclick: exportWith(download) }, 'Download .ics')),
    h('p', { class: 'muted' }, 'Choose Calendar or Save to Files, then open the file and Add All. Use a dedicated “Daily OS” calendar so you can delete it in one step.'),
    h('hr'),
    h('h3', {}, 'Backup'),
    h('div', { class: 'row' }, h('button', { onclick: () => deliver(backup) }, 'Back up (JSON)'), h('button', { onclick: () => fileIn.click() }, 'Restore…')),
    fileIn,
    h('button', { onclick: closeOverlay }, 'Close'));
  build();
  showOverlay(el, 'sheet', null, true);
}

async function restore(f) {
  if (!f) return;
  let d;
  try { d = JSON.parse(await f.text()); } catch { return toast('Not a valid backup file'); }
  if (!L.validateData(d)) return toast(d && d.v !== 1 ? 'Unsupported backup version' : 'Backup failed validation');
  const prev = state;
  state = { ...fresh(), ...d };
  save(); closeOverlay(); render();
  toast(`Restored ${state.blocks.length} blocks`, 'Undo', () => { state = prev; save(); render(); }, 6000);
}

// ---- Wiring ----
const goto = (key) => { view = key; closeOverlay(); render(); scrollToDefault(); };
$('#prev').addEventListener('click', () => goto(L.addDays(view, -1)));
$('#next').addEventListener('click', () => goto(L.addDays(view, 1)));
$('#todayBtn').addEventListener('click', () => goto(L.dayKeyOf(Date.now())));
$('#copyBtn').addEventListener('click', copyPlan);
$('#menuBtn').addEventListener('click', openMenu);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !drag) { if (!overlay) render(); checkLongTimer(); } });

render();
requestAnimationFrame(scrollToDefault);
checkLongTimer();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
