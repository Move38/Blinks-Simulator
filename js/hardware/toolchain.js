// The page's side of the compile worker: load the toolchain once, then build sketches.
//
//   const tc = new Toolchain();
//   await tc.load(fraction => …);         // downloads about 6 MB the first time, then comes from the cache
//   const r = await tc.build(code);       // { ok, flash, chip, symbols, flashUsed, … } or { ok: false, diagnostics }
//   tc.build({ files, main }, 'blink328', 'bga')   // a sketch folder, for a board, on a blinklib (build.js)

const BASE = new URL('./toolchain/', import.meta.url).href;

export class Toolchain {
  constructor() {
    this.worker = null;
    this.loading = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  load(onProgress) {
    if (this.loading) return this.loading;
    this.worker = new Worker(new URL('./compile-worker.js', import.meta.url), { type: 'module' });
    this.loading = new Promise((resolve, reject) => {
      this.worker.onmessage = ({ data }) => {
        if (data.type === 'progress') onProgress?.(Math.min(1, data.loaded / data.total));
        else if (data.type === 'loaded') resolve();
        else if (data.type === 'failed') { this.loading = null; this.worker.terminate(); reject(new Error(data.message)); }
        else if (data.type === 'built') { this.pending.get(data.id)?.(data); this.pending.delete(data.id); }
      };
      this.worker.onerror = (e) => { this.loading = null; reject(new Error(e.message || 'the compiler worker failed to start')); };
    });
    this.worker.postMessage({ type: 'load', base: BASE });
    return this.loading;
  }

  // Builds run one after another, in order
  async build(code, board = 'blink', lib = 'move38') {
    await this.load();
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ type: 'build', id, code, board, lib });
    });
  }
}
