/*
 * Spin with a Timer
 *
 * Blinks have no delay(). Instead, a Timer tells you when time is up,
 * and loop() keeps running so the Blink can keep listening and talking.
 */

Timer stepTimer;
byte face = 0;

void setup() {
}

void loop() {
  if (stepTimer.isExpired()) {
    face = (face + 1) % FACE_COUNT;   // move to the next face
    stepTimer.set(150);                // wait 150 milliseconds
  }

  setColor(OFF);
  setColorOnFace(WHITE, face);
}
