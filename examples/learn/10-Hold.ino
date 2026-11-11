/*
 * Press, hold and let go
 *
 * buttonDown() is true while the button is held.
 * buttonLongPressed() fires once after holding for a little over a second.
 */

bool longPress = false;

void setup() {
}

void loop() {
  if (buttonLongPressed()) {
    longPress = true;
  }
  if (buttonReleased()) {
    longPress = false;
  }

  if (longPress) {
    setColor(MAGENTA);
  } else if (buttonDown()) {
    setColor(YELLOW);
  } else {
    setColor(dim(WHITE, 40));
  }
}
