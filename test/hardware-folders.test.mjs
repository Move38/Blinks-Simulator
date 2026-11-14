// avr-gcc builds of sketch folders (several .ino tabs, .cpp files, src/) and of Custom
// Blinklib games, with the toolchain the browser downloads, run on emulated Blinks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createTools, decodePack } from '../js/hardware/tools.js';
import { buildSketch, withBios, target } from '../js/hardware/build.js';
import { sketchUnits, inoToCpp, parseDiagnostics } from '../js/hardware/sketch.js';
import { readElf } from '../js/hardware/elf.js';
import { AvrBlink, AvrTable } from '../js/hardware/blink-avr.js';

const dir = new URL('../js/hardware/toolchain/', import.meta.url);
const NAMES = { cc1plus: 'cc1plus', as: 'avr-as', ld: 'avr-ld', objcopy: 'avr-objcopy' };
let toolsPromise;
function tools() {
  toolsPromise ??= (async () => {
    const modules = {};
    for (const [tool, name] of Object.entries(NAMES)) {
      modules[tool] = {
        create: (await import(new URL(`${name}.mjs`, dir))).default,
        wasm: await WebAssembly.compile(gunzipSync(readFileSync(new URL(`${name}.wasm.gz`, dir)))),
      };
    }
    return createTools(modules, decodePack(gunzipSync(readFileSync(new URL('blinks.pack.gz', dir)))));
  })();
  return toolsPromise;
}

// Build a folder as the compile worker does; on success, its flash image too
async function build(files, main, { board = 'blink', lib = 'move38', whole = false } = {}) {
  const t = await tools();
  const units = sketchUnits(files, main);
  const r = await buildSketch(t, units, board, { prebuiltCore: true, lib, whole });
  if (!r.ok) return { ...r, diagnostics: parseDiagnostics(r.stderr, units.order) };
  const b = target(board, lib);
  return { ...r, flash: withBios(r.gameHex, new TextDecoder().decode(t.read(`/bios/${b.bios}`)), board), chip: b.mcu, lib };
}

// What each face shows once the game is going, as one letter: R, G, B or . for off. Custom
// Blinklib's BIOS (Move38's 1.2.0) spins blue for ten seconds at power-up first, looking
// for a game to download.
function colors(r) {
  const blink = new AvrBlink({ chip: r.chip, flash: r.flash });
  const start = r.lib === 'bga' ? 11.5e9 : 1e9;
  blink.runUntil(start);
  blink.takeColors();
  blink.runUntil(start + 0.1e9);
  return blink.takeColors().map(([red, g, b]) => (red > 0.5 ? 'R' : g > 0.5 ? 'G' : b > 0.5 ? 'B' : '.')).join('');
}

const FOLDER = {
  'Game.ino': '#include "src/palette.h"\nvoid setup() {}\nvoid loop() { tick(); setColor(pick()); }\n',
  // a second tab, whose function the first calls before it's defined
  'Tab.ino': 'byte ticks = 0;\nvoid tick() { ticks++; }\n',
  'src/palette.h': '#pragma once\n#include <Arduino.h>\nColor pick();\n',
  'src/palette.cpp': '#include "palette.h"\nColor pick() { return GREEN; }\n',
  'README.md': 'not built',
};

test('a sketch folder builds like the IDE builds it: .ino tabs as one file, .cpp files on their own', async () => {
  const u = sketchUnits(FOLDER, 'Game.ino');
  assert.deepEqual(u.units, ['Game.ino.cpp', 'src/palette.cpp']);
  const r = await build(FOLDER, 'Game.ino');
  assert.ok(r.ok, r.stderr);
  assert.equal(r.whole, false);
  assert.equal(colors(r), 'GGGGGG');
});

test('avr-gcc errors name the file of the folder they’re in', async () => {
  const r = await build({ ...FOLDER, 'Tab.ino': 'byte ticks = 0;\nvoid tick() { tics++; }\n', 'src/palette.cpp': '#include "palette.h"\nColor pick() { return GREN; }\n' }, 'Game.ino');
  assert.equal(r.ok, false);
  assert.deepEqual(r.diagnostics.map(({ file, line }) => [file, line]).sort(), [['Tab.ino', 2]]);
  // the joined .ino files fail first; fix them and the .cpp file's error shows
  const r2 = await build({ ...FOLDER, 'src/palette.cpp': '#include "palette.h"\nColor pick() { return GREN; }\n' }, 'Game.ino');
  assert.deepEqual(r2.diagnostics.map(({ file, line }) => [file, line]), [['src/palette.cpp', 2]]);
});

test('C files are refused with a reason, since only cc1plus is here', async () => {
  const r = await build({ ...FOLDER, 'helper.c': 'int x;\n' }, 'Game.ino');
  assert.equal(r.ok, false);
  assert.deepEqual(r.diagnostics.map(({ file, line }) => [file, line]), [['helper.c', 1]]);
  assert.match(r.diagnostics[0].message, /only C\+\+ files/);
});

const BGA = {
  'G.ino': '#ifndef BGA_CUSTOM_BLINKLIB\n#error not Custom Blinklib\n#endif\nvoid setup() {}\nvoid loop() { setColor(BLUE); }\n',
};
const faceData = (r) => readElf(r.elf).symbols.find((s) => s.name === '_ZN8blinklib2ir8internalL10face_data_E')?.size;

const RUN_BGA = { lib: 'bga' };

test('a Custom Blinklib game builds on its own blinklib and BIOS, and runs', async () => {
  const r = await build(BGA, 'G.ino', RUN_BGA);
  assert.ok(r.ok, r.stderr);
  assert.equal(r.chip, 'atmega168pb');
  // flashed with the BIOS its Arduino platform uploads, which starts at 0x2E00
  const t = await tools();
  const bios = new TextDecoder().decode(t.read('/bios/BlinkBIOS-CustomBlinklib.hex'));
  assert.ok(bios.startsWith(':102E0000'));
  assert.equal(r.flash[0x2e00], parseInt(bios.slice(9, 11), 16));
  assert.equal(colors(r), 'BBBBBB');
  assert.throws(() => target('blink328max', 'bga'), /doesn't build for blink328max/);
});

test('a Custom Blinklib game builds for the 328PB, as its bga-dev branch does, and talks to a 168PB', async () => {
  const r = await build(BGA, 'G.ino', { lib: 'bga', board: 'blink328' });
  assert.ok(r.ok, r.stderr);
  assert.equal(r.chip, 'atmega328pb');
  assert.equal(target('blink328', 'bga').bios, 'BlinkBIOS-328PB.hex');   // Move38 1.3.0's, as bga-dev ships
  assert.equal(colors(r), 'BBBBBB');
  // Neighbors on a Custom Blinklib 168PB (its 1.2.0 BIOS) beside a Custom Blinklib 328PB (1.3.0's)
  const neighbors = { 'N.ino': readFileSync(new URL('../hardware/fixtures/Neighbors/Neighbors.ino', import.meta.url), 'utf8') };
  const a = await build(neighbors, 'N.ino', { lib: 'bga' }), b = await build(neighbors, 'N.ino', { lib: 'bga', board: 'blink328' });
  const table = new AvrTable();
  table.add(new AvrBlink({ chip: a.chip, flash: a.flash }));
  table.add(new AvrBlink({ chip: b.chip, flash: b.flash }));
  table.connect(0, 0, 1, 3);
  table.run(20e9);   // past the 168PB's BIOS looking for a game to download
  table.blinks.forEach((x) => x.takeColors());
  table.run(100e6);
  assert.deepEqual(table.blinks.map((x) => x.takeColors().map(([, g]) => (g > 0.5 ? 'G' : '.')).join('')), ['G.....', '...G..']);
});

test('a Custom Blinklib game’s config/blinklib_config.h builds blinklib too', async () => {
  const plain = await build(BGA, 'G.ino', RUN_BGA);
  const config = '#define BGA_CUSTOM_BLINKLIB_IR_DATAGRAM_LEN 4\n';
  const r = await build({ ...BGA, 'config/blinklib_config.h': config }, 'G.ino', RUN_BGA);
  assert.ok(r.ok, r.stderr);
  assert.ok(r.log.some(([step]) => step === 'cc1plus blinklib_ir'), 'blinklib compiled with the config');
  assert.ok(faceData(r) < faceData(plain), `${faceData(r)} < ${faceData(plain)}: smaller datagram buffers`);
  assert.equal(colors(r), 'BBBBBB');
  // the same config again reuses what it compiled
  const again = await build({ ...BGA, 'config/blinklib_config.h': config }, 'G.ino', { lib: 'bga' });
  assert.ok(!again.log.some(([step]) => step === 'cc1plus blinklib_ir'));
});

test('built as one unit, a game and blinklib still work (the fallback for games that don’t fit)', async () => {
  const r = await build(FOLDER, 'Game.ino', { whole: true });
  assert.ok(r.ok, r.stderr);
  assert.equal(r.whole, true);
  assert.equal(colors(r), 'GGGGGG');
  const bga = await build(BGA, 'G.ino', { ...RUN_BGA, whole: true });
  assert.equal(colors(bga), 'BBBBBB');
  // two Blinks running Neighbors as one unit see each other
  const t = await tools();
  const table = new AvrTable();
  for (const [board, chip] of [['blink', 'atmega168pb'], ['blink328', 'atmega328pb']]) {
    const n = await buildSketch(t, inoToCpp(readFileSync(new URL('../hardware/fixtures/Neighbors/Neighbors.ino', import.meta.url), 'utf8'), 'Neighbors.ino'), board, { prebuiltCore: true, whole: true });
    table.add(new AvrBlink({ chip, flash: withBios(n.gameHex, new TextDecoder().decode(t.read(`/bios/${target(board).bios}`)), board) }));
  }
  table.connect(0, 0, 1, 3);
  table.run(1e9);
  table.blinks.forEach((b) => b.takeColors());
  table.run(100e6);
  assert.deepEqual(table.blinks.map((b) => b.takeColors().map(([, g]) => (g > 0.5 ? 'G' : '.')).join('')), ['G.....', '...G..']);
});

test('a game over the board’s size is built as one unit even when the linker has room, as on the 328PB', async () => {
  // a table too big for any build: the 328PB's link script takes it, but it's over 5888 bytes
  const files = { 'Big.ino': `#include <avr/pgmspace.h>\nconst byte T[6000] PROGMEM = {1};\nvoid setup() {}\nvoid loop() { setColor(makeColorRGB(pgm_read_byte(&T[millis() % 6000]), 0, 0)); }\n` };
  const r = await build(files, 'Big.ino', { board: 'blink328' });
  assert.ok(r.ok, r.stderr);
  assert.equal(r.whole, true, 'tried as one unit');
  assert.ok(r.gameBytes > target('blink328').maxGame, 'and still too big, for Upload to say so');
});
