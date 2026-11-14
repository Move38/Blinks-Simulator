// The build steps' virtual file system on disk, run with the Arduino IDE's
// avr-gcc 7.3.0 (the same compiler the IDE builds Blinks games with).
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';

const ARDUINO = join(homedir(), 'Library/Arduino15/packages');
export const GCC = join(ARDUINO, 'arduino/tools/avr-gcc/7.3.0-atmel3.6.1-arduino7');
export const SDK = join(ARDUINO, 'move38/hardware/avr/1.3.0');
// Bruno Albuquerque's Custom Blinklib (github.com/brunoga/blinklib)
export const BGA_SDK = join(ARDUINO, 'blinklib/hardware/avr/1.4.3');

export function nativeTools() {
  const root = mkdtempSync(join(tmpdir(), 'blinks-build-'));
  const link = (target, path) => { mkdirSync(dirname(join(root, path)), { recursive: true }); symlinkSync(target, join(root, path)); };
  link(join(GCC, 'lib/gcc/avr/7.3.0/include'), 'sysroot/gcc/include');
  link(join(GCC, 'lib/gcc/avr/7.3.0/include-fixed'), 'sysroot/gcc/include-fixed');
  link(join(GCC, 'avr/include'), 'sysroot/avr/include');
  link(join(SDK, 'cores/blinklib'), 'core');
  link(join(BGA_SDK, 'cores/blinklib'), 'core-bga');
  for (const name of readdirSync(join(SDK, 'linkscripts'))) link(join(SDK, 'linkscripts', name), `ldscripts/${name}`);
  link(join(BGA_SDK, 'linkscripts/avr5.xn'), 'ldscripts/bga-avr5.xn');
  link(join(GCC, 'lib/gcc/avr/7.3.0/avr5/libgcc.a'), 'libs/avr5/libgcc.a');
  for (const lib of ['libc.a', 'libm.a', 'libatmega168pb.a', 'libatmega328pb.a']) link(join(GCC, 'avr/lib/avr5', lib), `libs/avr5/${lib}`);
  mkdirSync(join(root, 'build'));
  const bin = {
    cc1plus: join(GCC, 'libexec/gcc/avr/7.3.0/cc1plus'),
    as: join(GCC, 'avr/bin/as'), ld: join(GCC, 'avr/bin/ld'), objcopy: join(GCC, 'avr/bin/objcopy'),
  };
  const real = (a) => (a.startsWith('/') ? join(root, a) : a);
  return {
    root,
    run: (tool, args) => {
      const output = tool === 'objcopy' ? args.at(-1) : args[args.indexOf('-o') + 1];
      mkdirSync(dirname(real(output)), { recursive: true });
      try {
        execFileSync(bin[tool], args.map(real), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        const stderr = String(e.stderr).replaceAll(root, '');
        throw Object.assign(new Error(`${tool} failed:\n${stderr}`), { stderr });
      }
    },
    write: (path, data) => { mkdirSync(dirname(real(path)), { recursive: true }); writeFileSync(real(path), data); },
    read: (path) => readFileSync(real(path)),
  };
}
