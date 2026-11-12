/*
 * The table: Blinks on a hex grid, IR links between touching faces, and simulated time.
 *
 * Grid: flat-top hexes in axial coordinates. Face 0 is the top edge, faces go clockwise.
 * A Blink can be rotated, so its face 0 may point in any of the six directions, just like
 * real Blinks that are put down at any angle.
 */

import { Blink } from './blink.js';
import { Seeding } from './seed.js';

export const DIRS = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];
const key = (q, r) => q + ',' + r;
const LOOP_PERIOD_MS = 2;

// How far each Blink's clock can run fast or slow. A Blink's clock is an RC oscillator in its
// chip, not a crystal, and its speed shifts with the battery's voltage and the temperature,
// so no two Blinks keep quite the same time. The typical amount is an estimate.
export const DRIFT = { typical: 0.02, min: 0.005, max: 0.1 };

export class World {
  constructor(events = {}) {
    this.blinks = [];
    this.grid = new Map();
    this.time = 0;
    this.acc = 0;
    this.nextId = 1;
    this.program = null;
    this.events = events;
    this.warned = new Map();
    this.seeding = new Seeding(this);
    this.drift = 0;             // each Blink's clock runs up to this much fast or slow (0.02 = ±2%)
  }

  // ---------- program ----------
  load(compiled) {
    const lineMap = compiled.lineMap;
    this.program = {
      factory: compiled.factory,
      mapLine(stack) {
        const m = /<anonymous>:(\d+):\d+/.exec(stack);
        if (!m) return 0;
        const jsLine = parseInt(m[1], 10) - 3;
        for (let i = jsLine; i >= 0; i--) if (lineMap[i]) return lineMap[i];
        return 0;
      },
    };
    this.warned.clear();
    this.seeding.clear();
    for (const b of this.blinks) b.powerUp(0, this.program);
  }

  restart() {
    this.warned.clear();
    this.seeding.clear();
    for (const b of this.blinks) b.powerUp(0, this.program);
  }

  // ---------- layout ----------
  addBlink(q, r, rot = 0) {
    if (this.grid.has(key(q, r))) return null;
    const b = new Blink(this, this.nextId++);
    b.q = q; b.r = r; b.rot = rot; b.lifted = false;
    b.powerUp(0, this.program);
    this.blinks.push(b);
    this.grid.set(key(q, r), b);
    return b;
  }
  removeBlink(b) {
    this.blinks = this.blinks.filter(x => x !== b);
    if (this.grid.get(key(b.q, b.r)) === b) this.grid.delete(key(b.q, b.r));
  }
  clear() { this.blinks = []; this.grid.clear(); this.nextId = 1; this.seeding.clear(); }
  at(q, r) { return this.grid.get(key(q, r)) || null; }
  lift(b) {
    if (b.lifted) return;
    b.lifted = true;
    if (this.grid.get(key(b.q, b.r)) === b) this.grid.delete(key(b.q, b.r));
  }
  place(b, q, r) {
    b.lifted = false;
    b.q = q; b.r = r;
    this.grid.set(key(q, r), b);
  }
  rotate(b, dir = 1) { b.rot = (b.rot + dir + 6) % 6; }

  // Which Blink face touches face `f` of Blink `b`?
  neighbor(b, f) {
    if (b.lifted) return null;
    const d = (f + b.rot) % 6;
    const n = this.grid.get(key(b.q + DIRS[d][0], b.r + DIRS[d][1]));
    if (!n || n.lifted) return null;
    return { blink: n, face: ((d + 3) % 6 - n.rot + 6) % 6 };
  }

  cluster(b) {
    const seen = new Set([b]);
    const list = [b];
    for (let i = 0; i < list.length; i++) {
      for (let f = 0; f < 6; f++) {
        const n = this.neighbor(list[i], f);
        if (n && !seen.has(n.blink)) { seen.add(n.blink); list.push(n.blink); }
      }
    }
    return list;
  }

  // ---------- time ----------
  // Advance simulated time by dt milliseconds. Returns the number of loop passes run.
  // Every Blink keeps its own time: its millisecond ticks come at its own clock's rate, and it
  // runs loop() every LOOP_PERIOD_MS of its own time, so Blinks slowly slide in and out of step.
  advance(dt) {
    this.acc += dt;
    let passes = 0;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.time++;
      const bs = this.blinks;
      let passed = false;
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        b.clockAcc += 1 + b.clockSkew * this.drift;
        while (b.clockAcc >= 1) {
          b.clockAcc -= 1;
          b.tick1ms();
          if (++b.loopTick >= LOOP_PERIOD_MS) { b.loopTick = 0; b.pass(); passes++; passed = true; }
        }
      }
      if (passed) this.deliver();
      if (this.seeding.active) this.seeding.tick();
    }
    return passes;
  }

  // This Blink's clock compared with true time, e.g. 1.013 runs 1.3% fast
  clockRate(b) { return 1 + b.clockSkew * this.drift; }

  deliver() {
    for (const b of this.blinks) {
      const out = b.outbox;
      if (!out.length) continue;
      for (let i = 0; i < out.length; i += 2) {
        const pkt = out[i + 1];
        const n = this.neighbor(b, out[i]);
        if (!n) { if (pkt.k === 'dgram') pkt.result = 'lost'; continue; }
        const face = n.blink.faces[n.face];
        if (!face.rx) face.rx = pkt;   // a full buffer drops the packet, as on hardware
        else if (pkt.k === 'dgram') pkt.result = 'dropped';
      }
      out.length = 0;
    }
  }

  // ---------- game sharing (see seed.js) ----------
  startSeeding(root) {
    this.seeding.start(root);
    this.events.onSeed?.(root);
  }

  // ---------- events from Blinks ----------
  onError(b, err) { this.events.onError?.(b, err); }
  onSerial(b, text) { this.events.onSerial?.(b, text); }
  onSleep(b) { this.events.onSleep?.(b); }
  onButtonActivity(b) {
    // the viral "button pressed" bit keeps the whole group awake
    this.events.onButton?.(b);
  }
  warn(b, message, line) {
    if (this.warned.has(message)) return;
    this.warned.set(message, true);
    // find the sketch line from the JS stack (only on the first occurrence, so it stays cheap)
    if (!line && this.program) line = this.program.mapLine(new Error().stack || '');
    this.events.onWarn?.(b, message, line || 0);
  }
}
