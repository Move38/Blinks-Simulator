// A test sketch for the hardware-exact spike: each face is blue while a
// neighbor is heard on it, and green when that neighbor sends 42.
void setup() {
}

void loop() {
  setValueSentOnAllFaces(42);
  setColor(OFF);
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      setColorOnFace(getLastValueReceivedOnFace(f) == 42 ? GREEN : BLUE, f);
    }
  }
}
