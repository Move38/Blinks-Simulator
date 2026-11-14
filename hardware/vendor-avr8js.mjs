// Copy avr8js's ES modules into js/hardware/vendor/avr8js, adding the .js
// extensions its imports leave out, so a browser can load them as they are.
//   cd hardware && npm install && node vendor-avr8js.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

const from = new URL('node_modules/avr8js/dist/esm/', import.meta.url).pathname;
const to = new URL('../js/hardware/vendor/avr8js/', import.meta.url).pathname;
rmSync(to, { recursive: true, force: true });
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
for (const file of walk(from).filter((f) => f.endsWith('.js'))) {
  const out = join(to, file.slice(from.length));
  mkdirSync(dirname(out), { recursive: true });
  const src = readFileSync(file, 'utf8').replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g, (m, a, path, b) => (path.endsWith('.js') ? m : `${a}${path}.js${b}`));
  writeFileSync(out, src);
}
copyFileSync(new URL('node_modules/avr8js/LICENSE', import.meta.url).pathname, join(to, 'LICENSE'));
const { version } = JSON.parse(readFileSync(new URL('node_modules/avr8js/package.json', import.meta.url), 'utf8'));
writeFileSync(join(to, 'VERSION'), `avr8js ${version} (https://github.com/wokwi/avr8js), dist/esm with .js added to its imports\n`);
console.log(`avr8js ${version} -> ${to}`);
