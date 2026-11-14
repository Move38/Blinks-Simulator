// Sketches of several files (.ino tabs, .cpp files, headers, src/ and config/ folders), the C++
// they bring with them (namespaces, overloads, file-local statics), and Custom Blinklib.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileSketch } from '../js/compiler/index.js';
import { detectSdk, sdkConfig } from '../js/compiler/sdk.js';
import { World } from '../js/runtime/world.js';
import { zip } from '../js/zip.js';

const ok = r => assert.ok(r.ok, r.errors && r.errors.map(e => `${e.file || ''}:${e.line} ${e.message}`).join('; '));

// Run a compiled sketch on Blinks at the given cells; Serial output goes to `log`
function table(r, cells = [[0, 0]]) {
  const log = [], errors = [];
  const w = new World({ onSerial: (b, t) => log.push(`${b.id}:${t}`), onError: (b, e) => errors.push(e), onWarn: () => {} });
  w.load(r);
  for (const [q, rr] of cells) w.addBlink(q, rr, 0);
  w.load(r);
  return { w, log, errors };
}

test('namespaces: qualified names, nested and reopened namespaces, using, the same name in two', () => {
  const r = compileSketch({
    main: 'Game.ino',
    files: {
      'Game.ino': `#include "Serial.h"
#include "state.h"
ServicePortSerial Serial;
void setup() { Serial.begin(); }
void loop() {
  game::state::Set(3);
  using namespace game;
  Serial.println(state::Get() + render::Get() + ::Get());
}
byte Get() { return 100; }
`,
      'state.h': `#pragma once
#include <blinklib.h>
namespace game {
namespace state {
void Set(byte s);
byte Get();
}
namespace render { byte Get(); }
}
byte Get();
`,
      'state.cpp': `#include "state.h"
namespace game::state {
static byte state_;
void Set(byte s) { state_ = s; }
}
byte game::state::Get() { return state_ * 2; }
namespace game { namespace render { byte Get() { return state::Get() + 1; } } }
`,
    },
  });
  ok(r);
  const { w, log } = table(r);
  w.advance(100);
  assert.equal(log[0], '1:113');   // 6 + 7 + 100
  // a static local's initializer is looked up from its function's namespace
  ok(compile('namespace a { const byte N = 3; byte f() { static byte n = N; return n; } }\nvoid setup() { a::f(); }\nvoid loop() {}\n'));
});

test('static and const at file scope belong to their file; inline functions in shared headers are one', () => {
  const r = compileSketch({
    main: 'A.ino',
    files: {
      'A.ino': '#include "Serial.h"\n#include "util.h"\nServicePortSerial Serial;\nstatic byte count_ = 1;\nvoid setup() { Serial.begin(); }\nvoid loop() { Serial.println(count_ + bump() + twice(LIMIT)); }\n',
      'util.h': '#pragma once\nconst byte LIMIT = 5;\ninline byte twice(byte x) { return x * 2; }\nbyte bump();\nstruct Pair { byte a; byte b; };\n',
      'util.cpp': '#include "util.h"\nstatic byte count_ = 40;\nstatic byte helper() { return ++count_; }\nbyte bump() { Pair p = {1, 2}; return helper() + p.b; }\n',
      'other.cpp': '#include "util.h"\nstatic byte helper() { return 0; }\nbyte unused() { return helper() + twice(LIMIT); }\n',
    },
  });
  ok(r);
  const { w, log } = table(r);
  w.advance(100);
  assert.equal(log[0], '1:54');   // 1 + (41 + 2) + 10
});

test('overloads are picked by their arguments', () => {
  const src = `#include "Serial.h"
ServicePortSerial Serial;
struct P { byte x; byte y; };
byte f() { return 1; }
byte f(byte a, byte b) { return a + b; }
byte f(P p) { return p.x * 10 + p.y; }
long f(long a) { return a * 1000L; }
void setup() { Serial.begin(); }
void loop() { Serial.println(f() + f(2, 3) + f(P{4, 5})); Serial.println(f(7L)); }
`;
  const c = compile(src);
  ok(c);
  const w = new World({ onSerial: (b, t) => log.push(t) });
  const log = [];
  w.load(c); w.addBlink(0, 0); w.load(c);
  w.advance(100);
  assert.deepEqual(log.slice(0, 2), ['51', '7000']);
});

test('a prototype and a definition with different parameter names are the same function', () => {
  ok(compileSketch({
    main: 'S.ino',
    files: {
      'S.ino': '#include "p.h"\nvoid setup() { Setup(1, 2); }\nvoid loop() {}\n',
      'p.h': '#pragma once\n#include <blinklib.h>\nnamespace position { void Setup(byte face, int8_t x); }\nusing position::Setup;\n',
      'p.cpp': '#include "p.h"\nnamespace position {\nstatic int8_t at_;\nvoid Setup(byte remote_face, int8_t remote_x) { at_ = remote_x + remote_face; }\n}\n',
      'q.cpp': '#include "p.h"\n',
    },
  }));
});

test('structs: forward declarations, anonymous members, a union filled through its first member, braces as arguments', () => {
  const src = `#include "Serial.h"
ServicePortSerial Serial;
namespace msg { struct Message; }
bool handle(const msg::Message* m);
namespace msg { struct Message { byte id; byte payload[2]; }; }
bool handle(const msg::Message* m) { return m->id == 7; }
union Value { struct { bool a : 1; bool b : 1; byte player : 3; }; byte as_byte; };
struct Stats { byte count; struct { byte n : 7; bool can : 1; } player[3]; };
struct C { int8_t x; int8_t y; };
byte dist(C a, C b) { return abs(a.x - b.x) + abs(a.y - b.y); }
C make() { return {3, 4}; }
void setup() { Serial.begin(); }
void loop() {
  Value v = {true, false, 5};
  Stats s = {};
  s.player[2].n = 99; s.player[2].can = true;
  msg::Message m = {7, {1, 2}};
  Serial.println(v.as_byte);
  Serial.println(s.player[2].n + s.player[2].can + sizeof(Stats));
  Serial.println(dist({0, 0}, make()) + handle(&m));
}
`;
  const c = compile(src);
  ok(c);
  const log = [];
  const w = new World({ onSerial: (b, t) => log.push(t) });
  w.load(c); w.addBlink(0, 0); w.load(c);
  w.advance(100);
  assert.deepEqual(log.slice(0, 3), [String(1 | (5 << 2)), '104', '8']);
});

test('errors and runtime errors say which file and line', () => {
  const r = compileSketch({
    main: 'M.ino',
    files: { 'M.ino': 'void setup() {}\nvoid loop() { go(); }\nvoid go();\n', 'lib/go.h': '', 'go.cpp': '#include <blinklib.h>\n\nvoid go() {\n  undefinedThing = 1;\n}\n' },
  });
  assert.equal(r.ok, false);
  assert.deepEqual([r.errors[0].file, r.errors[0].line], ['go.cpp', 4]);

  const run = compileSketch({
    main: 'M.ino',
    files: { 'M.ino': 'void go();\nvoid setup() {}\nvoid loop() { go(); }\n', 'go.cpp': '#include <blinklib.h>\nbyte a[3];\nvoid go() {\n  byte i = 5;\n  while (true) a[0]++;\n}\n' },
  });
  ok(run);
  const { w, errors } = table(run);
  w.advance(200);
  assert.ok(errors.length, 'the endless loop stops the Blink');
  assert.deepEqual(run.where(errors[0].line), { file: 'go.cpp', line: 5 });
});

test('includes: relative to the including file, config/ for <> with Custom Blinklib, __has_include', () => {
  const files = {
    'G.ino': '#include "src/lib/lib.h"\n#if __has_include(<game_config.h>)\n#include <game_config.h>\n#endif\nvoid setup() {}\nvoid loop() { setValueSentOnAllFaces(LIB + GAME); }\n',
    'src/lib/lib.h': '#pragma once\n#include "../lib/inner.h"\n#define LIB (INNER + 1)\n',
    'src/lib/inner.h': '#define INNER 10\n',
    'config/game_config.h': '#define GAME 100\n',
  };
  ok(compileSketch({ files, main: 'G.ino', sdk: 'bga' }));
  // Move38's platform doesn't add config/ to the include path, so GAME is never defined
  const r = compileSketch({ files, main: 'G.ino', sdk: 'move38' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /GAME/);
});

test('Custom Blinklib: detected by name, configured by config/blinklib_config.h', () => {
  assert.equal(detectSdk({ 'a.ino': '#ifndef BGA_CUSTOM_BLINKLIB\n#error x\n#endif' }), 'bga');
  assert.equal(detectSdk({ 'a.ino': 'void setup() {}' }), 'move38');
  const cfg = sdkConfig('bga', { 'config/blinklib_config.h': '#define BGA_CUSTOM_BLINKLIB_IR_DATAGRAM_LEN 5\n#define BGA_CUSTOM_BLINKLIB_SEND_PROBE_TIMEOUT_MS (150 + 150)\n#define BGA_CUSTOM_BLINKLIB_FACE_VALUE_TYPE uint16_t\n' });
  assert.equal(cfg.datagramLen, 5);
  assert.equal(cfg.probeMs, 300);
  assert.equal(cfg.expireMs, 200);
  assert.equal(cfg.value.size, 2);
  assert.equal(cfg.ramSystem, 484 + 12 * 5);
  // the game's own setting changes IR_DATAGRAM_LEN for its code too
  const r = compileSketch({ main: 'D.ino', sdk: 'bga', files: { 'D.ino': 'byte buf[IR_DATAGRAM_LEN];\nvoid setup() {}\nvoid loop() {}\n', 'config/blinklib_config.h': '#define BGA_CUSTOM_BLINKLIB_IR_DATAGRAM_LEN 5\n' } });
  ok(r);
  assert.equal(r.globals.find(g => g.name === 'buf').size, 5);
  assert.equal(r.ram.budget, 1024 - 544);
  // Move38's blinklib has no such API
  assert.equal(compile('void setup() { isDatagramPendingOnAnyFace(); }\nvoid loop() {}\n').ok, false);
});

test('Custom Blinklib: whole-byte face values, and datagrams resent until the neighbor reads them', () => {
  const src = `#include "Serial.h"
ServicePortSerial Serial;
byte next = 1;
Timer slow;
void setup() { Serial.begin(); }
void loop() {
  setValueSentOnAllFaces(200);
  if (getSerialNumberByte(0) == 0) {
    // the sender: a datagram whenever the last one has arrived
    if (next <= 12 && sendDatagramOnFace(&next, 1, 0)) next++;
  } else if (slow.isExpired()) {
    // the receiver reads one a quarter second, much slower than they come
    slow.set(250);
    if (isDatagramReadyOnFace(3)) { Serial.println(getDatagramOnFace(3)[0]); markDatagramReadOnFace(3); }
  }
  if (!isValueReceivedOnFaceExpired(0) && getLastValueReceivedOnFace(0) != 200) Serial.println(999);
}
`;
  const r = compile(src, { sdk: 'bga' });
  ok(r);
  const { w, log, errors } = table(r, [[0, 0], [0, -1]]);
  w.blinks[0].serial[0] = 0;
  w.blinks[1].serial[0] = 1;
  w.advance(5000);
  assert.deepEqual(errors, []);
  const got = log.filter(l => l.startsWith('2:')).map(l => +l.slice(2));
  assert.deepEqual(got.slice(0, 12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'none lost, none twice');
  assert.ok(!log.some(l => l.endsWith(':999')));
});

test('Custom Blinklib: sterileFlag stops a Blink from sharing its game', () => {
  const r = compile('void setup() { sterileFlag = 1; }\nvoid loop() {}\n', { sdk: 'bga' });
  ok(r);
  const { w } = table(r);
  const b = w.blinks[0];
  b.press(true);
  w.advance(3500);
  assert.equal(b.mode, 'run', 'held alone for 3 s, it would start sharing without the flag');
  b.press(false);
  w.advance(200);
  assert.equal(w.seeding.active, false);
});

test('a sketch downloads as a .zip of its folder', () => {
  const bytes = zip([['G/G.ino', 'void setup() {}\n'], ['G/src/a.h', '// é\n']]);
  const dv = new DataView(bytes.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(bytes.length - 12, true), 2);
});
