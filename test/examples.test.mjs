import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../js/compiler/index.js';
import { World } from '../js/runtime/world.js';
import { EXAMPLES } from '../js/examples.js';

const cells = [[0, 0], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];

for (const group of EXAMPLES) {
  for (const ex of group.items) {
    test(`${group.group}: ${ex.title} compiles and runs`, () => {
      const c = compile(readFileSync(new URL('../examples/' + ex.file, import.meta.url), 'utf8'));
      assert.ok(c.ok, c.errors?.map(e => `line ${e.line}: ${e.message}`).join('; '));
      assert.deepEqual(c.warnings, []);
      const errors = [];
      const w = new World({ onError: (b, e) => errors.push(e) });
      cells.forEach(([q, r], i) => w.addBlink(q, r, i % 6));
      w.load(c);
      for (let s = 0; s < 30; s++) {
        const b = w.blinks[s % 7];
        b.press(s % 3 === 0);
        w.advance(100);
        b.press(false);
      }
      // the SDK's serial number printer ends in while(1) on purpose
      if (!ex.file.includes('SerialNumber')) assert.deepEqual(errors, []);
    });
  }
}

test('every example names a known layout, or lists Blinks that fit on the grid', async () => {
  const { LAYOUTS } = await import('../js/ui/board.js');
  for (const group of EXAMPLES) {
    for (const ex of group.items) {
      if (!Array.isArray(ex.layout)) { assert.ok(LAYOUTS[ex.layout], `${ex.title}: no layout called '${ex.layout}'`); continue; }
      assert.ok(ex.layout.length, `${ex.title}: an empty layout`);
      const seen = new Set();
      for (const c of ex.layout) {
        assert.ok((c.length === 2 || c.length === 3) && c.every(Number.isInteger) && (c[2] ?? 0) >= 0 && (c[2] ?? 0) < 6, `${ex.title}: bad cell ${JSON.stringify(c)}`);
        assert.ok(!seen.has(c[0] + ',' + c[1]), `${ex.title}: two Blinks at ${c[0]}, ${c[1]}`);
        seen.add(c[0] + ',' + c[1]);
      }
    }
  }
});
