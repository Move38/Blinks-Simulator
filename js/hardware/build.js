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
//   /obj/<mcu>/            blinklib compiled ahead of time (compileCore)
//   /ldscripts/            the SDK's link scripts
//   /build/                sources in, objects and images out

import { parseHex } from './blink-avr.js';

export const BOARDS = {
  // maxGame and ram: the game's flash budget (boards.txt) and the chip's RAM
  blink:       { mcu: 'atmega168pb', board: 'AVR_BLINK_168', linkscript: 'avr5-atmega168pb.xn', builtin: 0x1700, flashBytes: 0x4000, maxGame: 5888, ram: 1024, bios: 'BlinkBIOS-168PB.hex' },
  blink328:    { mcu: 'atmega328pb', board: 'AVR_BLINK_328', linkscript: 'avr5-atmega328.xn', builtin: 0x3900, flashBytes: 0x8000, maxGame: 5888, ram: 2048, bios: 'BlinkBIOS-328PB.hex' },
  blink328max: { mcu: 'atmega328pb', board: 'AVR_BLINK_328', linkscript: 'avr5-atmega328.xn', builtin: 0x3900, flashBytes: 0x8000, maxGame: 7936, ram: 2048, bios: 'BlinkBIOS-328PB-MAX.hex' },
  blink328nfc: { mcu: 'atmega328pb', board: 'AVR_BLINK_328', linkscript: 'avr5-atmega328.xn', builtin: 0x3900, flashBytes: 0x8000, maxGame: 7936, ram: 2048, bios: 'BlinkBIOS-328PB-MAX-NFC.hex' },
};

export const CORE_SOURCES = ['blinklib.cpp', 'Timer.cpp', 'Serial.cpp', 'Print.cpp', 'main.cpp', 'sp.cpp', 'gamestat.cpp'];

const defines = (b) => [
  `-D__AVR_${b.mcu.replace('atmega', 'ATmega').replace(/pb$/, 'PB')}__`,
  `-D__AVR_DEVICE_NAME__=${b.mcu}`,
  '-DF_CPU=8000000L', '-DARDUINO=10819', `-DARDUINO_${b.board}`, '-DARDUINO_ARCH_AVR',
  '-isystem', '/sysroot/gcc/include', '-isystem', '/sysroot/gcc/include-fixed', '-isystem', '/sysroot/avr/include', '-I', '/core',
];

const CXX_FLAGS = [
  '-mn-flash=1', '-mno-skip-bug', '-mmcu=avr5',
  // -fno-rtti: without LTO to drop them, classes with virtual methods (like
  // Serial) would need type info from a C++ runtime that isn't linked
  '-Os', '-std=gnu++11', '-fpermissive', '-fno-exceptions', '-fno-rtti', '-ffunction-sections', '-fdata-sections',
  '-fno-threadsafe-statics', '-Wno-error=narrowing', '-w',
];
const AS_FLAGS = ['-mmcu=avr5', '-mno-skip-bug', '-mlink-relax'];

// Where blinklib's objects go when it is compiled once ahead of time, per chip
export const coreDir = (boardName) => `/obj/${BOARDS[boardName].mcu}`;
export const coreObjects = (boardName) => ['startup', ...CORE_SOURCES.map((f) => f.replace(/\.cpp$/, ''))].map((n) => `${coreDir(boardName)}/${n}.o`);

// `tools.run(tool, args)` runs one tool and throws an Error with `.stderr` if it
// fails; `tools.read(path)` and `tools.write(path, data)` touch the virtual FS.

// Compile one C++ file to an object
async function compile(tools, b, src, obj, log) {
  const name = src.split('/').pop().replace(/\.\w+$/, '');
  const asm = obj.replace(/\.o$/, '.s');
  await time(log, `cc1plus ${name}`, () => tools.run('cc1plus', ['-quiet', '-imultilib', 'avr5', ...defines(b), src, '-dumpbase', `${name}.cpp`, '-auxbase-strip', asm, ...CXX_FLAGS, '-o', asm]));
  await time(log, `as ${name}`, () => tools.run('as', [...AS_FLAGS, '-o', obj, asm]));
}

const time = async (log, label, fn) => { const t0 = performance.now(); const r = await fn(); log.push([label, performance.now() - t0]); return r; };

// Compile blinklib (and its startup code) for a board, into coreDir(boardName)
export async function compileCore(tools, boardName = 'blink', log = []) {
  const b = BOARDS[boardName], dir = coreDir(boardName);
  for (const f of CORE_SOURCES) await compile(tools, b, `/core/${f}`, `${dir}/${f.replace(/\.cpp$/, '.o')}`, log);
  // startup.S goes through the C preprocessor, which cc1plus can do on its own
  await time(log, 'cpp startup', () => tools.run('cc1plus', ['-E', '-lang-asm', '-D__ASSEMBLER__', '-imultilib', 'avr5', ...defines(b), '/core/startup.S', '-o', `${dir}/startup.s`]));
  await time(log, 'as startup', () => tools.run('as', [...AS_FLAGS, '-o', `${dir}/startup.o`, `${dir}/startup.s`]));
  return coreObjects(boardName);
}

// Build a sketch into a game image. `sketch` is C++ as the Arduino IDE hands it
// to the compiler (with `#include <Arduino.h>` and prototypes; see sketch.js).
// With `prebuiltCore`, blinklib's objects must already be in coreDir(boardName).
// Returns { ok, gameHex, gameBytes, elf, log } or { ok: false, stage, stderr, log }.
export async function buildSketch(tools, sketch, boardName = 'blink', { prebuiltCore = false } = {}) {
  const b = BOARDS[boardName];
  const log = [];
  await tools.write('/build/sketch.cpp', sketch);
  const core = prebuiltCore ? coreObjects(boardName) : await compileCore(tools, boardName, log);
  let stage = 'compile';
  try {
    await compile(tools, b, '/build/sketch.cpp', '/build/sketch.o', log);
    stage = 'link';
    await time(log, 'ld', () => tools.run('ld', [
      '-m', 'avr5', '-T', `/ldscripts/${b.linkscript}`, '--gc-sections', '--relax', '-o', '/build/game.elf',
      ...core, '/build/sketch.o', '-L', '/libs/avr5', '--start-group', '-lgcc', '-lm', '-lc', `-l${b.mcu}`, '--end-group',
    ]));
  } catch (e) {
    if (e.stderr === undefined) throw e;
    return { ok: false, stage, stderr: e.stderr, log };
  }
  await time(log, 'objcopy', () => tools.run('objcopy', ['--change-addresses', `0x${b.builtin.toString(16)}`, '-O', 'ihex', '-R', '.eeprom', '/build/game.elf', '/build/game.hex']));

  const gameHex = new TextDecoder().decode(await tools.read('/build/game.hex'));
  const gameBytes = gameHex.split('\n').filter((l) => l.slice(7, 9) === '00').reduce((n, l) => n + parseInt(l.slice(1, 3), 16), 0);
  return { ok: true, gameHex, gameBytes, elf: await tools.read('/build/game.elf'), log };
}

// The image a Blink is flashed with: the game in the built-in area plus the BIOS
export function withBios(gameHex, biosHex, boardName = 'blink') {
  const size = BOARDS[boardName].flashBytes;
  const game = parseHex(gameHex, size), bios = parseHex(biosHex, size);
  for (let i = 0; i < size; i++) if (bios[i] !== 0xff) game[i] = bios[i];
  return game;
}
