// One Blink as real hardware: an AVR running the BlinkBIOS, blinklib and a
// sketch from the same .hex the Arduino IDE flashes, with the Blink's LEDs,
// button and IR LEDs wired to the emulated pins.
//
// avr8js supplies the CPU core and the timers, ports, ADC, USART and watchdog.
// This file adds what a Blink needs beyond an Arduino Uno:
//   - SPM, so the BIOS can copy the built-in game to the active area (and,
//     later, write games downloaded from a neighbor)
//   - SLEEP, which skips ahead to the next timer or pin event
//   - IVSEL, since the BIOS moves the interrupt vectors to the bootloader
//   - PORTE, which only the PB chips have (two pixel anodes and the blue pump)
//   - CLKDIV8 at reset, which the BIOS raises to 8 MHz after the battery check
//   - IR LEDs that see light from a neighbor's facing LED

import {
  CPU, avrInstruction, avrInterrupt, AVRTimer, timer0Config, timer1Config, timer2Config,
  AVRIOPort, portBConfig, portCConfig, portDConfig, portEConfig, PinState,
  AVRADC, adcConfig, AVRUSART, usart0Config, AVRWatchdog, watchdogConfig,
  AVREEPROM, EEPROMMemoryBackend, eepromConfig,
} from 'avr8js';

export const CHIPS = {
  // Original Blinks. Boot section is 1K words (BOOTSZ=00, efuse 0xF8).
  atmega168pb: { flashBytes: 0x4000, sramBytes: 1024, eepromBytes: 512, bootStart: 0x3800 },
  // Newer Blinks (Blink328, BlinkMAX, BlinkNFC). Boot section is 2K words (hfuse 0xD8).
  atmega328pb: { flashBytes: 0x8000, sramBytes: 2048, eepromBytes: 1024, bootStart: 0x7000 },
};

const F_BASE = 8_000_000;   // internal RC oscillator
const PAGE_BYTES = 128;     // SPM page size on both chips

// Data-space addresses
const SPMCSR = 0x57, MCUCR = 0x55, SMCR = 0x53, CLKPR = 0x61;
const SPMEN = 1, PGERS = 2, PGWRT = 4, RWWSRE = 0x10, SIGRD = 0x20, RWWSB = 0x40;
const IVSEL = 2;

// Opcodes handled here instead of by avr8js
const OP_SPM = 0x95e8, OP_SPM_INC = 0x95f8, OP_SLEEP = 0x9588;

// Pins (BlinkBIOS hardware.h)
const ANODES = [['B', 6], ['E', 0], ['B', 7], ['E', 1], ['D', 4], ['D', 2]];
const RED = 6, GREEN = 5, BLUE = 3;   // PORTD sinks, driven low (by timer PWM) to light
const BUTTON = 7;                     // PORTD, pulled up, low when pressed

// avr8js wakes each timer on every tick, every 8 cycles for the pixel timers.
// A lazy timer instead sleeps until the next tick where something happens (a
// compare match or an overflow) and catches up whenever the firmware touches
// it. The counter math is avr8js's own, which already handles several ticks
// at once, so the result is the same, with far fewer clock events.
const PHASE_CORRECT = new Set([1, 4]);   // avr8js TimerMode.PWMPhaseCorrect, PWMPhaseFrequencyCorrect

class LazyTimer extends AVRTimer {
  constructor(cpu, config) {
    super(cpu, config);
    const count = this.count;
    this.eventAt = Infinity;    // the cycle of the next compare match or overflow
    // Bring the counter up to now. An instruction can end a cycle or two past
    // the event, and avr8js can't see a compare match in a jump of a whole
    // period, so stop at each event on the way.
    this.advance = (external = false) => {
      const now = cpu.cycles;
      for (let i = 0; i < 4 && this.eventAt < now && this.divider && !this.updateDivider && !this.tcntUpdated; i++) {
        cpu.cycles = this.eventAt;
        count(false);
        this.eventAt = cpu.cycles + this.nextEventCycles();
        cpu.cycles = now;
      }
      count(false, external);
    };
    this.count = (reschedule = true, external = false) => {
      this.advance(external);
      this.reschedule();
    };
    // Bring the counter up to date before any write that changes how it counts
    for (const reg of [config.TCNT, config.OCRA, config.OCRB, config.TCCRA, config.TCCRB, config.ICR]) {
      const hook = reg && cpu.writeHooks[reg];
      if (!hook) continue;
      cpu.writeHooks[reg] = (value, old, addr, mask) => {
        if (!this.updateDivider && !this.tcntUpdated) this.advance();
        const r = hook(value, old, addr, mask);
        this.reschedule();
        return r;
      };
    }
  }

  reschedule() {
    const { cpu } = this;
    cpu.clearClockEvent(this.count);
    this.eventAt = Infinity;
    if (this.updateDivider) cpu.addClockEvent(this.count, 0);
    else if (this.divider) {
      const dt = this.nextEventCycles();
      this.eventAt = cpu.cycles + dt;
      cpu.addClockEvent(this.count, dt);
    }
  }

  // Cycles from now until the counter next reaches OCRA, OCRB or wraps
  nextEventCycles() {
    const { divider, tcnt, TOP, cpu } = this;
    if (this.tcntUpdated) return 0;
    if (PHASE_CORRECT.has(this.timerMode)) return Math.max(0, this.lastCycle + divider - cpu.cycles);
    let ticks = TOP + 1 - tcnt;                               // to overflow
    for (const ocr of [this.ocrA, this.ocrB]) {
      if (ocr > tcnt && ocr <= TOP) ticks = Math.min(ticks, ocr - tcnt);
    }
    return Math.max(0, this.lastCycle + ticks * divider - cpu.cycles);
  }
}

export function parseHex(text, size) {
  const bytes = new Uint8Array(size).fill(0xff);
  let base = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(':')) continue;
    const n = parseInt(line.slice(1, 3), 16);
    const addr = parseInt(line.slice(3, 7), 16);
    const type = parseInt(line.slice(7, 9), 16);
    const data = line.slice(9, 9 + n * 2);
    if (type === 0) {
      for (let i = 0; i < n; i++) bytes[base + addr + i] = parseInt(data.slice(i * 2, i * 2 + 2), 16);
    } else if (type === 2) base = parseInt(data, 16) << 4;
    else if (type === 4) base = parseInt(data, 16) << 16;
  }
  return bytes;
}

export class AvrBlink {
  // Pass either `hex` (an Intel HEX image) or `flash` (the bytes of flash)
  constructor({ chip = 'atmega168pb', hex, flash, clockScale = 1, idleSkip = true, lazyTimers = true }) {
    const c = CHIPS[chip];
    if (!c) throw new Error(`unknown chip ${chip}`);
    this.chip = c;
    this.clockScale = clockScale;   // this Blink's oscillator error (1.02 = 2% fast)
    const image = flash ? Uint8Array.from(flash) : parseHex(hex, c.flashBytes);
    this.cpu = new CPU(new Uint16Array(image.buffer), c.sramBytes);
    const cpu = this.cpu;
    // avr8js runs one due clock event per instruction, and removes it from the
    // queue after running it, which loses any event the callback moves. Run
    // every due event, removing each one first. And when the BIOS has set
    // IVSEL, send interrupts to the vector table in the boot section.
    const blink = this;
    const bootWord = c.bootStart >> 1;
    cpu.tick = function () {
      let ev;
      while ((ev = this.nextClockEvent) && ev.cycles <= this.cycles) {
        this.nextClockEvent = ev.next;
        ev.callback();
        if (this.clockEventPool.length < 10) this.clockEventPool.push(ev);
      }
      const i = this.nextInterrupt;
      if (this.interruptsEnabled && i >= 0) {
        const interrupt = this.pendingInterrupts[i];
        avrInterrupt(this, interrupt.address + (this.data[MCUCR] & IVSEL ? bootWord : 0));
        if (!interrupt.constant) this.clearInterrupt(interrupt);
        blink.dirty = true;
      }
    };

    const Timer = lazyTimers ? LazyTimer : AVRTimer;
    this.timers = [timer0Config, timer1Config, timer2Config].map((t) => new Timer(cpu, t));
    this.ports = {
      B: new AVRIOPort(cpu, portBConfig),
      C: new AVRIOPort(cpu, portCConfig),
      D: new AVRIOPort(cpu, portDConfig),
      E: new AVRIOPort(cpu, portEConfig),
    };
    this.adc = new AVRADC(cpu, adcConfig);
    this.adc.avcc = 3.0;    // a fresh CR2032
    this.usart = new AVRUSART(cpu, usart0Config, F_BASE);
    this.serial = '';
    this.usart.onByteTransmit = (b) => { this.serial += String.fromCharCode(b); };
    // The watchdog runs from its own 128 kHz oscillator, so it needs the CPU clock to convert
    this.watchdog = new AVRWatchdog(cpu, watchdogConfig, { get frequency() { return F_BASE / blink.prescaler; } });
    this.eeprom = new AVREEPROM(cpu, new EEPROMMemoryBackend(c.eepromBytes), eepromConfig);

    // Fuses: BOOTRST is programmed, so reset jumps to the BIOS, and CKDIV8 is
    // programmed, so the chip starts at 1 MHz.
    cpu.pc = c.bootStart >> 1;
    this.prescaler = 8;
    cpu.data[CLKPR] = 3;
    cpu.writeHooks[CLKPR] = (value) => {
      if (value & 0x80) return true;            // CLKPCE: the unlock write
      this.nsBase = this.ns;
      this.cyclesBase = cpu.cycles;
      this.prescaler = 1 << (value & 0x0f);
      cpu.data[CLKPR] = value & 0x0f;
      return true;
    };

    this.pageBuffer = new Uint16Array(PAGE_BYTES / 2).fill(0xffff);
    this.sleeping = false;

    // Idle loop skipping (see spin). Any store, an interrupt, or a read of a
    // register that changes by itself (like a timer's counter) marks the
    // current loop round as not idle.
    this.idleSkip = idleSkip;
    this.spinHead = -1;
    this.spinCycles = 0;
    this.spinState = new Uint8Array(35);
    this.dirty = true;
    this.skipped = 0;
    const writeData = cpu.writeData.bind(cpu);
    cpu.writeData = (addr, value, mask) => { this.dirty = true; writeData(addr, value, mask); };
    const readData = cpu.readData.bind(cpu);
    cpu.readData = (addr) => { if (cpu.readHooks[addr]) this.dirty = true; return readData(addr); };
    // Time comes from the cycle count, so it doesn't depend on how the cycles were run
    this.nsBase = 0;
    this.cyclesBase = 0;

    this.setButton(false);
    this.initPixels();
    this.initIR();
  }

  // Time this Blink has lived, in its own nanoseconds
  get ns() {
    return this.nsBase + ((this.cpu.cycles - this.cyclesBase) * this.prescaler * 1e9) / (F_BASE * this.clockScale);
  }

  // The cycle count at which this Blink's clock reaches `ns`, at the current clock speed
  cyclesAt(ns) {
    return this.cyclesBase + Math.ceil(((ns - this.nsBase) * F_BASE * this.clockScale) / (1e9 * this.prescaler));
  }

  // Run until this Blink's clock reaches `ns` (table time), turning on and off
  // the light from neighbors' IR LEDs at the moments it arrives.
  runUntil(ns) {
    const q = this.irQueue;
    while (q.length && q[0].ns <= ns) {
      const ev = q.shift();
      this.runCycles(ev.ns);
      this.applyIRLight(ev.face, ev.on);
    }
    this.runCycles(ns);
  }

  runCycles(ns) {
    const cpu = this.cpu;
    const prog = cpu.progMem;
    let prescaler = this.prescaler;
    let target = this.cyclesAt(ns);
    while (cpu.cycles < target) {
      if (this.sleeping) {
        if (cpu.nextInterrupt >= 0 && cpu.interruptsEnabled) {
          this.sleeping = false;
        } else {
          // Nothing to do until the next timer event (or the end of this slice)
          const next = cpu.nextClockEvent ? cpu.nextClockEvent.cycles : Infinity;
          cpu.cycles = Math.max(cpu.cycles + 1, Math.min(next, target));
        }
      } else {
        const op = prog[cpu.pc];
        if (op === OP_SPM || op === OP_SPM_INC) this.spm(op === OP_SPM_INC);
        else if (op === OP_SLEEP) { cpu.pc++; cpu.cycles++; if (cpu.data[SMCR] & 1) this.sleeping = true; }
        else {
          const pc0 = cpu.pc;
          avrInstruction(cpu);
          if (this.idleSkip && cpu.pc < pc0 && pc0 - cpu.pc < 16) this.spin(target);
        }
      }
      cpu.tick();
      if (this.prescaler !== prescaler) { prescaler = this.prescaler; target = this.cyclesAt(ns); }
    }
  }

  // Called on every short backward jump. If the loop just went round with the
  // same registers, SP and SREG, stored nothing and read no live register, the
  // next round will be the same, and so will every round until a timer event
  // or interrupt changes something. So jump ahead by whole rounds, stopping before the next event:
  // the result is cycle for cycle what the CPU would have done.
  // This catches the BIOS waiting for vertical blank and for IR sends.
  spin(target) {
    const cpu = this.cpu, d = cpu.data, st = this.spinState;
    let same = cpu.pc === this.spinHead && !this.dirty;
    if (same) {
      for (let i = 0; i < 32; i++) if (st[i] !== d[i]) { same = false; break; }
      same = same && st[32] === d[0x5d] && st[33] === d[0x5e] && st[34] === d[0x5f];
    }
    if (same) {
      const round = cpu.cycles - this.spinCycles;
      const next = cpu.nextClockEvent ? cpu.nextClockEvent.cycles : Infinity;
      const rounds = Math.floor((Math.min(next, target) - 1 - cpu.cycles) / round);
      if (rounds > 0 && cpu.nextInterrupt < 0) {
        cpu.cycles += rounds * round;
        this.skipped += rounds * round;
      }
    } else {
      st.set(d.subarray(0, 32));
      st[32] = d[0x5d]; st[33] = d[0x5e]; st[34] = d[0x5f];
    }
    this.spinHead = cpu.pc;
    this.spinCycles = cpu.cycles;
    this.dirty = false;
  }

  // SPM: fill the page buffer, erase a page, write a page, or re-enable RWW
  spm(postIncrement) {
    const cpu = this.cpu;
    const ctrl = cpu.data[SPMCSR];
    const z = cpu.dataView.getUint16(30, true);
    const page = z & ~(PAGE_BYTES - 1);
    if ((ctrl & 0x1f) === SPMEN) {
      this.pageBuffer[(z & (PAGE_BYTES - 1)) >> 1] = cpu.data[0] | (cpu.data[1] << 8);
    } else if ((ctrl & 0x1f) === (PGERS | SPMEN)) {
      cpu.progMem.fill(0xffff, page >> 1, (page + PAGE_BYTES) >> 1);
      cpu.data[SPMCSR] |= RWWSB;
    } else if ((ctrl & 0x1f) === (PGWRT | SPMEN)) {
      cpu.progMem.set(this.pageBuffer, page >> 1);
      this.pageBuffer.fill(0xffff);
      cpu.data[SPMCSR] |= RWWSB;
    } else if ((ctrl & 0x1f) === (RWWSRE | SPMEN)) {
      cpu.data[SPMCSR] &= ~RWWSB;
    } else if (ctrl & SIGRD) {
      // Signature row reads are not emulated yet
    }
    // Erase and write finish at once here; on hardware they take about 4 ms
    cpu.data[SPMCSR] &= ~0x3f;
    if (postIncrement) cpu.dataView.setUint16(30, (z + 2) & 0xffff, true);
    cpu.pc++;
    cpu.cycles += 2;
  }

  // ---------- Button ----------

  setButton(down) {
    this.ports.D.setPin(BUTTON, !down);
  }

  // ---------- Pixels ----------
  // The BIOS lights one pixel at a time: it raises that pixel's anode and PWMs
  // the red, green and blue sinks low. We add up how long each color is lit on
  // each pixel, which is what an eye (or a camera) sees.

  initPixels() {
    this.light = Array.from({ length: 6 }, () => [0, 0, 0]);
    this.lightSince = 0;
    this.pixelState = { anode: -1, r: false, g: false, b: false };
    const update = () => this.pixelChange();
    this.ports.B.addListener(update);
    this.ports.D.addListener(update);
    this.ports.E.addListener(update);
  }

  pixelChange() {
    const now = this.cpu.cycles;
    const s = this.pixelState;
    if (s.anode >= 0) {
      const dt = now - this.lightSince;
      const acc = this.light[s.anode];
      if (s.r) acc[0] += dt;
      if (s.g) acc[1] += dt;
      if (s.b) acc[2] += dt;
    }
    this.lightSince = now;
    s.anode = -1;
    for (let i = 0; i < 6; i++) {
      const [p, bit] = ANODES[i];
      if (this.ports[p].pinState(bit) === PinState.High) { s.anode = i; break; }
    }
    const d = this.ports.D;
    s.r = d.pinState(RED) === PinState.Low;
    s.g = d.pinState(GREEN) === PinState.Low;
    s.b = d.pinState(BLUE) === PinState.Low;
  }

  // Average brightness (0..1) of each color on each pixel since the last call,
  // scaled so a pixel lit for its whole slot reads 1.
  takeColors() {
    this.pixelChange();
    const total = this.cpu.cycles - (this.colorsSince ?? 0);
    this.colorsSince = this.cpu.cycles;
    // Each pixel has 5 timer phases per frame and each color gets one of them
    const slot = total / 6 / 5;
    const out = this.light.map((acc) => acc.map((v) => (slot > 0 ? Math.min(1, v / slot) : 0)));
    this.light.forEach((acc) => acc.fill(0));
    return out;
  }

  // ---------- IR ----------
  // Each face has an IR LED with its anode on PORTB and cathode on PORTC.
  // Sending: cathode driven low, anode driven high, so the LED lights.
  // Receiving: the BIOS charges the cathode high, then lets it float. Light
  // from the facing LED drains it, the pin reads 0, and a pin change fires.

  initIR() {
    this.irLit = 0;             // faces whose IR LED is lit right now
    this.irSeen = 0;            // faces a neighbor's IR LED is shining on right now
    this.irCharged = 0;         // faces whose cathode holds charge
    this.onIRChange = null;     // (face, lit, ns) => void, set by the table
    this.irQueue = [];          // light from neighbors that arrives later in this Blink's time
    const update = () => this.irChange();
    this.ports.B.addListener(update);
    this.ports.C.addListener(update);
  }

  irChange() {
    const { B, C } = this.ports;
    let lit = 0;
    for (let f = 0; f < 6; f++) {
      const s = C.pinState(f);
      if (B.pinState(f) === PinState.High && s === PinState.Low) lit |= 1 << f;
      if (s === PinState.High) this.irCharged |= 1 << f;   // being charged
      if (s === PinState.Low) this.irCharged &= ~(1 << f);
    }
    const changed = lit ^ this.irLit;
    this.irLit = lit;
    if (changed && this.onIRChange) {
      for (let f = 0; f < 6; f++) if (changed & (1 << f)) this.onIRChange(f, !!(lit & (1 << f)), this.ns);
    }
    this.irSettle();
  }

  // A neighbor's facing LED turned on or off at time `ns`. If this Blink hasn't
  // got there yet, it waits in the queue; if it's already past (it ran first
  // in this slice), it arrives now, at most one slice late.
  setIRLight(face, on, ns) {
    if (ns > this.ns) {
      const q = this.irQueue;
      let i = q.length;
      while (i > 0 && q[i - 1].ns > ns) i--;
      q.splice(i, 0, { ns, face, on });
    } else this.applyIRLight(face, on);
  }

  applyIRLight(face, on) {
    if (on) this.irSeen |= 1 << face;
    else this.irSeen &= ~(1 << face);
    this.irSettle();
  }

  // Floating cathodes lose their charge while light shines on them
  irSettle() {
    const C = this.ports.C;
    const ddr = this.cpu.data[portCConfig.DDR];
    this.irCharged &= ~(this.irSeen & ~ddr);
    for (let f = 0; f < 6; f++) {
      const m = 1 << f;
      if (!(ddr & m)) {
        const v = !!(this.irCharged & m);
        if (this._irPin?.[f] !== v) {
          (this._irPin ??= [])[f] = v;
          C.setPin(f, v);
        }
      }
    }
  }
}

// A table of hardware Blinks, run in lockstep slices so IR light reaches each
// neighbor within one slice of when it was sent.
export class AvrTable {
  constructor({ sliceNs = 5000 } = {}) {
    this.blinks = [];
    this.links = new Map();   // "i:f" -> [j, g]
    this.sliceNs = sliceNs;
    this.ns = 0;
  }

  add(blink) {
    const i = this.blinks.push(blink) - 1;
    blink.onIRChange = (face, on, ns) => {
      const peer = this.links.get(`${i}:${face}`);
      if (peer) this.blinks[peer[0]].setIRLight(peer[1], on, ns);
    };
    return i;
  }

  // Put face f of Blink i against face g of Blink j
  connect(i, f, j, g) {
    this.links.set(`${i}:${f}`, [j, g]);
    this.links.set(`${j}:${g}`, [i, f]);
  }

  run(ns) {
    const end = this.ns + ns;
    while (this.ns < end) {
      this.ns = Math.min(end, this.ns + this.sliceNs);
      for (const b of this.blinks) b.runUntil(this.ns);
    }
  }
}
