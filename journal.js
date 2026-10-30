// To Myself — a daily Stoic journal inside Daily OS, after Marcus Aurelius's notes to himself.
// Lives only on this device (its own storage key, never synced). Export/Import keep it safe.
import * as L from './logic.js';

export const JKEY = 'dailyos.journal';
export const TAGS = [
  { id: 'idea', name: 'Idea', icon: '✦', color: '#9a8442' },
  { id: 'trigger', name: 'Trigger', icon: 'ϟ', color: '#a0644f' },
  { id: 'win', name: 'Win', icon: '★', color: '#5f7f5a' },
  { id: 'lesson', name: 'Lesson', icon: '❦', color: '#5a6f8f' },
  { id: 'task', name: 'Task', icon: '☐', color: '#7e6c8f' },
];
const TAG_IDS = TAGS.map((t) => t.id);
export const tagOf = (id) => TAGS.find((t) => t.id === id);

// Morning questions: the original three, then a new set every two weeks (10 alternatives).
// The third question is always the "one thing" — the only one that's ever needed.
export const BASE_Q = ['Today may test me with', 'Mine to control', 'One thing that matters'];
export const POOL = [
  ['What might push your buttons today?', 'What part of today is yours to steer?', 'If only one thing gets done, which one?'],
  ['Where could today get bumpy?', 'What will you choose, whatever happens?', 'What’s worth your best attention today?'],
  ['Who or what might try your patience?', 'What’s in your hands today?', 'What would make today worth it?'],
  ['What could pull you off course?', 'Where does your effort actually count today?', 'Name the one thing that matters most.'],
  ['What’s likely to feel hard today?', 'What response will you own?', 'What single thing moves today forward?'],
  ['What might you be tempted to rush or avoid?', 'What can you decide now, before the day decides for you?', 'One thing you’ll be glad you did:'],
  ['What obstacle might turn out to be the way?', 'What will you bring to it?', 'The one thing for today:'],
  ['What would a calm version of you expect today?', 'What’s yours to do, and what isn’t?', 'What deserves your first good hour?'],
  ['What might drain you today?', 'What choice or boundary is up to you?', 'If today were one sentence, what’s the one thing in it?'],
  ['What would you brace for, if you were wise about today?', 'What’s within your control, and nothing else?', 'If you do nothing else, what one thing matters?'],
];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayNum = (key) => { const [y, m, d] = L.parseKey(key); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
export const freshJournal = (today) => ({ v: 1, start: today, days: {}, frags: [] });
export function questionsFor(j, key) {
  const i = Math.floor(Math.max(0, daysBetween(j.start || key, key)) / 14) % (POOL.length + 1);
  return i === 0 ? BASE_Q : POOL[i - 1];
}

// ---- Days ----
export const FIELDS = ['m1', 'm2', 'm3', 'well', 'next', 'letgo', 'note'];
const filled = (v) => typeof v === 'string' && !!v.trim();
export const dayActive = (j, key) => FIELDS.some((f) => filled(j.days[key] && j.days[key][f])) || j.frags.some((f) => f.day === key);
// After 2+ empty days, today opens with "Welcome back" and only the one-thing question.
export function welcomeBack(j, today) {
  if (dayActive(j, today)) return false;
  const past = [...new Set([...Object.keys(j.days), ...j.frags.map((f) => f.day)])].filter((k) => k < today && dayActive(j, k)).sort();
  return past.length > 0 && daysBetween(past.at(-1), today) >= 3;
}

// ---- Fragments and tags ----
// "#idea", "#wins" … in the text become tags.
export function parseTags(raw) {
  const tags = new Set();
  const text = String(raw).replace(/(^|\s)#(ideas?|triggers?|wins?|lessons?|tasks?)\b/gi, (m, lead, t) => { tags.add(t.toLowerCase().replace(/s$/, '')); return lead; })
    .replace(/\s+/g, ' ').trim();
  return { text, tags: [...tags] };
}

// ---- Book of lessons: notes to self + tagged fragments, newest first, by month ----
export const FILTERS = [['all', 'All'], ['lesson', 'Lessons'], ['idea', 'Ideas'], ['win', 'Wins'], ['trigger', 'Triggers']];
export function bookEntries(j, filter = 'all') {
  const out = [];
  for (const [day, d] of Object.entries(j.days)) if (filled(d.note)) out.push({ kind: 'note', id: `note:${day}`, day, at: L.dayStart(day) + 20 * 3600e3, text: d.note.trim(), tags: ['lesson'] });
  for (const f of j.frags) { const t = f.tags.filter((x) => x !== 'task'); if (t.length) out.push({ kind: 'frag', id: f.id, day: f.day, at: f.at, text: f.text, tags: t }); }
  const list = (filter === 'all' ? out : out.filter((e) => e.tags.includes(filter))).sort((a, b) => b.at - a.at);
  const months = [];
  for (const e of list) {
    let g = months.at(-1);
    if (!g || g.month !== e.day.slice(0, 7)) months.push((g = { month: e.day.slice(0, 7), items: [] }));
    g.items.push(e);
  }
  return months;
}
// One past lesson to reread this morning; the same one all day.
export function pastLesson(j, today) {
  const all = bookEntries(j, 'lesson').flatMap((g) => g.items).filter((e) => e.day < today);
  if (!all.length) return null;
  let n = 0;
  for (const c of today) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return all[n % all.length];
}
export const tasksOut = (j) => j.frags.filter((f) => f.tags.includes('task')).sort((a, b) => (a.moved ? 1 : 0) - (b.moved ? 1 : 0) || b.at - a.at);

// ---- Export / import ----
const longDate = (key) => { const [y, m, d] = L.parseKey(key); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); };
const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/ /g, ' ');
export function toMarkdown(j) {
  const keys = [...new Set([...Object.keys(j.days), ...j.frags.map((f) => f.day)])].filter((k) => dayActive(j, k)).sort();
  const out = ['# To Myself', ''];
  for (const k of keys) {
    const d = j.days[k] || {}, q = d.q || questionsFor(j, k), frs = j.frags.filter((f) => f.day === k).sort((a, b) => a.at - b.at);
    out.push(`## ${longDate(k)}`, '');
    const morning = [['m1', q[0]], ['m2', q[1]], ['m3', q[2]]].filter(([f]) => filled(d[f]));
    if (morning.length) out.push('**Morning**', ...morning.map(([f, label]) => `- ${label.replace(/[:?.]$/, '')}: ${d[f].trim()}`), '');
    if (frs.length) out.push('**Through the day**', ...frs.map((f) => `- ${clock(f.at)} — ${f.text}${f.tags.length ? '  ' + f.tags.map((t) => `#${t}`).join(' ') : ''}`), '');
    const evening = [['well', 'Went well'], ['next', 'Next time'], ['letgo', 'Letting go']].filter(([f]) => filled(d[f]));
    if (evening.length) out.push('**Evening**', ...evening.map(([f, label]) => `- ${label}: ${d[f].trim()}`), '');
    if (filled(d.note)) out.push(`> ${d.note.trim()}`, '');
  }
  return out.join('\n');
}
export function validJournal(d) {
  return !!d && d.v === 1 && !!d.days && typeof d.days === 'object' && !Array.isArray(d.days) && Array.isArray(d.frags) &&
    Object.entries(d.days).every(([k, v]) => DAY_RE.test(k) && !!v && typeof v === 'object') &&
    d.frags.every((f) => !!f && typeof f.id === 'string' && DAY_RE.test(f.day) && typeof f.text === 'string' && Number.isFinite(f.at) && Array.isArray(f.tags));
}
// Import never overwrites: new entries are added, empty answers get filled.
export function mergeJournal(mine, theirs) {
  const ids = new Set(mine.frags.map((f) => f.id));
  const add = theirs.frags.filter((f) => !ids.has(f.id)).map((f) => ({ ...f, tags: f.tags.filter((t) => TAG_IDS.includes(t)) }));
  const days = { ...mine.days };
  let answers = 0;
  for (const [k, d] of Object.entries(theirs.days)) {
    const cur = { ...(days[k] || {}) };
    for (const f of FIELDS) if (filled(d[f]) && !filled(cur[f])) { cur[f] = d[f]; answers++; }
    if (Array.isArray(d.q) && !cur.q) cur.q = d.q;
    days[k] = cur;
  }
  const start = [mine.start, theirs.start].filter((s) => DAY_RE.test(s || '')).sort()[0] || mine.start;
  return { data: { ...mine, start, days, frags: [...mine.frags, ...add] }, added: add.length, answers };
}

// ---- UI ----
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const MIC = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>';

export function createJournal(ctx) {
  const { h, toast, showOverlay, closeOverlay, addToLot, deliver, copyText } = ctx;
  const root = document.getElementById('journal');
  const today = () => L.dayKeyOf(Date.now());
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  let j = load(), view = 'today', filter = 'all', welcomed = false, saveT = 0, rec = null;
  function load() {
    try { const d = JSON.parse(localStorage.getItem(JKEY)); if (validJournal(d)) return d; } catch {}
    return freshJournal(today());
  }
  const save = () => { clearTimeout(saveT); try { localStorage.setItem(JKEY, JSON.stringify(j)); } catch { toast('Couldn’t save just now. Your words are still on screen.'); } };
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 300); };
  const rec_ = (k) => (j.days[k] ||= {});
  const short = (key) => { const [y, m, d] = L.parseKey(key); return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
  const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' }); };
  const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const icons = (tags) => tags.map((t) => { const g = tagOf(t); return g ? h('span', { class: 'ji', style: `--t:${g.color}`, title: g.name }, g.icon) : null; });

  // ---- Quick capture (always at the top): type, then Save — or mic, then Save ----
  const input = h('input', { type: 'text', id: 'jIn', placeholder: 'Capture a thought…', autocomplete: 'off', enterkeyhint: 'done', maxlength: '500', 'aria-label': 'Quick capture' });
  const pick = new Set();
  const tagBtns = TAGS.map((t) => h('button', { type: 'button', class: 'jtag', 'data-tag': t.id, style: `--t:${t.color}`, 'aria-pressed': 'false', onclick: () => { pick.has(t.id) ? pick.delete(t.id) : pick.add(t.id); paintTags(); } }, h('span', { class: 'ji' }, t.icon), t.name));
  const paintTags = () => tagBtns.forEach((b) => { const on = pick.has(b.dataset.tag); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  const tagRow = h('div', { class: 'jtags', hidden: true }, h('span', { class: 'jl' }, 'Tag (optional)'), tagBtns);
  const mic = SR ? h('button', { type: 'button', class: 'jmic', 'aria-label': 'Speak instead of typing', onclick: listen }) : null;
  if (mic) mic.innerHTML = MIC;
  const form = h('form', { class: 'jcap', autocomplete: 'off', onsubmit: (e) => { e.preventDefault(); capture(); } }, input, mic, h('button', { type: 'submit', class: 'jsave' }, 'Save'));
  input.addEventListener('input', () => { tagRow.hidden = !input.value.trim(); });
  function capture() {
    const p = parseTags(input.value);
    if (!p.text) { input.focus(); return; }
    const tags = [...new Set([...p.tags, ...pick])];
    j.frags.push({ id: uid(), day: today(), at: Date.now(), text: p.text.slice(0, 500), tags });
    save();
    input.value = ''; pick.clear(); paintTags(); tagRow.hidden = true; input.blur();
    toast(tags.includes('task') ? 'Saved. It’s waiting in Tasks out too.' : 'Saved.');
    render();
  }
  function listen() {
    if (rec) { rec.stop(); return; }
    try {
      rec = new SR();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      const base = input.value.trim() ? input.value.trim() + ' ' : '';
      rec.onresult = (e) => { let s = ''; for (const r of e.results) s += r[0].transcript; input.value = base + s; tagRow.hidden = !input.value.trim(); };
      rec.onerror = (e) => toast(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'The microphone is off for this app. The keyboard’s mic works too.' : 'Didn’t quite catch that. Try again, or type it.');
      rec.onend = () => { rec = null; mic.classList.remove('on'); };
      mic.classList.add('on');
      rec.start();
    } catch { rec = null; mic.classList.remove('on'); toast('Voice isn’t available here. The keyboard’s mic works too.'); }
  }

  const nav = h('div', { class: 'jnav', role: 'tablist' });
  const body = h('div', { class: 'jbody' });
  const foot = h('div', { class: 'jfoot' }, h('button', { class: 'jlink', onclick: openIO }, 'Export or import'), h('p', {}, 'Your journal stays on this device. It isn’t synced.'));
  root.replaceChildren(h('div', { class: 'jtop' }, form, tagRow, nav), body, foot);

  // ---- Fields: answers save as you type ----
  function field(label, key, { hint, main } = {}) {
    const ta = h('textarea', { rows: '1', class: 'jfield' + (main ? ' main' : ''), 'aria-label': label, 'data-f': key });
    ta.value = (j.days[today()] || {})[key] || '';
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.addEventListener('input', () => { const r = rec_(today()); r[key] = ta.value; if (key[0] === 'm' && !r.q) r.q = questionsFor(j, today()); grow(); saveSoon(); });
    ta.addEventListener('blur', save);
    requestAnimationFrame(grow);
    return h('label', { class: 'jq' + (main ? ' main' : '') }, h('span', { class: 'jl' }, label, hint ? h('em', {}, ` · ${hint}`) : null), ta);
  }
  const section = (title, sub, ...kids) => h('section', { class: 'jsec' }, h('h3', {}, title, sub ? h('span', {}, sub) : null), ...kids);

  function fragEl(f) {
    return h('li', { class: 'jfrag', 'data-jid': f.id, onclick: () => editFrag(f) },
      h('time', {}, time(f.at)), h('span', { class: 'jt' }, f.text), h('span', { class: 'jicons' }, icons(f.tags)));
  }

  function renderToday() {
    const t = today(), d = j.days[t] || {}, q = d.q || questionsFor(j, t);
    if (!welcomed && welcomeBack(j, t)) {
      return [h('div', { class: 'jwelcome' },
        h('h2', {}, 'Welcome back.'),
        h('p', {}, 'No catching up. Just one thing for today.'),
        field(q[2], 'm3', { main: true }),
        h('button', { class: 'jbtn', onclick: () => { save(); welcomed = true; render(); } }, 'Done'))];
    }
    const frs = j.frags.filter((f) => f.day === t).sort((a, b) => a.at - b.at);
    const lesson = pastLesson(j, t);
    const note = h('input', { type: 'text', class: 'jnote', placeholder: 'You…', maxlength: '280', 'aria-label': 'Note to self', value: d.note || '' });
    note.addEventListener('focus', () => { if (!note.value) note.value = 'You '; });
    note.addEventListener('blur', () => { if (note.value.trim() === 'You') { note.value = ''; rec_(t).note = ''; } save(); });
    note.addEventListener('input', () => { rec_(t).note = note.value; saveSoon(); });
    note.addEventListener('keydown', (e) => { if (e.key === 'Enter') note.blur(); });
    return [
      h('p', { class: 'jdate' }, short(t)),
      section('Morning', 'about 2 minutes',
        field(q[0], 'm1', { hint: 'optional' }),
        field(q[1], 'm2', { hint: 'optional' }),
        lesson ? h('blockquote', { class: 'jreread' }, h('span', { class: 'jl' }, 'From your book'), h('p', {}, lesson.text), h('cite', {}, short(lesson.day))) : null,
        field(q[2], 'm3', { main: true })),
      section('Through the day', null,
        frs.length ? h('ul', { class: 'jfrags' }, frs.map(fragEl)) : null,
        h('p', { class: 'jhint' }, frs.length ? 'That’s a whole day. Anything more is a bonus.' : 'Use the bar above whenever something comes up. One line is a whole day.')),
      section('Evening', 'about 3 minutes', field('Went well', 'well'), field('Next time', 'next'), field('Letting go', 'letgo')),
      section('Note to self', 'goes into your Book of lessons', note),
    ];
  }

  function renderBook() {
    const chips = h('div', { class: 'jchips' }, FILTERS.map(([id, label]) => h('button', { class: 'jchip' + (filter === id ? ' on' : ''), 'aria-pressed': filter === id ? 'true' : 'false', onclick: () => { filter = id; render(); } },
      id === 'all' ? null : h('span', { class: 'ji', style: `--t:${tagOf(id).color}` }, tagOf(id).icon), label)));
    const months = bookEntries(j, filter);
    if (!months.length) return [chips, h('p', { class: 'jempty' }, filter === 'all'
      ? 'Your notes to self, and anything tagged ❦ lesson, ✦ idea, ★ win or ϟ trigger, collect here on their own.'
      : `Nothing tagged ${tagOf(filter).name.toLowerCase()} yet. It’ll show up here when you tag one.`)];
    return [chips, ...months.map((g) => h('section', { class: 'jmonth' }, h('h3', {}, monthName(g.month)),
      h('ul', { class: 'jbook' }, g.items.map((e) => h('li', { class: 'jentry' + (e.kind === 'note' ? ' note' : ''), 'data-jid': e.id, onclick: () => (e.kind === 'note' ? editNote(e.day) : editFrag(j.frags.find((f) => f.id === e.id))) },
        h('span', { class: 'jicons' }, icons(e.tags)), h('p', {}, e.text), h('time', {}, short(e.day)))))))];
  }

  function renderTasks() {
    const list = tasksOut(j);
    if (!list.length) return [h('p', { class: 'jempty' }, 'Nothing waiting. Tag a capture ☐ task and it lands here, so to-dos don’t get buried in the journal.')];
    return [h('ul', { class: 'jtasks' }, list.map((f) => {
      const box = h('input', { type: 'checkbox', checked: !!f.moved, 'aria-label': `Moved: ${f.text}` });
      box.addEventListener('change', () => { f.moved = box.checked; save(); render(); });
      return h('li', { class: 'jtask' + (f.moved ? ' moved' : ''), 'data-jid': f.id },
        h('div', { class: 'jtt' }, h('p', {}, f.text), h('time', {}, `${short(f.day)} · ${time(f.at)}`)),
        h('div', { class: 'jta' },
          h('button', { class: 'jbtn sm', onclick: () => copyText(f.text, 'Copied.') }, 'Copy'),
          f.moved ? null : h('button', { class: 'jbtn sm', onclick: () => { addToLot(f.text); f.moved = true; save(); render(); toast('Added to your Parking lot.'); } }, 'To Parking lot'),
          h('label', { class: 'jmoved' }, box, 'Moved')));
    }))];
  }

  function render() {
    nav.replaceChildren(...[['today', 'Today'], ['book', 'Book of lessons'], ['tasks', 'Tasks out']].map(([id, label]) =>
      h('button', { class: 'jtab' + (view === id ? ' on' : ''), role: 'tab', 'aria-selected': view === id ? 'true' : 'false', 'data-view': id, onclick: () => { view = id; render(); root.scrollTop = 0; } }, label)));
    body.replaceChildren(...(view === 'book' ? renderBook() : view === 'tasks' ? renderTasks() : renderToday()).filter(Boolean));
  }

  // ---- Editing ----
  function tagToggles(f, onChange) {
    return h('div', { class: 'jchips' }, TAGS.map((t) => {
      const b = h('button', { class: 'jtag' + (f.tags.includes(t.id) ? ' on' : ''), 'data-tag': t.id, style: `--t:${t.color}`, 'aria-pressed': f.tags.includes(t.id) ? 'true' : 'false', onclick: () => {
        f.tags = f.tags.includes(t.id) ? f.tags.filter((x) => x !== t.id) : [...f.tags, t.id];
        b.classList.toggle('on'); b.setAttribute('aria-pressed', f.tags.includes(t.id) ? 'true' : 'false'); onChange();
      } }, h('span', { class: 'ji' }, t.icon), t.name);
      return b;
    }));
  }
  function editFrag(f) {
    if (!f) return;
    const ta = h('textarea', { rows: '3', class: 'jfield', 'aria-label': 'Fragment' });
    ta.value = f.text;
    ta.addEventListener('input', () => { if (ta.value.trim()) { f.text = ta.value.trim().slice(0, 500); saveSoon(); } });
    const el = h('div', { class: 'pop jpop', role: 'dialog', 'aria-label': 'Edit entry' },
      h('time', { class: 'jl' }, `${short(f.day)} · ${time(f.at)}`), ta, tagToggles(f, () => { save(); render(); }),
      h('div', { class: 'row' },
        h('button', { onclick: () => {
          j.frags = j.frags.filter((x) => x !== f); save(); closeOverlay(); render();
          toast('Removed.', 'Undo', () => { j.frags.push(f); save(); render(); }, 5000);
        } }, 'Remove'),
        h('button', { class: 'primary', onclick: () => { save(); closeOverlay(); render(); } }, 'Done')));
    showOverlay(el, 'jitem', `#journal [data-jid="${CSS.escape(f.id)}"]`, false);
  }
  function editNote(day) {
    const ta = h('textarea', { rows: '2', class: 'jfield', 'aria-label': 'Note to self' });
    ta.value = (j.days[day] || {}).note || '';
    ta.addEventListener('input', () => { rec_(day).note = ta.value; saveSoon(); });
    showOverlay(h('div', { class: 'pop jpop', role: 'dialog', 'aria-label': 'Edit note' },
      h('time', { class: 'jl' }, `Note to self · ${short(day)}`), ta,
      h('button', { class: 'primary', onclick: () => { save(); closeOverlay(); render(); } }, 'Done')), 'jitem', `#journal [data-jid="${CSS.escape('note:' + day)}"]`, false);
  }

  // ---- Export / import ----
  function openIO() {
    const stamp = today();
    const fileIn = h('input', { type: 'file', accept: '.json,application/json' });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      let d;
      try { d = JSON.parse(await f.text()); } catch { return toast('That file isn’t a To Myself export.'); }
      if (!validJournal(d)) return toast('That file isn’t a To Myself export.');
      const before = j, r = mergeJournal(j, d);
      j = r.data; save(); closeOverlay(); render();
      toast(r.added || r.answers ? `Brought in ${r.added} entr${r.added === 1 ? 'y' : 'ies'} and ${r.answers} answer${r.answers === 1 ? '' : 's'}. Nothing was overwritten.` : 'Everything in that file was already here.',
        r.added || r.answers ? 'Undo' : '', r.added || r.answers ? () => { j = before; save(); render(); } : null, 7000);
    });
    showOverlay(h('div', { class: 'pop sheet center', role: 'dialog', 'aria-label': 'Export or import' },
      h('h3', {}, 'Keep your journal safe'),
      h('p', { class: 'muted' }, 'Your journal lives only on this device. Export a copy now and then, and save it somewhere you trust.'),
      h('div', { class: 'row' },
        h('button', { onclick: () => deliver(new File([JSON.stringify(j)], `to-myself-${stamp}.json`, { type: 'application/json' })) }, 'Export JSON'),
        h('button', { onclick: () => deliver(new File([toMarkdown(j)], `to-myself-${stamp}.md`, { type: 'text/markdown' })) }, 'Export Markdown')),
      h('button', { onclick: () => fileIn.click() }, 'Import JSON…'),
      h('p', { class: 'muted' }, 'Importing only adds what’s missing. It never overwrites anything here.'),
      fileIn,
      h('button', { class: 'primary', onclick: closeOverlay }, 'Done')), 'jio', null, true);
  }

  return { render, focusCapture: () => input.focus() };
}
