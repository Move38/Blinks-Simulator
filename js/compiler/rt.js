/*
 * Pure helper functions used by compiled sketches (and by the compiler for constant folding).
 * Ported line-for-line from blinklib.cpp / Arduino where it matters for exact results.
 */

export class SimError extends Error {
  constructor(message, line) { super(message); this.line = line || 0; this.sim = true; }
}
export function stuck(line) {
  throw new SimError('This loop never ends. A real Blink would freeze here: loop() has to finish quickly so the Blink can update its lights and talk to its neighbors.', line);
}
export function overflow() {
  throw new SimError('Out of memory: too many functions calling each other (or a function calling itself forever). A real Blink would crash here.');
}
export function nullDeref(a, line) {
  throw new SimError(`Reading or writing through a null pointer (address ${a}).`, line);
}

// Hooks the runtime points at the blink that is currently running
export const hooks = {
  divZero: () => {},
  outOfBounds: () => {},
};

// Integer division by zero on AVR (libgcc) returns all ones and leaves the dividend as remainder
export function div(a, b) {
  if (b === 0) { hooks.divZero(); return -1; }
  return Math.trunc(a / b);
}
export function mod(a, b) {
  if (b === 0) { hooks.divZero(); return a; }
  return a % b;
}

// Color is pixelColor_t: bit 0 reserved, then 5 bits each of r, g, b
export function color5(r, g, b, reserved) {
  return ((reserved & 1) | ((r & 31) << 1) | ((g & 31) << 6) | ((b & 31) << 11)) & 0xffff;
}
export const colorR = c => (c >> 1) & 31;
export const colorG = c => (c >> 6) & 31;
export const colorB = c => (c >> 11) & 31;

export function makeColorRGB(r, g, b) {
  return color5(r >> 3, g >> 3, b >> 3, 0);
}

export function makeColorHSB(hue, saturation, brightness) {
  let r, g, b;
  if (saturation === 0) {
    r = g = b = brightness;
  } else {
    const scaledHue = (hue * 6) & 0xffff;
    const sector = scaledHue >> 8;
    const offsetInSector = scaledHue - (sector << 8);
    const p = ((brightness * (255 - saturation)) >> 8) & 0xffff;
    const q = ((brightness * (255 - ((saturation * offsetInSector) >> 8))) >> 8) & 0xffff;
    const t = ((brightness * (255 - ((saturation * (255 - offsetInSector)) >> 8))) >> 8) & 0xffff;
    switch (sector) {
      case 0: r = brightness; g = t; b = p; break;
      case 1: r = q; g = brightness; b = p; break;
      case 2: r = p; g = brightness; b = t; break;
      case 3: r = p; g = q; b = brightness; break;
      case 4: r = t; g = p; b = brightness; break;
      default: r = brightness; g = p; b = q; break;
    }
  }
  // stored into uint8_t before makeColorRGB
  return makeColorRGB(r & 255, g & 255, b & 255);
}

// MAKECOLOR_5BIT_RGB sets reserved = 1, makeColorRGB leaves it 0. Both only matter for as_uint16.
export function dim(c, brightness) {
  return color5(Math.trunc(colorR(c) * brightness / 255), Math.trunc(colorG(c) * brightness / 255), Math.trunc(colorB(c) * brightness / 255), 1);
}
export function lighten(c, brightness) {
  const f = v => v + Math.trunc((31 - v) * brightness / 255);
  return color5(f(colorR(c)), f(colorG(c)), f(colorB(c)), 1);
}

// blinklib map(): word arithmetic, clamped, with rounding as in the SDK
export function map(x, inMin, inMax, outMin, outMax) {
  if (x < inMin) return outMin;
  if (x > inMax) return outMax;
  if (((inMax - inMin) & 0xffff) > ((outMax - outMin) & 0xffff)) {
    const den = (inMax - inMin + 1) & 0xffff;
    if (den === 0) { hooks.divZero(); return outMin; }
    return ((Math.floor(((x - inMin) >>> 0) * ((outMax - outMin + 1) & 0xffff) / den) & 0xffff) + outMin) & 0xffff;
  }
  const den = (inMax - inMin) & 0xffff;
  if (den === 0) { hooks.divZero(); return outMin; }
  return ((Math.floor(((x - inMin) >>> 0) * ((outMax - outMin) & 0xffff) / den) & 0xffff) + outMin) & 0xffff;
}

const B_M16 = [0, 49, 49, 41, 90, 27, 117, 10];
export function sin8_C(theta) {
  theta &= 255;
  let offset = theta;
  if (theta & 0x40) offset = 255 - offset;
  offset &= 0x3f;
  let secoffset = offset & 0x0f;
  if (theta & 0x40) secoffset++;
  const section = offset >> 4;
  const s2 = section * 2;
  const b = B_M16[s2], m16 = B_M16[s2 + 1];
  const mx = (m16 * secoffset) >> 4;
  let y = ((mx + b) << 24) >> 24;
  if (theta & 0x80) y = (-y << 24) >> 24;
  y = (y + 128) & 255;
  return y;
}

// Marsaglia xorshift32, exactly as blinklib (same seed on every Blink until randomize())
export const RAND_SEED = 2463534242;
export function xorshift(state) {
  let x = state >>> 0;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  return x;
}

// avr-libc rand(): Park–Miller "minimal standard" generator
export function avrRand(stateRef) {
  let x = stateRef.v;
  if (x === 0) x = 123459876;
  const hi = Math.trunc(x / 127773), lo = x % 127773;
  x = 16807 * lo - 2836 * hi;
  if (x < 0) x += 0x7fffffff;
  stateRef.v = x;
  return x % 0x8000;
}

export const fround = Math.fround;
