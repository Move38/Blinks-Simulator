/*
    ZenFlow
    by Move38, Inc. 2019
    Lead development by Dan King
    original game by Dan King, Jonathan Bobrow

    Rules: https://github.com/Move38/ZenFlow/blob/master/README.md

    --------------------
    Blinks by Move38
    Brought to life via Kickstarter 2018

    @madewithblinks
    www.move38.com
    --------------------
*/

//#include "Serial.h"
//ServicePortSerial Serial;

enum modeStates {SPREAD, CONNECT};
byte currentMode;

enum commandStates {INERT, SEND_PERSIST, SEND_SPARKLE, RESOLVING};
byte commandState;//this is the state sent to neighbors
byte internalState;//this state is internal, and does not get sent

// Colors by hue
byte hues[7] = {0, 21, 42, 85, 110, 170, 210};
byte currentHue;
byte sparkleOffset[6] = {0, 3, 5, 1, 4, 2};

#define SEND_DELAY     100
#define SEND_DURATION  800

uint32_t timeOfSend = 0;
uint32_t timeOfPress = 0; // use this to show the button was pressed in connect mode

Timer sendTimer;
Timer transitionTimer;

byte sendData;

bool bChangeMode = false;

void setup() {
  // put your setup code here, to run once:
  //Serial.begin();

  currentMode = SPREAD;
  commandState = INERT;
  internalState = INERT;
  currentHue = 0;

  randomize();
}

void loop() {

  // discard the change mode from a force sleep
  if (hasWoken()) {
    bChangeMode = false;
  }

  // BUTTON HANDLING
  //if single clicked, move to SEND_PERSIST
  if (buttonSingleClicked()) {
    //Serial.println("Single Click Registered");
    if (currentMode == SPREAD) {
      changeInternalState(SEND_PERSIST);
      currentHue = nextHue(currentHue);
      //Serial.print("hue: ");
      //Serial.println(currentHue);
    }
    if (currentMode == CONNECT) {
      timeOfPress = millis();
    }
  }

  //if double clicked, move to SEND_SPARKLE
  if (buttonDoubleClicked()) {
    //Serial.println("Double Click Registered");

    if (currentMode == SPREAD) {
      changeInternalState(SEND_SPARKLE);
      currentHue = millis() % COUNT_OF(hues); //generate a random color
      //Serial.print("hue: ");
      //Serial.println(currentHue);
    }
    if (currentMode == CONNECT) {
      timeOfPress = millis();
    }
  }

  //if long-pressed, move to CONNECT mode
  if (buttonLongPressed()) {
    bChangeMode = true;
  }

  // if change mode
  if (buttonReleased()) {
    if (bChangeMode) {
      switch (currentMode) {
        case CONNECT:   currentMode = SPREAD;   break;
        case SPREAD:    currentMode = CONNECT;  break;
      }
      // reset our states
      changeInternalState(INERT);
      commandState = INERT;
      bChangeMode = false;
    }
  }


  // decide which loop to run
  if (currentMode == SPREAD) {//spread logic loops
    switch (internalState) {
      case INERT:
        inertLoop();
        break;
      case SEND_PERSIST:
        sendPersistLoop();
        break;
      case SEND_SPARKLE:
        sendSparkleLoop();
        break;
      case RESOLVING:
        resolvingLoop();
        break;
    }
  } else if (currentMode == CONNECT) {
    connectLoop();
  }

  //communicate full state
  sendData = (currentMode << 5) + (commandState << 3) + (currentHue);//bit-shifted data to fit in 6 bits
  setValueSentOnAllFaces(sendData);

  //do display work
  if (currentMode == SPREAD) {
    switch (internalState) {
      case RESOLVING:
      case INERT:
        inertDisplay();//both inert and resolving share the same display logic
        break;
      case SEND_PERSIST:
        sendPersistDisplay();
        break;
      case SEND_SPARKLE:
        sendSparkleDisplay();
        break;
    }
  } else if (currentMode == CONNECT) {
    connectDisplay();
  }

  if (bChangeMode) {
    setColor(WHITE);
  }

}


void inertLoop() {

  //now we evaluate neighbors. if our neighbor is in either send state, move to that send state
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      byte neighborData = getLastValueReceivedOnFace(f);
      if (getMode(neighborData) == SPREAD) {
        if (getCommandState(neighborData) == SEND_PERSIST) {
          changeInternalState(SEND_PERSIST);
          currentHue = getHue(neighborData);//you are going to take on the color of the commanding neighbor
          break;  // leave forloop
        }
        else if (getCommandState(neighborData) == SEND_SPARKLE) {
          changeInternalState(SEND_SPARKLE);
          currentHue = millis() % COUNT_OF(hues); //generate a random color
          break;  // leave forloop
        }
      } // end of mode in SPREAD
    } // end of valid value
  }// end of for each face
}

void sendPersistLoop() {
  //first, check if it's been long enough to send the command
  if (sendTimer.isExpired()) {
    commandState = internalState;
  }

  if (transitionTimer.isExpired()) {
    //now check neighbors. If they have all moved into SEND_PERSIST or RESOLVING, you can move to RESOLVING
    //Only do this check if we are past the full display time
    //if we've survived and are stil true, we transition to resolving
    if (canResolve(SEND_PERSIST) && !isAlone()) {
      changeInternalState(RESOLVING);
      commandState = RESOLVING;
    }
  }
}

bool canResolve(byte a) {
  bool canResolve = true;//default to true, set to false in the face loop
  FOREACH_FACE(f) {
    byte neighborData = getLastValueReceivedOnFace(f);//we do this before checking for expired so we can use it to evaluate mode below
    if (!isValueReceivedOnFaceExpired(f) && getMode(neighborData) == SPREAD) {//something is here, and in a compatible mode. We ignore the others
      if (getCommandState(neighborData) != a && getCommandState(neighborData) != RESOLVING) {//it is neither of the acceptable states
        canResolve = false;
      }
    }
  }//end of face loop
  return canResolve;
}

void sendSparkleLoop() {

  //first, check if it's been long enough to send the command
  if (sendTimer.isExpired()) {
    commandState = internalState;
  }

  //here we can transition from sparkle to persist spread
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      byte neighborData = getLastValueReceivedOnFace(f);
      if (getCommandState(neighborData) == SEND_PERSIST && getMode(neighborData) == SPREAD) {
        changeInternalState(SEND_PERSIST);
        currentHue = getHue(neighborData);//you are going to take on the color of the commanding neighbor
      }
    }
  }

  //now check neighbors. If they have all moved into SEND_SPARKLE or RESOLVING, you can move to RESOLVING
  //Only do this check if we are past the full display time
  if (transitionTimer.isExpired()) {
    //if we've survived and are stil true, we transition to resolving
    if (canResolve(SEND_SPARKLE) && !isAlone()) {
      changeInternalState(RESOLVING);
      commandState = RESOLVING;
    }
  }
}

void resolvingLoop() {
  //check neighbors. If they have all moved into RESOLVING or INERT, you can move to INERT
  bool canInert = true;//default to true, set to false in the face loop
  FOREACH_FACE(f) {
    byte neighborData = getLastValueReceivedOnFace(f);//we do this before checking for expired so we can use it to evaluate mode below
    if (!isValueReceivedOnFaceExpired(f) && getMode(neighborData) == SPREAD) {//something is here, and in a compatible mode. We ignore the others
      if (getCommandState(neighborData) != RESOLVING && getCommandState(neighborData) != INERT) {//it is neither of the acceptable states
        canInert = false;
      }
    }
  }//end of face loop

  //if we've survived and are stil true, we transition to resolving
  if (canInert) {
    changeInternalState(INERT);
    commandState = INERT;
  }
}

void connectLoop() {
  // nothing to do here
}

/*
    Data parsing
*/
byte getMode(byte data) {
  return (data >> 5);               //the value in the first bit
}

byte getCommandState (byte data) {
  return ((data >> 3) & 3);         //the value in the second and third bits
}

byte getHue(byte data) {
  return (data & 7);                //the value in the fourth, fifth, and sixth bits
}
/*
    End Data parsing
*/




/*
    Display Animations
*/
// this code uses ~100 Bytes
void inertDisplay() {

  //  setColor(makeColorHSB(hues[currentHue],255,255)); // much less interesting, but fits in memory
  FOREACH_FACE(f) {
    // minimum of 125, maximum of 255
    byte phaseShift = 60 * f;
    byte amplitude = 55;
    byte midline = 185;
    byte rate = 4;
    byte brightness = midline + (amplitude * sin8_C( (phaseShift + millis() / rate) % 255)) / 255;
    byte saturation = 255;

    Color faceColor = makeColorHSB(hues[currentHue], 255, brightness);
    setColorOnFace(faceColor, f);
  }
}

// this code uses ~200 Bytes
void sendPersistDisplay() {
  // go full white and then fade to new color
  uint32_t delta = millis() - timeOfSend;

  // show that we are charged up when alone
  if (isAlone()) {
    while (delta > SEND_DURATION * 3) {
      delta -= SEND_DURATION * 3;
    }
  }

  if (delta > SEND_DURATION) {
    delta = SEND_DURATION;
  }

  FOREACH_FACE(f) {
    // minimum of 125, maximum of 255
    byte phaseShift = 60 * f;
    byte amplitude = 55;
    byte midline = 185;
    byte rate = 4;
    byte brightness = midline + (amplitude * sin8_C ( (phaseShift + millis() / rate) % 255)) / 255;
    byte saturation = map(delta, 0, SEND_DURATION, 0, 255);

    Color faceColor = makeColorHSB(hues[currentHue], saturation, brightness);
    setColorOnFace(faceColor, f);
  }
}

// this code uses ~400 Bytes
void sendSparkleDisplay() {
  // go full white and then fade to new color, pixel by pixel
  uint32_t delta = millis() - timeOfSend;

  // show that we are charged up when alone
  if (isAlone()) {
    while (delta > SEND_DURATION * 3) {
      delta -= SEND_DURATION * 3;
    }
  }

  if (delta > SEND_DURATION) {
    delta = SEND_DURATION;
  }

  byte offset = 50;

  FOREACH_FACE(f) {

    // if the face has started it's glow
    uint16_t sparkleStart = sparkleOffset[f] * offset;
    uint16_t sparkleEnd = sparkleStart + SEND_DURATION - (6 * offset);

    if ( delta > sparkleStart ) {
      // minimum of 125, maximum of 255
      byte phaseShift = 60 * f;
      byte amplitude = 55;
      byte midline = 185;
      byte rate = 4;
      byte lowBri = midline + (amplitude * sin8_C( (phaseShift + millis() / rate) % 255)) / 255;
      byte brightness;
      byte saturation;

      if ( delta < sparkleEnd ) {
        brightness = lowBri + 255 - map(delta, sparkleStart, sparkleStart + SEND_DURATION - (6 * offset), lowBri, 255);
        saturation = map(delta, sparkleStart, sparkleStart + SEND_DURATION - (6 * offset), 0, 255);
      }
      else {
        brightness = lowBri;
        saturation = 255;
      }

      Color faceColor = makeColorHSB(hues[currentHue], saturation, brightness);
      setColorOnFace(faceColor, f);
    }
  }
}

// this code uses ~300 Bytes
void connectDisplay() {
  // go full white and then fade to new color, pixel by pixel
  uint32_t delta = millis() - timeOfPress;
  if ( delta > 300) {
    delta = 300;
  }

  if (isAlone()) { //so this is a lonely blink. we just set it to full white
    // minimum of 125, maximum of 255
    byte amplitude = 30;
    byte midline = 100;
    byte rate = 4;
    byte brightness = midline + (amplitude * sin8_C( (millis() / rate) % 255)) / 255;

    // if the button recently pressed, dip and then raise up
    brightness = map(delta, 0, 300, 0, brightness);

    Color faceColor = makeColorHSB(0, 0, brightness);
    setColor(faceColor);

  } else {
    setColor(OFF);//later in the loop we'll add the colors
  }

  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) { //something there
      byte neighborData = getLastValueReceivedOnFace(f);
      //now we figure out what is there and what to do with it
      if (getMode(neighborData) == SPREAD) { //this neighbor is in spread mode. Just display the color they are on that face
        byte brightness = map(delta, 0, 300, 0, 255);
        Color faceColor = makeColorHSB(hues[getHue(neighborData)], 255, brightness);
        setColorOnFace(faceColor, f);
      } else if (getMode(neighborData) == CONNECT) { //this neighbor is in connect mode. Display a white connection
        byte brightness = map(delta, 0, 300, 0, 255);
        setColorOnFace(makeColorHSB(0, 0, brightness), f);
      }
    }
  }//end of face loop
}

/*
    Data parsing
*/
void changeInternalState(byte state) {
  //this is here for the moment of transition. mostly housekeeping
  switch (state) {
    case INERT:
      ////serial.println("I'm just hangin' tight.");
      // nothing to do here
      break;
    case SEND_PERSIST:
      //serial.println("show the next color and spread it");
      timeOfSend = millis();
      sendTimer.set(SEND_DELAY);
      transitionTimer.set(SEND_DURATION);
      break;
    case SEND_SPARKLE:
      //serial.println("a little sparkle for y'all");
      timeOfSend = millis();
      sendTimer.set(SEND_DELAY);
      transitionTimer.set(SEND_DURATION);
      break;
    case RESOLVING:
      //serial.println("I'm in my happy place :)");
      // nothing to do here
      break;
  }

  internalState = state;
}


byte nextHue(byte h) {
  byte nextHue = (h + 1) % COUNT_OF(hues);
  return nextHue;
}
