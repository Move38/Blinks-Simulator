// RICOCHET  ·  Blinks Arcade
//
// Solo: the ball flies to a segment. That segment flashes orange as the ball arrives
//       and turns white when it lands. Press while it's white to return it.
//       Rallies speed up. Press the blinking serve segment to start.
// Connected: returns fly out through a touching edge and land on a neighbor's Blink,
//       so whoever it lands on has to return it. A miss resets the rally and the
//       player who missed serves next.
//
// Press        serve / return
// Long press   bring back a lost ball

#define MSG_BALL 31       // [MSG_BALL, speed level, rally]
#define NO_FACE  255

enum { NONE, SERVE, FLY_OUT, FLY_IN, MISS };
byte state = SERVE;
byte fromFace = 0, toFace = 0;
byte level = 0, rally = 0;
unsigned long legStart;
word legMs;
Timer missTimer, aloneTimer;

word flightMs() { word ms = 1100; for (byte i = 0; i < level; i++) ms = ms * 93 / 100; return ms < 380 ? 380 : ms; }
word windowMs() { word w = flightMs() * 22 / 100; return w < 110 ? 110 : w > 230 ? 230 : w; }

byte connectedFace() {                     // a random face with a neighbor, or NO_FACE
  byte list[6], n = 0;
  FOREACH_FACE(f) if (!isValueReceivedOnFaceExpired(f)) list[n++] = f;
  return n ? list[random(n - 1)] : NO_FACE;
}

void flyTo(byte from, byte to, byte s, word ms) { fromFace = from; toFace = to; state = s; legStart = millis(); legMs = ms; }

void launch(byte from) {                   // serve or return from this face
  byte e = connectedFace();
  if (e != NO_FACE) flyTo(from, e, FLY_OUT, flightMs() / 2);
  else flyTo(from, (from + 2 + random(2)) % 6, FLY_IN, flightMs());
}

void miss(byte face) { state = MISS; fromFace = face; rally = 0; level = 0; missTimer.set(900); }

void setup() { randomize(); }

void loop() {
  bool pressed = buttonPressed();
  bool lp = buttonLongPressed();
  buttonSingleClicked(); buttonDoubleClicked(); buttonMultiClicked();
  unsigned long now = millis();

  // --- ball arriving from a neighbor
  FOREACH_FACE(f) {
    if (isDatagramReadyOnFace(f)) {
      const byte *d = getDatagramOnFace(f);
      if (getDatagramLengthOnFace(f) == 3 && d[0] == MSG_BALL && (state == NONE || state == SERVE)) {
        level = d[1]; rally = d[2];
        byte dest; do { dest = random(5); } while (dest == f);
        flyTo(f, dest, FLY_IN, flightMs() / 2);
      }
      markDatagramReadOnFace(f);
    }
  }

  // --- no ball? a lone Blink serves again; a long press brings one back
  if (state == NONE) {
    if (isAlone() && aloneTimer.isExpired()) { state = SERVE; fromFace = 0; }
    if (lp) { state = SERVE; fromFace = 0; }
  }
  if (!isAlone()) aloneTimer.set(1500);

  unsigned long arrive = legStart + legMs;
  switch (state) {
    case SERVE:
      if (pressed) launch(fromFace);
      break;
    case FLY_OUT:
      if (now >= arrive) {
        if (!isValueReceivedOnFaceExpired(toFace)) {
          byte d[3] = { MSG_BALL, level, rally };
          sendDatagramOnFace(d, 3, toFace);
          state = NONE;
        } else {
          flyTo(toFace, (toFace + 3) % 6, FLY_IN, flightMs() / 2);    // neighbor left: bounce back in
        }
      }
      break;
    case FLY_IN: {
      word w = windowMs();
      if (pressed) {
        long dt = (long)(now - arrive);
        if (dt >= -(long)w && dt <= (long)w) { rally++; if (level < 20) level++; launch(toFace); }
        else if (dt < -(long)w) miss(toFace);                     // too early
      } else if ((long)(now - arrive) > (long)w) {
        miss(toFace);
      }
      break;
    }
    case MISS:
      if (missTimer.isExpired()) state = SERVE;
      break;
  }

  // --- draw
  setColor(makeColorRGB(10, 0, 26));
  Color ball = makeColorRGB(255, 60, 200);
  if (state == SERVE) setColorOnFace((now / 250) % 2 ? WHITE : makeColorRGB(60, 30, 80), fromFace);
  if (state == FLY_OUT || state == FLY_IN) {
    long el = (long)(now - legStart);
    byte p = el >= legMs ? 255 : el * 255L / legMs;
    setColorOnFace(dim(ball, 255 - p), fromFace);
    setColorOnFace(dim(ball, p), toFace);
    if (state == FLY_IN) {
      long dt = (long)(now - arrive);
      if (dt >= -(long)windowMs()) setColorOnFace(WHITE, toFace);
      else if (p > 128) setColorOnFace((now / 90) % 2 ? ORANGE : dim(ORANGE, 70), toFace);
    }
  }
  if (state == MISS) setColor(dim(RED, missTimer.getRemaining() * 255 / 900));
}
