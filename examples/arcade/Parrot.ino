// PARROT  ·  Blinks Arcade
//
// The parrot shows a call; copy it with the button:
//   one teal segment      = click
//   two amber segments    = double-click
//   three pink segments   = triple-click
//   all six white         = long press
// Solo: answer every call in order; each round adds one more call.
// Connected ("telephone"): touching Blinks wait (soft teal) until someone clicks to
//   start a chain. When you finish, your Blink adds a call and passes the whole
//   sequence to a touching Blink. That player repeats it and passes it on.
//   A wrong answer ends the chain on that Blink (red); click to start a new one.

#define MSG_SEQ  9          // datagram: [MSG_SEQ, length, packed notes...]
#define MAX_LEN  32         // 32 calls x 2 bits = 8 bytes

enum { IDLE, WAIT, SHOW, INPUT, GOOD, BAD, PASSING };
byte state = WAIT;
byte seq[MAX_LEN / 4];
byte len = 0;
byte idx = 0;
byte echoNote = 0;
byte passFace = 0;
byte tookFace = 255;
unsigned long tookUntil = 0;
Timer phaseTimer, echoTimer;
unsigned long phaseStart;

byte getNote(byte i)          { return (seq[i >> 2] >> ((i & 3) * 2)) & 3; }
void setNote(byte i, byte n)  { byte s = (i & 3) * 2; seq[i >> 2] = (seq[i >> 2] & ~(3 << s)) | (n << s); }

word noteOn()   { int ms = 700 - len * 20; return ms < 360 ? 360 : ms; }
#define NOTE_GAP 260

void go(byte s, word ms) { state = s; phaseStart = millis(); phaseTimer.set(ms); }

void addNoteAndShow() {
  if (len < MAX_LEN) {
    const byte pool[6] = { 0, 0, 1, 1, 2, 3 };      // long presses are slower, so rarer
    setNote(len, pool[random(5)]);
    len++;
  }
  go(SHOW, len * (noteOn() + NOTE_GAP) + 250);
}

void drawNote(byte n) {
  const Color cols[4] = { makeColorRGB(0, 220, 190), makeColorRGB(255, 150, 0), makeColorRGB(255, 40, 170), makeColorRGB(235, 225, 255) };
  switch (n) {
    case 0: setColorOnFace(cols[0], 0); break;
    case 1: setColorOnFace(cols[1], 0); setColorOnFace(cols[1], 3); break;
    case 2: setColorOnFace(cols[2], 0); setColorOnFace(cols[2], 2); setColorOnFace(cols[2], 4); break;
    default: setColor(cols[3]);
  }
}

byte pulse(word period) { return sin8_C((millis() % period) * 256UL / period); }

void setup() {
  randomize();
  go(WAIT, 1000);
}

void loop() {
  // --- read every gesture once per loop
  int8_t g = -1;
  if (buttonSingleClicked()) g = 0;
  if (buttonDoubleClicked()) g = 1;
  if (buttonMultiClicked())  g = buttonClickCount() == 3 ? 2 : 9;   // 4+ clicks never match
  if (buttonLongPressed())   g = 3;

  // tell neighbors whether we can take a sequence (1), and say "took yours" (2) to the sender
  setValueSentOnAllFaces(state == IDLE ? 1 : 0);
  if (tookFace != 255 && millis() < tookUntil) setValueSentOnFace(2, tookFace);

  // --- a sequence arriving from a neighbor
  FOREACH_FACE(f) {
    if (isDatagramReadyOnFace(f)) {
      const byte *d = getDatagramOnFace(f);
      byte n = getDatagramLengthOnFace(f);
      if (state == IDLE && n >= 2 && d[0] == MSG_SEQ && d[1] <= MAX_LEN && n >= 2 + (d[1] + 3) / 4) {
        len = d[1];
        for (byte i = 0; i < MAX_LEN / 4; i++) seq[i] = (i < n - 2) ? d[2 + i] : 0;
        go(SHOW, len * (noteOn() + NOTE_GAP) + 250);
        tookFace = f; tookUntil = millis() + 1200;
      }
      markDatagramReadOnFace(f);
    }
  }

  // --- state machine
  switch (state) {
    case IDLE:
      if (g >= 0) { len = 0; addNoteAndShow(); }           // start a new chain here
      else if (isAlone() && phaseTimer.isExpired()) { len = 0; go(WAIT, 600); }
      break;
    case WAIT:
      if (!isAlone()) go(IDLE, 0);                           // connected: wait for someone to start a chain
      else if (phaseTimer.isExpired()) { len = 0; addNoteAndShow(); }
      break;
    case PASSING:
      // the receiver answers 2 ("took yours"); anything else means it took someone else's chain
      if (!isValueReceivedOnFaceExpired(passFace) && getLastValueReceivedOnFace(passFace) == 2) go(IDLE, 1500);
      else if (phaseTimer.isExpired() || isValueReceivedOnFaceExpired(passFace) || getLastValueReceivedOnFace(passFace) == 0)
        go(SHOW, len * (noteOn() + NOTE_GAP) + 250);                                   // not taken: keep playing here
      break;
    case SHOW:
      if (phaseTimer.isExpired()) { idx = 0; go(INPUT, 0); }
      break;
    case INPUT:
      if (g >= 0) {
        if (g == getNote(idx)) {
          echoNote = g; echoTimer.set(380);
          if (++idx == len) go(GOOD, 850);
        } else {
          go(BAD, 1400);
        }
      }
      break;
    case GOOD:
      if (phaseTimer.isExpired()) {
        // pass the chain to a ready neighbor if there is one, otherwise keep going solo
        byte ready[6], nr = 0;
        FOREACH_FACE(f) if (!isValueReceivedOnFaceExpired(f) && getLastValueReceivedOnFace(f) == 1) ready[nr++] = f;
        if (nr) {
          if (len < MAX_LEN) { const byte pool[6] = { 0, 0, 1, 1, 2, 3 }; setNote(len, pool[random(5)]); len++; }
          byte d[2 + MAX_LEN / 4];
          d[0] = MSG_SEQ; d[1] = len;
          byte nb = (len + 3) / 4;
          for (byte i = 0; i < nb; i++) d[2 + i] = seq[i];
          passFace = ready[random(nr - 1)];
          sendDatagramOnFace(d, 2 + nb, passFace);
          go(PASSING, 700);
        } else {
          addNoteAndShow();
        }
      }
      break;
    case BAD:
      if (phaseTimer.isExpired()) { len = 0; go(isAlone() ? WAIT : IDLE, 800); }
      break;
  }

  // --- draw
  setColor(OFF);
  unsigned long t = millis() - phaseStart;
  switch (state) {
    case IDLE:  setColor(dim(makeColorRGB(0, 150, 120), 30 + (pulse(2400) >> 2))); break;
    case PASSING: setColor(dim(makeColorRGB(0, 150, 120), 120)); break;
    case WAIT:  setColor(dim(WHITE, 15 + (pulse(1200) >> 3))); break;
    case SHOW: {
      word per = noteOn() + NOTE_GAP;
      byte i = t / per;
      if (i < len && (t % per) < noteOn()) drawNote(getNote(i));
      break;
    }
    case INPUT:
      setColor(dim(makeColorRGB(0, 90, 60), 40 + (pulse(1400) >> 2)));
      if (!echoTimer.isExpired()) { setColor(OFF); drawNote(echoNote); }
      break;
    case GOOD:
      FOREACH_FACE(f) setColorOnFace(dim(makeColorRGB(40, 255, 120), 60 + (sin8_C((t >> 2) * 3 - f * 42) * 3 >> 2)), f);
      break;
    case BAD:
      setColor(dim(RED, 255 - (t > 1400 ? 255 : t * 255 / 1400)));
      break;
  }
}
