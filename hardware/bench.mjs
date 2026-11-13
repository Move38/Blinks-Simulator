// How many hardware Blinks can run at real speed on this machine?
import { readFileSync } from 'node:fs';
import { AvrBlink, AvrTable } from '../js/hardware/blink-avr.js';
const hex = readFileSync('fixtures/Neighbors/build/move38.avr.blink/Neighbors.ino.with_bootloader.hex', 'utf8');
const slice = Number(process.argv[2] ?? 5000);
for (const n of [1, 2, 6, 12, 24]) {
  const t = new AvrTable({ sliceNs: slice });
  for (let i = 0; i < n; i++) t.add(new AvrBlink({ chip: 'atmega168pb', hex, clockScale: 1 + (i % 5 - 2) / 100 }));
  for (let i = 0; i + 1 < n; i++) t.connect(i, 0, i + 1, 3);     // a straight line
  t.run(600e6);                                                 // boot and find neighbors
  t.blinks.forEach((b) => b.takeColors());
  const sim = 1e9;
  const t0 = performance.now();
  t.run(sim);
  const wall = performance.now() - t0;
  const heard = t.blinks.filter((b) => b.takeColors().some(([, g]) => g > 0.5)).length;
  console.log(`${String(n).padStart(2)} Blinks: ${(sim / 1e6 / wall).toFixed(2)}x real time  (${heard}/${n} hear a neighbor)`);
}
