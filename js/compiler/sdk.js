/*
 * The Blinks SDKs a sketch can be built against.
 *
 *   move38  Move38's blinklib (the Arduino IDE's move38:avr), which the simulator follows by default
 *   bga     Bruno Albuquerque's "Custom Blinklib" 1.4.3 (github.com/brunoga/blinklib), used by
 *           Hexxagon and a few other games. Same buttons, colors and timers; a different IR
 *           protocol (whole-byte face values, datagrams that are resent until acknowledged) and a
 *           per-game config/blinklib_config.h that tunes it.
 *
 * The compiler takes an SDK's macros, built-in headers and API from here; the runtime takes its
 * IR settings from sdkConfig().
 */

import { BUILTINS } from './builtins.js';
import { T } from './types.js';
import { builtinTypeNames } from './types.js';
import { tokenize, tokenText } from './lexer.js';
import { preprocessTokens, macroValue } from './preprocess.js';

const b = (ret, params, gen, extra) => ({ ret, params, gen, ...extra });

// Read from config/blinklib_config.h, with blinklib's defaults
const BGA_DEFAULTS = { datagramLen: 16, probeMs: 150, expireMs: 200, datagrams: true, checksum: false, trackConnection: false, valueType: 'byte' };

// blinklib_ir.h reads the game's config; so does this stand-in for it
const BGA_BLINKLIB_H = `
#if __has_include(<blinklib_config.h>)
#include <blinklib_config.h>
#endif
#ifndef BGA_CUSTOM_BLINKLIB_DISABLE_DATAGRAM
#ifdef BGA_CUSTOM_BLINKLIB_IR_DATAGRAM_LEN
#define IR_DATAGRAM_LEN BGA_CUSTOM_BLINKLIB_IR_DATAGRAM_LEN
#else
#define IR_DATAGRAM_LEN 16
#endif
#endif
`;

export const SDKS = {
  move38: {
    id: 'move38',
    name: 'Move38 blinklib',
    about: 'The blinklib that comes with the Arduino IDE’s Blinks board package',
  },
  bga: {
    id: 'bga',
    name: 'Custom Blinklib 1.4.3',
    about: 'Bruno Albuquerque’s blinklib (github.com/brunoga/blinklib), used by Hexxagon and other games',
    url: 'https://github.com/brunoga/blinklib',
    prelude: `
#define BGA_CUSTOM_BLINKLIB
#undef IR_DATA_VALUE_MAX
#define IR_DATA_VALUE_MAX 255
#undef IR_DATAGRAM_LEN
`,
    headers: { 'blinklib.h': BGA_BLINKLIB_H, 'Arduino.h': '#include <blinklib.h>\n' },
    includeDirs: ['config'],      // its platform.local.txt adds -I<sketch>/config
    source: 'uint8_t sterileFlag;\n',   // blinklib's own global a game can set
  },
};

// Does a sketch look like it's written for Custom Blinklib? Its games check for it by name.
export function detectSdk(files) {
  for (const text of Object.values(files)) if (/\bBGA_CUSTOM_BLINKLIB/.test(text)) return 'bga';
  return 'move38';
}

// The SDK settings a sketch's files choose (Custom Blinklib: its config/blinklib_config.h).
// Returns { id, ... } or throws an Error with a message for the sketch's author.
export function sdkConfig(id, files = {}) {
  if (id !== 'bga') return { id: 'move38' };
  const cfg = { id, ...BGA_DEFAULTS };
  const text = files['config/blinklib_config.h'];
  if (text) {
    const { defs } = preprocessTokens(tokenize(text), { prelude: SDKS.bga.prelude });
    const num = (name, key) => { if (defs.has(name)) { const v = macroValue(defs, name); if (v !== null) cfg[key] = v; } };
    num('BGA_CUSTOM_BLINKLIB_IR_DATAGRAM_LEN', 'datagramLen');
    num('BGA_CUSTOM_BLINKLIB_SEND_PROBE_TIMEOUT_MS', 'probeMs');
    num('BGA_CUSTOM_BLINKLIB_FACE_EXPIRATION_TIMEOUT_MS', 'expireMs');
    if (defs.has('BGA_CUSTOM_BLINKLIB_DISABLE_DATAGRAM')) cfg.datagrams = false;
    if (defs.has('BGA_CUSTOM_BLINKLIB_ENABLE_CHECKSUM')) cfg.checksum = true;
    if (defs.has('BGA_CUSTOM_BLINKLIB_TRACK_FACE_CONNECTION')) cfg.trackConnection = true;
    if (defs.has('BGA_CUSTOM_BLINKLIB_FACE_VALUE_TYPE')) cfg.valueType = defs.get('BGA_CUSTOM_BLINKLIB_FACE_VALUE_TYPE').body.map(tokenText).join(' ');
  }
  cfg.value = faceValueType(cfg.valueType);
  if (!cfg.value) throw new Error(`BGA_CUSTOM_BLINKLIB_FACE_VALUE_TYPE is ${cfg.valueType}: the simulator only runs whole-number face values (byte, uint16_t, …)`);
  if (cfg.datagrams && (cfg.datagramLen < 1 || cfg.datagramLen > 16)) throw new Error(`BGA_CUSTOM_BLINKLIB_IR_DATAGRAM_LEN is ${cfg.datagramLen}; it must be from 1 to 16`);
  // RAM blinklib and the BIOS use, measured with avr-gcc: 485 bytes, and two buffers per face for datagrams
  cfg.ramSystem = 484 + (cfg.datagrams ? 12 * cfg.datagramLen : -11);
  return cfg;
}

function faceValueType(name) {
  const words = name.trim().split(/\s+/);
  const named = builtinTypeNames().get(name.trim());
  if (named) return named.k === 'int' ? named : null;
  const unsigned = words.includes('unsigned');
  const base = words.filter(w => w !== 'unsigned' && w !== 'signed').join(' ') || 'int';
  if (base === 'char') return unsigned ? T.u8 : T.i8;
  if (base === 'int' || base === 'short') return unsigned ? T.u16 : T.i16;
  if (base === 'long') return unsigned ? T.u32 : T.i32;
  return null;
}

// The API a sketch can call: blinklib.h's functions for this SDK
export function sdkBuiltins(cfg) {
  if (cfg.id !== 'bga') return BUILTINS;
  const v = cfg.value;
  const api = { ...BUILTINS };
  delete api.isMAXblink; delete api.isNFCblink; delete api.saveGameStat; delete api.setFaceColor;
  api.setValueSentOnFace = b(T.void, [v, T.u8], a => `L.setValueSentOnFace(${a[0]}, ${a[1]})`);
  api.setValueSentOnAllFaces = b(T.void, [v], a => `L.setValueSentOnAllFaces(${a[0]})`);
  api.getLastValueReceivedOnFace = b(v, [T.u8], a => `L.getLastValueReceivedOnFace(${a[0]})`);
  api.didValueOnFaceChange = b(T.bool, [T.u8], a => `L.didValueOnFaceChange(${a[0]})`);
  api.isValueReceivedOnFaceExpired = b(T.bool, [T.u8], a => `L.isValueReceivedOnFaceExpired(${a[0]})`);
  if (cfg.datagrams) {
    api.sendDatagramOnFace = b(T.bool, [BUILTINS.sendDatagramOnFace.params[0], T.u8, T.u8], a => `L.sendDatagramOnFace(${a})`);
    api.isDatagramPendingOnFace = b(T.bool, [T.u8], a => `L.isDatagramPendingOnFace(${a[0]})`);
    api.isDatagramPendingOnAnyFace = b(T.bool, [], () => `L.isDatagramPendingOnAnyFace()`);
    api.resetPendingDatagramOnFace = b(T.void, [T.u8], a => `L.resetPendingDatagramOnFace(${a[0]})`);
  } else {
    for (const k of ['getDatagramLengthOnFace', 'isDatagramReadyOnFace', 'getDatagramOnFace', 'markDatagramReadOnFace', 'sendDatagramOnFace']) delete api[k];
  }
  return api;
}
