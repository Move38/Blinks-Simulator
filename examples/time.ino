self.importScripts('js/blink.js')

const PULSE_LENGTH = 2000
const TIMER_LENGTH = 6000
let redTimer = new Timer(self);

function setup() {
  redTimer.set(TIMER_LENGTH);
}

function loop() {
  
  let pulseProgress = millis() % PULSE_LENGTH;

  
  let pulseMapped = map(pulseProgress, 0, PULSE_LENGTH, 0, 255);

  
  let dimness = sin8_C(pulseMapped);

  
  let saturation = 0;
  if (!redTimer.isExpired()) {
    let timerProgress = redTimer.getRemaining();
    saturation = map(timerProgress, 0, TIMER_LENGTH, 0, 255);
  }

  
  setColor(makeColorHSB(0, saturation, dimness));
}