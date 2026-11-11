// HEX BREW  ·  Blinks Arcade
//
// The top three segments show the potion to brew; the bottom three show your mix.
// Each color has three strengths. A fourth dose of any color spoils the brew.
//
// Solo:       click = add red · double-click = add green · triple-click = add blue
//             long press = dump the mix
// Connected:  the mix and the potion are shared by every touching Blink.
//             Each Blink holds ONE ingredient (shown when you join or switch).
//             click = add your ingredient · double-click = switch ingredient
//             long press = dump the mix. Split the colors between players.

#define MSG_STATE 11        // [MSG_STATE, version, author, mix, target, event]
enum { EV_NONE, EV_GOOD, EV_BAD, EV_DUMP };

// ---- outbox ------------------------------------------------------------------------
// blinklib keeps one outgoing datagram per face, and a second send before the first has
// gone out silently replaces it. So queue sends and space them out per face.
#define SEND_GAP 60
#define QLEN 2
#define DLEN 6
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

byte mix = 0;               // 2 bits per channel: r | g<<2 | b<<4
byte target = 0;
byte ver = 0;               // 0 = fresh Blink that has never brewed: it adopts, never overwrites
byte author, myId;          // tie-break when two Blinks change the brew at the same moment
byte ingredient;            // 0 red, 1 green, 2 blue (connected mode)

Timer fxTimer, nextTimer, showIngredientTimer, healTimer;
byte fx = EV_NONE;
bool wasAlone = true, waitingNext = false;
bool presentBefore[6];

const byte LV[4] = { 0, 90, 170, 255 };
byte chan(byte m, byte c) { return (m >> (c * 2)) & 3; }
Color colorOf(byte m) { return makeColorRGB(LV[chan(m, 0)], LV[chan(m, 1)], LV[chan(m, 2)]); }

byte newTarget() {
  byte t;
  do { t = random(63); } while (chan(t, 0) + chan(t, 1) + chan(t, 2) < 2 || t == target);
  return t;
}

bool takes(byte v, byte a) {          // should we adopt state (v, a)?
  if (v == 0) return ver == 0 && a > author;                      // fresh vs fresh: higher id wins
  if (ver == 0) return true;                                      // fresh Blinks always adopt
  return (int8_t)(v - ver) > 0 || (v == ver && a > author);       // newer wins, ties by id
}

void sendState(byte ev, byte exceptFace) {
  byte d[6] = { MSG_STATE, ver, author, mix, target, ev };
  flood(d, 6, exceptFace);
}

void startFx(byte ev) {
  fx = ev;
  fxTimer.set(ev == EV_GOOD ? 950 : ev == EV_BAD ? 650 : 400);
}

void commit(byte ev) {               // a local change: bump the version and tell everyone
  ver++; if (ver == 0) ver = 1;
  author = myId;
  startFx(ev);
  sendState(ev, 255);
}

void addDose(byte c) {
  if (!nextTimer.isExpired()) return;                 // potion just finished
  if (chan(mix, c) == 3) { mix = 0; commit(EV_BAD); return; }
  mix += 1 << (c * 2);
  if (mix == target) { commit(EV_GOOD); nextTimer.set(950); }
  else commit(EV_NONE);
}

byte pulse(word period) { return sin8_C((millis() % period) * 256UL / period); }

void setup() {
  randomize();
  myId = author = random(255);
  target = newTarget();
  ingredient = random(2);
  setValueSentOnAllFaces(1);
}

void loop() {
  bool c1 = buttonSingleClicked();
  bool c2 = buttonDoubleClicked();
  bool c3 = buttonMultiClicked() && buttonClickCount() == 3;
  bool lp = buttonLongPressed();
  bool alone = isAlone();

  // --- incoming shared state
  FOREACH_FACE(f) {
    if (isDatagramReadyOnFace(f)) {
      const byte *d = getDatagramOnFace(f);
      if (getDatagramLengthOnFace(f) == 6 && d[0] == MSG_STATE && takes(d[1], d[2])) {
        ver = d[1]; author = d[2]; mix = d[3]; target = d[4];
        if (d[5] != EV_NONE) startFx(d[5]);
        sendState(d[5], f);
      }
      markDatagramReadOnFace(f);
    }
  }

  // --- a new neighbor: offer our state (it decides whether to take it)
  FOREACH_FACE(f) {
    bool present = !isValueReceivedOnFaceExpired(f);
    if (present && !presentBefore[f]) { byte d[6] = { MSG_STATE, ver, author, mix, target, EV_NONE }; post(d, 6, f); }
    presentBefore[f] = present;
  }
  // --- every 2 s, repeat our state so a lost message heals itself
  if (healTimer.isExpired()) { healTimer.set(2000); if (!alone) sendState(EV_NONE, 255); }

  if (wasAlone && !alone) showIngredientTimer.set(1500);
  wasAlone = alone;

  // --- the brewer who finished picks the next potion
  if (!nextTimer.isExpired()) waitingNext = true;
  else if (waitingNext) { waitingNext = false; target = newTarget(); mix = 0; commit(EV_NONE); }

  // --- buttons
  if (alone) {
    if (c1) addDose(0);
    if (c2) addDose(1);
    if (c3) addDose(2);
  } else {
    if (c1) addDose(ingredient);
    if (c2) { ingredient = (ingredient + 1) % 3; showIngredientTimer.set(900); }
  }
  if (lp) { mix = 0; commit(EV_DUMP); }

  pump();

  // --- draw
  setColor(makeColorRGB(8, 8, 14));
  if (!showIngredientTimer.isExpired()) {
    const Color ing[3] = { RED, GREEN, BLUE };
    setColor(ing[ingredient]);
    return;
  }
  if (!fxTimer.isExpired() && fx == EV_GOOD) {
    FOREACH_FACE(f) setColorOnFace(makeColorHSB((millis() >> 1) + f * 42, 255, 255), f);
    return;
  }
  if (!fxTimer.isExpired() && fx == EV_BAD) { setColor(dim(RED, fxTimer.getRemaining() * 255 / 650)); return; }

  Color tc = dim(colorOf(target), 200 + (pulse(1800) >> 3) * 2);
  setColorOnFace(tc, 5); setColorOnFace(tc, 0); setColorOnFace(tc, 1);
  if (mix == 0) {
    setColorOnFace(makeColorRGB(40, 36, 56), 2 + (millis() / 300) % 3);   // empty, stirring
  } else {
    Color mc = colorOf(mix);
    setColorOnFace(mc, 2); setColorOnFace(mc, 3); setColorOnFace(mc, 4);
  }
}
