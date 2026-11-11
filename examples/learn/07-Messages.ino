/*
 * Send a message
 *
 * Each Blink sends a number (0 to 63) out of its faces, all the time.
 * Neighbors read it with getLastValueReceivedOnFace(face).
 *
 * Click a Blink to change its number. Its neighbors show that number's color.
 */

Color colors[] = { RED, YELLOW, GREEN, CYAN, BLUE, MAGENTA };
byte myNumber = 0;

void setup() {
}

void loop() {
  if (buttonSingleClicked()) {
    myNumber = (myNumber + 1) % 6;
  }
  setValueSentOnAllFaces(myNumber);

  setColor(dim(colors[myNumber], 80));
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      byte theirs = getLastValueReceivedOnFace(f);
      setColorOnFace(colors[theirs], f);
    }
  }
}
