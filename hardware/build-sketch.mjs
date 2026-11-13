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
//   /ldscripts/            the SDK's link scripts
//   /build/                sources in, objects and images out

import { parseHex } from './blink-avr.js';

export const BOARDS = {
  blink:       { mcu: 'atmega168pb', board: 'AVR_BLINK_168', linkscript: 'avr5-atmega168pb.xn', builtin: 0x1700, flashBytes: 0x4000, bios: 'BlinkBIOS-168PB.hex' },
  blink328:    { mcu: 'atmega328pb', board: 'AVR_BLINK_328', linkscript: 'avr5-atmega328.xn', builtin: 0x3900, flashBytes: 0x8000, bios: 'BlinkBIOS-328PB.hex' },
  blink328max: { mcu: 'atmega328pb', board: 'AVR_BLINK_328', linkscript: 'avr5-atmega328.xn', builtin: 0x3900, flashBytes: 0x8000, bios: 'BlinkBIOS-328PB-MAX.hex' },
  blink328nfc: { mcu: 'atmega328pb', board: 'AVR_BLINK_328', linkscript: 'avr5-atmega328.xn', builtin: 0x3900, flashBytes: 0x8000, bios: 'BlinkBIOS-328PB-MAX-NFC.hex' },
};

export const CORE_SOURCES = ['blinklib.cpp', 'Timer.cpp', 'Serial.cpp', 'Print.cpp', 'main.cpp', 'sp.cpp', 'gamestat.cpp'];

const defines = (b) => [
  `-D__AVR_${b.mcu.replace('atmega', 'ATmega').replace(/pb$/, 'PB')}__`,
  `-D__AVR_DEVICE_NAME__=${b.mcu}`,
  '-DF_CPU=8000000L', '-DARDUINO=10819', `-DARDUINO_${b.board}`, '-DARDUINO_ARCH_AVR',
  '-isystem', '/sysroot/gcc/include', '-isystem', '/sysroot/gcc/include-fixed', '-isystem', '/sysroot/avr/include', '-I', '/core',
];

// `tools.run(tool, args)` runs one tool; `tools.read(path)` and `tools.write(path, data)` touch the virtual FS.
// `sketch` is C++ as the Arduino IDE hands it to the compiler (with `#include <Arduino.h>` and prototypes).
export async function buildSketch(tools, sketch, boardName = 'blink') {
  const b = BOARDS[boardName];
  const log = [];
  const time = async (label, fn) => { const t0 = performance.now(); const r = await fn(); log.push([label, performance.now() - t0]); return r; };
  await tools.write('/build/sketch.cpp', sketch);

  const cpp = [...CORE_SOURCES.map((f) => `/core/${f}`), '/build/sketch.cpp'];
  const objects = [];
  for (const src of cpp) {
    const name = src.split('/').pop().replace(/\.cpp$/, '');
    await time(`cc1plus ${name}`, () => tools.run('cc1plus', [
      '-quiet', '-imultilib', 'avr5', ...defines(b), src,
      '-mn-flash=1', '-mno-skip-bug', '-mmcu=avr5', '-dumpbase', `${name}.cpp`, '-auxbase-strip', `/build/${name}.s`,
      // -fno-rtti: without LTO to drop them, classes with virtual methods (like
      // Serial) would need type info from a C++ runtime that isn't linked
      '-Os', '-std=gnu++11', '-fpermissive', '-fno-exceptions', '-fno-rtti', '-ffunction-sections', '-fdata-sections',
      '-fno-threadsafe-statics', '-Wno-error=narrowing', '-w', '-o', `/build/${name}.s`,
    ]));
    await time(`as ${name}`, () => tools.run('as', ['-mmcu=avr5', '-mno-skip-bug', '-mlink-relax', '-o', `/build/${name}.o`, `/build/${name}.s`]));
    objects.push(`/build/${name}.o`);
  }

  // startup.S goes through the C preprocessor, which cc1plus can do on its own
  await time('cpp startup', () => tools.run('cc1plus', ['-E', '-lang-asm', '-D__ASSEMBLER__', '-imultilib', 'avr5', ...defines(b), '/core/startup.S', '-o', '/build/startup.s']));
  await time('as startup', () => tools.run('as', ['-mmcu=avr5', '-mno-skip-bug', '-mlink-relax', '-o', '/build/startup.o', '/build/startup.s']));
  objects.unshift('/build/startup.o');

  await time('ld', () => tools.run('ld', [
    '-m', 'avr5', '-T', `/ldscripts/${b.linkscript}`, '--gc-sections', '--relax', '-o', '/build/game.elf',
    ...objects, '-L', '/libs/avr5', '--start-group', '-lgcc', '-lm', '-lc', `-l${b.mcu}`, '--end-group',
  ]));
  await time('objcopy', () => tools.run('objcopy', ['--change-addresses', `0x${b.builtin.toString(16)}`, '-O', 'ihex', '-R', '.eeprom', '/build/game.elf', '/build/game.hex']));

  const gameHex = new TextDecoder().decode(await tools.read('/build/game.hex'));
  const gameBytes = gameHex.split('\n').filter((l) => l.slice(7, 9) === '00').reduce((n, l) => n + parseInt(l.slice(1, 3), 16), 0);
  return { gameHex, gameBytes, log };
}

// The image a Blink is flashed with: the game in the built-in area plus the BIOS
export function withBios(gameHex, biosHex, boardName = 'blink') {
  const size = BOARDS[boardName].flashBytes;
  const game = parseHex(gameHex, size), bios = parseHex(biosHex, size);
  for (let i = 0; i < size; i++) if (bios[i] !== 0xff) game[i] = bios[i];
  return game;
}
