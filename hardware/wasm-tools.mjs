// avr-gcc 7.3.0 and binutils built for WebAssembly, in Node.
//
// wasmToolsFromSources(): the tools from @horang-corp/avr-gcc-wasm, with the
//   files a Blinks build needs gathered from that package, the Arduino IDE's
//   avr-gcc (limits.h and the device libraries, which the package lacks), the
//   Move38 SDK and Custom Blinklib. make-toolchain.mjs uses it to build the
//   browser toolchain.
// wasmToolsFromPack(): the toolchain exactly as the browser loads it, from
//   js/hardware/toolchain.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { GCC, SDK, BGA_SDK } from './native-tools.mjs';
import { createTools, decodePack } from '../js/hardware/tools.js';

export const PKG = new URL('node_modules/@horang-corp/avr-gcc-wasm/', import.meta.url).pathname;
export const TOOLCHAIN = new URL('../js/hardware/toolchain/', import.meta.url).pathname;
export const TOOL_FILES = { cc1plus: 'cc1plus', as: 'avr-as', ld: 'avr-ld', objcopy: 'avr-objcopy' };

export function readTree(dir, into, prefix, keep = () => true) {
  for (const name of readdirSync(dir)) {
    const real = join(dir, name);
    if (statSync(real).isDirectory()) readTree(real, into, `${prefix}/${name}`, keep);
    else if (keep(`${prefix}/${name}`)) into.set(`${prefix}/${name}`, readFileSync(real));
  }
  return into;
}

// avr-libc has a header for every AVR; keep only the two Blinks use
const DEVICE_HEADER = /\/avr\/io(?!\.h$)[a-z0-9_]+\.h$/;
export const keepHeader = (path) => !DEVICE_HEADER.test(path) || /\/avr\/iom(168|328)pb\.h$/.test(path);

export async function wasmToolsFromSources() {
  const files = new Map();
  readTree(join(PKG, 'assets/fs/sysroot/gcc/include'), files, '/sysroot/gcc/include');
  readTree(join(GCC, 'lib/gcc/avr/7.3.0/include-fixed'), files, '/sysroot/gcc/include-fixed', (p) => p.endsWith('.h'));
  readTree(join(PKG, 'assets/fs/sysroot/avr/include'), files, '/sysroot/avr/include', keepHeader);
  readTree(join(SDK, 'cores/blinklib'), files, '/core');
  readTree(join(SDK, 'linkscripts'), files, '/ldscripts', (p) => p.endsWith('.xn'));
  for (const lib of ['libgcc.a', 'libc.a', 'libm.a']) files.set(`/libs/avr5/${lib}`, readFileSync(join(PKG, 'assets/libs', lib)));
  for (const lib of ['libatmega168pb.a', 'libatmega328pb.a']) files.set(`/libs/avr5/${lib}`, readFileSync(join(GCC, 'avr/lib/avr5', lib)));
  readTree(join(SDK, 'bootloaders'), files, '/bios', (p) => p.endsWith('.hex'));
  readTree(join(BGA_SDK, 'cores/blinklib'), files, '/core-bga', (p) => !p.endsWith('.hex'));
  files.set('/ldscripts/bga-avr5.xn', readFileSync(join(BGA_SDK, 'linkscripts/avr5.xn')));
  files.set('/bios/BlinkBIOS-CustomBlinklib.hex', readFileSync(join(BGA_SDK, 'bootloaders/BlinkBIOS.hex')));

  const modules = {};
  for (const [tool, name] of Object.entries(TOOL_FILES)) {
    modules[tool] = {
      create: (await import(join(PKG, 'tools', `${name}.mjs`))).default,
      wasm: await WebAssembly.compile(readFileSync(join(PKG, 'tools', `${name}.wasm`))),
    };
  }
  return createTools(modules, files);
}

export async function wasmToolsFromPack(dir = TOOLCHAIN) {
  const files = decodePack(gunzipSync(readFileSync(join(dir, 'blinks.pack.gz'))));
  const modules = {};
  for (const [tool, name] of Object.entries(TOOL_FILES)) {
    modules[tool] = {
      create: (await import(join(dir, `${name}.mjs`))).default,
      wasm: await WebAssembly.compile(gunzipSync(readFileSync(join(dir, `${name}.wasm.gz`)))),
    };
  }
  return createTools(modules, files);
}
