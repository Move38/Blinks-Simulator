// avr-gcc and binutils built for WebAssembly, run on an in-memory file system.
// Each tool is an Emscripten program that can only run main() once, so every
// run gets a fresh instance of an already compiled WebAssembly.Module. The
// files a tool needs are copied into its file system before it runs, and the
// file it writes (the one after -o, or objcopy's last argument) is copied out.
//
// Used by the compile worker in the browser and by the Node tests alike.

// Which parts of the virtual file system each tool needs
const SKIP = {
  cc1plus: ['/libs/', '/obj/', '/bios/'],
  other: ['/sysroot/', '/core/', '/bios/'],
};

// `modules`: { cc1plus, as, ld, objcopy }, each { create, wasm } where `create`
// is the Emscripten factory and `wasm` the compiled WebAssembly.Module.
// `files`: a Map of path -> Uint8Array, shared by every run.
export function createTools(modules, files = new Map()) {
  const mkdirs = (FS, path) => {
    let dir = '';
    for (const part of path.split('/').slice(1, -1)) {
      dir += `/${part}`;
      try { FS.mkdir(dir); } catch { /* already there */ }
    }
  };
  return {
    files,
    write: (path, data) => files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data),
    read: (path) => files.get(path),
    async run(tool, args) {
      const { create, wasm } = modules[tool];
      const out = [];
      const mod = await create({
        noInitialRun: true,
        locateFile: (path) => path,   // never fetched: instantiateWasm below supplies the module
        print: (l) => out.push(l),
        printErr: (l) => out.push(l),
        instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasm, imports).then((inst) => done(inst, wasm)); return {}; },
      });
      const { FS } = mod;
      const skip = SKIP[tool] ?? SKIP.other;
      for (const [path, data] of files) {
        if (skip.some((p) => path.startsWith(p))) continue;
        mkdirs(FS, path);
        FS.writeFile(path, data);
      }
      const output = tool === 'objcopy' ? args.at(-1) : args[args.indexOf('-o') + 1];
      mkdirs(FS, output);
      // A tool that returns from main() gives its status back; one that calls exit() throws it
      let status;
      try { status = mod.callMain(args) ?? 0; } catch (e) { status = e?.status ?? 1; }
      const stderr = out.join('\n');
      let data = null;
      try { data = FS.readFile(output); } catch { /* not written */ }
      if (status || !data) throw Object.assign(new Error(`${tool} failed (${status}):\n${stderr}`), { stderr });
      files.set(output, data);
    },
  };
}

// The toolchain's support files travel as one "pack": a header naming each
// file and its size, then all their bytes.
const MAGIC = 'BLINKPACK1';

export function encodePack(files) {
  const index = [...files].map(([path, data]) => [path, data.length]);
  const head = new TextEncoder().encode(JSON.stringify(index));
  const total = MAGIC.length + 4 + head.length + index.reduce((n, [, len]) => n + len, 0);
  const out = new Uint8Array(total);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(MAGIC.length, head.length, true);
  out.set(head, MAGIC.length + 4);
  let at = MAGIC.length + 4 + head.length;
  for (const [, data] of files) { out.set(data, at); at += data.length; }
  return out;
}

export function decodePack(bytes) {
  if (new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) throw new Error('not a Blinks toolchain pack');
  const headLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(MAGIC.length, true);
  const index = JSON.parse(new TextDecoder().decode(bytes.subarray(MAGIC.length + 4, MAGIC.length + 4 + headLen)));
  const files = new Map();
  let at = MAGIC.length + 4 + headLen;
  for (const [path, len] of index) { files.set(path, bytes.subarray(at, at + len)); at += len; }
  return files;
}
