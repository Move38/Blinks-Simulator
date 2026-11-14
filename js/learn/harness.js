/*
 * Runs a level's checks on hidden Blinks. A check is { say, test(t) }: test drives a fresh table
 * through `t` and returns true when it passes, or a sentence saying what it saw ("Yours stayed on
 * face 0 for 2 seconds."). Every Blink keeps exact time here (no drift), so a run always ends the
 * same way.
 */

import { compile } from '../compiler/index.js';
import { World } from '../runtime/world.js';

// blinklib's named colors, as 5-bit red, green, blue (js/compiler/preprocess.js)
export const NAMED = {
  OFF: [0, 0, 0], RED: [31, 0, 0], ORANGE: [31, 15, 0], YELLOW: [31, 31, 0], GREEN: [0, 31, 0],
  CYAN: [0, 31, 31], BLUE: [0, 0, 31], MAGENTA: [31, 0, 31], WHITE: [31, 31, 31],
};
export const rgb5 = c => [(c >> 1) & 31, (c >> 6) & 31, (c >> 11) & 31];

// A color's name for people: RED, or "dim BLUE", or "red 20 green 5 blue 0" when it's a mix of its own
export function colorName(c) {
  const v = rgb5(c), max = Math.max(...v);
  if (max === 0) return 'OFF';
  for (const [n, w] of Object.entries(NAMED)) if (w.every((x, i) => x === v[i])) return n;
  // a named color, dimmed: the same shape at a lower brightness. Very faint colors have to match
  // closely, and at brightness 1 every color looks alike, so those keep their numbers.
  const slack = max <= 3 ? 0.5 : 1.5;
  if (max > 1) for (const [n, w] of Object.entries(NAMED)) {
    if (n === 'OFF') continue;
    const k = max / 31;
    if (w.every((x, i) => Math.abs(x * k - v[i]) <= slack)) return 'dim ' + n;
  }
  return `red ${v[0]} green ${v[1]} blue ${v[2]}`;
}
// how bright a color is, 0 to 31
export const level = c => Math.max(...rgb5(c));

const CLICK_MS = 60;        // a press as short as a quick tap
const SETTLE_MS = 450;      // past the BIOS's 330 ms click window, so a single click has registered

// One table of hidden Blinks running a compiled sketch
class Table {
  constructor(compiled, cells) {
    this.errors = [];
    this.warns = [];
    this.world = new World({
      onError: (b, e) => this.errors.push(e.message || String(e)),
      onWarn: (b, message) => this.warns.push(message),
    });
    for (const [q, r, rot] of cells) this.world.addBlink(q, r, rot || 0);
    this.world.load(compiled);
  }
  get blinks() { return this.world.blinks; }
  get time() { return this.world.time; }
  wait(ms) { this.world.advance(ms); return this; }
  press(i = 0) { this.blinks[i].press(true); return this; }
  release(i = 0) { this.blinks[i].press(false); this.world.advance(1); return this; }
  // a single click, and enough time for it to count as one
  click(i = 0, settle = SETTLE_MS) { this.press(i).wait(CLICK_MS).release(i).wait(settle); return this; }
  doubleClick(i = 0) { this.press(i).wait(CLICK_MS).release(i).wait(80).press(i).wait(CLICK_MS).release(i).wait(SETTLE_MS); return this; }
  hold(i = 0, ms = 1500) { this.press(i).wait(ms); return this; }
  // the six faces' colors as names, face 0 first
  faces(i = 0) { return [...this.blinks[i].display].map(colorName); }
  raw(i = 0) { return [...this.blinks[i].display]; }
  lit(i = 0) { return this.raw(i).filter(c => level(c) > 0).length; }
  // run `fn` every `every` ms, `n` times, and collect what it returns
  sample(every, n, fn) {
    const out = [];
    for (let k = 0; k < n; k++) { out.push(fn(this)); this.wait(every); }
    return out;
  }
  // move Blink i to another cell (for neighbor levels)
  move(i, q, r) { const b = this.blinks[i]; this.world.lift(b); this.world.place(b, q, r); return this; }
}

export function compileLevelCode(code) { return compile(code, { sdk: 'move38' }); }

// The harness a check's test(t) gets: t.table() makes a table running the learner's code,
// t.goalTable() one running the level's goal, both on the level's cells unless given others.
function harness(compiled, goalCompiled, cells, code) {
  const t = {
    code,
    table: (c = cells) => new Table(compiled, c),
    goalTable: (c = cells) => new Table(goalCompiled, c),
    colorName, level,
    // names of the faces that are lit
    litFaces: faces => faces.map((n, f) => n === 'OFF' ? -1 : f).filter(f => f >= 0),
    // 'face 0' or 'faces 0, 2 and 4'
    faceList(fs) {
      if (!fs.length) return 'no faces';
      if (fs.length === 1) return 'face ' + fs[0];
      return 'faces ' + fs.slice(0, -1).join(', ') + ' and ' + fs[fs.length - 1];
    },
    // what the faces fs showed, grouped by color: "Faces 2 and 3 were OFF, face 4 was RED."
    sayFaces(fs, names) {
      const groups = new Map();
      for (const f of fs) groups.set(names[f], [...(groups.get(names[f]) || []), f]);
      const parts = [...groups].map(([c, list]) => list.length === 6 ? `all six faces were ${c}` : list.length > 1 ? `${t.faceList(list)} were ${c}` : `face ${list[0]} was ${c}`);
      const out = parts.join(', ') + '.';
      return out[0].toUpperCase() + out.slice(1);
    },
    // "all RED", or "RED, RED, OFF, OFF, OFF, OFF"
    describe(faces) { return faces.every(n => n === faces[0]) ? 'all ' + faces[0] : faces.join(', '); },
  };
  return t;
}

/*
 * Run a level's checks on `code`. Returns { ok, error?, results: [{ say, pass, saw }] }.
 * ok is false when the code doesn't compile; then error says why and no check runs.
 */
export function runChecks(level, code, checks = level.checks, goalCompiled = null) {
  const compiled = compileLevelCode(code);
  if (!compiled.ok) return { ok: false, error: compiled.errors[0], results: checks.map(c => ({ say: c.say, pass: false, saw: null })) };
  const goal = goalCompiled || (level.goal ? compileLevelCode(level.goal) : null);
  const t = harness(compiled, goal && goal.ok ? goal : null, level.cells || [[0, 0]], code);
  const results = checks.map(c => {
    let r;
    try { r = c.test(t); }
    catch (e) { r = 'Your code stopped with an error: ' + (e.message || e); }
    return { say: c.say, pass: r === true, saw: r === true ? null : r || 'It didn\'t do this yet.' };
  });
  return { ok: true, warnings: compiled.warnings, results };
}
