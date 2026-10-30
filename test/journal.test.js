import test from 'node:test';
import assert from 'node:assert/strict';
import * as J from '../journal.js';

const frag = (id, day, text, tags = [], h = 9) => ({ id, day, text, tags, at: new Date(...day.split('-').map((x, i) => (i === 1 ? +x - 1 : +x)), h).getTime() });

test('morning questions rotate every two weeks through 10 alternatives', () => {
  const j = J.freshJournal('2026-10-01');
  assert.deepEqual(J.questionsFor(j, '2026-10-01'), J.BASE_Q);
  assert.deepEqual(J.questionsFor(j, '2026-10-14'), J.BASE_Q);
  assert.deepEqual(J.questionsFor(j, '2026-10-15'), J.POOL[0]);
  assert.deepEqual(J.questionsFor(j, '2026-10-29'), J.POOL[1]);
  assert.deepEqual(J.questionsFor(j, '2027-02-18'), J.POOL[9]); // day 140 -> the 10th alternative
  assert.deepEqual(J.questionsFor(j, '2027-03-04'), J.BASE_Q); // day 154 wraps around
  assert.equal(J.POOL.length, 10);
  assert.ok(J.POOL.every((q) => q.length === 3 && new Set(q).size === 3));
  assert.equal(new Set(J.POOL.flat()).size, 30, 'all distinct');
});

test('welcome back after two or more empty days, never on day one', () => {
  const j = J.freshJournal('2026-10-01');
  assert.equal(J.welcomeBack(j, '2026-10-20'), false, 'brand new');
  j.frags.push(frag('a', '2026-10-20', 'hi'));
  assert.equal(J.welcomeBack(j, '2026-10-21'), false, 'next day');
  assert.equal(J.welcomeBack(j, '2026-10-22'), false, 'one empty day');
  assert.equal(J.welcomeBack(j, '2026-10-23'), true, 'two empty days');
  j.days['2026-10-23'] = { m3: 'Ship the deck' };
  assert.equal(J.welcomeBack(j, '2026-10-23'), false, 'once today has anything, normal page');
  j.days['2026-10-25'] = { m1: '   ' };
  assert.equal(J.dayActive(j, '2026-10-25'), false, 'blank answers don’t count');
});

test('one fragment counts as a whole day', () => {
  const j = J.freshJournal('2026-10-01');
  j.frags.push(frag('a', '2026-10-20', 'one line'));
  assert.equal(J.dayActive(j, '2026-10-20'), true);
});

test('#tags inside text', () => {
  assert.deepEqual(J.parseTags('call mom #task'), { text: 'call mom', tags: ['task'] });
  assert.deepEqual(J.parseTags('#Ideas build a thing #wins'), { text: 'build a thing', tags: ['idea', 'win'] });
  assert.deepEqual(J.parseTags('price is #1 #lessonplan'), { text: 'price is #1 #lessonplan', tags: [] });
});

test('book of lessons: notes + tagged items, by month, filters', () => {
  const j = J.freshJournal('2026-09-01');
  j.days['2026-10-03'] = { note: 'You don’t need to win every meeting.' };
  j.days['2026-09-12'] = { note: 'You can start before you feel ready.' };
  j.days['2026-10-04'] = { note: '  ' };
  j.frags.push(frag('i', '2026-10-05', 'idea for the CIM', ['idea']), frag('w', '2026-09-20', 'closed it', ['win', 'lesson']), frag('t', '2026-10-06', 'email lender', ['task']), frag('p', '2026-10-06', 'plain'));
  const all = J.bookEntries(j);
  assert.deepEqual(all.map((g) => g.month), ['2026-10', '2026-09']);
  assert.deepEqual(all[0].items.map((e) => e.id), ['i', 'note:2026-10-03']);
  assert.equal(all.flatMap((g) => g.items).some((e) => e.id === 't' || e.id === 'p'), false, 'tasks and untagged stay out');
  assert.deepEqual(J.bookEntries(j, 'lesson').flatMap((g) => g.items).map((e) => e.id), ['note:2026-10-03', 'w', 'note:2026-09-12']);
  assert.deepEqual(J.bookEntries(j, 'win').flatMap((g) => g.items).map((e) => e.id), ['w']);
  assert.deepEqual(J.bookEntries(j, 'trigger'), []);
  const l = J.pastLesson(j, '2026-10-30');
  assert.ok(['note:2026-10-03', 'w', 'note:2026-09-12'].includes(l.id));
  assert.equal(J.pastLesson(j, '2026-10-30').id, l.id, 'same lesson all day');
  assert.equal(J.pastLesson(J.freshJournal('2026-10-01'), '2026-10-30'), null);
});

test('tasks out: waiting first, moved last', () => {
  const j = J.freshJournal('2026-10-01');
  j.frags.push({ ...frag('a', '2026-10-01', 'a', ['task']), moved: true }, frag('b', '2026-10-02', 'b', ['task']), frag('c', '2026-10-03', 'c', ['idea']));
  assert.deepEqual(J.tasksOut(j).map((f) => f.id), ['b', 'a']);
});

test('markdown export and safe import', () => {
  const j = J.freshJournal('2026-10-01');
  j.days['2026-10-27'] = { m1: 'a long diligence call', m3: 'Send the model', well: 'Stayed calm', note: 'You did enough today.', q: J.BASE_Q };
  j.frags.push(frag('a', '2026-10-27', 'felt the urge to scroll', ['trigger'], 15));
  const md = J.toMarkdown(j);
  for (const s of ['# To Myself', '## Tuesday, October 27, 2026', '**Morning**', '- Today may test me with: a long diligence call', '- One thing that matters: Send the model',
    '**Through the day**', '**Evening**', '- Went well: Stayed calm', '> You did enough today.']) assert.ok(md.includes(s), s);
  assert.match(md, /- 3:00 PM — felt the urge to scroll {2}#trigger/);
  assert.ok(!md.includes('Mine to control'), 'unanswered questions left out');
  // import: adds, fills gaps, never overwrites
  const other = J.freshJournal('2026-09-15');
  other.days['2026-10-27'] = { m3: 'something else', next: 'Start earlier' };
  other.days['2026-10-20'] = { note: 'You can rest.' };
  other.frags.push(frag('a', '2026-10-27', 'dup'), frag('b', '2026-10-20', 'new one', ['win', 'bogus']));
  assert.equal(J.validJournal(other), true);
  const r = J.mergeJournal(j, other);
  assert.deepEqual([r.added, r.answers], [1, 2]);
  assert.equal(r.data.days['2026-10-27'].m3, 'Send the model');
  assert.equal(r.data.days['2026-10-27'].next, 'Start earlier');
  assert.deepEqual(r.data.frags.find((f) => f.id === 'b').tags, ['win']);
  assert.equal(r.data.start, '2026-09-15');
  assert.equal(J.validJournal({ v: 1, days: [], frags: [] }), false);
  assert.equal(J.validJournal({ v: 2, days: {}, frags: [] }), false);
});
