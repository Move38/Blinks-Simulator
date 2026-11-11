/*
 *  Astro
 *  by Move38, Inc. 2019
 *  Lead development by Dan King
 *  original game by Diamond and Colby
 *
 *  Rules: https://github.com/Move38/Astro/blob/master/README.md
 *
 *  --------------------
 *  Blinks by Move38
 *  Brought to life via Kickstarter 2018
 *
 *  @madewithblinks
 *  www.move38.com
 *  --------------------
 */

#define RESET_INTERVAL 3000

enum blinkRoles {ASTEROID, SHIP};
byte blinkRole = ASTEROID;

Timer animTimer;
byte animFrame = 0;

#define DIED_MINED    0
#define DIED_NATURAL  5
#define NO_ORE_TARGET 7

////ASTEROID VARIABLES
byte oreLayout[6];
byte oreBrightness[6] = {0, 0, 0, 0, 0, 0};
Color oreColors [5] = {OFF, ORANGE, CYAN, YELLOW, GREEN};  // ORE COLORS ARE ORANGE, GREEN, CYAN, and YELLOW
Timer resetTimer;
byte isMinable[6];
byte fadeColorIndex;

////SHIP VARIABLES
byte missionCount = 6;
byte missionComplete;
byte gameComplete;
byte isMining[6] = {false, false, false, false, false, false};
byte oreTarget = NO_ORE_TARGET;
byte oreCollected;
int miningTime = 500;
byte displayMissionCompleteColor;
byte displayMissionCompleteIndex = 0;

bool bChangeRole = false;
bool bLongPress = false;

void setup() {
  // put your setup code here, to run once:
  randomize(); // make sure our astroid is unique
  newAsteroid();
  updateAsteroid();
  newMission();
}

void loop() {

  // discard role change from force sleep
  if(hasWoken()) {
    bLongPress = false;
  }

  if (buttonLongPressed()) {
    bLongPress = true;
  }

  if(buttonReleased()) {
    if(bLongPress) {
      // now change the role
      bChangeRole = true;
      bLongPress = false;
    }
  }

  switch (blinkRole) {
    case ASTEROID:
      asteroidLoop();
      asteroidDisplay();
      break;
    case SHIP:
      shipLoop();
      shipDisplay();
      break;
  }

  // Long press display to confirm long press
  if(bLongPress) {
    setColorOnFace(CYAN,0);
    setColorOnFace(CYAN,1);
    setColorOnFace(ORANGE,2);
    setColorOnFace(YELLOW,3);
    setColorOnFace(GREEN,4);
    setColorOnFace(GREEN,5);
  }
}

void asteroidLoop() {
  if (bChangeRole) {
    blinkRole = SHIP;
    missionCount = 6;
    newMission();
    gameComplete = false;
    bChangeRole = false;
  }

  //ok, so let's look for ships that need ore
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
      byte neighborData = getLastValueReceivedOnFace(f);
      if (getBlinkRole(neighborData) == SHIP) { //this neighbor is a ship
        //so here we check to see what our relationship to them is
        if (isMinable[f]) {//this is a face we have offered ore to
          if (getShipMining(neighborData) == 1) {//this ship is mining! we can stop offering!
            isMinable[f] = false;
          }
        } else {//this is a face we COULD offer ore to
          if (oreCheck(getShipTarget(neighborData))) {//this is asking for something we have
            removeOre(getShipTarget(neighborData));
            isMinable[f] = true;
          }
        }
      }
    } else {//no neighbor
      isMinable[f] = false;
    }
  }

  //let's check to see if we should renew ourselves!
  if (resetTimer.isExpired() && isAlone()) {
    updateAsteroid();
    resetTimer.set(random(1000) + RESET_INTERVAL);
  }
  //set up communication
  FOREACH_FACE(f) {
    byte sendData = (blinkRole << 4) + (isMinable[f] << 3);
    setValueSentOnFace(sendData, f);
  }
}

void newAsteroid() {
  //clear layout
  FOREACH_FACE(f) {
    oreLayout[f] = 0;
  }
}

bool oreCheck(byte type) {
  bool isAvailable = false;
  FOREACH_FACE(f) {
    if (oreLayout[f] == type) {
      isAvailable = true;
    }
  }
  return (isAvailable);
}

void removeOre(byte type) {
  FOREACH_FACE(f) {
    if (oreLayout[f] == type) {
      oreLayout[f] = DIED_MINED;
    }
  }
}

void updateAsteroid() {
  byte oreCount = 0;
  FOREACH_FACE(f) {
    if (isOrePresentAtIndex(f)) {
      oreCount++;
    }
  }

  if (oreCount == 0) { //add two
    oreLayout[findEmptySpot()] = findNewColor();
    oreLayout[findEmptySpot()] = findNewColor();
  } else if (oreCount == 4) { //remove one
    byte oreToRemove = findFullSpot();
    fadeColorIndex = oreLayout[oreToRemove];
    oreLayout[oreToRemove] = DIED_NATURAL;
  } else {//add one
    oreLayout[findEmptySpot()] = findNewColor();
  }
}

byte findNewColor() {
  byte newColor;

  bool usedColors[5] = {false, false, false, false, false};
  //run through each face and mark that color as used in the array
  FOREACH_FACE(f) {
    usedColors[oreLayout[f]] = true;
  }

  //now do the shuffle search doodad
  byte searchOrder[5] = {0, 1, 2, 3, 4};
  //shuffle array
  for (byte i = 0; i < 10; i++) {
    byte swapA = random(4);
    byte swapB = random(4);
    byte temp = searchOrder[swapA];
    searchOrder[swapA] = searchOrder[swapB];
    searchOrder[swapB] = temp;
  }

  for (byte i = 0; i < 5; i++) {
    if (usedColors[searchOrder[i]] == false) { //this color is not used
      newColor = searchOrder[i];
    }
  }

  return newColor;
  //return 1;
}

byte findEmptySpot() {
  byte emptyFace;
  byte searchOrder[6] = {0, 1, 2, 3, 4, 5};
  //shuffle array
  for (byte i = 0; i < 10; i++) {
    byte swapA = random(5);
    byte swapB = random(5);
    byte temp = searchOrder[swapA];
    searchOrder[swapA] = searchOrder[swapB];
    searchOrder[swapB] = temp;
  }

  //now do the search in this order. The last 0 you find is the empty spot we are going to return
  FOREACH_FACE(f) {
    if ( !isOrePresentAtIndex(searchOrder[f]) ) {
      emptyFace = searchOrder[f];
    }
  }

  return emptyFace;
}

byte findFullSpot() {
  byte fullFace;
  byte searchOrder[6] = {0, 1, 2, 3, 4, 5};
  //shuffle array
  for (byte i = 0; i < 10; i++) {
    byte swapA = random(5);
    byte swapB = random(5);
    byte temp = searchOrder[swapA];
    searchOrder[swapA] = searchOrder[swapB];
    searchOrder[swapB] = temp;
  }

  //now do the search in this order. The last 0 you find is the empty spot we are going to return
  FOREACH_FACE(f) {
    if ( isOrePresentAtIndex(searchOrder[f]) ) {
      fullFace = searchOrder[f];
    }
  }

  return fullFace;
}

void shipLoop() {
  if (bChangeRole) {
    blinkRole = ASTEROID;
    newAsteroid();
    bChangeRole = false;
  }

  //let's look for asteroids that want to trade
  //only do it if we are allowed to
  if (!missionComplete) {
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//a neighbor!
        byte neighborData = getLastValueReceivedOnFace(f);
        if (getBlinkRole(neighborData) == ASTEROID) {//an asteroid!
          //so, what is my relationship to this asteroid?
          if (isMining[f]) { //I'm already mining here
            if (getAsteroidMinable(neighborData) == 0) {//he's done, so I'm done
              isMining[f] = false;
            }
          } else {//I could be mining here if they'd let me
            if (getAsteroidMinable(neighborData) == 1) {//ore is available, take it
              oreCollected++;
              isMining[f] = true;
            }
          }
        }
      } else {//no neighbor
        isMining[f] = false;
      }
    }

    //finally, check to see if the mission is complete
    if (oreCollected == missionCount) {
      missionComplete = true;
      displayMissionCompleteColor = oreTarget;
      displayMissionCompleteIndex = 0;
      resetTimer.set(0);
      // we'll get our next ore target, so no need to do this next line
//      oreTarget = NO_ORE_TARGET; //an ore that doesn't exist
      //oh, also, is gameComplete?
      if (missionCount == 1) {
        gameComplete = true;
      }
    }
  }

  //new mission time?
  if (buttonDoubleClicked()) {
    if (!gameComplete) { //only do this if the game isn't over
      if (missionComplete) {
        missionCount--;
        newMission();
      } else {
        newMission();
      }
    }

  }

  //set up communication
  FOREACH_FACE(f) {
    byte sendData = (blinkRole << 4) + (isMining[f] << 3) + (oreTarget);
    setValueSentOnFace(sendData, f);
  }

}

bool isOrePresentAtIndex( byte i ) {
  return  (oreLayout[i] != DIED_NATURAL && oreLayout[i] != DIED_MINED);
}

void newMission() {
  missionComplete = false;
  byte newOreTarget = oreTarget;
  while (newOreTarget == oreTarget) {
    newOreTarget = random(3) + 1;
  }
  oreTarget = newOreTarget;

  oreCollected = 0;
}

void shipDisplay() {
  if (gameComplete) { //big fancy celebration!
    // Wipe animation
    // TODO: Make this rotate one space at a time, it currently rotates 2 spaces and we have no idea why. Do you know why?
    if (resetTimer.isExpired()) { // add a new face for the next color

      // every 80 ms
      resetTimer.set(50);

      // increment index (0-11)
      displayMissionCompleteIndex = (displayMissionCompleteIndex + 1) % ( 6 * 7 * 4);

      byte index = ((displayMissionCompleteIndex / 7) % 4) + 1;
      setColorOnFace(oreColors[index], displayMissionCompleteIndex % 6);
    }

  }
  else if (missionComplete) { //small celebration

    // Wipe animation
    // TODO: Make this rotate one space at a time, it currently rotates 2 spaces and we have no idea why. Do you know why?
    if (resetTimer.isExpired()) { // add a new face for the next color

      // every 80 ms
      resetTimer.set(50);

      // increment index (0-11)
      displayMissionCompleteIndex = (displayMissionCompleteIndex + 1) % ( 6 * 7 );


      if (((displayMissionCompleteIndex / 7) % 2) == 0) {
        setColorOnFace(oreColors[displayMissionCompleteColor], displayMissionCompleteIndex % 6);
      }
      else {
        setColorOnFace(WHITE, displayMissionCompleteIndex % 6);
      }

    }

  }
  else {//just display ore
    FOREACH_FACE(f) {
      if (missionCount > f) {
        if (oreCollected > f) {
          // show the ore brightly acquired
          setColorOnFace(oreColors[oreTarget], f);
        } else {
          // show the ore is needed here
          if (!resetTimer.isExpired()) {
            if (resetTimer.getRemaining() > 900 ) {
              setColorOnFace(oreColors[oreTarget], f);
            }
            else if ( resetTimer.getRemaining() <= 900 && resetTimer.getRemaining() > 800 ) {
              setColorOnFace(dim(oreColors[oreTarget], 128), f);
            }
            else if ( resetTimer.getRemaining() <= 800 && resetTimer.getRemaining() > 700 ) {
              setColorOnFace(oreColors[oreTarget], f);
            }
            else if ( resetTimer.getRemaining() <= 700 && resetTimer.getRemaining() > 0 ) {
              setColorOnFace(dim(oreColors[oreTarget], 128), f);
            }
          }
          else {
            resetTimer.set(1000);
          }
        }
      } else {
        setColorOnFace(OFF, f);
      }
    }
  }
}

void asteroidDisplay() {
  //run through each face and check on the brightness
  FOREACH_FACE(f) {
    if (isOrePresentAtIndex(f)) { //should be ore here
      if (oreBrightness[f] < 255) { //hey, this isn't full brightness yet
        oreBrightness[f] += 5;
      }
    } else {//should not be ore here
      if (oreBrightness[f] > 0) { //hey, this isn't off
        oreBrightness[f] -= 5;
      }
    }
  }

  FOREACH_FACE(f) {
    Color displayColor = oreColors[oreLayout[f]];
    byte displayBrightness = oreBrightness[f];
    if (displayBrightness > 0) { //a fading ore thing
      // did I die of natural causes
      if (oreLayout[f] == DIED_NATURAL) {
        displayColor = oreColors[fadeColorIndex];
      }
      else if (oreLayout[f] == DIED_MINED) {
        displayColor = WHITE;
      }
    }
    setColorOnFace(dim(displayColor, displayBrightness), f);
  }
}

byte getBlinkRole(byte data) {
  return (data >> 4);//the first two bits
}

byte getShipTarget(byte data) {
  return (data & 7);//the last three bits
}

byte getShipMining(byte data) {
  return ((data >> 3) & 1);//just the third bit
}

byte getAsteroidMinable(byte data) {
  return ((data >> 3) & 1);//just the third bit
}
