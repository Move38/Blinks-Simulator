// FIREFLIES  ·  Blinks Arcade
//
// Click moves the white cursor clockwise. Double-click toggles the cursor's segment
// and the two beside it. Put every firefly to sleep (all segments dark).
// Connected: a toggle on an edge also flips the segment it touches on the next
// Blink, so one puzzle stretches across the group and every player has a cursor.
// A Blink celebrates when it and every Blink touching it are dark.
//
// Click         move cursor
// Double-click  toggle three
// Long press    deal a new puzzle to the whole group
//
// A puzzle only works for the arrangement it was dealt for, so whenever Blinks are
// added or pulled away, the group deals itself a fresh puzzle half a second later
// (a Blink on its own deals itself a solo one).

#define MSG_FLIP 61     // [MSG_FLIP]
#define MSG_NEW  62     // [MSG_NEW, nonce]
#define SEND_GAP 60

byte lit = 0;           // bit per segment: 1 = firefly awake
byte owed = 0;          // bit per face: an edge flip we still need to send (two flips cancel)
byte cursor = 0;
byte nonce;
word lastSend[6];
unsigned long dealAt = 0;
Timer celebrateTimer;
bool wasWon = false;
byte neighborsBefore = 0;
unsigned long redealAt = 0;

void flipLocal(byte f) { lit ^= 1 << f; }

void toggle(byte f) {
  flipLocal(f); flipLocal((f + 1) % 6); flipLocal((f + 5) % 6);
  if (!isValueReceivedOnFaceExpired(f)) owed ^= 1 << f;
}

void scramble() {
  byte n = 3 + random(3);
  for (byte i = 0; i < n; i++) toggle(random(5));
  if (!lit) toggle(0);
}

void freshSolo() { lit = 0; owed = 0; scramble(); }   // alone: only local moves, always solvable

void setup() { randomize(); nonce = random(255); freshSolo(); }

void loop() {
  bool click = buttonSingleClicked();
  bool dbl   = buttonDoubleClicked();
  bool lp    = buttonLongPressed();
  buttonMultiClicked();
  unsigned long now = millis();
  bool alone = isAlone();

  FOREACH_FACE(f) {
    if (!isDatagramReadyOnFace(f)) continue;
    const byte *d = getDatagramOnFace(f);
    byte n = getDatagramLengthOnFace(f);
    if (n == 1 && d[0] == MSG_FLIP) flipLocal(f);
    else if (n == 2 && d[0] == MSG_NEW && d[1] != nonce) {
      // everyone goes dark first, then scrambles a moment later so no flip lands before a clear
      nonce = d[1]; lit = 0; owed = 0; dealAt = now + 400;
      FOREACH_FACE(g) if (g != f && !isValueReceivedOnFaceExpired(g)) { sendDatagramOnFace(d, 2, g); lastSend[g] = now; }
    }
    markDatagramReadOnFace(f);
  }

  // who is touching us? a change (after it settles) deals a puzzle for the new arrangement
  byte nb = 0;
  FOREACH_FACE(f) if (!isValueReceivedOnFaceExpired(f)) nb |= 1 << f;
  if (nb != neighborsBefore) { neighborsBefore = nb; redealAt = now + 500; }
  if (redealAt && (long)(now - redealAt) >= 0) { redealAt = 0; if (alone) freshSolo(); else lp = true; }

  if (lp) {
    nonce += 1 + random(200);
    lit = 0; owed = 0; dealAt = now + 400;
    byte d[2] = { MSG_NEW, nonce };
    FOREACH_FACE(g) if (!isValueReceivedOnFaceExpired(g)) { sendDatagramOnFace(d, 2, g); lastSend[g] = now; }
  }
  if (dealAt && (long)(now - dealAt) >= 0) { dealAt = 0; scramble(); }

  if (click) cursor = (cursor + 1) % 6;
  if (dbl) toggle(cursor);

  // send owed edge flips, one per face at a time
  FOREACH_FACE(f) {
    if (!((owed >> f) & 1) || (word)((word)now - lastSend[f]) < SEND_GAP) continue;
    owed &= ~(1 << f);
    if (!isValueReceivedOnFaceExpired(f)) { byte d[1] = { MSG_FLIP }; sendDatagramOnFace(d, 1, f); lastSend[f] = now; }
  }

  setValueSentOnAllFaces(lit ? 1 : 2);        // 2 = this Blink is dark

  bool won = !lit;
  FOREACH_FACE(f) if (!isValueReceivedOnFaceExpired(f) && getLastValueReceivedOnFace(f) != 2) won = false;
  if (won && !wasWon) celebrateTimer.set(2200);
  wasWon = won;

  // --- draw
  if (won) {
    bool twinkle = !celebrateTimer.isExpired();
    FOREACH_FACE(f) setColorOnFace(twinkle && ((now / 90) + f * 7) % 9 == 0 ? makeColorRGB(190, 255, 30) : makeColorRGB(2, 6, 18), f);
    return;
  }
  FOREACH_FACE(f) {
    Color c = (lit >> f) & 1 ? dim(makeColorRGB(190, 255, 30), 190 + (sin8_C((now >> 2) + f * 70) >> 2)) : makeColorRGB(3, 8, 20);
    if (f == cursor) {
      byte p = sin8_C(now >> 1);
      c = (lit >> f) & 1 ? makeColorRGB(220 + (p >> 3), 255, 140 + (p >> 2)) : dim(makeColorRGB(150, 150, 200), 40 + (p >> 1));
    }
    setColorOnFace(c, f);
  }
}
