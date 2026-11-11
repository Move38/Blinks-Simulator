/*
 * Code generator: typed AST -> JavaScript that behaves like avr-gcc output.
 *
 * Every Blink gets its own 64 KB byte array as RAM. Globals, arrays, structs and anything whose
 * address is taken live in that memory with AVR sizes and layout, so pointers, casts, bitfields,
 * sizeof and datagrams of structs behave as on hardware. Plain scalar locals become JS variables.
 *
 * Invariant: the JS code for an expression always yields a value already wrapped to the
 * range of its C type (byte 0..255, int -32768..32767, ...).
 */

import { CompileError } from './lexer.js';
import { T, ptr, ref, arr, fn, isInt, isArith, isScalar, sizeOf, typeName, sameType, promote, commonType, intOf, TIMER, SERIAL } from './types.js';
import { BUILTINS, NOT_ON_BLINKS, TIMER_METHODS } from './builtins.js';
import * as H from './rt.js';

export const MEM = {
  SIZE: 0x10000,
  DATAGRAM_IN: 0x100,         // 6 faces x 16 bytes, written by the runtime
  GLOBALS: 0x160,
  STACK_TOP: 0xfff0,
};

const JS_RESERVED = new Set(['M', 'DV', 'L', 'H', 'SP']);
// C library functions a sketch may define for itself (blinklib functions can't be redefined)
const LIBC = new Set(['memcpy', 'memmove', 'memset', 'memcmp', 'strlen', 'strcmp', 'strcpy', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt', 'pow', 'exp', 'log', 'log10', 'fabs', 'floor', 'ceil', 'fmod', 'fmin', 'fmax', 'labs', 'rand', 'srand', 'cli', 'sei', 'noInterrupts', 'interrupts']);

class Emitter {
  constructor() { this.lines = []; this.map = []; this.ind = 0; this.curLine = 0; }
  emit(s, cline) { this.lines.push('  '.repeat(this.ind) + s); this.map.push(cline || this.curLine); }
  indent() { this.ind++; } dedent() { this.ind--; }
}

const isAggregate = t => t.k === 'arr' || t.k === 'struct';

export function generate(ast, opts = {}) {
  return new Codegen(opts).program(ast);
}

class Codegen {
  constructor(opts) {
    this.opts = opts;
    this.errors = [];
    this.warnings = [];
    this.globals = new Map();     // name -> symbol
    this.funcs = new Map();       // name -> fn symbol
    this.structDefs = [];
    this.dataPtr = MEM.GLOBALS;
    this.userRam = 0;
    this.strings = new Map();
    this.fnTable = [null];
    this.out = new Emitter();
    this.init = new Emitter();
    this.scopes = [];
    this.fnCtx = null;
    this.oobSites = 0;
    this.methodBodies = [];
    this.called = new Map();
    this.initTempNames = [];
  }

  error(msg, line) { return new CompileError(msg, line || this.line); }
  warn(msg, line) { this.warnings.push({ line: line || this.line, message: msg }); }

  // ================= program =================
  program(ast) {
    // pass 1: types, globals, function signatures in source order
    const funcDefs = [];
    for (const item of ast.items) {
      this.line = item.line;
      if (item.kind === 'TypeDecl') this.declareType(item.type);
      else if (item.kind === 'VarDecl') this.globalVar(item);
      else if (item.kind === 'FuncDef') { this.declareFunc(item); if (item.body) funcDefs.push({ node: item, globalsSoFar: new Set(this.globals.keys()) }); }
    }
    for (const m of this.methodBodies) funcDefs.push({ node: m, globalsSoFar: null });
    if (!this.funcs.has('setup') || !this.funcs.get('setup').defined) throw this.error('Your sketch needs a setup() function', 1);
    if (!this.funcs.has('loop') || !this.funcs.get('loop').defined) throw this.error('Your sketch needs a loop() function', 1);

    // pass 2: function bodies
    for (const f of funcDefs) this.genFunction(f.node, f.globalsSoFar);
    for (const [sym, line] of this.called) {
      if (!sym.defined) throw this.error(`${sym.name}() is declared but never defined`, line);
    }

    const ramEnd = this.dataPtr;
    const rtStart = ramEnd;
    const rtSize = 512;
    const stackLimit = rtStart + rtSize + 64;

    const head = [
      '"use strict";',
      'const M = env.M, DV = env.DV, L = env.L, H = env.H;',
      `let SP = ${MEM.STACK_TOP}, __budget = 0, __rt = ${rtStart};`,
      `const __LIM = ${stackLimit};`,
      'const r16 = a => DV.getUint16(a, true), r16s = a => DV.getInt16(a, true), r32 = a => DV.getUint32(a, true), r32s = a => DV.getInt32(a, true), rf = a => DV.getFloat32(a, true);',
      'const w16 = (a, v) => (DV.setUint16(a, v, true), v), w32 = (a, v) => (DV.setUint32(a, v, true), v), wf = (a, v) => (DV.setFloat32(a, v, true), v);',
      'const w8 = (a, v) => (M[a] = v);',
      'function memcpy(d, s, n) { M.copyWithin(d, s, s + n); return d; }',
      'function memset(d, v, n) { M.fill(v & 255, d, d + n); return d; }',
      'function memcmp(a, b, n) { for (let i = 0; i < n; i++) { const d = M[a + i] - M[b + i]; if (d) return d; } return 0; }',
      'function strlen(a) { let n = 0; while (M[a + n]) n++; return n; }',
      'function strcmp(a, b) { for (let i = 0; ; i++) { const d = M[a + i] - M[b + i]; if (d || !M[a + i]) return d; } }',
      'function strcpy(d, s) { let i = 0; do { M[d + i] = M[s + i]; } while (M[s + i++]); return d; }',
      'function bfg(a, o, w, s) { let v = (M[a] | (M[a + 1] << 8) | (M[a + 2] << 16) | (M[a + 3] << 24)) >>> o; if (w < 32) v &= (1 << w) - 1; return s ? (v << (32 - w)) >> (32 - w) : v >>> 0; }',
      'function bfs(a, o, w, v) { const mask = (w < 32 ? (1 << w) - 1 : -1); let cur = M[a] | (M[a + 1] << 8) | (M[a + 2] << 16) | (M[a + 3] << 24); cur = (cur & ~(mask << o)) | ((v & mask) << o); const n = (o + w + 7) >> 3; for (let i = 0; i < n; i++) M[a + i] = cur >>> (8 * i); return v; }',
      `function __tmp(n) { if (__rt + n > ${rtStart + rtSize}) __rt = ${rtStart}; const a = __rt; __rt += n; M.fill(0, a, a + n); return a; }`,
      `function __stuck(line) { H.stuck(line); }`,
      `function __overflow() { H.overflow(); }`,
      'function __oob(i, n, site, line) { if (i < 0 || i >= n) H.hooks.outOfBounds(i, n, site, line); return i; }',
      'function __nullchk(a, line) { if (a < 256) H.nullDeref(a, line); return a; }',
    ];
    const lineMap = [];
    const all = [];
    for (const h of head) { all.push(h); lineMap.push(0); }
    for (let i = 0; i < this.out.lines.length; i++) { all.push(this.out.lines[i]); lineMap.push(this.out.map[i]); }
    all.push('function __init() {'); lineMap.push(0);
    if (this.initTempNames.length) { all.push('  let ' + this.initTempNames.join(', ') + ';'); lineMap.push(0); }
    for (let i = 0; i < this.init.lines.length; i++) { all.push('  ' + this.init.lines[i]); lineMap.push(this.init.map[i]); }
    all.push('}'); lineMap.push(0);
    const fnTable = this.fnTable.map(f => f ? f.js : 'null').join(', ');
    all.push(`const __fns = [${fnTable}];`); lineMap.push(0);
    all.push(`return { init: __init, setup: ${this.funcs.get('setup').js}, loop: ${this.funcs.get('loop').js}, setBudget(n) { __budget = n; }, resetStack() { SP = ${MEM.STACK_TOP}; } };`); lineMap.push(0);

    return {
      js: all.join('\n'),
      lineMap,
      warnings: this.warnings,
      ram: { globals: this.userRam, strings: this.stringBytes || 0 },
      serialInput: !!this.usesSerialInput,
      stackLimit,
      functions: [...this.funcs.values()].filter(f => !f.method).map(f => ({ name: f.name, line: f.line })),
      globals: [...this.globals.values()].filter(s => s.sk === 'var').map(s => ({ name: s.name, type: typeName(s.type), addr: s.addr, size: sizeOf(s.type), line: s.line })),
    };
  }

  // ================= types =================
  declareType(t) {
    if (t.k === 'struct') this.layout(t.def);
    if (t.k === 'enum') this.declareEnum(t);
  }

  declareEnum(t) {
    const def = t.def;
    if (def.declared) return;
    def.declared = true;
    let v = -1;
    for (const it of def.items) {
      v = it.value ? this.constEval(it.value, it.line) : v + 1;
      const sym = { sk: 'const', name: it.name, type: t, value: v, line: it.line };
      if (!def.scoped) this.defineGlobal(it.name, sym, it.line);
      if (def.tag) this.globals.set(def.tag + '::' + it.name, sym);
    }
  }

  layout(def) {
    if (def.size != null) return;
    if (!def.complete) throw this.error(`'${def.name}' is used before it is fully defined`);
    if (!this.structDefs.includes(def)) this.structDefs.push(def);
    const union = def.kind === 'union';
    let bit = 0, size = 0;
    const fields = [];
    for (const m of def.members) {
      const mt = this.resolveType(m.type, m.line);
      if (m.anon) {
        this.layout(mt.def);
        if (!union && bit % 8) bit = (bit + 7) & ~7;
        const base = union ? 0 : bit >> 3;
        for (const f of mt.def.fields) fields.push({ ...f, offset: f.offset + base });
        if (union) size = Math.max(size, mt.def.size); else bit += mt.def.size * 8;
        continue;
      }
      if (mt.k === 'struct') this.layout(mt.def);
      if (m.bitsExpr) {
        const w = this.constEval(m.bitsExpr, m.line);
        if (!isInt(mt)) throw this.error(`Bitfield '${m.name}' must have an integer type`, m.line);
        if (w > sizeOf(intOf(mt)) * 8) throw this.error(`Bitfield '${m.name}' is wider than its type`, m.line);
        if (w === 0) { bit = (bit + 7) & ~7; continue; }
        const at = union ? 0 : bit;
        fields.push({ name: m.name, type: mt, offset: at >> 3, bitOff: at & 7, bits: w, access: m.access, line: m.line });
        if (union) size = Math.max(size, (w + 7) >> 3); else bit += w;
        continue;
      }
      if (!union && bit % 8) bit = (bit + 7) & ~7;
      const sz = sizeOf(mt);
      if (mt.k === 'arr' && mt.n == null) throw this.error(`Array '${m.name}' needs a size`, m.line);
      fields.push({ name: m.name, type: mt, offset: union ? 0 : bit >> 3, access: m.access, init: m.init, line: m.line });
      if (union) size = Math.max(size, sz); else bit += sz * 8;
    }
    def.fields = fields;
    def.size = union ? size : (bit + 7) >> 3;
    for (const [, m] of def.methods) {
      this.declareFunc(m);
      if (m.body) this.methodBodies.push(m);
    }
  }

  resolveType(t, line) {
    switch (t.k) {
      case 'arr': {
        const of = this.resolveType(t.of, line);
        let n = t.n;
        if (n == null && t.nExpr) {
          n = this.constEval(t.nExpr, line);
          if (n < 0) throw this.error('Array size can\'t be negative', line);
        }
        return arr(of, n, null);
      }
      case 'ptr': return t.to.k === 'arr' || t.to.k === 'fn' || t.to.k === 'struct' ? ptr(this.resolveType(t.to, line)) : t;
      case 'ref': return ref(this.resolveType(t.to, line));
      case 'struct':
        if (t.def.builtin) return t;
        if (t.def.complete) this.layout(t.def);
        return t;
      case 'enum': this.declareEnum(t); return t;
      case 'fn': return t;
      default:
        if (t.wide && !this.warnedWide) { this.warnedWide = true; this.warn(`${t.name} is 64-bit on hardware; the simulator uses 32 bits`, line); }
        return t;
    }
  }

  constEval(node, line) {
    const e = this.ex(node);
    if (e.cv === undefined) throw this.error('Expected a constant value here (a number, enum or const)', line || node.line);
    return e.cv;
  }

  // ================= symbols =================
  defineGlobal(name, sym, line) {
    if (sym.sk === 'var' && (BUILTINS[name] || name === 'round')) throw this.error(`'${name}' is already the name of a function on Blinks; pick a different name`, line);
    const prev = this.globals.get(name);
    if (prev && prev.sk === 'var' && sym.sk === 'var') throw this.error(`'${name}' is already defined (line ${prev.line})`, line);
    if (prev && prev.sk === 'const' && sym.sk === 'const' && prev.type !== sym.type) throw this.error(`'${name}' is already defined (line ${prev.line})`, line);
    this.globals.set(name, sym);
  }

  alloc(size) {
    const a = this.dataPtr;
    this.dataPtr += size;
    if (this.dataPtr > 0xc000) throw this.error('Your globals use far more memory than a Blink has');
    return a;
  }

  globalVar(item) {
    for (const d of item.decls) {
      this.line = d.line;
      if (d.type.k === 'fn') { this.declareFunc({ kind: 'FuncDef', name: d.name, type: d.type, params: d.type.params, body: null, line: d.line }); continue; }
      let t = this.resolveType(d.type, d.line);
      if (t.k === 'auto') t = this.autoType(d.init);
      if (t.k === 'arr' && t.n == null) t = this.inferArraySize(t, d.init, d.line);
      if (t.k === 'void') throw this.error(`Variable '${d.name}' can't be void`, d.line);
      if (t.k === 'ref') throw this.error('Global references are not supported', d.line);
      if (item.isExtern) continue;
      const size = sizeOf(t);
      const addr = this.alloc(size);
      this.userRam += size;
      const sym = { sk: 'var', name: d.name, type: t, storage: 'mem', addr, line: d.line, isConst: item.isConst };
      // compile-time value for `const int N = 5;`
      this.withInit(() => {
        this.initObject(t, String(addr), d, d.line);
      });
      if (item.isConst && d.init && d.init.kind !== 'InitList' && isScalar(t)) {
        const e = this.ex(d.init);
        if (e.cv !== undefined) sym.cv = this.convConst(e.cv, e.t, t);
      }
      this.defineGlobal(d.name, sym, d.line);
    }
  }

  convConst(v, from, to) {
    const code = this.conv({ c: String(v), t: from, cv: v }, to, 0, true).c;
    return Function('H', 'return ' + code)(H);
  }

  withInit(f) {
    const saveOut = this.out, saveCtx = this.fnCtx, saveScopes = this.scopes;
    this.out = this.init;
    this.fnCtx = this.initCtx || (this.initCtx = { temps: 0, frame: 0, isInit: true, name: '(global initializer)', addrTaken: new Set() });
    this.scopes = [];
    const mark = this.init.lines.length;
    try { f(); }
    catch (e) { this.init.lines.length = mark; this.init.map.length = mark; throw e; }
    finally { this.out = saveOut; this.fnCtx = saveCtx; this.scopes = saveScopes; }
  }

  autoType(init) {
    if (!init) throw this.error("'auto' needs an initializer");
    const e = this.ex(init);
    return this.decay(e).t;
  }

  inferArraySize(t, init, line) {
    if (!init) throw this.error('Array needs a size or an initializer', line);
    if (init.kind === 'Str' && isInt(t.of) && t.of.size === 1) return arr(t.of, init.bytes.length + 1);
    if (init.kind === 'InitList') {
      const elems = t.of.k === 'arr' || t.of.k === 'struct' ? this.countAggregate(t.of, init.items) : init.items.length;
      return arr(t.of, elems);
    }
    throw this.error('Array initializer must be a { list }', line);
  }

  countAggregate(elemT, items) {
    // with brace elision, flat lists fill elements in order
    let n = 0, i = 0;
    const per = this.scalarCount(elemT);
    while (i < items.length) {
      if (items[i].kind === 'InitList') { i++; n++; }
      else { i += per; n++; }
    }
    return n;
  }
  scalarCount(t) {
    if (t.k === 'arr') return (t.n || 0) * this.scalarCount(t.of);
    if (t.k === 'struct' && !t.def.builtin) { this.layout(t.def); return t.def.fields.reduce((s, f) => s + this.scalarCount(f.type), 0) || 1; }
    return 1;
  }

  declareFunc(node) {
    this.line = node.line;
    const key = node.cls ? node.cls + '::' + node.name : node.name;
    if (node.cls && !this.globalStruct(node.cls)) throw this.error(`Unknown class '${node.cls}'`, node.line);
    if (node.isCtor) {
      const def = this.globalStruct(node.cls).def;
      const ckey = node.cls + '::#ctor' + node.params.length;
      const prev = this.funcs.get(ckey);
      if (prev && prev.defined && node.body) throw this.error(`Constructor ${node.cls}() is defined twice`, node.line);
      const sym = prev || { sk: 'fn', name: node.cls, key: ckey, js: `F_${node.cls}__ctor${node.params.length}`, method: true, ctor: true, cls: def, line: node.line };
      sym.type = node.type; sym.params = this.resolveParams(node.params, node.line); sym.node = node;
      if (node.body) sym.defined = true;
      this.funcs.set(ckey, sym);
      def.ctors = def.ctors || new Map();
      def.ctors.set(node.params.length, sym);
      return;
    }
    if (BUILTINS[key] && !node.cls && !LIBC.has(key)) {
      throw this.error(`'${node.name}' is already a Blinks function; pick a different name`, node.line);
    }
    let sym = this.funcs.get(key);
    const params = this.resolveParams(node.params, node.line);
    const ret = this.resolveType(node.type.ret, node.line);
    if (sym) {
      if (sym.params.length !== params.length) throw this.error(`'${node.name}' is declared with ${sym.params.length} parameters on line ${sym.line} but ${params.length} here (overloading isn't supported in the simulator)`, node.line);
      if (sym.defined && node.body) throw this.error(`Function '${node.name}' is defined twice (also on line ${sym.line})`, node.line);
      // prototypes may carry default arguments
      params.forEach((p, i) => { if (!p.def && sym.params[i].def) p.def = sym.params[i].def; });
    } else {
      const js = node.cls ? `F_${node.cls}__${node.name}` : 'F_' + node.name;
      sym = { sk: 'fn', name: node.name, key, js, line: node.line };
      if (node.cls) { sym.method = true; sym.cls = this.globalStruct(node.cls).def; }
      this.funcs.set(key, sym);
      if (!node.cls) {
        const g = this.globals.get(node.name);
        if (g && g.sk === 'var') throw this.error(`'${node.name}' is already a variable`, node.line);
        this.globals.set(node.name, sym);
      }
    }
    sym.ret = ret; sym.params = params; sym.node = node.body ? node : (sym.node || node);
    if (node.body) { sym.defined = true; sym.line = node.line; }
    if (node.name === 'loop' || node.name === 'setup') {
      if (params.length) throw this.error(`${node.name}() doesn't take any parameters`, node.line);
      if (ret.k !== 'void') throw this.error(`${node.name}() must be declared void`, node.line);
    }
  }

  globalStruct(name) {
    for (const d of this.structDefs) if (d.name === name) return { def: d };
    return null;
  }

  resolveParams(params, line) {
    return params.map(p => {
      let t = this.resolveType(p.type, p.line || line);
      if (t.k === 'arr') t = ptr(t.of);           // arrays decay
      if (t.k === 'fn') t = ptr(t);
      if (t.k === 'void') throw this.error('A parameter can\'t be void', line);
      return { name: p.name, type: t, def: p.def };
    });
  }

  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i].get(name);
      if (s) return s;
    }
    if (this.fnCtx && this.fnCtx.cls) {
      const f = this.fieldOf(this.fnCtx.cls, name);
      if (f) return { sk: 'field', field: f };
      const m = this.funcs.get(this.fnCtx.cls.name + '::' + name);
      if (m) return { sk: 'method', fn: m };
    }
    const g = this.globals.get(name);
    if (g) {
      if (this.fnCtx && this.fnCtx.visible && g.sk === 'var' && !this.fnCtx.visible.has(name)) {
        throw this.error(`'${name}' is used before it is declared (it's declared on line ${g.line}). Move the declaration above this function.`);
      }
      return g;
    }
    return null;
  }

  fieldOf(def, name) {
    if (def.builtin) return null;
    this.layout(def);
    return def.fields.find(f => f.name === name) || null;
  }

  // ================= functions =================
  genFunction(node, globalsSoFar) {
    const sym = this.funcs.get(node.isCtor ? node.cls + '::#ctor' + node.params.length : (node.cls ? node.cls + '::' + node.name : node.name));
    this.line = node.line;
    const cls = node.cls ? this.globalStruct(node.cls).def : null;
    const ctx = { name: node.name, ret: sym.ret || T.void, temps: 0, frame: 0, cls, visible: globalsSoFar, addrTaken: new Set(), staticN: 0 };
    collectAddrTaken(node.body, ctx.addrTaken, this);
    this.fnCtx = ctx;
    this.scopes = [new Map()];
    const out = this.out;
    const jsParams = [];
    const prologue = [];
    if (cls) jsParams.push('__this');
    sym.params.forEach((p, i) => {
      const pn = 'p' + i + '_' + (p.name || 'arg');
      jsParams.push(pn);
      if (!p.name) return;
      const t = p.type;
      if (t.k === 'ref') {
        this.scopes[0].set(p.name, { sk: 'var', name: p.name, type: t.to, storage: 'ref', js: pn });
      } else if (t.k === 'struct' || ctx.addrTaken.has(p.name)) {
        const off = this.frameAlloc(sizeOf(t));
        const addr = `(__fb + ${off})`;
        if (t.k === 'struct') prologue.push(`memcpy(${addr}, ${pn}, ${sizeOf(t)});`);
        else prologue.push(this.store(t, addr, pn) + ';');
        this.scopes[0].set(p.name, { sk: 'var', name: p.name, type: t, storage: 'frame', off });
      } else {
        this.scopes[0].set(p.name, { sk: 'var', name: p.name, type: t, storage: 'js', js: pn });
      }
    });
    out.emit(`function ${sym.js}(${jsParams.join(', ')}) {`, node.line);
    out.indent();
    const frameIdx = out.lines.length;
    out.emit('/*FRAME*/', node.line);
    for (const p of prologue) out.emit(p, node.line);
    if (node.isCtor && node.inits) this.genCtorInits(cls, node.inits);
    this.genBlockBody(node.body.body);
    // falling off the end
    out.emit('SP = __fp;', node.body.endLine || node.line);
    out.dedent();
    out.emit('}', node.body.endLine || node.line);
    const frame = 2 + ctx.frame;
    let pro = `const __fp = SP, __fb = SP = __fp - ${frame}; if (__fb < __LIM) __overflow();`;
    if (ctx.temps) pro += ' let ' + Array.from({ length: ctx.temps }, (_, i) => '__t' + i).join(', ') + ';';
    out.lines[frameIdx] = '  '.repeat(out.ind + 1) + pro;
    this.fnCtx = null;
    this.scopes = [];
  }

  genCtorInits(cls, inits) {
    for (const ini of inits) {
      this.line = ini.line;
      const f = this.fieldOf(cls, ini.name);
      if (!f) throw this.error(`'${ini.name}' is not a member of ${cls.name}`, ini.line);
      const addr = `(__this + ${f.offset})`;
      if (f.bits) {
        const v = this.conv(this.ex(ini.args[0]), f.type);
        this.out.emit(`bfs(${addr}, ${f.bitOff}, ${f.bits}, ${v.c});`);
      } else if (ini.args.length === 1 && isScalar(f.type)) {
        this.out.emit(this.store(f.type, addr, this.conv(this.ex(ini.args[0]), f.type).c) + ';');
      } else {
        this.construct(f.type, addr, ini.args, ini.line);
      }
    }
  }

  frameAlloc(n) {
    const off = this.fnCtx.frame;
    this.fnCtx.frame += n;
    return off;
  }
  temp() {
    if (this.fnCtx.isInit) {
      const name = '__i' + this.initTempNames.length;
      this.initTempNames.push(name);
      return name;
    }
    return '__t' + this.fnCtx.temps++;
  }

  // ================= statements =================
  genBlockBody(stmts) {
    for (const s of stmts) this.stmt(s);
  }

  stmt(s) {
    this.line = s.line;
    this.out.curLine = s.line;
    const o = this.out;
    switch (s.kind) {
      case 'Block':
        o.emit('{', s.line); o.indent();
        this.scopes.push(new Map());
        this.genBlockBody(s.body);
        this.scopes.pop();
        o.dedent(); o.emit('}', s.endLine || s.line);
        return;
      case 'Empty': return;
      case 'TypeDecl': this.declareType(s.type); return;
      case 'ExprStmt': {
        const e = this.ex(s.expr, { discard: true });
        o.emit(e.c + ';', s.line);
        return;
      }
      case 'VarDecl': this.localVar(s); return;
      case 'If': {
        const c = this.cond(s.cond);
        o.emit(`if (${c}) {`, s.line); o.indent();
        this.subStmt(s.then);
        o.dedent();
        if (s.else) {
          o.emit('} else {', s.else.line); o.indent();
          this.subStmt(s.else);
          o.dedent();
        }
        o.emit('}', s.line);
        return;
      }
      case 'While': {
        const c = this.cond(s.cond);
        o.emit(`while (${c}) {`, s.line); o.indent();
        o.emit(`if (--__budget < 0) __stuck(${s.line});`, s.line);
        this.loopBody(s.body);
        o.dedent(); o.emit('}', s.line);
        return;
      }
      case 'DoWhile': {
        o.emit('do {', s.line); o.indent();
        o.emit(`if (--__budget < 0) __stuck(${s.line});`, s.line);
        this.loopBody(s.body);
        o.dedent();
        o.emit(`} while (${this.cond(s.cond)});`, s.line);
        return;
      }
      case 'For': {
        this.scopes.push(new Map());
        o.emit('{', s.line); o.indent();
        if (s.init) {
          if (s.init.kind === 'VarDecl') this.localVar(s.init);
          else o.emit(this.ex(s.init.expr, { discard: true }).c + ';', s.line);
        }
        const c = s.cond ? this.cond(s.cond) : 'true';
        const step = s.step ? this.ex(s.step, { discard: true }).c : '';
        o.emit(`for (; ${c}; ${step}) {`, s.line); o.indent();
        o.emit(`if (--__budget < 0) __stuck(${s.line});`, s.line);
        this.loopBody(s.body);
        o.dedent(); o.emit('}', s.line);
        o.dedent(); o.emit('}', s.line);
        this.scopes.pop();
        return;
      }
      case 'RangeFor': {
        const it = this.ex(s.iter);
        if (it.t.k !== 'arr' || !it.lv) throw this.error('Range-based for only works on arrays here', s.line);
        const base = this.temp(), idx = this.temp();
        const es = sizeOf(it.t.of);
        this.scopes.push(new Map());
        o.emit(`${base} = ${it.lv.addr};`, s.line);
        o.emit(`for (${idx} = 0; ${idx} < ${it.t.n}; ${idx}++) {`, s.line); o.indent();
        o.emit(`if (--__budget < 0) __stuck(${s.line});`, s.line);
        let dt = s.decl.type;
        if (dt.k === 'ref') {
          const t = dt.to.k === 'auto' ? it.t.of : this.resolveType(dt.to);
          const jn = '_' + s.decl.name + '_' + this.uid();
          o.emit(`const ${jn} = ${base} + ${idx} * ${es};`, s.line);
          this.scopes[this.scopes.length - 1].set(s.decl.name, { sk: 'var', name: s.decl.name, type: t, storage: 'ref', js: jn });
        } else {
          const t = dt.k === 'auto' ? it.t.of : this.resolveType(dt);
          this.declareLocal(s.decl.name, t, { kind: 'Raw', c: this.load(it.t.of, `(${base} + ${idx} * ${es})`), t: it.t.of }, s.line);
        }
        this.loopBody(s.body);
        o.dedent(); o.emit('}', s.line);
        this.scopes.pop();
        return;
      }
      case 'Switch': {
        const d = this.ex(s.disc);
        if (!isInt(d.t)) throw this.error('switch needs an integer value', s.line);
        const dt = promote(d.t);
        this.switchType = this.switchType || [];
        this.switchType.push(dt);
        o.emit(`switch (${this.conv(d, dt).c}) {`, s.line); o.indent();
        this.scopes.push(new Map());
        const body = s.body.kind === 'Block' ? s.body.body : [s.body];
        const seen = new Set();
        for (const st of body) {
          if (st.kind === 'Case') {
            const v = this.ex(st.test);
            if (v.cv === undefined) throw this.error('case needs a constant value', st.line);
            const cv = this.convConst(v.cv, v.t, dt);
            if (seen.has(cv)) throw this.error(`Duplicate case value ${cv}`, st.line);
            seen.add(cv);
            o.dedent(); o.emit(`case ${cv}:`, st.line); o.indent();
          } else if (st.kind === 'Default') {
            o.dedent(); o.emit('default:', st.line); o.indent();
          } else this.stmt(st);
        }
        this.scopes.pop();
        this.switchType.pop();
        o.dedent(); o.emit('}', s.line);
        return;
      }
      case 'Case': case 'Default':
        throw this.error(`'${s.kind.toLowerCase()}' outside of a switch`, s.line);
      case 'Break': o.emit('break;', s.line); return;
      case 'Continue': o.emit('continue;', s.line); return;
      case 'Return': {
        const ret = this.fnCtx.ret;
        if (this.fnCtx.isInit) throw this.error('return outside a function', s.line);
        if (!s.arg) {
          if (ret.k !== 'void') this.warn(`${this.fnCtx.name}() should return a value`, s.line);
          o.emit('{ SP = __fp; return; }', s.line);
          return;
        }
        const e = this.ex(s.arg);
        if (ret.k === 'void') {
          if (e.t.k !== 'void') throw this.error(`${this.fnCtx.name}() is void, so it can't return a value`, s.line);
          o.emit(`{ ${e.c}; SP = __fp; return; }`, s.line);
          return;
        }
        if (ret.k === 'struct') {
          const v = this.conv(e, ret);
          const sz = sizeOf(ret);
          o.emit(`{ const __r = memcpy(__tmp(${sz}), ${v.c}, ${sz}); SP = __fp; return __r; }`, s.line);
          return;
        }
        if (ret.k === 'ref') {
          if (!e.lv || e.lv.lk !== 'mem') throw this.error('Returning a reference needs a variable in memory', s.line);
          o.emit(`{ const __r = ${e.lv.addr}; SP = __fp; return __r; }`, s.line);
          return;
        }
        o.emit(`{ const __r = ${this.conv(e, ret).c}; SP = __fp; return __r; }`, s.line);
        return;
      }
    }
    throw this.error(`Unsupported statement ${s.kind}`, s.line);
  }

  subStmt(s) {
    if (s.kind === 'Block') {
      this.scopes.push(new Map());
      this.genBlockBody(s.body);
      this.scopes.pop();
    } else {
      this.scopes.push(new Map());
      this.stmt(s);
      this.scopes.pop();
    }
  }
  loopBody(s) { this.subStmt(s); }

  cond(node) {
    const e = this.ex(node);
    if (e.t.k === 'struct' || e.t.k === 'color') throw this.error(`A ${typeName(e.t)} can't be used as true/false`, node.line);
    if (e.t.k === 'void') throw this.error('This has no value to test', node.line);
    if (node.kind === 'Assign' && node.op === '=') this.warn('Did you mean == ? This assigns a value inside the condition', node.line);
    return this.decay(e).c;
  }

  uid() { return (this._uid = (this._uid || 0) + 1); }

  localVar(s) {
    for (const d of s.decls) {
      this.line = d.line;
      let t = d.type.k === 'auto' ? this.autoType(d.init) : this.resolveType(d.type, d.line);
      if (t.k === 'fn') { this.declareFunc({ kind: 'FuncDef', name: d.name, type: t, params: t.params, body: null, line: d.line }); continue; }
      if (t.k === 'arr' && t.n == null) t = this.inferArraySize(t, d.init, d.line);
      if (t.k === 'void') throw this.error(`Variable '${d.name}' can't be void`, d.line);
      if (s.isStatic) { this.staticLocal(d, t, s); continue; }
      if (t.k === 'ref') {
        if (!d.init) throw this.error(`Reference '${d.name}' must be initialized`, d.line);
        const e = this.ex(d.init);
        const target = t.to.k === 'auto' ? e.t : this.resolveType(t.to);
        let addr;
        if (e.lv && e.lv.lk === 'mem') addr = e.lv.addr;
        else if (e.t.k === 'struct') addr = e.c;
        else throw this.error(`Reference '${d.name}' must refer to a variable`, d.line);
        const jn = '_' + d.name + '_' + this.uid();
        this.out.emit(`const ${jn} = ${addr};`, d.line);
        this.scopes[this.scopes.length - 1].set(d.name, { sk: 'var', name: d.name, type: target, storage: 'ref', js: jn });
        continue;
      }
      this.declareLocal(d.name, t, d.init, d.line, d.ctorArgs, s.isConst);
    }
  }

  declareLocal(name, t, init, line, ctorArgs, isConst) {
    const scope = this.scopes[this.scopes.length - 1];
    if (scope.has(name) && this.scopes.length > 1) throw this.error(`'${name}' is already declared in this block`, line);
    const inMem = isAggregate(t) || this.fnCtx.addrTaken.has(name) || t.k === 'struct';
    if (!inMem) {
      const jn = JS_RESERVED.has(name) ? '_' + name + '_' : '_' + name;
      let v = '0';
      let cv;
      if (init) {
        const e = init.kind === 'Raw' ? init : this.ex(init);
        if (init.kind === 'InitList') throw this.error(`'${name}' isn't an array or struct, so it can't take a { list }`, line);
        v = this.conv(e, t).c;
        if (isConst && e.cv !== undefined) cv = this.convConst(e.cv, e.t, t);
      } else if (ctorArgs) {
        v = ctorArgs.length ? this.conv(this.ex(ctorArgs[0]), t).c : '0';
      }
      const sym = { sk: 'var', name, type: t, storage: 'js', js: jn, cv };
      // declare after evaluating the initializer (C scoping: `int x = x;` refers to the new x but is UB anyway)
      this.out.emit(`let ${jn} = ${v};`, line);
      scope.set(name, sym);
      return sym;
    }
    const size = sizeOf(t);
    const off = this.frameAlloc(size);
    const addr = `(__fb + ${off})`;
    const sym = { sk: 'var', name, type: t, storage: 'frame', off };
    scope.set(name, sym);
    this.out.emit(`M.fill(0, ${addr}, ${addr} + ${size});`, line);
    this.initObject(t, addr, { init, ctorArgs, name }, line);
    return sym;
  }

  staticLocal(d, t, s) {
    const size = sizeOf(t);
    const addr = this.alloc(size);
    this.userRam += size;
    const sym = { sk: 'var', name: d.name, type: t, storage: 'mem', addr, line: d.line };
    let constant = true;
    if (d.init) {
      try { this.withInit(() => this.initObject(t, String(addr), d, d.line)); }
      catch (e) { constant = false; }
    }
    if (!constant) {
      // dynamic initializer: runs the first time execution passes the declaration
      const guard = this.alloc(1);
      this.out.emit(`if (!M[${guard}]) { M[${guard}] = 1;`, d.line);
      this.out.indent();
      this.initObject(t, String(addr), d, d.line);
      this.out.dedent();
      this.out.emit('}', d.line);
    }
    this.scopes[this.scopes.length - 1].set(d.name, sym);
  }

  // Write an initializer for an object stored at `addr`
  initObject(t, addr, d, line) {
    const init = d.init;
    if (t.k === 'struct') {
      if (t.def.builtin) {
        if (init && init.kind !== 'InitList') {
          const e = this.ex(init);
          this.out.emit(`memcpy(${addr}, ${this.conv(e, t).c}, ${sizeOf(t)});`, line);
        }
        return;
      }
      if (init && init.kind === 'InitList') { this.initList(t, addr, init.items, line); return; }
      if (init) {
        const e = this.ex(init);
        this.out.emit(`memcpy(${addr}, ${this.conv(e, t).c}, ${sizeOf(t)});`, line);
        return;
      }
      this.construct(t, addr, d.ctorArgs || [], line, !d.ctorArgs);
      return;
    }
    if (t.k === 'arr') {
      if (!init) {
        // arrays of objects with constructors
        const base = this.innermost(t);
        if (base.k === 'struct' && base.def.ctors && base.def.ctors.get(0)) {
          const n = sizeOf(t) / sizeOf(base);
          const i = this.temp();
          this.out.emit(`for (${i} = 0; ${i} < ${n}; ${i}++) ${base.def.ctors.get(0).js}(${addr} + ${i} * ${sizeOf(base)});`, line);
        }
        return;
      }
      if (init.kind === 'Str') {
        if (!(isInt(t.of) && t.of.size === 1)) throw this.error('A string can only initialize a char array', line);
        const bytes = init.bytes.concat([0]);
        if (bytes.length - 1 > t.n) throw this.error(`String is too long for ${typeName(t)}`, line);
        bytes.slice(0, t.n).forEach((b, i) => { if (b) this.out.emit(`M[${addr} + ${i}] = ${b};`, line); });
        return;
      }
      if (init.kind !== 'InitList') throw this.error('Arrays must be initialized with a { list }', line);
      this.initList(t, addr, init.items, line);
      return;
    }
    if (!init) return;
    if (init.kind === 'InitList') {
      if (init.items.length > 1) throw this.error('Too many values in { }', line);
      if (!init.items.length) return;
      const e = this.ex(init.items[0]);
      this.out.emit(this.store(t, addr, this.conv(e, t).c) + ';', line);
      return;
    }
    const e = this.ex(init);
    const v = this.conv(e, t);
    if (v.cv === 0) return; // memory starts zeroed
    this.out.emit(this.store(t, addr, v.c) + ';', line);
  }

  innermost(t) { while (t.k === 'arr') t = t.of; return t; }

  // aggregate initialization with brace elision
  initList(t, addr, items, line) {
    const cursor = { items, i: 0 };
    this.initAggregate(t, addr, cursor, line, true);
    if (cursor.i < items.length) throw this.error(`Too many values in the { } initializer for ${typeName(t)}`, line);
  }

  initAggregate(t, addr, cur, line, braced) {
    if (t.k === 'arr') {
      const es = sizeOf(t.of);
      for (let k = 0; k < t.n && cur.i < cur.items.length; k++) {
        this.initElement(t.of, `${addr} + ${k * es}`, cur, line);
      }
      return;
    }
    if (t.k === 'struct') {
      const def = t.def;
      if (def.builtin) { cur.i++; return; }
      this.layout(def);
      if (def.ctors && def.ctors.size) {
        this.construct(t, addr, cur.items.slice(cur.i), line);
        cur.i = cur.items.length;
        return;
      }
      const fields = def.kind === 'union' ? def.fields.slice(0, 1) : def.fields;
      for (const f of fields) {
        if (cur.i >= cur.items.length) break;
        const item = cur.items[cur.i];
        if (item.designator) {
          const df = def.fields.find(x => x.name === item.designator);
          if (!df) throw this.error(`${def.name} has no member '${item.designator}'`, line);
          this.initField(df, addr, cur, line);
          continue;
        }
        this.initField(f, addr, cur, line);
      }
      return;
    }
    this.initElement(t, addr, cur, line);
  }

  initField(f, addr, cur, line) {
    const a = `${addr} + ${f.offset}`;
    if (f.bits) {
      const e = this.ex(cur.items[cur.i++]);
      const v = this.conv(e, f.type);
      this.out.emit(`bfs(${a}, ${f.bitOff}, ${f.bits}, ${v.c});`, line);
      return;
    }
    this.initElement(f.type, a, cur, line);
  }

  initElement(t, addr, cur, line) {
    const item = cur.items[cur.i];
    if (isAggregate(t) && !(t.k === 'struct' && t.def.builtin)) {
      if (item.kind === 'InitList') {
        cur.i++;
        if (t.k === 'struct' && t.def.ctors && t.def.ctors.size) { this.construct(t, addr, item.items, line); return; }
        const sub = { items: item.items, i: 0 };
        this.initAggregate(t, addr, sub, line, true);
        if (sub.i < item.items.length) throw this.error(`Too many values in { } for ${typeName(t)}`, line);
        return;
      }
      if (item.kind === 'Str' && t.k === 'arr') {
        cur.i++;
        item.bytes.concat([0]).slice(0, t.n).forEach((b, i) => { if (b) this.out.emit(`M[${addr} + ${i}] = ${b};`, line); });
        return;
      }
      if (t.k === 'struct') {
        const e = this.ex(item);
        if (e.t.k === 'struct') { cur.i++; this.out.emit(`memcpy(${addr}, ${this.conv(e, t).c}, ${sizeOf(t)});`, line); return; }
      }
      // brace elision
      this.initAggregate(t, addr, cur, line, false);
      return;
    }
    cur.i++;
    if (item.kind === 'InitList') {
      if (item.items.length !== 1) throw this.error('Too many values in { }', line);
      const e = this.ex(item.items[0]);
      this.out.emit(this.store(t, `(${addr})`, this.conv(e, t).c) + ';', line);
      return;
    }
    const e = this.ex(item);
    const v = this.conv(e, t);
    if (v.cv === 0) return; // memory starts zeroed
    this.out.emit(this.store(t, `(${addr})`, v.c) + ';', line);
  }

  construct(t, addr, args, line, implicit) {
    const def = t.def;
    if (def.builtin) return;
    if (def.ctors && def.ctors.size) {
      const c = def.ctors.get(args.length);
      if (!c) {
        if (implicit && !args.length) throw this.error(`${def.name} has no constructor that takes no arguments`, line);
        throw this.error(`${def.name} has no constructor that takes ${args.length} argument${args.length === 1 ? '' : 's'}`, line);
      }
      const codes = this.callArgs(c, args, line);
      this.out.emit(`${c.js}(${[addr].concat(codes).join(', ')});`, line);
      return;
    }
    // default member initializers
    this.layout(def);
    for (const f of def.fields) {
      if (f.init) this.initObject(f.type, `${addr} + ${f.offset}`, { init: f.init }, line);
    }
    if (args.length) throw this.error(`${def.name} has no constructor`, line);
  }

  // ================= memory access =================
  load(t, a) {
    t = intOf(t);
    switch (t.k) {
      case 'int':
        if (t.size === 1) return t.signed ? `(M[${a}] << 24 >> 24)` : `M[${a}]`;
        if (t.size === 2) return t.signed ? `r16s(${a})` : `r16(${a})`;
        return t.signed ? `r32s(${a})` : `r32(${a})`;
      case 'float': return `rf(${a})`;
      case 'ptr': case 'color': return `r16(${a})`;
      case 'struct': case 'arr': return a;
    }
    throw this.error(`Can't read a ${typeName(t)}`);
  }
  store(t, a, v) {
    t = intOf(t);
    switch (t.k) {
      case 'int':
        if (t.size === 1) return `w8(${a}, ${v})`;
        if (t.size === 2) return `w16(${a}, ${v})`;
        return `w32(${a}, ${v})`;
      case 'float': return `wf(${a}, ${v})`;
      case 'ptr': case 'color': return `w16(${a}, ${v})`;
      case 'struct': return `memcpy(${a}, ${v}, ${sizeOf(t)})`;
    }
    throw this.error(`Can't assign to a ${typeName(t)}`);
  }

  read(lv) {
    switch (lv.lk) {
      case 'js': return lv.js;
      case 'mem': return this.load(lv.t, lv.addr);
      case 'bit': return `bfg(${lv.addr}, ${lv.bitOff}, ${lv.bits}, ${intOf(lv.t).signed && !lv.t.isBool ? 1 : 0})`;
      case 'cfield': {
        const base = this.read(lv.base);
        if (lv.field === 'as_uint16') return base;
        const sh = { reserved: 0, r: 1, g: 6, b: 11 }[lv.field];
        return `((${base} >> ${sh}) & ${lv.field === 'reserved' ? 1 : 31})`;
      }
    }
  }
  write(lv, v) {
    switch (lv.lk) {
      case 'js': return `(${lv.js} = ${v})`;
      case 'mem': return this.store(lv.t, lv.addr, v);
      case 'bit': return `bfs(${lv.addr}, ${lv.bitOff}, ${lv.bits}, ${v})`;
      case 'cfield': {
        if (lv.field === 'as_uint16') return this.write(lv.base, v);
        const sh = { reserved: 0, r: 1, g: 6, b: 11 }[lv.field];
        const w = lv.field === 'reserved' ? 1 : 31;
        const base = this.stableLv(lv.base);
        lv.base = base;
        const tv = this.temp();
        return `(${tv} = (${v}) & ${w}, ${this.write(base, `((${this.read(base)} & ${~(w << sh) & 0xffff}) | (${tv} << ${sh}))`)}, ${tv})`;
      }
    }
  }
  // make an lvalue's address safe to evaluate twice
  stableLv(lv) {
    if (lv.lk === 'js') return lv;
    if (lv.lk === 'cfield') return { ...lv, base: this.stableLv(lv.base) };
    if (/^[\w.() +]*$/.test(lv.addr) && !/[a-zA-Z_]\w*\(/.test(lv.addr.replace(/\(__fb \+ \d+\)/g, ''))) return lv;
    const tv = this.temp();
    return { ...lv, addr: tv, pre: `${tv} = ${lv.addr}` };
  }

  // ================= conversions =================
  wrap(t, c) {
    t = intOf(t);
    if (t.k !== 'int') return c;
    if (t.isBool) return `((${c}) ? 1 : 0)`;
    switch (t.size) {
      case 1: return t.signed ? `((${c}) << 24 >> 24)` : `((${c}) & 255)`;
      case 2: return t.signed ? `((${c}) << 16 >> 16)` : `((${c}) & 65535)`;
      default: return t.signed ? `((${c}) | 0)` : `((${c}) >>> 0)`;
    }
  }

  fits(from, to) {
    from = intOf(from); to = intOf(to);
    if (to.isBool) return !!from.isBool;
    if (from.isBool) return true;
    const range = t => t.signed ? [-(2 ** (t.size * 8 - 1)), 2 ** (t.size * 8 - 1) - 1] : [0, 2 ** (t.size * 8) - 1];
    const [a0, a1] = range(from), [b0, b1] = range(to);
    return a0 >= b0 && a1 <= b1;
  }

  decay(e) {
    if (e.builtin) return { c: this.builtinFnIndex(e.builtin), t: ptr({ k: 'fn', ret: BUILTINS[e.builtin].ret, params: BUILTINS[e.builtin].params.map(t => ({ type: t })) }) };
    if (e.t.k === 'arr') return { c: e.lv ? e.lv.addr : e.c, t: ptr(e.t.of), cv: undefined };
    if (e.t.k === 'fn') return { c: e.c, t: ptr(e.t), cv: undefined };
    return e;
  }

  // Implicit (or explicit, with cast=true) conversion
  conv(e, to, line, cast) {
    e = this.decay(e);
    const from = e.t;
    to = to.k === 'enum' || to.k === 'int' ? to : to;
    const mk = c => {
      let cv;
      if (e.cv !== undefined && isScalar(to) && !/[a-zA-Z_$]/.test(c.replace(/Math\.(trunc|fround)|\bH\.\w+/g, ''))) {
        try { cv = Function('H', 'return ' + c)(H); } catch (err) { cv = undefined; }
      }
      return cv !== undefined && typeof cv === 'number' ? { c: numLit(cv), t: to, cv } : { c, t: to };
    };
    if (to.k === 'void') return { c: e.c, t: to };
    if (from.k === 'void') throw this.error('This has no value (it\'s void)', line);
    if (sameType(from, to)) return { c: e.c, t: to, cv: e.cv };
    if (to.k === 'struct') {
      if (from.k === 'struct' && from.def === to.def) return { c: e.c, t: to };
      throw this.error(`Can't convert ${typeName(from)} to ${typeName(to)}`, line);
    }
    if (to.k === 'color') {
      if (from.k === 'color') return { c: e.c, t: to };
      if (cast && isInt(from)) return mk(this.wrap(T.u16, e.c));
      throw this.error(`Can't use ${typeName(from)} as a Color. Use a color like RED, or makeColorRGB(r, g, b)`, line);
    }
    if (from.k === 'color') {
      throw this.error(`Can't use a Color as ${typeName(to)}. A Color's parts are color.r, color.g and color.b (0-31)`, line);
    }
    if (from.k === 'struct') throw this.error(`Can't convert ${typeName(from)} to ${typeName(to)}`, line);
    if (to.k === 'ptr' && e.builtin) {
      return { c: this.builtinFnIndex(e.builtin), t: to };
    }
    if (to.k === 'ptr') {
      if (from.k === 'ptr') {
        return { c: e.c, t: to };
      }
      if (isInt(from)) {
        if (e.cv === 0) return { c: '0', t: to, cv: 0 };
        if (!cast) this.warn(`Converting ${typeName(from)} to a pointer`, line);
        return mk(this.wrap(T.u16, e.c));
      }
      if (from.k === 'float' && cast) return mk(`(Math.trunc(${e.c}) & 65535)`);
      throw this.error(`Can't convert ${typeName(from)} to ${typeName(to)}`, line);
    }
    if (from.k === 'ptr') {
      if (isInt(to)) {
        if (intOf(to).isBool) return mk(`((${e.c}) ? 1 : 0)`);
        if (!cast) this.warn(`Converting a pointer to ${typeName(to)}`, line);
        return mk(this.wrap(to, e.c));
      }
      throw this.error(`Can't convert ${typeName(from)} to ${typeName(to)}`, line);
    }
    if (to.k === 'float') {
      if (from.k === 'float') return { c: e.c, t: to, cv: e.cv };
      if (intOf(from).size <= 2) return { c: e.c, t: to, cv: e.cv };
      return mk(`Math.fround(${e.c})`);
    }
    if (isInt(to)) {
      if (to.k === 'enum' && from.k !== 'enum' && !cast && !intOf(from).isBool) {
        // -fpermissive allows this with a warning
        if (e.cv === undefined) this.warn(`Converting ${typeName(from)} to enum ${typeName(to)}`, line);
      }
      if (from.k === 'float') {
        if (intOf(to).isBool) return mk(`((${e.c}) !== 0 ? 1 : 0)`);
        return mk(this.wrap(to, `Math.trunc(${e.c})`));
      }
      if (isInt(from)) {
        if (this.fits(from, to)) return { c: e.c, t: to, cv: e.cv };
        return mk(this.wrap(to, e.c));
      }
    }
    throw this.error(`Can't convert ${typeName(from)} to ${typeName(to)}`, line);
  }

  // ================= expressions =================
  // returns { c: code, t: type, lv?: lvalue, cv?: constant value }
  ex(n, o = {}) {
    this.line = n.line || this.line;
    switch (n.kind) {
      case 'Num': return this.numLit(n);
      case 'Char': return { c: String(n.value), t: T.char, cv: n.value };
      case 'Bool': return { c: n.value ? '1' : '0', t: T.bool, cv: n.value ? 1 : 0 };
      case 'Str': return this.strLit(n);
      case 'Paren': return this.ex(n.expr, o);
      case 'Raw': return { c: n.c, t: n.t };
      case 'Ident': return this.ident(n);
      case 'This':
        if (!this.fnCtx || !this.fnCtx.cls) throw this.error("'this' only works inside a class method");
        return { c: '__this', t: ptr({ k: 'struct', name: this.fnCtx.cls.name, def: this.fnCtx.cls }) };
      case 'Binary': return this.binary(n);
      case 'Logical': {
        const a = this.condOperand(n.l), b = this.condOperand(n.r);
        const cv = a.cv !== undefined && b.cv !== undefined ? (n.op === '&&' ? (a.cv && b.cv ? 1 : 0) : (a.cv || b.cv ? 1 : 0)) : undefined;
        if (cv !== undefined) return { c: String(cv), t: T.bool, cv };
        return { c: `((${a.c}) ${n.op} (${b.c}) ? 1 : 0)`, t: T.bool };
      }
      case 'Unary': return this.unary(n, o);
      case 'Postfix': return this.incdec(n.arg, n.op, false, o.discard);
      case 'Assign': return this.assign(n, o);
      case 'Cond': return this.ternary(n);
      case 'Comma': {
        const parts = n.exprs.map((x, i) => this.ex(x, { discard: i < n.exprs.length - 1 || o.discard }));
        const last = parts[parts.length - 1];
        return { c: '(' + parts.map(p => p.c).join(', ') + ')', t: last.t };
      }
      case 'Cast': {
        const t = this.resolveType(n.type);
        const e = this.ex(n.arg);
        if (t.k === 'void') return { c: e.c, t: T.void };
        if (t.k === 'ref') {
          if (!e.lv || e.lv.lk !== 'mem') throw this.error('Can only cast a variable in memory to a reference');
          return { c: this.load(t.to, e.lv.addr), t: t.to, lv: { lk: 'mem', addr: e.lv.addr, t: t.to } };
        }
        return this.conv(e, t, n.line, true);
      }
      case 'Construct': return this.constructExpr(n);
      case 'SizeofType': {
        const t = this.resolveType(n.type);
        const s = sizeOf(t.k === 'ref' ? t.to : t);
        return { c: String(s), t: T.u16, cv: s };
      }
      case 'SizeofExpr': {
        const save = this.out; this.out = new Emitter();
        const e = this.ex(n.arg);
        this.out = save;
        const s = sizeOf(e.t);
        return { c: String(s), t: T.u16, cv: s };
      }
      case 'Index': return this.index(n);
      case 'Member': return this.member(n);
      case 'Call': return this.call(n, o);
      case 'InitList': throw this.error('A { list } can only be used to initialize a variable');
    }
    throw this.error(`Unsupported expression ${n.kind}`);
  }

  condOperand(n) {
    const e = this.decay(this.ex(n));
    if (e.t.k === 'struct' || e.t.k === 'color' || e.t.k === 'void') throw this.error(`A ${typeName(e.t)} can't be used as true/false`, n.line);
    if (e.t.k === 'float') return { c: e.c, t: e.t, cv: e.cv === undefined ? undefined : (e.cv !== 0 ? 1 : 0) };
    return e;
  }

  numLit(n) {
    if (n.isFloat) { const v = Math.fround(n.value); return { c: numLit(v), t: T.float, cv: v }; }
    const v = n.value;
    let t;
    if (n.unsigned && n.long) t = T.u32;
    else if (n.unsigned) t = v <= 0xffff ? T.u16 : T.u32;
    else if (n.long) t = v <= 0x7fffffff ? T.i32 : T.u32;
    else if (n.decimal) t = v <= 0x7fff ? T.i16 : v <= 0x7fffffff ? T.i32 : T.u32;
    else t = v <= 0x7fff ? T.i16 : v <= 0xffff ? T.u16 : v <= 0x7fffffff ? T.i32 : T.u32;
    if (v > 0xffffffff) { this.warn(`${n.raw} is too big for 32 bits`); }
    const w = Function('return ' + this.wrap(t, String(v)))();
    return { c: numLit(w), t, cv: w };
  }

  strLit(n) {
    const key = n.bytes.join(',');
    let addr = this.strings.get(key);
    const size = n.bytes.length + 1;
    if (addr === undefined) {
      addr = this.alloc(size);
      this.stringBytes = (this.stringBytes || 0) + size;
      this.userRam += size;
      this.strings.set(key, addr);
      const save = this.out; this.out = this.init;
      n.bytes.forEach((b, i) => this.init.emit(`M[${addr + i}] = ${b};`, n.line));
      this.out = save;
    }
    const t = arr({ ...T.char, isConst: true }, size);
    return { c: String(addr), t, lv: { lk: 'mem', addr: String(addr), t } };
  }

  ident(n) {
    const name = n.name;
    const s = this.lookup(name);
    if (!s) {
      if (BUILTINS[name]) return { c: name, t: { k: 'builtin', name }, builtin: name };
      if (name === 'Serial') throw this.error('To print on a Blink, add `#include "Serial.h"` and `ServicePortSerial Serial;` at the top of your sketch, and call `Serial.begin();` in setup()');
      if (NOT_ON_BLINKS[name]) throw this.error(NOT_ON_BLINKS[name]);
      const lower = name.toLowerCase();
      const near = Object.keys(BUILTINS).find(k => k.toLowerCase() === lower) || [...this.globals.keys()].find(k => k.toLowerCase() === lower);
      throw this.error(`'${name}' was not declared` + (near ? `. Did you mean '${near}'?` : ''));
    }
    switch (s.sk) {
      case 'const': return { c: String(s.value), t: s.type, cv: s.value };
      case 'fn': {
        return { c: this.fnIndex(s), t: { k: 'fn', ret: s.ret, params: s.params }, fn: s };
      }
      case 'method': return { c: '0', t: { k: 'method' }, method: s.fn, self: '__this' };
      case 'field': return this.fieldAccess({ c: '__this', t: ptr({ k: 'struct', def: this.fnCtx.cls }) }, s.field, true);
      case 'var': {
        if (s.storage === 'js') return { c: s.js, t: s.type, lv: { lk: 'js', js: s.js, t: s.type }, cv: s.cv };
        let addr;
        if (s.storage === 'mem') addr = String(s.addr);
        else if (s.storage === 'frame') addr = `(__fb + ${s.off})`;
        else if (s.storage === 'ref') addr = s.js;
        const lv = { lk: 'mem', addr, t: s.type };
        const e = { c: this.load(s.type, addr), t: s.type, lv };
        if (s.cv !== undefined) e.cv = s.cv;
        if (s.type.k === 'arr') e.knownN = s.type.n;
        return e;
      }
    }
    throw this.error(`Can't use '${name}' here`);
  }

  builtinFnIndex(name) {
    const bi = BUILTINS[name];
    const ps = bi.params.map((_, i) => 'a' + i);
    const entry = { js: `((${ps.join(', ')}) => ${bi.gen(ps)})`, builtin: name };
    let i = this.fnTable.findIndex(f => f && f.builtin === name);
    if (i < 0) { this.fnTable.push(entry); i = this.fnTable.length - 1; }
    return String(i);
  }

  fnIndex(s) {
    let i = this.fnTable.indexOf(s);
    if (i < 0) { this.fnTable.push(s); i = this.fnTable.length - 1; }
    return String(i);
  }

  binary(n) {
    const op = n.op;
    let a = this.decay(this.ex(n.l)), b = this.decay(this.ex(n.r));
    for (const x of [a, b]) {
      if (x.t.k === 'struct') throw this.error(`Can't use ${op} with ${typeName(x.t)}` + (x.t.def.builtin === 'timer' ? '. Use the Timer\'s methods like isExpired()' : ''), n.line);
      if (x.t.k === 'color') throw this.error(`Can't use ${op} with Colors` + (op === '==' || op === '!=' ? '. Compare color.as_uint16 values instead' : ''), n.line);
      if (x.t.k === 'void') throw this.error(`Can't use ${op} with a value that is void`, n.line);
      if (x.t.k === 'builtin' || x.t.k === 'method') throw this.error(`'${x.c}' is a function; did you forget the ()?`, n.line);
    }
    let r;
    // pointer arithmetic
    if ((op === '+' || op === '-') && (a.t.k === 'ptr' || b.t.k === 'ptr')) {
      if (a.t.k === 'ptr' && b.t.k === 'ptr') {
        if (op !== '-') throw this.error('Can\'t add two pointers', n.line);
        const s = Math.max(1, sizeOf(a.t.to));
        return { c: `(((${a.c}) - (${b.c})) / ${s} | 0)`, t: T.i16 };
      }
      if (b.t.k === 'ptr') { if (op === '-') throw this.error('Can\'t subtract a pointer from a number', n.line); [a, b] = [b, a]; }
      const s = Math.max(1, sizeOf(a.t.to.k === 'void' ? T.u8 : a.t.to));
      const idx = this.conv(b, T.i32).c;
      return { c: `((${a.c} ${op} ${s === 1 ? idx : `(${idx}) * ${s}`}) & 65535)`, t: a.t };
    }
    if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
      const jsop = op === '==' ? '===' : op === '!=' ? '!==' : op;
      if (a.t.k === 'ptr' || b.t.k === 'ptr') {
        r = `((${a.c}) ${jsop} (${b.c}) ? 1 : 0)`;
        return this.fold({ c: r, t: T.bool }, [a, b]);
      }
      const ct = commonType(a.t, b.t);
      if (!ct) throw this.error(`Can't compare ${typeName(a.t)} with ${typeName(b.t)}`, n.line);
      if (ct.k === 'int' && !ct.signed && (signedNeg(a) || signedNeg(b))) this.warnSignedCompare(n.line);
      const ac = this.conv(a, ct).c, bc = this.conv(b, ct).c;
      return this.fold({ c: `((${ac}) ${jsop} (${bc}) ? 1 : 0)`, t: T.bool }, [a, b]);
    }
    if (op === '<<' || op === '>>') {
      if (!isInt(a.t) || !isInt(b.t)) throw this.error(`${op} needs whole numbers`, n.line);
      const lt = promote(a.t);
      const ac = this.conv(a, lt).c, bc = this.conv(b, promote(b.t)).c;
      return this.fold({ c: shiftCode(op, lt, ac, bc), t: lt }, [a, b]);
    }
    const ct = commonType(a.t, b.t);
    if (!ct) throw this.error(`Can't use ${op} with ${typeName(a.t)} and ${typeName(b.t)}`, n.line);
    if (ct.k === 'float' && ['%', '&', '|', '^'].includes(op)) throw this.error(`${op} needs whole numbers, not floats`, n.line);
    const ac = this.conv(a, ct).c, bc = this.conv(b, ct).c;
    if ((op === '/' || op === '%') && b.cv === 0 && ct.k === 'int') this.warn('Division by zero', n.line);
    return this.fold({ c: arithCode(op, ct, ac, bc), t: ct }, [a, b]);
  }

  warnSignedCompare(line) {
    this.warn('Comparing signed and unsigned numbers: a negative number becomes a huge positive one here', line);
  }

  fold(e, parts) {
    if (parts.every(p => p.cv !== undefined)) {
      try {
        const v = Function('H', 'return ' + e.c)(H);
        if (typeof v === 'number' && !Number.isNaN(v)) return { c: numLit(v), t: e.t, cv: v };
      } catch (err) { /* not constant */ }
    }
    return e;
  }

  unary(n, o) {
    const op = n.op;
    if (op === '++' || op === '--') return this.incdec(n.arg, op, true, o.discard);
    if (op === '&') {
      const e = this.ex(n.arg);
      if (e.fn) return { c: e.c, t: ptr({ k: 'fn', ret: e.fn.ret, params: e.fn.params }) };
      if (!e.lv) throw this.error('Can only take the address (&) of a variable', n.line);
      if (e.lv.lk === 'bit') throw this.error('Can\'t take the address of a bitfield', n.line);
      if (e.lv.lk === 'js') throw this.error(`Internal: '${e.lv.js}' is not in memory`, n.line);
      if (e.lv.lk === 'cfield') throw this.error('Can\'t take the address of part of a Color', n.line);
      return { c: e.lv.addr, t: ptr(e.t) };
    }
    if (op === '*') {
      const e = this.decay(this.ex(n.arg));
      if (e.t.k !== 'ptr') throw this.error(`Can't use * on ${typeName(e.t)} (it's not a pointer)`, n.line);
      if (e.t.to.k === 'void') throw this.error('Can\'t read through a void pointer; cast it first', n.line);
      if (e.t.to.k === 'fn') return { c: e.c, t: e.t.to, fnptr: true };
      const addr = `__nullchk(${e.c}, ${n.line})`;
      const t = e.t.to;
      return { c: this.load(t, addr), t, lv: { lk: 'mem', addr, t } };
    }
    const e = this.decay(this.ex(n.arg));
    if (op === '!') {
      const c = this.condOperand(n.arg);
      return this.fold({ c: `((${c.c}) ? 0 : 1)`, t: T.bool }, [c]);
    }
    if (!isArith(e.t)) throw this.error(`Can't use ${op} on ${typeName(e.t)}`, n.line);
    const pt = promote(e.t);
    const c = this.conv(e, pt).c;
    if (op === '+') return { c, t: pt, cv: e.cv };
    if (op === '-') {
      if (pt.k === 'float') return this.fold({ c: `(-${c})`, t: pt }, [e]);
      return this.fold({ c: this.wrap(pt, `-${c}`), t: pt }, [e]);
    }
    if (op === '~') {
      if (pt.k !== 'int') throw this.error('~ needs a whole number', n.line);
      return this.fold({ c: this.wrap(pt, `~${c}`), t: pt }, [e]);
    }
    throw this.error(`Unknown operator ${op}`, n.line);
  }

  needLvalue(e, what, line) {
    if (!e.lv) throw this.error(`Can't ${what} this: it isn't a variable`, line);
    if (e.t.k === 'arr') throw this.error(`Can't ${what} a whole array; set its elements one at a time`, line);
    if (e.t.isConst || e.isConst) throw this.error(`Can't ${what} a const value`, line);
    return e.lv;
  }

  incdec(argNode, op, prefix, discard) {
    const e = this.ex(argNode);
    let lv = this.needLvalue(e, op === '++' ? 'increment' : 'decrement', argNode.line);
    const t = e.t;
    const sign = op === '++' ? '+' : '-';
    let next;
    const calc = cur => {
      if (t.k === 'ptr') return `((${cur} ${sign} ${Math.max(1, sizeOf(t.to))}) & 65535)`;
      if (t.k === 'float') return `Math.fround(${cur} ${sign} 1)`;
      if (isInt(t)) {
        if (intOf(t).isBool) return op === '++' ? '1' : `(${cur} ? 0 : 1)`;
        return this.wrap(t, `${cur} ${sign} 1`);
      }
      throw this.error(`Can't use ${op} on ${typeName(t)}`, argNode.line);
    };
    lv = this.stableLv(lv);
    const pre = lv.pre ? lv.pre + ', ' : '';
    if (prefix || discard) {
      next = this.write(lv, calc(this.read(lv)));
      return { c: `(${pre}${next})`, t };
    }
    const tv = this.temp();
    return { c: `(${pre}${tv} = ${this.read(lv)}, ${this.write(lv, calc(tv))}, ${tv})`, t };
  }

  assign(n, o) {
    const target = this.ex(n.target);
    let lv = this.needLvalue(target, 'assign to', n.line);
    const t = target.t;
    if (n.op === '=') {
      if (n.value.kind === 'InitList') {
        if (t.k !== 'struct' || !lv.addr) throw this.error('A { list } can only be assigned to a struct', n.line);
        const tmp = this.temp();
        const save = this.out; const em = new Emitter(); this.out = em;
        this.initList(t, tmp, n.value.items, n.line);
        this.out = save;
        return { c: `(${tmp} = __tmp(${sizeOf(t)}), ${em.lines.map(l => l.trim().replace(/;$/, '')).join(', ') || '0'}, memcpy(${lv.addr}, ${tmp}, ${sizeOf(t)}))`, t };
      }
      const v = this.ex(n.value);
      if (t.k === 'struct') {
        if (t.def.builtin === 'serial') throw this.error('Can\'t assign Serial', n.line);
        const src = this.conv(v, t, n.line);
        return { c: `memcpy(${lv.addr}, ${src.c}, ${sizeOf(t)})`, t };
      }
      if (t.k === 'ref') throw this.error('Internal: ref assignment', n.line);
      const cv = this.conv(v, t, n.line);
      return { c: this.write(lv, cv.c), t };
    }
    // compound assignment
    const bop = n.op.slice(0, -1);
    lv = this.stableLv(lv);
    const pre = lv.pre ? lv.pre + ', ' : '';
    const cur = { c: this.read(lv), t };
    const v = this.decay(this.ex(n.value));
    let res;
    if (t.k === 'ptr' && (bop === '+' || bop === '-')) {
      const s = Math.max(1, sizeOf(t.to));
      res = `((${cur.c} ${bop} (${this.conv(v, T.i32).c}) * ${s}) & 65535)`;
      return { c: `(${pre}${this.write(lv, res)})`, t };
    }
    if (!isArith(t) || !isArith(v.t)) throw this.error(`Can't use ${n.op} with ${typeName(t)} and ${typeName(v.t)}`, n.line);
    let rt;
    if (bop === '<<' || bop === '>>') {
      rt = promote(t);
      res = shiftCode(bop, rt, this.conv(cur, rt).c, this.conv(v, promote(v.t)).c);
    } else {
      rt = commonType(t, v.t);
      if (rt.k === 'float' && ['%', '&', '|', '^'].includes(bop)) throw this.error(`${bop} needs whole numbers`, n.line);
      res = arithCode(bop, rt, this.conv(cur, rt).c, this.conv(v, rt).c);
    }
    const back = this.conv({ c: res, t: rt }, t, n.line, true).c;
    return { c: `(${pre}${this.write(lv, back)})`, t };
  }

  ternary(n) {
    const c = this.condOperand(n.test);
    let a = this.decay(this.ex(n.cons)), b = this.decay(this.ex(n.alt));
    let t;
    if (a.t.k === 'struct' || b.t.k === 'struct') {
      if (a.t.k !== 'struct' || b.t.k !== 'struct' || a.t.def !== b.t.def) throw this.error('Both sides of ?: must be the same type', n.line);
      t = a.t;
    } else if (a.t.k === 'color' || b.t.k === 'color') {
      if (a.t.k !== 'color' || b.t.k !== 'color') throw this.error('Both sides of ?: must be Colors', n.line);
      t = T.color;
    } else if (a.t.k === 'ptr' || b.t.k === 'ptr') {
      t = a.t.k === 'ptr' ? a.t : b.t;
    } else if (a.t.k === 'void' || b.t.k === 'void') {
      t = T.void;
    } else if (intOf(a.t).isBool && intOf(b.t).isBool) {
      t = T.bool;
    } else {
      t = commonType(a.t, b.t);
      if (!t) throw this.error('Both sides of ?: must be compatible', n.line);
    }
    const ac = t.k === 'void' ? a.c : this.conv(a, t).c, bc = t.k === 'void' ? b.c : this.conv(b, t).c;
    if (c.cv !== undefined) return c.cv ? this.conv(a, t) : this.conv(b, t);
    const e = { c: `((${c.c}) ? ${ac} : ${bc})`, t };
    return e;
  }

  constructExpr(n) {
    const t = this.resolveType(n.type);
    const args = n.args;
    if (t.k === 'color') {
      if (args.length === 0) return { c: '0', t: T.color, cv: 0 };
      if (args.length === 1) return this.conv(this.ex(args[0]), T.color, n.line);
      if (args.length !== 3 && args.length !== 4) throw this.error('Color(r, g, b) takes 3 values from 0 to 31', n.line);
      const parts = args.map(a => this.conv(this.ex(a), T.u8, n.line));
      if (args.length === 3) parts.push({ c: '0', cv: 0 });
      return this.fold({ c: `H.color5(${parts.map(p => p.c).join(', ')})`, t: T.color }, parts);
    }
    if (isScalar(t)) {
      if (args.length === 0) return { c: '0', t, cv: 0 };
      if (args.length !== 1) throw this.error(`${typeName(t)}(...) takes one value`, n.line);
      return this.conv(this.ex(args[0]), t, n.line, true);
    }
    if (t.k === 'struct') {
      const sz = sizeOf(t);
      const tmp = this.temp();
      const save = this.out; const em = new Emitter(); this.out = em;
      if (args.length === 1 && args[0].kind === 'InitList') this.initList(t, tmp, args[0].items, n.line);
      else this.construct(t, tmp, args, n.line);
      this.out = save;
      const body = em.lines.map(l => l.trim().replace(/;$/, '')).filter(Boolean);
      return { c: `(${tmp} = __tmp(${sz}), ${body.length ? body.join(', ') + ', ' : ''}${tmp})`, t };
    }
    throw this.error(`Can't construct ${typeName(t)}`, n.line);
  }

  index(n) {
    const base = this.ex(n.obj);
    const idx = this.decay(this.ex(n.index));
    if (!isInt(idx.t)) throw this.error('Array index must be a whole number', n.line);
    let b = this.decay(base);
    if (b.t.k !== 'ptr') {
      throw this.error(`'${typeName(base.t)}' isn't an array`, n.line);
    }
    const et = b.t.to;
    if (et.k === 'void') throw this.error('Can\'t index a void pointer', n.line);
    const es = sizeOf(et);
    let ic = this.conv(idx, promote(idx.t).size > 2 ? T.i32 : T.i16).c;
    if (base.t.k === 'arr' && base.t.n != null && !(idx.cv !== undefined && idx.cv >= 0 && idx.cv < base.t.n)) {
      if (idx.cv !== undefined) this.warn(`Index ${idx.cv} is outside ${typeName(base.t)} (valid: 0 to ${base.t.n - 1})`, n.line);
      ic = `__oob(${ic}, ${base.t.n}, ${++this.oobSites}, ${n.line})`;
    }
    let addr;
    if (idx.cv !== undefined) addr = idx.cv === 0 ? b.c : `(${b.c} + ${idx.cv * es})`;
    else addr = `(${b.c} + ${es === 1 ? ic : `${ic} * ${es}`})`;
    if (base.t.k === 'ptr') addr = `__nullchk(${addr}, ${n.line})`;
    const lv = { lk: 'mem', addr, t: et };
    const e = { c: this.load(et, addr), t: et, lv };
    if (et.isConst) e.isConst = true;
    return e;
  }

  member(n) {
    let obj = this.ex(n.obj);
    let base;
    if (n.arrow) {
      obj = this.decay(obj);
      if (obj.t.k !== 'ptr' || obj.t.to.k !== 'struct') throw this.error(`-> needs a pointer to a struct, but this is ${typeName(obj.t)}`, n.line);
      base = { c: `__nullchk(${obj.c}, ${n.line})`, t: obj.t.to };
    } else {
      if (obj.t.k === 'ptr' && obj.t.to.k === 'struct') throw this.error(`Use -> instead of . on a pointer`, n.line);
      base = obj;
    }
    const t = base.t;
    if (t.k === 'color') {
      if (!['r', 'g', 'b', 'reserved', 'as_uint16'].includes(n.prop)) throw this.error(`A Color has .r, .g, .b (0-31) and .as_uint16, not .${n.prop}`, n.line);
      const ft = n.prop === 'as_uint16' ? T.u16 : T.u8;
      if (base.lv) {
        const lv = { lk: 'cfield', base: base.lv, field: n.prop, t: ft };
        return { c: this.read(lv), t: ft, lv };
      }
      const sh = { reserved: 0, r: 1, g: 6, b: 11, as_uint16: 0 }[n.prop];
      return { c: n.prop === 'as_uint16' ? base.c : `((${base.c} >> ${sh}) & ${n.prop === 'reserved' ? 1 : 31})`, t: ft };
    }
    if (t.k !== 'struct') throw this.error(`'.${n.prop}' needs a struct, but this is ${typeName(t)}`, n.line);
    const def = t.def;
    const addr = base.lv && base.lv.lk === 'mem' ? base.lv.addr : base.c;
    if (def.builtin === 'timer') {
      if (TIMER_METHODS[n.prop]) return { c: '0', t: { k: 'method' }, builtinMethod: TIMER_METHODS[n.prop], self: addr, prop: n.prop };
      throw this.error(`A Timer has set(), add(), never(), isExpired() and getRemaining(), not .${n.prop}`, n.line);
    }
    if (def.builtin === 'serial') return { c: '0', t: { k: 'method' }, serialMethod: n.prop, self: addr };
    const m = this.funcs.get(def.name + '::' + n.prop);
    if (m) return { c: '0', t: { k: 'method' }, method: m, self: addr };
    const f = this.fieldOf(def, n.prop);
    if (!f) throw this.error(`${def.name || 'struct'} has no member '${n.prop}'`, n.line);
    if (f.access === 'private' && !(this.fnCtx && this.fnCtx.cls === def)) throw this.error(`'${n.prop}' is private in ${def.name}`, n.line);
    return this.fieldAccess({ c: addr, t: ptr(t) }, f);
  }

  fieldAccess(basePtr, f) {
    const addr = f.offset ? `(${basePtr.c} + ${f.offset})` : basePtr.c;
    if (f.bits) {
      const lv = { lk: 'bit', addr, bitOff: f.bitOff, bits: f.bits, t: f.type };
      return { c: this.read(lv), t: f.type, lv };
    }
    const lv = { lk: 'mem', addr, t: f.type };
    return { c: this.load(f.type, addr), t: f.type, lv };
  }

  callArgs(fsym, args, line) {
    const ps = fsym.params;
    if (args.length > ps.length) throw this.error(`${fsym.name}() takes ${ps.length} argument${ps.length === 1 ? '' : 's'} but got ${args.length}`, line);
    const codes = [];
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      let argNode = args[i];
      if (!argNode) {
        if (!p.def) throw this.error(`${fsym.name}() needs ${ps.filter(x => !x.def).length} argument${ps.length === 1 ? '' : 's'} but got ${args.length}`, line);
        argNode = p.def;
      }
      const e = this.ex(argNode);
      if (p.type.k === 'ref') {
        const to = p.type.to;
        if (e.lv && e.lv.lk === 'mem') { codes.push(e.lv.addr); continue; }
        if (e.t.k === 'struct') { codes.push(e.c); continue; }
        // temporary for const references
        const sz = Math.max(1, sizeOf(to));
        const tmp = this.temp();
        codes.push(`(${tmp} = __tmp(${sz}), ${this.store(to, tmp, this.conv(e, to, line).c)}, ${tmp})`);
        continue;
      }
      codes.push(this.conv(e, p.type, line).c);
    }
    return codes;
  }

  call(n, o) {
    const callee = this.ex(n.callee);
    const line = n.line;
    if (callee.builtin) {
      const bi = BUILTINS[callee.builtin];
      if (n.args.length !== bi.params.length) throw this.error(`${callee.builtin}() takes ${bi.params.length} argument${bi.params.length === 1 ? '' : 's'} but got ${n.args.length}`, line);
      const args = n.args.map((a, i) => this.conv(this.ex(a), bi.params[i], line));
      const e = { c: bi.gen(args.map(a => a.c)), t: bi.ret };
      if (bi.pure) return this.fold(e, args);
      return e;
    }
    if (callee.builtinMethod) {
      const bm = callee.builtinMethod;
      if (n.args.length !== bm.params.length) throw this.error(`Timer.${callee.prop}() takes ${bm.params.length} argument${bm.params.length === 1 ? '' : 's'}`, line);
      const args = n.args.map((a, i) => this.conv(this.ex(a), bm.params[i], line).c);
      return { c: bm.gen(args, callee.self), t: bm.ret };
    }
    if (callee.serialMethod) return this.serialCall(callee.serialMethod, n.args, line, callee.self);
    if (callee.method) {
      const m = callee.method;
      const codes = this.callArgs(m, n.args, line);
      return this.retWrap({ c: `${m.js}(${[callee.self].concat(codes).join(', ')})`, t: m.ret });
    }
    if (callee.fn) {
      const f = callee.fn;
      if (!this.called.has(f)) this.called.set(f, line);
      const codes = this.callArgs(f, n.args, line);
      return this.retWrap({ c: `${f.js}(${codes.join(', ')})`, t: f.ret });
    }
    // call through a function pointer
    let fp = this.decay(callee);
    let ft = null;
    if (fp.t.k === 'ptr' && fp.t.to.k === 'fn') ft = fp.t.to;
    else if (callee.t.k === 'fn') ft = callee.t;
    if (!ft) throw this.error(`This isn't a function, so it can't be called with ()`, line);
    const params = ft.params.map(p => ({ ...p, type: this.resolveType(p.type) }));
    const codes = this.callArgs({ name: 'function', params }, n.args, line);
    return this.retWrap({ c: `__fns[${fp.c}](${codes.join(', ')})`, t: this.resolveType(ft.ret) });
  }

  retWrap(e) {
    if (e.t.k === 'ref') {
      const t = e.t.to;
      return { c: this.load(t, e.c), t, lv: { lk: 'mem', addr: e.c, t } };
    }
    return e;
  }

  // ServicePortSerial only transmits after begin(); the object's byte remembers that
  serialCall(method, args, line, self) {
    const e = this.serialCallInner(method, args, line, self);
    if (/^(print|println|write)$/.test(method)) return { c: `(M[${self}] ? ${e.c} : L.serialNotBegun())`, t: e.t };
    return e;
  }

  serialCallInner(method, args, line, self) {
    switch (method) {
      case 'begin': return { c: `(M[${self}] = 1, 0)`, t: T.void };
      case 'end': return { c: `(M[${self}] = 0, 0)`, t: T.void };
      case 'flush':
        return { c: '0', t: T.void };
      case 'available': this.usesSerialInput = true; return { c: 'L.serialAvailable()', t: T.i16 };
      case 'read': this.usesSerialInput = true; return { c: 'L.serialRead()', t: T.i16 };
      case 'print': case 'println': case 'write': {
        const nl = method === 'println' ? 1 : 0;
        if (method === 'write') {
          const e = this.ex(args[0]);
          return { c: `L.serialWrite(${this.conv(e, T.u8, line).c})`, t: T.u16 };
        }
        if (!args.length) return { c: `L.serialPrint('', ${nl})`, t: T.u16 };
        if (args.length > 2) throw this.error(`Serial.${method}() takes at most 2 arguments`, line);
        const e = this.decay(this.ex(args[0]));
        const base = args[1] ? this.conv(this.ex(args[1]), T.i16, line).c : null;
        const t = e.t;
        if (t.k === 'ptr' && isInt(t.to) && t.to.size === 1) return { c: `L.serialPrintStr(${e.c}, ${nl})`, t: T.u16 };
        if (t.k === 'float') return { c: `L.serialPrint((${e.c}).toFixed(${base == null ? 2 : base}), ${nl})`, t: T.u16 };
        if (t.k === 'color') throw this.error('Serial can\'t print a Color; print color.r, color.g and color.b', line);
        if (isInt(t)) {
          const it = intOf(t);
          if (it.size === 1 && it.signed && !base && t.name === 'char') return { c: `L.serialPrint(String.fromCharCode(${e.c} & 255), ${nl})`, t: T.u16 };
          // print(byte) and print(int) both print the number; HEX/BIN print the unsigned bit pattern
          return { c: `L.serialPrint(${base ? `L.fmtNum(${e.c}, ${base}, ${it.size})` : `String(${e.c})`}, ${nl})`, t: T.u16 };
        }
        if (t.k === 'ptr') return { c: `L.serialPrint(String(${e.c}), ${nl})`, t: T.u16 };
        throw this.error(`Serial can't print ${typeName(t)}`, line);
      }
    }
    throw this.error(`Serial has no ${method}()`, line);
  }
}

// only warn when a negative constant is compared with an unsigned value (e.g. `x > -1`)
function signedNeg(e) {
  return e.cv !== undefined && e.cv < 0;
}

function numLit(v) {
  if (Object.is(v, -0)) return '-0';
  if (v < 0) return `(${v})`;
  return String(v);
}

function arithCode(op, t, a, b) {
  if (t.k === 'float') {
    if (op === '/') return `Math.fround((${a}) / (${b}))`;
    return `Math.fround((${a}) ${op} (${b}))`;
  }
  const w = c => {
    if (t.size === 2) return t.signed ? `((${c}) << 16 >> 16)` : `((${c}) & 65535)`;
    return t.signed ? `((${c}) | 0)` : `((${c}) >>> 0)`;
  };
  switch (op) {
    case '+': case '-': return w(`(${a}) ${op} (${b})`);
    case '*': return t.size === 2 ? w(`(${a}) * (${b})`) : w(`Math.imul(${a}, ${b})`);
    case '/': return w(`H.div(${a}, ${b})`);
    case '%': return w(`H.mod(${a}, ${b})`);
    case '&': case '|': case '^': return w(`(${a}) ${op} (${b})`);
  }
  throw new Error('bad op ' + op);
}

function shiftCode(op, t, a, b) {
  if (op === '<<') {
    if (t.size === 2) return t.signed ? `((${a}) << (${b}) << 16 >> 16)` : `(((${a}) << (${b})) & 65535)`;
    return t.signed ? `((${a}) << (${b}))` : `(((${a}) << (${b})) >>> 0)`;
  }
  if (t.signed) return `((${a}) >> (${b}))`;
  return `((${a}) >>> (${b}))`;
}

// Find locals whose address is taken (& or reference binding), so they live in memory
function collectAddrTaken(node, set, cg) {
  const visit = n => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (n.kind === 'Unary' && n.op === '&' && n.arg.kind === 'Ident') set.add(n.arg.name);
    if (n.kind === 'Call' && n.callee.kind === 'Ident') {
      const f = cg.funcs.get(n.callee.name);
      if (f && f.params) f.params.forEach((p, i) => { if (p.type.k === 'ref' && n.args[i] && n.args[i].kind === 'Ident') set.add(n.args[i].name); });
    }
    if (n.kind === 'Call' && n.callee.kind === 'Member') {
      // method calls on a local struct take its address
      let o = n.callee.obj; if (o.kind === 'Ident') set.add(o.name);
    }
    if (n.kind === 'VarDecl') {
      for (const d of n.decls) if (d.type.k === 'ref' && d.init && d.init.kind === 'Ident') set.add(d.init.name);
    }
    for (const k in n) {
      if (k === 'type' || k === 'line') continue;
      const v = n[k];
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(node);
}
