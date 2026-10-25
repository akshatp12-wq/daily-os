// Sync for Daily OS: data lives in a private GitHub repo, one file per month plus meta.json.
// Devices unlock a password-sealed access key. Edits merge item by item (three-way, by id).
import * as L from './logic.js';

// ---- Encoding ----
const enc = new TextEncoder(), dec = new TextDecoder();
const bytesToB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToBytes = (b64) => Uint8Array.from(atob(String(b64).replace(/\s/g, '')), (c) => c.charCodeAt(0));
export const b64encode = (str) => bytesToB64(enc.encode(str));
export const b64decode = (b64) => dec.decode(b64ToBytes(b64));
// JSON with sorted keys, so equal data always compares equal.
export const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const same = (a, b) => stable(a) === stable(b);

// ---- Password-sealed access key (PBKDF2-SHA256 -> AES-GCM-256) ----
export const MIN_PASSWORD = 12;
async function keyFrom(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealKey(secret, password, iterations = 600000) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(password, salt, iterations), enc.encode(JSON.stringify(secret)));
  return JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', it: iterations, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) });
}
// Throws Error('wrong-password') when the password doesn't match.
export async function openKey(sealed, password) {
  const s = typeof sealed === 'string' ? JSON.parse(sealed) : sealed;
  if (!s || s.v !== 1 || !s.ct) throw new Error('bad-key');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(s.iv) }, await keyFrom(password, b64ToBytes(s.salt), s.it), b64ToBytes(s.ct));
    return JSON.parse(dec.decode(pt));
  } catch { throw new Error('wrong-password'); }
}
// Widget key: repo + token for the Scriptable widget.
export const widgetKey = (cfg) => 'dos1:' + b64encode(JSON.stringify({ repo: cfg.repo, token: cfg.token, ...(cfg.api && cfg.api !== GH ? { api: cfg.api } : {}) }));

// ---- Files: meta.json + blocks-YYYY-MM.json ----
export const isDataFile = (name) => name === 'meta.json' || /^blocks-\d{4}-\d{2}\.json$/.test(name);
export function split(s) {
  const files = { 'meta.json': { v: 2, cats: s.cats, timer: s.timer, lastCat: s.lastCat, lot: s.lot, gapSkip: s.gapSkip } };
  for (const b of s.blocks) (files[`blocks-${b.day.slice(0, 7)}.json`] ||= { blocks: [] }).blocks.push(b);
  return files;
}
export function join(files) {
  const names = Object.keys(files).filter(isDataFile);
  if (!names.length) return null;
  const m = files['meta.json'] || {};
  const blocks = names.filter((n) => n !== 'meta.json').sort().flatMap((n) => (files[n] && files[n].blocks) || []);
  return { v: 2, cats: m.cats || L.DEFAULT_CATS.map((c) => ({ ...c })), timer: m.timer ?? null, lastCat: m.lastCat, lot: m.lot || [], gapSkip: m.gapSkip || [], blocks };
}

// ---- Three-way merge (base = last synced copy). Local wins a true conflict. ----
const EMPTY = { cats: [], blocks: [], lot: [], gapSkip: [], timer: null, lastCat: undefined };
const pick = (b, l, r) => (same(l, b) ? r : same(r, b) ? l : l);
function mergeById(B = [], Lc = [], R = []) {
  const mb = new Map(B.map((x) => [x.id, x])), ml = new Map(Lc.map((x) => [x.id, x])), mr = new Map(R.map((x) => [x.id, x]));
  const ids = [...new Set([...R.map((x) => x.id), ...Lc.map((x) => x.id), ...B.map((x) => x.id)])];
  return ids.map((id) => pick(mb.get(id), ml.get(id), mr.get(id))).filter((x) => x !== undefined);
}
export function merge3(base, local, remote) {
  const b = base || EMPTY, r = remote || EMPTY;
  let cats = mergeById(b.cats, local.cats, r.cats);
  // Order: whoever reordered since the last sync decides; new ids keep their place at the end.
  const order = (list) => (list || []).map((c) => c.id);
  const lead = same(order(local.cats), order(b.cats)) ? order(r.cats) : order(local.cats);
  cats = [...lead.map((id) => cats.find((c) => c.id === id)).filter(Boolean), ...cats.filter((c) => !lead.includes(c.id))];
  const bs = new Set(b.gapSkip), ls = new Set(local.gapSkip), rs = new Set(r.gapSkip);
  const gapSkip = [...new Set([...ls, ...rs])].filter((s) => !(bs.has(s) && (!ls.has(s) || !rs.has(s))));
  return {
    v: 2, cats, gapSkip,
    blocks: mergeById(b.blocks, local.blocks, r.blocks),
    lot: mergeById(b.lot, local.lot, r.lot),
    timer: pick(b.timer ?? null, local.timer ?? null, r.timer ?? null) ?? null,
    lastCat: pick(b.lastCat, local.lastCat, r.lastCat),
  };
}
// Make merged data valid again (a category deleted on one device, tasks added from the widget, ...).
export function fixup(d) {
  const cats = d.cats.length ? d.cats.slice(0, L.MAX_CATS) : L.DEFAULT_CATS.map((c) => ({ ...c }));
  const ids = new Set(cats.map((c) => c.id)), first = cats[0];
  const blocks = d.blocks.map((x) => (ids.has(x.cat) ? x : { ...x, cat: first.id, title: x.title || first.name }));
  const lot = d.lot.map((x) => {
    let y = x;
    if (y.raw) { // added by the widget as plain text; parse it here
      const p = L.parseTask(y.text, cats), { raw, ...rest } = y;
      y = { ...rest, text: p.text || String(y.text).slice(0, 200), min: p.min };
      if (!p.timed) y.timed = false;
      if (p.cat) y.cat = p.cat;
    }
    if (y.cat != null && !ids.has(y.cat)) { const { cat, ...rest } = y; y = rest; }
    return y;
  });
  return { ...d, v: 2, cats, blocks, lot, gapSkip: [...new Set(d.gapSkip)],
    timer: d.timer && ids.has(d.timer.cat) ? d.timer : null,
    lastCat: ids.has(d.lastCat) ? d.lastCat : first.id };
}

// ---- GitHub Contents API ----
export const GH = 'https://api.github.com';
export class SyncError extends Error { constructor(kind, msg) { super(msg || kind); this.kind = kind; } }
export function client({ repo, token, api = GH }) {
  const url = (path) => `${api}/repos/${repo}/contents/${path}`;
  const call = async (path, opts = {}) => {
    let res;
    try {
      res = await fetch(url(path), { cache: 'no-store', ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
    } catch { throw new SyncError('offline'); }
    if (res.status === 401) throw new SyncError('auth', 'The access token was rejected or has expired');
    return res;
  };
  return {
    // [{ name, sha }] of data files; [] for an empty repo. Throws 'repo' if it can't be reached.
    async list() {
      const res = await call('');
      if (res.status === 404) {
        const j = await res.json().catch(() => ({}));
        if (/empty/i.test(j.message || '')) return [];
        throw new SyncError('repo', 'Repository not found, or the token can’t access it');
      }
      if (res.status === 403) throw new SyncError('repo', 'The token doesn’t have access to this repository');
      if (!res.ok) throw new SyncError('error', `GitHub error ${res.status}`);
      const j = await res.json();
      return Array.isArray(j) ? j.filter((f) => f.type === 'file' && isDataFile(f.name)).map((f) => ({ name: f.name, sha: f.sha })) : [];
    },
    async get(name) {
      const res = await call(name);
      if (!res.ok) throw new SyncError('error', `Couldn’t read ${name} (${res.status})`);
      const j = await res.json();
      return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
    },
    // Returns the new sha, or null when someone else wrote first (retry).
    async put(name, data, sha, message) {
      const res = await call(name, { method: 'PUT', body: JSON.stringify({ message, content: b64encode(JSON.stringify(data)), ...(sha ? { sha } : {}) }) });
      if (res.status === 409 || res.status === 422) return null;
      if (res.status === 403) throw new SyncError('repo', 'The token can’t write to this repository (needs Contents: Read and write)');
      if (!res.ok) throw new SyncError('error', `Couldn’t save ${name} (${res.status})`);
      return (await res.json()).content.sha;
    },
  };
}

// ---- Engine ----
// hooks: getState(), applyState(next), isBusy(), onStatus(status, detail), loadBase(), saveBase(b), askFirst(localCount) -> 'merge' | 'remote'
export function engine(cfg, hooks, device = 'device') {
  const gh = client(cfg);
  let running = false, again = false, t = 0, stopped = false, lastOk = 0, firstChoice = null;
  const later = (ms) => { clearTimeout(t); if (!stopped) t = setTimeout(run, ms); };
  async function once() {
    const list = await gh.list();
    // An empty repo is a fresh start, never "everything was deleted elsewhere".
    const base = list.length ? hooks.loadBase() : null;
    const shas = Object.fromEntries(list.map((f) => [f.name, f.sha]));
    const baseFiles = base ? split(base.state) : {};
    const remoteFiles = {};
    for (const name of Object.keys(shas)) {
      remoteFiles[name] = base && base.shas[name] === shas[name] ? baseFiles[name] || { blocks: [] } : (await gh.get(name)).data;
    }
    const remote = join(remoteFiles);
    let local = JSON.parse(JSON.stringify(hooks.getState()));
    const start = stable(local);
    if (!base && remote && (local.blocks.length || local.lot.length) && hooks.askFirst) {
      firstChoice ||= await hooks.askFirst(local.blocks.length + local.lot.length); // ask once, even if we retry
      if (firstChoice === 'remote') local = remote;
    }
    const merged = fixup(merge3(base && base.state, local, remote));
    if (!L.validateData(merged)) throw new SyncError('error', 'Synced data didn’t pass validation; nothing was changed');
    const out = split(merged);
    for (const name of Object.keys(remoteFiles)) if (!out[name]) out[name] = name === 'meta.json' ? out[name] : { blocks: [] };
    const newShas = { ...shas };
    for (const [name, data] of Object.entries(out)) {
      if (remoteFiles[name] && same(remoteFiles[name], data)) continue;
      const sha = await gh.put(name, data, shas[name], `Sync from ${device}`);
      if (sha == null) return 'conflict';
      newShas[name] = sha;
    }
    if (hooks.isBusy()) return 'busy'; // remote has our changes; apply locally once the user is done
    const now = hooks.getState();
    const next = stable(now) === start ? merged : fixup(merge3(JSON.parse(start), now, merged));
    hooks.saveBase({ state: merged, shas: newShas });
    if (!same(next, now)) hooks.applyState(next);
    if (!same(next, merged)) again = true;
    return 'ok';
  }
  async function run() {
    if (stopped) return;
    if (running) { again = true; return; }
    if (hooks.isBusy()) return later(3000);
    running = true;
    hooks.onStatus('syncing');
    try {
      let r = 'conflict';
      for (let i = 0; i < 4 && r === 'conflict'; i++) r = await once();
      if (r === 'conflict') throw new SyncError('error', 'Another device kept saving at the same time');
      if (r === 'busy') later(3000);
      else { lastOk = Date.now(); hooks.onStatus('ok'); }
    } catch (e) {
      hooks.onStatus(e.kind || 'error', e.message);
    } finally {
      running = false;
      if (again) { again = false; later(1200); }
    }
  }
  return {
    run,
    touch: () => later(1500),
    stop: () => { stopped = true; clearTimeout(t); },
    get lastOk() { return lastOk; },
  };
}
