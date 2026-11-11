/*
 * Spread a color through the group
 *
 * Click any Blink: its new color travels from Blink to Blink until the
 * whole group matches. Each Blink sends two things packed into one number:
 * its color (0-5) and a "wave" number (0-3) that changes on every click, so
 * neighbors can tell new news from old news.
 */

Color colors[] = { RED, YELLOW, GREEN, CYAN, BLUE, MAGENTA };
byte color = 0;
byte wave = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    color = (color + 1) % 6;
    wave = (wave + 1) % 4;
  }

  // Take newer news from any neighbor
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      byte value = getLastValueReceivedOnFace(f);
      byte theirWave = value >> 3;        // top bits
      byte theirColor = value & 7;         // bottom bits
      if (theirWave == (wave + 1) % 4) {
        wave = theirWave;
        color = theirColor;
      }
    }
  }

  setValueSentOnAllFaces((wave << 3) | color);
  setColor(colors[color]);
}
