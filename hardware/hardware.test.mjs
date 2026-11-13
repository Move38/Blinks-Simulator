// Tests for the hardware-exact spike. Run with `npm test` in this folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AvrBlink, AvrTable } from './blink-avr.js';

const image = (sketch, board) => readFileSync(new URL(`fixtures/${sketch}/build/move38.avr.${board}/${sketch}.ino.with_bootloader.hex`, import.meta.url), 'utf8');
const BOARDS = { blink: 'atmega168pb', blink328: 'atmega328pb', blink328max: 'atmega328pb', blink328nfc: 'atmega328pb' };
const litFace = (b) => b.takeColors().findIndex(([r, g]) => r > 0.5 || g > 0.5);

// blinklib's per-face state, from the Neighbors sketch's .elf (faces at 0x2a1, now at 0x3a9)
const hears = (b, f) => b.cpu.dataView.getUint32(0x2a1 + f * 44 + 2, true) > b.cpu.dataView.getUint32(0x3a9, true);

for (const [board, chip] of Object.entries(BOARDS)) {
  test(`${board}: the BIOS boots the sketch, and it spins one face every 100 ms`, () => {
    const b = new AvrBlink({ chip, hex: image('Spin', board) });
    b.runUntil(500e6);
    assert.equal(b.prescaler, 1, 'the BIOS switched to 8 MHz');
    // Sample every 20 ms for a second and keep each change of face
    const faces = [];
    for (let ms = 520; ms <= 1500; ms += 20) {
      b.takeColors();
      b.runUntil(ms * 1e6);
      const f = litFace(b);
      if (f >= 0 && f !== faces.at(-1)) faces.push(f);
    }
    for (let i = 1; i < faces.length; i++) assert.equal(faces[i], (faces[i - 1] + 1) % 6, `faces ${faces}`);
    assert.ok(faces.length >= 9 && faces.length <= 11, `${faces.length} faces in a second`);
  });
}

test('the button changes the color', () => {
  const b = new AvrBlink({ chip: 'atmega168pb', hex: image('Spin', 'blink') });
  b.runUntil(600e6);
  b.takeColors();
  b.runUntil(650e6);
  const before = b.takeColors().find(([r, g]) => r > 0.5 || g > 0.5);
  b.setButton(true); b.runUntil(750e6); b.setButton(false); b.runUntil(900e6);
  b.takeColors(); b.runUntil(950e6);
  const after = b.takeColors().find(([r, g]) => r > 0.5 || g > 0.5);
  assert.ok(before[1] < 0.2 && after[1] > 0.5, `red ${before} then yellow ${after}`);
});

test('a 168PB and a 328PB hear each other over IR, with clocks 2% apart', () => {
  const t = new AvrTable();
  t.add(new AvrBlink({ chip: 'atmega168pb', hex: image('Neighbors', 'blink'), clockScale: 1.01 }));
  t.add(new AvrBlink({ chip: 'atmega328pb', hex: image('Neighbors', 'blink328'), clockScale: 0.99 }));
  t.connect(0, 0, 1, 3);
  t.run(1e9);
  assert.ok(hears(t.blinks[0], 0) && hears(t.blinks[1], 3));
  assert.ok(!hears(t.blinks[0], 1) && !hears(t.blinks[1], 0));
});

// Links can drop for a moment when both ends probe at once and collide, but
// they come back. Before the IVSEL fix, a Blink would hang and never recover.
test('every link in a line of six stays up nearly all of 5 seconds', () => {
  const t = new AvrTable();
  const hex = image('Neighbors', 'blink');
  for (let i = 0; i < 6; i++) t.add(new AvrBlink({ chip: 'atmega168pb', hex, clockScale: 1 + (i % 5 - 2) / 100 }));
  for (let i = 0; i < 5; i++) t.connect(i, 0, i + 1, 3);
  t.run(500e6);
  const up = [0, 0, 0, 0, 0];
  for (let k = 0; k < 100; k++) {
    t.run(50e6);
    for (let i = 0; i < 5; i++) if (hears(t.blinks[i], 0) && hears(t.blinks[i + 1], 3)) up[i]++;
  }
  for (let i = 0; i < 5; i++) assert.ok(up[i] >= 90, `link ${i}-${i + 1} up ${up[i]}% of the time`);
  for (let i = 0; i < 5; i++) assert.ok(hears(t.blinks[i], 0) && hears(t.blinks[i + 1], 3), `link ${i}-${i + 1} up at the end`);
});

test('lazy timers and idle skipping give exactly the same machine state as plain avr8js', () => {
  const hex = image('Neighbors', 'blink');
  const make = (opts) => {
    const t = new AvrTable();
    t.add(new AvrBlink({ chip: 'atmega168pb', hex, clockScale: 1.01, ...opts }));
    t.add(new AvrBlink({ chip: 'atmega168pb', hex, clockScale: 0.99, ...opts }));
    t.connect(0, 0, 1, 3);
    t.run(1.5e9);
    return t;
  };
  const plain = make({ lazyTimers: false, idleSkip: false });
  const fast = make({});
  for (let i = 0; i < 2; i++) {
    assert.equal(fast.blinks[i].cpu.cycles, plain.blinks[i].cpu.cycles);
    assert.equal(fast.blinks[i].cpu.pc, plain.blinks[i].cpu.pc);
    assert.deepEqual(fast.blinks[i].cpu.data, plain.blinks[i].cpu.data);
  }
  assert.ok(fast.blinks[0].skipped > 0, 'idle skipping happened');
});
