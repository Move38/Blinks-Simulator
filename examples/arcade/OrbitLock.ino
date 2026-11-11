// ORBIT LOCK  ·  Blinks Arcade
//
// Solo: a comet circles the Blink and one segment glows gold.
//       Press the moment the comet lands on gold. Each hit speeds the comet up,
//       every fifth hit reverses its direction, a wrong press slows it down.
// Connected: the comet hops across touching edges, so its orbit wanders through
//       the whole group. Every Blink has its own gold mark; only the Blink that is
//       holding the comet can score.
//
// Press        hit the gold mark
// Long press   bring back a lost comet / restart at the slowest speed

#define MSG_COMET 7                 // datagram: [MSG_COMET, level, dir]
#define MAX_LEVEL 15
#define NO_FACE   255

bool  hasComet  = true;
byte  cometFace = 0;
int8_t dir      = 1;                // +1 or -1 around the faces
byte  level     = 0;                // 0 = slowest
byte  hits      = 0;
bool  justArrived = false;          // stops the comet bouncing straight back
byte  targetFace;
byte  tail      = NO_FACE;          // the face the comet just left

Timer stepTimer;
Timer flashTimer;
Timer aloneTimer;
Color flashColor;

word stepMs() {
  word ms = 430;
  for (byte i = 0; i < level; i++) ms = ms * 9 / 10;
  return ms < 120 ? 120 : ms;
}

byte pulse(word period) {             // 0..255 sine pulse
  return sin8_C((millis() % period) * 256UL / period);
}

void newTarget() {
  byte t;
  do { t = random(5); } while (t == targetFace || t == cometFace);
  targetFace = t;
}

void flash(Color c, word ms) { flashColor = c; flashTimer.set(ms); }

void takeComet(byte face, byte lvl, int8_t d) {
  hasComet = true; cometFace = face; level = lvl; dir = d;
  justArrived = true; tail = NO_FACE;
  stepTimer.set(stepMs());
}

void setup() {
  randomize();
  targetFace = 3;
  stepTimer.set(stepMs());
}

void loop() {
  bool pressed   = buttonPressed();
  bool longPress = buttonLongPressed();
  buttonSingleClicked(); buttonDoubleClicked(); buttonMultiClicked();   // clear unused flags

  // --- comet arriving from a neighbor
  FOREACH_FACE(f) {
    if (isDatagramReadyOnFace(f)) {
      const byte *d = getDatagramOnFace(f);
      if (getDatagramLengthOnFace(f) == 3 && d[0] == MSG_COMET && !hasComet) {
        takeComet(f, d[1] > MAX_LEVEL ? MAX_LEVEL : d[1], d[2] ? 1 : -1);
      }
      markDatagramReadOnFace(f);
    }
  }

  // --- a Blink on its own always gets a comet back
  if (!hasComet && isAlone()) {
    if (aloneTimer.isExpired()) takeComet(random(5), 0, 1);
  } else {
    aloneTimer.set(1200);
  }
  if (longPress && !hasComet) takeComet(0, 0, 1);
  if (longPress) { level = 0; hits = 0; }

  // --- move the comet
  if (hasComet && stepTimer.isExpired()) {
    stepTimer.set(stepMs());
    if (!justArrived && !isValueReceivedOnFaceExpired(cometFace)) {
      byte d[3] = { MSG_COMET, level, (byte)(dir > 0) };
      sendDatagramOnFace(d, 3, cometFace);
      hasComet = false;
      tail = cometFace;
    } else {
      tail = cometFace;
      cometFace = (cometFace + 6 + dir) % 6;
      justArrived = false;
    }
  }

  // --- the press
  if (pressed) {
    bool onTarget = hasComet && cometFace == targetFace;
    // a little grace: the comet left the gold segment less than 100 ms ago
    bool late = hasComet && tail == targetFace && stepTimer.getRemaining() + 100 > stepMs();
    if (onTarget || late) {
      hits++;
      if (level < MAX_LEVEL) level++;
      if (hits % 5 == 0) dir = -dir;
      flash(makeColorRGB(120, 255, 170), 260);
      newTarget();
    } else {
      level = level > 2 ? level - 2 : 0;
      flash(RED, 380);
    }
  }

  // --- draw
  Color comet = makeColorHSB(130 + hits * 16, 110, 255);
  FOREACH_FACE(f) setColorOnFace(makeColorRGB(10, 14, 60), f);
  setColorOnFace(dim(makeColorRGB(255, 170, 20), 90 + (pulse(1200) >> 1)), targetFace);
  if (hasComet) {
    if (tail != NO_FACE) setColorOnFace(dim(comet, 70), tail);
    setColorOnFace(cometFace == targetFace ? WHITE : comet, cometFace);
  }
  if (!flashTimer.isExpired()) setColor(flashColor);
}
