// Tests for the hardware-exact spike. Run with `npm test` in this folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AvrBlink, AvrTable, CHIPS, parseHex } from '../js/hardware/blink-avr.js';
import { HardwareWorld } from '../js/hardware/world.js';

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

// Game sharing is the BIOS's own SEED, PULL and PUSH packets over IR. A Blink running
// Neighbors is held alone until it spins blue (3 s), let go, and a Blink running Spin is
// put beside it. The BIOS's IR timing allows the two clocks to be up to 5% apart.
function share(clockGap, seconds) {
  const program = (sketch) => ({ chip: 'atmega168pb', flash: parseHex(image(sketch, 'blink'), CHIPS.atmega168pb.flashBytes), symbols: {} });
  const neighbors = program('Neighbors'), spin = program('Spin');
  const w = new HardwareWorld();
  const a = w.addBlink(0, 0, 0), b = w.addBlink(5, 5, 0);
  a.clockSkew = -1; b.clockSkew = 1;
  w.drift = clockGap / 2;
  a.powerUp(neighbors); b.powerUp(spin);
  const run = (ms) => { for (let t = 0; t < ms; t += 16) w.advance(16); };
  run(800);
  a.press(true); run(4000); a.press(false);
  run(300);
  w.lift(b); w.place(b, 1, 0);
  run(seconds * 1000);
  // The game runs from the bottom 0x1700 bytes of flash; the built-in game is the next 0x1700
  const game = (flash, at = 0) => [...new Uint16Array(flash.buffer, at, 0x1700 / 2)];
  const flashB = b.avr.cpu.progMem;
  return { a, b, received: game(flashB), builtIn: game(flashB, 0x1700), neighbors: game(neighbors.flash, 0x1700), spin: game(spin.flash, 0x1700) };
}

test('a Blink shares its game with a neighbor whose clock is 4% off', () => {
  const { a, b, received, builtIn, neighbors, spin } = share(0.04, 25);
  assert.deepEqual(received, neighbors, 'the neighbor has the whole game');
  assert.deepEqual(builtIn, spin, 'and still has its own built-in game');
  // Both run Neighbors: green on the touching faces only
  const green = (x) => x.avr.takeColors().map(([r, g]) => g > 0.5 && r < 0.2);
  assert.deepEqual(green(a), [false, false, true, false, false, false]);
  assert.deepEqual(green(b), [false, false, false, false, false, true]);
});

test('with clocks 8% apart, past what the BIOS allows, the neighbor never starts downloading', () => {
  const { received, spin } = share(0.08, 10);
  assert.deepEqual(received, spin);
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

// The build a browser would run: cc1plus, as, ld and objcopy with no gcc driver.
// Here the tools are the Arduino IDE's avr-gcc 7.3.0; skipped if it isn't installed.
test('a sketch built without the gcc driver runs, and talks between a 168PB and a 328PB', async (t) => {
  const { existsSync } = await import('node:fs');
  const { nativeTools, GCC, SDK } = await import('./native-tools.mjs');
  if (!existsSync(GCC) || !existsSync(SDK)) return t.skip('needs the Arduino IDE with avr-gcc 7.3.0 and the Move38 SDK 1.3.0');
  const { buildSketch, withBios, BOARDS } = await import('../js/hardware/build.js');
  const sketch = '#include <Arduino.h>\n#line 1 "Neighbors.ino"\n' + readFileSync(new URL('fixtures/Neighbors/Neighbors.ino', import.meta.url), 'utf8');
  const table = new AvrTable();
  for (const [board, chip] of [['blink', 'atmega168pb'], ['blink328', 'atmega328pb']]) {
    const { gameHex, gameBytes } = await buildSketch(nativeTools(), sketch, board);
    assert.ok(gameBytes > 1000 && gameBytes < 5888, `${gameBytes} bytes`);
    const bios = readFileSync(`${SDK}/bootloaders/${BOARDS[board].bios}`, 'utf8');
    table.add(new AvrBlink({ chip, flash: withBios(gameHex, bios, board) }));
  }
  table.connect(0, 0, 1, 3);
  table.run(1e9);
  table.blinks.forEach((b) => b.takeColors());
  table.run(100e6);
  const green = (b) => b.takeColors().map(([, g]) => g > 0.5);
  assert.deepEqual(green(table.blinks[0]), [true, false, false, false, false, false]);
  assert.deepEqual(green(table.blinks[1]), [false, false, false, true, false, false]);
});

// The same build with avr-gcc 7.3.0 and binutils built for WebAssembly, from
// the toolchain the browser downloads (js/hardware/toolchain, with blinklib
// compiled ahead of time). Skipped unless the IDE's tools are installed to compare with.
test('the browser toolchain builds the same bytes as the IDE\'s avr-gcc', async (t) => {
  const { existsSync } = await import('node:fs');
  const { nativeTools, GCC, SDK } = await import('./native-tools.mjs');
  if (!existsSync(GCC) || !existsSync(SDK)) return t.skip('needs the Arduino IDE with avr-gcc 7.3.0 and the Move38 SDK 1.3.0');
  const { wasmToolsFromPack } = await import('./wasm-tools.mjs');
  const { buildSketch, withBios, BOARDS } = await import('../js/hardware/build.js');
  const wasm = await wasmToolsFromPack();
  for (const name of ['Spin', 'Neighbors']) {
    const sketch = `#include <Arduino.h>\n#line 1 "${name}.ino"\n` + readFileSync(new URL(`fixtures/${name}/${name}.ino`, import.meta.url), 'utf8');
    for (const board of ['blink', 'blink328']) {
      const w = await buildSketch(wasm, sketch, board, { prebuiltCore: true });
      const n = await buildSketch(nativeTools(), sketch, board);
      const bios = readFileSync(`${SDK}/bootloaders/${BOARDS[board].bios}`, 'utf8');
      assert.deepEqual(withBios(w.gameHex, bios, board), withBios(n.gameHex, bios, board), `${name} on ${board}`);
    }
  }
});
