#define PULSE_LENGTH 2000
#define TIMER_LENGTH 6000
Timer redTimer;

void setup() {
  redTimer.set(TIMER_LENGTH);
}

void loop() {
  //get progress from 0 - MAX
  int pulseProgress = millis() % PULSE_LENGTH;

  //transform that progress to a byte (0-255)
  byte pulseMapped = map(pulseProgress, 0, PULSE_LENGTH, 0, 255);

  //transform that byte with sin
  byte dimness = sin8_C(pulseMapped);

  //check if timer is expired
  byte saturation = 0;
  if (!redTimer.isExpired()) {
    int timerProgress = redTimer.getRemaining();
    saturation = map(timerProgress, 0, TIMER_LENGTH, 0, 255);
  }

  //set color
  setColor(makeColorHSB(0, saturation, dimness));
}