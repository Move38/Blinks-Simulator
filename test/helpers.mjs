import { compile } from '../js/compiler/index.js';
import { World } from '../js/runtime/world.js';

// Build a world running `src` on Blinks at the given grid cells.
export function sim(src, cells = [[0, 0]], opts = {}) {
  // tests print a lot: declare and start Serial without changing line numbers
  if (!src.includes('ServicePortSerial')) src = 'ServicePortSerial Serial; ' + src.replace(/void setup\s*\(\s*\)\s*\{/, m => m + ' Serial.begin();');
  const c = compile(src);
  if (!c.ok) throw new Error('compile failed: ' + c.errors.map(e => `L${e.line}: ${e.message}`).join('; '));
  const log = [], errors = [], warns = [];
  const w = new World({
    onSerial: (b, t) => log.push(opts.tag ? `${b.id}:${t}` : t),
    onError: (b, e) => errors.push(e),
    onWarn: (b, m, l) => warns.push({ m, l }),
  });
  w.load(c);
  for (const [q, r, rot] of cells) w.addBlink(q, r, rot || 0);
  w.load(c);
  return { w, log, errors, warns, c, b: w.blinks };
}

export function compileErr(src) {
  const c = compile(src);
  return c.ok ? null : c.errors[0];
}

// Color helpers
export const rgb = c => [(c >> 1) & 31, (c >> 6) & 31, (c >> 11) & 31];

// Press the button of blink b for `ms`, then release, advancing time
export function click(w, b, downMs = 60) { b.rawButton = true; w.advance(downMs); b.rawButton = false; w.advance(40); }
