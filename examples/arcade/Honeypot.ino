// HONEYPOT  ·  Blinks Arcade
//
// Hold to pour honey into the lit cell. The flow speeds up the longer you hold.
// Release once the cell sparkles to seal it. Pour past full and it bursts, spilling
// into the cells beside it and cracking any seals it hits. Seal all six.
// Connected: bursts spill across touching edges into your neighbors' cells, so one
// greedy pour can set off a chain reaction through the whole hive.
//
// Hold & release   pour / seal
// Click            new hive (after all six are sealed)

#define MSG_SPILL 71
#define FULL      10000
#define SEAL_AT    8000
#define SPILL      4500
#define GLUG        800
#define SPILL_DELAY 170

word fill[6];
byte rate[6];             // percent, 75..130
byte sealed = 0;          // bit per cell
byte cur = 0;
bool holding = false;
unsigned long holdStart, lastTick;
byte spillIn[6];          // spills waiting to land in this cell (from a burst next door)
unsigned long spillAt[6]; // when the next one lands
byte spillOut[6];         // spills still to send across each edge
word lastSend[6];
#define SEND_GAP 60
Timer burstFx[6];
bool done = false;

byte firstUnsealed() { FOREACH_FACE(f) if (!((sealed >> f) & 1)) return f; return 255; }

void newHive() {
  FOREACH_FACE(f) { fill[f] = 0; rate[f] = 75 + random(55); spillIn[f] = 0; spillOut[f] = 0; }
  sealed = 0; cur = 0; holding = false; done = false;
}

void burst(byte f) {
  fill[f] = 0; sealed &= ~(1 << f); done = false;
  if (holding && cur == f) holding = false;
  burstFx[f].set(380);
  byte a = (f + 1) % 6, b = (f + 5) % 6;
  if (!spillIn[a]) spillAt[a] = millis() + SPILL_DELAY;
  if (!spillIn[b]) spillAt[b] = millis() + SPILL_DELAY;
  spillIn[a]++; spillIn[b]++;
  if (!isValueReceivedOnFaceExpired(f) && spillOut[f] < 9) spillOut[f]++;
}

void addHoney(byte f, word amt) {
  if ((sealed >> f) & 1) { sealed &= ~(1 << f); done = false; }   // a spill cracks the seal
  if ((unsigned long)fill[f] + amt > FULL) burst(f); else fill[f] += amt;
}

void setup() { randomize(); newHive(); lastTick = millis(); }

void loop() {
  bool down = buttonPressed();
  bool up = buttonReleased();
  bool click = buttonSingleClicked();
  buttonDoubleClicked(); buttonMultiClicked(); buttonLongPressed();
  unsigned long now = millis();
  word dt = now - lastTick; lastTick = now;

  FOREACH_FACE(f) {
    if (isDatagramReadyOnFace(f)) {
      if (getDatagramLengthOnFace(f) == 1 && getDatagramOnFace(f)[0] == MSG_SPILL) addHoney(f, SPILL);
      markDatagramReadOnFace(f);
    }
  }

  // pending spills from a burst next door
  FOREACH_FACE(f) if (spillIn[f] && (long)(now - spillAt[f]) >= 0) { spillIn[f]--; spillAt[f] = now + 60; addHoney(f, SPILL); }
  // spills across edges: one datagram per face at a time (a second send would replace the first)
  FOREACH_FACE(f) {
    if (!spillOut[f] || (word)((word)now - lastSend[f]) < SEND_GAP) continue;
    spillOut[f]--;
    if (!isValueReceivedOnFaceExpired(f)) { byte d[1] = { MSG_SPILL }; sendDatagramOnFace(d, 1, f); lastSend[f] = now; }
    else spillOut[f] = 0;
  }

  if (done) {
    if (click) newHive();
  } else {
    if (down) {
      byte f = firstUnsealed();
      if (f != 255) { cur = f; holding = true; holdStart = now; addHoney(cur, GLUG); }
    }
    if (holding) {
      // flow in fill units per second: 0.4/s at first, +0.5/s for every second held
      unsigned long perSec = (unsigned long)rate[cur] * (4000 + 5 * (now - holdStart)) / 100;
      unsigned long add = perSec * dt / 1000;
      if (fill[cur] + add > FULL) burst(cur); else fill[cur] += add;
    }
    if (up && holding) {
      holding = false;
      if (fill[cur] >= SEAL_AT) {
        sealed |= 1 << cur;
        if (sealed == 0x3F) done = true;
      }
    }
    if (!holding) { byte f = firstUnsealed(); if (f != 255) cur = f; }
  }

  setValueSentOnAllFaces(done ? 2 : 1);
  bool hiveDone = done;
  FOREACH_FACE(f) if (!isValueReceivedOnFaceExpired(f) && getLastValueReceivedOnFace(f) != 2) hiveDone = false;

  // --- draw
  if (hiveDone) { FOREACH_FACE(f) setColorOnFace(dim(makeColorRGB(255, 175, 0), 90 + (sin8_C((now >> 1) - f * 42) * 5 >> 3)), f); return; }
  FOREACH_FACE(f) {
    Color c;
    if ((sealed >> f) & 1) c = dim(makeColorRGB(255, 160, 0), 205 + (sin8_C((now >> 2) + f * 40) >> 3));
    else if (fill[f] > 0) {
      byte v = fill[f] >= FULL ? 255 : (unsigned long)fill[f] * 255 / FULL;
      c = makeColorRGB(90 + (v * 165 >> 8), 30 + (v * 170 >> 8), (v * 40 >> 8));
      if (fill[f] >= SEAL_AT) {                       // smooth shimmer toward pale gold: seal now
        byte s = sin8_C(now);                          // ~4 shimmers per second
        c = makeColorRGB(255, 190 + (s >> 2), 40 + (s >> 1));
      }
    } else c = makeColorRGB(6, 4, 0);
    if (f == cur && !holding && !done && fill[f] < 500) c = dim(ORANGE, 15 + (sin8_C(now >> 2) >> 2));
    if (!burstFx[f].isExpired()) c = makeColorRGB(255, 40, 0);
    setColorOnFace(c, f);
  }
}
