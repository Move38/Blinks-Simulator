// Compiles every sketch listed in a file (one path per line) and reports failures.
import { readFileSync } from 'node:fs';
import { compile } from '../js/compiler/index.js';
const list = readFileSync(process.argv[2], 'utf8').trim().split('\n');
let ok = 0, fail = 0;
for (const f of list) {
  const r = compile(readFileSync(f, 'utf8'));
  if (r.ok) { ok++; if (process.env.V) console.log('OK  ', f, 'ram', r.ram.used, 'warn', r.warnings.length); }
  else { fail++; console.log('FAIL', f.replace(/.*\/(?=[^/]+\/[^/]+$)/, ''), r.errors.map(e => `L${e.line}: ${e.message}`).join(' | ')); }
}
console.log(`${ok} ok, ${fail} failed`);
