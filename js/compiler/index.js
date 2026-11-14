/*
 * compile(source) turns a Blinks sketch (.ino) into a factory that creates one running
 * instance of the program per Blink. compileSketch() does the same for a sketch of several
 * files (.ino tabs, .cpp files, headers, a src/ folder), built the way the Arduino IDE builds it.
 */

import { preprocess, preprocessTokens, lexFile } from './preprocess.js';
import { parse, parseUnits } from './parser.js';
import { generate } from './codegen.js';
import { CompileError, LINE_FILE, tokenize } from './lexer.js';
import { SDKS, sdkConfig, sdkBuiltins } from './sdk.js';
import * as H from './rt.js';

// Rough RAM budget: a Blink has 1024 bytes of RAM and blinklib + the BIOS need about 694 of them.
export const RAM_TOTAL = 1024;
export const RAM_SYSTEM = 694;

export function compile(source, opts = {}) {
  if (opts.sdk && opts.sdk !== 'move38') return compileSketch({ files: { 'sketch.ino': source }, main: 'sketch.ino', sdk: opts.sdk });
  return run(() => {
    const pp = preprocess(source, opts);
    return { pp, ast: parse(pp.tokens, opts), gen: opts };
  });
}

// files: { path: text }, paths relative to the sketch's folder; main: the main .ino's path;
// sdk: an id from sdk.js. Errors and warnings come back with { file, line }, and where(line)
// turns a line from the generated code or a runtime error into { file, line }.
export function compileSketch({ files, main, sdk = 'move38' }) {
  const paths = Object.keys(files);
  const order = [main, ...paths.filter(p => p !== main).sort((a, b) => a.localeCompare(b))];
  const where = line => ({ file: order[Math.floor((line || 0) / LINE_FILE)] || main, line: (line || 0) % LINE_FILE });
  let cfg;
  try { cfg = sdkConfig(sdk, files); }
  catch (e) { return { ok: false, errors: [{ file: 'config/blinklib_config.h', line: 1, message: e.message }], warnings: [], where, files: order, main }; }
  const S = SDKS[cfg.id];
  const ids = new Map(order.map((p, i) => [p, i]));
  const top = p => !p.includes('/');
  // Arduino builds the .ino files in the sketch's folder as one file, then each .c/.cpp file there
  // and anywhere under src/
  const inos = order.filter(p => top(p) && /\.ino$/i.test(p));
  const cpps = order.filter(p => (top(p) || p.startsWith('src/')) && /\.(c|cc|cpp)$/i.test(p));
  const r = run(() => {
    const sketch = { files, ids, includeDirs: S.includeDirs || [], headers: S.headers, once: null };
    const unit = (lexes, file) => {
      const tokens = [];
      for (const l of lexes) { tokens.push(...l.tokens); tokens.pop(); }
      tokens.push({ t: 'eof', v: '', line: tokens.length ? tokens[tokens.length - 1].line : 0 });
      return preprocessTokens({ tokens, comments: [] }, { prelude: S.prelude, sketch: { ...sketch, once: new Set() } }, file);
    };
    const units = [];
    if (S.source) units.push(unit([tokenize(S.source)], main));
    // the IDE starts the sketch with #include <Arduino.h>
    const first = unit([tokenize('#include <Arduino.h>\n'), ...inos.map(p => lexFile(files[p], ids.get(p)))], main);
    units.push(first);
    for (const p of cpps) units.push(unit([lexFile(files[p], ids.get(p))], p));
    const ast = parseUnits(units.map(u => u.tokens));
    return { pp: { ...first, warnings: units.flatMap(u => u.warnings) }, ast, gen: { builtins: sdkBuiltins(cfg) }, ramSystem: cfg.ramSystem };
  });
  const at = d => ({ ...d, ...where(d.line) });
  r.errors = r.errors.map(at);
  r.warnings = r.warnings.map(at);
  return Object.assign(r, { where, files: order, main, sdk: cfg });
}

function run(build) {
  try {
    const { pp, ast, gen: genOpts, ramSystem } = build();
    const gen = generate(ast, genOpts);
    let factory;
    try {
      factory = new Function('env', gen.js);
    } catch (e) {
      // A bug in the code generator, not the sketch
      console.error(e, gen.js);
      return { ok: false, errors: [{ line: 0, message: 'Internal compiler error: ' + e.message }], warnings: [] };
    }
    const warnings = pp.warnings.concat(gen.warnings);
    return {
      ok: true,
      factory,
      js: gen.js,
      lineMap: gen.lineMap,
      warnings: dedupe(warnings),
      errors: [],
      ram: { used: gen.ram.globals, budget: RAM_TOTAL - (ramSystem ?? RAM_SYSTEM) },
      serialInput: gen.serialInput,
      functions: gen.functions,
      globals: gen.globals,
      defines: pp.defines,
      ast,
    };
  } catch (e) {
    if (e instanceof CompileError) return { ok: false, errors: [{ line: e.line, col: e.col, message: e.message }], warnings: [] };
    console.error(e);
    return { ok: false, errors: [{ line: 0, message: 'Internal compiler error: ' + e.message }], warnings: [] };
  }
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(w => { const k = w.line + ':' + w.message; if (seen.has(k)) return false; seen.add(k); return true; });
}

export { H };
