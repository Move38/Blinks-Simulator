/*
 * One simulated Blink: its own RAM, a running copy of the sketch, and an emulation of
 * blinklib.cpp + the BlinkBIOS (button state machine, IR face values and datagrams,
 * warm sleep, game sharing). Constants and logic follow the Blinks SDK (dev branch)
 * and BlinkBIOS source.
 */

import * as H from '../compiler/rt.js';
import { MEM } from '../compiler/codegen.js';

export const BIOS = {
  DEBOUNCE_MS: 20,
  CLICK_TIMEOUT_MS: 330,
  LONGPRESS_MS: 1200,
  SEED_MS: 3000,          // BUTTON_BITFLAG_3SECPRESSED: seed mode when alone
  SLEEP_MS: 6000,         // BUTTON_BITFLAG_6SECPRESSED: force warm sleep
  TX_PROBE_MS: 150,
  RX_EXPIRE_MS: 200,
  VIRAL_LOCKOUT_MS: 2000,
  WARM_SLEEP_MS: 10 * 60 * 1000,
  RANDOMIZE_MS: 512,
  // warm sleep animation: 5 rounds of a packet on each face, the LEDs fading a step per packet
  SLEEP_FADE_MAX: 200,    // SLEEP_ANIMATION_MAX_BRIGHTNESS
  SLEEP_FADE_STEPS: 30,   // SLEEP_PACKET_REPEAT_COUNT * FACE_COUNT
  SLEEP_FADE_STEP_MS: 10, // ~300 ms for the whole fade (SLEEP_ANIMATION_DURATION_MS)
  // Not in blinklib: a Blink woken or put to sleep by a neighbor waits this long before its own
  // fade, so the wave is easy to see. On hardware the gap comes only from the time packets take.
  SLEEP_RELAY_MS: 50,
  BIOS_VERSION: 2,
};

const F = {
  PRESSED: 1, LONGPRESSED: 2, RELEASED: 4, SINGLE: 8, DOUBLE: 16, MULTI: 32, SEC3: 64, SEC6: 128,
};
const NEVER = 0xffffffff;
const BLUE = H.color5(0, 0, 31, 1), WHITE = H.color5(31, 31, 31, 1);
const DATAGRAM_LEN = 16;
const LOOP_BUDGET = 3e6;

export class Blink {
  constructor(world, id) {
    this.world = world;
    this.id = id;
    this.serial = Array.from({ length: 9 }, () => Math.floor(Math.random() * 256));
    this.mem = new Uint8Array(MEM.SIZE);
    this.dv = new DataView(this.mem.buffer);
    this.pixels = new Uint16Array(6);    // pixel buffer the sketch writes
    this.display = new Uint16Array(6);   // what the LEDs show
    this.rawButton = false;
    this.rawDownAt = -1e9;
    this.pendingRelease = false;
    this.program = null;
    this.inst = null;
    // its own clock: how fast it runs (-1 slowest .. 1 fastest, scaled by world.drift), and
    // where it is in its loop cycle. Both belong to the chip, so they survive restarts.
    this.clockSkew = Math.random() * 2 - 1;
    this.clockAcc = Math.random();
    this.loopTick = Math.floor(Math.random() * 2);
    this.powerUp(0, null);
  }

  // Battery inserted / program downloaded: fresh RAM and BIOS state
  powerUp(startState, program) {
    this.mem.fill(0);
    this.pixels.fill(0);
    this.display.fill(0);
    this.millis = Math.floor(Math.random() * 40) >>> 0;  // Blinks never start perfectly in sync
    this.now = this.millis;
    this.subMs = 0;
    this.faces = Array.from({ length: 6 }, () => ({
      inValue: 0, outValue: 0, expireTime: 0, sendTime: 0, prevValue: 0,
      inDgLen: 0, outDgLen: 0, outDg: new Uint8Array(DATAGRAM_LEN), rx: null, busyUntil: 0,
      lastDg: null,     // last datagram sent, for the comms view (its .result says what happened to it)
    }));
    this.btn = { down: 0, bitflags: 0, clickcount: 0, debounce: 0, clickWindow: 0, pending: 0, longReg: 0, pressCountup: 0 };
    this.snapDown = 0; this.snapFlags = 0; this.clickCount = 0;
    this.randState = H.RAND_SEED;
    this.cRand = { v: 1 };
    this.startState = startState;
    this.viralFlags = 0;
    this.viralLockout = 0;
    this.warmSleepAt = this.millis + BIOS.WARM_SLEEP_MS;
    this.warmWoken = 0;
    this.mode = 'run';          // run | seedspin | seeding | sleeping | sleep | waking | crashed | idle
    this.skipUntil = 0;
    this.serialBuf = '';
    this.serialIn = [];
    this.error = null;
    this.outbox = [];
    this.loops = 0;
    this.setupDone = false;
    if (program !== undefined) this.program = program;
    this.inst = null;
    if (this.program) {
      try {
        this.inst = this.program.factory({ M: this.mem, DV: this.dv, L: this, H });
        this.inst.setBudget(LOOP_BUDGET);
        this.withHooks(() => this.inst.init());
      } catch (e) { this.crash(e); }
    } else this.mode = 'idle';
  }

  get alive() { return this.mode !== 'crashed' && this.mode !== 'idle'; }

  withHooks(f) {
    const w = this.world;
    H.hooks.divZero = () => w.warn(this, 'Division by zero (a real Blink gives a garbage answer here)');
    H.hooks.outOfBounds = (i, n, site, line) => w.warn(this, `Array index ${i} is out of range (the array has ${n} items, 0 to ${n - 1}). A real Blink would read or overwrite other variables here.`, line);
    try { return f(); }
    finally { H.hooks.divZero = () => {}; H.hooks.outOfBounds = () => {}; }
  }

  crash(e) {
    this.mode = 'crashed';
    let line = e.line || 0;
    if (!line && e.stack && this.program) line = this.program.mapLine(e.stack);
    let message = e.message || String(e);
    if (e instanceof RangeError && /call stack/i.test(message)) message = 'Out of memory: a function keeps calling itself. A real Blink would crash here.';
    this.error = { message, line };
    this.world.onError(this, this.error);
  }

  // A finger can't press for less than ~40 ms, but a mouse click can. A release that comes
  // sooner than the BIOS debounce (20 ms) would leave the button stuck down, so hold it a bit.
  press(down) {
    if (down) { this.rawButton = true; this.rawDownAt = this.world.time; this.pendingRelease = false; }
    else if (this.world.time - this.rawDownAt >= 40) this.rawButton = false;
    else this.pendingRelease = true;
  }

  // ---------------- BIOS: called once per simulated millisecond ----------------
  tick1ms() {
    this.millis = (this.millis + 1) >>> 0;
    if (this.pendingRelease && this.world.time - this.rawDownAt >= 40) { this.rawButton = false; this.pendingRelease = false; }
    const b = this.btn;
    const pos = this.rawButton ? 1 : 0;
    if (pos === b.down) {
      if (b.debounce) b.debounce--;
      if (pos) {
        if (b.clickWindow) { b.clickWindow--; if (b.clickWindow === 0) b.pending = 0; }
        b.pressCountup++;
        if (b.pressCountup > BIOS.SLEEP_MS) { b.bitflags |= F.SEC6; b.pressCountup = 0; }
        else if (b.pressCountup > BIOS.SEED_MS) b.bitflags |= F.SEC3;
        else if (b.pressCountup > BIOS.LONGPRESS_MS) {
          if (!b.longReg) { b.bitflags |= F.LONGPRESSED; b.longReg = 1; }
        }
      } else if (b.clickWindow) {
        b.clickWindow--;
        if (b.clickWindow === 0) {
          if (b.pending === 1) b.bitflags |= F.SINGLE;
          else if (b.pending === 2) b.bitflags |= F.DOUBLE;
          else { b.bitflags |= F.MULTI; b.clickcount = b.pending; }
          b.pending = 0;
        }
      }
    } else {
      if (b.debounce === 0) {
        if (pos) {
          b.bitflags |= F.PRESSED;
          if (b.pending < 255) b.pending++;
          b.clickWindow = BIOS.CLICK_TIMEOUT_MS;
          b.pressCountup = 0;
          this.world.onButtonActivity(this);
        } else {
          b.bitflags |= F.RELEASED;
          if (b.clickWindow === 0) b.pending = 0;
          b.longReg = 0;
        }
        b.down = pos;
      }
      b.debounce = BIOS.DEBOUNCE_MS;
    }
  }

  // ---------------- blinklib run(): one pass of the main loop ----------------
  pass() {
    if (this.mode === 'crashed' || this.mode === 'idle') { this.faces.forEach(f => { f.rx = null; }); return; }
    if (this.mode === 'sleep') return this.sleepPass();
    if (this.mode === 'sleeping' || this.mode === 'waking') return this.fadePass();
    if (this.mode === 'seedspin') return this.seedSpinPass();
    if (this.mode === 'seeding') return;
    if (this.millis < this.skipUntil) return;   // still inside randomize()

    const b = this.btn;
    if ((b.bitflags & F.SEC3) && this.isAlone()) {
      this.savedPixels = this.display.slice();
      this.mode = 'seedspin';
      this.spinFace = 0;
      return this.seedSpinPass();
    }
    if (b.bitflags & F.SEC6) { this.warmSleep(); return; }

    this.now = this.millis;
    if (!this.setupDone) {
      this.setupDone = true;
      this.warmSleepAt = this.now + BIOS.WARM_SLEEP_MS;
      if (!this.runUser('setup')) return;
    }
    if (b.bitflags & F.PRESSED) this.viralPostpone();
    this.rxFaces();
    if (this.mode !== 'run') return;
    this.snapDown = b.down;
    this.snapFlags |= b.bitflags;
    b.bitflags = 0;
    this.clickCount = b.clickcount;

    if (!this.runUser('loop')) return;
    this.loops++;
    this.display.set(this.pixels);
    this.txFaces();
    if (this.serialBuf.length > 200) this.flushSerial();
    if (this.now > this.warmSleepAt) this.warmSleep();
  }

  runUser(which) {
    try {
      this.inst.setBudget(LOOP_BUDGET);
      this.withHooks(() => this.inst[which]());
      this.inst.resetStack();
      return true;
    } catch (e) {
      this.crash(e);
      return false;
    }
  }

  // ---------------- IR ----------------
  rxFaces() {
    for (let f = 0; f < 6; f++) {
      const face = this.faces[f];
      const p = face.rx;
      if (!p) continue;
      face.rx = null;
      face.expireTime = this.now + BIOS.RX_EXPIRE_MS;
      face.sendTime = 0;           // ping-pong: answer right away
      if (p.viral) this.viralPostpone();
      if (p.k === 'value') face.inValue = p.v;
      else if (p.k === 'dgram') {
        if (face.inDgLen === 0 && p.data.length <= DATAGRAM_LEN) {
          face.inDgLen = p.data.length;
          this.mem.set(p.data, MEM.DATAGRAM_IN + f * DATAGRAM_LEN);
          p.result = 'ok';
        } else p.result = 'dropped';   // the last one hasn't been read yet: dropped, as on hardware
      } else if (p.k === 'sleep') {
        this.warmSleep(true);
        return;
      }
    }
  }

  txFaces() {
    for (let f = 0; f < 6; f++) {
      const face = this.faces[f];
      if (face.sendTime > this.now || this.world.time < face.busyUntil) continue;   // a packet is on its way
      let pkt;
      if (face.outDgLen) {
        pkt = { k: 'dgram', data: face.outDg.slice(0, face.outDgLen), result: null };
        face.lastDg = pkt;
      } else {
        pkt = { k: 'value', v: face.outValue };
      }
      if (this.viralFlags & (1 << f)) { pkt.viral = true; this.viralFlags &= ~(1 << f); }
      this.outbox.push(f, pkt);
      face.sendTime = this.now + BIOS.TX_PROBE_MS + f;
      face.outDgLen = 0;
    }
  }

  viralPostpone() {
    if (this.now > this.viralLockout) {
      this.viralLockout = this.now + BIOS.VIRAL_LOCKOUT_MS;
      this.viralFlags = 0x3f;
      this.warmSleepAt = this.now + BIOS.WARM_SLEEP_MS;
    }
  }

  // ---------------- warm sleep ----------------
  // blinklib's warm_sleep_cycle(): fade out in blue while sending a sleep packet on each face in
  // turn, five times round. A neighbor starts its own fade a moment after the first packet reaches it,
  // so the fade spreads across the group like a wave. Waking is the same in white, with "nop"
  // packets that wake the neighbors in turn.
  // `relay`: put to sleep by a neighbor, so wait a moment first (see SLEEP_RELAY_MS)
  warmSleep(relay = false) {
    this.savedPixels = this.pixels.slice();
    this.mode = 'sleeping';
    this.btn.bitflags = 0;
    this.startFade(relay);
    this.world.onSleep(this);
  }

  startFade(relay) {
    this.fadeStep = 0;
    this.fadeAt = this.world.time + (relay ? BIOS.SLEEP_RELAY_MS : 0);
    this.fadePass();
  }

  fadePass() {
    const waking = this.mode === 'waking';
    const step = Math.trunc(BIOS.SLEEP_FADE_MAX / BIOS.SLEEP_FADE_STEPS);   // 6
    while (this.fadeStep < BIOS.SLEEP_FADE_STEPS && this.world.time >= this.fadeAt) {
      const n = this.fadeStep++;
      const level = waking ? (n + 1) * step : BIOS.SLEEP_FADE_MAX - n * step;
      this.display.fill(H.dim(waking ? WHITE : BLUE, level));
      this.outbox.push(n % 6, { k: waking ? 'nop' : 'sleep' });
      this.fadeAt += BIOS.SLEEP_FADE_STEP_MS;
    }
    if (!waking) this.faces.forEach(f => { f.rx = null; });   // busy sending: nothing is read
    if (this.fadeStep < BIOS.SLEEP_FADE_STEPS || this.world.time < this.fadeAt) return;
    if (waking) {
      this.pixels.set(this.savedPixels);
      this.display.set(this.savedPixels);
      this.mode = 'run';
    } else {
      this.display.fill(0);
      this.sleepSaveTime = this.millis;   // time stands still while asleep
      this.btn.bitflags = 0;
      this.mode = 'sleep';
    }
  }

  sleepPass() {
    let wake = false;
    for (const face of this.faces) {
      if (face.rx) { if (face.rx.k !== 'sleep') wake = true; face.rx = null; }
    }
    const pressed = !!(this.btn.bitflags & F.PRESSED);
    if (!wake && !pressed) return;
    this.millis = this.sleepSaveTime;
    this.now = this.millis;
    this.warmWoken = 1;
    this.warmSleepAt = this.now + BIOS.WARM_SLEEP_MS;
    this.btn.bitflags = 0;
    this.mode = 'waking';
    this.startFade(!pressed);
  }

  // ---------------- game sharing (seed mode) ----------------
  seedSpinPass() {
    const b = this.btn;
    // blinklib spins one blue face around as fast as the chip can go, far faster than the eye
    // (or a screen) can follow, so it looks like a sparkle on all six faces. A face in order
    // every pass would land on the same few faces at the screen's frame rate: pick one at random.
    if (b.down && !(b.bitflags & F.SEC6)) {
      this.display.fill(0);
      this.spinFace = (this.spinFace + 1 + Math.floor(Math.random() * 5)) % 6;
      this.display[this.spinFace] = H.color5(0, 0, 31, 1);
      return;
    }
    if (b.bitflags & F.SEC6) {
      this.display.set(this.savedPixels);
      b.bitflags = 0;
      this.mode = 'run';
      this.warmSleep();
      return;
    }
    b.bitflags = 0;
    this.display.fill(0);
    this.world.startSeeding(this);
  }

  // ---------------- API used by compiled sketches (L.*) ----------------
  checkFace(face, what) {
    if (face < 6) return true;
    this.world.warn(this, `${what}: face ${face} doesn't exist. Faces are numbered 0 to 5. A real Blink would read or change random memory here.`);
    return false;
  }

  setColor(c) { this.pixels.fill(c); }
  setColorOnFace(c, face) { if (this.checkFace(face, 'setColorOnFace')) this.pixels[face] = c; }

  buttonDown() { return this.snapDown ? 1 : 0; }
  flag(bit) {
    const r = this.snapFlags & bit;
    this.snapFlags &= ~bit;
    return r ? 1 : 0;
  }

  setValueSentOnFace(v, face) {
    if (v > 63) v = 63;
    if (this.checkFace(face, 'setValueSentOnFace')) this.faces[face].outValue = v;
  }
  setValueSentOnAllFaces(v) {
    if (v > 63) v = 63;
    for (const f of this.faces) f.outValue = v;
  }
  getLastValueReceivedOnFace(face) { return this.checkFace(face, 'getLastValueReceivedOnFace') ? this.faces[face].inValue : 0; }
  didValueOnFaceChange(face) {
    if (!this.checkFace(face, 'didValueOnFaceChange')) return 0;
    const f = this.faces[face];
    if (f.inValue === f.prevValue) return 0;
    f.prevValue = f.inValue;
    return 1;
  }
  isValueReceivedOnFaceExpired(face) {
    if (!this.checkFace(face, 'isValueReceivedOnFaceExpired')) return 1;
    return this.faces[face].expireTime < this.now ? 1 : 0;
  }
  isAlone() {
    for (const f of this.faces) if (!(f.expireTime < this.now)) return 0;
    return 1;
  }

  getDatagramLengthOnFace(face) { return this.checkFace(face, 'getDatagramLengthOnFace') ? this.faces[face].inDgLen : 0; }
  isDatagramReadyOnFace(face) { return this.getDatagramLengthOnFace(face) ? 1 : 0; }
  getDatagramOnFace(face) { return MEM.DATAGRAM_IN + Math.min(face, 5) * DATAGRAM_LEN; }
  markDatagramReadOnFace(face) { if (this.checkFace(face, 'markDatagramReadOnFace')) this.faces[face].inDgLen = 0; }
  sendDatagramOnFace(addr, len, face) {
    if (len > DATAGRAM_LEN) { this.world.warn(this, `sendDatagramOnFace: ${len} bytes is too long (the limit is ${DATAGRAM_LEN}), so nothing was sent. A real Blink ignores it too.`); return; }
    if (!this.checkFace(face, 'sendDatagramOnFace')) return;
    const f = this.faces[face];
    f.outDgLen = len;
    f.outDg.set(this.mem.subarray(addr, addr + len));
  }

  // Timer (Timer.cpp): the expire time lives in the sketch's RAM
  timerExpired(a) { return this.now > this.dv.getUint32(a, true) ? 1 : 0; }
  timerRemaining(a) { const e = this.dv.getUint32(a, true); return this.now >= e ? 0 : (e - this.now) >>> 0; }
  timerSet(a, ms) { this.dv.setUint32(a, (this.now + ms) >>> 0, true); }
  timerAdd(a, ms) {
    const e = this.dv.getUint32(a, true);
    const left = (NEVER - e) >>> 0;
    this.dv.setUint32(a, ms > left ? NEVER : (e + ms) >>> 0, true);
  }
  timerNever(a) { this.dv.setUint32(a, NEVER, true); }

  randomWord() {
    this.randState = H.xorshift(this.randState);
    return this.randState & 0xffff;
  }
  random(limit) {
    const den = (limit + 1) & 0xffff;
    const divisor = den === 0 ? 0xffff : Math.floor(0xffff / den);
    let r;
    do { r = Math.floor(this.randomWord() / divisor); } while (r > limit);
    return r;
  }
  randomize() {
    // collects 32 bits of entropy from the watchdog timer: takes about half a second on hardware
    this.randState = (Math.random() * 0x100000000) >>> 0 || 1;
    this.skipUntil = this.millis + BIOS.RANDOMIZE_MS;
  }
  rand() { return H.avrRand(this.cRand); }
  srand(s) { this.cRand.v = s; }
  getSerialNumberByte(n) { return n > 8 ? 0 : this.serial[n]; }
  get biosVersion() { return BIOS.BIOS_VERSION; }
  hasWoken() {
    const r = this.warmWoken;
    this.warmWoken = 0;
    return r;
  }

  // Serial (ServicePortSerial)
  serialPrint(s, nl) {
    this.serialBuf += s;
    if (nl) { this.world.onSerial(this, this.serialBuf); this.serialBuf = ''; }
    return s.length + (nl ? 2 : 0);
  }
  serialPrintStr(addr, nl) {
    let s = '';
    for (let i = 0; i < 512 && this.mem[addr + i]; i++) s += String.fromCharCode(this.mem[addr + i]);
    return this.serialPrint(s, nl);
  }
  serialAvailable() { return this.serialIn.length; }
  serialRead() { return this.serialIn.length ? this.serialIn.shift() : -1; }
  serialNotBegun() {
    this.world.warn(this, 'Nothing was printed: call Serial.begin() in setup() first. A real Blink stays silent too.');
    return 0;
  }
  serialWrite(b) { return this.serialPrint(String.fromCharCode(b), 0); }
  fmtNum(v, base, size) {
    if (base === 10) return String(v);
    const u = size >= 4 ? v >>> 0 : v & (size === 1 ? 0xffff : 0xffff); // byte/int print as unsigned int bit patterns
    return (size >= 4 ? v >>> 0 : (v < 0 ? (v >>> 0) : u)).toString(base).toUpperCase();
  }
  flushSerial() {
    if (this.serialBuf) { this.world.onSerial(this, this.serialBuf); this.serialBuf = ''; }
  }
}
