import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

const at = (y, m, d, h, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const blk = (o) => ({ id: 'x', day: '2026-10-26', layer: 'plan', cat: 'work', title: '', note: '', seq: 0, start: 0, end: 15, ...o });
const CATS = L.DEFAULT_CATS;
const v2 = (o = {}) => ({ v: 2, cats: CATS.map((c) => ({ ...c })), blocks: [], timer: null, lastCat: 'work', lot: [], gapSkip: [], ...o });
let n = 0;
const nid = () => 'n' + ++n;

// ---- existing behavior ----
test('snap rounds to nearest 15', () => {
  assert.deepEqual([7, 8, 22, 23, 60].map(L.snap), [0, 15, 15, 30, 60]);
  assert.deepEqual([L.floor15(29), L.ceil15(16), L.ceil15(30)], [15, 30, 30]);
});

test('overlap check', () => {
  const list = [blk({ id: 'a', start: 60, end: 120 })];
  assert.equal(L.overlaps(list, blk({ id: 'b', start: 120, end: 150 })), false);
  assert.equal(L.overlaps(list, blk({ id: 'b', start: 45, end: 60 })), false);
  assert.equal(L.overlaps(list, blk({ id: 'b', start: 90, end: 135 })), true);
  assert.equal(L.overlaps(list, blk({ id: 'b', start: 90, end: 135, layer: 'actual' })), false);
  assert.equal(L.overlaps(list, blk({ id: 'a', start: 90, end: 135 })), false);
  assert.equal(L.overlaps(list, blk({ id: 'b', start: 90, end: 135, day: '2026-10-27' })), false);
});

test('current day key rolls over at 06:00', () => {
  assert.equal(L.dayKeyOf(at(2026, 10, 27, 2)), '2026-10-26');
  assert.equal(L.dayKeyOf(at(2026, 10, 27, 7)), '2026-10-27');
  assert.equal(L.dayKeyOf(at(2026, 10, 27, 6)), '2026-10-27');
  assert.equal(L.dayKeyOf(at(2027, 1, 1, 3)), '2026-12-31');
});

test('slot count follows DST', () => {
  assert.equal(L.slotCount('2026-10-26'), 96);
  assert.equal(L.slotCount('2026-10-31'), 100);
  assert.equal(L.slotCount('2027-03-13'), 92);
  assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
});

test('timer rounding and clamping', () => {
  const t = { cat: 'work', startedAt: at(2026, 10, 26, 9, 7) };
  assert.equal(L.timerToBlock(t, at(2026, 10, 26, 9, 15), [], CATS), null);
  const b = L.timerToBlock(t, at(2026, 10, 26, 9, 52), [], CATS);
  assert.deepEqual([b.day, b.start, b.end, b.layer, b.title], ['2026-10-26', 180, 225, 'actual', 'Work']);
  const a = (s, e) => blk({ id: 'o', layer: 'actual', start: s, end: e });
  assert.deepEqual(L.timerToBlock(t, at(2026, 10, 26, 9, 52), [a(210, 240)], CATS).end, 210);
  assert.deepEqual(L.timerToBlock(t, at(2026, 10, 26, 9, 52), [a(165, 195)], CATS).start, 195);
  assert.equal(L.timerToBlock(t, at(2026, 10, 26, 9, 52), [a(150, 240)], CATS), null);
  const late = L.timerToBlock({ cat: 'drift', startedAt: at(2026, 10, 27, 5, 30) }, at(2026, 10, 27, 6, 40), [], CATS);
  assert.deepEqual([late.day, late.start, late.end], ['2026-10-26', 1410, 1440]);
});

test('minutes totals', () => {
  const list = [blk({ id: 'a', start: 0, end: 240 }), blk({ id: 'b', start: 300, end: 540, cat: 'self' }), blk({ id: 'c', layer: 'actual', start: 0, end: 600 })];
  assert.equal(L.minutesOf(list, '2026-10-26', 'plan'), 480);
  assert.equal(L.minutesOf(list, '2026-10-26', 'plan', 'self'), 240);
  assert.equal(L.minutesOf(list, '2026-10-26', 'actual'), 600);
});

test('ICS output', () => {
  const b = blk({ id: 'b1', start: 180, end: 240, title: 'Deal, model; v2\\x\nnext', seq: 2 });
  const ics = L.buildICS([b, blk({ id: 'b2', start: 300, end: 315, cat: 'self' })], { layer: 'plan', now: Date.UTC(2026, 9, 23, 12), cats: CATS });
  for (const s of ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daily OS//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Daily OS Plan',
    'UID:b1@dailyos', 'DTSTAMP:20261023T120000Z', 'DTSTART:20261026T140000Z', 'DTEND:20261026T150000Z', 'SEQUENCE:2',
    'SUMMARY:Deal\\, model\\; v2\\\\x\\nnext', 'CATEGORIES:Work', 'SUMMARY:Self', 'END:VCALENDAR'])
    assert.ok(ics.split('\r\n').includes(s), s);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 4);
  assert.equal(ics.match(/^TRIGGER:PT0M$/gm).length, 2);
  assert.equal(ics.match(/^TRIGGER;RELATED=END:-PT5M\r?$/gm).length, 2);
  assert.ok(!/[^\r]\n/.test(ics), 'bare LF');
  assert.ok(L.buildICS([], { layer: 'actual' }).includes('X-WR-CALNAME:Daily OS Actual'));
  const custom = [{ id: 'c1', name: 'Satsang', color: '#0d9488', drift: false }];
  assert.ok(L.buildICS([blk({ id: 'z', cat: 'c1' })], { cats: custom }).includes('CATEGORIES:Satsang'));
});

test('ICS folding at 75 octets', () => {
  const long = 'Ünïcödé 🚀 '.repeat(30);
  const ics = L.buildICS([blk({ id: 'f', title: long })], { now: 0 });
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.ok(ics.replace(/\r\n /g, '').includes('SUMMARY:' + L.icsEscape(long)));
});

test('month grid and week', () => {
  const g = L.monthGrid(2026, 10);
  assert.equal(g.length, 42);
  assert.deepEqual([g[0].key, g[0].inMonth, g[4].key, g[4].inMonth, g[41].key], ['2026-09-27', false, '2026-10-01', true, '2026-11-07']);
  assert.equal(g.filter((c) => c.inMonth).length, 31);
  assert.equal(L.monthGrid(2027, 2).filter((c) => c.inMonth).length, 28);
  assert.deepEqual(L.weekDays('2026-10-23'), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
  assert.equal(L.weekDays('2026-11-01')[0], '2026-11-01');
});

test('merge blocks from another device', () => {
  const mine = [blk({ id: 'a', start: 60, end: 120 })];
  const theirs = [blk({ id: 'a', start: 0, end: 15 }), blk({ id: 'b', start: 90, end: 150 }), blk({ id: 'c', start: 120, end: 180 }), blk({ id: 'd', start: 150, end: 165 })];
  const r = L.mergeBlocks(mine, theirs);
  assert.deepEqual(r.added.map((b) => b.id), ['c']);
  assert.deepEqual([r.dup, r.clash], [1, 2]);
  assert.equal(mine.length, 1);
});

// ---- data v2 ----
test('migrate v1 -> v2', () => {
  const v1 = { v: 1, lastCat: 'dev', timer: { cat: 'job', startedAt: 1, keep: true }, blocks: [
    blk({ id: 'a', cat: 'job', title: 'Job' }), blk({ id: 'b', cat: 'admin', title: 'Expenses', start: 15, end: 30 }),
    blk({ id: 'c', cat: 'personal', title: 'Personal', start: 30, end: 45 }), blk({ id: 'd', cat: 'dev', title: 'Development', start: 45, end: 60 }),
    blk({ id: 'e', cat: 'career', title: 'Coffee chat', start: 60, end: 75 })] };
  const m = L.migrate(v1);
  assert.equal(L.validateData(m), true);
  assert.equal(m.v, 2);
  assert.deepEqual(m.blocks.map((b) => [b.cat, b.title]), [['work', 'Work'], ['life', 'Expenses'], ['life', 'Life'], ['self', 'Self'], ['career', 'Coffee chat']]);
  assert.deepEqual([m.lastCat, m.timer.cat, m.timer.keep], ['self', 'work', true]);
  assert.deepEqual([m.cats.map((c) => c.id), m.lot, m.gapSkip], [['work', 'career', 'self', 'life', 'drift'], [], []]);
  assert.equal(m.cats.find((c) => c.id === 'drift').drift, true);
  // v3 data (v:1 with current ids) and empty data
  assert.equal(L.validateData(L.migrate({ v: 1, blocks: [blk({ cat: 'drift' })], timer: null })), true);
  assert.equal(L.migrate({ v: 1, blocks: [] }).lastCat, 'work');
  const already = v2();
  assert.equal(L.migrate(already), already);
});

test('data validation v2', () => {
  assert.equal(L.validateData(v2({ blocks: [blk({})] })), true);
  assert.equal(L.validateData({ v: 1, blocks: [] }), false);
  assert.equal(L.validateData(v2({ blocks: [blk({ start: 7 })] })), false);
  assert.equal(L.validateData(v2({ blocks: [blk({ cat: 'nope' })] })), false);
  assert.equal(L.validateData(v2({ timer: { cat: 'work', startedAt: 'x' } })), false);
  assert.equal(L.validateData(v2({ cats: [{ id: 'a', name: 'A', color: 'blue', drift: false }] })), false);
  assert.equal(L.validateData(v2({ cats: Array.from({ length: 11 }, (_, i) => ({ id: 'c' + i, name: 'C' + i, color: '#111111', drift: false })) })), false);
  assert.equal(L.validateData(v2({ cats: [{ id: 'a', name: 'A', color: '#111111', drift: false }, { id: 'a', name: 'B', color: '#222222', drift: false }] })), false);
  assert.equal(L.validateData(v2({ cats: [] })), false);
  assert.equal(L.validateData(v2({ lot: [{ id: 'l', text: 'x', min: 20, at: 1 }] })), false);
  assert.equal(L.validateData(v2({ lot: [{ id: 'l', text: 'x', min: 5, at: 1 }] })), true);
  assert.equal(L.validateData(v2({ lot: [{ id: 'l', text: 'x', min: 30, at: 1, cat: 'life' }] })), true);
  assert.equal(L.validateData(v2({ lot: [{ id: 'l', text: 'x', min: 30, at: 1, cat: 'gone' }] })), false);
  assert.equal(L.validateData(v2({ gapSkip: undefined })), false);
});

test('rename and delete categories', () => {
  const d = v2({ lastCat: 'life', blocks: [blk({ id: 'a', cat: 'life', title: 'Life' }), blk({ id: 'b', cat: 'life', title: 'Laundry', start: 15, end: 30 }), blk({ id: 'c', cat: 'work', title: 'Life', start: 30, end: 45 })],
    lot: [{ id: 'l1', text: 'call', min: 15, at: 1, cat: 'life' }] });
  const r = L.renameCat(d, 'life', 'Home');
  assert.deepEqual(r.blocks.map((b) => b.title), ['Home', 'Laundry', 'Life']);
  assert.equal(r.cats.find((c) => c.id === 'life').name, 'Home');
  assert.equal(L.renameCat(d, 'life', '  '), d);
  const x = L.deleteCat(d, 'life', 'self');
  assert.equal(L.validateData(x), true);
  assert.deepEqual(x.blocks.map((b) => [b.cat, b.title]), [['self', 'Self'], ['self', 'Laundry'], ['work', 'Life']]);
  assert.deepEqual([x.cats.length, x.lastCat, 'cat' in x.lot[0]], [4, 'self', false]);
  const one = v2({ cats: [CATS[0]] });
  assert.equal(L.deleteCat(one, 'work', 'work'), one);
});

// ---- fire drill ----
test('reflow pushes the rest of today', () => {
  const day = '2026-10-26';
  const bs = [blk({ id: 'past', start: 60, end: 120 }), blk({ id: 'now', start: 120, end: 240, title: 'Model' }), blk({ id: 'next', start: 300, end: 360 }),
    blk({ id: 'late', start: 1380, end: 1410 }), blk({ id: 'act', layer: 'actual', start: 300, end: 360 }), blk({ id: 'other', day: '2026-10-27', start: 300, end: 360 })];
  const r = L.reflow(bs, day, 180, 60, nid);
  const by = Object.fromEntries(r.blocks.map((b) => [b.id, [b.start, b.end]]));
  assert.deepEqual(by.past, [60, 120]);
  assert.deepEqual(by.now, [120, 180]);
  assert.deepEqual(by.next, [360, 420]);
  assert.deepEqual([by.act, by.other], [[300, 360], [300, 360]]);
  assert.deepEqual([r.split.head.end, r.split.rest.start, r.split.rest.end], [180, 180, 240]);
  const tail = r.blocks.find((b) => b.id === r.split.rest.id);
  assert.deepEqual([tail.start, tail.end, tail.title], [240, 300, 'Model']);
  assert.deepEqual(r.overflow.map((b) => b.id), ['late']);
  assert.equal(r.blocks.some((b) => b.id === 'late'), false);
  for (const b of r.blocks) assert.equal(L.overlaps(r.blocks, b), false, b.id);
  // no split when cutoff is on a boundary; delta 0 is a no-op
  assert.equal(L.reflow(bs, day, 120, 30, nid).split, null);
  assert.deepEqual(L.reflow(bs, day, 180, 0, nid).blocks, bs);
  // remainder that no longer fits overflows instead of moving
  const big = L.reflow([blk({ id: 'z', start: 1380, end: 1440 })], day, 1410, 60, nid);
  assert.deepEqual([big.blocks[0].end, big.overflow[0].start, big.overflow[0].end], [1410, 1410, 1440]);
});

// ---- parking lot ----
test('parseTask durations', () => {
  const p = (s) => { const r = L.parseTask(s, CATS); return [r.text, r.min, r.timed]; };
  assert.deepEqual(p('call franchise 15 mins'), ['call franchise', 15, true]);
  assert.deepEqual(p('deck comments 1.5h'), ['deck comments', 90, true]);
  assert.deepEqual(p('1h30 LBO practice'), ['LBO practice', 90, true]);
  assert.deepEqual(p('model 1h 30m'), ['model', 90, true]);
  assert.deepEqual(p('prep 2 hours'), ['prep', 120, true]);
  assert.deepEqual(p('read 20 min'), ['read', 30, true]);
  assert.deepEqual(p('ping MD 5m'), ['ping MD', 5, true]);
  assert.deepEqual(p('text Sam 2 min'), ['text Sam', 5, true]);
  assert.deepEqual(p('sign form 7 min'), ['sign form', 10, true]);
  assert.deepEqual(p('email 12 min'), ['email', 15, true]);
  assert.deepEqual(p('email lender'), ['email lender', 30, false]);
  assert.deepEqual(p('review $5m model'), ['review $5m model', 30, false]);
  assert.deepEqual(p('5M deal'), ['5M deal', 30, false]);
  assert.deepEqual(p('order 5mm screws'), ['order 5mm screws', 30, false]);
  assert.deepEqual(p('gym for 1 hr'), ['gym', 60, true]);
  assert.deepEqual(p('call lender (45 min)'), ['call lender', 45, true]);
  assert.deepEqual(p('draft memo - 2h'), ['draft memo', 120, true]);
  assert.deepEqual(p('Q3 2h model'), ['Q3 model', 120, true]);
  assert.deepEqual(p('3pm call'), ['3pm call', 30, false]);
  assert.deepEqual(p('marathon 12 hours'), ['marathon', 480, true]);
  assert.deepEqual(p('a 15m then 45m'), ['a 15m then', 45, true]);
});

test('parseTask hashtags link to categories by name', () => {
  const cats = [...CATS, { id: 'c9', name: 'Deal Work', color: '#0d9488', drift: false }];
  const t = (s) => { const r = L.parseTask(s, cats); return [r.text, r.min, r.cat]; };
  assert.deepEqual(t('update resume 45 min #Career'), ['update resume', 45, 'career']);
  assert.deepEqual(t('#life call franchise 15 mins'), ['call franchise', 15, 'life']);
  assert.deepEqual(t('comps #DealWork 1h'), ['comps', 60, 'c9']);
  assert.deepEqual(t('#deal-work comps'), ['comps', 30, 'c9']);
  assert.deepEqual(t('ship it #launch'), ['ship it #launch', 30, null]);
  assert.deepEqual(t('#Self #Life read'), ['#Life read', 30, 'self']);
  assert.equal(L.parseTask('x#Career', cats).cat, null);
});

test('lot groups by duration', () => {
  const it = (id, min, at) => ({ id, text: id, min, at });
  const g = L.lotGroups([it('a', 90, 1), it('b', 30, 2), it('c', 45, 3), it('d', 75, 4), it('e', 15, 5), it('f', 30, 1), it('g', 480, 1)]);
  assert.deepEqual(g.quick.map((x) => x.id), ['e', 'f', 'b']);
  assert.deepEqual(g.medium.map((x) => x.id), ['c', 'd']);
  assert.deepEqual(g.long.map((x) => x.id), ['a', 'g']);
  const t = L.lotGroups([it('x', 10, 1), it('y', 5, 2), it('z', 15, 3)]);
  assert.deepEqual([t.tiny.map((x) => x.id), t.quick.map((x) => x.id)], [['y', 'x'], ['z']]);
});

test('task lengths under 15 min and their stepper', () => {
  assert.deepEqual([1, 5, 6, 10, 14, 15, 16, 500].map(L.taskMin), [5, 5, 10, 10, 15, 15, 30, 480]);
  assert.deepEqual([5, 10, 15, 30, 480].map(L.validTaskMin), [true, true, true, true, true]);
  assert.deepEqual([0, 7, 20, 495].map(L.validTaskMin), [false, false, false, false]);
  assert.deepEqual([L.stepTask(5, 1), L.stepTask(10, 1), L.stepTask(15, 1), L.stepTask(30, -1), L.stepTask(15, -1), L.stepTask(10, -1), L.stepTask(5, -1), L.stepTask(480, 1)], [10, 15, 30, 15, 10, 5, 5, 480]);
});

test('batch quick hits into one block', () => {
  const it = (id, text, min, cat) => ({ id, text, min, at: 1, ...(cat ? { cat } : {}) });
  const b = L.batchOf([it('a', 'call franchise', 10, 'life'), it('b', 'email lender', 5, 'life'), it('c', 'sign form', 5, 'life')]);
  assert.deepEqual([b.title, b.total, b.min, b.cat], ['Quick hits: call franchise, email lender, sign form', 20, 30, 'life']);
  assert.equal(b.note, '• call franchise (10m)\n• email lender (5m)\n• sign form (5m)');
  assert.equal(L.batchOf([it('a', 'x', 5, 'life'), it('b', 'y', 5)]).cat, null);
  assert.equal(L.batchOf([it('a', 'x', 5), it('b', 'y', 10)]).min, 15);
  const long = L.batchOf(Array.from({ length: 30 }, (_, i) => it('i' + i, 'task number ' + i, 5)));
  assert.ok(long.title.length <= 121 && long.title.endsWith('…'), long.title);
  assert.equal(long.min, 150);
});

// ---- gaps ----
test('findGaps', () => {
  const day = '2026-10-26', act = (id, s, e) => blk({ id, layer: 'actual', start: s, end: e });
  const bs = [act('a', 120, 180), act('b', 240, 255), act('c', 270, 300), blk({ id: 'p', start: 300, end: 600 })];
  const now = at(2026, 10, 26, 13, 7); // offset 427 -> floor 420
  assert.deepEqual(L.findGaps(bs, day, now, null), [[180, 240], [300, 420]]);
  assert.deepEqual(L.findGaps(bs, day, now, null, [`${day}|180|240`]), [[300, 420]]);
  assert.deepEqual(L.findGaps(bs, day, now, { cat: 'work', startedAt: at(2026, 10, 26, 11, 20) }), [[180, 240]]);
  assert.deepEqual(L.findGaps(bs, day, at(2026, 10, 28, 9), null), [[180, 240]]);
  assert.deepEqual(L.findGaps(bs, '2026-10-30', now, null), []);
  assert.deepEqual(L.findGaps([], day, now, null), []);
  assert.deepEqual(L.findGaps(bs, day, now, null, [], 15), [[180, 240], [255, 270], [300, 420]]);
  // DST fall-back day has 25h; gap at the end is still measured in local minutes
  const dst = '2026-10-31', late = [{ ...act('x', 1320, 1380), day: dst }, { ...act('y', 1440, 1500), day: dst }];
  assert.deepEqual(L.findGaps(late, dst, at(2026, 11, 2, 9), null), [[1380, 1440]]);
});

// ---- dashboard ----
test('daySummary and rollup', () => {
  const day = '2026-10-26';
  const bs = [blk({ id: 'p1', start: 180, end: 300, cat: 'work' }), blk({ id: 'p2', start: 300, end: 360, cat: 'self' }),
    blk({ id: 'a1', layer: 'actual', start: 180, end: 240, cat: 'work' }), blk({ id: 'a2', layer: 'actual', start: 240, end: 300, cat: 'drift' }),
    blk({ id: 'a3', layer: 'actual', start: 300, end: 360, cat: 'self' })];
  const past = L.daySummary(bs, day, CATS, at(2026, 10, 28, 9));
  assert.deepEqual([past.planTot, past.actTot, past.drift, past.wake, past.planned, past.matched], [180, 180, 60, 960, 12, 8]);
  assert.deepEqual([past.plan.work, past.actual.drift], [120, 60]);
  const today = L.daySummary(bs, day, CATS, at(2026, 10, 26, 10, 0)); // 4h after 06:00 -> 240
  assert.deepEqual([today.wake, today.planned, today.matched], [240, 4, 4]);
  const fut = L.daySummary(bs, day, CATS, at(2026, 10, 20, 9));
  assert.deepEqual([fut.future, fut.wake, fut.planned], [true, 0, 0]);
  const r = L.rollup([past, fut], CATS);
  assert.equal(r.coverage, 180 / 960);
  assert.equal(r.accuracy, 8 / 12);
  assert.equal(r.driftShare, 60 / 180);
  assert.equal(r.actual.work, 60);
  const empty = L.rollup([], CATS);
  assert.deepEqual([empty.coverage, empty.accuracy, empty.driftShare], [null, null, null]);
});
