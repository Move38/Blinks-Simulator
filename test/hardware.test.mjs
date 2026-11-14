// Hardware-exact mode (js/hardware): the toolchain the browser downloads, run
// here in Node, building sketches that then run on emulated Blinks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createTools, decodePack } from '../js/hardware/tools.js';
import { buildSketch, withBios, BOARDS } from '../js/hardware/build.js';
import { inoToCpp, parseDiagnostics } from '../js/hardware/sketch.js';
import { readElf, blinklibSymbols, memoryUse } from '../js/hardware/elf.js';
import { HardwareWorld } from '../js/hardware/world.js';

const dir = new URL('../js/hardware/toolchain/', import.meta.url);
const NAMES = { cc1plus: 'cc1plus', as: 'avr-as', ld: 'avr-ld', objcopy: 'avr-objcopy' };
let toolsPromise;
// The toolchain exactly as compile-worker.js loads it
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

async function build(code, board = 'blink') {
  const t = await tools();
  const r = await buildSketch(t, inoToCpp(code), board, { prebuiltCore: true });
  if (!r.ok) return { ...r, diagnostics: parseDiagnostics(r.stderr) };
  const elf = readElf(r.elf);
  const bios = new TextDecoder().decode(t.read(`/bios/${BOARDS[board].bios}`));
  return { ...r, program: { chip: BOARDS[board].mcu, flash: withBios(r.gameHex, bios, board), symbols: blinklibSymbols(elf) }, use: memoryUse(elf) };
}

const NEIGHBORS = `void setup() {}
void loop() {
  setValueSentOnAllFaces(42);
  setColor(OFF);
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) setColorOnFace(getLastValueReceivedOnFace(f) == 42 ? GREEN : BLUE, f);
  }
}
`;
const green = (c) => ((c >> 6) & 31) === 31 && !((c >> 1) & 31) && !((c >> 11) & 31);

test('sketch prototypes let a function be called before it is defined', () => {
  const cpp = inoToCpp('#define N 3\nint total = 0;\n\nvoid setup() { total = twice(N); }\n// later\nint twice(int x) {\n  return x * 2;\n}\nvoid loop() {}\n');
  const lines = cpp.split('\n');
  assert.equal(lines[0], '#include <Arduino.h>');
  const first = lines.findIndex((l) => l.startsWith('void setup() {'));
  assert.ok(lines.slice(0, first).includes('int twice(int x);'), cpp);
  assert.ok(lines.slice(0, first).includes('#line 4 "sketch.ino"'), 'line numbers stay the sketch\'s');
});

test('avr-gcc errors come back on the sketch\'s own lines', async () => {
  const r = await build('void setup() {\n}\n\nvoid loop() {\n  setColor(REDD);\n}\n');
  assert.equal(r.ok, false);
  assert.deepEqual(r.diagnostics, [{ line: 5, message: "'REDD' was not declared in this scope", severity: 'err' }]);
});

test('a game too big for a Blink is an error', async () => {
  const r = await build('#include <avr/pgmspace.h>\nconst byte big[7000] PROGMEM = {1};\nvoid setup() {}\nvoid loop() { setColor(makeColorRGB(pgm_read_byte(&big[millis() % 7000]), 0, 0)); }\n');
  assert.equal(r.ok, false);
  assert.match(r.diagnostics[0].message, /too big to fit on a Blink/);
});

test('flash and RAM are counted like the Arduino IDE, and blinklib\'s variables are found', async () => {
  const r = await build(NEIGHBORS);
  assert.ok(r.ok);
  assert.ok(r.use.flash > 1500 && r.use.flash < 2500, `flash ${r.use.flash}`);
  assert.ok(r.use.ram > 600 && r.use.ram < 800, `RAM ${r.use.ram}`);
  assert.ok(r.program.symbols.faces > 0x100 && r.program.symbols.now > 0x100, JSON.stringify(r.program.symbols));
});

test('a flower of hardware Blinks hears its neighbors, and loses one that moves away', async () => {
  const r = await build(NEIGHBORS);
  const w = new HardwareWorld();
  w.drift = 0.02;
  for (const [q, rr] of [[0, 0], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]]) w.addBlink(q, rr, 0);
  w.load(r.program);
  for (let i = 0; i < 80; i++) w.advance(16);
  const [middle, ...petals] = w.blinks;
  assert.ok([...middle.display].every(green), 'the middle Blink hears all six');
  for (const p of petals) assert.equal([...p.display].filter(green).length, 3, `#${p.id} hears three`);
  for (const p of petals) assert.ok(p.faces.some((f) => f.inValue === 42 && f.expireTime > p.now), 'faces read from RAM');

  w.lift(middle);
  w.place(middle, 5, 5);
  for (let i = 0; i < 30; i++) w.advance(16);
  assert.ok([...middle.display].every((c) => c === 0), 'alone, the middle Blink hears nobody');
  for (const p of petals) assert.equal([...p.display].filter(green).length, 2, `#${p.id} lost the middle`);
});
