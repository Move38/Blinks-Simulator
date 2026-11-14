/*
 * World 3 · Memory: variables, storing a value, bool and byte, wrapping around with %, and lists.
 * Game design idea: game state and score. The Blink keeps what matters in variables and draws
 * its faces from them.
 */

import { allFaces } from '../checks.js';

const COLORS = ['RED', 'YELLOW', 'GREEN', 'CYAN', 'BLUE', 'MAGENTA'];
const ALL = [0, 1, 2, 3, 4, 5];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clicks = n => plural(n, 'click');

// Click Blink i, then watch every millisecond until the click has counted. Returns what the
// faces showed each moment, as joined names, so a color that flashed for one frame is still seen.
function clickAndWatch(tb, i = 0) {
  tb.press(i).wait(60).release(i);
  return tb.sample(1, 450, x => x.faces(i).join());
}
const allOf = c => ALL.map(() => c).join();

// After a click the Blink shows `want` on every face, and doesn't drop back to `was`.
// It says so when the color only flashed for a moment.
function clickTurns(want, { say, was, settle = 0 }) {
  return {
    say,
    test(t) {
      const tb = t.table().wait(300);
      const seen = clickAndWatch(tb);
      tb.wait(settle);
      const now = tb.faces();
      if (now.every(n => n === want)) return true;
      if (seen.includes(allOf(want))) return `It turned ${want} for a moment, then went back to ${t.describe(now)}.`;
      if (was && now.every(n => n === was)) return `After the click it was still all ${was}.`;
      return `After the click it was ${t.describe(now)}.`;
    },
  };
}

// The color after each of `n` clicks. want(k) is the color after k clicks.
function cycle(n, want, say) {
  return {
    say,
    test(t) {
      const tb = t.table().wait(300);
      for (let k = 1; k <= n; k++) {
        tb.click();
        const got = tb.faces();
        if (!got.every(c => c === want(k))) return `After ${clicks(k)} yours was ${t.describe(got)}. It should be all ${want(k)}.`;
      }
      return true;
    },
  };
}

// Which faces are lit, as a sentence: "faces 0, 1 and 2 lit" or "no faces lit"
const sayLit = (t, faces) => {
  const lit = t.litFaces(faces);
  return lit.length === 6 ? 'all six faces lit' : `${t.faceList(lit)} lit`;
};
// Faces 0 up to n-1 lit (any color) and the rest off
const showsCount = (faces, n) => faces.every((c, f) => (f < n) === (c !== 'OFF'));
// No warnings by the end of a check's run (a face or list item past the end, and so on)
const noWarn = tb => !tb.warns.length || tb.warns[0].replace(/\.$/, '') + '.';

export default {
  n: 3, name: 'Memory', color: '#e879f9', view: 'blocks',
  blurb: 'Give a Blink a memory. Variables keep a value from one loop() to the next: a click, a count, a score.',
  design: 'Game state. The score lives in a variable, and the faces are drawn from it.',
  levels: [
    {
      id: '3.1', type: 'build', title: 'Keep the click', skills: ['variables', 'events', 'conditions'], minutes: 8,
      brief: 'In the last world, a click turned this Blink RED for just a moment. Then loop() ran again, nothing was clicked, and the else painted it BLUE. The Blink needs to remember the click. A variable is a named box that holds a value. This sketch has one called clicked. It is a bool, which holds true or false, and it starts out false. Make a click set clicked to true. Then color the Blink RED when clicked is true, and BLUE when it is not.',
      start: `bool clicked = false;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    setColor(RED);
  } else {
    setColor(BLUE);
  }
}
`,
      goal: `bool clicked = false;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    clicked = true;
  }
  if (clicked) {
    setColor(RED);
  } else {
    setColor(BLUE);
  }
}
`,
      checks: [
        allFaces('BLUE', { say: 'It starts BLUE' }),
        clickTurns('RED', { say: 'A click turns it RED', was: 'BLUE' }),
        {
          say: 'It stays RED, even after more clicks',
          test(t) {
            const tb = t.table().wait(300).click();
            const seen = tb.sample(100, 30, x => x.faces().join());
            const k = seen.findIndex(s => s !== allOf('RED'));
            if (k === 0) return `Right after the click it was ${t.describe(seen[0].split(','))}.`;
            if (k > 0) return `It went back to ${t.describe(seen[k].split(','))} after ${k * 100} ms.`;
            tb.click();
            return tb.faces().every(c => c === 'RED') || `After a second click it was ${t.describe(tb.faces())}.`;
          },
        },
      ],
      hints: {
        nudge: 'buttonSingleClicked() is true for just one loop(). Something has to remember that the click happened.',
        concept: 'A variable made above setup() keeps its value the whole time the Blink runs. In blocks, "set clicked to true" stores a value in it. You can use clicked inside an if, just like a button check.',
        point: { line: 8, text: 'Instead of coloring the Blink here, set clicked to true. Then color it in a new if that checks clicked.' },
        fill: 'if (buttonSingleClicked()) {\n  clicked = ____;\n}\nif (_______) {\n  setColor(RED);\n} else {\n  setColor(BLUE);\n}',
      },
      twist: {
        brief: 'Give it a way to forget: a double-click sets clicked back to false, so the Blink turns BLUE again. The next click turns it RED.',
        checks: [{
          say: 'A double-click turns it BLUE, and a click turns it RED again',
          test(t) {
            const tb = t.table().wait(300).click();
            if (tb.faces().some(c => c !== 'RED')) return `After a click it was ${t.describe(tb.faces())}.`;
            tb.doubleClick();
            if (tb.faces().some(c => c !== 'BLUE')) return `After the double-click it was ${t.describe(tb.faces())}.`;
            tb.click();
            return tb.faces().every(c => c === 'RED') || `After one more click it was ${t.describe(tb.faces())}.`;
          },
        }],
        solution: `bool clicked = false;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    clicked = true;
  }
  if (buttonDoubleClicked()) {
    clicked = false;
  }
  if (clicked) {
    setColor(RED);
  } else {
    setColor(BLUE);
  }
}
`,
      },
      reflect: {
        q: 'On the next loop(), buttonSingleClicked() is false again. Why does the Blink stay RED?',
        options: ['clicked is still true, and the color comes from clicked', 'The button stays clicked', 'RED can\'t be changed once it is on'], answer: 0,
        why: 'The click only lasts one loop(). The variable keeps it, so every loop() after that still sees clicked is true.',
      },
    },
    {
      id: '3.2', type: 'predict', title: 'Flip', skills: ['variables'], minutes: 4,
      brief: 'The ! sign means "not". It turns true into false, and false into true. In blocks it says "not". So lit = !lit means "set lit to the opposite of what it is now". Read this sketch, then guess.',
      start: `bool lit = false;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    lit = !lit;
  }
  if (lit) {
    setColor(GREEN);
  } else {
    setColor(OFF);
  }
}
`,
      predict: {
        q: 'You click the button three times, slowly. What does the Blink show after each click?',
        options: [
          { text: 'GREEN, then off, then GREEN', pics: [['G'], ['0'], ['G']], right: true, why: 'Right. lit starts false. Each click flips it: true, then false, then true again.' },
          { text: 'GREEN, GREEN, GREEN', pics: [['G'], ['G'], ['G']], why: 'lit = !lit doesn\'t set lit to true. It sets it to the opposite of what it was, so the second click turns it back to false.' },
          { text: 'Off, then GREEN, then off', pics: [['0'], ['G'], ['0']], why: 'lit starts false, so the first click flips it to true. The first click turns it GREEN.' },
          { text: 'GREEN, then off, then off', pics: [['G'], ['0'], ['0']], why: 'The ! flips lit on every click. The third click flips false back to true.' },
        ],
      },
    },
    {
      id: '3.3', type: 'build', title: 'Color cycle', skills: ['variables', 'events'], minutes: 10,
      brief: 'A byte is a variable that holds a whole number. colors is a list of six colors, and current says which one to show: item 0 is RED, item 1 is YELLOW, and so on. Make each click add 1 to current. After MAGENTA, the next click goes back to RED. The % sign helps: it gives the remainder after dividing. (current + 1) % 6 counts 0, 1, 2, 3, 4, 5, then back to 0.',
      start: `Color colors[] = { RED, YELLOW, GREEN, CYAN, BLUE, MAGENTA };
byte current = 0;

void setup() {
}

void loop() {
  setColor(colors[current]);
}
`,
      goal: `Color colors[] = { RED, YELLOW, GREEN, CYAN, BLUE, MAGENTA };
byte current = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    current = (current + 1) % 6;
  }
  setColor(colors[current]);
}
`,
      checks: [
        allFaces('RED', { say: 'It starts RED' }),
        cycle(5, k => COLORS[k], 'Each click shows the next color in the list'),
        {
          say: 'After MAGENTA, a click goes back to RED',
          test(t) {
            const tb = t.table().wait(300);
            for (let k = 0; k < 6; k++) tb.click();
            const got = tb.faces();
            if (got.some(c => c !== 'RED')) return `After 6 clicks yours was ${t.describe(got)}.${tb.warns.length ? ' current went past the end of the list.' : ''}`;
            tb.click();
            return tb.faces().every(c => c === 'YELLOW') || `After 7 clicks yours was ${t.describe(tb.faces())}. It should be all YELLOW.`;
          },
        },
      ],
      hints: {
        nudge: 'Nothing changes current yet. A click should add 1 to it.',
        concept: 'current = (current + 1) % 6 stores a new value in current: one more, wrapped back to 0 after 5. In blocks, % is in the math block\'s menu as "% (mod)".',
        point: { line: 8, text: 'Above this line, add an if for the click. Inside it, change current.' },
        fill: 'if (buttonSingleClicked()) {\n  current = (current + _) % _;\n}\nsetColor(colors[current]);',
      },
      twist: {
        brief: 'Add a double-click that goes back one color. From YELLOW it goes to RED, and from RED it goes to MAGENTA. Careful at RED: a byte can\'t go below 0.',
        checks: [{
          say: 'Each double-click goes back one color',
          test(t) {
            const tb = t.table().wait(300).click().click();
            for (let k = 1; k <= 3; k++) {
              tb.doubleClick();
              const want = COLORS[(2 - k + 6) % 6], got = tb.faces();
              if (got.some(c => c !== want)) return `From GREEN, after ${plural(k, 'double-click')} yours was ${t.describe(got)}. It should be all ${want}.${tb.warns.length ? ' current went past the end of the list.' : ''}`;
            }
            return true;
          },
        }],
        solution: `Color colors[] = { RED, YELLOW, GREEN, CYAN, BLUE, MAGENTA };
byte current = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    current = (current + 1) % 6;
  }
  if (buttonDoubleClicked()) {
    current = (current + 5) % 6;
  }
  setColor(colors[current]);
}
`,
      },
      reflect: {
        q: 'current is 5, showing MAGENTA. What is (current + 1) % 6?',
        options: ['0', '6', '1'], answer: 0,
        why: '5 + 1 is 6, and 6 divided by 6 leaves a remainder of 0. So the next color is item 0, RED.',
      },
    },
    {
      id: '3.4', type: 'fix', title: 'Goldfish memory', skills: ['variables'], minutes: 8,
      brief: 'This Blink should change color with each click, like the last one. Instead, a click flashes YELLOW for a moment, and then it\'s RED again. It forgets. Find out why, and fix it.',
      start: `Color colors[] = { RED, YELLOW, GREEN, CYAN, BLUE, MAGENTA };

void setup() {
}

void loop() {
  byte current = 0;
  if (buttonSingleClicked()) {
    current = (current + 1) % 6;
  }
  setColor(colors[current]);
}
`,
      goal: `Color colors[] = { RED, YELLOW, GREEN, CYAN, BLUE, MAGENTA };
byte current = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    current = (current + 1) % 6;
  }
  setColor(colors[current]);
}
`,
      checks: [
        clickTurns('YELLOW', { say: 'A click turns it YELLOW, and it stays YELLOW', was: 'RED', settle: 1000 }),
        cycle(6, k => COLORS[k % 6], 'Each click moves one color further, back to RED after MAGENTA'),
      ],
      hints: {
        nudge: 'Look at the first line inside loop(). When does it run?',
        concept: 'loop() runs again and again. A variable made inside loop() is made fresh every time, starting from 0. In blocks it is marked "local". A variable made above setup() lasts the whole time.',
        point: { line: 7, text: 'This line makes current again, set to 0, every time loop() runs. Move it above setup().' },
        fill: 'byte current = _;\n\nvoid setup() {\n}\n\nvoid loop() {\n  if (buttonSingleClicked()) {',
      },
      twist: {
        brief: 'Make each click skip a color: RED, then GREEN, then BLUE, then back to RED.',
        checks: [cycle(3, k => ['RED', 'GREEN', 'BLUE'][k % 3], 'Each click jumps two colors ahead')],
        solution: `Color colors[] = { RED, YELLOW, GREEN, CYAN, BLUE, MAGENTA };
byte current = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    current = (current + 2) % 6;
  }
  setColor(colors[current]);
}
`,
      },
      reflect: {
        q: 'Why did the Blink forget the click?',
        options: ['current was made again, set to 0, at the start of every loop()', 'The click was too short', 'A byte can only hold 0'], answer: 0,
        why: 'byte current = 0; inside loop() runs every time loop() does. Above setup(), it runs just once, so current keeps its value.',
      },
    },
    {
      id: '3.5', type: 'discover', title: 'Past 255', skills: ['variables', 'conditions'], minutes: 6,
      brief: 'A byte holds a whole number, and it has a limit. Here count starts at 253, and each click adds 1. Click three times and watch. The third click should make count 256 and turn the Blink BLUE. It doesn\'t! Find out what count really is after the third click. Then change the number in the BLUE test so the third click turns it BLUE.',
      start: `byte count = 253;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    count = count + 1;
  }
  if (count == 253) {
    setColor(RED);
  } else if (count == 254) {
    setColor(YELLOW);
  } else if (count == 255) {
    setColor(GREEN);
  } else if (count == 256) {
    setColor(BLUE);
  } else {
    setColor(WHITE);
  }
}
`,
      goal: `byte count = 253;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    count = count + 1;
  }
  if (count == 253) {
    setColor(RED);
  } else if (count == 254) {
    setColor(YELLOW);
  } else if (count == 255) {
    setColor(GREEN);
  } else if (count == 0) {
    setColor(BLUE);
  } else {
    setColor(WHITE);
  }
}
`,
      checks: [
        cycle(3, k => ['RED', 'YELLOW', 'GREEN', 'BLUE'][k], 'The third click turns it BLUE'),
      ],
      ask: {
        q: 'In a byte, what comes after 255?',
        options: ['256', '0', '1', 'It stays at 255'], answer: 1,
        why: 'A byte holds 0 to 255. Add 1 to 255 and it wraps around to 0, like a counter that rolls over. That\'s why count == 256 can never be true.',
      },
      hints: {
        nudge: 'Try other numbers in the BLUE test. Which number makes the third click turn it BLUE?',
        concept: 'A byte holds the numbers 0 to 255. There is no room for 256.',
        point: { line: 16, text: 'Change 256 to the number you think count really is.' },
        fill: '} else if (count == _) {\n  setColor(BLUE);',
      },
      reflect: {
        q: 'Which kind of variable would you pick to remember if a light is on or off?',
        options: ['A bool', 'A byte', 'A list of colors'], answer: 0,
        why: 'On or off is a true or false question, and a bool holds exactly true or false. A byte is for counting.',
      },
    },
    {
      id: '3.6', type: 'build', title: 'Tally', skills: ['variables', 'faces', 'conditions'], minutes: 12,
      brief: 'Make a tally counter. Each click lights one more face, starting with face 0 and going clockwise. Light them in any color you like. The Goal Blink uses GREEN. When all six are lit, the seventh click turns them all off, and counting starts again. count already goes up with each click.',
      start: `byte count = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    count = count + 1;
  }
}
`,
      goal: `byte count = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    count = count + 1;
    if (count == 7) {
      count = 0;
      setColor(OFF);
    } else {
      setColorOnFace(GREEN, count - 1);
    }
  }
}
`,
      checks: [
        allFaces('OFF', { say: 'It starts with every face off' }),
        {
          say: 'Each click lights one more face, clockwise from face 0',
          test(t) {
            const tb = t.table().wait(300);
            for (let k = 1; k <= 6; k++) {
              tb.click();
              const got = tb.faces();
              if (!showsCount(got, k)) return `After ${clicks(k)} yours had ${sayLit(t, got)}.`;
            }
            return true;
          },
        },
        {
          say: 'The seventh click turns every face off',
          test(t) {
            const tb = t.table().wait(300);
            for (let k = 0; k < 7; k++) tb.click();
            const got = tb.faces();
            return got.every(c => c === 'OFF') || `After 7 clicks yours had ${sayLit(t, got)}.`;
          },
        },
        {
          say: 'Then it counts up again from face 0',
          test(t) {
            const tb = t.table().wait(300);
            for (let k = 0; k < 7; k++) tb.click();
            for (let k = 1; k <= 6; k++) {
              tb.click();
              const got = tb.faces();
              if (!showsCount(got, k)) return `After ${clicks(7 + k)} yours had ${sayLit(t, got)}. It should have ${plural(k, 'face')} lit.`;
            }
            return noWarn(tb);
          },
        },
      ],
      hints: {
        nudge: 'After a click, count says how many faces should be lit. After the first click, face 0 lights. After the second, face 1.',
        concept: 'setColorOnFace(color, face) can take a variable or a sum for the face, like count - 1. To ask if two things are equal, use ==, as in count == 7. A single = stores a value instead.',
        point: { line: 8, text: 'After count goes up, light face count - 1. If count reaches 7, set it back to 0 and turn every face off.' },
        fill: 'count = count + 1;\nif (count == _) {\n  count = 0;\n  setColor(___);\n} else {\n  setColorOnFace(GREEN, count - _);\n}',
      },
      bridge: {
        id: '3.6a', type: 'fix', title: 'Is it three?', skills: ['variables', 'conditions'], minutes: 4,
        // the bug can't be a block (a compare block can't hold a single =), so show the code beside them
        view: 'split',
        brief: 'A smaller step first. This Blink should stay BLUE until the third click, then turn RED. Instead it is RED from the start. One character is missing. In code, = stores a value, and == asks if two things are equal.',
        start: `byte count = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    count = count + 1;
  }
  if (count = 3) {
    setColor(RED);
  } else {
    setColor(BLUE);
  }
}
`,
        goal: `byte count = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    count = count + 1;
  }
  if (count == 3) {
    setColor(RED);
  } else {
    setColor(BLUE);
  }
}
`,
        checks: [
          allFaces('BLUE', { say: 'It starts BLUE' }),
          cycle(3, k => (k < 3 ? 'BLUE' : 'RED'), 'The third click turns it RED'),
        ],
        hints: {
          nudge: 'Look at the if. Does it ask a question, or does it change count?',
          concept: 'count = 3 stores 3 in count, every time loop() runs. count == 3 asks "is count 3?" and changes nothing. In blocks, the compare block\'s == asks.',
          point: { line: 10, text: 'This line stores 3 in count. Make it ask instead.' },
          fill: 'if (count __ 3) {',
        },
        reflect: {
          q: 'What does count = 3 do?',
          options: ['It stores 3 in count', 'It asks if count is 3', 'Nothing'], answer: 0,
          why: 'One = stores a value. Two == compare. Mixing them up is one of the most common bugs in C, even for experts.',
        },
      },
      twist: {
        brief: 'Make a full tally stand out: when the sixth face lights, all six faces turn RED. The seventh click still turns them all off.',
        checks: [{
          say: 'Six clicks turn every face RED, and only then',
          test(t) {
            const tb = t.table().wait(300);
            for (let k = 0; k < 5; k++) tb.click();
            let got = tb.faces();
            if (!showsCount(got, 5)) return `After 5 clicks yours had ${sayLit(t, got)}.`;
            if (got[0] === 'RED') return 'After 5 clicks the faces were already RED.';
            tb.click();
            got = tb.faces();
            if (got.some(c => c !== 'RED')) return `After 6 clicks yours was ${t.describe(got)}.`;
            tb.click();
            got = tb.faces();
            return got.every(c => c === 'OFF') || `After 7 clicks yours had ${sayLit(t, got)}.`;
          },
        }],
        solution: `byte count = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    count = count + 1;
    if (count == 7) {
      count = 0;
      setColor(OFF);
    } else {
      setColorOnFace(GREEN, count - 1);
    }
    if (count == 6) {
      setColor(RED);
    }
  }
}
`,
      },
      reflect: {
        q: 'In your tally, what does count remember?',
        options: ['How many faces are lit', 'Which color to use', 'How long the button was held'], answer: 0,
        why: 'count is the state of the game. The lit faces are just a way to show it.',
      },
    },
  ],
  boss: {
    id: '3.★', type: 'boss', title: 'Scorekeeper', skills: ['variables', 'events', 'conditions', 'faces'], minutes: 15,
    brief: 'Make a scorekeeper for a game. Keep the score in a byte, starting at 0. A click adds a point, a double-click takes one away, and a long press (hold the button) sets it back to 0. Show the score as lit faces: one point lights face 0, two points light faces 0 and 1, and so on. Use any color but YELLOW. At six points, all six faces turn YELLOW: gold! The score never goes below 0 or above 6.',
    start: `byte score = 0;

void setup() {
}

void loop() {
}
`,
    goal: `byte score = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    if (score < 6) {
      score = score + 1;
    }
  }
  if (buttonDoubleClicked()) {
    if (score > 0) {
      score = score - 1;
    }
  }
  if (buttonLongPressed()) {
    score = 0;
  }

  setColor(OFF);
  if (score >= 1) {
    setColorOnFace(CYAN, 0);
  }
  if (score >= 2) {
    setColorOnFace(CYAN, 1);
  }
  if (score >= 3) {
    setColorOnFace(CYAN, 2);
  }
  if (score >= 4) {
    setColorOnFace(CYAN, 3);
  }
  if (score >= 5) {
    setColorOnFace(CYAN, 4);
  }
  if (score == 6) {
    setColor(YELLOW);
  }
}
`,
    checks: [
      {
        say: 'Each click adds a point: one more lit face',
        test(t) {
          const tb = t.table().wait(300);
          let got = tb.faces();
          if (!showsCount(got, 0)) return `Before any clicks yours had ${sayLit(t, got)}.`;
          for (let k = 1; k <= 5; k++) {
            tb.click();
            got = tb.faces();
            if (!showsCount(got, k)) return `After ${clicks(k)} yours had ${sayLit(t, got)}.`;
          }
          return true;
        },
      },
      {
        say: 'Six points turn every face YELLOW',
        test(t) {
          const tb = t.table().wait(300);
          for (let k = 0; k < 5; k++) tb.click();
          if (tb.faces()[0] === 'YELLOW') return 'At 5 points face 0 was already YELLOW. Use another color until six.';
          tb.click();
          const got = tb.faces();
          return got.every(c => c === 'YELLOW') || `After 6 clicks yours was ${t.describe(got)}.`;
        },
      },
      {
        say: 'A double-click takes a point away',
        test(t) {
          const tb = t.table().wait(300).click().click().click();
          tb.doubleClick();
          let got = tb.faces();
          if (!showsCount(got, 2)) return `At 3 points, after a double-click yours had ${sayLit(t, got)}. It should have 2.`;
          tb.doubleClick();
          got = tb.faces();
          return showsCount(got, 1) || `After a second double-click yours had ${sayLit(t, got)}. It should have 1.`;
        },
      },
      {
        say: 'A long press sets the score back to 0',
        test(t) {
          const tb = t.table().wait(300).click().click().click().click();
          tb.hold(0, 1500).release().wait(300);
          let got = tb.faces();
          if (!showsCount(got, 0)) return `At 4 points, after a long press yours had ${sayLit(t, got)}.`;
          tb.click();
          got = tb.faces();
          return showsCount(got, 1) || `After the long press and one click yours had ${sayLit(t, got)}. It should have 1.`;
        },
      },
      {
        say: 'The score stays between 0 and 6',
        test(t) {
          let tb = t.table().wait(300).doubleClick();
          let got = tb.faces();
          if (!showsCount(got, 0)) return `A double-click at 0 points left yours with ${sayLit(t, got)}${got[0] !== 'OFF' ? ` (${got[0]})` : ''}. The score went below 0.`;
          tb.click();
          got = tb.faces();
          if (!showsCount(got, 1)) return `A double-click at 0 points, then a click, left yours with ${sayLit(t, got)}. It should have 1.`;
          tb = t.table().wait(300);
          for (let k = 0; k < 8; k++) tb.click();
          got = tb.faces();
          if (got.some(c => c !== 'YELLOW')) return `After 8 clicks yours was ${t.describe(got)}. Extra clicks should keep it gold.`;
          tb.doubleClick();
          got = tb.faces();
          if (showsCount(got, 5)) return true;
          return `After 8 clicks and a double-click yours ${got.every(c => c === 'YELLOW') ? 'was still all YELLOW' : `had ${sayLit(t, got)}`}. The score should stop at 6, so this leaves 5 points.`;
        },
      },
    ],
    hints: {
      nudge: 'Do it in two parts. First, change score when the button does something. Then, draw the faces from score.',
      concept: 'Draw the whole board from the score every loop(): turn every face off, then light face 0 if score is at least 1, face 1 if it is at least 2, and so on. Use an if around each change to keep the score from 0 to 6.',
      point: { line: 6, text: 'Everything goes inside loop(): three button checks, then the faces.' },
      fill: 'if (buttonSingleClicked()) {\n  if (score < _) {\n    score = score + 1;\n  }\n}\nif (buttonDoubleClicked()) {\n  if (score > _) {\n    score = score - 1;\n  }\n}\nif (buttonLongPressed()) {\n  score = _;\n}\nsetColor(OFF);\nif (score >= 1) {\n  setColorOnFace(CYAN, 0);\n}\n...\nif (score == 6) {\n  setColor(______);\n}',
    },
    twist: {
      brief: 'Add a way to lose. A double-click at 0 points turns every face RED. The next click clears the RED and scores 1 point.',
      checks: [{
        say: 'A double-click at 0 points turns it RED, and a click starts over at 1 point',
        test(t) {
          let tb = t.table().wait(300).doubleClick();
          let got = tb.faces();
          if (got.some(c => c !== 'RED')) return `After a double-click at 0 points yours was ${t.describe(got)}.`;
          tb.click();
          got = tb.faces();
          if (!showsCount(got, 1) || got[0] === 'RED') return `After the next click yours was ${t.describe(got)}. It should have face 0 lit, not RED.`;
          tb = t.table().wait(300).click().click().doubleClick();
          got = tb.faces();
          return showsCount(got, 1) || `At 2 points, a double-click left yours with ${sayLit(t, got)}. It should have 1, not RED.`;
        },
      }],
      solution: `byte score = 0;
bool lost = false;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    lost = false;
    if (score < 6) {
      score = score + 1;
    }
  }
  if (buttonDoubleClicked()) {
    if (score > 0) {
      score = score - 1;
    } else {
      lost = true;
    }
  }
  if (buttonLongPressed()) {
    score = 0;
  }

  setColor(OFF);
  if (score >= 1) {
    setColorOnFace(CYAN, 0);
  }
  if (score >= 2) {
    setColorOnFace(CYAN, 1);
  }
  if (score >= 3) {
    setColorOnFace(CYAN, 2);
  }
  if (score >= 4) {
    setColorOnFace(CYAN, 3);
  }
  if (score >= 5) {
    setColorOnFace(CYAN, 4);
  }
  if (score == 6) {
    setColor(YELLOW);
  }
  if (lost) {
    setColor(RED);
  }
}
`,
    },
    reflect: {
      q: 'Why does the score need a check before taking a point away at 0?',
      options: ['A byte can\'t go below 0. 0 minus 1 wraps around to 255', 'The button stops working at 0', 'Double-clicks don\'t count at 0'], answer: 0,
      why: 'A byte holds 0 to 255. Take 1 from 0 and it wraps to 255, the same way 255 plus 1 wraps to 0.',
    },
  },
};
