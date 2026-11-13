// The build steps' virtual file system in memory, run with avr-gcc and binutils
// built for WebAssembly (@horang-corp/avr-gcc-wasm). Each tool is compiled
// once and gets a fresh instance per run, since an Emscripten program can't
// run main() twice. Files are copied into each instance's file system before
// it runs and new files under /build are copied back out.
//
// This loads its inputs from disk with Node; a browser would fetch the same files.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GCC, SDK } from './native-tools.mjs';

const PKG = new URL('node_modules/@horang-corp/avr-gcc-wasm/', import.meta.url).pathname;
const TOOLS = { cc1plus: 'cc1plus', as: 'avr-as', ld: 'avr-ld', objcopy: 'avr-objcopy' };

function readTree(dir, into, prefix) {
  for (const name of readdirSync(dir)) {
    const real = join(dir, name);
    if (statSync(real).isDirectory()) readTree(real, into, `${prefix}/${name}`);
    else into.set(`${prefix}/${name}`, readFileSync(real));
  }
}

export async function wasmTools() {
  const headers = new Map();   // only cc1plus needs these
  readTree(join(PKG, 'assets/fs/sysroot/gcc/include'), headers, '/sysroot/gcc/include');
  readTree(join(PKG, 'assets/fs/sysroot/avr/include'), headers, '/sysroot/avr/include');
  // The package has no include-fixed (for limits.h), so borrow the IDE's
  readTree(join(GCC, 'lib/gcc/avr/7.3.0/include-fixed'), headers, '/sysroot/gcc/include-fixed');
  readTree(join(SDK, 'cores/blinklib'), headers, '/core');

  const files = new Map();
  readTree(join(SDK, 'linkscripts'), files, '/ldscripts');
  for (const lib of ['libgcc.a', 'libc.a', 'libm.a']) files.set(`/libs/avr5/${lib}`, readFileSync(join(PKG, 'assets/libs', lib)));
  // Device libraries aren't in the package either
  for (const lib of ['libatmega168pb.a', 'libatmega328pb.a']) files.set(`/libs/avr5/${lib}`, readFileSync(join(GCC, 'avr/lib/avr5', lib)));

  const modules = {};
  const compileTimes = {};
  for (const [tool, name] of Object.entries(TOOLS)) {
    const t0 = performance.now();
    modules[tool] = {
      create: (await import(join(PKG, 'tools', `${name}.mjs`))).default,
      wasm: await WebAssembly.compile(readFileSync(join(PKG, 'tools', `${name}.wasm`))),
    };
    compileTimes[tool] = performance.now() - t0;
  }

  const mkdirs = (FS, path) => {
    let dir = '';
    for (const part of path.split('/').slice(1, -1)) {
      dir += `/${part}`;
      try { FS.mkdir(dir); } catch {}
    }
  };

  return {
    compileTimes,
    write: (path, data) => files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data),
    read: (path) => files.get(path),
    async run(tool, args) {
      const { create, wasm } = modules[tool];
      const stderr = [];
      const mod = await create({
        noInitialRun: true,
        print: (l) => stderr.push(l),
        printErr: (l) => stderr.push(l),
        instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasm, imports).then((i) => done(i, wasm)); return {}; },
      });
      const { FS } = mod;
      const inputs = tool === 'cc1plus' ? [...headers, ...files] : files;
      for (const [path, data] of inputs) { mkdirs(FS, path); FS.writeFile(path, data); }
      try { FS.mkdir('/build'); } catch {}
      let status = 0;
      try { mod.callMain(args); } catch (e) { status = e?.status ?? 1; if (status === 0 && !/exit\(0\)/.test(String(e?.message ?? ''))) status = e?.status ?? 1; }
      if (status) throw new Error(`${tool} failed (${status}):\n${stderr.join('\n')}`);
      for (const name of FS.readdir('/build')) {
        if (name === '.' || name === '..') continue;
        files.set(`/build/${name}`, FS.readFile(`/build/${name}`));
      }
    },
  };
}
