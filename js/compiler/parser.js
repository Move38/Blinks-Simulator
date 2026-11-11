/*
 * Recursive-descent parser for the C++ subset used in Blinks sketches.
 *
 * AST overview (every node has `kind` and `line`):
 *   Program      { items: [FuncDef | VarDecl | TypeDecl] }
 *   FuncDef      { name, cls, type: fn-type, params: [{name,type,def}], body: Block|null, isStatic, inits }
 *   VarDecl      { decls: [{ name, type, init, line }], isStatic, isConst, isExtern }
 *   TypeDecl     { type }                       (struct/enum/typedef definitions)
 *   Block        { body: [stmt] }
 *   If           { cond, then, else }
 *   For          { init: VarDecl|ExprStmt|null, cond, step, body }
 *   RangeFor     { decl: {name,type}, iter, body }
 *   While        { cond, body }      DoWhile { body, cond }
 *   Switch       { disc, body: Block }   Case { test }   Default {}
 *   Break, Continue, Return { arg }, ExprStmt { expr }, Empty
 *   Expressions: Num { value, isFloat, unsigned, long, raw }, Str { bytes }, Char { value },
 *     Bool { value }, Ident { name }, Binary { op, l, r }, Logical { op, l, r },
 *     Assign { op, target, value }, Unary { op, arg }, Postfix { op, arg },
 *     Cond { test, cons, alt }, Call { callee, args }, Index { obj, index },
 *     Member { obj, prop, arrow }, Cast { type, arg }, Construct { type, args },
 *     SizeofType { type }, SizeofExpr { arg }, Comma { exprs }, InitList { items }, This {}
 */

import { CompileError } from './lexer.js';
import { T, ptr, ref, arr, fn, builtinTypeNames } from './types.js';

const BASE_KW = new Set(['void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', 'bool', '_Bool', 'auto']);
const QUAL_KW = new Set(['const', 'volatile', 'static', 'extern', 'inline', 'register', 'constexpr', 'typedef', 'mutable', 'virtual', 'explicit', 'friend']);

export function parse(tokens, opts = {}) {
  return new Parser(tokens, opts).parseProgram();
}

class Parser {
  constructor(tokens, opts) {
    this.toks = tokens;
    this.i = 0;
    this.types = builtinTypeNames();
    this.structs = new Map();   // struct tag -> type
    this.opts = opts;
    this.classStack = [];
  }

  // ---------- token helpers ----------
  get tok() { return this.toks[this.i]; }
  peek(k = 1) { return this.toks[Math.min(this.i + k, this.toks.length - 1)]; }
  is(v, tk = this.tok) { return tk.t === 'op' ? tk.v === v : (tk.t === 'id' && tk.v === v); }
  isOp(v, tk = this.tok) { return tk.t === 'op' && tk.v === v; }
  next() { const t = this.tok; if (this.i < this.toks.length - 1) this.i++; return t; }
  accept(v) { if (this.is(v)) { return this.next(); } return null; }
  expect(v, what) {
    if (this.is(v)) return this.next();
    const t = this.tok;
    const got = t.t === 'eof' ? 'end of file' : `'${t.t === 'str' ? t.raw : t.v}'`;
    if (v === ';' || v === ')' || v === '}' || v === ']') throw new CompileError(`Missing '${v}'${what ? ' ' + what : ''}`, this.errLine(v), t.col);
    throw new CompileError(`Expected '${v}'${what ? ' ' + what : ''} but found ${got}`, this.errLine(v), t.col);
  }
  // A missing ';' is reported on the line of the previous token, which is where people look
  errLine(v) {
    if ((v === ';' || v === ')') && this.i > 0) return this.toks[this.i - 1].line;
    return this.tok.line;
  }
  err(msg, tk = this.tok) { return new CompileError(msg, tk.line, tk.col); }
  ident(what) {
    const t = this.tok;
    if (t.t !== 'id') throw this.err(`Expected ${what || 'a name'} but found '${t.t === 'eof' ? 'end of file' : t.v}'`);
    this.next();
    return t.v;
  }

  isTypeName(tk = this.tok) {
    if (tk.t !== 'id') return false;
    return BASE_KW.has(tk.v) || this.types.has(tk.v) || tk.v === 'struct' || tk.v === 'union' || tk.v === 'enum' || tk.v === 'class';
  }
  isDeclStart(tk = this.tok) {
    if (tk.t !== 'id') return false;
    return this.isTypeName(tk) || QUAL_KW.has(tk.v) || tk.v === '__attribute__';
  }

  skipAttributes() {
    while (this.is('__attribute__')) {
      this.next(); this.expect('('); let d = 1;
      while (d > 0 && this.tok.t !== 'eof') { if (this.isOp('(')) d++; if (this.isOp(')')) d--; this.next(); }
    }
  }

  // ---------- program ----------
  parseProgram() {
    const items = [];
    while (this.tok.t !== 'eof') {
      const before = this.i;
      this.parseTopLevel(items);
      if (this.i === before) throw this.err(`Unexpected '${this.tok.v}'`);
    }
    return { kind: 'Program', items, line: 1 };
  }

  parseTopLevel(items) {
    if (this.accept(';')) return;
    const line = this.tok.line;
    if (this.is('namespace')) {
      this.next();
      if (this.tok.t === 'id') this.next();
      this.expect('{');
      while (!this.isOp('}') && this.tok.t !== 'eof') this.parseTopLevel(items);
      this.expect('}');
      return;
    }
    if (this.is('using')) { while (!this.isOp(';') && this.tok.t !== 'eof') this.next(); this.next(); return; }
    if (this.is('template')) throw this.err('Templates are not supported in the simulator');
    if (this.is('extern') && this.peek().t === 'str') { this.next(); this.next(); if (this.accept('{')) { while (!this.isOp('}')) this.parseTopLevel(items); this.expect('}'); } return; }

    let spec = this.parseDeclSpec();
    if (!spec && this.tok.t === 'id' && this.isOp('::', this.peek())) spec = { type: T.void }; // Foo::Foo() constructor
    if (!spec) throw this.err(`Expected a declaration but found '${this.tok.t === 'eof' ? 'end of file' : this.tok.v}'`);
    if (spec.defined && this.isOp(';')) { this.next(); items.push({ kind: 'TypeDecl', type: spec.type, line }); return; }
    if (spec.isTypedef) { this.parseTypedefRest(spec, line); items.push({ kind: 'TypeDecl', type: spec.type, line }); return; }
    if (spec.defined) items.push({ kind: 'TypeDecl', type: spec.type, line });

    // constructor / method defined outside a class:  Foo::Foo(...)  or  void Foo::bar(...)
    const d = this.parseDeclarator(spec.type, { allowQualified: true });
    this.skipAttributes();
    if (d.type.k === 'fn' && (this.isOp('{') || this.isOp(':') || this.isOp(';') || this.is('const'))) {
      this.accept('const');
      items.push(this.parseFunctionRest(d, spec, line));
      return;
    }
    items.push(this.parseVarDeclRest(spec, d, line));
  }

  parseTypedefRest(spec, line) {
    do {
      const d = this.parseDeclarator(spec.type);
      if (!d.name) throw this.err('typedef needs a name');
      this.types.set(d.name, d.type);
      if (d.type.k === 'struct' && !d.type.def.name) d.type.def.name = d.name;
      if (d.type.k === 'enum' && !d.type.name) d.type.name = d.name;
    } while (this.accept(','));
    this.expect(';', 'after typedef');
  }

  parseFunctionRest(d, spec, line) {
    const fnType = d.type;
    let cls = null, name = d.name;
    if (d.qual) { cls = d.qual; }
    else if (this.classStack.length) cls = this.classStack[this.classStack.length - 1].def.name;
    const node = { kind: 'FuncDef', name, cls, type: fnType, params: fnType.params, body: null, isStatic: spec.isStatic, line, inits: null, isCtor: !!d.isCtor };
    if (this.accept(':')) {
      // constructor member initializer list
      node.inits = [];
      do {
        const mline = this.tok.line;
        const mname = this.ident('a member name');
        let args;
        if (this.accept('{')) { args = this.parseArgsUntil('}'); }
        else { this.expect('('); args = this.parseArgsUntil(')'); }
        node.inits.push({ name: mname, args, line: mline });
      } while (this.accept(','));
    }
    if (this.accept(';')) return node; // prototype
    node.body = this.parseBlock();
    return node;
  }

  parseArgsUntil(close) {
    const args = [];
    if (!this.isOp(close)) {
      do { args.push(this.parseAssign()); } while (this.accept(','));
    }
    this.expect(close);
    return args;
  }

  parseVarDeclRest(spec, first, line) {
    const decls = [];
    let d = first;
    for (;;) {
      if (!d.name) throw this.err('Expected a variable name');
      let init = null, ctorArgs = null;
      this.skipAttributes();
      if (this.accept('=')) init = this.parseInitializer();
      else if (this.isOp('(') ) { this.next(); ctorArgs = this.parseArgsUntil(')'); }
      else if (this.isOp('{') && d.type.k !== 'fn') { init = this.parseInitializer(); }
      decls.push({ name: d.name, type: d.type, init, ctorArgs, line: d.line || line });
      if (this.types.has(d.name)) this.types.delete(d.name); // `state state;` — the variable hides the type
      if (!this.accept(',')) break;
      d = this.parseDeclarator(spec.type);
    }
    this.expect(';', 'at the end of this line');
    return { kind: 'VarDecl', decls, isStatic: spec.isStatic, isConst: spec.isConst, isExtern: spec.isExtern, line };
  }

  parseInitializer() {
    if (this.isOp('{')) {
      const line = this.next().line;
      const items = [];
      while (!this.isOp('}')) {
        if (this.isOp('.') && this.peek().t === 'id' && this.isOp('=', this.peek(2))) {
          this.next(); const field = this.ident(); this.next();
          const v = this.parseInitializer(); v.designator = field; items.push(v);
        } else items.push(this.parseInitializer());
        if (!this.accept(',')) break;
      }
      this.expect('}', 'to close the initializer list');
      return { kind: 'InitList', items, line };
    }
    return this.parseAssign();
  }

  // ---------- types ----------
  // Returns { type, isStatic, isConst, isTypedef, isExtern, defined } or null
  parseDeclSpec() {
    const start = this.i;
    let isStatic = false, isConst = false, isTypedef = false, isExtern = false;
    let unsigned = null, longs = 0, short = false, base = null, named = null, defined = false;
    for (;;) {
      const t = this.tok;
      if (t.t !== 'id') break;
      const v = t.v;
      if (v === '__attribute__') { this.skipAttributes(); continue; }
      if (QUAL_KW.has(v)) {
        this.next();
        if (v === 'static') isStatic = true;
        else if (v === 'const' || v === 'constexpr') isConst = true;
        else if (v === 'typedef') isTypedef = true;
        else if (v === 'extern') isExtern = true;
        continue;
      }
      if (named || base === 'struct') break;
      if (v === 'unsigned') { unsigned = true; this.next(); continue; }
      if (v === 'signed') { unsigned = false; this.next(); continue; }
      if (v === 'long') { longs++; this.next(); continue; }
      if (v === 'short') { short = true; this.next(); continue; }
      if (v === 'int' || v === 'char' || v === 'void' || v === 'float' || v === 'double' || v === 'bool' || v === '_Bool' || v === 'auto') {
        if (base) break;
        base = v; this.next(); continue;
      }
      if (v === 'struct' || v === 'union' || v === 'class') {
        if (base || named) break;
        named = this.parseStructSpec(); defined = named.justDefined; delete named.justDefined; continue;
      }
      if (v === 'enum') {
        if (base || named) break;
        named = this.parseEnumSpec(); defined = named.justDefined; delete named.justDefined; continue;
      }
      if (!base && unsigned === null && !longs && !short && this.types.has(v)) {
        // A name followed by '(' or '::' might be a constructor/method definition rather than a type
        if (this.classStack.length && v === this.classStack[this.classStack.length - 1].def.name && this.isOp('(', this.peek())) break;
        if (this.isOp('::', this.peek()) && this.types.has(v) && this.peek(2).t === 'id' && this.peek(2).v === v) break;
        named = this.types.get(v); this.next(); continue;
      }
      break;
    }
    let type;
    if (named) type = named;
    else if (base || unsigned !== null || longs || short) {
      if (base === 'void') type = T.void;
      else if (base === 'auto') type = { k: 'auto' };
      else if (base === 'bool' || base === '_Bool') type = T.bool;
      else if (base === 'float' || base === 'double') type = T.float;
      else if (base === 'char') type = unsigned === true ? T.u8 : unsigned === false ? T.i8 : T.char;
      else if (longs >= 2) type = unsigned ? { ...T.u32, name: 'unsigned long long', wide: true } : { ...T.i32, name: 'long long', wide: true };
      else if (longs === 1) type = unsigned ? T.u32 : T.i32;
      else type = unsigned ? T.u16 : T.i16;
    } else {
      if (this.i !== start && (isStatic || isConst)) {
        // e.g. "const x = 5;" -> implicit int is not valid C++
        throw this.err(`Missing type before '${this.tok.v}'`);
      }
      this.i = start;
      return null;
    }
    return { type, isStatic, isConst, isTypedef, isExtern, defined };
  }

  parseStructSpec() {
    const kw = this.next().v;
    this.skipAttributes();
    let tag = null;
    if (this.tok.t === 'id' && !this.isOp('{', this.tok)) tag = this.next().v;
    let type = tag ? (this.structs.get(tag) || null) : null;
    if (!type) {
      type = { k: 'struct', name: tag, def: { name: tag, kind: kw, members: [], methods: new Map(), size: null, complete: false, line: this.tok.line } };
      if (tag) { this.structs.set(tag, type); this.types.set(tag, type); }
    }
    let justDefined = false;
    if (this.isOp('{') || this.isOp(':')) {
      if (this.accept(':')) throw this.err('Class inheritance is not supported in the simulator');
      this.next();
      this.parseStructBody(type, kw);
      this.expect('}', `to close ${kw} ${tag || ''}`);
      type.def.complete = true;
      justDefined = true;
    }
    return Object.assign(Object.create(null), type, { justDefined });
  }

  parseStructBody(type, kw) {
    const def = type.def;
    this.classStack.push(type);
    let access = kw === 'class' ? 'private' : 'public';
    while (!this.isOp('}') && this.tok.t !== 'eof') {
      if (this.accept(';')) continue;
      if ((this.is('public') || this.is('private') || this.is('protected')) && this.isOp(':', this.peek())) { access = this.next().v; this.next(); continue; }
      const line = this.tok.line;
      // constructor
      if (this.tok.t === 'id' && this.tok.v === def.name && this.isOp('(', this.peek())) {
        const nm = this.next().v;
        const params = this.parseParams();
        const d = { name: nm, type: fn(T.void, params.params, params.variadic), isCtor: true, line };
        const f = this.parseFunctionRest(d, { isStatic: false }, line);
        f.cls = def.name; f.isCtor = true;
        def.methods.set('#ctor' + (def.ctorCount = (def.ctorCount || 0) + 1), f);
        continue;
      }
      if (this.is('~')) throw this.err('Destructors are not supported in the simulator');
      if ((this.is('union') || this.is('struct')) && this.isOp('{', this.peek())) {
        // anonymous member union/struct: its fields belong to the parent
        const inner = this.parseStructSpec();
        if (this.tok.t === 'id') {
          const nm = this.next().v;
          def.members.push({ name: nm, type: inner, access, line });
        } else def.members.push({ name: null, anon: true, type: inner, access, line });
        this.expect(';');
        continue;
      }
      const spec = this.parseDeclSpec();
      if (!spec) throw this.err(`Unexpected '${this.tok.v}' in ${kw}`);
      if (spec.isTypedef) { this.parseTypedefRest(spec, line); continue; }
      if (spec.defined && this.accept(';')) continue;
      do {
        const d = this.parseDeclarator(spec.type);
        if (d.type.k === 'fn') {
          this.accept('const');
          const f = this.parseFunctionRest(d, spec, line);
          f.cls = def.name;
          def.methods.set(d.name, f);
          if (f.body) break;
          continue;
        }
        let bits = null;
        if (this.accept(':')) bits = this.parseCondExpr();
        let init = null;
        if (this.accept('=')) init = this.parseInitializer();
        if (spec.isStatic) throw this.err('Static class members are not supported in the simulator');
        def.members.push({ name: d.name, type: d.type, bitsExpr: bits, init, access, line });
      } while (this.accept(','));
      if (this.isOp(';')) this.next();
    }
    this.classStack.pop();
  }

  parseEnumSpec() {
    this.next();
    let scoped = false;
    if (this.is('class') || this.is('struct')) { this.next(); scoped = true; }
    let tag = null;
    if (this.tok.t === 'id') tag = this.next().v;
    let base = T.i16;
    if (this.accept(':')) {
      const s = this.parseDeclSpec();
      if (!s) throw this.err('Expected the enum\'s underlying type');
      base = s.type;
    }
    let type = tag && this.types.get(tag);
    if (!type || type.k !== 'enum') {
      type = { k: 'enum', name: tag || 'enum', base, def: { items: [], scoped, tag } };
      if (tag) this.types.set(tag, type);
    }
    let justDefined = false;
    if (this.accept('{')) {
      while (!this.isOp('}')) {
        const line = this.tok.line;
        const name = this.ident('an enum value name');
        let value = null;
        if (this.accept('=')) value = this.parseCondExpr();
        type.def.items.push({ name, value, line });
        if (!this.accept(',')) break;
      }
      this.expect('}', 'to close the enum');
      justDefined = true;
    }
    return Object.assign({}, type, { justDefined });
  }

  // declarator: pointers, name, array and function suffixes, (*fnptr)(...)
  parseDeclarator(base, opts = {}) {
    let t = base;
    const line = this.tok.line;
    while (this.isOp('*') || this.isOp('&') || this.isOp('&&')) {
      const op = this.next().v;
      t = op === '*' ? ptr(t) : ref(t);
      while (this.is('const') || this.is('volatile')) this.next();
    }
    if (this.isOp('(') && (this.isOp('*', this.peek()) || this.isOp('&', this.peek()))) {
      this.next();
      const hole = { k: 'hole' };
      const inner = this.parseDeclarator(hole);
      this.expect(')');
      t = this.parseSuffixes(t);
      return { name: inner.name, type: substitute(inner.type, hole, t), line };
    }
    let name = null, qual = null, isCtor = false;
    if (this.tok.t === 'id' && !QUAL_KW.has(this.tok.v)) {
      name = this.next().v;
      while (opts.allowQualified && this.isOp('::')) {
        this.next();
        qual = name;
        if (this.isOp('~')) throw this.err('Destructors are not supported in the simulator');
        name = this.ident();
        if (name === qual) isCtor = true;
      }
    }
    t = this.parseSuffixes(t);
    return { name, type: t, qual, isCtor, line };
  }

  parseSuffixes(t) {
    const sufs = [];
    for (;;) {
      if (this.isOp('[')) {
        this.next();
        let nExpr = null;
        if (!this.isOp(']')) nExpr = this.parseExpr();
        this.expect(']');
        sufs.push({ arr: true, nExpr });
      } else if (this.isOp('(')) {
        // function parameters, unless it looks like constructor arguments: `Box box(21);`
        const n = this.peek();
        if (!(this.isOp(')', n) || this.isDeclStart(n) || this.is('...', n))) break;
        const p = this.parseParams();
        sufs.push({ fn: true, params: p.params, variadic: p.variadic });
        while (this.is('const') || this.is('override') || this.is('noexcept')) this.next();
      } else break;
    }
    for (let k = sufs.length - 1; k >= 0; k--) {
      const s = sufs[k];
      t = s.arr ? arr(t, null, s.nExpr) : fn(t, s.params, s.variadic);
    }
    return t;
  }

  parseParams() {
    this.expect('(');
    const params = [];
    let variadic = false;
    if (this.is('void') && this.isOp(')', this.peek())) { this.next(); }
    while (!this.isOp(')')) {
      if (this.accept('...')) { variadic = true; break; }
      const line = this.tok.line;
      const spec = this.parseDeclSpec();
      if (!spec) throw this.err(`Expected a parameter type but found '${this.tok.v}'`);
      const d = this.parseDeclarator(spec.type);
      let def = null;
      if (this.accept('=')) def = this.parseAssign();
      params.push({ name: d.name, type: d.type, def, isConst: spec.isConst, line });
      if (!this.accept(',')) break;
    }
    this.expect(')', 'to close the parameter list');
    return { params, variadic };
  }

  // abstract type for casts / sizeof
  parseTypeName() {
    const spec = this.parseDeclSpec();
    if (!spec) return null;
    const d = this.parseDeclarator(spec.type);
    if (d.name) throw this.err('Unexpected name in type');
    return d.type;
  }

  // ---------- statements ----------
  parseBlock() {
    const line = this.expect('{').line;
    const body = [];
    while (!this.isOp('}')) {
      if (this.tok.t === 'eof') throw new CompileError("Missing '}' – a block was never closed", line);
      body.push(this.parseStatement());
    }
    const end = this.next().line;
    return { kind: 'Block', body, line, endLine: end };
  }

  parseStatement() {
    const t = this.tok;
    const line = t.line;
    if (t.t === 'op') {
      if (t.v === '{') return this.parseBlock();
      if (t.v === ';') { this.next(); return { kind: 'Empty', line }; }
    }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.next(); this.expect('(', "after 'if'");
          const cond = this.parseCondition();
          this.expect(')', 'to close the if condition');
          const then = this.parseStatement();
          let els = null;
          if (this.accept('else')) els = this.parseStatement();
          return { kind: 'If', cond, then, else: els, line };
        }
        case 'while': {
          this.next(); this.expect('(', "after 'while'");
          const cond = this.parseCondition();
          this.expect(')', 'to close the while condition');
          return { kind: 'While', cond, body: this.parseStatement(), line };
        }
        case 'do': {
          this.next();
          const body = this.parseStatement();
          this.expect('while', "after the do { } block");
          this.expect('(');
          const cond = this.parseExpr();
          this.expect(')');
          this.expect(';', 'after do-while');
          return { kind: 'DoWhile', body, cond, line };
        }
        case 'for': {
          this.next(); this.expect('(', "after 'for'");
          let init = null;
          if (!this.isOp(';')) {
            if (this.isDeclStart()) {
              const spec = this.parseDeclSpec();
              const d = this.parseDeclarator(spec.type);
              if (this.accept(':')) {
                const iter = this.parseExpr();
                this.expect(')');
                return { kind: 'RangeFor', decl: { name: d.name, type: d.type }, iter, body: this.parseStatement(), line };
              }
              init = this.parseVarDeclRest(spec, d, line);
            } else {
              init = { kind: 'ExprStmt', expr: this.parseExpr(), line };
              this.expect(';', 'in for loop');
            }
          } else this.next();
          const cond = this.isOp(';') ? null : this.parseExpr();
          this.expect(';', 'in for loop');
          const step = this.isOp(')') ? null : this.parseExpr();
          this.expect(')', 'to close the for loop');
          return { kind: 'For', init, cond, step, body: this.parseStatement(), line };
        }
        case 'switch': {
          this.next(); this.expect('(');
          const disc = this.parseExpr();
          this.expect(')');
          const body = this.parseStatement();
          return { kind: 'Switch', disc, body, line };
        }
        case 'case': {
          this.next();
          const test = this.parseCondExpr();
          if (this.accept('...')) throw this.err('Case ranges are not supported');
          this.expect(':', 'after case value');
          return { kind: 'Case', test, line };
        }
        case 'default':
          if (this.isOp(':', this.peek())) { this.next(); this.next(); return { kind: 'Default', line }; }
          break;
        case 'break': this.next(); this.expect(';', "after 'break'"); return { kind: 'Break', line };
        case 'continue': this.next(); this.expect(';', "after 'continue'"); return { kind: 'Continue', line };
        case 'return': {
          this.next();
          const arg = this.isOp(';') ? null : this.parseExpr();
          this.expect(';', 'after return');
          return { kind: 'Return', arg, line };
        }
        case 'goto': throw this.err('goto is not supported in the simulator');
        case 'typedef': {
          const spec = this.parseDeclSpec();
          this.parseTypedefRest(spec, line);
          return { kind: 'TypeDecl', type: spec.type, line };
        }
      }
      if (this.isDeclStart() && !this.looksLikeExpression()) {
        const spec = this.parseDeclSpec();
        if (spec) {
          if (spec.defined && this.accept(';')) return { kind: 'TypeDecl', type: spec.type, line };
          const d = this.parseDeclarator(spec.type);
          return this.parseVarDeclRest(spec, d, line);
        }
      }
    }
    const expr = this.parseExpr();
    this.expect(';', 'at the end of this line');
    return { kind: 'ExprStmt', expr, line };
  }

  // `byte(x)`, `Color(1,2,3)`, `Timer::foo` etc. start with a type name but are expressions
  looksLikeExpression() {
    const t = this.tok, n = this.peek();
    if (!this.types.has(t.v) && !BASE_KW.has(t.v)) return false;
    if (n.t === 'op' && (n.v === '(' || n.v === '::' || n.v === '.' || n.v === '{')) {
      if (n.v === '(' && this.isOp('*', this.peek(2))) return false; // function pointer declaration
      return true;
    }
    return false;
  }

  parseCondition() {
    // allow "if (byte x = ...)" style declarations? rare; just an expression
    return this.parseExpr();
  }

  // ---------- expressions ----------
  parseExpr() {
    const line = this.tok.line;
    const e = this.parseAssign();
    if (this.isOp(',')) {
      const exprs = [e];
      while (this.accept(',')) exprs.push(this.parseAssign());
      return { kind: 'Comma', exprs, line };
    }
    return e;
  }

  parseAssign() {
    const line = this.tok.line;
    const lhs = this.parseCondExpr();
    const t = this.tok;
    if (t.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.v)) {
      this.next();
      const value = this.isOp('{') ? this.parseInitializer() : this.parseAssign();
      return { kind: 'Assign', op: t.v, target: lhs, value, line };
    }
    return lhs;
  }

  parseCondExpr() {
    const line = this.tok.line;
    const test = this.parseBinary(1);
    if (this.accept('?')) {
      const cons = this.parseExpr();
      this.expect(':', "in ?: expression");
      const alt = this.parseAssign();
      return { kind: 'Cond', test, cons, alt, line };
    }
    return test;
  }

  parseBinary(minPrec) {
    let left = this.parseUnary();
    for (;;) {
      const t = this.tok;
      if (t.t !== 'op') break;
      const p = PREC[t.v];
      if (!p || p < minPrec) break;
      this.next();
      const right = this.parseBinary(p + 1);
      const kind = t.v === '&&' || t.v === '||' ? 'Logical' : 'Binary';
      left = { kind, op: t.v, l: left, r: right, line: t.line };
    }
    return left;
  }

  parseUnary() {
    const t = this.tok;
    const line = t.line;
    if (t.t === 'op') {
      if (['-', '+', '!', '~', '*', '&', '++', '--'].includes(t.v)) {
        this.next();
        return { kind: 'Unary', op: t.v, arg: this.parseUnary(), line };
      }
      if (t.v === '(') {
        // cast?
        const save = this.i;
        this.next();
        if ((this.isTypeName() || this.is('const') || this.is('volatile')) && !this.looksLikeFunctionalCastInParens()) {
          const type = this.parseTypeName();
          if (type && this.isOp(')')) {
            this.next();
            if (this.isOp('{')) {
              const init = this.parseInitializer();
              return { kind: 'Construct', type, args: [init], line };
            }
            return { kind: 'Cast', type, arg: this.parseUnary(), line };
          }
        }
        this.i = save;
      }
    }
    if (t.t === 'id') {
      if (t.v === 'sizeof') {
        this.next();
        if (this.isOp('(')) {
          const save = this.i;
          this.next();
          if (this.isTypeName()) {
            const type = this.parseTypeName();
            if (type && this.accept(')')) return { kind: 'SizeofType', type, line };
          }
          this.i = save;
        }
        return { kind: 'SizeofExpr', arg: this.parseUnary(), line };
      }
      if (t.v === 'new' || t.v === 'delete') throw this.err(`'${t.v}' is not available on Blinks (there is no heap). Use a global variable or array instead.`);
    }
    return this.parsePostfix(this.parsePrimary());
  }

  looksLikeFunctionalCastInParens() {
    // "(byte(x) + 1)" — a type name followed by '(' inside parens is an expression
    const n = this.peek();
    return n.t === 'op' && (n.v === '(' || n.v === '::' || n.v === '.');
  }

  parsePostfix(e) {
    for (;;) {
      const t = this.tok;
      if (t.t !== 'op') break;
      if (t.v === '(') {
        this.next();
        const args = this.parseArgsUntil(')');
        e = { kind: 'Call', callee: e, args, line: t.line };
      } else if (t.v === '[') {
        this.next();
        const index = this.parseExpr();
        this.expect(']');
        e = { kind: 'Index', obj: e, index, line: t.line };
      } else if (t.v === '.' || t.v === '->') {
        this.next();
        const prop = this.ident('a member name');
        e = { kind: 'Member', obj: e, prop, arrow: t.v === '->', line: t.line };
      } else if (t.v === '++' || t.v === '--') {
        this.next();
        e = { kind: 'Postfix', op: t.v, arg: e, line: t.line };
      } else break;
    }
    return e;
  }

  parsePrimary() {
    const t = this.tok;
    const line = t.line;
    switch (t.t) {
      case 'num': this.next(); return parseNumber(t);
      case 'char': this.next(); return { kind: 'Char', value: t.v, line, raw: t.raw };
      case 'str': {
        this.next();
        let bytes = t.v.slice();
        while (this.tok.t === 'str') bytes = bytes.concat(this.next().v);
        return { kind: 'Str', bytes, line };
      }
      case 'id': {
        const v = t.v;
        if (v === 'true' || v === 'false') { this.next(); return { kind: 'Bool', value: v === 'true', line }; }
        if (v === 'nullptr') { this.next(); return { kind: 'Num', value: 0, raw: '0', isNull: true, line }; }
        if (v === 'this') { this.next(); return { kind: 'This', line }; }
        // functional cast / construction: byte(x), Color(r,g,b), Timer()
        if ((this.types.has(v) || BASE_KW.has(v)) && v !== 'auto') {
          const save = this.i;
          const spec = this.parseDeclSpec();
          if (spec && (this.isOp('(') || this.isOp('{'))) {
            const close = this.isOp('(') ? ')' : '}';
            this.next();
            const args = this.parseArgsUntil(close);
            return { kind: 'Construct', type: spec.type, args, line };
          }
          if (spec && spec.type.k === 'enum' && this.isOp('::')) {
            this.next();
            const name = this.ident();
            return { kind: 'Ident', name: (spec.type.name) + '::' + name, line };
          }
          this.i = save;
          if (this.isOp('::', this.peek())) {
            this.next(); this.next();
            const name = this.ident();
            return { kind: 'Ident', name: v + '::' + name, line };
          }
          throw this.err(`'${v}' is a type; expected a value here`);
        }
        this.next();
        let name = v;
        while (this.isOp('::') && this.peek().t === 'id') { this.next(); name += '::' + this.next().v; }
        return { kind: 'Ident', name, line };
      }
      case 'op':
        if (t.v === '(') {
          this.next();
          const e = this.parseExpr();
          this.expect(')');
          return { kind: 'Paren', expr: e, line };
        }
        if (t.v === '::') { this.next(); return this.parsePrimary(); }
        if (t.v === '{') return this.parseInitializer();
        break;
      case 'eof':
        throw this.err('Unexpected end of file – is a } or ; missing?');
    }
    throw this.err(`Unexpected '${t.v}'`);
  }
}

const PREC = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};

function substitute(t, hole, with_) {
  if (t === hole) return with_;
  switch (t.k) {
    case 'ptr': return ptr(substitute(t.to, hole, with_));
    case 'ref': return ref(substitute(t.to, hole, with_));
    case 'arr': return arr(substitute(t.of, hole, with_), t.n, t.nExpr);
    case 'fn': return fn(substitute(t.ret, hole, with_), t.params, t.variadic);
    default: return t;
  }
}

export function parseNumber(t) {
  let raw = t.v.replace(/'/g, '');
  const line = t.line;
  const hexLike = /^0[xX]/.test(raw);
  const m = hexLike ? /^(0[xX][0-9a-fA-F]+)([uUlL]*)$/.exec(raw) : /^([0-9a-fA-FxXbB.eE+-]+?)([uUlLfF]*)$/.exec(raw);
  let body = m ? m[1] : raw, suf = (m ? m[2] : '').toLowerCase();
  const isHex = /^0[xX]/.test(body), isBin = /^0[bB]/.test(body);
  const isFloat = !isHex && !isBin && (/[.eE]/.test(body) || (suf.includes('f') && !isHex));
  if (isFloat) {
    return { kind: 'Num', value: parseFloat(body), isFloat: true, raw: t.v, line };
  }
  let value;
  if (isHex) value = parseInt(body.slice(2), 16);
  else if (isBin) value = parseInt(body.slice(2), 2);
  else if (body.length > 1 && body[0] === '0') value = parseInt(body, 8);
  else value = parseInt(body, 10);
  if (Number.isNaN(value)) throw new CompileError(`Bad number '${t.v}'`, line);
  return { kind: 'Num', value, isFloat: false, unsigned: suf.includes('u'), long: suf.includes('l'), decimal: !isHex && !isBin && !(body.length > 1 && body[0] === '0'), raw: t.v, line };
}
