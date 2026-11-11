// HEXLING  ·  Blinks Arcade
//
// Triple-click the egg to hatch it. Its needs fade over time:
//   click = feed · double-click = play · long press = nap
// Every few seconds (and after you interact) it shows its needs in pairs:
//   orange = food (top), pink = play, blue = rest. A pair blinking red needs you now.
// Connected: Hexlings that touch keep each other company, so play slowly refills,
// and they look toward their friends. An egg hatched next to other pets takes after
// their colors.

byte hue = 0;
bool egg = true;
byte food = 190, play = 190, rest = 190;
unsigned long napUntil = 0, showUntil = 0, fxUntil = 0;
byte fx = 0;                         // 1 eat, 2 play, 3 burp, 4 hatch, 5 wobble
Timer foodT, playT, restT;

byte friendHue(byte f) {             // 255 = no hatched friend on this face
  if (isValueReceivedOnFaceExpired(f)) return 255;
  byte v = getLastValueReceivedOnFace(f);
  return v ? v << 2 : 255;          // face value = hue / 4 (never 0 for a hatched pet)
}
void startFx(byte k, word ms) { fx = k; fxUntil = millis() + ms; }
byte bump(byte v, byte by) { return v > 255 - by ? 255 : v + by; }

void setup() { randomize(); }

void loop() {
  bool c1 = buttonSingleClicked();
  bool c2 = buttonDoubleClicked();
  bool c3 = buttonMultiClicked() && buttonClickCount() >= 3;
  bool lp = buttonLongPressed();
  unsigned long now = millis();
  bool napping = now < napUntil;

  setValueSentOnAllFaces(egg ? 0 : ((hue >> 2) ? (hue >> 2) : 1));   // fits in 6 bits

  bool company = false;
  FOREACH_FACE(f) if (friendHue(f) != 255) company = true;

  if (egg) {
    if (c3) {
      // take after the neighbors: walk the hue halfway toward each friend in turn
      bool first = true;
      FOREACH_FACE(f) {
        byte h = friendHue(f);
        if (h == 255) continue;
        if (first) { hue = h; first = false; } else hue += (int8_t)(h - hue) / 2;
      }
      hue = first ? random(255) : hue + random(20) - 10;
      egg = false; food = play = rest = 180;
      startFx(4, 900);
    } else if (c1 || c2) startFx(5, 400);
  } else {
    // needs fade: food in ~45 s, play in ~30 s (unless a friend is near), rest in ~60 s
    if (foodT.isExpired()) { foodT.set(176); if (food) food--; }
    if (playT.isExpired()) { if (company) { playT.set(98); play = bump(play, 1); } else { playT.set(118); if (play) play--; } }
    if (restT.isExpired()) { if (napping) { restT.set(12); rest = bump(rest, 1); } else { restT.set(235); if (rest) rest--; } }

    if (!napping) {
      if (c1) { if (food > 200) { food = 255; startFx(3, 500); } else { food = bump(food, 77); startFx(1, 450); } showUntil = now + 1500; }
      if (c2) { play = bump(play, 77); startFx(2, 700); showUntil = now + 1500; }
      if (lp) napUntil = now + 4500;
    }
  }

  // --- draw
  bool inFx = now < fxUntil;
  if (egg) {
    byte b = (now / 700) % 6;
    FOREACH_FACE(f) {
      Color c = f == b ? makeColorRGB(150, 140, 110) : makeColorRGB(40, 36, 28);
      if (inFx && fx == 5 && ((now / 60) + f) % 2) c = makeColorRGB(200, 190, 160);
      byte h = friendHue(f);
      if (h != 255) c = makeColorHSB(h, 150, 120);
      setColorOnFace(c, f);
    }
    return;
  }
  if (inFx) {
    FOREACH_FACE(f) {
      Color c;
      if (fx == 4) c = makeColorHSB((now >> 1) + f * 42, 255, 255);
      else if (fx == 3) c = makeColorRGB(60, 255, 80);
      else if (fx == 2) c = makeColorHSB(hue + f * 28 + (now >> 1), 200, 255);
      else c = ((now / 110) + f) % 2 ? makeColorRGB(255, 130, 0) : makeColorHSB(hue, 200, 100);
      setColorOnFace(c, f);
    }
    return;
  }
  if (napping) { setColor(makeColorHSB(hue + 20, 150, 25 + (sin8_C(now >> 4) >> 2))); return; }

  bool needs = now < showUntil || (now % 6000) > 4200;
  if (needs) {
    const byte lv[3] = { food, play, rest };
    const Color col[3] = { makeColorRGB(255, 130, 0), makeColorRGB(255, 50, 170), makeColorRGB(40, 110, 255) };
    FOREACH_FACE(f) {
      byte i = f >> 1;
      setColorOnFace(lv[i] < 64 ? ((now / 300) % 2 ? RED : makeColorRGB(20, 0, 0)) : dim(col[i], 30 + (lv[i] * 225 >> 8)), f);
    }
    return;
  }
  byte mood = min(food, min(play, rest));
  Color base = makeColorHSB(hue, 215, 64 + (mood * 100 >> 8) + (sin8_C(now >> 3) >> 4));
  setColor(base);
  if ((now % 3100) > 150) { setColorOnFace(makeColorHSB(hue, 100, 255), 5); setColorOnFace(makeColorHSB(hue, 100, 255), 1); }   // eyes
  FOREACH_FACE(f) { byte h = friendHue(f); if (h != 255) setColorOnFace(makeColorHSB(h, 215, 230), f); }               // looking at friends
  if (mood > 150 && (now % 2300) < 120) setColorOnFace(WHITE, (now / 2300) % 6);                                          // happy sparkle
}
