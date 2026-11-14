/*
 * World 1 · Light: commands, arguments, and doing things in order.
 * Game design idea: feedback. Light is the only screen a Blink has.
 */

import { allFaces, facesShow, steady, noWarnings } from '../checks.js';

const RAINBOW = { 0: 'RED', 1: 'ORANGE', 2: 'YELLOW', 3: 'GREEN', 4: 'BLUE', 5: 'MAGENTA' };
const TRAFFIC = { 0: 'GREEN', 1: 'GREEN', 2: 'YELLOW', 3: 'YELLOW', 4: 'RED', 5: 'RED' };

// Move38's orange (250, 70, 22) as a Blink shows it: 5 bits a channel
function isMove38Orange(t, c) {
  const [r, g, b] = [(c >> 1) & 31, (c >> 6) & 31, (c >> 11) & 31];
  return r >= 30 && Math.abs(g - 8) <= 1 && Math.abs(b - 2) <= 1;
}
const orangeFaces = (want, say) => ({
  say,
  test(t) {
    const tb = t.table().wait(300), raw = tb.raw(0), names = tb.faces(0);
    const bad = want.filter(f => !isMove38Orange(t, raw[f]));
    return !bad.length || t.sayFaces(bad, names);
  },
});

export default {
  n: 1, name: 'Light', color: '#facc15', view: 'blocks',
  blurb: 'Tell a Blink what to show. Commands, the numbers you give them, and doing things in order.',
  design: 'Feedback. Light is the only screen a Blink has.',
  levels: [
    {
      id: '1.1', type: 'predict', title: 'Hello, Blink', skills: ['light'],
      brief: 'Every Blinks program has two parts. "When Blink starts" runs once, when the Blink wakes up. In code it\'s called setup(). "Forever" runs over and over; in code, loop(). Read this one, then guess.',
      start: `void setup() {
  setColor(BLUE);
}

void loop() {
}
`,
      predict: {
        q: 'What will this Blink show when it runs?',
        options: [
          { text: 'Blue, and it stays blue', pics: [['B']], right: true, why: 'Right. setup() colors it blue once. Nothing ever changes it, so it stays blue.' },
          { text: 'Blue for a moment, then off', pics: [['B'], ['0']], why: 'setup() only runs once, but the color it sets stays until something changes it. Nothing does here.' },
          { text: 'Blinking blue on and off', pics: [['B'], ['0'], ['B']], why: 'Nothing here turns it off. To blink, a program has to switch the color back and forth.' },
          { text: 'Just one face blue', pics: [['B', '0', '0', '0', '0', '0']], why: 'setColor() colors all six faces at once. Lighting just one face takes a different command.' },
        ],
      },
    },
    {
      id: '1.2', type: 'tweak', title: 'Paint it', skills: ['light'],
      brief: 'Change one word so your Blink matches the Goal Blink.',
      start: `void setup() {
  setColor(BLUE);
}

void loop() {
}
`,
      goal: `void setup() {
  setColor(MAGENTA);
}

void loop() {
}
`,
      checks: [allFaces('MAGENTA')],
      hints: {
        nudge: 'The Goal Blink is a pinkish purple. What is that color called?',
        concept: 'Blinks know these color names: RED, ORANGE, YELLOW, GREEN, CYAN, BLUE, MAGENTA and WHITE. OFF turns a face dark.',
        point: { line: 2, text: 'The color is the word inside setColor( ).' },
        fill: 'setColor(M______);',
      },
      reflect: {
        q: 'What does the word inside setColor( ) do?',
        options: ['It tells setColor which color to use', 'It names the Blink', 'It sets how bright the Blink is'], answer: 0,
        why: 'The value inside the parentheses is an argument. It tells the command what to do.',
      },
    },
    {
      id: '1.3', type: 'build', title: 'Six faces', skills: ['light', 'faces'],
      brief: 'A Blink has six faces, numbered 0 to 5 going clockwise from the top. Light each one its own color to make the rainbow on the Goal Blink. Hover a Blink to see its face numbers.',
      start: `void setup() {
  setColorOnFace(RED, 0);
}

void loop() {
}
`,
      goal: `void setup() {
  setColorOnFace(RED, 0);
  setColorOnFace(ORANGE, 1);
  setColorOnFace(YELLOW, 2);
  setColorOnFace(GREEN, 3);
  setColorOnFace(BLUE, 4);
  setColorOnFace(MAGENTA, 5);
}

void loop() {
}
`,
      checks: [
        facesShow({ 0: 'RED', 1: 'ORANGE' }, { say: 'Faces 0 and 1 are RED and ORANGE' }),
        facesShow({ 2: 'YELLOW', 3: 'GREEN' }, { say: 'Faces 2 and 3 are YELLOW and GREEN' }),
        facesShow({ 4: 'BLUE', 5: 'MAGENTA' }, { say: 'Faces 4 and 5 are BLUE and MAGENTA' }),
      ],
      hints: {
        nudge: 'Face 0 is done. Five more to go, each with its own line.',
        concept: 'setColorOnFace(color, face) lights one face. It takes two things: the color first, then the face number.',
        point: { line: 2, text: 'Copy this line and change the color and the face number.' },
        fill: 'setColorOnFace(ORANGE, _);\nsetColorOnFace(______, 2);',
      },
      twist: {
        brief: 'Make the rainbow run the other way around: RED on face 0, then ORANGE on face 5, YELLOW on face 4, and so on.',
        checks: [facesShow({ 0: 'RED', 5: 'ORANGE', 4: 'YELLOW', 3: 'GREEN', 2: 'BLUE', 1: 'MAGENTA' }, { say: 'The rainbow runs counterclockwise' })],
        solution: `void setup() {
  setColorOnFace(RED, 0);
  setColorOnFace(ORANGE, 5);
  setColorOnFace(YELLOW, 4);
  setColorOnFace(GREEN, 3);
  setColorOnFace(BLUE, 2);
  setColorOnFace(MAGENTA, 1);
}

void loop() {
}
`,
      },
      reflect: {
        q: 'Which face is just clockwise of face 5?',
        options: ['Face 0', 'Face 6', 'Face 4'], answer: 0,
        why: 'There is no face 6. Counting goes 0, 1, 2, 3, 4, 5 and then back around to 0.',
      },
    },
    {
      id: '1.4', type: 'fix', title: 'Face six?', skills: ['faces'],
      brief: 'Going clockwise from the top, faces 0 and 1 should be GREEN, 2 and 3 YELLOW, and 4 and 5 RED. Something is shifted. Find it and fix it.',
      start: `void setup() {
  setColorOnFace(GREEN, 1);
  setColorOnFace(GREEN, 2);
  setColorOnFace(YELLOW, 3);
  setColorOnFace(YELLOW, 4);
  setColorOnFace(RED, 5);
  setColorOnFace(RED, 6);
}

void loop() {
}
`,
      goal: `void setup() {
  setColorOnFace(GREEN, 0);
  setColorOnFace(GREEN, 1);
  setColorOnFace(YELLOW, 2);
  setColorOnFace(YELLOW, 3);
  setColorOnFace(RED, 4);
  setColorOnFace(RED, 5);
}

void loop() {
}
`,
      checks: [
        facesShow({ 0: 'GREEN' }, { say: 'Face 0 is lit' }),
        facesShow(TRAFFIC, { say: 'The colors match the goal' }),
        noWarnings(),
      ],
      hints: {
        nudge: 'Face 0 is dark, and the console complains about a face. Which face numbers does a Blink have?',
        concept: 'Faces are numbered 0 to 5. Counting starts at 0, the way it does in most programming.',
        point: { line: 7, text: 'There is no face 6. Every number in this sketch is one too big.' },
        fill: 'setColorOnFace(GREEN, _);\nsetColorOnFace(GREEN, 1);\n...\nsetColorOnFace(RED, _);',
      },
      bridge: {
        id: '1.4a', type: 'build', title: 'Which face is which?', skills: ['faces'],
        brief: 'A small step first. Light face 0 RED and face 5 BLUE, and leave the rest dark. Hover your Blink to see the face numbers.',
        start: `void setup() {
}

void loop() {
}
`,
        goal: `void setup() {
  setColorOnFace(RED, 0);
  setColorOnFace(BLUE, 5);
}

void loop() {
}
`,
        checks: [facesShow({ 0: 'RED', 1: 'OFF', 2: 'OFF', 3: 'OFF', 4: 'OFF', 5: 'BLUE' }, { say: 'Face 0 is RED, face 5 is BLUE, the rest are off' })],
        hints: {
          nudge: 'You need two lines inside setup().',
          concept: 'setColorOnFace(color, face) lights one face. Faces go 0 to 5, clockwise from the top.',
          point: { line: 1, text: 'Write the two lines between the { and the }.' },
          fill: 'setColorOnFace(RED, _);\nsetColorOnFace(____, 5);',
        },
      },
      reflect: {
        q: 'Why was face 0 dark?',
        options: ['Every face number was one too big, so nothing lit face 0', 'Face 0 is always dark', 'GREEN can\'t go on face 0'], answer: 0,
        why: 'The sketch counted faces from 1. Blinks count from 0, so the first line lit face 1 and nothing lit face 0.',
      },
    },
    {
      id: '1.5', type: 'predict', title: 'Last word wins', skills: ['light', 'order'],
      brief: 'A Blink does the lines in order, top to bottom. Read this one, then guess.',
      start: `void setup() {
  setColor(BLUE);
  setColorOnFace(WHITE, 0);
}

void loop() {
}
`,
      predict: {
        q: 'What will this Blink show?',
        options: [
          { text: 'Blue, with face 0 white', pics: [['W', 'B', 'B', 'B', 'B', 'B']], right: true, why: 'Right. First every face turns blue, then face 0 turns white. The last command for a face is the one you see.' },
          { text: 'All white', pics: [['W']], why: 'setColorOnFace() only changes one face. The other five keep the blue from the line before.' },
          { text: 'All blue', pics: [['B']], why: 'The second line runs too. It changes face 0 after the blue.' },
          { text: 'White, with face 0 blue', pics: [['B', 'W', 'W', 'W', 'W', 'W']], why: 'Look at which command lights which faces. setColor() does all six, setColorOnFace() does one.' },
        ],
      },
    },
    {
      id: '1.6', type: 'build', title: 'Mix your own', skills: ['light'],
      brief: 'Named colors are just the start. makeColorRGB(red, green, blue) mixes any color from three numbers, each 0 to 255. Mix Move38\'s orange: red 250, green 70, blue 22.',
      start: `void setup() {
  setColor(makeColorRGB(255, 255, 255));
}

void loop() {
}
`,
      goal: `void setup() {
  setColor(makeColorRGB(250, 70, 22));
}

void loop() {
}
`,
      checks: [orangeFaces([0, 1, 2, 3, 4, 5], 'All six faces are Move38 orange')],
      hints: {
        nudge: 'Right now all three numbers are 255, which mixes white.',
        concept: 'makeColorRGB(red, green, blue) takes three numbers. 0 means none of that light, 255 means all of it.',
        point: { line: 2, text: 'Change the three numbers to 250, 70 and 22.' },
        fill: 'setColor(makeColorRGB(___, 70, __));',
      },
      reflect: {
        q: 'What would makeColorRGB(0, 0, 0) show?',
        options: ['Nothing: the face is off', 'White', 'Black light'], answer: 0,
        why: 'No red, no green and no blue light means the LED is off.',
      },
    },
  ],
  boss: {
    id: '1.★', type: 'boss', title: 'Badge', skills: ['light', 'faces', 'order'],
    brief: 'Make a Move38 badge from an empty sketch: every face Move38 orange (250, 70, 22), except faces 0 and 3, which are WHITE.',
    start: `void setup() {
}

void loop() {
}
`,
    goal: `void setup() {
  setColor(makeColorRGB(250, 70, 22));
  setColorOnFace(WHITE, 0);
  setColorOnFace(WHITE, 3);
}

void loop() {
}
`,
    checks: [
      orangeFaces([1, 2, 4, 5], 'Faces 1, 2, 4 and 5 are Move38 orange'),
      facesShow({ 0: 'WHITE', 3: 'WHITE' }, { say: 'Faces 0 and 3 are WHITE' }),
      steady(),
    ],
    hints: {
      nudge: 'Start with the color most faces share, then change the two that are different.',
      concept: 'Lines run in order, and the last command for a face wins. setColor() does all six faces, setColorOnFace() does one.',
      point: { line: 1, text: 'Three lines go in setup(): one setColor and two setColorOnFace.' },
      fill: 'setColor(makeColorRGB(250, 70, 22));\nsetColorOnFace(_____, 0);\nsetColorOnFace(WHITE, _);',
    },
    twist: {
      open: true,   // many answers: the Goal Blink shows one idea
      brief: 'Give your badge a stripe of your own: make faces 0 and 3 a color you mix with makeColorRGB, not WHITE.',
      checks: [{
        say: 'Faces 0 and 3 are a color you mixed, the same on both',
        test(t) {
          const tb = t.table().wait(300), raw = tb.raw(0), names = tb.faces(0);
          if (raw[0] !== raw[3]) return `Face 0 was ${names[0]} and face 3 was ${names[3]}.`;
          return !['WHITE', 'OFF'].includes(names[0]) || `They were ${names[0]}.`;
        },
      }],
      solution: `void setup() {
  setColor(makeColorRGB(250, 70, 22));
  setColorOnFace(makeColorRGB(0, 120, 255), 0);
  setColorOnFace(makeColorRGB(0, 120, 255), 3);
}

void loop() {
}
`,
    },
    reflect: {
      q: 'What happens if the setColor line moves to the end of setup()?',
      options: ['Every face turns orange, white stripes and all', 'Nothing changes', 'Faces 0 and 3 go dark'], answer: 0,
      why: 'The last command for a face wins. setColor at the end paints over the two white faces.',
    },
  },
};
