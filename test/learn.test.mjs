// Every level of the learning path: its code compiles, its goal passes its checks, and the code
// a learner starts from doesn't pass them all yet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLDS, LEVELS } from '../js/learn/worlds/index.js';
import { runChecks, compileLevelCode } from '../js/learn/harness.js';

const CHECKED = ['tweak', 'fix', 'build', 'boss', 'order'];

for (const level of LEVELS.values()) {
  test(`${level.id} ${level.title}`, () => {
    if (level.start) {
      const c = compileLevelCode(level.start);
      // a Discover level may start with code that doesn't compile on purpose
      if (!level.startFails) assert.ok(c.ok, `start doesn't compile: ${c.errors?.[0]?.message}`);
    }
    if (level.type === 'predict') {
      assert.ok(level.predict.options.filter(o => o.right).length === 1, 'a predict level has one right answer');
      return;
    }
    if (level.goal) {
      const g = compileLevelCode(level.goal);
      assert.ok(g.ok, `goal doesn't compile: ${g.errors?.[0]?.message}`);
    }
    if (level.checks?.length) {
      const goal = runChecks(level, level.goal);
      for (const r of goal.results) assert.ok(r.pass, `goal fails "${r.say}": ${r.saw}`);
      if (CHECKED.includes(level.type)) {
        const start = runChecks(level, level.order ? level.order.scrambled.join('\n') : level.start);
        assert.ok(!start.ok || start.results.some(r => !r.pass), 'the start code already passes every check');
      }
    }
    if (level.twist) {
      const goal = runChecks(level, level.goal, level.twist.checks);
      assert.ok(goal.results.some(r => !r.pass), 'the goal already passes the twist');
      if (level.twist.solution) {
        const s = runChecks(level, level.twist.solution, level.twist.checks);
        for (const r of s.results) assert.ok(r.pass, `twist solution fails "${r.say}": ${r.saw}`);
      }
    }
    if (level.order) {
      // the cards are the goal's lines, shuffled: putting them in order solves the level
      const sorted = a => [...a].sort();
      assert.deepEqual(sorted(level.order.scrambled), sorted(level.goal.replace(/\n$/, '').split('\n')), 'the cards are the goal\'s lines');
      assert.notEqual(level.order.scrambled.join('\n'), level.goal.replace(/\n$/, ''), 'the cards start out of order');
    }
    if (level.hints?.point) {
      const lines = (level.order ? level.order.scrambled.join('\n') : level.start || '').split('\n').length;
      assert.ok(level.hints.point.line >= 1 && level.hints.point.line <= lines, 'the hint points at a line that exists');
    }
    if (level.reflect) assert.ok(level.reflect.answer < level.reflect.options.length);
  });
}

test('every world has six levels and a boss', () => {
  for (const w of WORLDS) {
    assert.equal(w.levels.length, 6, `World ${w.n}`);
    assert.equal(w.boss.type, 'boss');
  }
});

// ---------- progress: the map's rules and the zone rules ----------
import * as P from '../js/learn/progress.js';

const fakeWorld = n => {
  const w = { n, levels: [0, 1, 2, 3, 4, 5].map(i => ({ id: `${n}.${i + 1}`, skills: ['s'] })), boss: { id: `${n}.★`, skills: ['s'] } };
  for (const l of [...w.levels, w.boss]) l.world = w;
  return w;
};
const w1 = fakeWorld(1), w2 = fakeWorld(2), worlds = [w1, w2];
const r = { ms: 60000, hints: 0, firstTry: true };

test('the first level opens, then the two beside each finished one', () => {
  const s = P.empty();
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(i => P.hexState(s, worlds, w1, i)), ['open', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked']);
  P.finish(s, w1.levels[0], r);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => P.hexState(s, worlds, w1, i)), ['done', 'open', 'locked', 'locked', 'locked', 'open']);
  assert.equal(P.hexState(s, worlds, w2, 0), 'locked');
});

test('the boss opens at any four of six, and beating it opens the next world', () => {
  const s = P.empty();
  for (const i of [0, 1, 2]) P.finish(s, w1.levels[i], r);
  assert.equal(P.hexState(s, worlds, w1, 6), 'locked');
  P.finish(s, w1.levels[5], r);
  assert.equal(P.hexState(s, worlds, w1, 6), 'open');
  P.finish(s, w1.boss, r);
  assert.equal(P.hexState(s, worlds, w1, 3), 'done', 'beating the boss counts the whole ring');
  assert.equal(P.hexState(s, worlds, w2, 0), 'open');
  assert.equal(P.nextLevel(s, worlds), w2.levels[0]);
});

test('a clean solve is worth more mastery than one with hints, and mastery stops at 3', () => {
  const s = P.empty();
  P.finish(s, w1.levels[0], r);
  assert.equal(s.skills.s, 1);
  P.finish(s, w1.levels[1], { ...r, hints: 2, firstTry: false });
  assert.equal(s.skills.s, 1.5);
  P.finish(s, w1.levels[1], r);
  assert.equal(s.skills.s, 1.5, 'finishing a level again adds nothing');
  for (const i of [2, 3, 4, 5]) P.finish(s, w1.levels[i], r);
  assert.equal(s.skills.s, 3);
});

test('stuck: three misses on one check, the same error twice, or two idle minutes', () => {
  assert.equal(P.stuck({ fails: [1, 2] }), null);
  assert.equal(P.stuck({ fails: [0, 3] }), 'fails');
  assert.equal(P.stuck({ sameError: 2 }), 'error');
  assert.equal(P.stuck({ idleMs: 120000 }), 'idle');
});

test('coasting: three clean, quick levels in a row', () => {
  const s = P.empty(), lv = { minutes: 8 };
  const quick = { ms: 60000, hints: 0, firstTry: true };
  assert.equal(P.coasting(s, lv, quick), false);
  assert.equal(P.coasting(s, lv, quick), false);
  assert.equal(P.coasting(s, lv, quick), true);
  assert.equal(P.coasting(s, lv, { ...quick, hints: 1 }), false, 'a hint resets the streak');
  assert.equal(s.streak, 0);
});

test('a progress code carries everything but drafts', () => {
  const s = P.empty();
  P.finish(s, w1.levels[0], r);
  s.drafts['1.2'] = 'void setup() {}';
  const back = P.importCode(P.exportCode(s));
  assert.deepEqual(back.levels, s.levels);
  assert.deepEqual(back.drafts, {});
  assert.equal(P.importCode('nonsense'), null);
});
