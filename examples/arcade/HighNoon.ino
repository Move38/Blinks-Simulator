// HIGH NOON  ·  Blinks Arcade
//
// Solo: press to start. The Blink glows red, then turns green after a random wait.
//       Press as soon as you see green. More gold segments = a faster draw.
//       Pressing early fouls the round.
// Connected: every touching Blink is a gunslinger. Press any Blink to start a duel.
//       The fastest draw takes a segment from each opponent; drawing early costs you
//       a segment. Lose all six and you're out. The winner deals the next round.
//       Long press any Blink to reset the whole table.
//
// Blink clocks can differ by ~10%, so "green" is a GO message sent by the dealer at
// draw time rather than a countdown on each Blink. Each hop adds a few ms of delay,
// so duels are fairest between Blinks that touch directly.

#define MSG_START 21   // [MSG_START, round, dealer]
#define MSG_GO    24   // [MSG_GO, round, dealer]
#define MSG_RES   22   // [MSG_RES, round, dealer, id, time hi, time lo]
#define MSG_RESET 23   // [MSG_RESET, nonce]
#define NONE      0xFFFF

// ---- outbox (see HexBrew for why) ---------------------------------------------------
#define SEND_GAP 60
#define QLEN 2
#define DLEN 6
byte qLen[6][QLEN], qData[6][QLEN][DLEN], qN[6];
word qLast[6];
void post(const byte *d, byte len, byte f) {
  if (qN[f] >= QLEN) {
    // queue full: a newer result is always a better one (we only relay improvements), so it replaces a queued result
    if (d[0] == MSG_RES && qData[f][QLEN - 1][0] == MSG_RES) qN[f] = QLEN - 1; else return;
  }
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

enum { IDLE, WAIT, DRAW, RESULT, EARLY, OUT };
byte state = IDLE;
bool solo = true, dealer = false;
byte myId, roundId, roundDealer = 255, resetNonce;
unsigned long goAt, waitStart;
word myTime = NONE, bestTime = NONE;
byte bestId = 0;
bool fouled = false, iWon = false, goRelayed = false;
byte rating = 0;
byte lost = 0;
byte claimHue[6];
bool claimFoul[6];
Timer phaseTimer;

byte pulse(word period) { return sin8_C((millis() % period) * 256UL / period); }
Color playerColor(byte id) { return makeColorHSB(id, 255, 255); }
bool better(word t, byte id) { return t < bestTime || (t == bestTime && id < bestId); }

void claim(byte hue, bool foul) {
  if (lost >= 6) return;
  claimHue[lost] = hue; claimFoul[lost] = foul; lost++;
  if (lost >= 6) state = OUT;
}

void joinRound(byte r, byte who) {
  roundId = r; roundDealer = who;
  myTime = bestTime = NONE; bestId = 0; fouled = false; iWon = false; goRelayed = false;
  dealer = (who == myId);
  waitStart = millis();
  if (state != OUT) state = WAIT;
}

void deal() {                                   // start a connected round as the dealer
  byte d[3] = { MSG_START, (byte)(roundId + 1 + random(2)), myId };
  joinRound(d[1], d[2]);
  goAt = millis() + 1500 + random(2500);
  flood(d, 3, 255);
}

void resetAll() { lost = 0; state = IDLE; dealer = false; }

void setup() {
  randomize();
  myId = random(254);
  roundId = random(255);
}

void loop() {
  bool pressed = buttonPressed();
  bool lp = buttonLongPressed();
  buttonSingleClicked(); buttonDoubleClicked(); buttonMultiClicked();
  unsigned long now = millis();
  setValueSentOnAllFaces(state == OUT ? 2 : 1);

  // --- messages
  FOREACH_FACE(f) {
    if (!isDatagramReadyOnFace(f)) continue;
    const byte *d = getDatagramOnFace(f);
    byte n = getDatagramLengthOnFace(f);
    if (n == 3 && d[0] == MSG_START) {
      // a different duel: take it unless we are mid-duel, where two deals at once
      // are settled by the lower dealer id
      bool differs = d[1] != roundId || d[2] != roundDealer;
      bool midDuel = state == WAIT || state == DRAW;
      if (differs && (!midDuel || d[2] < roundDealer)) {
        flood(d, 3, f);
        solo = false;
        joinRound(d[1], d[2]);
      }
    } else if (n == 3 && d[0] == MSG_GO && d[1] == roundId && d[2] == roundDealer) {
      if (!goRelayed) { goRelayed = true; flood(d, 3, f); }          // relay even if we are out
      if (state == WAIT) { state = DRAW; goAt = now; }
    } else if (n == 6 && d[0] == MSG_RES && d[1] == roundId && d[2] == roundDealer) {
      word t = (d[4] << 8) | d[5];
      if (better(t, d[3])) { bestTime = t; bestId = d[3]; flood(d, 6, f); }
    } else if (n == 2 && d[0] == MSG_RESET && d[1] != resetNonce) {
      resetNonce = d[1]; resetAll(); flood(d, 2, f);
    }
    markDatagramReadOnFace(f);
  }

  if (lp) {
    byte d[2] = { MSG_RESET, (byte)(resetNonce + 1 + random(200)) };
    resetNonce = d[1]; resetAll(); flood(d, 2, 255);
  }

  // --- game
  switch (state) {
    case IDLE:
      if (pressed) {
        solo = isAlone();
        if (solo) { goAt = now + 1500 + random(2500); state = WAIT; }
        else deal();
      }
      break;

    case WAIT:
      if (pressed) {
        if (solo) { state = EARLY; phaseTimer.set(900); }
        else if (!fouled) { fouled = true; claim(0, true); }
      } else if ((solo || dealer) && (long)(now - goAt) >= 0) {
        state = DRAW; goAt = now;
        if (dealer) { goRelayed = true; byte d[3] = { MSG_GO, roundId, myId }; flood(d, 3, 255); }
      } else if (!solo && !dealer && now - waitStart > 6000) {
        state = IDLE;                                   // the GO never arrived
      }
      break;

    case DRAW: {
      word since = now - goAt;
      if (pressed && myTime == NONE && !fouled) {
        myTime = since;
        if (solo) {
          rating = since < 200 ? 6 : since < 240 ? 5 : since < 280 ? 4 : since < 330 ? 3 : since < 420 ? 2 : 1;
          state = RESULT; phaseTimer.set(1800);
        } else {
          if (better(myTime, myId)) { bestTime = myTime; bestId = myId; }
          byte d[6] = { MSG_RES, roundId, roundDealer, myId, (byte)(myTime >> 8), (byte)myTime };
          flood(d, 6, 255);
        }
      }
      if (solo && since > 1500 && state == DRAW) state = IDLE;          // too slow
      if (!solo && since > 1800) {                                        // settle the duel
        if (bestTime == NONE) { state = IDLE; break; }
        iWon = (bestId == myId);
        if (!iWon) claim(bestId, false);
        if (state != OUT) { state = RESULT; phaseTimer.set(2000); }
      }
      break;
    }

    case RESULT:
      if (phaseTimer.isExpired()) {
        state = IDLE;
        if (!solo && iWon && !isAlone()) deal();                       // the winner deals next
      }
      break;

    case EARLY:
      if (phaseTimer.isExpired()) state = IDLE;
      break;

    case OUT:
      break;
  }

  pump();

  // --- draw
  if (solo && state != OUT && lost == 0) {
    switch (state) {
      case IDLE:   setColor(dim(ORANGE, 15 + (pulse(1600) >> 2))); break;
      case WAIT:   setColor(RED); break;
      case EARLY:  setColor((now / 80) % 2 ? WHITE : RED); break;
      case DRAW:   setColor(GREEN); break;
      case RESULT: FOREACH_FACE(f) setColorOnFace(f < rating ? makeColorRGB(255, 190, 30) : makeColorRGB(14, 8, 0), f); break;
    }
    return;
  }

  // connected look: unclaimed faces carry the phase, claimed faces show who took them
  bool champion = false;
  if (state == RESULT && iWon) {
    champion = true;
    FOREACH_FACE(f) if (!isValueReceivedOnFaceExpired(f) && getLastValueReceivedOnFace(f) != 2) champion = false;
  }
  FOREACH_FACE(f) {
    Color c;
    if (f < lost) c = claimFoul[f] ? dim(RED, state == OUT ? 50 : 120) : dim(playerColor(claimHue[f]), state == OUT ? 60 : 200);
    else if (champion) c = makeColorHSB((now >> 2) + f * 42, 255, 255);
    else if (state == RESULT && iWon) c = (now / 110) % 2 ? playerColor(myId) : WHITE;
    else if (state == WAIT) c = RED;
    else if (state == DRAW) c = GREEN;
    else c = dim(playerColor(myId), 90);
    setColorOnFace(c, f);
  }
}
