/*
 * World 6 · Neighbors: sensing the world, and one program running on many Blinks.
 * Game design idea: space and arrangement. Where you put a piece matters.
 */

import { DIRS } from '../../runtime/world.js';

// ---------- layouts (all at rotation 0, so face f points along DIRS[f]) ----------
const ALONE = [[0, 0]];
const PAIR = [[0, 0], [0, -1]];                            // a second Blink on top, touching face 0
const LINE = [[0, -1], [0, 0], [0, 1]];                    // three in a line, top to bottom
const TRIANGLE = [[0, 0], [1, 0], [0, 1]];                 // three that all touch each other
const RING = DIRS.map(([q, r]) => [q, r]);                 // six around an empty middle
const FLOWER = [[0, 0], ...RING];                          // the ring with its middle filled
const center = n => [[0, 0], ...RING.slice(0, n)];         // a Blink with n neighbors, all on top and to the right
const FAR = [6, 6];                                        // somewhere nobody else is

const LINE_NAMES = ['the top Blink', 'the middle Blink', 'the bottom Blink'];
const TRI_NAMES = ['the top Blink', 'the right Blink', 'the bottom Blink'];
const RING_NAMES = ['the top Blink', 'the upper right Blink', 'the lower right Blink', 'the bottom Blink', 'the lower left Blink', 'the upper left Blink'];
const cap = s => s[0].toUpperCase() + s.slice(1);

// which faces of the Blink at cells[i] touch another Blink
function touching(cells, i) {
  const [q, r] = cells[i];
  const here = new Set(cells.map(([a, b]) => a + ',' + b));
  return [0, 1, 2, 3, 4, 5].filter(f => here.has((q + DIRS[f][0]) + ',' + (r + DIRS[f][1])));
}
// a Blink's color in words: "RED", or "RED, RED, OFF, OFF, OFF, OFF"
const shows = names => names.every(n => n === names[0]) ? names[0] : names.join(', ');
const neighbors = n => n === 1 ? 'one neighbor' : `${['no', 'one', 'two', 'three', 'four', 'five', 'six'][n]} neighbors`;

// Blink i of this layout shows `color` on all six faces, once neighbors have found each other
const colorWith = (cells, i, color, say, who) => ({
  say,
  test(t) {
    const tb = t.table(cells).wait(600), got = tb.faces(i);
    return got.every(n => n === color) || `${cap(who)} was ${shows(got)}.`;
  },
});

// In this layout, faces that touch nobody are lit and faces that touch a neighbor are OFF.
// open: check the faces that touch nobody; shut: check the faces that touch a neighbor.
function outlineSays(t, tb, cells, names, { open = true, shut = true, now = '' } = {}) {
  for (let i = 0; i < cells.length; i++) {
    const got = tb.faces(i), near = touching(cells, i);
    const dark = open ? [0, 1, 2, 3, 4, 5].filter(f => !near.includes(f) && got[f] === 'OFF') : [];
    if (dark.length) return `${cap(names[i])} had ${t.faceList(dark)} dark, and nothing touches ${dark.length > 1 ? 'them' : 'it'}${now}.`;
    const lit = shut ? near.filter(f => got[f] !== 'OFF') : [];
    if (lit.length) return `${cap(names[i])} had ${t.faceList(lit)} lit, and ${lit.length > 1 ? 'those touch' : 'that touches'} a neighbor.`;
  }
  return true;
}

// Is the Blink breathing blue? Watches it for `ms` and returns true or what it did.
function breathesBlue(t, tb, i, ms, { pace = true, when = 'Alone' } = {}) {
  const every = 50;
  const samples = tb.sample(every, ms / every, x => x.raw(i));
  for (const s of samples) {
    const off = s.find(c => { const [r, g] = rgb(c); return r > 0 || g > 0; });
    if (off !== undefined) return `${when}, it showed ${t.colorName(off)}.`;
  }
  const lv = samples.map(s => Math.max(...s.map(level5)));
  const lo = Math.min(...lv), hi = Math.max(...lv);
  if (hi - lo < 12) return `${when}, it stayed ${t.colorName(samples[0][0])} and didn't fade in and out.`;
  if (!pace) return true;
  // the moments it gets bright again, with some room so small wobbles don't count
  const up = lo + (hi - lo) * 0.75, down = lo + (hi - lo) * 0.25;
  const rises = [];
  let low = lv[0] <= down;
  lv.forEach((v, k) => {
    if (low && v >= up) { rises.push(k * every); low = false; }
    else if (!low && v <= down) low = true;
  });
  if (rises.length < 2) return `${when}, it took more than ${Math.round(ms / 2000)} seconds to breathe once.`;
  const period = (rises[rises.length - 1] - rises[0]) / (rises.length - 1);
  if (period < 1500) return `${when}, it breathed once every ${(period / 1000).toFixed(1)} seconds. That's too fast for a slow breath.`;
  if (period > 6000) return `${when}, it breathed once every ${(period / 1000).toFixed(1)} seconds. That's very slow.`;
  return true;
}
const rgb = c => [(c >> 1) & 31, (c >> 6) & 31, (c >> 11) & 31];
const level5 = c => Math.max(...rgb(c));

const alonebreathes = {
  say: 'Alone, it breathes BLUE, slowly',
  test(t) { return breathesBlue(t, t.table(ALONE).wait(300), 0, 12000); },
};

// ---------- Shape Lock ----------
const isGold = names => names.every(n => n === 'YELLOW');
const isDim = raw => raw.every(c => level5(c) <= 20);
// every Blink in the layout is gold, dim or red as it should be. want: 'gold', 'dim' or 'red' for
// each cell; ids: which Blink on the table sits in each cell
function shapeSays(t, tb, cells, names, want, where, ids = cells.map((c, i) => i)) {
  for (let i = 0; i < cells.length; i++) {
    const n = touching(cells, i).length, got = tb.faces(ids[i]), raw = tb.raw(ids[i]);
    const ok = want[i] === 'gold' ? isGold(got) : want[i] === 'red' ? got.every(c => c === 'RED') : isDim(raw) && !isGold(got);
    if (!ok) return `${where}, ${names[i]} had ${neighbors(n)} and was ${shows(got)}.`;
  }
  return true;
}
const shapeCheck = (cells, names, want, where, say) => ({
  say,
  test(t) { return shapeSays(t, t.table(cells).wait(700), cells, names, want, where); },
});
const RING_GOLD = shapeCheck(RING, RING_NAMES, RING.map(() => 'gold'), 'In the ring', 'In a ring of six, every Blink glows gold');
const LINE_MIDDLE = shapeCheck(LINE, LINE_NAMES, ['dim', 'gold', 'dim'], 'In a line of three', 'In a line of three, only the middle one is gold');
const ALONE_DIM = shapeCheck(ALONE, ['the Blink'], ['dim'], 'Alone', 'A Blink alone is dim');

export default {
  n: 6, name: 'Neighbors', color: '#60a5fa', view: 'code',
  blurb: 'Blinks can feel who is touching them. One program, many Blinks, and where you put each one matters.',
  design: 'Space and arrangement. Where you put a piece matters.',
  levels: [
    {
      id: '6.1', type: 'discover', title: 'Who\'s there?', skills: ['neighbors'],
      brief: 'Blinks talk to each other with light through their faces. Drag a Blink by its rim until it touches another one, and watch the faces. Hover a Blink to see what each face hears. Then change the code so a face with a neighbor glows a color you pick.',
      cells: [[0, 0], [2, 0], [0, 2]],
      start: `void setup() {
}

void loop() {
  FOREACH_FACE(f) {
    if (isValueReceivedOnFaceExpired(f)) {
      setColorOnFace(dim(BLUE, 60), f);
    } else {
      setColorOnFace(WHITE, f);
    }
  }
}
`,
      goal: `void setup() {
}

void loop() {
  FOREACH_FACE(f) {
    if (isValueReceivedOnFaceExpired(f)) {
      setColorOnFace(dim(BLUE, 60), f);
    } else {
      setColorOnFace(GREEN, f);
    }
  }
}
`,
      checks: [
        {
          say: 'Faces that touch a neighbor look different from the rest',
          test(t) {
            const cells = [[0, 0], [1, 0]], tb = t.table(cells).wait(600);
            for (const [i, f] of [[0, 2], [1, 5]]) {
              const got = tb.faces(i), same = [0, 1, 2, 3, 4, 5].filter(g => g !== f && got[g] === got[f]);
              if (same.length) return `Two Blinks touched, but face ${f} of one of them was ${got[f]}, just like ${t.faceList(same)}.`;
            }
            return true;
          },
        },
        {
          say: 'A face with a neighbor glows a color you picked, other than WHITE',
          test(t) {
            const got = t.table([[0, 0], [1, 0]]).wait(600).faces(0)[2];
            return !['WHITE', 'OFF'].includes(got) || `The face with a neighbor was ${got}.`;
          },
        },
      ],
      ask: {
        q: 'When two Blinks touch, which faces light up?',
        options: ['Only the faces that touch each other', 'Every face of both Blinks', 'Every face of the Blink you moved', 'Face 0, wherever the neighbor is'],
        answer: 0,
        why: 'Right. Each face only hears the face it touches. isValueReceivedOnFaceExpired(f) is true when face f has heard nothing lately, so nobody is there.',
      },
      hints: {
        nudge: 'Which line runs when a face does have a neighbor? Look at the else part.',
        concept: 'isValueReceivedOnFaceExpired(f) is true when nobody is touching face f. The else part runs when someone is.',
        point: { line: 9, text: 'This line colors the faces that have a neighbor. Change WHITE.' },
        fill: '} else {\n  setColorOnFace(_____, f);\n}',
      },
      reflect: {
        q: 'You never told a Blink where its neighbors are. How does it know?',
        options: ['Each face listens for messages from a face touching it', 'It sees the other Blinks with a camera', 'The table tells it'], answer: 0,
        why: 'Every Blink keeps sending little messages out of all six faces. If a face hears one, somebody is there.',
      },
      minutes: 5,
    },
    {
      id: '6.2', type: 'predict', title: 'Same code, three colors', skills: ['neighbors', 'loops'],
      brief: 'Every Blink on the table runs the very same program. Here are three Blinks in a line, top to bottom. This code counts the faces that have a neighbor. Read it, then guess.',
      cells: LINE,
      start: `void setup() {
}

void loop() {
  int count = 0;
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      count = count + 1;
    }
  }

  if (count == 2) {
    setColor(MAGENTA);
  } else {
    setColor(CYAN);
  }
}
`,
      predict: {
        q: 'What will the three Blinks show, top to bottom?',
        options: [
          { text: 'All three MAGENTA', pics: [['M'], ['M'], ['M']], why: 'Each Blink only counts the Blinks touching it. The top and bottom ones touch just the middle one.' },
          { text: 'CYAN, MAGENTA, CYAN', pics: [['C'], ['M'], ['C']], right: true, why: 'Right. Same code, different places. The middle Blink counts two neighbors and turns MAGENTA. The ends count one each and stay CYAN.' },
          { text: 'All three CYAN', pics: [['C'], ['C'], ['C']], why: 'The middle Blink touches two others, so its count is 2.' },
          { text: 'MAGENTA, CYAN, MAGENTA', pics: [['M'], ['C'], ['M']], why: 'Look at who touches whom. The ends each touch one Blink. The middle one touches two.' },
        ],
      },
      minutes: 4,
    },
    {
      id: '6.3', type: 'build', title: 'Count your friends', skills: ['neighbors', 'variables', 'conditions'],
      brief: 'Color each Blink by how many neighbors it has. 0 neighbors: RED. 1: ORANGE. 2: YELLOW. 3 or more: GREEN. Drag Blinks by their rims to try different shapes.',
      cells: [[0, 0], [0, -1], [1, -1], [-1, 1], [3, 0]],
      start: `void setup() {
}

void loop() {
  int count = 0;
  FOREACH_FACE(f) {
    // add 1 to count when face f has a neighbor
  }

  setColor(RED);
}
`,
      goal: `void setup() {
}

void loop() {
  int count = 0;
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      count = count + 1;
    }
  }

  if (count == 0) {
    setColor(RED);
  } else if (count == 1) {
    setColor(ORANGE);
  } else if (count == 2) {
    setColor(YELLOW);
  } else {
    setColor(GREEN);
  }
}
`,
      checks: [
        colorWith(ALONE, 0, 'RED', 'A Blink alone is RED', 'the Blink alone'),
        colorWith(PAIR, 0, 'ORANGE', 'With one neighbor, a Blink is ORANGE', 'the Blink with one neighbor'),
        colorWith(LINE, 1, 'YELLOW', 'With two neighbors, a Blink is YELLOW', 'the middle Blink of three in a line'),
        {
          say: 'With three or more neighbors, a Blink is GREEN',
          test(t) {
            for (const n of [3, 4, 6]) {
              const got = t.table(center(n)).wait(600).faces(0);
              if (!got.every(c => c === 'GREEN')) return `The Blink with ${neighbors(n)} was ${shows(got)}.`;
            }
            return true;
          },
        },
      ],
      hints: {
        nudge: 'Two jobs: first count the neighbors, then pick a color for the count.',
        concept: 'Inside FOREACH_FACE(f), !isValueReceivedOnFaceExpired(f) is true when face f has a neighbor. Then if, else if and else pick one color.',
        point: { line: 7, text: 'Add 1 to count here, but only when face f has a neighbor.' },
        fill: 'if (!isValueReceivedOnFaceExpired(f)) {\n  count = _____ + 1;\n}\n...\nif (count == 0) {\n  setColor(RED);\n} else if (count == _) {\n  setColor(ORANGE);\n} ...\n} else {\n  setColor(_____);\n}',
      },
      bridge: {
        id: '6.3a', type: 'build', title: 'Anybody home?', skills: ['neighbors', 'variables'],
        brief: 'A smaller step first. This Blink should be GREEN when it has a neighbor and RED when it\'s alone. The colors are done. The count never goes up. Make it count.',
        cells: [[0, 0], [0, -1], [2, 0]],
        start: `void setup() {
}

void loop() {
  int count = 0;
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      // a neighbor is on face f
    }
  }

  if (count == 0) {
    setColor(RED);
  } else {
    setColor(GREEN);
  }
}
`,
        goal: `void setup() {
}

void loop() {
  int count = 0;
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      count = count + 1;
    }
  }

  if (count == 0) {
    setColor(RED);
  } else {
    setColor(GREEN);
  }
}
`,
        checks: [
          colorWith(ALONE, 0, 'RED', 'A Blink alone is RED', 'the Blink alone'),
          colorWith(PAIR, 0, 'GREEN', 'A Blink with a neighbor is GREEN', 'the Blink with one neighbor'),
          colorWith(LINE, 1, 'GREEN', 'A Blink with two neighbors is GREEN too', 'the middle Blink of three in a line'),
        ],
        hints: {
          nudge: 'count starts at 0 every time loop() runs. Nothing ever makes it bigger.',
          concept: 'count = count + 1; makes count one bigger. Put it where it only runs for a face with a neighbor.',
          point: { line: 8, text: 'Replace this comment with a line that adds 1 to count.' },
          fill: 'count = _____ + 1;',
        },
      },
      twist: {
        brief: 'Give 4, 5 and 6 neighbors their own colors: 4 is CYAN, 5 is BLUE, 6 is MAGENTA. 3 stays GREEN.',
        checks: [
          colorWith(center(3), 0, 'GREEN', 'With three neighbors, a Blink is GREEN', 'the Blink with three neighbors'),
          colorWith(center(4), 0, 'CYAN', 'With four, it\'s CYAN', 'the Blink with four neighbors'),
          colorWith(center(5), 0, 'BLUE', 'With five, it\'s BLUE', 'the Blink with five neighbors'),
          colorWith(FLOWER, 0, 'MAGENTA', 'With six, it\'s MAGENTA', 'the Blink with six neighbors'),
        ],
        solution: `void setup() {
}

void loop() {
  int count = 0;
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      count = count + 1;
    }
  }

  if (count == 0) {
    setColor(RED);
  } else if (count == 1) {
    setColor(ORANGE);
  } else if (count == 2) {
    setColor(YELLOW);
  } else if (count == 3) {
    setColor(GREEN);
  } else if (count == 4) {
    setColor(CYAN);
  } else if (count == 5) {
    setColor(BLUE);
  } else {
    setColor(MAGENTA);
  }
}
`,
      },
      reflect: {
        q: 'Four Blinks run this code, and each shows a different color. Why?',
        options: ['Each one counts the neighbors in its own spot', 'Each one got a different program', 'Colors are picked at random'], answer: 0,
        why: 'Every Blink runs the same program. Where you put it changes what it counts, so it changes what it shows.',
      },
      minutes: 10,
    },
    {
      id: '6.4', type: 'fix', title: 'Ghost neighbor', skills: ['neighbors', 'conditions'],
      brief: 'Each Blink sends the number 1 out of every face to say hi. A face that hears a 1 lights up. Drag the top Blink away by its rim. Its old spot stays lit, as if a ghost were there. Fix it, so a face goes dark when its neighbor leaves.',
      cells: PAIR,
      start: `void setup() {
  setValueSentOnAllFaces(1);
}

void loop() {
  FOREACH_FACE(f) {
    if (getLastValueReceivedOnFace(f) == 1) {
      setColorOnFace(WHITE, f);
    } else {
      setColorOnFace(OFF, f);
    }
  }
}
`,
      goal: `void setup() {
  setValueSentOnAllFaces(1);
}

void loop() {
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f) && getLastValueReceivedOnFace(f) == 1) {
      setColorOnFace(WHITE, f);
    } else {
      setColorOnFace(OFF, f);
    }
  }
}
`,
      checks: [
        {
          say: 'A face lights up when a neighbor touches it',
          test(t) {
            const got = t.table(PAIR).wait(600).faces(0);
            if (got[0] === 'OFF') return 'A Blink sat on top, touching face 0, but face 0 stayed dark.';
            const extra = [1, 2, 3, 4, 5].filter(f => got[f] !== 'OFF');
            return !extra.length || `Only face 0 had a neighbor, but ${t.faceList(extra)} lit up too.`;
          },
        },
        {
          say: 'When the neighbor leaves, that face goes dark',
          test(t) {
            const got = t.table(PAIR).wait(600).move(1, ...FAR).wait(600).faces(0);
            return got[0] === 'OFF' || `The top Blink moved away, but face 0 stayed ${got[0]}.`;
          },
        },
        {
          say: 'Move the neighbor to another side: the new face lights, the old one goes dark',
          test(t) {
            const got = t.table(PAIR).wait(600).move(1, 1, 0).wait(600).faces(0);
            if (got[2] === 'OFF') return 'The neighbor moved to face 2, but face 2 stayed dark.';
            return got[0] === 'OFF' || `The neighbor moved from face 0 to face 2, but face 0 stayed ${got[0]}.`;
          },
        },
      ],
      hints: {
        nudge: 'Drag the top Blink away and hover the bottom one. Face 0 still has the last value it heard.',
        concept: 'getLastValueReceivedOnFace(f) keeps the last value it got, even after the neighbor is gone. isValueReceivedOnFaceExpired(f) tells you if that value is old.',
        point: { line: 7, text: 'Light the face only if the value is fresh too. Use && to ask both things.' },
        fill: 'if (!isValueReceivedOnFaceExpired(_) && getLastValueReceivedOnFace(f) == 1) {',
      },
      twist: {
        brief: 'Click a Blink to make it send 2 instead of 1. Faces that hear a 2 glow BLUE. Faces that hear a 1 still glow WHITE. No ghosts!',
        checks: [
          {
            say: 'Click the top Blink: the face below it turns BLUE',
            test(t) {
              const tb = t.table(PAIR).wait(600);
              const before = tb.faces(0)[0];
              if (before !== 'WHITE') return `Before any click, face 0 of the bottom Blink was ${before}.`;
              const after = tb.click(1).wait(400).faces(0)[0];
              return after === 'BLUE' || `After the click, face 0 of the bottom Blink was ${after}.`;
            },
          },
          {
            say: 'Still no ghosts: when it leaves, the face goes dark',
            test(t) {
              const got = t.table(PAIR).wait(600).click(1).wait(400).move(1, ...FAR).wait(600).faces(0)[0];
              return got === 'OFF' || `The top Blink moved away, but face 0 stayed ${got}.`;
            },
          },
        ],
        solution: `void setup() {
  setValueSentOnAllFaces(1);
}

void loop() {
  if (buttonSingleClicked()) {
    setValueSentOnAllFaces(2);
  }
  FOREACH_FACE(f) {
    if (isValueReceivedOnFaceExpired(f)) {
      setColorOnFace(OFF, f);
    } else if (getLastValueReceivedOnFace(f) == 2) {
      setColorOnFace(BLUE, f);
    } else {
      setColorOnFace(WHITE, f);
    }
  }
}
`,
      },
      reflect: {
        q: 'Why did the face stay lit after its neighbor left?',
        options: ['getLastValueReceivedOnFace() keeps the last value, even when nobody is there', 'The neighbor was still sending from far away', 'WHITE can\'t be turned off'], answer: 0,
        why: 'The last value stays until a new one arrives. Check isValueReceivedOnFaceExpired(f) first to know if anyone is still there.',
      },
      minutes: 8,
    },
    {
      id: '6.5', type: 'build', title: 'Outline', skills: ['neighbors', 'faces', 'loops'],
      brief: 'Draw the outline of a group. Light every face that touches nobody, in any color. Turn off every face that touches a neighbor. Drag Blinks by their rims into a shape and watch its edge glow.',
      cells: [[0, 0], [1, 0], [0, 1], [1, -1]],
      start: `void setup() {
}

void loop() {
  FOREACH_FACE(f) {
  }
}
`,
      goal: `void setup() {
}

void loop() {
  FOREACH_FACE(f) {
    if (isValueReceivedOnFaceExpired(f)) {
      setColorOnFace(CYAN, f);
    } else {
      setColorOnFace(OFF, f);
    }
  }
}
`,
      checks: [
        {
          say: 'In a group, faces that touch nobody glow',
          test(t) { return outlineSays(t, t.table(TRIANGLE).wait(600), TRIANGLE, TRI_NAMES, { shut: false }); },
        },
        {
          say: 'Faces that touch a neighbor are dark',
          test(t) { return outlineSays(t, t.table(TRIANGLE).wait(600), TRIANGLE, TRI_NAMES, { open: false }); },
        },
        {
          say: 'A Blink alone glows on all six faces',
          test(t) {
            const got = t.table(ALONE).wait(600).faces(0), dark = [0, 1, 2, 3, 4, 5].filter(f => got[f] === 'OFF');
            return !dark.length || `The Blink alone had ${t.faceList(dark)} dark.`;
          },
        },
        {
          say: 'When a Blink leaves, the faces it touched glow again',
          test(t) {
            const tb = t.table(TRIANGLE).wait(600).move(2, ...FAR).wait(600);
            const r = outlineSays(t, tb, TRIANGLE.slice(0, 2), TRI_NAMES, { shut: false, now: ' now' });
            return r === true || 'The bottom Blink moved away. ' + r;
          },
        },
      ],
      hints: {
        nudge: 'This is level 6.1 turned around. Which faces lit up there?',
        concept: 'isValueReceivedOnFaceExpired(f) is true when nobody touches face f. Those are the faces on the edge.',
        point: { line: 5, text: 'Inside FOREACH_FACE, use if and else to light face f or turn it off.' },
        fill: 'if (isValueReceivedOnFaceExpired(f)) {\n  setColorOnFace(____, f);\n} else {\n  setColorOnFace(___, f);\n}',
      },
      twist: {
        brief: 'A Blink alone isn\'t part of a group, so it has no outline. Make a Blink alone stay dark. Groups still glow around their edge.',
        checks: [
          {
            say: 'A Blink alone stays dark',
            test(t) {
              const got = t.table(ALONE).wait(600).faces(0), lit = t.litFaces(got);
              return !lit.length || `The Blink alone had ${t.faceList(lit)} lit.`;
            },
          },
          {
            say: 'In a group, faces that touch nobody glow and the rest are dark',
            test(t) { return outlineSays(t, t.table(TRIANGLE).wait(600), TRIANGLE, TRI_NAMES); },
          },
        ],
        solution: `void setup() {
}

void loop() {
  FOREACH_FACE(f) {
    if (isAlone()) {
      setColorOnFace(OFF, f);
    } else if (isValueReceivedOnFaceExpired(f)) {
      setColorOnFace(CYAN, f);
    } else {
      setColorOnFace(OFF, f);
    }
  }
}
`,
      },
      reflect: {
        q: 'Six Blinks in a ring around an empty middle. Which faces glow?',
        options: ['The outside faces and the faces facing the hole', 'Only the outside faces', 'None of them'], answer: 0,
        why: 'A Blink can\'t tell the outside from a hole. A face that touches nobody glows, wherever it points.',
      },
      minutes: 8,
    },
    {
      id: '6.6', type: 'build', title: 'Lonely', skills: ['neighbors', 'timers'],
      brief: 'This Blink breathes BLUE all the time. Make it breathe only when it\'s alone. When it touches anyone, it glows ORANGE and stays still. isAlone() is true when no face has a neighbor.',
      cells: [[0, 0], [0, -1], [2, -1]],
      start: `void setup() {
}

void loop() {
  byte wave = sin8_C(millis() / 10);
  setColor(dim(BLUE, wave));
}
`,
      goal: `void setup() {
}

void loop() {
  if (isAlone()) {
    byte wave = sin8_C(millis() / 10);
    setColor(dim(BLUE, wave));
  } else {
    setColor(ORANGE);
  }
}
`,
      checks: [
        alonebreathes,
        {
          say: 'Touching anyone, it glows ORANGE and stays still',
          test(t) {
            const tb = t.table(PAIR).wait(600);
            const seen = tb.sample(100, 30, x => [x.faces(0), x.faces(1)]);
            for (const [k, both] of seen.entries()) {
              for (const i of [0, 1]) {
                if (!both[i].every(c => c === 'ORANGE')) return `Two Blinks touched, and after ${((600 + k * 100) / 1000).toFixed(1)} seconds the ${i ? 'top' : 'bottom'} one was ${shows(both[i])}.`;
              }
            }
            return true;
          },
        },
        {
          say: 'When its friend leaves, it breathes again',
          test(t) {
            const tb = t.table(PAIR).wait(600).move(1, ...FAR).wait(600);
            return breathesBlue(t, tb, 0, 6000, { pace: false, when: 'After its friend left' });
          },
        },
      ],
      hints: {
        nudge: 'Two choices: alone, or not alone. That sounds like if and else.',
        concept: 'isAlone() is true when nobody touches any face. Put the breathing inside if (isAlone()) and the ORANGE in the else.',
        point: { line: 5, text: 'Wrap these two lines in if (isAlone()) { ... }, then add an else.' },
        fill: 'if (_______()) {\n  byte wave = sin8_C(millis() / 10);\n  setColor(dim(BLUE, wave));\n} else {\n  setColor(______);\n}',
      },
      twist: {
        brief: 'Make it shy. With one or two neighbors it glows ORANGE. In a crowd of three or more it hides: every face OFF.',
        checks: [
          alonebreathes,
          colorWith(LINE, 1, 'ORANGE', 'With two neighbors, it glows ORANGE', 'the middle Blink of three in a line'),
          colorWith(center(3), 0, 'OFF', 'With three or more, it hides (OFF)', 'the Blink with three neighbors'),
        ],
        solution: `void setup() {
}

void loop() {
  int count = 0;
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      count = count + 1;
    }
  }

  if (count == 0) {
    byte wave = sin8_C(millis() / 10);
    setColor(dim(BLUE, wave));
  } else if (count <= 2) {
    setColor(ORANGE);
  } else {
    setColor(OFF);
  }
}
`,
      },
      reflect: {
        q: 'What does isAlone() check?',
        options: ['That no face has a neighbor', 'That at least one face is empty', 'That the button isn\'t pressed'], answer: 0,
        why: 'isAlone() is true only when all six faces are empty. It saves you from checking all six faces with FOREACH_FACE.',
      },
      minutes: 8,
    },
  ],
  boss: {
    id: '6.★', type: 'boss', title: 'Shape Lock', skills: ['neighbors', 'variables', 'conditions'],
    brief: 'A puzzle lock made of Blinks. Each Blink is happy with exactly two neighbors: then it glows gold (YELLOW). With any other number, it glows dim, like dim(WHITE, 60). Only a closed ring makes the whole group glow gold. Start from an empty sketch, then drag Blinks by their rims to try other shapes.',
    cells: RING,
    start: `void setup() {
}

void loop() {
}
`,
    goal: `void setup() {
}

void loop() {
  int count = 0;
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      count = count + 1;
    }
  }

  if (count == 2) {
    setColor(YELLOW);
  } else {
    setColor(dim(WHITE, 60));
  }
}
`,
    checks: [
      RING_GOLD,
      LINE_MIDDLE,
      ALONE_DIM,
      shapeCheck(FLOWER, ['the middle Blink', ...RING_NAMES], FLOWER.map(() => 'dim'), 'With the middle filled in', 'Fill the middle of the ring, and every Blink goes dim'),
      {
        say: 'Open the ring: the Blinks beside the gap go dim',
        test(t) {
          const tb = t.table(RING).wait(700).move(0, ...FAR).wait(700);
          const want = ['dim', 'gold', 'gold', 'gold', 'dim'];
          return shapeSays(t, tb, RING.slice(1), RING_NAMES.slice(1), want, 'After the top Blink left', [1, 2, 3, 4, 5]);
        },
      },
    ],
    hints: {
      nudge: 'You counted neighbors in 6.3. This time only one count is special.',
      concept: 'Count the faces with a neighbor, using FOREACH_FACE and !isValueReceivedOnFaceExpired(f). Then if (count == 2) picks gold, and else picks dim.',
      point: { line: 4, text: 'Your count and your colors go inside loop().' },
      fill: 'int count = 0;\nFOREACH_FACE(f) {\n  if (!isValueReceivedOnFaceExpired(f)) {\n    count = count + 1;\n  }\n}\nif (count == _) {\n  setColor(______);\n} else {\n  setColor(dim(WHITE, 60));\n}',
    },
    twist: {
      brief: 'Show where the shape goes wrong. A Blink with three or more neighbors glows RED. Exactly two is still gold. Fewer is still dim.',
      checks: [
        shapeCheck(FLOWER, ['the middle Blink', ...RING_NAMES], FLOWER.map(() => 'red'), 'With the middle filled in', 'Three or more neighbors glow RED'),
        LINE_MIDDLE,
        ALONE_DIM,
      ],
      solution: `void setup() {
}

void loop() {
  int count = 0;
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      count = count + 1;
    }
  }

  if (count == 2) {
    setColor(YELLOW);
  } else if (count >= 3) {
    setColor(RED);
  } else {
    setColor(dim(WHITE, 60));
  }
}
`,
    },
    reflect: {
      q: 'What is the smallest closed ring that makes every Blink glow gold?',
      options: ['Three Blinks that all touch each other', 'Six Blinks around an empty middle', 'Two Blinks side by side'], answer: 0,
      why: 'In a tight triangle, each Blink touches the other two. Exactly two neighbors each, so all three glow gold.',
    },
    minutes: 12,
  },
};
