/*
    Widgets
    by Move38, Inc. 2019
    Lead development by Dan King
    original game by Dan King, Vanilla Liu, Justin Ha, Junege Hong, Kristina Atanasoski, Jonathan Bobrow

    Rules: https://github.com/Move38/Widgets/blob/master/README.md

    --------------------
    Blinks by Move38
    Brought to life via Kickstarter 2018

    @madewithblinks
    www.move38.com
    --------------------
*/

////GENERIC VARIABLES////
enum widgets {DICE, SPINNER, COIN, TIMER};
byte currentWidget = DICE;
enum signalTypes {INERT, GO, RESOLVE};
byte pushSignal = INERT;
byte goSignal = INERT;

Timer animTimer;
byte framesRemaining = 0;
byte outcomeColors[6] = {0, 21, 42, 85, 170, 212};
byte currentOutcome = 1;

bool bChange = false;

////WIDGET VARIABLES////
#define DICE_ROLL_INTERVAL 75
#define COIN_FLIP_INTERVAL 150

#define SPINNER_INTERVAL_RESET 25
#define SPINNER_ACTIVE_DIM 196
#define SPINNER_FINAL_DIM 128
word spinInterval = SPINNER_INTERVAL_RESET;
Timer spinnerFinalPulseTimer;
#define SPINNER_PULSE_DURATION 1000

enum timerModes {SETTING, TIMING, ALARM};
byte timerMode = SETTING;
#define TIMER_SETTING_TICK 250

void setup() {
  randomize();
  startWidget();
}

void loop() {

  // discard the change mode from a force sleep
  if (hasWoken()) {
    bChange = false;
    if (currentWidget == DICE) {
      diceFaceDisplay(currentOutcome);
    } else if (currentWidget == SPINNER) {
      spinnerFaceDisplay(currentOutcome, true);
    }
  }

  //listen for button clicks
  if (buttonSingleClicked()) {
    if (currentWidget == TIMER) {//we're in the timer
      if (timerMode == SETTING) {//it's not currently going
        if (currentOutcome == 5) {
          currentOutcome = 1;
          animTimer.set(TIMER_SETTING_TICK * (currentOutcome + 3));
        } else {
          currentOutcome++;
          animTimer.set(TIMER_SETTING_TICK * (currentOutcome + 3));
        }
      }
    } else {
      startWidget();
    }
  }

  if (buttonLongPressed()) {
    bChange = true;
  }

  if (buttonReleased() && bChange) {
    changeWidget((currentWidget + 1) % 4);
    bChange = false;
  }

  //listen for signals
  pushLoop();
  goLoop();

  //do things
  switch (currentWidget) {
    case DICE:
      diceLoop();
      break;
    case SPINNER:
      spinnerLoop();
      break;
    case COIN:
      coinLoop();
      break;
    case TIMER:
      timerLoop();
      break;
  }

  //set up communication
  byte sendData = (currentWidget << 4) + (pushSignal << 2) + (goSignal);
  setValueSentOnAllFaces(sendData);

  //set it to all white if waiting for longpress release
  if (bChange) {
    setColor(WHITE);
  }
}

void changeWidget(byte targetWidget) {
  currentWidget = targetWidget;
  //currentWidget = (currentWidget + 1) % 4;
  pushSignal = GO;
  if (currentWidget == TIMER) {
    currentOutcome = 1;
    timerMode = SETTING;
    animTimer.set(TIMER_SETTING_TICK * (currentOutcome + 3));
  } else {
    startWidget();
  }
}

void pushLoop() {
  if (pushSignal == INERT) {
    //look for neighbors trying to push me
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
        byte neighborData = getLastValueReceivedOnFace(f);
        if (getPushSignal(neighborData) == GO) {
          //this neighbor is pushing a widget
          changeWidget(getCurrentWidget(neighborData));
          //currentWidget = getCurrentWidget(neighborData);
          pushSignal = GO;
          //if we're not becoming a TIMER, we gotta also roll/spin/flip
          if (currentWidget != TIMER) {
            startWidget();
          } else {
            currentOutcome = 1;
            animTimer.set(TIMER_SETTING_TICK * (currentOutcome + 3));
          }
        }
      }
    }
  } else if (pushSignal == GO) {
    pushSignal = RESOLVE;//this is corrected within the face loop if it shouldn't happen
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
        byte neighborData = getLastValueReceivedOnFace(f);
        if (getPushSignal(neighborData) == INERT) {
          pushSignal = GO;//we should still be in GO, there are neighbors to inform
        }
      }
    }
  } else if (pushSignal == RESOLVE) {
    pushSignal = INERT;//this is corrected within the face loop if it shouldn't happen
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
        byte neighborData = getLastValueReceivedOnFace(f);
        if (getPushSignal(neighborData) == GO) {
          pushSignal = RESOLVE;//we should still be in RESOLVE, there are neighbors to inform
        }
      }
    }
  }
}

void goLoop() {
  if (goSignal == INERT) {
    //look for neighbors trying to push me
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
        byte neighborData = getLastValueReceivedOnFace(f);
        if (getGoSignal(neighborData) == GO) {
          //this neighbor is pushing a go signal
          startWidget();
        }
      }
    }
  } else if (goSignal == GO) {
    goSignal = RESOLVE;//this is corrected within the face loop if it shouldn't happen
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
        byte neighborData = getLastValueReceivedOnFace(f);
        if (getGoSignal(neighborData) == INERT) {
          goSignal = GO;//we should still be in GO, there are neighbors to inform
        }
      }
    }
  } else if (goSignal == RESOLVE) {
    goSignal = INERT;//this is corrected within the face loop if it shouldn't happen
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
        byte neighborData = getLastValueReceivedOnFace(f);
        if (getGoSignal(neighborData) == GO) {
          goSignal = RESOLVE;//we should still be in RESOLVE, there are neighbors to inform
        }
      }
    }
  }
}

void startWidget() {
  switch (currentWidget) {
    case DICE:
      //totalAnimationTimer.set(DICE_ROLL_DURATION);
      currentOutcome = random(5) + 1;
      framesRemaining = 20 + random(5);
      animTimer.set(DICE_ROLL_INTERVAL);
      diceFaceDisplay(currentOutcome);
      break;
    case SPINNER:
      framesRemaining = random(11) + 36;
      spinInterval = SPINNER_INTERVAL_RESET;
      animTimer.set(spinInterval);
      break;
    case COIN:
      framesRemaining = random(3) + 22;
      if (animTimer.isExpired()) {//reset the timer if it isn't currently going
        animTimer.set(COIN_FLIP_INTERVAL);
        if (currentOutcome == 0) {
          currentOutcome = 1;
        } else {
          currentOutcome = 0;
        }
      }
      break;
  }
  goSignal = GO;//happens regardless of type
}

void diceLoop() {
  if (animTimer.isExpired() && framesRemaining > 0) {
    animTimer.set(DICE_ROLL_INTERVAL);
    framesRemaining--;
    currentOutcome += 5;
    if (currentOutcome > 6) {
      currentOutcome = currentOutcome % 6;
    }
    diceFaceDisplay(currentOutcome);
  }
}

void diceFaceDisplay(byte val) {
  byte orientFace = random(5);
  setColor(OFF);
  switch (val) {
    case 1:
      setColorOnFace(RED, orientFace);
      break;
    case 2:
      setColorOnFace(RED, orientFace);
      setColorOnFace(RED, (orientFace + 3) % 6);
      break;
    case 3:
      setColorOnFace(RED, orientFace);
      setColorOnFace(RED, (orientFace + 2) % 6);
      setColorOnFace(RED, (orientFace + 4) % 6);
      break;
    case 4:
      setColor(RED);
      setColorOnFace(OFF, orientFace);
      setColorOnFace(OFF, (orientFace + 3) % 6);
      break;
    case 5:
      setColor(RED);
      setColorOnFace(OFF, orientFace);
      break;
    case 6:
      setColor(RED);
      break;
  }
}

void spinnerLoop() {
  if (animTimer.isExpired() && framesRemaining > 0) {//actively spinning
    framesRemaining--;
    //determine how long the next frame is
    if (framesRemaining < 24) {//we're in the slow down
      spinInterval = (spinInterval * 23) / 20;
    }
    animTimer.set(spinInterval);

    currentOutcome = (currentOutcome + 1) % 6;
    spinnerFaceDisplay(currentOutcome, true);
    if (framesRemaining == 0) { //this is the last frame
      spinnerFinalPulseTimer.set(SPINNER_PULSE_DURATION);
    }
  } else if (framesRemaining == 0) { //just hanging out
    spinnerFaceDisplay(currentOutcome, false);
  }
}

void spinnerFaceDisplay(byte val, bool spinning) {
  if (spinning) {
    FOREACH_FACE(f) {
      setColorOnFace(makeColorHSB(outcomeColors[f], 255, SPINNER_ACTIVE_DIM), f);
    }
    setColorOnFace(WHITE, val);
  } else {
    if (spinnerFinalPulseTimer.isExpired()) {
      spinnerFinalPulseTimer.set(SPINNER_PULSE_DURATION);
    }
    byte saturation = sin8_C(map(spinnerFinalPulseTimer.getRemaining(), 0, SPINNER_PULSE_DURATION, 0, 255));
    setColorOnFace(makeColorHSB(outcomeColors[val], saturation, 255), val);
  }
}

void coinLoop() {
  if (animTimer.isExpired() && framesRemaining > 0) {
    framesRemaining--;
    animTimer.set(COIN_FLIP_INTERVAL);
    //change the outcome from 0 to 1 and back
    if (currentOutcome == 0) {
      currentOutcome = 1;
    } else {
      currentOutcome = 0;
    }
  }

  if (framesRemaining == 0) {
    coinDisplay(true);
  } else {
    coinDisplay(false);
  }
}

void coinDisplay(bool finalFlip) {
  Color faceColor;
  if (currentOutcome == 0) {
    faceColor = YELLOW;
  } else {
    faceColor = WHITE;
  }

  byte animPosition = COIN_FLIP_INTERVAL - animTimer.getRemaining();
  byte leftStart = 0;
  byte centerStart = COIN_FLIP_INTERVAL / 6;
  byte rightStart = COIN_FLIP_INTERVAL / 3;
  byte edgeDuration = (COIN_FLIP_INTERVAL / 3) * 2;

  setColor(OFF);

  if (animPosition >= leftStart && animPosition <= leftStart + edgeDuration) {
    byte brightness = sin8_C(map(animPosition, leftStart, leftStart + edgeDuration, 0, 255));
    setColorOnFace(dim(faceColor, brightness), 0);
    setColorOnFace(dim(faceColor, brightness), 1);
  }

  if (finalFlip && animPosition >= leftStart + (edgeDuration / 2)) {
    setColorOnFace(faceColor, 0);
    setColorOnFace(faceColor, 1);
  }

  if (animPosition >= centerStart && animPosition <= centerStart + edgeDuration) {
    byte brightness = sin8_C(map(animPosition, centerStart, centerStart + edgeDuration, 0, 255));
    setColorOnFace(dim(faceColor, brightness), 2);
    setColorOnFace(dim(faceColor, brightness), 5);
  }

  if (finalFlip && animPosition >= centerStart + (edgeDuration / 2)) {
    setColorOnFace(faceColor, 2);
    setColorOnFace(faceColor, 5);
  }

  if (animPosition >= rightStart && animPosition <= rightStart + edgeDuration) {
    byte brightness = sin8_C(map(animPosition, rightStart, rightStart + edgeDuration, 0, 255));
    setColorOnFace(dim(faceColor, brightness), 3);
    setColorOnFace(dim(faceColor, brightness), 4);
  }

  if (finalFlip && animPosition >= rightStart + (edgeDuration / 2)) {
    setColorOnFace(faceColor, 3);
    setColorOnFace(faceColor, 4);
  }

}

void timerLoop() {

  if (buttonDoubleClicked()) {
    switch (timerMode) {
      case SETTING:
        animTimer.set((currentOutcome * 60000) - 1);
        timerMode = TIMING;
        break;
      case TIMING:
        timerMode = SETTING;
        animTimer.set(0);
        break;
      case ALARM:
        timerMode = SETTING;
        animTimer.set(0);
        break;
    }
  }

  if (animTimer.isExpired()) {
    switch (timerMode) {
      case SETTING:
        animTimer.set(TIMER_SETTING_TICK * (currentOutcome + 3));
        break;
      case TIMING:
        timerMode = ALARM;
        animTimer.set(100);
        break;
      case ALARM:
        animTimer.set(100);
        break;
    }
  }

  timerDisplay();
}

void timerDisplay() {
  switch (timerMode) {
    case SETTING:
      //set color thing going
      {
        byte animFrame = ((TIMER_SETTING_TICK * (currentOutcome + 3)) - animTimer.getRemaining()) / TIMER_SETTING_TICK;//0-X
        if (animFrame == 0) {//the off frame
          setColor(OFF);
        } else {//the rest of the frames
          FOREACH_FACE(f) {
            //should this face be on?
            if (f < animFrame && f <= currentOutcome) {
              setColorOnFace(makeColorHSB(outcomeColors[currentOutcome - 1], 255, 255), f);
            }
          }
        }
      }

      setColorOnFace(WHITE, 0);
      break;
    case TIMING:
      //set overall face color
      {
        byte minutesRemaining = animTimer.getRemaining() / 60000;//0-4
        byte progressBrightness = map((minutesRemaining * 60000) - animTimer.getRemaining(), 0, 60000, 127, 255);
        setColor(makeColorHSB(outcomeColors[minutesRemaining], 255, progressBrightness));

        //set the little ticking color on a specific face
        if (animTimer.getRemaining() % 1000 <= 500) {
          setColorOnFace(WHITE, 5 - ((animTimer.getRemaining() / 1000) % 6));
        }
      }
      break;
    case ALARM:
      if (animTimer.getRemaining() <= 50) {
        setColor(makeColorHSB(outcomeColors[0], 255, 128));
      } else {
        setColor(makeColorHSB(outcomeColors[0], 255, 255));
      }
      break;
  }
}

byte getCurrentWidget(byte data) {
  return (data >> 4);
}

byte getPushSignal(byte data) {
  return ((data >> 2) & 3);
}

byte getGoSignal(byte data) {
  return (data & 3);
}
