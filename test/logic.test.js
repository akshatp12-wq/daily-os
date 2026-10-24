import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

const at = (y, m, d, h, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const blk = (o) => ({ id: 'x', day: '2026-10-26', layer: 'plan', cat: 'work', title: '', note: '', seq: 0, start: 0, end: 15, ...o });

test('snap rounds to nearest 15', () => {
  assert.deepEqual([7, 8, 22, 23, 60].map(L.snap), [0, 15, 15, 30, 60]);
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
  assert.equal(L.timerToBlock(t, at(2026, 10, 26, 9, 15), []), null);
  const b = L.timerToBlock(t, at(2026, 10, 26, 9, 52), []);
  assert.deepEqual([b.day, b.start, b.end, b.layer, b.title], ['2026-10-26', 180, 225, 'actual', 'Work']);
  const a = (s, e) => blk({ id: 'o', layer: 'actual', start: s, end: e });
  assert.deepEqual(L.timerToBlock(t, at(2026, 10, 26, 9, 52), [a(210, 240)]).end, 210);
  assert.deepEqual(L.timerToBlock(t, at(2026, 10, 26, 9, 52), [a(165, 195)]).start, 195);
  assert.equal(L.timerToBlock(t, at(2026, 10, 26, 9, 52), [a(150, 240)]), null);
  const late = L.timerToBlock({ cat: 'drift', startedAt: at(2026, 10, 27, 5, 30) }, at(2026, 10, 27, 6, 40), []);
  assert.deepEqual([late.day, late.start, late.end], ['2026-10-26', 1410, 1440]);
});

test('capacity', () => {
  const list = [blk({ id: 'a', start: 0, end: 240 }), blk({ id: 'b', start: 300, end: 540 }), blk({ id: 'c', layer: 'actual', start: 0, end: 600 })];
  assert.equal(L.plannedMinutes(list, '2026-10-26'), 480);
  assert.equal(L.capacity(list, '2026-10-26'), 0.5);
});

test('ICS output', () => {
  const b = blk({ id: 'b1', start: 180, end: 240, title: 'Deal, model; v2\\x\nnext', seq: 2 });
  const ics = L.buildICS([b, blk({ id: 'b2', start: 300, end: 315, cat: 'self' })], { layer: 'plan', now: Date.UTC(2026, 9, 23, 12) });
  for (const s of ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daily OS//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Daily OS Plan',
    'UID:b1@dailyos', 'DTSTAMP:20261023T120000Z', 'DTSTART:20261026T140000Z', 'DTEND:20261026T150000Z', 'SEQUENCE:2',
    'SUMMARY:Deal\\, model\\; v2\\\\x\\nnext', 'CATEGORIES:Work', 'SUMMARY:Self', 'END:VCALENDAR'])
    assert.ok(ics.split('\r\n').includes(s), s);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 4);
  assert.equal(ics.match(/ACTION:DISPLAY/g).length, 4);
  assert.equal(ics.match(/^TRIGGER:PT0M$/gm).length, 2);
  assert.equal(ics.match(/^TRIGGER;RELATED=END:-PT5M\r?$/gm).length, 2);
  assert.ok(!/[^\r]\n/.test(ics), 'bare LF');
  assert.ok(L.buildICS([], { layer: 'actual' }).includes('X-WR-CALNAME:Daily OS Actual'));
});

test('ICS folding at 75 octets', () => {
  const long = 'Ünïcödé 🚀 '.repeat(30);
  const ics = L.buildICS([blk({ id: 'f', title: long })], { now: 0 });
  const enc = new TextEncoder();
  for (const line of ics.split('\r\n')) assert.ok(enc.encode(line).length <= 75, line);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:' + L.icsEscape(long)));
});

test('data validation', () => {
  assert.equal(L.validateData({ v: 1, blocks: [blk({})], timer: null }), true);
  assert.equal(L.validateData({ v: 2, blocks: [] }), false);
  assert.equal(L.validateData({ v: 1, blocks: [blk({ start: 7 })] }), false);
  assert.equal(L.validateData({ v: 1, blocks: [blk({ cat: 'nope' })] }), false);
  assert.equal(L.validateData({ v: 1, blocks: [], timer: { cat: 'work', startedAt: 'x' } }), false);
});
