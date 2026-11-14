// Build js/hardware/toolchain: what the browser downloads when hardware-exact
// mode is turned on.
//   - avr-gcc 7.3.0's cc1plus and binutils 2.42's as, ld and objcopy, built for
//     WebAssembly (from @horang-corp/avr-gcc-wasm), gzipped
//   - blinks.pack.gz: the headers, libraries, link scripts and BlinkBIOS images
//     a build needs, plus blinklib already compiled for each chip
//
//   cd hardware && npm install && node make-toolchain.mjs
// Needs the Arduino IDE's avr-gcc 7.3.0, the Move38 SDK 1.3.0 and Custom Blinklib 1.4.3 installed (see native-tools.mjs).
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { wasmToolsFromSources, PKG, TOOLCHAIN, TOOL_FILES } from './wasm-tools.mjs';
import { compileCore } from '../js/hardware/build.js';
import { encodePack } from '../js/hardware/tools.js';
import { SDK, BGA_SDK } from './native-tools.mjs';

rmSync(TOOLCHAIN, { recursive: true, force: true });
mkdirSync(TOOLCHAIN, { recursive: true });
const gz = (data) => gzipSync(data, { level: 9 });
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

const tools = await wasmToolsFromSources();
for (const board of ['blink', 'blink328']) await compileCore(tools, board);
await compileCore(tools, 'blink', { lib: 'bga' });   // without a game's config; one with a config builds its own
// The libraries are mostly debug info, which linking doesn't need (libgcc.a: 5.8 MB -> 1 MB)
for (const path of [...tools.files.keys()].filter((p) => p.endsWith('.a'))) {
  await tools.run('objcopy', ['--strip-debug', path, path]);
}

// Ship headers (the sketch includes them), compiled blinklib, libraries, link scripts and BIOS images,
// and blinklib's sources: a game too big to fit is built in one with them (build.js), and a
// Custom Blinklib game's config/blinklib_config.h rebuilds its blinklib
const keep = (path) => !path.startsWith('/build/') && !path.endsWith('.s');
const files = new Map([...tools.files].filter(([path]) => keep(path)));
const pack = encodePack(files);
writeFileSync(join(TOOLCHAIN, 'blinks.pack.gz'), gz(pack));
console.log(`blinks.pack.gz: ${files.size} files, ${kb(pack.length)} -> ${kb(gz(pack).length)}`);

let total = gz(pack).length;
for (const name of Object.values(TOOL_FILES)) {
  copyFileSync(join(PKG, 'tools', `${name}.mjs`), join(TOOLCHAIN, `${name}.mjs`));
  const wasm = readFileSync(join(PKG, 'tools', `${name}.wasm`));
  const packed = gz(wasm);
  writeFileSync(join(TOOLCHAIN, `${name}.wasm.gz`), packed);
  total += packed.length + readFileSync(join(PKG, 'tools', `${name}.mjs`)).length;
  console.log(`${name}.wasm: ${kb(wasm.length)} -> ${kb(packed.length)}`);
}
// What the browser fetches, with sizes for its progress bar and a hash to name its cache by
const fetched = ['blinks.pack.gz', ...Object.values(TOOL_FILES).flatMap((n) => [`${n}.mjs`, `${n}.wasm.gz`])];
const hash = createHash('sha256');
const sizes = {};
for (const f of fetched) { const data = readFileSync(join(TOOLCHAIN, f)); sizes[f] = data.length; hash.update(data); }
writeFileSync(join(TOOLCHAIN, 'manifest.json'), JSON.stringify({ version: hash.digest('hex').slice(0, 12), files: sizes }, null, 2) + '\n');
copyFileSync(join(SDK, 'LICENSE'), join(TOOLCHAIN, 'LICENSE-Move38-SDK.txt'));
copyFileSync(join(BGA_SDK, 'LICENSE'), join(TOOLCHAIN, 'LICENSE-Custom-Blinklib.txt'));
const { version } = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
writeFileSync(join(TOOLCHAIN, 'NOTICE.md'), `# Hardware-exact toolchain

Downloaded only when the playground's hardware-exact mode is turned on. Rebuild it with \`hardware/make-toolchain.mjs\`.

- \`cc1plus\` (GCC 7.3.0) and \`avr-as\`, \`avr-ld\`, \`avr-objcopy\` (GNU binutils 2.42), built for WebAssembly by
  [@horang-corp/avr-gcc-wasm](https://github.com/horang-corp/avr-gcc-wasm) ${version}. GNU GPL v3 or later. Source:
  [GCC](https://gcc.gnu.org/), [binutils](https://www.gnu.org/software/binutils/), and the build scripts in that repository.
- \`blinks.pack.gz\` holds:
  - GCC's headers and \`libgcc.a\` (GPL v3 with the GCC Runtime Library Exception)
  - avr-libc's headers and libraries (BSD-style license)
  - blinklib, its link scripts and the BlinkBIOS images from the Move38 SDK 1.3.0
    ([bigjosh/Move38-Arduino-Platform](https://github.com/bigjosh/Move38-Arduino-Platform); see LICENSE-Move38-SDK.txt), with
    blinklib compiled for the ATmega168PB and ATmega328PB
  - Custom Blinklib 1.4.3's blinklib, link script and BlinkBIOS image
    ([brunoga/blinklib](https://github.com/brunoga/blinklib); see LICENSE-Custom-Blinklib.txt), with blinklib
    compiled for the ATmega168PB
`);
console.log(`total download: ${kb(total)}`);
