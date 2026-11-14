/*
 * World 2 · Input: conditions (if, else, else if), and events versus states.
 * Game design idea: player action and response. A press should always get an answer.
 */

// ---------- what a Blink showed, said plainly ----------

// one Blink's six faces: "RED", or "RED, OFF, RED, OFF, RED, OFF"
const look = f => f.every(n => n === f[0]) ? f[0] : f.join(', ');
// looks over time: "RED", or "RED, then BLUE"
function story(looks) {
  const out = [];
  for (const l of looks) if (out[out.length - 1] !== l) out.push(l);
  return out.length > 3 ? out.slice(0, 3).join(', then ') + ', and kept changing' : out.join(', then ');
}
const sentence = s => s[0].toUpperCase() + s.slice(1) + '.';
const phrase = s => s[0].toLowerCase() + s.slice(1).replace(/\.$/, '');

// ---------- what the faces should show ----------
// Each takes the six face names and returns true, or what the faces showed.

// every face this color ('RED', 'dim BLUE', 'OFF')
const all = name => Object.assign(f => f.every(n => n === name), { whole: true });
// these faces lit, in any color
const lit = fs => (f, t) => { const bad = fs.filter(k => f[k] === 'OFF'); return !bad.length || t.sayFaces(bad, f); };
// these faces dark
const dark = fs => (f, t) => { const bad = fs.filter(k => f[k] !== 'OFF'); return !bad.length || t.sayFaces(bad, f); };
const both = (...ms) => (f, t) => { for (const m of ms) { const r = m(f, t); if (r !== true) return r; } return true; };

const EVERY = [0, 1, 2, 3, 4, 5], EVEN = [0, 2, 4], ODD = [1, 3, 5];
const ALONE = [[0, 0]], PAIR = [[0, 0], [1, 0]];

// ---------- checks ----------

// Start a table, do `act`, then look at Blink i every 100 ms for `ms`. Every look must match `want`.
function watch({ say, want, when, act, cells = ALONE, settle = 300, ms = 1000, i = 0 }) {
  return {
    say,
    test(t) {
      const tb = t.table(cells).wait(settle);
      act?.(tb);
      const seen = tb.sample(100, ms / 100, x => x.faces(i));
      const miss = seen.map(f => want(f, t)).filter(r => r !== true);
      if (!miss.length) return true;
      return sentence(`${when}, ${want.whole ? 'yours was ' + story(seen.map(look)) : phrase(miss[0])}`);
    },
  };
}
// before anyone touches the button
const idle = (want, say, o = {}) => watch({ say, want, when: 'before you pressed it', ...o });
// while the button is held down (a bit over a second: not long enough for a long press)
const held = (want, say, o = {}) => watch({ say, want, when: 'while you held the button', act: tb => tb.press(o.i || 0).wait(100), ...o });
// after a press of half a second, and letting go
const letGo = (want, say, o = {}) => watch({ say, want, when: 'after you let go', act: tb => tb.press(o.i || 0).wait(500).release(o.i || 0).wait(200), ...o });

// ---------- the boss's checks, shared with its twist ----------
const lampAlone = idle(all('dim BLUE'), 'On its own, it\'s dim BLUE', { when: 'on its own, with no press' });
const lampHeld = held(all('WHITE'), 'While held, it\'s WHITE');
const lampTouching = watch({ say: 'Touching another Blink, it\'s GREEN', want: all('GREEN'), when: 'next to another Blink', cells: PAIR, settle: 500 });
const lampPulled = watch({
  say: 'Pull the other Blink away and it\'s dim BLUE again', want: all('dim BLUE'), when: 'after the other Blink was pulled away',
  cells: PAIR, settle: 500, act: tb => tb.move(1, 3, 0).wait(400),
});
const heldTouching = (color, say) => watch({
  say, want: all(color), when: 'while you held it next to another Blink',
  cells: PAIR, settle: 500, act: tb => tb.press(0).wait(100),
});

export default {
  n: 2, name: 'Input', color: '#fb923c', view: 'blocks',
  blurb: 'Make a Blink answer the player. Read the button, then choose what to show with if and else.',
  design: 'Player action and response. Every press should get an answer.',
  levels: [
    {
      id: '2.1', type: 'predict', title: 'Hold it', skills: ['conditions', 'events'], minutes: 3,
      brief: 'Now the button joins in. buttonDown() is true while someone holds the button down. In blocks it reads "button held down ?". An if runs its lines when its test is true. The else runs its lines when the test is false. Read this one, then guess.',
      start: `void setup() {
}

void loop() {
  if (buttonDown()) {
    setColor(RED);
  } else {
    setColor(BLUE);
  }
}
`,
      predict: {
        q: 'You hold the button down for a while, then let go. What does the Blink show?',
        options: [
          { text: 'RED while you hold it, BLUE after you let go', pics: [['R'], ['B']], right: true, why: 'Right. Every time loop() runs, it asks about the button again. Held down: RED. Not held: BLUE.' },
          { text: 'BLUE while you hold it, RED after you let go', pics: [['B'], ['R']], why: 'Look at the line right under if (buttonDown()). That line is what runs while the button is down.' },
          { text: 'RED once you press it, and it stays RED', pics: [['R'], ['R']], why: 'The else runs whenever the button is not down. After you let go, it paints the Blink BLUE again.' },
          { text: 'BLUE the whole time', pics: [['B'], ['B']], why: 'loop() asks about the button over and over, so it notices when you hold it.' },
        ],
      },
    },
    {
      id: '2.2', type: 'fix', title: 'Stuck on red', skills: ['conditions'],
      brief: 'This Blink should be BLUE, turn RED while you hold the button, and go back to BLUE when you let go. Right now it turns RED and stays that way. Fix it.',
      start: `void setup() {
  setColor(BLUE);
}

void loop() {
  if (buttonDown()) {
    setColor(RED);
  }
}
`,
      goal: `void setup() {
}

void loop() {
  if (buttonDown()) {
    setColor(RED);
  } else {
    setColor(BLUE);
  }
}
`,
      checks: [
        idle(all('BLUE'), 'It\'s BLUE before you press it'),
        held(all('RED'), 'It\'s RED while you hold the button'),
        letGo(all('BLUE'), 'It turns BLUE again when you let go'),
      ],
      hints: {
        nudge: 'Press it and let go. What in the code should turn it BLUE again?',
        concept: 'An if only runs its lines when the test is true. When the test is false, nothing happens, so the last color stays. An else gives the code something to do when the test is false.',
        point: { line: 8, text: 'Add an else right after this }, and set the color to BLUE inside it. In blocks, click the + at the bottom of the if block and pick else.' },
        fill: 'if (buttonDown()) {\n  setColor(RED);\n} ____ {\n  setColor(____);\n}',
      },
      twist: {
        brief: 'Make it a "keep off" light: GREEN when nobody touches it, RED while someone holds the button.',
        checks: [
          idle(all('GREEN'), 'It\'s GREEN before you press it'),
          held(all('RED'), 'It\'s RED while you hold the button'),
          letGo(all('GREEN'), 'It turns GREEN again when you let go'),
        ],
        solution: `void setup() {
}

void loop() {
  if (buttonDown()) {
    setColor(RED);
  } else {
    setColor(GREEN);
  }
}
`,
      },
      reflect: {
        code: `if (buttonDown()) {
  setColor(RED);
}`,
        q: 'You started with this code, with no else. Why did the Blink stay RED?',
        options: ['Nothing in the code set it back to BLUE', 'The button got stuck down', 'An if only runs one time'], answer: 0,
        why: 'A color stays until something changes it. With no else, nothing ever painted the Blink BLUE again.',
      },
    },
    {
      id: '2.3', type: 'order', title: 'Pressure plate', skills: ['conditions', 'order'], minutes: 5,
      brief: 'In a game, a pressure plate shows when someone steps on it. Drag the lines into order so the Blink glows dim YELLOW, then shines bright YELLOW while you hold the button. dim(YELLOW, 80) is YELLOW turned down to 80 out of 255. In blocks it reads "dim YELLOW to 80".',
      goal: `void setup() {
}

void loop() {
  if (buttonDown()) {
    setColor(YELLOW);
  } else {
    setColor(dim(YELLOW, 80));
  }
}
`,
      order: {
        scrambled: [
          'void setup() {',
          '}',
          '',
          'void loop() {',
          '    setColor(YELLOW);',
          '  } else {',
          '  if (buttonDown()) {',
          '  }',
          '    setColor(dim(YELLOW, 80));',
          '}',
        ],
        fixed: ['void setup() {', '}', '', 'void loop() {'],
      },
      checks: [
        idle(all('dim YELLOW'), 'It glows dim YELLOW before you press it'),
        held(all('YELLOW'), 'It\'s bright YELLOW while you hold the button'),
        letGo(all('dim YELLOW'), 'It goes dim again when you let go'),
      ],
      hints: {
        nudge: 'An if comes first, then the lines it runs, then the else and its lines.',
        concept: 'The lines between if (...) { and } else { run when the test is true. The lines between } else { and } run when it is false.',
        point: { line: 7, text: 'This if line goes first, right under void loop() {.' },
        fill: 'void loop() {\n  if (buttonDown()) {\n    setColor(______);\n  } else {\n    setColor(dim(YELLOW, 80));\n  _\n}',
      },
      reflect: {
        code: `if (buttonDown()) {
  setColor(YELLOW);
} else {
  setColor(dim(YELLOW, 80));
}`,
        q: 'What would happen if you swapped the two setColor lines here?',
        options: ['Dim while held, bright the rest of the time', 'Nothing would change', 'It would be bright all the time'], answer: 0,
        why: 'The line under the if runs while the button is down. The line under else runs the rest of the time.',
      },
    },
    {
      id: '2.4', type: 'build', title: 'Secret sign', skills: ['conditions', 'faces'],
      brief: 'Make a secret sign. While you hold the button, light faces 0, 2 and 4 in any color, and keep faces 1, 3 and 5 dark. When you let go, every face goes dark, so no one can see it.',
      start: `void setup() {
}

void loop() {
  if (buttonDown()) {
    setColor(GREEN);
  } else {
    setColor(OFF);
  }
}
`,
      goal: `void setup() {
}

void loop() {
  if (buttonDown()) {
    setColorOnFace(GREEN, 0);
    setColorOnFace(GREEN, 2);
    setColorOnFace(GREEN, 4);
  } else {
    setColor(OFF);
  }
}
`,
      checks: [
        idle(dark(EVERY), 'It\'s dark before you press it'),
        held(lit(EVEN), 'While held, faces 0, 2 and 4 light up'),
        held(dark(ODD), 'While held, faces 1, 3 and 5 stay dark'),
        letGo(dark(EVERY), 'It goes dark again when you let go'),
      ],
      hints: {
        nudge: 'Right now the if lights all six faces. You want just three of them.',
        concept: 'setColor() lights all six faces. setColorOnFace(color, face) lights one. You can put more than one line inside an if.',
        point: { line: 6, text: 'Swap this line for three setColorOnFace lines, one for each face.' },
        fill: 'if (buttonDown()) {\n  setColorOnFace(GREEN, 0);\n  setColorOnFace(GREEN, _);\n  setColorOnFace(GREEN, _);\n} else {\n  setColor(OFF);\n}',
      },
      bridge: {
        id: '2.4a', type: 'build', title: 'Just face 0', skills: ['conditions', 'faces'], minutes: 4,
        brief: 'A smaller step first. While you hold the button, light only face 0. When you let go, every face goes dark.',
        start: `void setup() {
}

void loop() {
  if (buttonDown()) {
    setColor(GREEN);
  } else {
    setColor(OFF);
  }
}
`,
        goal: `void setup() {
}

void loop() {
  if (buttonDown()) {
    setColorOnFace(GREEN, 0);
  } else {
    setColor(OFF);
  }
}
`,
        checks: [
          held(lit([0]), 'While held, face 0 lights up'),
          held(dark([1, 2, 3, 4, 5]), 'While held, the other faces stay dark'),
          letGo(dark(EVERY), 'It goes dark when you let go'),
        ],
        hints: {
          nudge: 'setColor() lights every face. Which command lights just one?',
          concept: 'setColorOnFace(color, face) lights one face. Faces go 0 to 5, clockwise from the top.',
          point: { line: 6, text: 'Change this line so it lights face 0 only. In blocks, use "set face 0 to".' },
          fill: 'setColorOn____(GREEN, 0);',
        },
      },
      twist: {
        brief: 'Make it a two-sided sign: faces 1, 3 and 5 lit when nobody presses it, and faces 0, 2 and 4 lit while held. Only one set at a time.',
        checks: [
          idle(both(lit(ODD), dark(EVEN)), 'Before a press, faces 1, 3 and 5 are lit and the rest are dark'),
          held(both(lit(EVEN), dark(ODD)), 'While held, faces 0, 2 and 4 are lit and the rest are dark'),
          letGo(both(lit(ODD), dark(EVEN)), 'When you let go, it switches back'),
        ],
        solution: `void setup() {
}

void loop() {
  if (buttonDown()) {
    setColor(OFF);
    setColorOnFace(GREEN, 0);
    setColorOnFace(GREEN, 2);
    setColorOnFace(GREEN, 4);
  } else {
    setColor(OFF);
    setColorOnFace(BLUE, 1);
    setColorOnFace(BLUE, 3);
    setColorOnFace(BLUE, 5);
  }
}
`,
      },
      reflect: {
        code: `if (buttonDown()) {
  setColorOnFace(GREEN, 0);
  setColorOnFace(GREEN, 2);
  setColorOnFace(GREEN, 4);
} else {
  setColor(OFF);
}`,
        q: 'In this code, which part turns faces 0, 2 and 4 dark when you let go?',
        options: ['The else', 'The if', 'setup()'], answer: 0,
        why: 'When the button is not down, the test is false, so the else runs. Its setColor(OFF) turns every face dark.',
      },
    },
    {
      id: '2.5', type: 'discover', title: 'Once or always?', skills: ['events'], minutes: 6,
      brief: 'This Blink picks a random color each time its test is true. Hold the button and watch. Then change buttonDown() to buttonPressed() and try again. Then try buttonSingleClicked(). In blocks, pick "held down", "pressed" and "clicked" from the button block\'s menu.',
      start: `void setup() {
}

void loop() {
  if (buttonDown()) {
    setColor(makeColorHSB(random(255), 255, 255));
  }
}
`,
      goal: `void setup() {
}

void loop() {
  if (buttonPressed()) {
    setColor(makeColorHSB(random(255), 255, 255));
  }
}
`,
      checks: [
        {
          say: 'A click gives it a color',
          test(t) {
            const tb = t.table().wait(300).click(0);
            return tb.lit(0) === 6 || `After a click, yours was ${look(tb.faces(0))}.`;
          },
        },
        {
          say: 'Holding the button changes the color once at most',
          test(t) {
            const tb = t.table().wait(300).press(0);
            let last = tb.raw(0).join(), changes = 0;
            for (let k = 0; k < 50; k++) {
              tb.wait(20);
              const now = tb.raw(0).join();
              if (now !== last) changes++;
              last = now;
            }
            return changes <= 1 || `While you held the button for one second, yours changed color ${changes} times.`;
          },
        },
      ],
      ask: {
        q: 'Sort them. Which one is true over and over while you hold the button, and which are true for just one moment?',
        options: [
          'buttonDown() is true the whole time you hold it. buttonPressed() and buttonSingleClicked() are each true for one moment.',
          'All three are true the whole time you hold it.',
          'buttonPressed() is true the whole time you hold it. buttonDown() and buttonSingleClicked() are each true for one moment.',
          'buttonSingleClicked() is true the whole time you hold it. buttonDown() and buttonPressed() are each true for one moment.',
        ],
        answer: 0,
        why: 'Right. buttonDown() is a state: it stays true as long as the button is down, so the colors kept changing. buttonPressed() and buttonSingleClicked() are events: each is true once, at the moment it happens, so you got one new color.',
      },
      hints: {
        nudge: 'Hold the button down with each one. Count how many times the color changes.',
        concept: 'Some tests stay true for as long as something is going on, like "the button is down". Others are true just once, at the moment something happens, like "the button was just pressed".',
        point: { line: 5, text: 'Change buttonDown in this line to buttonPressed, then to buttonSingleClicked.' },
        fill: 'if (button_______()) {',
      },
      reflect: {
        q: 'In a game, one press should fire one shot. Which test fits best?',
        options: ['buttonPressed()', 'buttonDown()'], answer: 0,
        why: 'buttonPressed() is true once for each press. buttonDown() would fire over and over, as fast as loop() runs, for as long as you held it.',
      },
    },
    {
      id: '2.6', type: 'discover', title: 'The vanishing click', skills: ['events', 'conditions'], minutes: 6,
      brief: 'Make a click turn this Blink RED and keep it RED. Until the click, it should be BLUE. First click it as it is, and watch closely. Where did the RED go?',
      start: `void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    setColor(RED);
  } else {
    setColor(BLUE);
  }
}
`,
      goal: `void setup() {
  setColor(BLUE);
}

void loop() {
  if (buttonSingleClicked()) {
    setColor(RED);
  }
}
`,
      checks: [
        idle(all('BLUE'), 'It\'s BLUE before you click it', { when: 'before you clicked it' }),
        watch({ say: 'A click turns it RED, and it stays RED', want: all('RED'), when: 'after your click', act: tb => tb.click(0), ms: 1500 }),
      ],
      ask: {
        q: 'With the else in the code, why did the RED vanish?',
        options: [
          'loop() ran again. The click was over, so the else painted the Blink BLUE.',
          'setColor(RED) only lasts for a short time.',
          'The Blink missed the click.',
          'The else always runs before the if.',
        ],
        answer: 0,
        why: 'Right. loop() runs many times a second. buttonSingleClicked() is true for just one of those times. The very next time, it is false, so the else paints BLUE over the RED.',
      },
      hints: {
        nudge: 'Click it as it is. Does it turn RED at all? Watch very closely.',
        concept: 'loop() runs again and again, many times a second. buttonSingleClicked() is true for only one of those times. A color stays until something changes it.',
        point: { line: 7, text: 'Each time there is no click, this else paints the Blink BLUE. What if it weren\'t there? Then where would the BLUE come from?' },
        fill: 'void setup() {\n  setColor(____);\n}\n\nvoid loop() {\n  if (buttonSingleClicked()) {\n    setColor(RED);\n  }\n}',
      },
      reflect: {
        q: 'The Blink stays RED for good now. What can\'t it do yet?',
        options: ['Go back to BLUE on the next click', 'Turn RED when clicked', 'Start out BLUE'], answer: 0,
        why: 'To switch back and forth, a Blink has to remember which color it is on. That is what World 3 is about.',
      },
    },
  ],
  boss: {
    id: '2.★', type: 'boss', title: 'Signal Lamp', skills: ['conditions', 'events'], minutes: 12,
    cells: [[0, 0], [2, 0]],
    brief: 'Build a signal lamp from an empty sketch. While someone holds the button, it\'s WHITE. If not, but it\'s touching another Blink, it\'s GREEN. Otherwise it\'s dim BLUE, like dim(BLUE, 80). isAlone() is true when no Blink is touching it, and !isAlone() means "not alone". In blocks, use "not" and "alone?". Drag the two Blinks together to try it.',
    start: `void setup() {
}

void loop() {
}
`,
    goal: `void setup() {
}

void loop() {
  if (buttonDown()) {
    setColor(WHITE);
  } else if (!isAlone()) {
    setColor(GREEN);
  } else {
    setColor(dim(BLUE, 80));
  }
}
`,
    checks: [
      lampAlone,
      lampHeld,
      lampTouching,
      heldTouching('WHITE', 'Held while touching another Blink, it\'s WHITE'),
      lampPulled,
    ],
    hints: {
      nudge: 'Start with the button. Then add an else if for touching, and an else for everything else.',
      concept: 'An if can have else ifs. The Blink tries each test from the top, and runs the lines for the first one that is true. If none is true, the else runs.',
      point: { line: 4, text: 'Everything goes inside loop(): one if, one else if and one else. In blocks, click the + at the bottom of the if block to add them.' },
      fill: 'if (buttonDown()) {\n  setColor(_____);\n} else if (!isAlone()) {\n  setColor(GREEN);\n} else {\n  setColor(dim(____, 80));\n}',
    },
    twist: {
      brief: 'Change who wins: touching another Blink beats the button. GREEN when touching, even while held. WHITE only when held on its own.',
      checks: [
        heldTouching('GREEN', 'Held while touching another Blink, it\'s GREEN'),
        lampHeld,
        lampTouching,
        lampAlone,
      ],
      solution: `void setup() {
}

void loop() {
  if (!isAlone()) {
    setColor(GREEN);
  } else if (buttonDown()) {
    setColor(WHITE);
  } else {
    setColor(dim(BLUE, 80));
  }
}
`,
    },
    reflect: {
      code: `if (buttonDown()) {
  setColor(WHITE);
} else if (!isAlone()) {
  setColor(GREEN);
} else {
  setColor(dim(BLUE, 80));
}`,
      q: 'With this code, you hold the lamp while it touches another Blink. Why is it WHITE and not GREEN?',
      options: ['The button is tested first, and the first true test wins', 'WHITE is brighter than GREEN', 'isAlone() is true while you press the button'], answer: 0,
      why: 'Both tests are true, but the Blink tries them in order. The first true one runs, and the rest are skipped.',
    },
  },
};
