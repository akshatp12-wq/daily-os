import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';
import * as S from '../sync.js';
import mock from './mockgh.cjs';

const CATS = L.DEFAULT_CATS;
const blk = (o) => ({ id: 'x', day: '2026-10-26', layer: 'plan', cat: 'work', title: 'Work', note: '', seq: 0, start: 0, end: 15, ...o });
const st = (o = {}) => ({ v: 2, cats: CATS.map((c) => ({ ...c })), blocks: [], timer: null, lastCat: 'work', lot: [], gapSkip: [], ...o });
const ids = (list) => list.map((x) => x.id).sort().join(',');

test('base64 and stable JSON', () => {
  const s = 'Ünïcödé 🚀 “quotes”';
  assert.equal(S.b64decode(S.b64encode(s)), s);
  assert.equal(S.stable({ b: 1, a: { d: 2, c: 3 } }), S.stable({ a: { c: 3, d: 2 }, b: 1 }));
});

test('sealed key opens only with the password', async () => {
  const sealed = await S.sealKey({ repo: 'me/data', token: 'github_pat_x' }, 'correct horse battery', 1000);
  const parsed = JSON.parse(sealed);
  assert.equal(parsed.kdf, 'PBKDF2-SHA256');
  assert.ok(!sealed.includes('github_pat_x') && !sealed.includes('me/data'));
  assert.deepEqual(await S.openKey(sealed, 'correct horse battery'), { repo: 'me/data', token: 'github_pat_x' });
  await assert.rejects(S.openKey(sealed, 'wrong password!!'), { message: 'wrong-password' });
  assert.equal((await S.sealKey({ a: 1 }, 'p'.repeat(12), 1000)) === sealed, false, 'random salt/iv');
  assert.ok(S.widgetKey({ repo: 'me/data', token: 't' }).startsWith('dos1:'));
  assert.deepEqual(JSON.parse(S.b64decode(S.widgetKey({ repo: 'me/data', token: 't', api: 'http://x/gh' }).slice(5))), { repo: 'me/data', token: 't', api: 'http://x/gh' });
});

test('split into month files and join back', () => {
  const s = st({ blocks: [blk({ id: 'a' }), blk({ id: 'b', day: '2026-11-02' }), blk({ id: 'c', day: '2026-10-31', start: 60, end: 75 })], lot: [{ id: 'l', text: 't', min: 15, at: 1 }] });
  const f = S.split(s);
  assert.deepEqual(Object.keys(f).sort(), ['blocks-2026-10.json', 'blocks-2026-11.json', 'meta.json']);
  assert.equal(f['meta.json'].blocks, undefined);
  const j = S.join(f);
  assert.equal(ids(j.blocks), 'a,b,c');
  assert.equal(L.validateData(j), true);
  assert.equal(S.join({}), null);
  assert.equal(S.isDataFile('README.md'), false);
});

test('three-way merge by item', () => {
  const base = st({ blocks: [blk({ id: 'keep' }), blk({ id: 'editL', start: 15, end: 30 }), blk({ id: 'editR', start: 30, end: 45 }), blk({ id: 'delL', start: 45, end: 60 }), blk({ id: 'delR', start: 60, end: 75 }), blk({ id: 'both', start: 75, end: 90 })] });
  const local = JSON.parse(JSON.stringify(base)), remote = JSON.parse(JSON.stringify(base));
  local.blocks.find((b) => b.id === 'editL').title = 'L';
  remote.blocks.find((b) => b.id === 'editR').title = 'R';
  local.blocks = local.blocks.filter((b) => b.id !== 'delL');
  remote.blocks = remote.blocks.filter((b) => b.id !== 'delR');
  local.blocks.find((b) => b.id === 'both').title = 'local';
  remote.blocks.find((b) => b.id === 'both').title = 'remote';
  local.blocks.push(blk({ id: 'newL', start: 120, end: 135 }));
  remote.blocks.push(blk({ id: 'newR', start: 150, end: 165 }));
  const m = S.merge3(base, local, remote);
  const by = Object.fromEntries(m.blocks.map((b) => [b.id, b.title]));
  assert.equal(ids(m.blocks), 'both,editL,editR,keep,newL,newR');
  assert.deepEqual([by.editL, by.editR, by.both], ['L', 'R', 'local']);
  // timer: started elsewhere, untouched here -> remote; stopped here -> local
  assert.deepEqual(S.merge3(base, base, { ...base, timer: { cat: 'work', startedAt: 5 } }).timer, { cat: 'work', startedAt: 5 });
  assert.equal(S.merge3({ ...base, timer: { cat: 'work', startedAt: 5 } }, base, { ...base, timer: { cat: 'work', startedAt: 5 } }).timer, null);
  // no base: union
  assert.equal(ids(S.merge3(null, st({ blocks: [blk({ id: 'a' })] }), st({ blocks: [blk({ id: 'b', start: 30, end: 45 })] })).blocks), 'a,b');
  assert.equal(ids(S.merge3(null, st({ blocks: [blk({ id: 'a' })] }), null).blocks), 'a');
});

test('merge keeps category order and gap skips sensibly', () => {
  const base = st({ gapSkip: ['d|1|2', 'd|3|4'] });
  const local = st({ cats: [...base.cats].reverse(), gapSkip: ['d|1|2', 'd|3|4', 'd|5|6'] });
  const remote = st({ cats: [...base.cats, { id: 'c1', name: 'Gym', color: '#0891b2', drift: false }], gapSkip: ['d|1|2'] });
  const m = S.merge3(base, local, remote);
  assert.deepEqual(m.cats.map((c) => c.id), ['drift', 'life', 'self', 'career', 'work', 'c1']);
  assert.deepEqual(m.gapSkip.sort(), ['d|1|2', 'd|5|6']);
  assert.deepEqual(S.merge3(base, base, remote).cats.map((c) => c.id), ['work', 'career', 'self', 'life', 'drift', 'c1']);
});

test('fixup repairs merged data and parses widget tasks', () => {
  const d = st({ cats: CATS.filter((c) => c.id !== 'life'), lastCat: 'life', timer: { cat: 'life', startedAt: 1 },
    blocks: [blk({ id: 'a', cat: 'life', title: '' })],
    lot: [{ id: 'w1', text: 'call franchise 15 mins #Career', min: 30, at: 1, raw: true }, { id: 'w2', text: 'email lender', min: 30, at: 2, raw: true }, { id: 'l3', text: 'x', min: 15, at: 3, cat: 'life' }] });
  const f = S.fixup(d);
  assert.equal(L.validateData(f), true);
  assert.deepEqual([f.blocks[0].cat, f.blocks[0].title, f.timer, f.lastCat], ['work', 'Work', null, 'work']);
  assert.deepEqual(f.lot[0], { id: 'w1', text: 'call franchise', min: 15, at: 1, cat: 'career' });
  assert.deepEqual(f.lot[1], { id: 'w2', text: 'email lender', min: 30, at: 2, timed: false });
  assert.equal('cat' in f.lot[2], false);
  assert.equal(S.fixup(st({ cats: [] })).cats.length, 5);
});

test('two devices sync through GitHub', async () => {
  const repo = mock.createRepo();
  const realFetch = globalThis.fetch;
  globalThis.fetch = repo.fetch;
  const dev = (name, initial) => {
    const d = { state: initial, base: null, status: [], applied: 0 };
    d.sync = S.engine({ repo: repo.repo, token: repo.token, api: 'http://mock/gh' }, {
      getState: () => d.state, applyState: (n) => { d.state = n; d.applied++; }, isBusy: () => false,
      onStatus: (s, msg) => d.status.push(msg ? `${s}:${msg}` : s), loadBase: () => d.base, saveBase: (b) => { d.base = b; },
      askFirst: async () => 'merge',
    }, name);
    return d;
  };
  try {
    const ipad = dev('iPad', st({ blocks: [blk({ id: 'p1' }), blk({ id: 'n1', day: '2026-11-03' })] }));
    await ipad.sync.run();
    assert.equal(ipad.status.at(-1), 'ok');
    assert.deepEqual([...repo.files.keys()].sort(), ['blocks-2026-10.json', 'blocks-2026-11.json', 'meta.json']);
    const phone = dev('iPhone', st({ blocks: [blk({ id: 'ph', start: 300, end: 330, layer: 'actual', cat: 'drift', title: 'Drift' })] }));
    await phone.sync.run();
    assert.equal(ids(phone.state.blocks), 'n1,p1,ph', 'phone gets iPad data and keeps its own');
    await ipad.sync.run();
    assert.equal(ids(ipad.state.blocks), 'n1,p1,ph', 'iPad gets the phone block');
    // edits on both sides merge; a delete on one side sticks
    ipad.state = { ...ipad.state, blocks: ipad.state.blocks.map((b) => (b.id === 'p1' ? { ...b, title: 'Deck turn' } : b)) };
    phone.state = { ...phone.state, blocks: phone.state.blocks.filter((b) => b.id !== 'n1'), timer: { cat: 'work', startedAt: 99 } };
    await phone.sync.run(); await ipad.sync.run(); await phone.sync.run();
    for (const d of [ipad, phone]) {
      assert.equal(ids(d.state.blocks), 'p1,ph');
      assert.equal(d.state.blocks.find((b) => b.id === 'p1').title, 'Deck turn');
      assert.deepEqual(d.state.timer, { cat: 'work', startedAt: 99 });
    }
    assert.deepEqual(repo.read('blocks-2026-11.json'), { blocks: [] }, 'emptied month written, not left stale');
    // only changed files are fetched
    const g0 = repo.state.gets;
    await ipad.sync.run();
    assert.equal(repo.state.gets, g0, 'nothing changed -> no file downloads');
    // a write from elsewhere between read and write -> retry and merge
    repo.state.beforePut = () => { const m = repo.read('meta.json'); m.lot.push({ id: 'w', text: 'from widget 20 min #Life', min: 30, at: 5, raw: true }); repo.write('meta.json', m); };
    ipad.state = { ...ipad.state, lot: [{ id: 'mine', text: 'mine', min: 15, at: 4 }] };
    await ipad.sync.run();
    assert.equal(ipad.status.at(-1), 'ok');
    assert.deepEqual(ipad.state.lot.map((x) => [x.id, x.text, x.min, x.cat]).sort(), [['mine', 'mine', 15, undefined], ['w', 'from widget', 30, 'life']]);
    assert.equal(repo.read('meta.json').lot.some((x) => x.raw), false, 'widget task parsed and written back');
    // a rejected token is reported, data untouched
    const bad = dev('x', st());
    bad.sync.stop();
    const b2 = S.engine({ repo: repo.repo, token: 'nope', api: 'http://mock/gh' }, { getState: () => bad.state, applyState: () => assert.fail(), isBusy: () => false, onStatus: (s) => bad.status.push(s), loadBase: () => null, saveBase: () => assert.fail() });
    await b2.run();
    assert.equal(bad.status.at(-1), 'auth');
    // first sync on a device that already has data can replace it with the synced copy
    const fresh = dev('new', st({ blocks: [blk({ id: 'junk', start: 600, end: 615 })] }));
    fresh.sync.stop();
    const f2 = S.engine({ repo: repo.repo, token: repo.token, api: 'http://mock/gh' }, { getState: () => fresh.state, applyState: (n) => { fresh.state = n; }, isBusy: () => false, onStatus: () => {}, loadBase: () => fresh.base, saveBase: (b) => { fresh.base = b; }, askFirst: async (n) => { assert.equal(n, 1); return 'remote'; } });
    await f2.run();
    assert.equal(ids(fresh.state.blocks), 'p1,ph');
    for (const d of [ipad, phone]) d.sync.stop();
    f2.stop(); b2.stop();
  } finally { globalThis.fetch = realFetch; }
});
