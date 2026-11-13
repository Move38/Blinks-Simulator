/*
 * The hardware-exact table: the same interface as runtime/world.js's World,
 * but every Blink is an emulated ATmega running the real BlinkBIOS, blinklib
 * and the sketch compiled by avr-gcc (see toolchain.js). IR is light between
 * the facing LEDs of touching Blinks, so it follows the table as Blinks move.
 */

import { AvrBlink } from './blink-avr.js';
import { FACE_BYTES, FACE } from './elf.js';
import { DIRS } from '../runtime/world.js';

const key = (q, r) => q + ',' + r;
const SLICE_NS = 5000;        // Blinks run in lockstep slices this long
// Light from an IR LED reaches the facing LED this much later. Within a slice the Blinks run one
// after another, so a neighbor may already be at the end of the slice when the light is sent;
// one slice (and a little, for the last instruction's overshoot) of delay means it never is, so
// every pulse arrives exactly on time, the same for both directions of a link.
const IR_DELAY_NS = SLICE_NS + 1000;

// How long the BIOS lights each 5-bit color level, as a fraction of its PWM phase
// (measured on the emulated BIOS). Used to read the colors back off the LEDs.
const LEVEL_DUTY = [4, 5, 6, 8, 9, 11, 14, 17, 21, 25, 29, 35, 41, 48, 55, 64, 73, 83, 94, 106, 119, 133, 148, 164, 181, 200, 219, 240, 246, 250, 256, 256].map((t) => t / 256);
function level(duty) {
  if (duty < (LEVEL_DUTY[0] + LEVEL_DUTY[1]) / 2) return 0;
  let best = 0;
  for (let v = 1; v < 32; v++) if (Math.abs(LEVEL_DUTY[v] - duty) <= Math.abs(LEVEL_DUTY[best] - duty)) best = v;
  return best;
}
const color5 = ([r, g, b]) => (level(r) << 1) | (level(g) << 6) | (level(b) << 11);

// One Blink on the table, shaped like runtime/blink.js's Blink for the board and inspector
class HwBlink {
  constructor(world, id) {
    this.world = world;
    this.id = id;
    this.display = new Uint16Array(6);
    this.clockSkew = Math.random() * 2 - 1;
    this.rawButton = false;
    this.rawDownAt = -1e9;
    this.pendingRelease = false;
    this.serialIn = [];         // bytes typed into the console, waiting for the USART
    this.serialLine = '';
    this.avr = null;
    this.bornNs = 0;
    this.mode = 'idle';
    this.error = null;
    this.intsOnAt = 0;
  }

  powerUp(program) {
    this.display.fill(0);
    this.error = null;
    this.serialLine = '';
    this.avr = null;
    this.mode = 'idle';
    if (!program) return;
    // Blinks never start perfectly together
    this.bornNs = this.world.ns + Math.random() * 40e6;
    this.intsOnAt = this.bornNs;
    const avr = this.avr = new AvrBlink({ chip: program.chip, flash: program.flash, clockScale: this.world.clockRate(this) });
    avr.onIRChange = (face, on, ns) => this.world.irChange(this, face, on, ns + this.bornNs);
    avr.onSerial = (byte) => this.serialByte(byte);
    this.mode = 'run';
  }

  // Press or release the button. Like the simulator, a press lasts at least 40 ms,
  // so a quick click on the table is long enough for the BIOS to see.
  press(down) {
    if (down) { this.rawButton = true; this.rawDownAt = this.world.time; this.pendingRelease = false; this.avr?.setButton(true); }
    else if (this.world.time - this.rawDownAt >= 40) { this.rawButton = false; this.avr?.setButton(false); }
    else this.pendingRelease = true;
  }

  serialByte(byte) {
    if (byte === 10) { this.world.onSerial(this, this.serialLine); this.serialLine = ''; }
    else if (byte !== 13) this.serialLine += String.fromCharCode(byte);
    if (this.serialLine.length > 200) { this.world.onSerial(this, this.serialLine); this.serialLine = ''; }
  }

  // After the table has run: release a held click, feed typed bytes, read the LEDs, notice a hang
  settle() {
    if (this.pendingRelease && this.world.time - this.rawDownAt >= 40) { this.pendingRelease = false; this.rawButton = false; this.avr?.setButton(false); }
    if (!this.avr || this.mode === 'crashed') return;
    if (this.serialIn.length && this.avr.sendSerial(this.serialIn[0])) this.serialIn.shift();
    const colors = this.avr.takeColors();
    for (let f = 0; f < 6; f++) this.display[f] = color5(colors[f]);
    // A Blink whose interrupts stay off has stopped: nothing runs the LEDs, IR or button
    if (this.avr.cpu.data[0x5f] & 0x80) this.intsOnAt = this.world.ns;
    else if (this.world.ns - this.intsOnAt > 2e9) {
      this.mode = 'crashed';
      this.display.fill(0);
      this.world.onError(this, { message: 'This Blink stopped: its interrupts have been off for 2 seconds, so nothing is running the LEDs, IR or button', line: 0 });
    }
  }

  // The board draws the button pressed while it's down
  get btn() { return { down: this.rawButton }; }

  // blinklib's state, read from the Blink's RAM, for the debug views
  get now() {
    const at = this.world.program?.symbols.now;
    return at != null && this.avr ? this.avr.cpu.dataView.getUint32(at, true) : 0;
  }
  get millis() { return this.now; }
  get faces() {
    const at = this.world.program?.symbols.faces;
    const dv = this.avr?.cpu.dataView;
    return Array.from({ length: 6 }, (_, f) => {
      if (at == null || !dv) return { inValue: 0, outValue: 0, expireTime: 0, lastDg: null };
      const o = at + f * FACE_BYTES;
      return { inValue: dv.getUint8(o + FACE.inValue), outValue: dv.getUint8(o + FACE.outValue), expireTime: dv.getUint32(o + FACE.expireTime, true), lastDg: null };
    });
  }
}

export class HardwareWorld {
  constructor(events = {}) {
    this.blinks = [];
    this.grid = new Map();
    this.time = 0;              // ms
    this.ns = 0;
    this.nextId = 1;
    this.program = null;        // { chip, flash, symbols }
    this.events = events;
    this._drift = 0;
  }

  // ---------- program ----------
  load(program) {
    this.program = program;
    for (const b of this.blinks) b.powerUp(program);
  }
  restart() { for (const b of this.blinks) b.powerUp(this.program); }

  // ---------- layout ----------
  addBlink(q, r, rot = 0) {
    if (this.grid.has(key(q, r))) return null;
    const b = new HwBlink(this, this.nextId++);
    b.q = q; b.r = r; b.rot = rot; b.lifted = false;
    b.powerUp(this.program);
    this.blinks.push(b);
    this.grid.set(key(q, r), b);
    this.relink();
    return b;
  }
  removeBlink(b) {
    this.blinks = this.blinks.filter(x => x !== b);
    if (this.grid.get(key(b.q, b.r)) === b) this.grid.delete(key(b.q, b.r));
    this.relink();
  }
  clear() { this.blinks = []; this.grid.clear(); this.nextId = 1; }
  at(q, r) { return this.grid.get(key(q, r)) || null; }
  lift(b) {
    if (b.lifted) return;
    b.lifted = true;
    if (this.grid.get(key(b.q, b.r)) === b) this.grid.delete(key(b.q, b.r));
    this.relink();
  }
  place(b, q, r) {
    b.lifted = false;
    b.q = q; b.r = r;
    this.grid.set(key(q, r), b);
    this.relink();
  }
  rotate(b, dir = 1) { b.rot = (b.rot + dir + 6) % 6; this.relink(); }

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

  // ---------- IR ----------
  // A Blink's IR LED turned on or off at table time `ns`: it lights the facing LED of whoever touches that face
  irChange(b, face, on, ns) {
    const n = this.neighbor(b, face);
    if (n?.blink.avr) n.blink.avr.setIRLight(n.face, on, ns + IR_DELAY_NS - n.blink.bornNs);
  }
  // After Blinks move, each face sees whatever its new neighbor's LED is doing now
  relink() {
    for (const b of this.blinks) {
      if (!b.avr) continue;
      for (let f = 0; f < 6; f++) {
        const n = this.neighbor(b, f);
        const lit = !!(n?.blink.avr && (n.blink.avr.irLit & (1 << n.face)));
        if (lit !== !!(b.avr.irSeen & (1 << f))) b.avr.applyIRLight(f, lit);
      }
    }
  }

  // ---------- time ----------
  advance(dt) {
    this.time += dt;
    const end = this.time * 1e6;
    const live = this.blinks.filter(b => b.avr && b.mode !== 'crashed');
    while (this.ns < end) {
      this.ns = Math.min(end, this.ns + SLICE_NS);
      for (const b of live) if (this.ns > b.bornNs) b.avr.runUntil(this.ns - b.bornNs);
    }
    for (const b of this.blinks) b.settle();
    return 0;
  }

  get drift() { return this._drift; }
  set drift(d) {
    this._drift = d;
    for (const b of this.blinks) b.avr?.setClockScale(this.clockRate(b));
  }
  clockRate(b) { return 1 + b.clockSkew * this._drift; }

  // ---------- events from Blinks ----------
  onError(b, err) { this.events.onError?.(b, err); }
  onSerial(b, text) { this.events.onSerial?.(b, text); }
}
