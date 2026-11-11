/*
    Speed Racer
    by Move38, Inc. 2019
    Lead development by Dan King
    original game by Dan King, Jonathan Bobrow

    Rules: https://github.com/Move38/SpeedRacer/blob/master/README.md

    --------------------
    Blinks by Move38
    Brought to life via Kickstarter 2018

    @madewithblinks
    www.move38.com
    --------------------
*/

enum faceRoadStates {LOOSE, ROAD, SIDEWALK, CRASH};
byte faceRoadInfo[6];

enum handshakeStates {NOCAR, HAVECAR, READY, CARSENT};
byte handshakeState[6];
Timer datagramTimeout;
#define DATAGRAM_TIMEOUT_LIMIT 150

byte turns[3][6] = { {5, 25, 50, 75, 95, 25}, // left hand turn
  {5, 33, 66, 95, 66, 33}, // straight away
  {5, 25, 95, 75, 50, 25}  // right hand turn
};

bool isLoose = true;

bool hasDirection = false;
byte entranceFace = 0;
byte exitFace = 0;

bool haveCar = false;
byte carProgress = 0;//from 0-100 is the regular progress

bool isCarPassed[6];
uint32_t timeCarPassed[6];
byte carBrightnessOnFace[6];

#define FADE_DURATION       1500
#define FADE_ROAD_DURATION  500
#define CRASH_DURATION      2000

uint32_t timeOfShockwave = 0;

byte currentSpeed = 1;

enum CarClass {
  STANDARD,
  BOOSTED
};

byte currentCarClass = STANDARD;

#define SPEED_INCREMENTS_STANDARD 35
#define SPEED_INCREMENTS_BOOSTED  70

#define MIN_TRANSIT_TIME_STANDARD 666 // HIGHWAY TO HELL
#define MAX_TRANSIT_TIME_STANDARD 1200
#define MIN_TRANSIT_TIME_BOOSTED  200
#define MAX_TRANSIT_TIME_BOOSTED  1000

word currentTransitTime;

Timer transitTimer;

byte carHues[4] = {80, 111, 160, 215}; // TODO: Set these colors purposefully
byte currentCarHue = 0; // index of the car color

bool crashHere = false;
uint32_t timeOfCrash = 0;
Timer crashTimer;
#define CRASH_TIME 2500

#define CAR_FADE_IN_DIST   200   // kind of like headlights

enum ShockwaveStates {
  INERT,
  SHOCKWAVE,
  TRANSITION,
  EASY_SETUP
};
byte shockwaveState = INERT;

/*
    SETUP
*/

void setup() {
  randomize();
}

/*
    LOOP
*/

void loop() {
  // on double click we send a message to all connected pieces to propogate an easy setup road
  if (buttonDoubleClicked()) {
    easySetup();
  }

  //run loops
  if (isLoose) {
    looseLoop();
  } else if (crashHere) {
    crashLoop();
  } else if (haveCar) {
    roadLoopCar();
  } else {
    roadLoopNoCar();
  }

  //shockwave handling
  shockwaveLoop();

  //run graphics
  graphics();

  //update communication
  FOREACH_FACE(f) {
    byte sendData = (faceRoadInfo[f] << 4) + (handshakeState[f] << 2) + shockwaveState;
    setValueSentOnFace(sendData, f);
  }

  //clear button presses
  buttonSingleClicked();
  buttonMultiClicked();
}

void looseLoop() {
  if (!isAlone()) {
    //so I look at all faces, see what my options are
    bool foundRoadNeighbor = false;
    bool foundLooseNeighbor = false;
    byte currentChoice;
    FOREACH_FACE(f) {
      //should I still be looking?
      if (!foundRoadNeighbor) {//only look if I haven't found a road neighbor
        if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
          byte neighborData = getLastValueReceivedOnFace(f);
          if (getRoadState(neighborData) == ROAD) {//so this neighbor is a road. Sweet!
            foundRoadNeighbor = true;
            currentChoice = f;
          } else if (getRoadState(neighborData) == LOOSE) {
            foundLooseNeighbor = true;
            currentChoice = f;
          }
        }
      }
    }

    //if we have found any legit neighbor, we can transition out of loose
    if (foundRoadNeighbor || foundLooseNeighbor) {
      FOREACH_FACE(f) {
        faceRoadInfo[f] = SIDEWALK;
      }
      faceRoadInfo[currentChoice] = ROAD;
      entranceFace = currentChoice;       // Helps us draw the road
      completeRoad(currentChoice);
      isLoose = false;

    } else {
      //TODO: error state for bad placement
    }
  }
}

void completeRoad(byte startFace) {
  //so we've been fed a starting point
  //we need to assign an exit point based on some rules
  bool foundRoadExit = false;
  byte currentChoice = (startFace + 2 + random(1) + random(1)) % 6; //random(1) + random(1) -> assigns a straightaway 50% of the time

  //now run through the legal exits and check for preferred exits
  FOREACH_FACE(f) {
    if (isValidExit(startFace, f)) {
      if (!foundRoadExit) {
        if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
          byte neighborData = getLastValueReceivedOnFace(f);
          if (getRoadState(neighborData) == ROAD) {//first choice: a road
            foundRoadExit = true;
            currentChoice = f;
          } else if (getRoadState(neighborData) == LOOSE) {//second choice: a loose blink
            currentChoice = f;
          } else {//last choice: a blink (not an empty face)
            currentChoice = f;
          }//if none are chosen, it will just go with the randomly chosen face from before this loop
        }
      }
    }
  }//end face loop

  //so after this process, we can be confident that a ROAD has been chosen
  //or failing that, a LOOSE has been chosen
  //or failing that just a random face has been chosen
  faceRoadInfo[currentChoice] = ROAD;
  exitFace = currentChoice; // Helps us draw the road
}

bool isValidExit(byte startFace, byte exitFace) {
  return ( dist(startFace, exitFace) >= 2 &&  dist(startFace, exitFace) <= 4 );
}

void roadLoopNoCar() {

  FOREACH_FACE(f) {
    if (faceRoadInfo[f] == ROAD) {//things can arrive here
      if (handshakeState[f] == NOCAR) {//I have no car here. Does my neighbor have a car?
        if (!isValueReceivedOnFaceExpired(f)) {//there's someone on this face
          byte neighborData = getLastValueReceivedOnFace(f);
          if (getHandshakeState(neighborData) == HAVECAR) {
            handshakeState[f] = READY;
          }
        }
      } else if (handshakeState[f] == READY) {//I am ready. Look for changes
        //did my neighbor disappear, change to CRASH or NOCAR?
        if (isValueReceivedOnFaceExpired(f)) {//my neighbor has left. Guess that's not happening
          handshakeState[f] = NOCAR;
        } else {//neighbor still there. have they changed in another way?
          byte neighborData = getLastValueReceivedOnFace(f);
          if (getRoadState(neighborData) != ROAD) { //huh, I guess they changed in a weird way
            handshakeState[f] = NOCAR;
          } else {//they're still a road. did their handshakeState change?
            if (getHandshakeState(neighborData) == NOCAR || getHandshakeState(neighborData) == READY) {//another weird failure
              handshakeState[f] = NOCAR;
            } else if (getHandshakeState(neighborData) == CARSENT) {
              //look for the speedDatagram
              if (isDatagramReadyOnFace(f)) {//is there a packet?
                if (getDatagramLengthOnFace(f) == 3) {//is it the right length?
                  byte *data = (byte *) getDatagramOnFace(f);//grab the data
                  currentSpeed = data[0];
                  currentCarClass = data[1];
                  currentCarHue = data[2];

                  //THEY HAVE SENT THE CAR. BECOME THE ACTIVE GUY
                  FOREACH_FACE(ff) {
                    handshakeState[ff] = NOCAR;
                  }
                  haveCar = true;
                  resetIsCarPassed();
                  currentTransitTime = map(getSpeedIncrements() - currentSpeed, 0, getSpeedIncrements(), getMinTransitTime(), getMaxTransitTime());
                  transitTimer.set(currentTransitTime);

                  hasDirection = true;
                  entranceFace = f;
                  exitFace = findOtherSide(entranceFace);
                  handshakeState[entranceFace] = HAVECAR;
                  handshakeState[exitFace] = HAVECAR;

                  markDatagramReadOnFace( f ); // free datagram buffer
                }
              }
            }
          }
        }
      }
    }
  }

  //check all neighbors to make sure there is something besides empties or sidewalks facing you
  bool foundLegitNeighbor = false;
  FOREACH_FACE(f) {
    if (faceRoadInfo[f] == ROAD) {//this is a face I think could or should be a road
      if (!isValueReceivedOnFaceExpired(f)) { //neighbor!
        if (getRoadState(getLastValueReceivedOnFace(f)) != SIDEWALK) { //this is a legit neighbor
          foundLegitNeighbor = true;
        }
      }
    }
  }

  //if you are (functionally) alone, GO LOOSE
  if (!foundLegitNeighbor) {
    goLoose();
  }

  //if I'm clicked, I will attempt to spawn the car (only happens if there is a legitimate exit choice)
  if (buttonSingleClicked()) {
    spawnCar(STANDARD);
  }

  if (buttonMultiClicked()) {
    spawnCar(BOOSTED);
  }

}

void spawnCar(byte carClass) {
  FOREACH_FACE(f) {
    if (!hasDirection) {
      if (faceRoadInfo[f] == ROAD) {//this could be my exit
        if (!isValueReceivedOnFaceExpired(f)) {//there is someone there
          byte neighborData = getLastValueReceivedOnFace(f);
          if (getRoadState(neighborData) == ROAD) {//so this is a road I can send to. DO IT ALL
            //set direction
            hasDirection = true;
            exitFace = f;
            entranceFace = findOtherSide(exitFace);

            //set outgoing data
            FOREACH_FACE(ff) {
              handshakeState[ff] = NOCAR;
            }
            handshakeState[exitFace] = HAVECAR;

            // set the car class
            currentCarClass = carClass;

            // choose a hue for this car
            currentCarHue = random(3);

            // launch car
            haveCar = true;
            resetIsCarPassed();
            if (carClass == BOOSTED) {
              currentSpeed = (buttonClickCount() * 10) - 29;
              if (currentSpeed > SPEED_INCREMENTS_BOOSTED) {
                currentSpeed = SPEED_INCREMENTS_BOOSTED;
              }
            }
            currentTransitTime = map(getSpeedIncrements() - currentSpeed, 0, getSpeedIncrements(), getMinTransitTime(), getMaxTransitTime());
            transitTimer.set(currentTransitTime);
          }
        }
      }
    }
  }
}

void goLoose() {
  isLoose = true;

  FOREACH_FACE(f) {
    faceRoadInfo[f] = LOOSE;
    isCarPassed[f] = false;
    timeCarPassed[f] = 0;
    carBrightnessOnFace[f] = 0;
  }

  loseCar();
}

void loseCar() {
  hasDirection = false;
  haveCar = false;
  carProgress = 0;//from 0-100 is the regular progress
  currentSpeed = 1;
  crashHere = false;
  timeOfCrash = 0;
  FOREACH_FACE(f) {
    handshakeState[f] = NOCAR;
  }
}

void resumeRoad() {
  FOREACH_FACE(f) {
    faceRoadInfo[f] = SIDEWALK;
  }
  faceRoadInfo[entranceFace] = ROAD;
  faceRoadInfo[exitFace] = ROAD;
}

byte findOtherSide(byte entrance) {
  FOREACH_FACE(f) {
    if (isValidExit(entrance, f)) {
      if (faceRoadInfo[f] == ROAD) {
        return f;
      }
    }
  }
}

void roadLoopCar() {

  if (handshakeState[exitFace] == HAVECAR) {
    //wait for the timer to expire and pass the car
    if (transitTimer.isExpired()) {
      //ok, so here is where shit gets tricky
      if (!isValueReceivedOnFaceExpired(exitFace)) {//there is someone on my exitFace
        byte neighborData = getLastValueReceivedOnFace(exitFace);
        if (getRoadState(neighborData) == ROAD) {
          if (getHandshakeState(neighborData) == READY) {
            handshakeState[exitFace] = CARSENT;

            byte speedDatagram[3];  // holds speed, car class, car hue
            if (currentSpeed + 1 <= getSpeedIncrements()) {
              speedDatagram[0] = currentSpeed + 1;
            } else {
              speedDatagram[0] = currentSpeed;
            }
            speedDatagram[1] = currentCarClass;
            speedDatagram[2] = currentCarHue;
            sendDatagramOnFace(&speedDatagram, sizeof(speedDatagram), exitFace);

            datagramTimeout.set(DATAGRAM_TIMEOUT_LIMIT);

          } else {
            //CRASH because not ready
            crashBlink();
          }
        } else {
          //CRASH crash because not road
          crashBlink();
        }
      } else {
        //CRASH because not there!
        crashBlink();
      }
    }
  } else if (handshakeState[exitFace] == CARSENT) {
    if (!isValueReceivedOnFaceExpired(exitFace)) {//there's someone on my exit face
      if (getHandshakeState(getLastValueReceivedOnFace(exitFace)) == HAVECAR) {//the car has been successfully passed
        handshakeState[exitFace] = NOCAR;
        loseCar();
      }
    }
    //if I'm still in CARSENT and my datagram timeout has expired, then we can assume the car is lost and we've crashed
    if (handshakeState[exitFace] == CARSENT) {
      if (datagramTimeout.isExpired()) {
        //CRASH because timeout
        crashBlink();
      }
    }
  }

  // Car progress for animation loop (when did the car pass each face)
  FOREACH_FACE(f) {
    // did the car just pass us
    if (!isCarPassed[f]) {
      carProgress = (100 * (currentTransitTime - transitTimer.getRemaining())) / currentTransitTime;
      if (didCarPassFace(f, carProgress, entranceFace, exitFace)) {
        timeCarPassed[f] = millis();
        isCarPassed[f] = true;
      }
    }
  }
}

void crashBlink() {
  shockwaveState = SHOCKWAVE;
  timeOfShockwave = millis();
  isLoose = false;
  timeOfCrash = millis();
  crashHere = true;
  FOREACH_FACE(f) {
    faceRoadInfo[f] = CRASH;
  }
  crashTimer.set(CRASH_TIME);
}

void crashLoop() {
  if (crashTimer.isExpired()) {
    loseCar();
    resumeRoad();
  }
}

/*
  This function does the following:

  if inert
    if neighbor in shockwave
      shockwave
  if shockwave
    if no neighbors are inert
      trans
  if trans
    if no neighbors in shockwave
      inert
*/
void shockwaveLoop() {
  bool bInert = false;
  bool bShock = false;
  bool bEasy = false;

  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {
      byte state = getShockwaveState(getLastValueReceivedOnFace(f));
      if (state == INERT) {
        bInert = true;
      }
      else if (state == SHOCKWAVE) {
        bShock = true;
      }
      else if (state == EASY_SETUP) {
        bEasy = true;
      }
    }
  }

  if (shockwaveState == INERT) {
    if (bShock) {
      shockwaveState = SHOCKWAVE;
      timeOfShockwave = millis();
    }
    if (bEasy) {
      easySetup();  // do it :)
    }
  }
  else if (shockwaveState == SHOCKWAVE || shockwaveState == EASY_SETUP) {
    if (!bInert) {
      shockwaveState = TRANSITION;
    }
  }
  else if (shockwaveState == TRANSITION) {
    if (!bShock && !bEasy) {
      shockwaveState = INERT;
    }
  }
}

byte getRoadState(byte neighborData) {
  return (neighborData >> 4);//1st and 2nd bits
}

byte getHandshakeState(byte neighborData) {
  return ((neighborData >> 2) & 3);//3rd and 4th bits
}

byte getShockwaveState(byte neighborData) {
  return (neighborData & 3);//5th and 6th bits
}

/*
   THE REAL DEAL
*/
void graphics() {
  // clear buffer
  setColor(OFF);

  FOREACH_FACE(f) {

    // first draw the car fade
    if (millis() - timeCarPassed[f] > FADE_DURATION) {
      carBrightnessOnFace[f] = 0;

      // draw the road
      if (faceRoadInfo[f] == ROAD) {
        if (millis() - timeCarPassed[f] < FADE_ROAD_DURATION + FADE_DURATION) {
          byte roadBrightness = (millis() - timeCarPassed[f] - FADE_DURATION) / 2;
          setColorOnFace(dim(YELLOW, roadBrightness), f);
        }
        else {
          //determine if this is a loose end
          if (isValueReceivedOnFaceExpired(f) || getRoadState(getLastValueReceivedOnFace(f)) != ROAD) { //no neighbor or non-road neighbor
            setColorOnFace(RED, f);
          } else {
            setColorOnFace(YELLOW, f);
          }
        }
      }

    }
    else {
      // in the beginning, quick fade in
      if (millis() - timeCarPassed[f] > CAR_FADE_IN_DIST ) {
        carBrightnessOnFace[f] = 255 - map(millis() - timeCarPassed[f] - CAR_FADE_IN_DIST, 0, FADE_DURATION - CAR_FADE_IN_DIST, 0, 255);
      }
      else {
        carBrightnessOnFace[f] = map(millis() - timeCarPassed[f], 0, CAR_FADE_IN_DIST, 0, 255);
      }

      // Draw our car
      if (currentCarClass == STANDARD) {
        setColorOnFace(makeColorHSB(carHues[currentCarHue], 255, carBrightnessOnFace[f]), f);
      }
      else {
        setColorOnFace(dim(WHITE, carBrightnessOnFace[f]), f);
      }

    }
  }

  if (isLoose) {
    standbyGraphics();
  }

  if (millis() - timeOfShockwave < 500) {
    Color shockwaveColor = makeColorHSB((millis() - timeOfShockwave) / 12, 255, 255);
    setColorOnFace(shockwaveColor, entranceFace); // should really be 3x as long, with a delay for the travel of the effect
    setColorOnFace(shockwaveColor, exitFace);
  }

  if ( millis() - timeOfCrash < CRASH_TIME ) {
    setColor(RED);
    // show fiery wreckage
    FOREACH_FACE(f) {
      byte shakiness = map(millis() - timeOfCrash, 0, CRASH_TIME, 0, 30);
      //byte bri = 200 - map(millis() - timeOfCrash, 0, CRASH_TIME, 0, 200) + random(55);
      //setColorOnFace(makeColorHSB(0, random(55) + 200, bri), f);
      setColorOnFace(makeColorHSB(30 - shakiness, 255, 255 - (shakiness * 6) - random(55)), f);
    }

    //    crashGraphics();
  }
}

/*
   SPEED CONVENIENCE FUNCTIONS
*/

word getSpeedIncrements() {
  if (currentCarClass == STANDARD) {
    return SPEED_INCREMENTS_STANDARD;
  }
  else {
    return SPEED_INCREMENTS_BOOSTED;
  }
}

word getMinTransitTime() {
  if (currentCarClass == STANDARD) {
    return MIN_TRANSIT_TIME_STANDARD;
  }
  else {
    return MIN_TRANSIT_TIME_BOOSTED;
  }
}

word getMaxTransitTime() {
  if (currentCarClass == STANDARD) {
    return MAX_TRANSIT_TIME_STANDARD;
  }
  else {
    return MAX_TRANSIT_TIME_BOOSTED;
  }
}

/*
   GRAPHICS
   Fade out the car based on a trail length or timing fade away
*/

void standbyGraphics() {

  // circle around with a trail
  // 2 with trails on opposite sides
  word rotation = (millis() / 3) % 360;
  byte head = rotation / 60;

  FOREACH_FACE(f) {

    if (dist(head, f) == 0 || dist(head, f) == 3) {
      setColorOnFace(ORANGE, f);
    }
  }
}

// returns # of positions away
// closed loop 0-5
byte dist(byte a, byte b) {
  return (6 + a - b) % 6;
}

void resetIsCarPassed() {
  FOREACH_FACE(f) {
    isCarPassed[f] = false;
  }
}

bool didCarPassFace(byte face, byte pos, byte from, byte to) {

  // are we going straight, turning left, or turning right
  byte center;
  byte faceRotated = (6 + face - from) % 6;
  byte dir = ((from + 6 - to) % 6) - 2;

  return pos > turns[dir][faceRotated];
}

/*
   Easy Road Setup
*/
void easySetup() {
  goLoose();
  shockwaveState = EASY_SETUP;  // first let's establish our state
}
