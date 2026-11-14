// Build a Blinks sketch into a flashable image (game + BlinkBIOS) the way a
// browser would have to: no gcc driver, just cc1plus, as, ld and objcopy run
// one after another on a virtual file system. The steps are the same whether
// the tools are native (here, from the Arduino IDE's avr-gcc 7.3.0) or built
// for WebAssembly, so a WebAssembly runner only has to supply `run`.
//
// Virtual layout:
//   /sysroot/gcc/include   gcc's own headers (and include-fixed, for limits.h)
//   /sysroot/avr/include   avr-libc headers
//   /libs/avr5/            libgcc.a, libc.a, libm.a, lib<mcu>.a
//   /core/                 blinklib (cores/blinklib from the Move38 SDK)
//   /core-bga/             Custom Blinklib's blinklib (cores/blinklib from blinklib:avr 1.4.3)
//   /obj/<mcu>/            blinklib compiled ahead of time (compileCore); Custom Blinklib's in /obj/bga…
//   /ldscripts/            the SDKs' link scripts
//   /bios/                 the BlinkBIOS images
//   /build/sketch/         the sketch's files; objects and images go in /build/

import { parseHex } from './blink-avr.js';

export const BOARDS = {
  // maxGame and ram: the game's flash budget (boards.txt) and the chip's RAM
  blink:       { mcu: 'atmega168pb', board: 'AVR_BLINK_168', linkscript: 'avr5-atmega168pb.xn', builtin: 0x1700, flashBytes: 0x4000, maxGame: 5888, ram: 1024, bios: 'BlinkBIOS-168PB.hex' },
  blink328:    { mcu: 'atmega328pb', board: 'AVR_BLINK_328', linkscript: 'avr5-atmega328.xn', builtin: 0x3900, flashBytes: 0x8000, maxGame: 5888, ram: 2048, bios: 'BlinkBIOS-328PB.hex' },
  blink328max: { mcu: 'atmega328pb', board: 'AVR_BLINK_328', linkscript: 'avr5-atmega328.xn', builtin: 0x3900, flashBytes: 0x8000, maxGame: 7936, ram: 2048, bios: 'BlinkBIOS-328PB-MAX.hex' },
  blink328nfc: { mcu: 'atmega328pb', board: 'AVR_BLINK_328', linkscript: 'avr5-atmega328.xn', builtin: 0x3900, flashBytes: 0x8000, maxGame: 7936, ram: 2048, bios: 'BlinkBIOS-328PB-MAX-NFC.hex' },
};

export const CORE_SOURCES = ['blinklib.cpp', 'Timer.cpp', 'Serial.cpp', 'Print.cpp', 'main.cpp', 'sp.cpp', 'gamestat.cpp'];

// The blinklibs a sketch can be built on (the ids are compiler/sdk.js's):
//   move38  Move38's, from the Arduino IDE's move38:avr 1.3.0, for every board above
//   bga     Bruno Albuquerque's Custom Blinklib, from blinklib:avr 1.4.3: the 168PB with its
//           own link script and BIOS (Move38's 1.2.0). Its unreleased bga-dev branch adds
//           the 328PB as Move38's blink328 board (Move38 1.3.0's link script and BIOS, the
//           game at 0x3900) with 1.4.3's blinklib, whose BIOS interface matches 1.3.0's.
//           Its platform.local.txt puts the sketch's config folder on the include path,
//           so blinklib itself is built with the game's config/blinklib_config.h.
export const BLINKLIBS = {
  move38: { core: '/core', sources: CORE_SOURCES, std: 'gnu++11' },
  bga: {
    core: '/core-bga', std: 'gnu++17',
    sources: ['blinklib.cpp', 'blinklib_ir.cpp', 'blinklib_led.cpp', 'blinklib_time.cpp', 'blinklib_timer.cpp', 'blinklib_warm_sleep.cpp', 'Serial.cpp', 'Print.cpp', 'main.cpp', 'sp.cpp'],
    boards: { blink: { board: 'AVR_BLINK', linkscript: 'bga-avr5.xn', bios: 'BlinkBIOS-CustomBlinklib.hex' }, blink328: {} },
    config: 'config/blinklib_config.h',
  },
};

// A board as built on a blinklib: BOARDS[boardName] with the blinklib's changes to it
export function target(boardName = 'blink', lib = 'move38') {
  const L = BLINKLIBS[lib];
  if (!L || !BOARDS[boardName]) throw new Error(`no board ${boardName} for ${lib}`);
  if (L.boards && !L.boards[boardName]) throw new Error(`${lib} doesn't build for ${boardName}`);
  return { ...BOARDS[boardName], ...L.boards?.[boardName], lib, ...L };
}

const defines = (b) => [
  `-D__AVR_${b.mcu.replace('atmega', 'ATmega').replace(/pb$/, 'PB')}__`,
  `-D__AVR_DEVICE_NAME__=${b.mcu}`,
  '-DF_CPU=8000000L', '-DARDUINO=10819', `-DARDUINO_${b.board}`, '-DARDUINO_ARCH_AVR',
  '-isystem', '/sysroot/gcc/include', '-isystem', '/sysroot/gcc/include-fixed', '-isystem', '/sysroot/avr/include', '-I', b.core,
  ...(b.config ? ['-I', '/build/sketch/config'] : []),
];

const CXX_FLAGS = (b) => [
  '-mn-flash=1', '-mno-skip-bug', '-mmcu=avr5',
  // -fno-rtti: without LTO to drop them, classes with virtual methods (like
  // Serial) would need type info from a C++ runtime that isn't linked
  '-Os', `-std=${b.std}`, '-fpermissive', '-fno-exceptions', '-fno-rtti', '-ffunction-sections', '-fdata-sections',
  '-fno-threadsafe-statics', '-Wno-error=narrowing', '-w',
];
const AS_FLAGS = ['-mmcu=avr5', '-mno-skip-bug', '-mlink-relax'];

// Where blinklib's objects go when it is compiled, per chip. Custom Blinklib built with a
// game's config goes in a folder of its own, named after the config's text.
export const coreDir = (boardName, lib = 'move38', config = null) => {
  const { mcu } = BOARDS[boardName];
  if (lib === 'move38') return `/obj/${mcu}`;
  return config ? `/obj/${lib}-${fnv(config)}/${mcu}` : `/obj/${lib}/${mcu}`;
};
export const coreObjects = (boardName, lib = 'move38', config = null) =>
  ['startup', ...BLINKLIBS[lib].sources.map((f) => f.replace(/\.cpp$/, ''))].map((n) => `${coreDir(boardName, lib, config)}/${n}.o`);

const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16).padStart(8, '0'); };

// `tools.run(tool, args)` runs one tool and throws an Error with `.stderr` if it
// fails; `tools.read(path)` and `tools.write(path, data)` touch the virtual FS.

// Compile one C++ file to an object
async function compile(tools, b, src, obj, log, extra = []) {
  const name = src.split('/').pop().replace(/\.\w+$/, '');
  const asm = obj.replace(/\.o$/, '.s');
  await time(log, `cc1plus ${name}`, () => tools.run('cc1plus', ['-quiet', '-imultilib', 'avr5', ...defines(b), src, '-dumpbase', `${name}.cpp`, '-auxbase-strip', asm, ...CXX_FLAGS(b), ...extra, '-o', asm]));
  await time(log, `as ${name}`, () => tools.run('as', [...AS_FLAGS, '-o', obj, asm]));
}

const time = async (log, label, fn) => { const t0 = performance.now(); const r = await fn(); log.push([label, performance.now() - t0]); return r; };

const exists = (tools, path) => { try { return !!tools.read(path); } catch { return false; } };

// Compile blinklib (and its startup code) for a board, into coreDir(). For Custom Blinklib,
// `config` is the game's config/blinklib_config.h, which must be in /build/sketch/config.
export async function compileCore(tools, boardName = 'blink', { lib = 'move38', config = null } = {}, log = []) {
  const b = target(boardName, lib), dir = coreDir(boardName, lib, config);
  for (const f of b.sources) await compile(tools, b, `${b.core}/${f}`, `${dir}/${f.replace(/\.cpp$/, '.o')}`, log);
  // startup.S goes through the C preprocessor, which cc1plus can do on its own
  await time(log, 'cpp startup', () => tools.run('cc1plus', ['-E', '-lang-asm', '-D__ASSEMBLER__', '-imultilib', 'avr5', ...defines(b), `${b.core}/startup.S`, '-o', `${dir}/startup.s`]));
  await time(log, 'as startup', () => tools.run('as', [...AS_FLAGS, '-o', `${dir}/startup.o`, `${dir}/startup.s`]));
  return coreObjects(boardName, lib, config);
}

// Build a sketch into a game image. `sketch` is either C++ as the Arduino IDE hands it to
// the compiler (with `#include <Arduino.h>` and prototypes; see sketch.js), or a sketch
// folder { files: { path: text }, units: [the paths to compile] } (sketchUnits in sketch.js).
// With `prebuiltCore`, blinklib's objects are used if they're already in coreDir().
//
// The Arduino IDE links Blinks games with link-time optimization, which this toolchain
// doesn't have, and some games only fit with it. So a game that doesn't fit is built again
// as one unit: every file of it and of blinklib #included into one, compiled with
// -fwhole-program, which shrinks it nearly as much (Hexxagon: 5632 bytes, against 5596
// with LTO and 6580 without). `whole` says when that happened; pass `whole: true` to build
// that way from the start.
// Returns { ok, gameHex, gameBytes, elf, whole, log } or { ok: false, stage, stderr, log }.
export async function buildSketch(tools, sketch, boardName = 'blink', { prebuiltCore = false, lib = 'move38', whole = false } = {}) {
  const b = target(boardName, lib);
  const log = [];
  const { files, units } = typeof sketch === 'string' ? { files: { 'sketch.cpp': sketch }, units: ['sketch.cpp'] } : sketch;
  if (tools.files) for (const path of [...tools.files.keys()]) if (path.startsWith('/build/')) tools.files.delete(path);
  for (const [path, text] of Object.entries(files)) await tools.write(`/build/sketch/${path}`, text);

  const config = (b.config && files[b.config]) || null;
  const core = prebuiltCore && exists(tools, coreObjects(boardName, lib, config)[0])
    ? coreObjects(boardName, lib, config)
    : await compileCore(tools, boardName, { lib, config }, log);
  let stage = 'compile';
  if (whole) {
    try { return await buildWhole(tools, b, units, core[0], log); }
    catch (e) { if (e.stderr === undefined) throw e; return { ok: false, stage, stderr: e.stderr, log }; }
  }
  try {
    const objects = [];
    for (const path of units) {
      // cc1plus is the only compiler here, and C isn't C++
      if (!/\.(cpp|cc)$/i.test(path)) return { ok: false, stage, stderr: `/build/sketch/${path}:1:1: error: only C++ files can be built here; rename it to .cpp, or build this sketch in the Arduino IDE`, log };
      const obj = `/build/obj/${path.replace(/\.\w+$/, '.o')}`;
      await compile(tools, b, `/build/sketch/${path}`, obj, log);
      objects.push(obj);
    }
    stage = 'link';
    await time(log, 'ld', () => tools.run('ld', [
      '-m', 'avr5', '-T', `/ldscripts/${b.linkscript}`, '--gc-sections', '--relax', '-o', '/build/game.elf',
      ...core, ...objects, '-L', '/libs/avr5', '--start-group', '-lgcc', '-lm', '-lc', `-l${b.mcu}`, '--end-group',
    ]));
  } catch (e) {
    if (e.stderr === undefined) throw e;
    if (stage === 'link' && /overflowed by/.test(e.stderr)) {
      try { return await buildWhole(tools, b, units, core[0], log); }
      catch (e2) { if (e2.stderr === undefined) throw e2; }   // it doesn't build as one unit: say why it didn't fit
    }
    return { ok: false, stage, stderr: e.stderr, log };
  }
  return finish(tools, b, false, log);
}

// The sketch and blinklib as one unit (see buildSketch); throws like tools.run if it doesn't build
async function buildWhole(tools, b, units, startup, log) {
  // relative to /build, so the native tools find them too
  const sources = [...units.map((p) => `sketch/${p}`), ...b.sources.map((f) => `..${b.core}/${f}`)];
  await tools.write('/build/whole.cpp', sources.map((s) => `#include "${s}"`).join('\n') + '\n');
  await compile(tools, b, '/build/whole.cpp', '/build/whole.o', log, ['-fwhole-program']);
  await time(log, 'ld whole', () => tools.run('ld', [
    '-m', 'avr5', '-T', `/ldscripts/${b.linkscript}`, '--gc-sections', '--relax', '-o', '/build/game.elf',
    startup, '/build/whole.o', '-L', '/libs/avr5', '--start-group', '-lgcc', '-lm', '-lc', `-l${b.mcu}`, '--end-group',
  ]));
  return finish(tools, b, true, log);
}

async function finish(tools, b, whole, log) {
  await time(log, 'objcopy', () => tools.run('objcopy', ['--change-addresses', `0x${b.builtin.toString(16)}`, '-O', 'ihex', '-R', '.eeprom', '/build/game.elf', '/build/game.hex']));

  const gameHex = new TextDecoder().decode(await tools.read('/build/game.hex'));
  const gameBytes = gameHex.split('\n').filter((l) => l.slice(7, 9) === '00').reduce((n, l) => n + parseInt(l.slice(1, 3), 16), 0);
  return { ok: true, gameHex, gameBytes, elf: await tools.read('/build/game.elf'), whole, log };
}

// The image a Blink is flashed with: the game in the built-in area plus the BIOS
export function withBios(gameHex, biosHex, boardName = 'blink') {
  const size = BOARDS[boardName].flashBytes;
  const game = parseHex(gameHex, size), bios = parseHex(biosHex, size);
  for (let i = 0; i < size; i++) if (bios[i] !== 0xff) game[i] = bios[i];
  return game;
}
