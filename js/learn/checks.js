/*
 * Checks that many levels share. Each returns a { say, test } check for js/learn/harness.js.
 */

// After `after` ms, these faces of Blink `i` show these colors. want: { face: 'RED', ... }
export function facesShow(want, { say, after = 300, i = 0 } = {}) {
  const fs = Object.keys(want).map(Number);
  return {
    say: say || (fs.length === 6 && new Set(Object.values(want)).size === 1
      ? `All six faces are ${want[0]}`
      : fs.map(f => `face ${f} ${want[f]}`).join(', ')),
    test(t) {
      const got = t.table().wait(after).faces(i);
      const wrong = fs.filter(f => got[f] !== want[f]);
      if (!wrong.length) return true;
      if (fs.length === 6) return `Yours was ${t.describe(got)}.`;
      return t.sayFaces(wrong, got);
    },
  };
}
export const allFaces = (color, opts = {}) => facesShow(Object.fromEntries([0, 1, 2, 3, 4, 5].map(f => [f, color])), opts);

// What Blink `i` shows doesn't change for `ms`
export function steady({ say = 'It stays that way', ms = 2000, i = 0 } = {}) {
  return {
    say,
    test(t) {
      const tb = t.table().wait(300);
      const first = tb.faces(i).join();
      const seen = tb.sample(100, ms / 100, x => x.faces(i).join());
      const k = seen.findIndex(s => s !== first);
      return k < 0 || `It changed after ${(k + 1) * 100} ms.`;
    },
  };
}

// No warnings from the Blinks while it runs (face numbers above 5, and so on)
export function noWarnings({ say = 'Only faces 0 to 5 are used', ms = 500 } = {}) {
  return {
    say,
    test(t) {
      const tb = t.table().wait(ms);
      return !tb.warns.length || tb.warns[0].replace(/\.$/, '') + '.';
    },
  };
}

// The code itself contains (or doesn't contain) something: for levels about a particular tool
export function uses(re, say, saw) {
  return { say, test: t => re.test(t.code) || saw };
}
