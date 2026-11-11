import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sim, compileErr, rgb, click } from './helpers.mjs';
import { colorR, colorG, colorB } from '../js/compiler/rt.js';

const prog = body => `void setup(){ ${body} } void loop(){}`;

test('int is 16 bits and wraps like AVR', () => {
  const { w, log } = sim(prog(`
    int a = 200; int b = a * a; Serial.println(b);
    byte c = 250; c += 10; Serial.println(c);
    int d = 32767; d++; Serial.println(d);
    unsigned int e = 0; e--; Serial.println(e);
    long f = 100000L * 3; Serial.println(f);
    byte g = 200; int h = g * 2; Serial.println(h);
    Serial.println(7 / 2); Serial.println(-7 / 2); Serial.println(-7 % 3);
    unsigned long m = 4000000000UL; m += 500000000UL; Serial.println(m);
    int x = 40000; Serial.println(x);
    char ch = 200; Serial.println((int)ch);
    float fl = 1.0 / 3; Serial.println(fl);
    Serial.println((byte)(-1));
    Serial.println(1 << 15);
    bool bb = 5; Serial.println(bb);
  `));
  w.advance(10);
  assert.deepEqual(log, ['-25536', '4', '-32768', '65535', '300000', '400', '3', '-3', '-1', '205032704', '-25536', '-56', '0.33', '255', '-32768', '1']);
});

test('signed/unsigned comparison follows C rules', () => {
  const { w, log } = sim(prog(`
    int a = -1; unsigned int b = 1; Serial.println(a < b ? 1 : 0);
    long c = -1; unsigned int d = 1; Serial.println(c < d ? 1 : 0);
    byte e = 255; Serial.println(e == -1 ? 1 : 0);
  `));
  w.advance(10);
  assert.deepEqual(log, ['0', '1', '0']);
});

test('structs, arrays, pointers, bitfields and unions use AVR layout', () => {
  const { w, log } = sim(`
    struct P { byte a; int b; long c; };
    struct FaceValue { byte value : 4; bool flag : 1; byte extra : 3; };
    union U { long l; byte bytes[4]; };
    P ps[3];
    int grid[2][3] = { {1, 2, 3}, {4, 5, 6} };
    void bump(P &p) { p.b += 10; }
    void fill(byte *d, byte n) { for (byte i = 0; i < n; i++) d[i] = i * 3; }
    void setup() {
      Serial.println(sizeof(P)); Serial.println(sizeof(ps)); Serial.println(sizeof(FaceValue));
      ps[1].b = 5; bump(ps[1]); Serial.println(ps[1].b);
      P *pp = &ps[2]; pp->c = 123456; Serial.println(ps[2].c);
      Serial.println(grid[1][2]); Serial.println(COUNT_OF(grid));
      FaceValue fv; fv.value = 9; fv.flag = true; fv.extra = 5;
      byte raw = *((byte*)&fv); Serial.println(raw);
      FaceValue back = *((FaceValue*)&raw); Serial.println(back.extra);
      U u; u.l = 0x01020304; Serial.println(u.bytes[0]);
      byte buf[5]; fill(buf, 5); Serial.println(buf[4]);
      Color c = makeColorRGB(255, 128, 0); Serial.println(c.r); Serial.println(c.g); Serial.println(c.as_uint16);
      Color d = dim(RED, 128); Serial.println(d.r);
    }
    void loop() {}`);
  w.advance(10);
  assert.deepEqual(log, ['7', '21', '1', '15', '123456', '6', '2', String(9 | 16 | (5 << 5)), '5', '4', '12', '31', '16', '1086', '15']);
});

test('enums, switch, static locals, function pointers, classes', () => {
  const { w, log } = sim(`
    enum State { IDLE, RUN = 5, DONE };
    State s = RUN;
    int counter() { static int n = 0; return ++n; }
    bool yes() { return true; }
    bool (*fp)() = yes;
    class Box { public: byte v; Box(byte x) : v(x) {} byte twice() { return v * 2; } };
    Box box(21);
    void setup() {
      switch (s) { case IDLE: Serial.println(0); break; case RUN: Serial.println(5); case DONE: Serial.println(6); break; }
      counter(); counter(); Serial.println(counter());
      Serial.println(fp() ? 1 : 0);
      Serial.println(box.twice());
      Serial.println(DONE);
    }
    void loop() {}`);
  w.advance(10);
  assert.deepEqual(log, ['5', '6', '3', '1', '42', '6']);
});

test('Arduino macros match Arduino.h (double evaluation included)', () => {
  const { w, log } = sim(prog(`
    int i = 5; int m = max(i++, 3); Serial.println(m); Serial.println(i);
    Serial.println(abs(-4)); Serial.println(constrain(300, 0, 255)); Serial.println(round(2.5));
    Serial.println(map(5, 0, 10, 0, 100)); Serial.println(map(50, 0, 10, 0, 100));
    Serial.println(sin8_C(64)); Serial.println(sin8_C(0));
  `));
  w.advance(10);
  assert.deepEqual(log, ['6', '7', '4', '255', '3', '50', '100', '255', '128']);
});

test('random() gives the same sequence on every Blink until randomize()', () => {
  const src = `void setup(){ Serial.println(random(1000)); Serial.println(random(1000)); } void loop(){}`;
  const { w, log } = sim(src, [[0, 0], [3, 0]]);
  w.advance(10);
  assert.equal(log.length, 4);
  assert.equal(log[0], log[2]);
  assert.equal(log[1], log[3]);
});

test('Timer semantics: pre-expired, set, getRemaining, never', () => {
  const { w, log } = sim(`
    Timer t; Timer n; bool reported = false;
    void setup() { Serial.println(t.isExpired()); t.set(100); n.never(); }
    void loop() { if (!reported && t.isExpired()) { reported = true; Serial.println(n.isExpired()); } }`);
  w.advance(50);
  assert.deepEqual(log, ['1']);
  w.advance(100);
  assert.deepEqual(log, ['1', '0']);
});

test('face values travel between touching Blinks, with rotation', () => {
  // Blink 2 is to the lower-right of blink 1 (direction 2), rotated by 1
  const src = `
    void setup() { setValueSentOnAllFaces(getSerialNumberByte(0) % 2 ? 5 : 5); }
    void loop() {
      FOREACH_FACE(f) {
        if (!isValueReceivedOnFaceExpired(f)) setColorOnFace(GREEN, f); else setColorOnFace(OFF, f);
      }
    }`;
  const { w, b } = sim(src, [[0, 0, 0], [1, 0, 1]]);
  w.advance(400);
  const lit = blk => [...blk.display].map((c, f) => (c & ~1) ? f : -1).filter(f => f >= 0);
  assert.deepEqual(lit(b[0]), [2]);          // world direction 2 = face 2 on an unrotated Blink
  assert.deepEqual(lit(b[1]), [4]);          // facing back is direction 5; with rot 1 that is local face 4
  // separate them: faces expire after ~200 ms, but the last value is kept
  w.lift(b[1]);
  w.advance(100);
  assert.deepEqual(lit(b[0]), [2]);
  w.advance(250);
  assert.deepEqual(lit(b[0]), []);
  assert.equal(b[0].faces[2].inValue, 5);
});

test('button clicks follow BIOS timing', () => {
  const { w, log } = sim(`
    void setup(){}
    void loop(){
      if (buttonPressed()) Serial.println("pressed");
      if (buttonSingleClicked()) Serial.println("single");
      if (buttonDoubleClicked()) Serial.println("double");
      if (buttonMultiClicked()) { Serial.print("multi "); Serial.println(buttonClickCount()); }
      if (buttonLongPressed()) Serial.println("long");
      if (buttonReleased()) Serial.println("released");
    }`, [[0, 0], [1, 0]]);
  const b = w.blinks[0];
  click(w, b);
  assert.deepEqual(log, ['pressed', 'released']);
  w.advance(200);
  assert.deepEqual(log, ['pressed', 'released']);
  w.advance(200);
  assert.deepEqual(log, ['pressed', 'released', 'single']);
  log.length = 0;
  click(w, b); click(w, b); click(w, b);
  w.advance(500);
  assert.deepEqual(log.filter(x => !['pressed', 'released'].includes(x)), ['multi 3']);
  log.length = 0;
  b.rawButton = true; w.advance(1100);
  assert.ok(!log.includes('long'));
  w.advance(200);
  assert.ok(log.includes('long'));
  b.rawButton = false; w.advance(500);
  assert.ok(!log.includes('single'));   // a long press is not a click
});

test('datagrams arrive once and can be dropped when unread', () => {
  const src = `
    struct Msg { byte kind; int value; };
    bool sent = false;
    void setup(){}
    void loop(){
      if (!sent && !isAlone() && getSerialNumberByte(9) == 0 && buttonPressed()) {
        Msg m = { 7, -1234 }; FOREACH_FACE(f) sendDatagramOnFace(&m, sizeof(m), f); sent = true;
      }
      FOREACH_FACE(f) {
        if (isDatagramReadyOnFace(f)) {
          const Msg *m = (const Msg *) getDatagramOnFace(f);
          Serial.print(getDatagramLengthOnFace(f)); Serial.print(" "); Serial.print(m->kind); Serial.print(" "); Serial.println(m->value);
          markDatagramReadOnFace(f);
        }
      }
    }`;
  const { w, log } = sim(src, [[0, 0], [1, 0]]);
  w.advance(300);
  click(w, w.blinks[0]);
  w.advance(100);
  assert.deepEqual(log, ['3 7 -1234']);
});

test('each sent datagram records whether it was received, dropped or lost', () => {
  // both Blinks send a datagram on every face twice and never read their buffers
  const src = `
    byte n = 0; Timer t;
    void setup(){ t.set(300); }
    void loop(){
      if (n < 2 && t.isExpired()) { byte d[2] = { 1, 2 }; FOREACH_FACE(f) sendDatagramOnFace(d, 2, f); n++; t.set(300); }
    }`;
  const { w } = sim(src, [[0, 0], [1, 0]]);
  const [a] = w.blinks;
  const linked = [0, 1, 2, 3, 4, 5].find(f => w.neighbor(a, f));
  w.advance(500);
  const first = a.faces.map(f => f.lastDg);
  assert.equal(first[linked].result, 'ok');
  for (let f = 0; f < 6; f++) if (f !== linked) assert.equal(first[f].result, 'lost');
  w.advance(400);
  assert.notEqual(a.faces[linked].lastDg, first[linked]);
  assert.equal(a.faces[linked].lastDg.result, 'dropped');   // the first one is still unread
});

test('(x * C1) / C2 folds like avr-gcc -Os, so overflow in x * C1 matches a Blink', () => {
  // Expected values are what avr-gcc 7.3 -Os computes (checked against its gimple output)
  const src = `
    int x = 100; int y = 0; long lx = 100000; char cx = 100; byte bx = 100; unsigned ux = 100; int sx = 4000;
    byte ball[] = { 1, 0, 6, 3 };
    void setup(){
      Serial.println((x * 1000 + 500) / 100);      // not folded: wraps
      Serial.println((x + 5) * 1000 / 100);        // (x + 5) * 10
      Serial.println((x * 1000 - y * 200) / 100);  // not folded
      Serial.println(lx * 100000L / 1000);         // lx * 100
      Serial.println(x * 1000 / 300);              // neither divides the other: wraps
      Serial.println(cx * 1000 / 100);             // cx * 10
      Serial.println((x * 1000) % 100);            // 0
      Serial.println(x * 1000 / -100);             // x * -10
      Serial.println((bx * 1000) / 100 * 7);       // bx * 70
      Serial.println((long)(x * 1000) / 100);      // (long)(x * 10)
      Serial.println(-(x * 1000) / 100);           // x * -10
      Serial.println((sx << 4) / 4);               // shifts aren't folded
      Serial.println(ux * 1000 / 100);             // unsigned isn't folded
      Serial.println(x * 100 / 1000);              // x / 10
      word trail = 2 * (100 - ball[0]) * 500 / 100; // Darkball
      Serial.println(trail);
    }
    void loop(){}`;
  const { w, log } = sim(src);
  w.advance(5);
  assert.deepEqual(log.join('\n').split(/\s+/).filter(Boolean), [
    '-305', '1050', '-310', '10000000', '-103', '1000', '0', '-1000', '7000', '1000', '-1000', '-384', '344', '10', '990',
  ]);
});

test("Arduino's binary constants (B101) and 0b literals", () => {
  const { w, log } = sim(prog('Serial.println(B101); Serial.println(B11111111); Serial.println(0b1010 | B1); byte x = B0; Serial.println(x);'));
  w.advance(5);
  assert.deepEqual(log.join('\n').split(/\s+/).filter(Boolean), ['5', '255', '11', '0']);
});

test('infinite loops and recursion are caught', () => {
  let r = sim(`void setup(){} void loop(){ while (true) { } }`);
  r.w.advance(5);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /never ends/);
  assert.equal(r.errors[0].line, 1);
  r = sim(`int f(int n){ return f(n + 1) + 1; }\nvoid setup(){ f(0); } void loop(){}`);
  r.w.advance(5);
  assert.match(r.errors[0].message, /Out of memory/);
});

test('out of range array index is reported', () => {
  const r = sim(`byte a[6];\nvoid setup(){}\nvoid loop(){ for (byte i = 0; i <= 6; i++) a[i] = 1; }`);
  r.w.advance(5);
  assert.equal(r.warns.length, 1);
  assert.equal(r.warns[0].l, 3);
});

test('compile errors match hardware', () => {
  assert.match(compileErr(`void setup(){ delay(100); } void loop(){}`).message, /Timer/);
  assert.match(compileErr(`void setup(){ int x = 5 } void loop(){}`).message, /Missing ';'/);
  assert.match(compileErr(`void setup(){ y = 1; } void loop(){}`).message, /not declared/);
  assert.match(compileErr(`void setup(){ Color c = 5; } void loop(){}`).message, /Color/);
  assert.match(compileErr(`void setup(){ if (RED == BLUE) {} } void loop(){}`).message, /Colors/);
  assert.match(compileErr(`void setup(){ random(1, 5); } void loop(){}`).message, /random\(\) takes 1/);
  assert.match(compileErr(`void setup(){}`).message, /loop\(\)/);
  assert.match(compileErr(`void setup(){ Serial.println(1); } void loop(){}`).message, /ServicePortSerial Serial/);
  assert.equal(compileErr(`void setup(){ setColor(RED); } void loop(){}`), null);
});

test('runtime warnings point at the sketch line', () => {
  const r = sim(`void setup() {}\nvoid loop() {\n  byte f = 7;\n  setColorOnFace(RED, f);\n}`);
  r.w.advance(10);
  assert.equal(r.warns.length, 1);
  assert.equal(r.warns[0].l, 4);
});

test('holding a lone Blink for 3 s shares the game; startState() reports it', () => {
  const src = `void setup(){ Serial.println(startState()); } void loop(){ setColor(GREEN); }`;
  const { w, log } = sim(src, [[0, 0], [3, 0]], { tag: true });
  w.advance(300);
  const [root, other] = w.blinks;
  root.press(true); w.advance(3300);
  assert.equal(root.mode, 'seedspin');
  root.press(false); w.advance(100);
  assert.equal(root.mode, 'seeding');
  // bring the other Blink over: it downloads the game
  w.lift(other); w.place(other, 1, 0);
  w.advance(1200);
  assert.equal(other.mode, 'seeding');
  w.advance(5000);
  assert.equal(root.mode, 'run');
  assert.ok(log.includes('1:1'), 'root restarts with START_STATE_WE_ARE_ROOT');
  assert.ok(log.includes('2:2'), 'receiver restarts with START_STATE_DOWNLOAD_SUCCESS');
});

test('holding for 6 s in a group puts everyone to sleep; a press wakes them', () => {
  const src = `void setup(){} void loop(){ setColor(RED); if (hasWoken()) Serial.println("woke"); }`;
  const { w, log } = sim(src, [[0, 0], [1, 0], [2, -1]]);
  w.advance(300);
  const [a, b, c] = w.blinks;
  a.press(true); w.advance(6100); a.press(false);
  // a fades out in blue, sending sleep packets face by face; its neighbors start fading later
  assert.equal(a.mode, 'sleeping');
  const blue = a.display[0];
  assert.ok(colorB(blue) > 0 && colorR(blue) === 0 && colorG(blue) === 0, 'the sleep fade is blue');
  w.advance(150);
  assert.ok(colorB(a.display[0]) < colorB(blue), 'and it dims');
  w.advance(800);
  assert.deepEqual(w.blinks.map(x => x.mode), ['sleep', 'sleep', 'sleep']);
  assert.ok(w.blinks.every(x => x.display.every(v => v === 0)), 'asleep is dark');
  w.advance(2000);
  c.press(true); w.advance(60);
  // c fades up in white, waking its neighbors in turn
  assert.equal(c.mode, 'waking');
  const white = c.display[0];
  assert.ok(colorR(white) > 0 && colorR(white) === colorG(white) && colorG(white) === colorB(white), 'the wake fade is white');
  c.press(false); w.advance(1000);
  assert.deepEqual(w.blinks.map(x => x.mode), ['run', 'run', 'run']);
  assert.ok(log.includes('woke'));
});

test('Serial prints only after begin()', () => {
  const r = sim(`ServicePortSerial sp;\nvoid setup(){ sp.println("lost"); sp.begin(); sp.println("hi"); } void loop(){}`);
  r.w.advance(10);
  assert.deepEqual(r.log, ['hi']);
  assert.equal(r.warns.length, 1);
});

test('assorted C++ features', () => {
  const { w, log } = sim(`
    #define SQUARE(x) ((x) * (x))
    #define DEBUG
    const byte N = 3;
    byte arr[N] = { 4, 5, 6 };
    struct P { byte a; int b; };
    P ps[3] = { {1, 10}, {2, 20}, {3, 30} };
    struct Flags { byte level : 3; bool on : 1; };
    enum class Mode : byte { A, B, C };
    Color palette[2] = { RED, makeColorRGB(0, 0, 255) };
    char name[] = "blink";
    int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
    byte sum2d(byte a[][3], byte rows) { byte s = 0; for (byte r = 0; r < rows; r++) for (byte c = 0; c < 3; c++) s += a[r][c]; return s; }
    byte grid[2][3] = { 1, 2, 3, 4, 5, 6 };
    void setup() {
      int x, y; x = y = 5; Serial.println(x + y);
      Serial.println(SQUARE(3 + 1));
    #ifdef DEBUG
      Serial.println("debug");
    #endif
      Serial.println(arr[N - 1]);
      P *p = ps; p++; Serial.println(p->b); p += 1; Serial.println((*p).a);
      Flags f; f.level = 7; f.level++; f.on = true; Serial.println(f.level); Serial.println(sizeof(Flags));
      Mode m = Mode::C; Serial.println((byte)m);
      Serial.println(palette[1].b);
      Serial.println(name); Serial.println(strlen(name));
      Serial.println(fib(10));
      Serial.println(sum2d(grid, 2));
      int total = 0; int i = 0;
      do { i++; if (i == 2) continue; if (i > 4) break; total += i; } while (true);
      Serial.println(total);
      unsigned long a = 5, b = 10; Serial.println(a - b);
      auto z = arr[0] + 1; Serial.println(z);
      P &ref = ps[0]; ref.b = 99; Serial.println(ps[0].b);
      byte k = 3; switch (k) { case 1: Serial.println("one"); break; default: Serial.println("other"); }
      float fl = sin(PI / 2) * 10; Serial.println(fl);
      Serial.println(255, HEX); Serial.println(5, BIN);
      Serial.println(-1 < 0u ? "yes" : "no");
    }
    void loop() {}`);
  w.advance(10);
  assert.deepEqual(log, ['10', '16', 'debug', '6', '20', '3', '0', '1', '2', '31', 'blink', '5', '55', '21', '8', '4294967291', '5', '99', 'other', '10.00', 'FF', '101', 'no']);
});
