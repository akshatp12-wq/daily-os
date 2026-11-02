import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../goals.js';

const blk = (o) => ({ id: Math.random().toString(36).slice(2), day: '2026-11-02', layer: 'actual', cat: 'career', title: 'Career', note: '', seq: 0, start: 0, end: 60, ...o });
const fresh = () => G.freshGoals('2026-11-02');

test('starter goals are valid, with fixed ids and the race date', () => {
  const d = fresh();
  assert.equal(G.validGoals(d), true);
  assert.deepEqual(d.goals.map((g) => g.id), ['hf', 'marathon', 'satsang', 'builder', 'hotel']);
  assert.deepEqual(d.goals.map((g) => g.status), ['active', 'active', 'active', 'someday', 'someday']);
  assert.equal(d.goals[1].date, '2027-10-10');
  assert.equal(JSON.stringify(fresh().goals), JSON.stringify(d.goals), 'two fresh devices agree');
});

test('goalOf: explicit link, explicit none, or words within the goal’s categories', () => {
  const gs = fresh().goals;
  assert.equal(G.goalOf(blk({ title: 'Industrials pitch draft' }), gs), 'hf');
  assert.equal(G.goalOf(blk({ title: 'Model comments', cat: 'work' }), gs), null, 'Work isn’t the hedge fund goal');
  assert.equal(G.goalOf(blk({ title: 'Pitch for the client', cat: 'work' }), gs), null, 'words only count in the goal’s categories');
  assert.equal(G.goalOf(blk({ title: 'Long run', cat: 'self' }), gs), 'marathon');
  assert.equal(G.goalOf(blk({ title: 'Running club', cat: 'self' }), gs), 'marathon', 'prefix match');
  assert.equal(G.goalOf(blk({ title: 'Brunch', cat: 'self' }), gs), null, 'not inside a word');
  assert.equal(G.goalOf(blk({ title: 'Ahnik', cat: 'life' }), gs), 'satsang');
  assert.equal(G.goalOf(blk({ title: 'Anything', goal: 'marathon' }), gs), 'marathon');
  assert.equal(G.goalOf(blk({ title: 'Long run', cat: 'self', goal: '' }), gs), null, 'explicit none wins');
  assert.equal(G.goalOf(blk({ title: 'x', goal: 'gone' }), gs), null, 'deleted goal');
  const paused = gs.map((g) => (g.id === 'marathon' ? { ...g, status: 'paused' } : g));
  assert.equal(G.goalOf(blk({ title: 'Long run', cat: 'self' }), paused), null, 'paused goals don’t auto-match');
  assert.equal(G.goalOf(blk({ title: 'Long run', goal: 'marathon' }), paused), 'marathon', 'but linked time still counts');
});

test('credits: actual only, check-ins, daily cap', () => {
  const d = fresh();
  d.checks.push({ id: 'c1', goal: 'satsang', practice: 'sat-p1', day: '2026-11-02', credit: 20 });
  const blocks = [blk({ title: 'Pitch work', end: 120 }), blk({ title: 'Pitch work', layer: 'plan', start: 120, end: 240 }), blk({ title: 'Long run', cat: 'self', start: 300, end: 450 }),
    blk({ title: 'Pitch', start: 600, end: 720, day: '2026-11-03' }), blk({ title: 'Pitch', day: '2026-10-01' })];
  const c = G.credits(d, blocks);
  const day = c.get('2026-11-02');
  assert.deepEqual(day.byGoal, { hf: 120, marathon: 150, satsang: 20 });
  assert.equal(day.raw, 290);
  assert.equal(day.counted, 240, 'at most 4h a day counts');
  assert.equal(c.get('2026-11-03').counted, 120);
  assert.equal(c.has('2026-10-01'), false, 'nothing from before goals started');
  assert.equal(G.goalWeek(c, 'hf', '2026-11-04'), 240);
});

test('periods, targets, deal weeks lower month and quarter too', () => {
  const d = fresh();
  assert.deepEqual(G.periodOf('week', '2026-11-04').days, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  assert.equal(G.periodOf('month', '2026-11-04').days.length, 30);
  const q = G.periodOf('quarter', '2026-11-04');
  assert.equal(q.key, '2026-10-01'); assert.equal(q.days.at(-1), '2026-12-31'); assert.equal(q.q, 4);
  assert.equal(G.periodTarget(d, 'week', '2026-11-04'), 480);
  assert.equal(G.periodTarget(d, 'month', '2026-11-04'), 1800);
  d.weekMode['2026-11-01'] = 'deal';
  assert.equal(G.periodTarget(d, 'week', '2026-11-04'), 120);
  assert.equal(G.periodTarget(d, 'month', '2026-11-20'), 1800 - 360);
  assert.equal(G.periodTarget(d, 'quarter', '2026-12-20'), 5400 - 360);
  d.weekMode['2026-11-08'] = 'light';
  assert.equal(G.periodTarget(d, 'month', '2026-11-20'), 1800 - 360 - 240);
  const c = G.credits(d, [blk({ title: 'pitch', end: 120 })]);
  const p = G.progress(d, c, 'week', '2026-11-04');
  assert.deepEqual([p.done, p.target, p.claim], [120, 120, null]);
  d.claims.push({ id: 'k', kind: 'week', key: '2026-11-01', text: 'Sushi' });
  assert.equal(G.progress(d, c, 'week', '2026-11-04').claim.text, 'Sushi');
  assert.equal(G.progress(d, c, 'week', '2026-11-09').claim, null, 'new week, new reward');
});

test('free time: earned per hour, bonuses, comeback double, spending forgiven below zero', () => {
  const d = fresh();
  d.start = '2026-09-01';
  const t = (day) => new Date(`${day}T12:00:00`).getTime();
  const blocks = [
    blk({ title: 'pitch', day: '2026-09-02', end: 120 }),                    // 2h -> 30m
    blk({ title: 'Drift', cat: 'drift', day: '2026-09-03', end: 120 }),       // spend 2h -> balance 0, not -90
    blk({ title: 'pitch', day: '2026-09-04', end: 240 }),                    // 4h -> 60m
    blk({ title: 'pitch', day: '2026-09-20', end: 120 }),                    // after 16 quiet days: 2h x2 -> 60m
  ];
  d.goals[0].steps[0] = { ...d.goals[0].steps[0], done: true, doneAt: t('2026-09-20') }; // +30
  const c = G.credits(d, blocks);
  const f = G.freeTime(d, c, blocks, {});
  assert.equal(f.balance, 60 + 60 + 30);
  assert.equal(f.comeback, '2026-09-20');
  assert.equal(f.spent, 120);
  const live = G.freeTime(d, c, blocks, { now: t('2026-09-21'), timer: { cat: 'drift', startedAt: t('2026-09-21') - 30 * 60000 } });
  assert.equal(live.balance, 120, 'a running fun timer counts down live');
  d.funCat = null;
  assert.equal(G.freeTime(d, c, blocks, {}).balance, 30 + 60 + 60 + 30, 'no fun category, nothing spent');
});

test('wishlist jar: counted hours minus bought items', () => {
  const d = fresh();
  const c = G.credits(d, [blk({ title: 'pitch', end: 240 }), blk({ title: 'pitch', day: '2026-11-03', end: 300 })]);
  assert.deepEqual(G.hoursJar(d, c), { total: 480, spent: 0, available: 480 });
  d.wish.push({ id: 'x', name: 'Book', hours: 3, bought: '2026-11-03' });
  assert.equal(G.hoursJar(d, c).available, 300);
});

test('marathon phases count back from race day', () => {
  const m = fresh().goals.find((g) => g.id === 'marathon');
  const p = (day) => { const r = G.phaseOf(m, day); return `${r.name}:${r.weeks}`; };
  assert.equal(p('2026-11-02'), 'Base:49');
  assert.equal(G.phaseOf(m, '2026-11-02').starts, '2027-06-06', '18-week block starts then');
  assert.equal(p('2027-06-06'), 'Build:18');
  assert.equal(p('2027-07-25'), 'Peak:11');
  assert.equal(p('2027-09-19'), 'Taper:3');
  assert.equal(G.phaseOf(m, '2027-10-10').left, 0);
  assert.equal(G.phaseOf(m, '2027-10-11').past, true);
  assert.equal(G.targetOf(m, '2027-08-01'), 420);
  assert.equal(G.targetOf(m, '2026-11-02'), 150);
  assert.equal(G.phaseOf(fresh().goals.find((g) => g.id === 'satsang'), '2026-11-02'), null);
});

test('shelf and journal hints', () => {
  const d = fresh();
  const s = G.shelf(d);
  assert.equal(s.length, 8, 'sessions of active goals only');
  assert.deepEqual(s[1], { id: 'goal:hf:1', text: 'Build the model', min: 60, cat: 'career', goal: 'hf', goalName: 'Hedge fund program', shelf: true, at: 0 });
  const c = G.credits(d, [blk({ title: 'pitch', end: 90 })]);
  const hn = G.hints(d, c, '2026-11-02');
  assert.deepEqual(hn.steps.map((x) => x.goal), ['Hedge fund program', 'Chicago Marathon', 'Satsang']);
  assert.deepEqual(hn.counted, [{ goal: 'Hedge fund program', min: 90 }]);
});

test('list parsers', () => {
  assert.deepEqual(G.parseLines('Long run 90 min\n\nEasy run 45m', []).map((x) => [x.name, x.min]), [['Long run', 90], ['Easy run', 45]]);
  assert.deepEqual(G.parseWish('Garmin watch 40h\nTrip - 120 hours\nShoes'), [{ name: 'Garmin watch', hours: 40 }, { name: 'Trip', hours: 120 }, { name: 'Shoes', hours: 10 }]);
  const ph = fresh().goals.find((g) => g.id === 'marathon').phases;
  assert.equal(G.phasesText(ph), 'Base 2.5h\nBuild 7w 5h\nPeak 8w 7h\nTaper 3w 4h');
  assert.deepEqual(G.parsePhases(G.phasesText(ph)), ph, 'round trip');
});

test('three-way merge for sync', () => {
  const base = fresh(); delete base.pristine;
  const local = JSON.parse(JSON.stringify(base)), remote = JSON.parse(JSON.stringify(base));
  local.goals[0].steps[0].done = true;                       // iPad finishes a step
  remote.goals[0].steps.push({ id: 'new', text: 'Read the 10-K', done: false }); // phone adds one
  remote.goals[0].why = 'Because I want to think for a living';
  local.goals[1].status = 'paused';
  remote.checks.push({ id: 'c', goal: 'satsang', practice: 'sat-p1', day: '2026-11-02', credit: 20 });
  local.rewards.week = 600; remote.rewards.menus.week = ['Sushi'];
  remote.weekMode['2026-11-01'] = 'deal';
  remote.goals = remote.goals.filter((g) => g.id !== 'hotel');
  const m = G.mergeGoals3(base, local, remote);
  assert.equal(G.validGoals(m), true);
  const hf = m.goals.find((g) => g.id === 'hf');
  assert.equal(hf.steps.find((s) => s.id === 'hf-s1').done, true);
  assert.ok(hf.steps.some((s) => s.id === 'new'));
  assert.equal(hf.why, 'Because I want to think for a living');
  assert.equal(m.goals.find((g) => g.id === 'marathon').status, 'paused');
  assert.equal(m.goals.some((g) => g.id === 'hotel'), false, 'deleted on the phone');
  assert.equal(m.checks.length, 1);
  assert.equal(m.rewards.week, 600);
  assert.deepEqual(m.rewards.menus.week, ['Sushi']);
  assert.equal(m.weekMode['2026-11-01'], 'deal');
  // A fresh device (starter goals only) takes the synced copy instead of fighting it.
  const phone = fresh();
  assert.equal(G.mergeGoals3(null, phone, m), m);
  assert.equal(G.mergeGoals3(null, local, null), local);
  assert.equal(G.validGoals({ ...m, goals: [{ id: 'x' }] }), false);
  assert.equal(G.validGoals({ ...m, v: 2 }), false);
});
