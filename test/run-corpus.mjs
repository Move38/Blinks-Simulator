// Runs every sketch in a list on 7 Blinks for a few simulated seconds with button presses.
import { readFileSync } from 'node:fs';
import { compile } from '../js/compiler/index.js';
import { World } from '../js/runtime/world.js';
const list = readFileSync(process.argv[2], 'utf8').trim().split('\n');
const cells = [[0, 0], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];
let bad = 0;
for (const f of list) {
  const c = compile(readFileSync(f, 'utf8'));
  if (!c.ok) continue;
  const errors = [], warns = [];
  const w = new World({ onError: (b, e) => errors.push(e), onWarn: (b, m, l) => warns.push(`L${l} ${m}`) });
  cells.forEach(([q, r], i) => w.addBlink(q, r, i % 6));
  w.load(c);
  const t0 = performance.now();
  for (let s = 0; s < 40; s++) {
    const b = w.blinks[s % 7];
    if (s % 3 === 0) b.rawButton = true;
    w.advance(100);
    b.rawButton = false;
    if (s === 20) { w.lift(w.blinks[3]); }
  }
  const ms = performance.now() - t0;
  const name = f.split('/').slice(-1)[0];
  if (errors.length || warns.length || process.env.V) {
    if (errors.length) bad++;
    console.log(name.padEnd(28), `${ms.toFixed(0)}ms`, errors.length ? 'ERROR ' + JSON.stringify(errors[0]) : '', warns.slice(0, 2).join(' | '));
  }
}
console.log('crashed:', bad);
