/*
 * C preprocessor: #define (object and function-like), #undef, #if/#ifdef/#ifndef/#elif/#else/#endif,
 * #include (system headers are built in), #pragma/#error/#warning.
 *
 * The built-in macros below are copied from the Blinks SDK's Arduino.h and blinklib.h,
 * so macros like min(), abs() and FOREACH_FACE() expand exactly as they do on hardware.
 */

import { tokenize, CompileError, tokenText } from './lexer.js';

export const PRELUDE = `
#define __AVR__ 1
#define ARDUINO 10813
#define NULL 0
#define CHAR_BIT 8
#define SCHAR_MIN (-128)
#define SCHAR_MAX 127
#define UCHAR_MAX 255
#define CHAR_MIN (-128)
#define CHAR_MAX 127
#define INT_MAX 32767
#define INT_MIN (-INT_MAX - 1)
#define UINT_MAX 65535U
#define SHRT_MAX 32767
#define SHRT_MIN (-32768)
#define USHRT_MAX 65535U
#define LONG_MAX 2147483647L
#define LONG_MIN (-LONG_MAX - 1L)
#define ULONG_MAX 4294967295UL
#define UINT8_MAX 255
#define INT8_MAX 127
#define INT8_MIN (-128)
#define UINT16_MAX 65535U
#define INT16_MAX 32767
#define INT16_MIN (-32768)
#define UINT32_MAX 4294967295UL
#define INT32_MAX 2147483647L
#define INT32_MIN (-2147483647L - 1)

#define HIGH 0x1
#define LOW  0x0
#define PI 3.1415926535897932384626433832795
#define HALF_PI 1.5707963267948966192313216916398
#define TWO_PI 6.283185307179586476925286766559
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105
#define EULER 2.718281828459045235360287471352
#define LSBFIRST 0
#define MSBFIRST 1
#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2
#define min(a,b) ((a)<(b)?(a):(b))
#define max(a,b) ((a)>(b)?(a):(b))
#define abs(x) ((x)>0?(x):-(x))
#define constrain(amt,low,high) ((amt)<(low)?(low):((amt)>(high)?(high):(amt)))
#define round(x)     ((x)>=0?(long)((x)+0.5):(long)((x)-0.5))
#define radians(deg) ((deg)*DEG_TO_RAD)
#define degrees(rad) ((rad)*RAD_TO_DEG)
#define sq(x) ((x)*(x))
#define lowByte(w) ((uint8_t) ((w) & 0xff))
#define highByte(w) ((uint8_t) ((w) >> 8))
#define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#define bitSet(value, bit) ((value) |= (1UL << (bit)))
#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#define bitWrite(value, bit, bitvalue) (bitvalue ? bitSet(value, bit) : bitClear(value, bit))
#define bit(b) (1UL << (b))

#define PROGMEM
#define F(s) (s)
#define PSTR(s) (s)
#define pgm_read_byte(addr) (*(const uint8_t *)(addr))
#define pgm_read_byte_near(addr) (*(const uint8_t *)(addr))
#define pgm_read_word(addr) (*(const uint16_t *)(addr))
#define pgm_read_word_near(addr) (*(const uint16_t *)(addr))
#define pgm_read_dword(addr) (*(const uint32_t *)(addr))
#define memcpy_P memcpy

#define FACE_COUNT 6
#define IR_DATA_VALUE_MAX 63
#define IR_DATAGRAM_LEN 16
#define BRIGHTNESS_LEVELS_5BIT 32
#define MAX_BRIGHTNESS_5BIT    (BRIGHTNESS_LEVELS_5BIT-1)
#define MAKECOLOR_5BIT_RGB(r,g,b) (pixelColor_t(r,g,b,1))
#define RED         MAKECOLOR_5BIT_RGB(MAX_BRIGHTNESS_5BIT, 0                    ,0)
#define ORANGE      MAKECOLOR_5BIT_RGB(MAX_BRIGHTNESS_5BIT,MAX_BRIGHTNESS_5BIT/2 ,0)
#define YELLOW      MAKECOLOR_5BIT_RGB(MAX_BRIGHTNESS_5BIT,MAX_BRIGHTNESS_5BIT   ,0)
#define GREEN       MAKECOLOR_5BIT_RGB( 0                 ,MAX_BRIGHTNESS_5BIT   ,0)
#define CYAN        MAKECOLOR_5BIT_RGB( 0                 ,MAX_BRIGHTNESS_5BIT   ,MAX_BRIGHTNESS_5BIT)
#define BLUE        MAKECOLOR_5BIT_RGB( 0                 , 0                    ,MAX_BRIGHTNESS_5BIT)
#define MAGENTA     MAKECOLOR_5BIT_RGB(MAX_BRIGHTNESS_5BIT, 0                    ,MAX_BRIGHTNESS_5BIT)
#define WHITE       MAKECOLOR_5BIT_RGB(MAX_BRIGHTNESS_5BIT,MAX_BRIGHTNESS_5BIT   ,MAX_BRIGHTNESS_5BIT)
#define OFF         MAKECOLOR_5BIT_RGB( 0                 , 0                    , 0)
#define GET_5BIT_R(color) (color.r)
#define GET_5BIT_G(color) (color.g)
#define GET_5BIT_B(color) (color.b)
#define MAX_BRIGHTNESS (255)
#define SERIAL_NUMBER_LEN 9
#define START_STATE_POWER_UP            0
#define START_STATE_WE_ARE_ROOT         1
#define START_STATE_DOWNLOAD_SUCCESS    2
#define FOREACH_FACE(x) for(uint8_t x = 0; x < FACE_COUNT ; ++ x)
#define COUNT_OF(x) ((sizeof(x)/sizeof(x[0])))
`;

// Headers that are part of the Blinks platform or avr-libc. Their contents are built in.
const SYSTEM_HEADERS = new Set([
  'Arduino.h', 'blinklib.h', 'blinkstate.h', 'Serial.h', 'ArduinoTypes.h', 'Timer.h', 'shared/blinkbios_shared_pixel.h',
  'avr/pgmspace.h', 'avr/io.h', 'avr/interrupt.h', 'avr/sleep.h', 'avr/wdt.h', 'util/delay.h',
  'string.h', 'stdint.h', 'stdlib.h', 'stddef.h', 'stdbool.h', 'math.h', 'limits.h', 'stdio.h', 'inttypes.h',
]);

let PRELUDE_DEFS = null;

class Macro {
  constructor(name, params, body, variadic) {
    this.name = name; this.params = params; this.body = body; this.variadic = variadic;
  }
}

function splitLines(tokens) {
  // groups tokens by logical line for directive processing
  const lines = [];
  let cur = null;
  for (const t of tokens) {
    if (t.t === 'eof') break;
    if (t.bol || !cur) { cur = []; lines.push(cur); }
    cur.push(t);
  }
  return lines;
}

export function preprocess(src, opts = {}) {
  if (!PRELUDE_DEFS) {
    PRELUDE_DEFS = new Map();
    const pre = new Preprocessor(PRELUDE_DEFS, opts);
    pre.run(tokenize(PRELUDE).tokens);
  }
  const defs = new Map(PRELUDE_DEFS);
  const lex = tokenize(src);
  const pp = new Preprocessor(defs, opts);
  const out = pp.run(lex.tokens);
  return { tokens: out, comments: lex.comments, defines: pp.userDefines, warnings: pp.warnings };
}

class Preprocessor {
  constructor(defs, opts) {
    this.defs = defs;
    this.opts = opts;
    this.userDefines = [];
    this.warnings = [];
  }

  run(tokens) {
    const lines = splitLines(tokens);
    const out = [];
    // condition stack entries: { active, taken, parentActive }
    const cond = [];
    const active = () => cond.length === 0 || cond[cond.length - 1].active;
    let pending = [];
    const flush = () => { if (pending.length) { this.expand(pending, out); pending = []; } };

    for (const ln of lines) {
      if (ln[0].t === 'op' && ln[0].v === '#') {
        const d = ln[1];
        const name = d ? (d.t === 'id' ? d.v : String(d.v)) : '';
        const rest = ln.slice(2);
        const line = ln[0].line;
        if (name === 'ifdef' || name === 'ifndef') {
          if (!rest[0] || rest[0].t !== 'id') throw new CompileError(`#${name} needs a name`, line);
          const pa = active();
          const v = this.defs.has(rest[0].v) === (name === 'ifdef');
          cond.push({ active: pa && v, taken: v, parentActive: pa });
          continue;
        }
        if (name === 'if') {
          const pa = active();
          const v = pa ? this.evalCond(rest, line) : false;
          cond.push({ active: pa && v, taken: v, parentActive: pa });
          continue;
        }
        if (name === 'elif') {
          const c = cond[cond.length - 1];
          if (!c) throw new CompileError('#elif without #if', line);
          if (c.taken) { c.active = false; continue; }
          const v = c.parentActive ? this.evalCond(rest, line) : false;
          c.active = c.parentActive && v; c.taken = v;
          continue;
        }
        if (name === 'else') {
          const c = cond[cond.length - 1];
          if (!c) throw new CompileError('#else without #if', line);
          c.active = c.parentActive && !c.taken; c.taken = true;
          continue;
        }
        if (name === 'endif') {
          if (!cond.length) throw new CompileError('#endif without #if', line);
          cond.pop();
          continue;
        }
        if (!active()) continue;
        flush();
        if (name === 'define') this.define(rest, line);
        else if (name === 'undef') { if (rest[0]) this.defs.delete(rest[0].v); }
        else if (name === 'include') { const inc = this.include(rest, line); if (inc) out.push(...inc); }
        else if (name === 'error') throw new CompileError('#error ' + rest.map(tokenText).join(' '), line);
        else if (name === 'warning') this.warnings.push({ line, message: rest.map(tokenText).join(' ') });
        else if (name === 'pragma' || name === '' || name === 'line') { /* ignored */ }
        else throw new CompileError(`Unknown preprocessor directive #${name}`, line);
        continue;
      }
      if (!active()) continue;
      for (const t of ln) pending.push(t);
    }
    if (cond.length) throw new CompileError('Missing #endif', tokens[tokens.length - 1].line);
    flush();
    out.push(tokens[tokens.length - 1]);
    return out;
  }

  include(rest, line) {
    let name = '';
    if (rest[0] && rest[0].t === 'str') name = String.fromCharCode(...rest[0].v);
    else if (rest[0] && rest[0].t === 'op' && rest[0].v === '<') name = rest.slice(1, -1).map(tokenText).join('');
    if (SYSTEM_HEADERS.has(name) || name.startsWith('avr/') || name.startsWith('util/')) return;
    if (this.opts.files && name in this.opts.files) {
      // multi-file sketch: inline the header
      const lex = tokenize(this.opts.files[name]);
      const inner = new Preprocessor(this.defs, this.opts);
      const sub = inner.run(lex.tokens);
      sub.pop();
      for (const t of sub) t.line = line;
      return sub;
    }
    throw new CompileError(`Can't find "${name}". The simulator runs single-file sketches; paste the contents of ${name} into this sketch.`, line);
  }

  define(rest, line) {
    const nameTok = rest[0];
    if (!nameTok || nameTok.t !== 'id') throw new CompileError('#define needs a name', line);
    let params = null, variadic = false, i = 1;
    if (rest[1] && rest[1].t === 'op' && rest[1].v === '(' && !rest[1].space) {
      params = []; i = 2;
      while (i < rest.length && !(rest[i].t === 'op' && rest[i].v === ')')) {
        const p = rest[i];
        if (p.t === 'id') params.push(p.v);
        else if (p.t === 'op' && p.v === '...') { variadic = true; params.push('__VA_ARGS__'); }
        else if (!(p.t === 'op' && p.v === ',')) throw new CompileError('Bad macro parameter list', line);
        i++;
      }
      i++;
    }
    const body = rest.slice(i);
    this.defs.set(nameTok.v, new Macro(nameTok.v, params, body, variadic));
    if (this.defs !== PRELUDE_DEFS) this.userDefines.push({ name: nameTok.v, params, body, line });
  }

  evalCond(rest, line) {
    // replace defined(X) / defined X
    const toks = [];
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (t.t === 'id' && t.v === 'defined') {
        let nm;
        if (rest[i + 1] && rest[i + 1].v === '(') { nm = rest[i + 2]; i += 3; } else { nm = rest[i + 1]; i += 1; }
        toks.push({ t: 'num', v: this.defs.has(nm && nm.v) ? '1' : '0', line });
      } else toks.push(t);
    }
    const ex = [];
    this.expand(toks, ex);
    let js = '';
    for (const t of ex) {
      if (t.t === 'num') js += ' ' + parseInt(t.v.replace(/[uUlL]+$/, ''), t.v.startsWith('0x') || t.v.startsWith('0X') ? 16 : 10);
      else if (t.t === 'id') js += t.v === 'true' ? ' 1' : ' 0';
      else if (t.t === 'char') js += ' ' + t.v;
      else if (t.t === 'op' && /^(\|\||&&|==|!=|<=|>=|<<|>>|[-+*/%<>!~&|^?:()])$/.test(t.v)) js += ' ' + t.v;
      else if (t.t === 'eof') break;
      else throw new CompileError('Bad #if expression', line);
    }
    try { return !!Function('return (' + (js || '0') + ');')(); }
    catch (e) { throw new CompileError('Bad #if expression', line); }
  }

  // Macro expansion with a "hide set" per token to stop recursion.
  expand(input, out) {
    const toks = input.slice();
    let i = 0;
    while (i < toks.length) {
      const t = toks[i];
      // Arduino's binary.h: B0 to B11111111 are the numbers they spell in binary (B101 is 5)
      if (t.t === 'id' && /^B[01]{1,8}$/.test(t.v) && !this.defs.has(t.v) && !(t.hide && t.hide.has(t.v))) {
        out.push({ ...t, t: 'num', v: String(parseInt(t.v.slice(1), 2)), hide: new Set([...(t.hide || []), t.v]), fromMacro: t.v });
        i++;
        continue;
      }
      if (t.t !== 'id' || !this.defs.has(t.v) || (t.hide && t.hide.has(t.v))) { out.push(t); i++; continue; }
      const m = this.defs.get(t.v);
      const hide = new Set(t.hide || []); hide.add(m.name);
      if (m.params === null) {
        const body = m.body.map(b => ({ ...b, line: t.line, col: t.col, hide, bol: false, space: true, fromMacro: m.name }));
        toks.splice(i, 1, ...body);
        continue;
      }
      // function-like: need '(' next
      const nx = toks[i + 1];
      if (!nx || nx.t !== 'op' || nx.v !== '(') { out.push(t); i++; continue; }
      // collect args
      const args = []; let cur = []; let depth = 0; let j = i + 2;
      for (; j < toks.length; j++) {
        const a = toks[j];
        if (a.t === 'op' && (a.v === '(' || a.v === '[' || a.v === '{')) depth++;
        if (a.t === 'op' && (a.v === ')' || a.v === ']' || a.v === '}')) {
          if (depth === 0 && a.v === ')') break;
          depth--;
        }
        if (a.t === 'op' && a.v === ',' && depth === 0 && !(m.variadic && args.length >= m.params.length - 1)) { args.push(cur); cur = []; continue; }
        cur.push(a);
      }
      if (j >= toks.length) throw new CompileError(`Missing ) in call to ${m.name}(...)`, t.line);
      if (cur.length || args.length) args.push(cur);
      if (args.length !== m.params.length && !(m.params.length === 0 && args.length === 0) && !(m.variadic && args.length === m.params.length - 1)) {
        throw new CompileError(`${m.name}() expects ${m.params.length} argument${m.params.length === 1 ? '' : 's'} but got ${args.length}`, t.line);
      }
      const expandedArgs = args.map(a => { const o = []; this.expand(a, o); return o; });
      const body = [];
      for (let k = 0; k < m.body.length; k++) {
        const b = m.body[k];
        if (b.t === 'op' && b.v === '#' && m.body[k + 1] && m.body[k + 1].t === 'id' && m.params.includes(m.body[k + 1].v)) {
          const a = args[m.params.indexOf(m.body[k + 1].v)];
          const s = a.map(tokenText).join(' ');
          body.push({ t: 'str', v: [...new TextEncoder().encode(s)], raw: JSON.stringify(s), line: t.line, col: t.col });
          k++; continue;
        }
        if (b.t === 'op' && b.v === '##' && body.length && m.body[k + 1]) {
          const left = body.pop();
          let right = m.body[k + 1]; k++;
          let rightToks = [right];
          if (right.t === 'id' && m.params.includes(right.v)) rightToks = args[m.params.indexOf(right.v)];
          const leftText = tokenText(left);
          const txt = leftText + (rightToks.length ? tokenText(rightToks[0]) : '');
          const re = tokenize(txt).tokens.filter(x => x.t !== 'eof');
          for (const r of re) { r.line = t.line; r.col = t.col; body.push(r); }
          for (const r of rightToks.slice(1)) body.push({ ...r, line: t.line });
          continue;
        }
        if (b.t === 'id' && m.params.includes(b.v)) {
          const nextIsPaste = m.body[k + 1] && m.body[k + 1].t === 'op' && m.body[k + 1].v === '##';
          const src = nextIsPaste ? args[m.params.indexOf(b.v)] : expandedArgs[m.params.indexOf(b.v)];
          for (const a of src) body.push({ ...a, line: t.line, col: t.col, hide: new Set([...(a.hide || []), ...hide]) });
          continue;
        }
        body.push({ ...b, line: t.line, col: t.col, hide, bol: false, fromMacro: m.name });
      }
      toks.splice(i, j - i + 1, ...body);
    }
  }
}
