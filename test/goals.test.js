import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../goals.js';
import * as L from '../logic.js';

const blk = (o) => ({ id: Math.random().toString(36).slice(2), day: '2026-11-02', layer: 'actual', cat: 'career', title: 'Career', note: '', seq: 0, start: 0, end: 60, ...o });
const fresh = () => G.freshGoals('2026-11-01');
const WK = '2026-11-01';

test('starts with one example of each kind; old goals are replaced', () => {
  const d = fresh();
  assert.equal(G.validGoals(d), true);
  assert.deepEqual(d.goals.map((g) => [g.id, g.kind, g.example]), [['ex-job', 'milestone', true], ['ex-gym', 'habit', true]]);
  assert.equal(JSON.stringify(fresh()), JSON.stringify(d), 'two fresh devices agree');
  const old = { v: 2, start: '2026-10-26', goals: [{ id: 'hf' }], checks: [] };
  const m = G.migrateGoals(old);
  assert.equal(G.validGoals(m), true);
  assert.equal(m.start, '2026-10-26');
  assert.deepEqual(m.goals.map((g) => g.id), ['ex-job', 'ex-gym']);
  assert.equal(G.migrateGoals(d), d);
});

test('what counts: links, words in the goal’s categories, added time', () => {
  const d = fresh(), gs = d.goals;
  assert.equal(G.goalOf(blk({ title: 'Pitch work' }), gs), 'ex-job');
  assert.equal(G.goalOf(blk({ title: 'Model comments', cat: 'work' }), gs), null);
  assert.equal(G.goalOf(blk({ title: 'Gym', cat: 'self' }), gs), 'ex-gym');
  assert.equal(G.goalOf(blk({ title: 'Brunch', cat: 'self' }), gs), null);
  assert.equal(G.goalOf(blk({ title: 'Gym', cat: 'self', goal: '' }), gs), null);
  assert.equal(G.goalOf(blk({ title: 'x', goal: 'ex-gym' }), gs), 'ex-gym');
  d.adds.push({ id: 'a', goal: 'ex-gym', day: '2026-11-03', min: 30 });
  const c = G.credits(d, [blk({ title: 'Pitch', end: 120 }), blk({ title: 'Pitch', layer: 'plan', end: 120 }), blk({ title: 'Run', cat: 'self', day: '2026-11-04' })]);
  assert.equal(G.doneIn(c, 'ex-job', WK), 120);
  assert.equal(G.doneIn(c, 'ex-gym', WK), 90);
});

test('the week: usual hours, setup override, deal week, skips; reward when every goal’s hours are in', () => {
  const d = fresh(), job = d.goals[0], gym = d.goals[1];
  assert.equal(G.targetFor(d, job, WK), 360);
  d.weeks[WK] = { deal: true };
  assert.deepEqual([G.targetFor(d, job, WK), G.targetFor(d, gym, WK)], [90, 60]);
  d.weeks[WK] = { setup: true, reward: 'Sushi', hours: { 'ex-gym': 180 }, skips: [{ block: 'b1', goal: 'ex-gym', min: 60 }] };
  assert.deepEqual([G.targetFor(d, job, WK), G.targetFor(d, gym, WK)], [360, 120]);
  const c = G.credits(d, [blk({ title: 'Pitch', end: 600 }), blk({ title: 'Gym', cat: 'self', end: 60 })]);
  let w = G.week(d, c, WK);
  assert.deepEqual([w.done, w.target, w.hit, w.reward, w.setup], [420, 480, false, 'Sushi', true], 'extra job hours don’t cover the gym');
  const c2 = G.credits(d, [blk({ title: 'Pitch', end: 360 }), blk({ title: 'Gym', cat: 'self', end: 120 })]);
  w = G.week(d, c2, WK);
  assert.equal(w.hit, true);
  d.goals[1].status = 'inactive';
  assert.equal(G.week(d, c, WK).goals.length, 1, 'only active goals');
});

test('suggest a target you’ll hit after a short week', () => {
  assert.equal(G.suggest({ done: 60, target: 240 }), 90);
  assert.equal(G.suggest({ done: 200, target: 240 }), null, '80%+ is fine');
  assert.equal(G.suggest({ done: 0, target: 240 }), 30);
  assert.equal(G.suggest({ done: 0, target: 0 }), null);
});

test('missed sessions: past planned goal blocks this week with little logged, until handled', () => {
  const d = fresh(), now = new Date(2026, 10, 4, 13, 0).getTime(); // Wed 1pm
  const plan = (id, day, title, s, e) => blk({ id, day, layer: 'plan', cat: 'self', title, start: s, end: e });
  const blocks = [plan('mon', '2026-11-02', 'Gym', 60, 120), plan('tue', '2026-11-03', 'Gym', 60, 120), plan('wed', '2026-11-04', 'Gym', 60, 120),
    plan('late', '2026-11-04', 'Gym', 600, 660), plan('lastwk', '2026-10-30', 'Gym', 60, 120), plan('other', '2026-11-02', 'Reading', 0, 60),
    blk({ day: '2026-11-03', cat: 'self', title: 'Gym', start: 60, end: 120 })];
  assert.deepEqual(G.missed(d, blocks, now).map((m) => m.block.id), ['mon', 'wed']);
  d.weeks[WK] = { skips: [{ block: 'mon', goal: 'ex-gym', min: 60 }] };
  assert.deepEqual(G.missed(d, blocks, now).map((m) => m.block.id), ['wed']);
  void L;
});

test('milestones: current one, next task; shelf, hints, rough-day', () => {
  const d = fresh(), job = d.goals[0];
  assert.equal(G.currentMs(job).id, 'ex-job-m1');
  assert.equal(G.nextTask(G.currentMs(job)).text, 'Pick the sub-sector');
  job.milestones[0].done = true;
  assert.equal(G.nextTask(G.currentMs(job)).text, 'Choose the company');
  assert.equal(G.nextTask(null), null);
  assert.deepEqual(G.shelf(d).map((s) => s.text), ['Pitch work', 'Model a company', 'Strength', 'Run']);
  assert.deepEqual(G.hints(d, new Map([['2026-11-02', { 'ex-gym': 45 }]]), '2026-11-02'), { steps: [{ goal: 'Land a hedge fund role', text: 'Choose the company' }], counted: [{ goal: 'Gym', min: 45 }] });
  assert.equal(G.roughDay(d).length, 2);
  assert.deepEqual(G.parseLines('Long run 90 min\nStretch', []), [{ name: 'Long run', min: 90 }, { name: 'Stretch', min: 45 }]);
});

test('three-way merge for sync', () => {
  const base = fresh(); delete base.pristine;
  const local = JSON.parse(JSON.stringify(base)), remote = JSON.parse(JSON.stringify(base));
  local.goals[0].milestones[0].tasks[0].done = true;
  remote.goals[0].milestones[0].tasks.push({ id: 'n', text: 'Read 10-Ks', done: false });
  remote.goals[0].name = 'HF seat';
  local.goals[1].hours = 300;
  local.weeks[WK] = { setup: true, reward: 'Sushi' };
  remote.weeks[WK] = { deal: true };
  remote.adds.push({ id: 'a', goal: 'ex-gym', day: '2026-11-02', min: 30 });
  const m = G.mergeGoals3(base, local, remote);
  assert.equal(G.validGoals(m), true);
  const t = m.goals[0].milestones[0].tasks;
  assert.equal(t.find((x) => x.id === 'ex-job-t1').done, true);
  assert.ok(t.some((x) => x.id === 'n'));
  assert.deepEqual([m.goals[0].name, m.goals[1].hours], ['HF seat', 300]);
  assert.deepEqual(m.weeks[WK], { setup: true, reward: 'Sushi', deal: true });
  assert.equal(m.adds.length, 1);
  assert.equal(G.mergeGoals3(null, fresh(), m), m, 'a fresh device takes the synced copy');
  assert.equal(G.validGoals({ ...m, v: 2 }), false);
});
