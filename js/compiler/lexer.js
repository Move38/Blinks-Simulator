/*
 * Lexer for the C/C++ subset used by Blinks sketches.
 *
 * Produces tokens with line numbers. Comments are dropped from the token
 * stream but collected separately so the block editor can keep them.
 */

// In a sketch with several files, a token's line is file * LINE_FILE + its line in that file, so
// the parser and code generator carry file positions without knowing about files. File 0 is the
// main sketch, whose lines are unchanged.
export const LINE_FILE = 100000;

export class CompileError extends Error {
  constructor(message, line, col) {
    super(message);
    this.line = line || 0;
    this.col = col || 0;
  }
}

const PUNCT = [
  '<<=', '>>=', '...', '->*',
  '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::', '##',
  '+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=',
  '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}', '#',
];

const isIdStart = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdChar = c => isIdStart(c) || (c >= '0' && c <= '9');
const isDigit = c => c >= '0' && c <= '9';

const ESC = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63 };

function readEscape(src, i) {
  // src[i] is the char after the backslash
  const c = src[i];
  if (c === 'x') {
    let j = i + 1, v = 0;
    while (j < src.length && /[0-9a-fA-F]/.test(src[j])) v = v * 16 + parseInt(src[j++], 16);
    return [v & 255, j];
  }
  if (c >= '0' && c <= '7') {
    let j = i, v = 0, n = 0;
    while (j < src.length && n < 3 && src[j] >= '0' && src[j] <= '7') { v = v * 8 + (src.charCodeAt(j++) - 48); n++; }
    return [v & 255, j];
  }
  if (c in ESC) return [ESC[c], i + 1];
  return [src.charCodeAt(i), i + 1];
}

/*
 * tokenize(src) -> { tokens, comments }
 * token: { t: 'id'|'num'|'str'|'char'|'op'|'eof', v, line, col, bol, space }
 *   bol   = first token on its line (used for preprocessor directives)
 *   space = preceded by whitespace (used for function-like macro detection)
 */
export function tokenize(src) {
  const tokens = [];
  const comments = [];
  let i = 0, line = 1, col = 1, bol = true, space = false;
  const n = src.length;

  const adv = k => {
    for (let q = 0; q < k; q++) {
      if (src[i] === '\n') { line++; col = 1; } else col++;
      i++;
    }
  };

  while (i < n) {
    const c = src[i];
    // line continuation
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) {
      adv(src[i + 1] === '\r' ? 3 : 2); space = true; continue;
    }
    if (c === '\n') { adv(1); bol = true; space = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { adv(1); space = true; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const start = i, l0 = line;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\' && src[i + 1] === '\n') adv(2); else adv(1);
      }
      comments.push({ line: l0, text: src.slice(start + 2, i).trim(), block: false, bol });
      space = true; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const start = i, l0 = line;
      adv(2);
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) adv(1);
      if (i >= n) throw new CompileError('Unterminated /* comment', l0);
      adv(2);
      comments.push({ line: l0, endLine: line, text: src.slice(start + 2, i - 2), block: true, bol });
      space = true; continue;
    }
    const tok = { t: '', v: null, line, col, bol, space };
    bol = false; space = false;

    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      tok.t = 'id'; tok.v = src.slice(i, j);
      adv(j - i);
      tokens.push(tok);
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
      let j = i;
      let raw;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        j = i + 2; while (j < n && /[0-9a-fA-F']/.test(src[j])) j++;
      } else if (c === '0' && (src[i + 1] === 'b' || src[i + 1] === 'B')) {
        j = i + 2; while (j < n && /[01']/.test(src[j])) j++;
      } else {
        while (j < n && (isDigit(src[j]) || src[j] === "'")) j++;
        if (src[j] === '.') { j++; while (j < n && isDigit(src[j])) j++; }
        if ((src[j] === 'e' || src[j] === 'E') && (isDigit(src[j + 1] || '') || ((src[j + 1] === '-' || src[j + 1] === '+') && isDigit(src[j + 2] || '')))) {
          j += 2; while (j < n && isDigit(src[j])) j++;
        }
      }
      // suffix
      let k = j;
      while (k < n && /[uUlLfF]/.test(src[k])) k++;
      raw = src.slice(i, k);
      if (k < n && isIdChar(src[k])) throw new CompileError(`Invalid number '${src.slice(i, k + 1)}'`, line, col);
      tok.t = 'num'; tok.v = raw;
      adv(k - i);
      tokens.push(tok);
      continue;
    }
    if (c === '"') {
      let j = i + 1; const bytes = [];
      while (j < n && src[j] !== '"') {
        if (src[j] === '\n') throw new CompileError('Missing closing " on string', line, col);
        if (src[j] === '\\') { const [v, nj] = readEscape(src, j + 1); bytes.push(v); j = nj; }
        else { const cp = src.codePointAt(j); const s = String.fromCodePoint(cp); for (const b of new TextEncoder().encode(s)) bytes.push(b); j += s.length; }
      }
      if (j >= n) throw new CompileError('Missing closing " on string', line, col);
      tok.t = 'str'; tok.v = bytes; tok.raw = src.slice(i, j + 1);
      adv(j + 1 - i);
      tokens.push(tok);
      continue;
    }
    if (c === "'") {
      let j = i + 1, v;
      if (src[j] === '\\') { [v, j] = readEscape(src, j + 1); }
      else { v = src.charCodeAt(j); j++; }
      if (src[j] !== "'") throw new CompileError("Missing closing ' on character", line, col);
      tok.t = 'char'; tok.v = v; tok.raw = src.slice(i, j + 1);
      adv(j + 1 - i);
      tokens.push(tok);
      continue;
    }
    let p = null;
    for (const q of PUNCT) if (src.startsWith(q, i)) { p = q; break; }
    if (!p) throw new CompileError(`Unexpected character '${c}'`, line, col);
    tok.t = 'op'; tok.v = p;
    adv(p.length);
    tokens.push(tok);
  }
  tokens.push({ t: 'eof', v: null, line, col, bol: true, space: true });
  return { tokens, comments };
}

export function tokenText(tok) {
  if (tok.t === 'str' || tok.t === 'char') return tok.raw;
  return String(tok.v);
}
