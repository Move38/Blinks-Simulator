// SPILL  ·  Blinks Arcade
//
// You own the top segment of your Blink and every matching segment touching it.
// Click to pick a new paint (your segments blink to preview it), double-click to
// pour. Your region takes that paint and soaks up any matching neighbors.
// Solo: cover all six segments in as few pours as you can.
// Connected: paint spreads across touching edges. Pour faster than your neighbors
//   to grab more of the table.
//
// Click         next paint
// Double-click  pour
// Long press    new board on every touching Blink
//
// How it crosses edges: each face broadcasts the segment on that face (owner + paint).
// A neighbor reads it as "the segment touching mine", so territory spreads with one
// local rule and no Blink needs to know its orientation.

#define MSG_POUR  41    // [MSG_POUR, player, paint, generation, tag]
#define MSG_RESET 42    // [MSG_RESET, nonce]

// ---- outbox (see HexBrew for why) ---------------------------------------------------
#define SEND_GAP 60
#define QLEN 2
#define DLEN 5
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

byte owner[6];          // 0 = unclaimed, 1..15 = player
byte col[6];            // paint 0..3
byte myId, myColor, preview, myTag;
byte gen[16];           // last pour generation seen per player
byte resetNonce;
Timer healTimer;

Color paint(byte c) {
  switch (c) { case 0: return makeColorRGB(0, 190, 255); case 1: return makeColorRGB(255, 30, 140); case 2: return makeColorRGB(255, 190, 0); }
  return makeColorRGB(70, 230, 40);
}

void recolor(byte player, byte c) { FOREACH_FACE(f) if (owner[f] == player) col[f] = c; }

void newBoard() {
  myId = 1 + random(14); myTag = random(255);
  FOREACH_FACE(f) { owner[f] = 0; col[f] = random(3); }
  for (byte i = 0; i < 16; i++) gen[i] = 0;
  owner[0] = myId; myColor = preview = col[0];
}

void sendPour(byte exceptFace) { byte d[5] = { MSG_POUR, myId, myColor, gen[myId], myTag }; flood(d, 5, exceptFace); }

void setup() { randomize(); resetNonce = random(255); newBoard(); }

void loop() {
  bool click = buttonSingleClicked();
  bool pour  = buttonDoubleClicked();
  bool lp    = buttonLongPressed();
  buttonMultiClicked();

  // --- messages
  FOREACH_FACE(f) {
    if (!isDatagramReadyOnFace(f)) continue;
    const byte *d = getDatagramOnFace(f);
    byte n = getDatagramLengthOnFace(f);
    if (n == 5 && d[0] == MSG_POUR && d[1] > 0 && d[1] < 16) {
      if (d[1] == myId && d[4] != myTag) {
        // someone else is using our player number: take a new one
        byte old = myId;
        do { myId = 1 + random(14); } while (myId == old);
        FOREACH_FACE(s) if (owner[s] == old && s == 0) owner[s] = myId;
        for (byte k = 0; k < 6; k++) FOREACH_FACE(s) if (owner[s] == old && (owner[(s + 1) % 6] == myId || owner[(s + 5) % 6] == myId)) owner[s] = myId;
        gen[myId] = 0;
      }
      if (d[3] != gen[d[1]] && !(d[1] == myId && d[4] == myTag)) { gen[d[1]] = d[3]; recolor(d[1], d[2] & 3); flood(d, 5, f); }
    } else if (n == 2 && d[0] == MSG_RESET && d[1] != resetNonce) {
      resetNonce = d[1]; newBoard(); flood(d, 2, f);
    }
    markDatagramReadOnFace(f);
  }

  // --- my moves
  if (click) preview = (preview + 1) % 4;
  if (pour) {
    myColor = preview;
    recolor(myId, myColor);
    if (++gen[myId] == 0) gen[myId] = 1;
    sendPour(255);
  }
  if (lp) {
    byte d[2] = { MSG_RESET, (byte)(resetNonce + 1 + random(200)) };
    resetNonce = d[1]; newBoard(); flood(d, 2, 255);
  }
  // repeat our latest pour now and then, so a Blink that missed it catches up
  if (healTimer.isExpired()) { healTimer.set(2000); if (!isAlone()) sendPour(255); }   // also how duplicate numbers get noticed

  // --- absorption: an unclaimed segment touching a claimed segment of the same paint joins it.
  //     Across an edge, the neighbor's face value is the segment that touches ours.
  for (byte pass = 0; pass < 6; pass++) {
    bool changed = false;
    FOREACH_FACE(f) {
      if (owner[f]) continue;
      byte a = (f + 1) % 6, b = (f + 5) % 6;
      if (owner[a] && col[a] == col[f]) { owner[f] = owner[a]; changed = true; continue; }
      if (owner[b] && col[b] == col[f]) { owner[f] = owner[b]; changed = true; continue; }
      if (!isValueReceivedOnFaceExpired(f)) {
        byte v = getLastValueReceivedOnFace(f), vo = v >> 2;
        if (vo && (v & 3) == col[f]) { owner[f] = vo; changed = true; }
      }
    }
    if (!changed) break;
  }

  // --- tell each neighbor about the segment touching it (owner 4 bits + paint 2 bits)
  FOREACH_FACE(f) setValueSentOnFace((owner[f] << 2) | col[f], f);
  pump();

  // --- draw
  bool full = true;
  FOREACH_FACE(f) if (!owner[f]) full = false;
  unsigned long now = millis();
  FOREACH_FACE(f) {
    Color c;
    if (owner[f] == myId) c = (preview != myColor && (now / 220) % 2) ? paint(preview) : paint(col[f]);
    else if (owner[f]) c = dim(paint(col[f]), 190);
    else c = dim(paint(col[f]), 70);
    if (full) c = dim(c, 128 + (sin8_C((now >> 2) + f * 40) >> 1));
    setColorOnFace(c, f);
  }
}
