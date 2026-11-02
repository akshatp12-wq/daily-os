import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../goals.js';

const blk = (o) => ({ id: Math.random().toString(36).slice(2), day: '2026-11-02', layer: 'actual', cat: 'career', title: 'Career', note: '', seq: 0, start: 0, end: 60, ...o });
const fresh = () => G.freshGoals('2026-11-02');

test('starter goals: valid, fixed ids, hedge fund + HYROX + Satsang active', () => {
  const d = fresh();
  assert.equal(G.validGoals(d), true);
  assert.deepEqual(d.goals.map((g) => g.id), ['hf', 'fitness', 'satsang', 'builder', 'hotel']);
  assert.deepEqual(d.goals.map((g) => g.status), ['active', 'active', 'active', 'inactive', 'inactive']);
  assert.equal(d.goals.some((g) => /marathon/i.test(g.name)), false);
  const fit = d.goals[1];
  assert.equal(fit.date, '2027-05-27');
  assert.ok(fit.milestones.some((m) => m.date === '2027-02-11' && /Chicago/.test(m.text)), 'benchmark race');
  assert.ok(fit.milestones.every((m) => !('reward' in m) || m.reward), 'tangible rewards on milestones');
  assert.equal(d.goals[0].target, 720);
  assert.equal(JSON.stringify(fresh().goals), JSON.stringify(d.goals), 'two fresh devices agree');
});

test('v1 data migrates: marathon gone, HYROX added, hedge fund reworked, your edits kept', () => {
  const v1 = { v: 1, start: '2026-11-01', funCat: 'drift', weekMode: {}, claims: [], wish: [{ id: 'w-watch', name: 'GPS running watch', hours: 40 }, { id: 'w-trip', name: 'A weekend trip', hours: 120 }],
    rewards: { week: 480, weekDeal: 120, weekLight: 240, month: 1800, quarter: 5400, rate: 20, dayCap: 240, stepBonus: 30, milestoneBonus: 60, menus: { week: ['Sushi'], month: [], quarter: [] } },
    checks: [{ id: 'c1', goal: 'marathon', practice: 'x', day: '2026-11-02', credit: 30 }, { id: 'c2', goal: 'satsang', practice: 'sat-p1', day: '2026-11-02', credit: 20 }],
    goals: [
      { id: 'hf', name: 'Hedge fund program', why: 'Think for a living', floor: '', shape: 'project', status: 'active', date: '2027-03-31', cats: ['career'], words: [], target: 240, phases: [], sessions: [],
        steps: [{ id: 'hf-s1', text: 'Pick the first company', done: true, doneAt: 1 }, { id: 'u1', text: 'Screen industrials', done: false }],
        milestones: [{ id: 'hf-m1', text: 'Pitch #1', date: '', done: true, doneAt: 1 }, { id: 'hf-m2', text: 'Pitch #2', date: '', done: false }], practices: [] },
      { id: 'marathon', name: 'Chicago Marathon', why: '', floor: '', shape: 'event', status: 'active', date: '2027-10-10', cats: ['self'], words: [], target: 150, phases: [], sessions: [], steps: [], milestones: [], practices: [] },
      { id: 'satsang', name: 'Satsang', why: '', floor: '', shape: 'practice', status: 'active', date: '', cats: ['self'], words: [], target: 150, phases: [], sessions: [], steps: [], milestones: [], practices: [] },
      { id: 'hotel', name: 'Hotel exit', why: '', floor: '', shape: 'project', status: 'someday', date: '', cats: [], words: [], target: 180, phases: [], sessions: [], steps: [], milestones: [], practices: [] },
    ] };
  const d = G.migrateGoals(v1);
  assert.equal(G.validGoals(d), true);
  assert.deepEqual(d.goals.map((g) => [g.id, g.status]), [['hf', 'active'], ['fitness', 'active'], ['satsang', 'active'], ['hotel', 'inactive']]);
  const hf = d.goals[0];
  assert.equal(hf.why, 'Think for a living');
  assert.equal(hf.name, 'Hedge fund seat');
  assert.equal(G.nextStep(hf).text, 'Screen industrials', 'your own next step stays next');
  assert.ok(hf.steps.some((s) => s.id === 'hf-s1' && s.done), 'finished steps kept');
  assert.ok(hf.milestones.some((m) => m.id === 'hf-m1' && m.done) && !hf.milestones.some((m) => m.id === 'hf-m2'));
  assert.deepEqual(d.checks.map((c) => c.id), ['c2']);
  assert.deepEqual(d.rewards, { rate: 20, dayCap: 240, stepBonus: 30, milestoneBonus: 60, menus: { week: ['Sushi'], month: [], quarter: [] } });
  assert.deepEqual(d.wish.map((w) => w.id), ['w-trip']);
  assert.deepEqual(G.migrateGoals(v1), d, 'deterministic');
  assert.equal(G.migrateGoals(d), d, 'v2 untouched');
});

test('goalOf: explicit link, explicit none, or words within the goal’s categories', () => {
  const gs = fresh().goals;
  assert.equal(G.goalOf(blk({ title: 'Industrials pitch draft' }), gs), 'hf');
  assert.equal(G.goalOf(blk({ title: 'Model comments', cat: 'work' }), gs), null, 'Work isn’t the hedge fund goal');
  assert.equal(G.goalOf(blk({ title: 'Model a coverage name' }), gs), 'hf');
  assert.equal(G.goalOf(blk({ title: 'Strength A (squat, bench, row)', cat: 'self' }), gs), 'fitness');
  assert.equal(G.goalOf(blk({ title: 'Running club', cat: 'self' }), gs), 'fitness', 'prefix match');
  assert.equal(G.goalOf(blk({ title: 'Brunch tomorrow', cat: 'self' }), gs), null, 'not inside a word');
  assert.equal(G.goalOf(blk({ title: 'Ahnik', cat: 'life' }), gs), 'satsang');
  assert.equal(G.goalOf(blk({ title: 'Anything', goal: 'fitness' }), gs), 'fitness');
  assert.equal(G.goalOf(blk({ title: 'Easy run', cat: 'self', goal: '' }), gs), null, 'explicit none wins');
  assert.equal(G.goalOf(blk({ title: 'x', goal: 'gone' }), gs), null, 'deleted goal');
  const off = gs.map((g) => (g.id === 'fitness' ? { ...g, status: 'inactive' } : g));
  assert.equal(G.goalOf(blk({ title: 'Easy run', cat: 'self' }), off), null, 'inactive goals don’t auto-match');
  assert.equal(G.goalOf(blk({ title: 'Easy run', goal: 'fitness' }), off), 'fitness', 'but linked time still counts');
});

test('credits: actual only, check-ins and added time, daily cap', () => {
  const d = fresh();
  d.checks.push({ id: 'c1', goal: 'satsang', practice: 'sat-p1', day: '2026-11-02', credit: 20 }, { id: 'c2', goal: 'hf', practice: 'manual', day: '2026-11-03', credit: 30 });
  const blocks = [blk({ title: 'Pitch work', end: 120 }), blk({ title: 'Pitch work', layer: 'plan', start: 120, end: 240 }), blk({ title: 'Easy run', cat: 'self', start: 300, end: 450 }),
    blk({ title: 'Pitch', start: 600, end: 720, day: '2026-11-03' }), blk({ title: 'Pitch', day: '2026-10-01' })];
  const c = G.credits(d, blocks);
  const day = c.get('2026-11-02');
  assert.deepEqual(day.byGoal, { hf: 120, fitness: 150, satsang: 20 });
  assert.equal(day.counted, 240, 'at most 4h a day counts');
  assert.equal(c.get('2026-11-03').counted, 150);
  assert.equal(c.has('2026-10-01'), false, 'nothing from before goals started');
  assert.equal(G.goalWeek(c, 'hf', '2026-11-04'), 270);
});

test('weekly hours per goal; the week’s target is their sum; deal weeks drop everything to a quarter', () => {
  const d = fresh(), day = '2026-11-04';
  assert.deepEqual(G.weekBars(d, new Map(), day).map((b) => [b.id, b.target]), [['hf', 720], ['fitness', 270], ['satsang', 150]]);
  assert.equal(G.weekTarget(d, day), 1140);
  d.goals[2].status = 'inactive';
  assert.equal(G.weekTarget(d, day), 990, 'only active goals');
  d.goals[2].status = 'active';
  d.weekMode['2026-11-01'] = 'deal';
  assert.deepEqual(G.weekBars(d, new Map(), day).map((b) => b.target), [180, 75, 45]);
  assert.equal(G.periodTarget(d, 'week', day), 300);
  assert.equal(G.periodTarget(d, 'week', '2026-11-09'), 1140, 'next week is normal');
  assert.equal(G.periodOf('month', day).days.length, 30);
  const q = G.periodOf('quarter', day);
  assert.equal(q.key, '2026-10-01'); assert.equal(q.days.at(-1), '2026-12-31'); assert.equal(q.q, 4);
  delete d.weekMode['2026-11-01'];
  assert.equal(G.periodTarget(d, 'month', day), Math.round((1140 * 30) / 7 / 15) * 15, 'month = the weekly hours spread over its days');
  const c = G.credits(d, [blk({ title: 'pitch', end: 120 })]);
  d.claims.push({ id: 'k', kind: 'week', key: '2026-11-01', text: 'Sushi' });
  assert.equal(G.progress(d, c, 'week', day).claim.text, 'Sushi');
  assert.equal(G.progress(d, c, 'week', '2026-11-09').claim, null, 'new week, new reward');
});

test('phases: weekly hours follow the phase', () => {
  const f = fresh().goals.find((g) => g.id === 'fitness');
  const p = (day) => { const r = G.phaseOf(f, day); return `${r.name}:${r.weeks}`; };
  assert.equal(p('2026-11-02'), 'Foundation:30');
  assert.equal(G.phaseOf(f, '2026-11-02').starts, '2027-01-14');
  assert.equal(p('2027-01-14'), 'Build:19');
  assert.equal(p('2027-05-20'), 'Taper:1');
  assert.equal(G.targetOf(f, '2027-04-01'), 360);
  const hf = fresh().goals[0];
  assert.equal(G.phaseOf(hf, '2026-11-02').name, 'Coverage');
  assert.equal(G.phaseOf(hf, '2027-01-15').name, 'Pitches + earnings');
  assert.equal(G.phaseOf(hf, '2027-03-10').name, 'Recruiting push');
});

test('next milestone: earliest dated first', () => {
  const hf = fresh().goals[0];
  assert.equal(G.nextMilestone(hf).id, 'hf2-m1');
  hf.milestones[0].done = true;
  assert.equal(G.nextMilestone(hf).id, 'hf2-m2');
  const f = fresh().goals[1];
  f.milestones.find((m) => m.id === 'fit-m1').done = true;
  assert.equal(G.nextMilestone(f).id, 'fit-m6', 'dated ones lead');
  assert.equal(G.nextMilestone({ milestones: [] }), null);
});

test('free time: earned per hour, bonuses, comeback double, spending forgiven below zero', () => {
  const d = fresh();
  d.start = '2026-09-01';
  const t = (day) => new Date(`${day}T12:00:00`).getTime();
  const blocks = [
    blk({ title: 'pitch', day: '2026-09-02', end: 120 }),
    blk({ title: 'Drift', cat: 'drift', day: '2026-09-03', end: 120 }),
    blk({ title: 'pitch', day: '2026-09-04', end: 240 }),
    blk({ title: 'pitch', day: '2026-09-20', end: 120 }),
  ];
  d.goals[0].steps[0] = { ...d.goals[0].steps[0], done: true, doneAt: t('2026-09-20') };
  const c = G.credits(d, blocks);
  const f = G.freeTime(d, c, blocks, {});
  assert.equal(f.balance, 60 + 60 + 30);
  assert.equal(f.comeback, '2026-09-20');
  const live = G.freeTime(d, c, blocks, { now: t('2026-09-21'), timer: { cat: 'drift', startedAt: t('2026-09-21') - 30 * 60000 } });
  assert.equal(live.balance, 120);
  d.funCat = null;
  assert.equal(G.freeTime(d, c, blocks, {}).balance, 30 + 60 + 60 + 30);
});

test('wishlist jar: counted hours minus bought items', () => {
  const d = fresh();
  const c = G.credits(d, [blk({ title: 'pitch', end: 240 }), blk({ title: 'pitch', day: '2026-11-03', end: 300 })]);
  assert.deepEqual(G.hoursJar(d, c), { total: 480, spent: 0, available: 480 });
  d.wish.push({ id: 'x', name: 'Book', hours: 3, bought: '2026-11-03' });
  assert.equal(G.hoursJar(d, c).available, 300);
});

test('shelf and journal hints use active goals only', () => {
  const d = fresh();
  assert.equal(G.shelf(d).length, 12);
  d.goals[1].status = 'inactive';
  assert.equal(G.shelf(d).length, 7);
  const c = G.credits(d, [blk({ title: 'pitch', end: 90 })]);
  const hn = G.hints(d, c, '2026-11-02');
  assert.deepEqual(hn.steps.map((x) => x.goal), ['Hedge fund seat', 'Satsang']);
  assert.deepEqual(hn.counted, [{ goal: 'Hedge fund seat', min: 90 }]);
});

test('list parsers', () => {
  assert.deepEqual(G.parseLines('Long run 90 min\n\nEasy run 45m', []).map((x) => [x.name, x.min]), [['Long run', 90], ['Easy run', 45]]);
  assert.deepEqual(G.parseWish('Garmin watch 40h\nTrip - 120 hours\nShoes'), [{ name: 'Garmin watch', hours: 40 }, { name: 'Trip', hours: 120 }, { name: 'Shoes', hours: 10 }]);
  const ph = fresh().goals.find((g) => g.id === 'fitness').phases;
  assert.deepEqual(G.parsePhases(G.phasesText(ph)), ph, 'round trip');
});

test('three-way merge for sync, including a device still on v1', () => {
  const base = fresh(); delete base.pristine;
  const local = JSON.parse(JSON.stringify(base)), remote = JSON.parse(JSON.stringify(base));
  local.goals[0].steps[0].done = true;
  remote.goals[0].steps.push({ id: 'new', text: 'Read the 10-K', done: false });
  remote.goals[0].why = 'Because I want to think for a living';
  remote.goals[0].milestones[0].text = 'Coverage list: 12 names';
  local.goals[1].status = 'inactive';
  remote.checks.push({ id: 'c', goal: 'satsang', practice: 'sat-p1', day: '2026-11-02', credit: 20 });
  local.rewards.rate = 20; remote.rewards.menus.week = ['Sushi'];
  remote.weekMode['2026-11-01'] = 'deal';
  remote.goals = remote.goals.filter((g) => g.id !== 'hotel');
  const m = G.mergeGoals3(base, local, remote);
  assert.equal(G.validGoals(m), true);
  const hf = m.goals.find((g) => g.id === 'hf');
  assert.equal(hf.steps.find((s) => s.id === 'hf2-s1').done, true);
  assert.ok(hf.steps.some((s) => s.id === 'new'));
  assert.equal(hf.milestones[0].text, 'Coverage list: 12 names');
  assert.equal(hf.why, 'Because I want to think for a living');
  assert.equal(m.goals.find((g) => g.id === 'fitness').status, 'inactive');
  assert.equal(m.goals.some((g) => g.id === 'hotel'), false);
  assert.equal(m.checks.length, 1);
  assert.equal(m.rewards.rate, 20);
  assert.deepEqual(m.rewards.menus.week, ['Sushi']);
  assert.equal(m.weekMode['2026-11-01'], 'deal');
  assert.equal(G.mergeGoals3(null, fresh(), m), m, 'a fresh device takes the synced copy');
  assert.equal(G.validGoals({ ...m, goals: [{ id: 'x' }] }), false);
  assert.equal(G.validGoals({ ...m, v: 1 }), false);
});
