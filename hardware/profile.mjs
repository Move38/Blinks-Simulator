// Where does a hardware Blink spend its cycles?
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { AvrBlink } from './blink-avr.js';
const dir = 'fixtures/Neighbors/build/move38.avr.blink/';
const b = new AvrBlink({ chip: 'atmega168pb', hex: readFileSync(dir + 'Neighbors.ino.with_bootloader.hex', 'utf8') });
b.runUntil(500e6);
const hist = new Map();
const cpu = b.cpu;
let last = cpu.cycles;
const orig = b.runUntil.bind(b);
for (let i = 0; i < 200000; i++) {          // sample the pc every ~50 us
  orig(b.ns + 50000);
  const pc = cpu.pc * 2;
  hist.set(pc, (hist.get(pc) ?? 0) + 1);
}
const AVR = process.env.HOME + '/Library/Arduino15/packages/arduino/tools/avr-gcc/7.3.0-atmel3.6.1-arduino7/bin/';
const syms = execFileSync(AVR + 'avr-nm', ['-n', '-C', dir + 'Neighbors.ino.elf'], { encoding: 'utf8' })
  .split('\n').map((l) => l.split(' ')).filter((p) => p[1] === 't' || p[1] === 'T').map(([a, , ...n]) => [parseInt(a, 16), n.join(' ')]);
const name = (pc) => { if (pc >= 0x2e00) return 'BIOS'; let s = '?'; for (const [a, n] of syms) { if (a <= pc) s = n; else break; } return s; };
const by = new Map();
for (const [pc, c] of hist) by.set(name(pc), (by.get(name(pc)) ?? 0) + c);
const total = [...hist.values()].reduce((a, c) => a + c, 0);
[...by].sort((x, y) => y[1] - x[1]).slice(0, 12).forEach(([n, c]) => console.log((100 * c / total).toFixed(1).padStart(5) + '%', n));
const top = [...hist].sort((x, y) => y[1] - x[1]).slice(0, 8);
top.forEach(([pc, c]) => console.log('  pc', pc.toString(16), (100 * c / total).toFixed(1) + '%', name(pc)));
