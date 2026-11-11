/*
 * Who is next to me?
 *
 * Blinks talk through their faces with infrared light.
 * isValueReceivedOnFaceExpired(face) is true when nobody is touching that face.
 *
 * Try it: drag Blinks by their rim so they touch.
 */

void setup() {
}

void loop() {
  FOREACH_FACE(f) {
    if (isValueReceivedOnFaceExpired(f)) {
      setColorOnFace(dim(BLUE, 60), f);   // nobody there
    } else {
      setColorOnFace(WHITE, f);          // a neighbor!
    }
  }
}
