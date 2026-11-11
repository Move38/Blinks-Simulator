/*
 * compile(source) turns a Blinks sketch (.ino) into a factory that creates one running
 * instance of the program per Blink.
 */

import { preprocess } from './preprocess.js';
import { parse } from './parser.js';
import { generate } from './codegen.js';
import { CompileError } from './lexer.js';
import * as H from './rt.js';

// Rough RAM budget: a Blink has 1024 bytes of RAM and blinklib + the BIOS need about 694 of them.
export const RAM_TOTAL = 1024;
export const RAM_SYSTEM = 694;

export function compile(source, opts = {}) {
  try {
    const pp = preprocess(source, opts);
    const ast = parse(pp.tokens, opts);
    const gen = generate(ast, opts);
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
      ram: { used: gen.ram.globals, budget: RAM_TOTAL - RAM_SYSTEM },
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
