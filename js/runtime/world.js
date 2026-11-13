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

// blinklib's run() calls loop(), then waits for the LEDs to finish the frame they are showing
// before it copies the new colors over, then sends IR. The BIOS lights one face at a time, five
// 256 us steps a face, so a frame is 6 x 5 x 256 us = 7.68 ms: loop() runs at most ~130 times a
// second. Sending blocks the chip, one face after another, so a pass that sends 12 ms of packets
// misses the next frame and waits for the one after. A Blink alone sends little and runs near
// 130 Hz; one in a group answers its neighbors every pass and slows to ~25-45 Hz.
export const FRAME_MS = 7.68;

// How far each Blink's clock can run fast or slow. A Blink's clock is an RC oscillator in its
// chip, not a crystal, and its speed shifts with the battery's voltage and the temperature,
// so no two Blinks keep quite the same time. The typical amount is an estimate.
export const DRIFT = { typical: 0.02, min: 0.005, max: 0.1 };

// IR packets take time to send. The BlinkBIOS bootloader times a 32-byte block at 98 ms, about
// 3 ms a byte. Every packet starts with the BIOS packet type byte; a face value is one more byte
// (6 ms), a sleep or wake packet two (9 ms), and a datagram a header byte, its payload and a
// checksum. Datagrams are made half again as slow (18 ms for 1 byte, 86 ms for 16): here they
// always get through, and the slowdown stands in for the ones a real table loses and a game has
// to send again. While a packet is on its way, neither end of the link sends anything else on
// that face.
export const IR = { BYTE_MS: 3, DATAGRAM_SLOWDOWN: 1.5 };
export function airtime(pkt) {
  if (pkt.k === 'dgram') return Math.round((pkt.data.length + 3) * IR.BYTE_MS * IR.DATAGRAM_SLOWDOWN);
  return (pkt.k === 'value' ? 2 : 3) * IR.BYTE_MS;
}

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
    this.inflight = [];         // datagrams on their way: { from, f, to, face, pkt, at }
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
    this.inflight = [];
    for (const b of this.blinks) b.powerUp(0, this.program);
  }

  restart() {
    this.warned.clear();
    this.seeding.clear();
    this.inflight = [];
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
  clear() { this.blinks = []; this.grid.clear(); this.nextId = 1; this.seeding.clear(); this.inflight = []; }
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
  // runs loop() once a frame of its own time (more when it sent a lot), so Blinks slowly slide in
  // and out of step.
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
          if (--b.passWait <= 0) {
            b.pass();
            b.passWait += this.passFrames(b) * FRAME_MS;
            passes++; passed = true;
          }
        }
      }
      if (this.inflight.length) this.land();
      if (passed) this.deliver();
      if (this.seeding.active) this.seeding.tick();
    }
    return passes;
  }

  // How many LED frames the pass just run takes: one, plus however many its IR sends spill into.
  // (Sleep and wake fades keep their own pace.)
  passFrames(b) {
    if (b.mode !== 'run') return 1;
    const out = b.outbox;
    let ms = 0;
    for (let i = 1; i < out.length; i += 2) ms += airtime(out[i]);
    return Math.max(1, Math.ceil(ms / FRAME_MS));
  }

  // This Blink's clock compared with true time, e.g. 1.013 runs 1.3% fast
  clockRate(b) { return 1 + b.clockSkew * this.drift; }

  deliver() {
    for (const b of this.blinks) {
      const out = b.outbox;
      if (!out.length) continue;
      let at = this.time;   // a Blink sends on one face at a time, so each packet goes out after the last
      for (let i = 0; i < out.length; i += 2) {
        const pkt = out[i + 1];
        at += airtime(pkt);
        const n = this.neighbor(b, out[i]);
        if (!n) { if (pkt.k === 'dgram') pkt.result = 'lost'; continue; }
        b.faces[out[i]].busyUntil = n.blink.faces[n.face].busyUntil = at;
        this.inflight.push({ from: b, f: out[i], to: n.blink, face: n.face, pkt, at });
      }
      out.length = 0;
    }
  }

  // Packets whose airtime is up reach the neighbor, if it's still there. A full receive buffer
  // drops the packet, as on hardware.
  land() {
    const list = this.inflight;
    let keep = 0;
    for (const d of list) {
      if (d.at > this.time) { list[keep++] = d; continue; }
      const n = this.neighbor(d.from, d.f);
      const dg = d.pkt.k === 'dgram';
      if (!n || n.blink !== d.to || n.face !== d.face) { if (dg) d.pkt.result = 'lost'; }   // moved apart on the way
      else if (!d.to.faces[d.face].rx) d.to.faces[d.face].rx = d.pkt;
      else if (dg) d.pkt.result = 'dropped';
    }
    list.length = keep;
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
