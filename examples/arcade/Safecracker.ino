// SAFECRACKER  ·  Blinks Arcade
//
// Hold the button and the lit pin turns through the colors, glowing brighter as it
// nears the hidden one. When the two segments beside it light up white, the tumbler
// has caught: release to set the pin. A miss jams the pin red; try again.
// Each pin is a little faster and tighter than the last. Set all six to open the safe.
// If you hold for more than 4.5 seconds the pin jams: let go and try again.
// (Holding a Blink for 6+ seconds makes it share its game or go to sleep.)
// Connected: every touching Blink gets the same combination. First to open wins;
// everyone else's safe goes red.
//
// Hold & release   turn the dial / set the pin
// Click            new safe (after it opens)

#define MSG_SEED 51     // [MSG_SEED, version, author, seed]
#define MSG_WIN  52     // [MSG_WIN, version, author]
#define MAX_HOLD 4500

// ---- outbox (see HexBrew for why) ---------------------------------------------------
#define SEND_GAP 60
#define QLEN 2
#define DLEN 4
byte qLen[6][QLEN], qData[6][QLEN][DLEN], qN[6];
word qLast[6];
void post(const byte *d, byte len, byte f) {
  if (qN[f] >= QLEN) return;
  qLen[f][qN[f]] = len;
  for (byte i = 0; i < len; i++) qData[f][qN[f]][i] = d[i];
  qN[f]++;
}
void pump() {
  word now = millis();
  FOREACH_FACE(f) {
    if (!qN[f] || (word)(now - qLast[f]) < SEND_GAP) continue;
    if (!isValueReceivedOnFaceExpired(f)) sendDatagramOnFace(qData[f][0], qLen[f][0], f);
    qLast[f] = now;
    qN[f]--;
    for (byte j = 0; j < qN[f]; j++) { qLen[f][j] = qLen[f][j + 1]; for (byte i = 0; i < DLEN; i++) qData[f][j][i] = qData[f][j + 1][i]; }
  }
}
void flood(const byte *d, byte len, byte exceptFace) {
  FOREACH_FACE(f) if (f != exceptFace && !isValueReceivedOnFaceExpired(f)) post(d, len, f);
}
// --------------------------------------------------------------------------------------

byte seed, ver = 0, author, myId;     // ver 0 = fresh Blink: adopts, never overwrites
byte combo[6];
byte cur = 0;
bool holding = false;
unsigned long holdStart;
byte h0;
Timer jamTimer, healTimer;
unsigned long openedAt = 0;
bool opened = false, lostRace = false;
bool presentBefore[6];

// per pin: dial speed in hue units (0..255) per second, and catch window (+/- hue units)
word speedPerSec() { return 43 + 4 * cur; }          // ~60 deg/s on pin 1 -> ~88 deg/s on pin 6
byte window()      { return 18 - cur; }               // ~±25 deg on pin 1 -> ~±18 deg on pin 6

byte hueAt(unsigned long t) {
  unsigned long el = t > holdStart ? t - holdStart : 0;
  return h0 + (byte)(el * speedPerSec() / 1000);
}
byte hueDist(byte a, byte b) { byte d = a - b; return d > 128 ? 256 - d : d; }

void makeCombo() {                     // same seed -> same combination on every Blink
  word x = seed * 251 + 17;
  FOREACH_FACE(f) { x = x * 25173 + 13849; combo[f] = x >> 8; }
  cur = 0; holding = false; opened = false; lostRace = false;
}

bool takes(byte v, byte a) {
  if ((cur > 0 || holding) && !opened && !lostRace) return false;  // never yank a safe mid-crack
  if (v == 0) return ver == 0 && a > author;
  if (ver == 0) return true;
  return (int8_t)(v - ver) > 0 || (v == ver && a > author);
}

void sendSeed(byte exceptFace) { byte d[4] = { MSG_SEED, ver, author, seed }; flood(d, 4, exceptFace); }

void newSafe() {
  seed = random(255); ver++; if (ver == 0) ver = 1; author = myId;
  makeCombo();
  sendSeed(255);
}

void setup() { randomize(); myId = author = random(255); seed = random(255); makeCombo(); }

void loop() {
  bool down = buttonPressed();
  bool up = buttonReleased();
  bool click = buttonSingleClicked();
  buttonDoubleClicked(); buttonMultiClicked(); buttonLongPressed();
  unsigned long now = millis();

  // --- messages
  FOREACH_FACE(f) {
    if (!isDatagramReadyOnFace(f)) continue;
    const byte *d = getDatagramOnFace(f);
    byte n = getDatagramLengthOnFace(f);
    if (n == 4 && d[0] == MSG_SEED && takes(d[1], d[2])) {
      ver = d[1]; author = d[2]; seed = d[3]; makeCombo(); sendSeed(f);
    } else if (n == 3 && d[0] == MSG_WIN && d[1] == ver && d[2] == author && !opened && !lostRace) {
      lostRace = true; openedAt = now; flood(d, 3, f);
    }
    markDatagramReadOnFace(f);
  }
  // offer our combination to a Blink that just arrived, and repeat it now and then
  FOREACH_FACE(f) {
    bool present = !isValueReceivedOnFaceExpired(f);
    if (present && !presentBefore[f]) { byte d[4] = { MSG_SEED, ver, author, seed }; post(d, 4, f); }
    presentBefore[f] = present;
  }
  if (healTimer.isExpired()) { healTimer.set(2000); if (!isAlone()) sendSeed(255); }

  // --- play
  if (opened || lostRace) {
    if (click && now - openedAt > 900) newSafe();
  } else {
    if (down) {
      if (ver == 0) { ver = 1; author = myId; sendSeed(255); }    // this safe is now in play
      holding = true; holdStart = now;
      h0 = combo[cur] - 60 - random(60);              // start 60-120 units before the target: first catch in ~1-3 s
    }
    if (holding && now - holdStart > MAX_HOLD) {      // stop before the 6 s hold that shares/sleeps
      holding = false; jamTimer.set(900);
    }
    if (up && holding) {
      holding = false;
      // 90 ms grace so a release just after the white cue still counts
      byte d = min(hueDist(hueAt(now), combo[cur]), hueDist(hueAt(now - 90), combo[cur]));
      if (d <= window()) {
        if (++cur == 6) {
          opened = true; openedAt = now;
          if (!isAlone()) { byte m[3] = { MSG_WIN, ver, author }; flood(m, 3, 255); }
        }
      } else {
        jamTimer.set(450);
      }
    }
  }

  pump();

  // --- draw
  if (lostRace) { setColor(dim(RED, 20 + (sin8_C(now >> 2) >> 2))); return; }
  if (opened)   { FOREACH_FACE(f) setColorOnFace(dim(makeColorRGB(255, 180, 30), 50 + (sin8_C((now >> 1) - f * 42) * 3 >> 2)), f); return; }

  FOREACH_FACE(f) setColorOnFace(f < cur ? makeColorHSB(combo[f], 255, 220) : makeColorRGB(6, 6, 12), f);
  if (!jamTimer.isExpired()) {
    setColorOnFace(RED, cur);
  } else if (holding) {
    byte h = hueAt(now), w = window(), d = hueDist(h, combo[cur]);
    // steady glow: dim when far, full when close. No flicker.
    byte near = d <= w ? 255 : (d - w >= 70 ? 0 : 255 - (d - w) * 255 / 70);
    setColorOnFace(makeColorHSB(h, 255, 25 + ((word)near * near >> 8) * 230 / 255), cur);
    if (d <= w) {                                       // the tumbler has caught
      setColorOnFace(makeColorHSB(h, 80, 255), cur);
      setColorOnFace(WHITE, (cur + 1) % 6);
      setColorOnFace(WHITE, (cur + 5) % 6);
    }
  } else {
    setColorOnFace(dim(WHITE, 15 + (sin8_C(now >> 3) >> 2)), cur);
  }
}
