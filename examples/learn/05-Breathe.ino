/*
 * Breathe
 *
 * sin8_C() turns a steadily growing number into a smooth wave from 0 to 255.
 * dim() uses that wave to fade a color in and out.
 */

void setup() {
}

void loop() {
  byte wave = sin8_C(millis() / 8);    // one breath every ~2 seconds
  setColor(dim(CYAN, wave));
}
