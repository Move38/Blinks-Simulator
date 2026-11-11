/*
 * Click to change color
 *
 * Press the middle of a Blink to click its button.
 * buttonSingleClicked() is true once for each click.
 */

Color colors[] = { RED, YELLOW, GREEN, CYAN, BLUE, MAGENTA };
byte current = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    current = (current + 1) % 6;   // 0, 1, 2, 3, 4, 5, then back to 0
  }

  if (buttonDoubleClicked()) {
    current = 0;                   // double-click starts over
  }

  setColor(colors[current]);
}
