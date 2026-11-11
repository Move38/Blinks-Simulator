/*
 * C types as they exist on the Blink's AVR microcontroller (ATmega168PB, avr-gcc):
 *   char/byte = 8 bits, int = 16 bits, long = 32 bits, float = double = 32 bits,
 *   pointers = 16 bits, no struct padding, little endian.
 */

const intT = (name, size, signed) => ({ k: 'int', name, size, signed });

export const T = {
  void: { k: 'void', name: 'void', size: 0 },
  bool: { k: 'int', name: 'bool', size: 1, signed: false, isBool: true },
  char: intT('char', 1, true),
  i8: intT('int8_t', 1, true),
  u8: intT('byte', 1, false),
  i16: intT('int', 2, true),
  u16: intT('unsigned int', 2, false),
  i32: intT('long', 4, true),
  u32: intT('unsigned long', 4, false),
  i64: intT('long long', 4, true), // avr-gcc has 64-bit long long; we approximate with 32 bits and warn
  float: { k: 'float', name: 'float', size: 4 },
  color: { k: 'color', name: 'Color', size: 2 },
  nullptr: { k: 'ptr', name: 'nullptr_t', size: 2, to: { k: 'void', name: 'void', size: 0 } },
};

// Named builtin typedefs available in every sketch
export function builtinTypeNames() {
  return new Map([
    ['byte', T.u8], ['uint8_t', T.u8], ['int8_t', T.i8], ['boolean', T.bool],
    ['word', T.u16], ['uint16_t', T.u16], ['int16_t', T.i16], ['size_t', T.u16],
    ['uint32_t', T.u32], ['int32_t', T.i32], ['ulong', T.u32], ['millis_t', T.u32],
    ['uint64_t', { ...T.u32, name: 'uint64_t', wide: true }], ['int64_t', { ...T.i32, name: 'int64_t', wide: true }],
    ['Color', T.color], ['pixelColor_t', T.color],
    ['Timer', TIMER], ['ServicePortSerial', SERIAL], ['HardwareSerial', SERIAL],
  ]);
}

// Built-in classes. Their methods are implemented by the runtime.
export const TIMER = {
  k: 'struct', name: 'Timer',
  def: { name: 'Timer', kind: 'class', builtin: 'timer', size: 4, members: [{ name: 'm_expireTime', type: T.u32, offset: 0, private: true }], methods: new Map(), complete: true },
};
export const SERIAL = {
  k: 'struct', name: 'ServicePortSerial',
  def: { name: 'ServicePortSerial', kind: 'class', builtin: 'serial', size: 1, members: [], methods: new Map(), complete: true },
};

export const ptr = to => ({ k: 'ptr', to, size: 2 });
export const ref = to => ({ k: 'ref', to, size: 2 });
export const arr = (of, n, nExpr) => ({ k: 'arr', of, n, nExpr });
export const fn = (ret, params, variadic) => ({ k: 'fn', ret, params, variadic: !!variadic });

export const isInt = t => t.k === 'int' || t.k === 'enum';
export const isArith = t => isInt(t) || t.k === 'float';
export const isScalar = t => isArith(t) || t.k === 'ptr' || t.k === 'color';
export const isPtrLike = t => t.k === 'ptr' || t.k === 'arr';
export const isStruct = t => t.k === 'struct';

// enum values behave like their underlying integer type
export function intOf(t) {
  if (t.k === 'enum') return t.base || T.i16;
  return t;
}

export function sizeOf(t) {
  switch (t.k) {
    case 'arr': return (t.n || 0) * sizeOf(t.of);
    case 'struct': return t.def.size;
    case 'enum': return (t.base || T.i16).size;
    case 'ref': return sizeOf(t.to);
    default: return t.size;
  }
}

export function typeName(t) {
  if (!t) return '?';
  switch (t.k) {
    case 'ptr': return typeName(t.to) + '*';
    case 'ref': return typeName(t.to) + '&';
    case 'arr': return typeName(t.of) + '[' + (t.n == null ? '' : t.n) + ']';
    case 'struct': return t.def.name || 'struct';
    case 'enum': return t.name || 'enum';
    case 'fn': return typeName(t.ret) + '(' + t.params.map(p => typeName(p.type)).join(', ') + ')';
    default: return t.name;
  }
}

export function sameType(a, b) {
  if (a === b) return true;
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'int': return a.size === b.size && a.signed === b.signed && !!a.isBool === !!b.isBool;
    case 'ptr': case 'ref': return sameType(a.to, b.to);
    case 'arr': return a.n === b.n && sameType(a.of, b.of);
    case 'struct': return a.def === b.def;
    case 'enum': return a.def === b.def;
    default: return true;
  }
}

// Integer promotion: everything narrower than int becomes int (16-bit on AVR)
export function promote(t) {
  t = intOf(t);
  if (t.k === 'int' && t.size < 2) return T.i16;
  return t;
}

// The "usual arithmetic conversions" for a binary operator, for AVR sizes.
export function commonType(a, b) {
  a = promote(a); b = promote(b);
  if (a.k === 'float' || b.k === 'float') return T.float;
  if (a.k !== 'int' || b.k !== 'int') return null;
  const rank = t => t.size * 2 + (t.signed ? 0 : 1);
  if (a.size === b.size) return a.signed && b.signed ? a : (a.signed ? b : a);
  const big = a.size > b.size ? a : b, small = a.size > b.size ? b : a;
  // a wider signed type can hold all values of a narrower unsigned one
  if (!big.signed && small.signed) return big;
  if (big.signed && !small.signed && big.size > small.size) return big;
  return rank(a) > rank(b) ? a : b;
}
