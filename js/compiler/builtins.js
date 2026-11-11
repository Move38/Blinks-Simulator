/*
 * The Blinks SDK API (blinklib.h) plus the parts of Arduino / avr-libc a sketch can reach.
 * Each entry gives the C signature so arguments convert exactly as on hardware
 * (e.g. a face number is a byte, so 257 becomes 1), and the JS that runs it.
 *   L = this Blink's runtime (js/runtime/blink.js), H = js/compiler/rt.js
 */

import { T, ptr } from './types.js';

const VOIDP = ptr(T.void);
const CVOIDP = ptr(T.void);
const CHARP = ptr(T.char);
const BYTEP = ptr(T.u8);

const b = (ret, params, gen, extra) => ({ ret, params, gen, ...extra });

export const BUILTINS = {
  // Display
  setColor: b(T.void, [T.color], a => `L.setColor(${a[0]})`),
  setColorOnFace: b(T.void, [T.color, T.u8], a => `L.setColorOnFace(${a[0]}, ${a[1]})`),
  setFaceColor: b(T.void, [T.u8, T.color], a => `L.setColorOnFace(${a[1]}, ${a[0]})`),
  makeColorRGB: b(T.color, [T.u8, T.u8, T.u8], a => `H.makeColorRGB(${a})`, { pure: true }),
  makeColorHSB: b(T.color, [T.u8, T.u8, T.u8], a => `H.makeColorHSB(${a})`, { pure: true }),
  dim: b(T.color, [T.color, T.u8], a => `H.dim(${a})`, { pure: true }),
  lighten: b(T.color, [T.color, T.u8], a => `H.lighten(${a})`, { pure: true }),

  // Button
  buttonDown: b(T.bool, [], () => `L.buttonDown()`),
  buttonPressed: b(T.bool, [], () => `L.flag(1)`),
  buttonLongPressed: b(T.bool, [], () => `L.flag(2)`),
  buttonReleased: b(T.bool, [], () => `L.flag(4)`),
  buttonSingleClicked: b(T.bool, [], () => `L.flag(8)`),
  buttonDoubleClicked: b(T.bool, [], () => `L.flag(16)`),
  buttonMultiClicked: b(T.bool, [], () => `L.flag(32)`),
  buttonLongLongPressed: b(T.bool, [], () => `L.flag(64)`),
  buttonClickCount: b(T.u8, [], () => `L.clickCount`),

  // IR face values
  setValueSentOnFace: b(T.void, [T.u8, T.u8], a => `L.setValueSentOnFace(${a[0]}, ${a[1]})`),
  setValueSentOnAllFaces: b(T.void, [T.u8], a => `L.setValueSentOnAllFaces(${a[0]})`),
  getLastValueReceivedOnFace: b(T.u8, [T.u8], a => `L.getLastValueReceivedOnFace(${a[0]})`),
  didValueOnFaceChange: b(T.u8, [T.u8], a => `L.didValueOnFaceChange(${a[0]})`),
  isValueReceivedOnFaceExpired: b(T.u8, [T.u8], a => `L.isValueReceivedOnFaceExpired(${a[0]})`),
  isAlone: b(T.bool, [], () => `L.isAlone()`),

  // Datagrams
  getDatagramLengthOnFace: b(T.u8, [T.u8], a => `L.getDatagramLengthOnFace(${a[0]})`),
  isDatagramReadyOnFace: b(T.bool, [T.u8], a => `L.isDatagramReadyOnFace(${a[0]})`),
  getDatagramOnFace: b(ptr({ ...T.u8, isConst: true }), [T.u8], a => `L.getDatagramOnFace(${a[0]})`),
  markDatagramReadOnFace: b(T.void, [T.u8], a => `L.markDatagramReadOnFace(${a[0]})`),
  sendDatagramOnFace: b(T.void, [CVOIDP, T.u8, T.u8], a => `L.sendDatagramOnFace(${a})`),

  // Time
  millis: b(T.u32, [], () => `L.now`),

  // Utilities
  random: b(T.u16, [T.u16], a => `L.random(${a[0]})`),
  randomWord: b(T.u16, [], () => `L.randomWord()`),
  randomize: b(T.void, [], () => `L.randomize()`),
  getSerialNumberByte: b(T.u8, [T.u8], a => `L.getSerialNumberByte(${a[0]})`),
  getBlinkbiosVersion: b(T.u8, [], () => `L.biosVersion`),
  map: b(T.u16, [T.u16, T.u16, T.u16, T.u16, T.u16], a => `H.map(${a})`, { pure: true }),
  sin8_C: b(T.u8, [T.u8], a => `H.sin8_C(${a[0]})`, { pure: true }),
  hasWoken: b(T.u8, [], () => `L.hasWoken()`),
  startState: b(T.u8, [], () => `L.startState`),
  isMAXblink: b(T.u8, [], () => `0`),
  isNFCblink: b(T.u8, [], () => `0`),
  saveGameStat: b(T.u8, [CVOIDP, T.u8], () => `2`),

  // Power / interrupts (no-ops in the simulator)
  cli: b(T.void, [], () => `0`),
  sei: b(T.void, [], () => `0`),
  noInterrupts: b(T.void, [], () => `0`),
  interrupts: b(T.void, [], () => `0`),

  // avr-libc math (float == double on AVR)
  sin: b(T.float, [T.float], a => `Math.fround(Math.sin(${a[0]}))`, { pure: true }),
  cos: b(T.float, [T.float], a => `Math.fround(Math.cos(${a[0]}))`, { pure: true }),
  tan: b(T.float, [T.float], a => `Math.fround(Math.tan(${a[0]}))`, { pure: true }),
  asin: b(T.float, [T.float], a => `Math.fround(Math.asin(${a[0]}))`, { pure: true }),
  acos: b(T.float, [T.float], a => `Math.fround(Math.acos(${a[0]}))`, { pure: true }),
  atan: b(T.float, [T.float], a => `Math.fround(Math.atan(${a[0]}))`, { pure: true }),
  atan2: b(T.float, [T.float, T.float], a => `Math.fround(Math.atan2(${a}))`, { pure: true }),
  sqrt: b(T.float, [T.float], a => `Math.fround(Math.sqrt(${a[0]}))`, { pure: true }),
  pow: b(T.float, [T.float, T.float], a => `Math.fround(Math.pow(${a}))`, { pure: true }),
  exp: b(T.float, [T.float], a => `Math.fround(Math.exp(${a[0]}))`, { pure: true }),
  log: b(T.float, [T.float], a => `Math.fround(Math.log(${a[0]}))`, { pure: true }),
  log10: b(T.float, [T.float], a => `Math.fround(Math.log10(${a[0]}))`, { pure: true }),
  fabs: b(T.float, [T.float], a => `Math.abs(${a[0]})`, { pure: true }),
  floor: b(T.float, [T.float], a => `Math.floor(${a[0]})`, { pure: true }),
  ceil: b(T.float, [T.float], a => `Math.ceil(${a[0]})`, { pure: true }),
  fmod: b(T.float, [T.float, T.float], a => `Math.fround(${a[0]} % ${a[1]})`, { pure: true }),
  fmin: b(T.float, [T.float, T.float], a => `Math.min(${a})`, { pure: true }),
  fmax: b(T.float, [T.float, T.float], a => `Math.max(${a})`, { pure: true }),
  labs: b(T.i32, [T.i32], a => `(Math.abs(${a[0]}) | 0)`, { pure: true }),
  rand: b(T.i16, [], () => `L.rand()`),
  srand: b(T.void, [T.u16], a => `L.srand(${a[0]})`),

  // string.h
  memcpy: b(VOIDP, [VOIDP, CVOIDP, T.u16], a => `memcpy(${a})`),
  memmove: b(VOIDP, [VOIDP, CVOIDP, T.u16], a => `memcpy(${a})`),
  memset: b(VOIDP, [VOIDP, T.i16, T.u16], a => `memset(${a})`),
  memcmp: b(T.i16, [CVOIDP, CVOIDP, T.u16], a => `memcmp(${a})`),
  strlen: b(T.u16, [CHARP], a => `strlen(${a[0]})`),
  strcmp: b(T.i16, [CHARP, CHARP], a => `strcmp(${a})`),
  strcpy: b(CHARP, [CHARP, CHARP], a => `strcpy(${a})`),
};

// Functions that exist in regular Arduino but not on Blinks, with a friendly explanation
export const NOT_ON_BLINKS = {
  delay: 'Blinks don\'t have delay(): it would freeze the Blink and stop it talking to its neighbors. Use a Timer instead, e.g. `Timer t; t.set(500); ... if (t.isExpired()) { ... }`',
  delayMicroseconds: 'Blinks don\'t have delayMicroseconds(). Use millis() or a Timer.',
  pinMode: 'Blinks don\'t expose pins. Use setColor() and the button functions instead.',
  digitalWrite: 'Blinks don\'t expose pins. Use setColor() / setColorOnFace() to light the Blink.',
  digitalRead: 'Blinks don\'t expose pins. Use buttonPressed() and friends to read the button.',
  analogRead: 'Blinks don\'t have analog inputs.',
  analogWrite: 'Blinks don\'t expose pins. Use setColor() with dim() for brightness.',
  tone: 'Blinks don\'t have a speaker.',
  micros: 'Blinks only have millis().',
  randomSeed: 'Blinks use randomize() to seed the random number generator.',
  setFaceColor_: '',
};

// Timer methods (see Timer.cpp)
export const TIMER_METHODS = {
  isExpired: b(T.bool, [], (a, self) => `L.timerExpired(${self})`),
  getRemaining: b(T.u32, [], (a, self) => `L.timerRemaining(${self})`),
  set: b(T.void, [T.u32], (a, self) => `L.timerSet(${self}, ${a[0]})`),
  add: b(T.void, [T.u16], (a, self) => `L.timerAdd(${self}, ${a[0]})`),
  never: b(T.void, [], (a, self) => `L.timerNever(${self})`),
};
