/*
 * A learner's progress, kept in this browser: which levels are done, how each went, and a
 * mastery level (0 to 3) per skill. Also the rules that read it: which hexes on the map are open,
 * and whether a learner looks stuck or is coasting. Everything but load() and save() is pure.
 */

const STORE = 'blinks.learn.v1';

export const empty = () => ({ v: 1, levels: {}, skills: {}, drafts: {}, streak: 0 });

export function load(storage = globalThis.localStorage) {
  try {
    const s = JSON.parse(storage.getItem(STORE));
    if (s && s.v === 1) return { ...empty(), ...s };
  } catch (e) { /* no storage, or nothing saved yet */ }
  return empty();
}
export function save(state, storage = globalThis.localStorage) {
  try { storage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
}

// A code to carry progress to another browser, and back
export function exportCode(state) {
  const { drafts, ...rest } = state;
  return 'LTB1.' + btoa(unescape(encodeURIComponent(JSON.stringify(rest))));
}
export function importCode(code) {
  const m = /^LTB1\.([A-Za-z0-9+/=]+)$/.exec(String(code).trim());
  if (!m) return null;
  try {
    const s = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    return s && s.v === 1 ? { ...empty(), ...s } : null;
  } catch (e) { return null; }
}

// ---------- the map ----------

const done = (state, id) => !!state.levels[id]?.done;
export const bossDone = (state, w) => done(state, w.boss.id);
// a world's ring level counts as done when it was finished, or when the world's boss was beaten early
export const ringDone = (state, w, i) => done(state, w.levels[i].id) || bossDone(state, w);
export const ringCount = (state, w) => w.levels.filter((l, i) => ringDone(state, w, i)).length;
export const BOSS_AT = 4;

export function worldOpen(state, worlds, w) {
  const k = worlds.indexOf(w);
  return k <= 0 || bossDone(state, worlds[k - 1]);
}

// 'done' | 'open' | 'locked' for ring level i (0-5) of world w, or for its boss (i = 6)
export function hexState(state, worlds, w, i) {
  if (!worldOpen(state, worlds, w)) return 'locked';
  if (i === 6) return bossDone(state, w) ? 'done' : ringCount(state, w) >= BOSS_AT ? 'open' : 'locked';
  if (ringDone(state, w, i)) return 'done';
  // the first level is open; after it, finishing a level opens the two beside it on the ring
  if (i === 0 || ringDone(state, w, (i + 1) % 6) || ringDone(state, w, (i + 5) % 6)) return 'open';
  return 'locked';
}

// Where Continue goes: the first open level that isn't done, in the first world that has one
export function nextLevel(state, worlds) {
  for (const w of worlds) {
    if (!worldOpen(state, worlds, w)) break;
    for (let i = 0; i < 7; i++) if (hexState(state, worlds, w, i) === 'open') return i === 6 ? w.boss : w.levels[i];
  }
  return null;
}
// The level after `level` on its ring: the next open one clockwise, else the boss, else Continue's
export function after(state, worlds, level) {
  const w = level.world;
  const k = w.levels.indexOf(level);
  if (k >= 0) {
    for (let d = 1; d < 6; d++) {
      const i = (k + d) % 6;
      if (hexState(state, worlds, w, i) === 'open') return w.levels[i];
    }
    if (hexState(state, worlds, w, 6) === 'open') return w.boss;
  }
  return nextLevel(state, worlds);
}

// ---------- results and mastery ----------

/*
 * Record a finished level. r: { ms, hints, firstTry, shown (used "Show me"), reflect (true/false/undefined) }.
 * Returns the skills that moved, as { skill: [before, after] }.
 */
export function finish(state, level, r) {
  const prev = state.levels[level.id];
  state.levels[level.id] = { ...prev, done: true, ms: r.ms, hints: r.hints, firstTry: r.firstTry, shown: !!r.shown, at: Date.now() };
  const moved = {};
  if (!prev?.done) {
    // a clean solve is worth a whole step; one with a few hints, half; one that needed the answer, a little
    let gain = r.shown ? 0.25 : r.hints === 0 && r.firstTry ? 1 : r.hints <= 2 ? 0.5 : 0.25;
    if (r.reflect === false) gain -= 0.25;
    for (const s of level.skills || []) {
      const a = state.skills[s] || 0, b = Math.max(0, Math.min(3, a + gain));
      state.skills[s] = b;
      if (Math.floor(a) !== Math.floor(b) || a !== b) moved[s] = [a, b];
    }
  }
  return moved;
}
export function star(state, level) {
  state.levels[level.id] = { ...state.levels[level.id], star: true };
}

// ---------- staying in the zone ----------

export const STUCK_FAILS = 3;          // failed Checks on the same item
export const IDLE_MS = 120000;         // two minutes without an edit
export const SAME_ERROR = 2;           // the same compile error, run after run

/*
 * Does this attempt look stuck? a: { fails: [per-check failed Check presses], idleMs, sameError }.
 * Returns a reason, or null.
 */
export function stuck(a) {
  if (a.fails && a.fails.some(n => n >= STUCK_FAILS)) return 'fails';
  if (a.sameError >= SAME_ERROR) return 'error';
  if (a.idleMs >= IDLE_MS) return 'idle';
  return null;
}

/*
 * After finishing a level: is the learner coasting? Clean (first Check passed, no hints) and fast
 * (under half the level's expected time), and it's the third in a row. Updates state.streak.
 */
export function coasting(state, level, r) {
  const expected = (level.minutes || 8) * 60000;
  const clean = r.firstTry && r.hints === 0 && !r.shown;
  state.streak = clean && r.ms < expected / 2 ? (state.streak || 0) + 1 : 0;
  return state.streak >= 3;
}
