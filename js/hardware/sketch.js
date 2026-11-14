// What the Arduino IDE does to a sketch before gcc sees it, and how gcc's
// messages come back to the editor.

// A sketch can call a function before defining it, because the IDE adds a
// prototype for every function near the top. This does the same: it finds the
// functions defined at the top level and declares them just before the first
// one, with #line directives so gcc's line numbers stay those of the sketch.
export const inoToCpp = (code, file = 'sketch.ino') => inosToCpp([[file, code]]);

// A sketch's .ino files ([path, code], the main one first), as the one C++ file the IDE makes of them
export function inosToCpp(inos) {
  // where each line of the joined code came from, as [file, line]; null for the #line directives
  const lines = [], from = [];
  for (const [file, text] of inos) {
    lines.push(`#line 1 "${file}"`); from.push(null);
    text.split('\n').forEach((l, i) => { lines.push(l); from.push([file, i + 1]); });
  }
  const code = lines.join('\n');
  const clean = blank(code);
  const protos = [];
  let firstLine = 0;
  let depth = 0, parens = 0, stmt = 0;   // where the current top-level statement started
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '{') {
      if (depth === 0 && parens === 0) {
        const head = clean.slice(stmt, i).replace(/\s+/g, ' ').trim();
        const fn = functionHead(head);
        if (fn) {
          const line = lineAt(code, stmt + clean.slice(stmt).search(/\S/));
          if (!firstLine) firstLine = line;
          protos.push(`${fn};`);
        }
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) stmt = i + 1;
    } else if (ch === ';' && depth === 0 && parens === 0) stmt = i + 1;
    else if (ch === '\n' && depth === 0 && clean.slice(stmt, i).trimStart().startsWith('#')) stmt = i + 1;
  }
  const head = ['#include <Arduino.h>'];
  if (!protos.length) return head.concat(lines).join('\n');
  const [file, line] = from[firstLine - 1];
  return head.concat(lines.slice(0, firstLine - 1), protos, `#line ${line} "${file}"`, lines.slice(firstLine - 1)).join('\n');
}

// A sketch folder as the Arduino IDE builds it: its .ino files (in its own folder; the main
// one, then the rest alphabetically) joined into one file, and each .c/.cpp file in its own
// folder and anywhere under src/ compiled on its own. `files`: { path: text }, paths relative
// to the sketch's folder. Returns { files, units } for buildSketch, and the order of the files.
export function sketchUnits(files, main) {
  const paths = Object.keys(files);
  const order = [main, ...paths.filter((p) => p !== main).sort((a, b) => a.localeCompare(b))];
  const top = (p) => !p.includes('/');
  const inos = order.filter((p) => top(p) && /\.ino$/i.test(p));
  const cpps = order.filter((p) => (top(p) || p.startsWith('src/')) && /\.(c|cc|cpp)$/i.test(p));
  const joined = `${main}.cpp`;
  return { files: { ...files, [joined]: inosToCpp(inos.map((p) => [p, files[p]])) }, units: [joined, ...cpps], order };
}

const NOT_FUNCTIONS = /^(?:struct|class|union|enum|namespace|typedef|template|extern\s+"C")\b|=/;

// `int add(int a, int b)` -> the prototype, or null if this isn't a function definition we can declare
function functionHead(head) {
  if (NOT_FUNCTIONS.test(head)) return null;
  const m = /^((?:[\w:<>,*&\s]+?)[\s*&])(\w+)\s*\((.*)\)\s*(const)?$/.exec(head);
  if (!m) return null;
  // default arguments can only be given once, so leave those functions alone
  if (m[3].includes('=')) return null;
  return head;
}

const lineAt = (s, i) => s.slice(0, i).split('\n').length;

// The code with comments, strings, character constants and preprocessor lines
// turned into spaces, so braces and parentheses in them don't count. Newlines
// stay, and preprocessor lines keep their leading '#'.
function blank(code) {
  let out = '';
  for (let i = 0; i < code.length;) {
    const c = code[i], n = code[i + 1];
    if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') { out += ' '; i++; } }
    else if (c === '/' && n === '*') {
      out += '  '; i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) { out += code[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'") {
      out += ' '; i++;
      while (i < code.length && code[i] !== c && code[i] !== '\n') { if (code[i] === '\\') { out += ' '; i++; } out += ' '; i++; }
      out += ' '; i++;
    } else if (c === '#' && /(^|\n)[ \t]*$/.test(out)) {
      out += '#'; i++;
      while (i < code.length && code[i] !== '\n') { if (code[i] === '\\' && code[i + 1] === '\n') { out += ' \n'; i += 2; continue; } out += ' '; i++; }
    } else { out += c; i++; }
  }
  return out;
}

// gcc's and ld's messages for the sketch, as { file, line, message, severity }, with the
// sketch's own files named relative to its folder, as they are in `files`. Messages about
// other files (blinklib's, say) come with line 0, and say which file.
// gcc: "sketch.ino:12:5: error: 'x' was not declared in this scope"
//      "/build/sketch/src/game.cpp:3:1: error: …"
// ld:  "sketch.ino:12: undefined reference to `foo()'" or "... region `text' overflowed by 40 bytes"
export function parseDiagnostics(stderr, files = ['sketch.ino']) {
  const known = new Set(typeof files === 'string' ? [files] : files);
  const where = (path, line) => {
    const file = path.replace(/^\/build\/sketch\//, '');
    return known.has(file) ? { file, line: +line } : { file: null, line: 0, prefix: `${file.split('/').pop()}:${line}: ` };
  };
  const out = [];
  const seen = new Set();
  for (const raw of stderr.split('\n')) {
    const line = raw.trim();
    let m = /^(.+?):(\d+)(?::\d+)?: (fatal error|error|warning|note): (.*)$/.exec(line);
    if (m) {
      if (m[3] === 'note') continue;
      add(where(m[1], m[2]), m[4], m[3] === 'warning' ? 'warn' : 'err');
      continue;
    }
    m = /(?:^|\s|:)([^\s:]+\.(?:ino|cpp|cc|h|hpp)):(\d+): (undefined reference to .*)$/.exec(line);
    if (m) { add(where(m[1], m[2]), m[3].replace(/`/g, "'"), 'err'); continue; }
    m = /(region `?(\w+)'? overflowed by (\d+) bytes)/.exec(line);
    if (m) { add(null, m[2] === 'text' ? `The game is ${m[3]} bytes too big to fit on a Blink` : `Out of ${m[2]} memory by ${m[3]} bytes`, 'err'); continue; }
    m = /(?:^|: )(undefined reference to .*)$/.exec(line);
    if (m) add(null, m[1].replace(/`/g, "'"), 'err');
  }
  if (!out.length && stderr.trim()) add(null, stderr.trim().split('\n').at(-1), 'err');
  return out;

  function add(at, message, severity) {
    const { file = null, line = 0, prefix = '' } = at || {};
    const k = `${file}:${line}:${prefix}${message}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ file, line, message: prefix + message, severity });
  }
}
