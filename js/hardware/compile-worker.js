// A Worker that compiles sketches with avr-gcc built for WebAssembly, so the
// page stays responsive. See toolchain.js for the other side.
//
//   → { type: 'load', base }             fetch the toolchain from `base` (js/hardware/toolchain/)
//   ← { type: 'progress', loaded, total } while it downloads
//   ← { type: 'loaded' } or { type: 'failed', message }
//   → { type: 'build', id, code, board }
//   ← { type: 'built', id, ok, ... }      see build() below

import { createTools, decodePack } from './tools.js';
import { buildSketch, withBios, BOARDS } from './build.js';
import { inoToCpp, parseDiagnostics } from './sketch.js';
import { readElf, blinklibSymbols, memoryUse } from './elf.js';

const TOOLS = { cc1plus: 'cc1plus', as: 'avr-as', ld: 'avr-ld', objcopy: 'avr-objcopy' };
let tools = null;

// A file from the toolchain: from this browser's cache if it has this version, or else downloaded and kept
async function fetchFile(base, cache, name, onBytes) {
  const url = new URL(name, base).href;
  const hit = cache && await cache.match(url);
  if (hit) { const data = new Uint8Array(await hit.arrayBuffer()); onBytes(data.length); return data; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't download ${name} (${res.status})`);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length; onBytes(value.length);
  }
  const data = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { data.set(c, at); at += c.length; }
  try { await cache?.put(url, new Response(data)); } catch { /* storage full or blocked: fine */ }
  return data;
}

// .gz files are gunzipped here, unless the server already did it (Content-Encoding: gzip)
async function gunzip(data) {
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data;
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

async function load(base) {
  const manifest = await (await fetch(new URL('manifest.json', base), { cache: 'no-cache' })).json();
  let cache = null;
  try {
    cache = await caches.open(`blinks-toolchain-${manifest.version}`);
    // drop other versions
    for (const name of await caches.keys()) if (name.startsWith('blinks-toolchain-') && name !== `blinks-toolchain-${manifest.version}`) caches.delete(name);
  } catch { /* no Cache Storage (e.g. not a secure context): just download */ }
  const total = Object.values(manifest.files).reduce((a, b) => a + b, 0);
  let loaded = 0, lastPost = 0;
  const onBytes = (n) => {
    loaded += n;
    const now = performance.now();
    if (now - lastPost > 80) { lastPost = now; postMessage({ type: 'progress', loaded, total }); }
  };
  const get = (name) => fetchFile(base, cache, name, onBytes);
  const [pack, ...mods] = await Promise.all([get('blinks.pack.gz'), ...Object.values(TOOLS).map(async (name) => {
    const [js, wasm] = await Promise.all([get(`${name}.mjs`), get(`${name}.wasm.gz`)]);
    const url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
    try {
      return { create: (await import(url)).default, wasm: await WebAssembly.compile(await gunzip(wasm)) };
    } finally { URL.revokeObjectURL(url); }
  })]);
  postMessage({ type: 'progress', loaded: total, total });
  tools = createTools(Object.fromEntries(Object.keys(TOOLS).map((k, i) => [k, mods[i]])), decodePack(await gunzip(pack)));
}

// Compile a sketch. On success: the flash image (game + BIOS), what it uses of
// flash and RAM, and where blinklib's variables are. On failure: gcc's messages.
async function build({ id, code, board }) {
  const t0 = performance.now();
  for (const path of [...tools.files.keys()]) if (path.startsWith('/build/')) tools.files.delete(path);
  const r = await buildSketch(tools, inoToCpp(code), board, { prebuiltCore: true });
  const ms = performance.now() - t0;
  if (!r.ok) return { type: 'built', id, ok: false, diagnostics: parseDiagnostics(r.stderr), stderr: r.stderr, ms };
  const elf = readElf(r.elf);
  const bios = new TextDecoder().decode(tools.read(`/bios/${BOARDS[board].bios}`));
  const flash = withBios(r.gameHex, bios, board);
  const use = memoryUse(elf);
  return {
    type: 'built', id, ok: true, ms, flash, chip: BOARDS[board].mcu,
    symbols: blinklibSymbols(elf),
    flashUsed: use.flash, flashBudget: BOARDS[board].maxGame, ramUsed: use.ram, ramBudget: BOARDS[board].ram,
  };
}

onmessage = async ({ data }) => {
  if (data.type === 'load') {
    try { await load(data.base); postMessage({ type: 'loaded' }); }
    catch (e) { postMessage({ type: 'failed', message: e.message || String(e) }); }
  } else if (data.type === 'build') {
    try {
      const r = await build(data);
      postMessage(r, r.flash ? [r.flash.buffer] : []);
    } catch (e) {
      postMessage({ type: 'built', id: data.id, ok: false, diagnostics: [{ line: 0, message: `The compiler failed: ${e.message || e}`, severity: 'err' }] });
    }
  }
};
