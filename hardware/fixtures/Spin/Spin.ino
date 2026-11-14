// A test sketch for the hardware-exact spike: one lit face spins every 100 ms,
// and a button press changes its color.
byte face = 0;
byte hue = 0;
Timer spin;

void setup() {
  spin.set(100);
}

void loop() {
  if (buttonPressed()) hue += 40;
  if (spin.isExpired()) {
    face = (face + 1) % FACE_COUNT;
    spin.set(100);
  }
  setColor(OFF);
  setColorOnFace(makeColorHSB(hue, 255, 255), face);
  setValueSentOnAllFaces(face);
}
