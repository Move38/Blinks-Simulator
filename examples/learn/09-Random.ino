/*
 * Random colors
 *
 * Every Blink starts with the same random numbers, so without randomize()
 * all your Blinks would pick the same "random" colors.
 * Try deleting randomize() and clicking a few Blinks!
 */

void setup() {
  randomize();
  pickColor();
}

void loop() {
  if (buttonSingleClicked()) {
    pickColor();
  }
}

void pickColor() {
  byte hue = random(255);
  setColor(makeColorHSB(hue, 255, 255));
}
