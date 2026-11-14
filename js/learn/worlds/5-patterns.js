/*
 * World 5 · Patterns: repetition with FOREACH_FACE and for loops, functions of your own, parameters.
 * Game design idea: juice. Small animations make a game feel alive.
 */

import { facesShow, noWarnings } from '../checks.js';

const RAINBOW = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'MAGENTA'];
const mod6 = x => ((x % 6) + 6) % 6;
// 'At the start' or 'After 1.2 seconds', for what a check saw at a moment of its run
const when = ms => ms ? `After ${(ms / 1000).toFixed(1)} seconds` : 'At the start';

// Watch Blink 0 for `ms`, every `every` ms, after `warm` ms (and `clicks` clicks): the frames it showed
function watch(t, { ms = 3000, every = 10, warm = 300, clicks = 0 } = {}) {
  const tb = t.table().wait(warm);
  for (let k = 0; k < clicks; k++) tb.click(0);
  const frames = tb.sample(every, ms / every, x => ({ names: x.faces(0), raw: x.raw(0) }));
  frames.forEach((fr, k) => { fr.at = k * every; fr.levels = fr.raw.map(t.level); });
  return frames;
}

// How a position (0 to 5, or -1 for none) moved over the frames: each change, and how far it went
function moves(frames, posOf) {
  const out = [];
  let last = posOf(frames[0]);
  for (const fr of frames.slice(1)) {
    const p = posOf(fr);
    if (p !== last) { out.push({ at: fr.at, step: mod6(p - last) }); last = p; }
  }
  return out;
}
// Say what's wrong with a motion that should go one face at a time, one way: a sentence, or null
function sayMoves(ms, what) {
  if (!ms.length) return `${what} stayed in one place.`;
  if (period(ms) < 40) return `${what} moved every few ms, too fast to see. Use a timer to slow it down.`;
  const jump = ms.find(m => m.step !== 1 && m.step !== 5);
  if (jump) return `${when(jump.at)}, ${what.toLowerCase()} jumped ${Math.min(jump.step, 6 - jump.step)} faces at once.`;
  if (ms.some(m => m.step !== ms[0].step)) return `${what} went one way, then the other.`;
  return null;
}
// the average time between moves, in ms
const period = ms => ms.length < 2 ? Infinity : (ms[ms.length - 1].at - ms[0].at) / (ms.length - 1);
function saySpeed(ms, what, lo, hi, goal) {
  const p = period(ms);
  if (p >= lo && p <= hi) return true;
  if (!ms.length) return `${what} didn't move.`;
  if (ms.length === 1) return `${what} moved once, then stopped.`;
  return `${what} moved one face every ${Math.round(p)} ms. The goal is about ${goal} ms, so yours is too ${p > hi ? 'slow' : 'fast'}.`;
}

// ---------- 5.4: the rainbow wheel ----------
// k when face f shows RAINBOW[(f + k) % 6], or -1 when the faces aren't the rainbow
const turnOf = fr => { for (let k = 0; k < 6; k++) if (fr.names.every((n, f) => n === RAINBOW[(f + k) % 6])) return k; return -1; };
const wheel = t => {
  const frames = watch(t);
  const bad = frames.find(fr => turnOf(fr) < 0);
  return { frames, bad, ms: bad ? [] : moves(frames, turnOf) };
};
const isRainbow = {
  say: 'All six faces show the rainbow, in order',
  test(t) {
    const { bad } = wheel(t);
    return !bad || `${when(bad.at)}, yours was ${t.describe(bad.names)}.`;
  },
};
const turns = {
  say: 'The rainbow turns, one face at a time',
  test(t) {
    const { bad, ms } = wheel(t);
    if (bad) return 'It has to show the rainbow before it can turn.';
    return sayMoves(ms, 'The rainbow') || true;
  },
};
const turnSpeed = {
  say: 'It turns one face about every 200 ms',
  test(t) {
    const { bad, ms } = wheel(t);
    return bad ? 'It has to show the rainbow before it can turn.' : saySpeed(ms, 'The rainbow', 150, 280, 200);
  },
};

// ---------- 5.5: a function of your own ----------
// The learner's own functions that take something: [{ name, calls }]
function ownFunctions(code) {
  const src = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of src.matchAll(/\b(?:void|byte|int|bool|boolean|Color|word|long|uint8_t)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g)) {
    const [, name, params] = m;
    if (name === 'setup' || name === 'loop' || !params.trim() || params.trim() === 'void') continue;
    const calls = (src.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) || []).length - 1;
    out.push({ name, calls });
  }
  return out;
}
const ownFunction = {
  say: 'You wrote a function with a parameter, and you use it',
  test(t) {
    const fns = ownFunctions(t.code);
    if (!fns.length) return 'There is no function of your own with a parameter yet.';
    return fns.some(f => f.calls > 0) || `You wrote ${fns[0].name}(), but nothing uses it yet.`;
  },
};
// faces `tails` are their head's color, dimmed to about dim(color, 30)
const dimTails = {
  say: 'Faces 1, 3 and 5 are dim tails, about dim(color, 30)',
  test(t) {
    const tb = t.table().wait(300), names = tb.faces(0), raw = tb.raw(0);
    const want = { 1: 'dim RED', 3: 'dim GREEN', 5: 'dim BLUE' };
    const wrong = [1, 3, 5].filter(f => names[f] !== want[f]);
    if (wrong.length) return t.sayFaces(wrong, names);
    const lv = Math.max(...[1, 3, 5].map(f => t.level(raw[f])));
    if (lv > 5) return `The tails are still too bright. They look like dim(color, ${Math.round(lv * 255 / 31 / 10) * 10}).`;
    return true;
  },
};

// ---------- 5.6: the comet ----------
// the one face brighter than all the others, or -1
function headOf(fr) {
  const top = Math.max(...fr.levels);
  if (top === 0) return -1;
  const at = fr.levels.flatMap((l, f) => l === top ? [f] : []);
  return at.length === 1 ? at[0] : -1;
}
const oneHead = {
  say: 'One face is brighter than all the others',
  test(t) {
    const bad = watch(t, { ms: 1500 }).find(fr => headOf(fr) < 0);
    if (!bad) return true;
    const top = Math.max(...bad.levels);
    if (!top) return `${when(bad.at)}, every face was OFF.`;
    return `${when(bad.at)}, ${t.faceList(bad.levels.flatMap((l, f) => l === top ? [f] : []))} were just as bright.`;
  },
};
const headMoves = {
  say: 'The bright face goes around, one face about every 100 ms',
  test(t) {
    const frames = watch(t);
    if (frames.some(fr => headOf(fr) < 0)) return 'There has to be one bright face before it can go around.';
    const ms = moves(frames, headOf);
    return sayMoves(ms, 'The bright face') || saySpeed(ms, 'The bright face', 70, 160, 100);
  },
};
// What's wrong with the tail in one frame, `d` the way the head moves (1 clockwise, -1 the other way)
function tailTrouble(fr, d, t) {
  const L = fr.levels, h = headOf(fr);
  const b1 = mod6(h - d), b2 = mod6(h - 2 * d), ahead = mod6(h + d);
  if (!L[b1] && L[ahead]) return `The fading face was in front of the head, on face ${ahead}. The tail goes behind, on face ${b1}.`;
  if (!L[b1]) return `The head was on face ${h}, and the face behind it, face ${b1}, was OFF.`;
  if (!L[b2]) return `Only one face trailed the head. Face ${b2}, two behind it, was OFF.`;
  if (L[b2] >= L[b1]) return `Face ${b2} was as bright as face ${b1}. Each face back should be dimmer.`;
  const loud = [0, 1, 2, 3, 4, 5].find(f => f !== h && f !== b1 && f !== b2 && L[f] >= L[b2]);
  if (loud !== undefined) return `Face ${loud} was as bright as the end of the tail. The faces past the tail should be dimmer still.`;
  return null;
}
const tailFades = {
  say: 'The two faces behind the head fade: each one dimmer than the one before',
  test(t) {
    const frames = watch(t, { ms: 1500 });
    if (frames.some(fr => headOf(fr) < 0)) return 'There has to be one bright face before it can have a tail.';
    const ms = moves(frames, headOf);
    const d = ms.length && ms[0].step === 5 ? -1 : 1;
    for (const fr of frames) {
      const why = tailTrouble(fr, d, t);
      if (why) return why;
    }
    return true;
  },
};

// ---------- the boss: which animation is playing? ----------
const ANIMS = ['spin', 'breathe', 'rainbow'];
// { kind: 'spin' | 'breathe' | 'rainbow' | null, said: what it looked like }
function animation(t, clicks) {
  const frames = watch(t, { ms: 2500, every: 20, clicks });
  const changed = frames.filter((fr, k) => k && fr.raw.join() !== frames[k - 1].raw.join()).length;
  const lit = fr => fr.levels.filter(Boolean).length;
  if (!changed) return { kind: null, said: `it showed ${t.describe(frames[0].names)} and stayed that way` };
  if (frames.every(fr => lit(fr) === 1)) {
    const ms = moves(frames, fr => fr.levels.findIndex(Boolean));
    if (ms.length >= 3 && ms.every(m => m.step === 1 || m.step === 5)) return { kind: 'spin' };
  }
  if (frames.every(fr => fr.raw.every(c => c === fr.raw[0]))) {
    const levels = frames.map(fr => fr.levels[0]);
    if (new Set(levels).size >= 5 && Math.max(...levels) - Math.min(...levels) >= 12) return { kind: 'breathe' };
  }
  if (changed >= 3 && frames.every(fr => lit(fr) === 6 && new Set(fr.raw).size >= 4)) return { kind: 'rainbow' };
  return { kind: null, said: `it changed, but it didn't look like spin, breathe or rainbow. It started as ${t.describe(frames[0].names)}` };
}
const AFTER = ['At the start', 'After one click', 'After two clicks', 'After three clicks', 'After four clicks'];
function plays(clicks, want, say) {
  return {
    say,
    test(t) {
      const a = animation(t, clicks);
      if (a.kind === want) return true;
      return `${AFTER[clicks]}, ${a.kind ? `it played ${a.kind}` : a.said}.`;
    },
  };
}
const kitFunctions = {
  say: 'spin(), breathe() and rainbow() are each a function, and loop() uses them',
  test(t) {
    const fns = ANIMS.filter(n => !new RegExp(`\\bvoid\\s+${n}\\s*\\(\\s*\\)\\s*\\{`).test(t.code));
    if (fns.length) return `There's no function called ${fns[0]}().`;
    const unused = ANIMS.filter(n => (t.code.match(new RegExp(`\\b${n}\\s*\\(`, 'g')) || []).length < 2);
    return !unused.length || `Nothing uses ${unused[0]}() yet.`;
  },
};

export default {
  n: 5, name: 'Patterns', color: '#4ade80', view: 'split',
  blurb: 'Do it once, then let the Blink repeat it. Loops, functions of your own, and animation that makes a game feel alive.',
  design: 'Juice. Small animations make a game feel alive.',
  levels: [
    {
      id: '5.1', type: 'predict', title: 'Every face', skills: ['loops', 'light'],
      brief: 'FOREACH_FACE(f) runs the lines inside it six times. The first time, f is 0. Then f is 1, then 2, all the way to 5. dim(color, amount) makes a color darker: 255 is full bright and 0 is off. Read this one, then guess.',
      start: `void setup() {
  FOREACH_FACE(f) {
    setColorOnFace(dim(WHITE, f * 40), f);
  }
}

void loop() {
}
`,
      predict: {
        q: 'What will this Blink show?',
        options: [
          { text: 'Face 0 dark, then each face brighter going clockwise', pics: [['0', '#4b4b55', '#6e6e78', '#94949c', '#babac0', '#e0e0e4']], right: true, why: 'Right. Each time around, f is a different number. Face 0 gets 0 * 40, which is off. Face 5 gets 5 * 40 = 200, the brightest.' },
          { text: 'Face 0 brightest, then each face dimmer going clockwise', pics: [['#e0e0e4', '#babac0', '#94949c', '#6e6e78', '#4b4b55', '0']], why: 'Work out f * 40 for face 0. It\'s 0 * 40 = 0, and dim(WHITE, 0) is off.' },
          { text: 'All six faces white', pics: [['W']], why: 'The loop runs six times, but f is a different number each time. So each face gets a different amount of light.' },
          { text: 'The faces light up one at a time, then stay', pics: [['0'], ['0', '#4b4b55', '0', '0', '0', '0'], ['0', '#4b4b55', '#6e6e78', '#94949c', '#babac0', '#e0e0e4']], why: 'The loop runs all six times in a blink of an eye, long before you could see it. You only see the end.' },
        ],
      },
    },
    {
      id: '5.2', type: 'order', title: 'Gradient', skills: ['loops', 'order'],
      brief: 'Put the lines in order so the faces fade from bright BLUE on face 0 to dim on face 5. A for loop has three parts: where f starts (f = 0), when to keep going (f < 6), and how f steps (f++ adds 1). Think about which lines run once, and which run every time around.',
      goal: `void setup() {
  int brightness = 255;
  for (int f = 0; f < 6; f++) {
    setColorOnFace(dim(BLUE, brightness), f);
    brightness = brightness - 40;
  }
}

void loop() {
}
`,
      order: {
        scrambled: [
          'void setup() {',
          '    brightness = brightness - 40;',
          '  for (int f = 0; f < 6; f++) {',
          '  }',
          '  int brightness = 255;',
          '    setColorOnFace(dim(BLUE, brightness), f);',
          '}',
          '',
          'void loop() {',
          '}',
        ],
        fixed: ['void setup() {', '}', '', 'void loop() {'],
      },
      checks: [
        facesShow({ 0: 'BLUE' }, { say: 'Face 0 is full bright BLUE' }),
        {
          say: 'Each face is dimmer than the one before it',
          test(t) {
            const raw = t.table().wait(300).raw(0), lv = raw.map(t.level);
            if (lv.every(l => l === lv[0])) return lv[0] ? 'All six faces were just as bright.' : 'All six faces were OFF.';
            const f = [1, 2, 3, 4, 5].find(f => lv[f] >= lv[f - 1]);
            return f === undefined || `Face ${f} was as bright as face ${f - 1}.`;
          },
        },
      ],
      hints: {
        nudge: 'A variable has to be made before anything can use it. Which line makes brightness?',
        concept: 'Lines inside the loop\'s { } run six times, once for each face. Lines before the loop run once.',
        point: { line: 5, text: 'This line sets brightness to 255. If it ran every time around the loop, every face would be full bright.' },
        fill: 'int brightness = 255;\nfor (...) {\n  setColorOnFace(...);\n  brightness = ...;\n}',
      },
      reflect: {
        q: 'What if brightness = brightness - 40; came before setColorOnFace() inside the loop?',
        options: ['Face 0 would be a little dim, not full bright', 'Nothing would change', 'Every face would be off'], answer: 0,
        why: 'Lines run in order, even inside a loop. Taking 40 away first means face 0 gets 215, not 255.',
      },
    },
    {
      id: '5.3', type: 'fix', title: 'Off by one', skills: ['loops', 'faces'], view: 'code',
      brief: 'This loop should give each face its color from the rainbow list. But face 0 is dark, and the console has a warning. The bug has a name: off by one. Fix the loop.',
      start: `Color rainbow[] = {RED, ORANGE, YELLOW, GREEN, BLUE, MAGENTA};

void setup() {
  for (int f = 1; f <= 6; f++) {
    setColorOnFace(rainbow[f], f);
  }
}

void loop() {
}
`,
      goal: `Color rainbow[] = {RED, ORANGE, YELLOW, GREEN, BLUE, MAGENTA};

void setup() {
  for (int f = 0; f < 6; f++) {
    setColorOnFace(rainbow[f], f);
  }
}

void loop() {
}
`,
      checks: [
        facesShow({ 0: 'RED' }, { say: 'Face 0 is RED' }),
        facesShow(Object.fromEntries(RAINBOW.map((c, f) => [f, c])), { say: 'All six faces show the rainbow' }),
        noWarnings({ say: 'The loop only uses faces 0 to 5' }),
      ],
      hints: {
        nudge: 'Which numbers does f take in this loop? Count them: 1, 2, 3...',
        concept: 'Faces and list items are numbered from 0. Six of them go 0, 1, 2, 3, 4, 5. A loop over them starts at 0 and stops before 6.',
        point: { line: 4, text: 'f starts at 1 and goes up to 6. Both ends are one too big.' },
        fill: 'for (int f = _; f < _; f++) {',
      },
      twist: {
        brief: 'Light only faces 0, 2 and 4, each with its rainbow color, and leave the others dark. Change how f steps.',
        checks: [
          facesShow({ 0: 'RED', 1: 'OFF', 2: 'YELLOW', 3: 'OFF', 4: 'BLUE', 5: 'OFF' }, { say: 'Faces 0, 2 and 4 are RED, YELLOW and BLUE, and the rest are dark' }),
          noWarnings({ say: 'The loop only uses faces 0 to 5' }),
        ],
        solution: `Color rainbow[] = {RED, ORANGE, YELLOW, GREEN, BLUE, MAGENTA};

void setup() {
  for (int f = 0; f < 6; f += 2) {
    setColorOnFace(rainbow[f], f);
  }
}

void loop() {
}
`,
      },
      reflect: {
        q: 'A loop starts at f = 0. How many times does it run with f < 6?',
        options: ['6 times: 0, 1, 2, 3, 4 and 5', '7 times', '5 times'], answer: 0,
        why: 'f < 6 stops before 6. Starting at 0, that\'s exactly six turns, one for each face. f <= 6 would make seven.',
      },
    },
    {
      id: '5.4', type: 'build', title: 'Rainbow wheel', skills: ['loops', 'timers', 'variables'],
      brief: 'Motion makes a game feel alive. Game makers call it juice. This rainbow sits still: make it turn like a wheel, one face every 200 ms. Each time the timer runs out, add 1 to offset. Then give face f the color rainbow[(f + offset) % 6]. The % 6 wraps back around to 0, so the count never runs off the end of the list.',
      start: `Color rainbow[] = {RED, ORANGE, YELLOW, GREEN, BLUE, MAGENTA};
byte offset = 0;
Timer turnTimer;

void setup() {
}

void loop() {
  FOREACH_FACE(f) {
    setColorOnFace(rainbow[f], f);
  }
}
`,
      goal: `Color rainbow[] = {RED, ORANGE, YELLOW, GREEN, BLUE, MAGENTA};
byte offset = 0;
Timer turnTimer;

void setup() {
}

void loop() {
  if (turnTimer.isExpired()) {
    offset = (offset + 1) % 6;
    turnTimer.set(200);
  }
  FOREACH_FACE(f) {
    setColorOnFace(rainbow[(f + offset) % 6], f);
  }
}
`,
      checks: [isRainbow, turns, turnSpeed],
      hints: {
        nudge: 'Two jobs: count offset up with the timer, and use offset when you pick each face\'s color.',
        concept: 'If offset is 1, face 0 shows rainbow[1], face 1 shows rainbow[2], and so on. Every color slides over by one face. % 6 keeps the number between 0 and 5.',
        point: { line: 10, text: 'Use (f + offset) % 6 to pick from the list, not just f.' },
        fill: 'if (turnTimer.isExpired()) {\n  offset = (offset + 1) % 6;\n  turnTimer.set(___);\n}\n...\nsetColorOnFace(rainbow[(f + ______) % 6], f);',
      },
      twist: {
        brief: 'Make the wheel turn clockwise. Careful: offset is a byte, so it can\'t go below 0. On a circle of six, what number takes you one step back?',
        checks: [{
          say: 'The rainbow turns clockwise',
          test(t) {
            const { bad, ms } = wheel(t);
            if (bad) return `${when(bad.at)}, yours was ${t.describe(bad.names)}.`;
            const why = sayMoves(ms, 'The rainbow');
            if (why) return why;
            return ms[0].step === 5 || 'It turned counterclockwise.';
          },
        }],
        solution: `Color rainbow[] = {RED, ORANGE, YELLOW, GREEN, BLUE, MAGENTA};
byte offset = 0;
Timer turnTimer;

void setup() {
}

void loop() {
  if (turnTimer.isExpired()) {
    offset = (offset + 5) % 6;
    turnTimer.set(200);
  }
  FOREACH_FACE(f) {
    setColorOnFace(rainbow[(f + offset) % 6], f);
  }
}
`,
      },
      reflect: {
        q: 'Without the % 6, what would happen when offset gets big?',
        options: ['The code would read past the end of the list', 'The wheel would turn faster', 'Nothing, it would be fine'], answer: 0,
        why: 'The list has six colors, numbered 0 to 5. f + offset soon passes 5. % 6 wraps it back around.',
      },
    },
    {
      id: '5.5', type: 'build', title: 'Say it once', skills: ['functions'],
      brief: 'These six lines are three copies of one idea: a bright face with a dim tail next to it. Write a function glow(Color c, byte f) that lights face f with c, and face f + 1 with dim(c, 30). Use it three times in setup(). Then you can change all three tails in one place.',
      start: `void setup() {
  setColorOnFace(RED, 0);
  setColorOnFace(dim(RED, 60), 1);
  setColorOnFace(GREEN, 2);
  setColorOnFace(dim(GREEN, 60), 3);
  setColorOnFace(BLUE, 4);
  setColorOnFace(dim(BLUE, 60), 5);
}

void loop() {
}
`,
      goal: `void glow(Color c, byte f) {
  setColorOnFace(c, f);
  setColorOnFace(dim(c, 30), f + 1);
}

void setup() {
  glow(RED, 0);
  glow(GREEN, 2);
  glow(BLUE, 4);
}

void loop() {
}
`,
      checks: [
        facesShow({ 0: 'RED', 2: 'GREEN', 4: 'BLUE' }, { say: 'Faces 0, 2 and 4 are RED, GREEN and BLUE' }),
        dimTails,
        ownFunction,
      ],
      hints: {
        nudge: 'Write the function above setup(). It holds the two lines that every pair shares.',
        concept: 'A function is a set of lines with a name. Its parameters are the parts that change each time: here, the color and the face.',
        point: { line: 1, text: 'Write your function above this line, then call it three times inside setup().' },
        fill: 'void glow(Color c, byte f) {\n  setColorOnFace(_, f);\n  setColorOnFace(dim(c, 30), f + _);\n}\n\nvoid setup() {\n  glow(RED, 0);\n  glow(_____, 2);\n  ...',
      },
      twist: {
        brief: 'Use glow() to make a new pattern: heads on faces 1, 3 and 5 in CYAN, YELLOW and MAGENTA. The MAGENTA tail has to wrap around to face 0. Fix it inside glow().',
        checks: [
          facesShow({ 1: 'CYAN', 2: 'dim CYAN', 3: 'YELLOW', 4: 'dim YELLOW', 5: 'MAGENTA', 0: 'dim MAGENTA' }, { say: 'CYAN, YELLOW and MAGENTA heads on faces 1, 3 and 5, with their tails' }),
          ownFunction,
        ],
        solution: `void glow(Color c, byte f) {
  setColorOnFace(c, f);
  setColorOnFace(dim(c, 30), (f + 1) % 6);
}

void setup() {
  glow(CYAN, 1);
  glow(YELLOW, 3);
  glow(MAGENTA, 5);
}

void loop() {
}
`,
      },
      reflect: {
        q: 'You want every tail a little brighter. With glow(), how many places do you change?',
        options: ['One: the line inside glow()', 'Three: once for each color', 'Six: once for each face'], answer: 0,
        why: 'Every call runs the same lines inside glow(). Change them once and all three tails change.',
      },
    },
    {
      id: '5.6', type: 'build', title: 'Comet', skills: ['loops', 'timers'],
      brief: 'Turn this single spinning light into a comet with a fading tail. For each face, work out how far it is behind the head: (head + 6 - f) % 6. The head is 0 behind, the face after it is 1, and so on. Look up each face\'s brightness in the glow list with that number.',
      start: `byte head = 0;
Timer moveTimer;
byte glow[] = {255, 120, 40, 0, 0, 0};

void setup() {
}

void loop() {
  if (moveTimer.isExpired()) {
    head = (head + 1) % 6;
    moveTimer.set(100);
  }
  setColor(OFF);
  setColorOnFace(CYAN, head);
}
`,
      goal: `byte head = 0;
Timer moveTimer;
byte glow[] = {255, 120, 40, 0, 0, 0};

void setup() {
}

void loop() {
  if (moveTimer.isExpired()) {
    head = (head + 1) % 6;
    moveTimer.set(100);
  }
  FOREACH_FACE(f) {
    byte behind = (head + 6 - f) % 6;
    setColorOnFace(dim(CYAN, glow[behind]), f);
  }
}
`,
      checks: [oneHead, headMoves, tailFades],
      hints: {
        nudge: 'Every face needs its own brightness now. That calls for a loop over the faces.',
        concept: 'If the head is on face 3, face 2 is 1 behind and face 1 is 2 behind. Adding 6 before % 6 keeps the number from going below 0 when the head has wrapped around to face 0.',
        point: { line: 13, text: 'Replace these two lines with a FOREACH_FACE loop that lights every face.' },
        fill: 'FOREACH_FACE(f) {\n  byte behind = (head + 6 - f) % 6;\n  setColorOnFace(dim(CYAN, glow[______]), f);\n}',
      },
      bridge: {
        id: '5.6a', type: 'build', title: 'One step behind', skills: ['faces', 'variables'],
        brief: 'A smaller step first. Each click moves the head one face clockwise. Light the face just behind the head with dim(CYAN, 100). When the head is on face 0, the face behind it is face 5.',
        start: `byte head = 2;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    head = (head + 1) % 6;
  }
  setColor(OFF);
  setColorOnFace(CYAN, head);
}
`,
        goal: `byte head = 2;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    head = (head + 1) % 6;
  }
  setColor(OFF);
  setColorOnFace(CYAN, head);
  setColorOnFace(dim(CYAN, 100), (head + 5) % 6);
}
`,
        checks: [
          facesShow({ 0: 'OFF', 1: 'dim CYAN', 2: 'CYAN', 3: 'OFF', 4: 'OFF', 5: 'OFF' }, { say: 'The head is on face 2, and face 1 behind it is dim CYAN' }),
          {
            say: 'After four clicks the head is on face 0, and its tail is on face 5',
            test(t) {
              const tb = t.table().wait(300);
              for (let k = 0; k < 4; k++) tb.click(0);
              const got = tb.faces(0), want = ['CYAN', 'OFF', 'OFF', 'OFF', 'OFF', 'dim CYAN'];
              const wrong = [0, 1, 2, 3, 4, 5].filter(f => got[f] !== want[f]);
              return !wrong.length || t.sayFaces(wrong, got);
            },
          },
        ],
        hints: {
          nudge: 'You need one more line, after the head is lit.',
          concept: 'One step back on a circle of six is the same as five steps forward. (head + 5) % 6 is the face behind the head, even when the head is on face 0.',
          point: { line: 11, text: 'Add a line after this one that lights the face behind the head.' },
          fill: 'setColorOnFace(dim(CYAN, 100), (head + _) % 6);',
        },
      },
      twist: {
        brief: 'Make two comets chasing each other on opposite sides of the Blink. It can be one small change: what if the glow list repeated every three faces?',
        checks: [{
          say: 'Two comets: every face matches the face across from it, and they move',
          test(t) {
            const frames = watch(t, { ms: 1000 });
            const bad = frames.find(fr => [0, 1, 2].some(f => fr.raw[f] !== fr.raw[f + 3]));
            if (bad) return `${when(bad.at)}, yours was ${t.describe(bad.names)}. The two halves didn't match.`;
            const tops = frames.find(fr => fr.levels.filter(l => l === Math.max(...fr.levels)).length !== 2);
            if (tops) return 'There weren\'t two bright heads.';
            return frames.some(fr => fr.raw.join() !== frames[0].raw.join()) || 'They didn\'t move.';
          },
        }],
        solution: `byte head = 0;
Timer moveTimer;
byte glow[] = {255, 120, 40, 0, 0, 0};

void setup() {
}

void loop() {
  if (moveTimer.isExpired()) {
    head = (head + 1) % 6;
    moveTimer.set(100);
  }
  FOREACH_FACE(f) {
    byte behind = (head + 6 - f) % 3;
    setColorOnFace(dim(CYAN, glow[behind]), f);
  }
}
`,
      },
      reflect: {
        q: 'Why add 6 in (head + 6 - f) % 6?',
        options: ['So the number never goes below 0 when the head wraps past face 0', 'To make the comet go faster', 'Because there are six colors'], answer: 0,
        why: 'When the head is on face 0, face 5 is 1 behind. 0 - 5 would be below 0. 0 + 6 - 5 is 1, just right.',
      },
    },
  ],
  boss: {
    id: '5.★', type: 'boss', title: 'Animation Kit', skills: ['functions', 'loops', 'events'],
    brief: 'Build a kit of three animations, each in its own function, and let a click switch between them. spin(): one lit face goes around the Blink, one face at a time. breathe(): all six faces the same color, slowly fading brighter and dimmer, over and over. rainbow(): six different colors that turn. It starts with spin, and each click moves to the next: spin, breathe, rainbow, then back to spin.',
    start: `byte mode = 0;

// One lit face goes around the Blink
void spin() {
}

// All six faces fade brighter, then dimmer, over and over
void breathe() {
}

// Six different colors that turn
void rainbow() {
}

void setup() {
}

void loop() {
  spin();
}
`,
    goal: `byte mode = 0;
Color colors[] = {RED, ORANGE, YELLOW, GREEN, BLUE, MAGENTA};

// One lit face goes around the Blink
void spin() {
  byte head = (millis() / 100) % 6;
  setColor(OFF);
  setColorOnFace(WHITE, head);
}

// All six faces fade brighter, then dimmer, over and over
void breathe() {
  int b = (millis() / 4) % 510;
  if (b > 255) {
    b = 510 - b;
  }
  setColor(dim(BLUE, b));
}

// Six different colors that turn
void rainbow() {
  byte offset = (millis() / 200) % 6;
  FOREACH_FACE(f) {
    setColorOnFace(colors[(f + offset) % 6], f);
  }
}

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    mode = (mode + 1) % 3;
  }
  if (mode == 0) {
    spin();
  } else if (mode == 1) {
    breathe();
  } else {
    rainbow();
  }
}
`,
    checks: [
      plays(0, 'spin', 'It starts with spin'),
      plays(1, 'breathe', 'One click switches to breathe'),
      plays(2, 'rainbow', 'Two clicks switch to rainbow'),
      plays(3, 'spin', 'Three clicks come back to spin'),
      kitFunctions,
    ],
    hints: {
      nudge: 'Get spin() working first. Then add the click, then breathe(), then rainbow().',
      concept: 'mode remembers which animation is playing. A click adds 1, and % 3 wraps it back to 0. loop() calls the function that matches mode.',
      point: { line: 19, text: 'loop() always calls spin(). Make it pick a function by mode, and count mode up on each click.' },
      fill: 'if (buttonSingleClicked()) {\n  mode = (mode + 1) % 3;\n}\nif (mode == 0) {\n  spin();\n} else if (mode == _) {\n  breathe();\n} else {\n  _______();\n}',
    },
    twist: {
      open: true,   // many answers: the Goal Blink shows one idea
      brief: 'Add a fourth animation of your own: a flash, a comet, a sparkle, anything that moves and isn\'t spin, breathe or rainbow again. Three clicks show it, and a fourth click comes back to spin.',
      checks: [
        {
          say: 'Three clicks show a new animation that moves',
          test(t) {
            const a = animation(t, 3);
            if (a.kind) return `After three clicks, it played ${a.kind}.`;
            return !/stayed that way/.test(a.said) || `After three clicks, ${a.said}.`;
          },
        },
        plays(4, 'spin', 'Four clicks come back to spin'),
      ],
      solution: `byte mode = 0;
Color colors[] = {RED, ORANGE, YELLOW, GREEN, BLUE, MAGENTA};

// One lit face goes around the Blink
void spin() {
  byte head = (millis() / 100) % 6;
  setColor(OFF);
  setColorOnFace(WHITE, head);
}

// All six faces fade brighter, then dimmer, over and over
void breathe() {
  int b = (millis() / 4) % 510;
  if (b > 255) {
    b = 510 - b;
  }
  setColor(dim(BLUE, b));
}

// Six different colors that turn
void rainbow() {
  byte offset = (millis() / 200) % 6;
  FOREACH_FACE(f) {
    setColorOnFace(colors[(f + offset) % 6], f);
  }
}

// The whole Blink flashes white
void flash() {
  if ((millis() / 250) % 2 == 0) {
    setColor(WHITE);
  } else {
    setColor(OFF);
  }
}

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    mode = (mode + 1) % 4;
  }
  if (mode == 0) {
    spin();
  } else if (mode == 1) {
    breathe();
  } else if (mode == 2) {
    rainbow();
  } else {
    flash();
  }
}
`,
    },
    reflect: {
      q: 'Why put each animation in its own function?',
      options: ['Each one has a name, so loop() reads like a list of choices', 'Functions make the Blink run faster', 'A Blink can only run code inside functions named after colors'], answer: 0,
      why: 'Naming a chunk of code lets you use it, swap it, or fix it in one place. loop() stays short and easy to read.',
    },
  },
};
