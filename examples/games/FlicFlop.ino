/*
    FlicFlop
    by Move38, Inc. 2019
    Lead development by Dan King
    original game by Nick Bentley, Jonathan Bobrow, Dan King

    Rules: https://github.com/Move38/Astro/blob/master/README.md

    --------------------
    Blinks by Move38
    Brought to life via Kickstarter 2018

    @madewithblinks
    www.move38.com
    --------------------
*/

enum gameStates {FLICKER_UNSCORED, FLICKER_SCORED, FLICKER_DISPLAY, FLOPPER};
byte gameState = FLICKER_UNSCORED;
bool longPressCheck = false;

#define TEAM_COUNT 3
byte scoringTeam = 0;
byte signalTeam = 0;

enum celebrationStates {INERT, CELEBRATE, TRANSITION};
byte celebrationState = INERT;

Timer flopTimer;
#define FLOP_INTERVAL 2000


Timer animTimer;
#define ANIMATION_INTERVAL 200
byte animationInterval = ANIMATION_INTERVAL;

#define ANIMATION_CELEBRATE_INTERVAL 20
Timer celebrationTimer;
#define CELEBRATE_TIME 2000

byte spinFace = 0;
byte teamHues[4] = {0, 45, 125, 230};

void setup() {
  // put your setup code here, to run once:

}

void loop() {

  if (hasWoken()) {
    longPressCheck = false;
  }

  // put your main code here, to run repeatedly:
  if (gameState == FLOPPER) {
    flopperLoop();
    flopperDisplay();
  } else {
    flickerLoop();
    flickerDisplay();
  }

  //animate the spin face
  spinFaceAnimator();

  //set up communication
  byte sendData = (signalTeam << 4) + (scoringTeam << 2) + (celebrationState);
  setValueSentOnAllFaces(sendData);

  if (buttonSingleClicked()) {
    beginCelebration();
  }

  celebrationLoop();

  if (longPressCheck) {
    if (isAlone()) {
      setColor(WHITE);
      setColorOnFace(OFF, spinFace);
    }
  }

  //dump button presses
  buttonDoubleClicked();
  buttonLongPressed();
}

void flopperLoop() {

  //look for other floppers trying to move us along to the next color
  bool hasFlopperNeighbor = false;
  bool shouldChange = false;
  byte changeTo = signalTeam;
  byte lastFlopperFace = 0;
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) { //a neighbor!
      byte neighborData = getLastValueReceivedOnFace(f);
      if (getScoringTeam(neighborData) == 0) {//this could be a flopper
        if (getSignalTeam(neighborData) != 0) {//it is a flopper
          //set the last flopper face
          lastFlopperFace = f;
          hasFlopperNeighbor = true;

          //check for signal change
          if (getSignalTeam(neighborData) == signalTeam + 1) {//it wants me to move
            shouldChange = true;
            changeTo = getSignalTeam(neighborData);
          } else if (signalTeam == 3 && getSignalTeam(neighborData) == 1) {//it wants me to move
            shouldChange = true;
            changeTo = 1;
          }
        }
      }
    }
  }

  if (shouldChange) {
    signalTeam = changeTo;
    flopTimer.set(FLOP_INTERVAL);
    //change the spinface
    //spinFace = lastFlopperFace;
    //animTimer.set(0);
  }

  if (flopTimer.isExpired()) {
    signalTeam = (signalTeam % TEAM_COUNT) + 1;
    flopTimer.set(FLOP_INTERVAL);
    //if (hasFlopperNeighbor) {
    //spinFace = lastFlopperFace;
    //animTimer.set(0);
    //}
  }

  //change to flicker?
  if (buttonLongPressed()) {
    if (isAlone()) {
      //set the transition boolean to true
      longPressCheck = true;
      beginCelebration();
    }
  }

  if (buttonReleased()) {
    if (longPressCheck) {
      longPressCheck = false;//regardless of outcome, this needs to be false
      if (isAlone()) {
        scoringTeam = 0;
        signalTeam = 0;
        gameState = FLICKER_UNSCORED;
      }
    }
  }

}

void flickerLoop() {

  if (gameState == FLICKER_UNSCORED) {
    //listen for neighbors with signal teams
    //become that signal team
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) { //a neighbor!
        byte neighborData = getLastValueReceivedOnFace(f);

        if (getSignalTeam(neighborData) != 0) {//this guy is signalling

          //become scored
          gameState = FLICKER_SCORED;
          scoringTeam = getSignalTeam(neighborData);
          signalTeam = scoringTeam;

          //kick off a celebration
          beginCelebration();
        }
      }
    }

    //also, listen for long press to become flopper
    if (buttonLongPressed()) {
      if (isAlone()) {
        //set the transition boolean to true
        longPressCheck = true;
        beginCelebration();
      }
    }

    if (buttonReleased()) {
      if (longPressCheck) {
        longPressCheck = false;//regardless of outcome, this needs to be false
        if (isAlone()) {
          gameState = FLOPPER;
          signalTeam = 1;
          scoringTeam = 0;
        }
      }
    }

  } else if (gameState == FLICKER_SCORED) {
    //listen for signals to change your signal
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {
        byte neighborData = getLastValueReceivedOnFace(f);
        if (getSignalTeam(neighborData) == signalTeam + 1) {
          signalTeam = getSignalTeam(neighborData);
        } else if (signalTeam == 3 && getSignalTeam(neighborData) == 1) {
          signalTeam = 1;
        }
      }

      if (isAlone()) {
        gameState = FLICKER_DISPLAY;
        signalTeam = 0;
      }
    }

  } else if (gameState == FLICKER_DISPLAY) {
    //listen for things with signal teams to rejoin the game
    //listen for things with no scoring team to go back to unscored
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
        byte neighborData = getLastValueReceivedOnFace(f);

        if (getSignalTeam(neighborData) != 0) { //I have rejoined the game because this neighbor has a signal team
          gameState = FLICKER_SCORED;
          signalTeam = getSignalTeam(neighborData);

        } else if (getScoringTeam(neighborData) == 0) { //this neighbor has no signal team, and also has no scoring team. Unscored!
          gameState = FLICKER_UNSCORED;
          scoringTeam = 0;

        }
      }
    }

    //we can also be double-clicked back to unscored
    if (buttonDoubleClicked()) {
      gameState = FLICKER_UNSCORED;
      scoringTeam = 0;
    }
  }

}

void beginCelebration() {
  animTimer.set(0);
  celebrationState = CELEBRATE;
  animationInterval = ANIMATION_CELEBRATE_INTERVAL;
  celebrationTimer.set(CELEBRATE_TIME);
}

void celebrationLoop() {
  //here we check for the INERT/CELEBRATE/TRANSITION stuff
  if (celebrationState == INERT) {
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {
        if (getCelebrationState(getLastValueReceivedOnFace(f)) == CELEBRATE) {
          beginCelebration();
        }
      }
    }
  } else if (celebrationState == CELEBRATE) {
    //only move on to TRANSITION if no neighbors are still INERT
    celebrationState = TRANSITION;
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {
        if (getCelebrationState(getLastValueReceivedOnFace(f)) == INERT) {
          celebrationState = CELEBRATE;//revert the change from above
        }
      }
    }
  } else if (celebrationState == TRANSITION) {
    //only move to INERT if no neighbors are in CELEBRATE
    celebrationState = INERT;
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {
        if (getCelebrationState(getLastValueReceivedOnFace(f)) == CELEBRATE) {
          celebrationState = TRANSITION;//revert the change from above
        }
      }
    }
  }

  //set the animation interval correctly based on the celebration timer
  if (celebrationTimer.isExpired()) {
    animationInterval = ANIMATION_INTERVAL;
  } else {
    animationInterval = map(CELEBRATE_TIME - celebrationTimer.getRemaining(), 0, CELEBRATE_TIME, ANIMATION_CELEBRATE_INTERVAL, ANIMATION_INTERVAL);
  }
}

/////////////////
//DISPLAY LOOPS//
/////////////////

void spinFaceAnimator() {
  if (animTimer.isExpired()) {
    spinFace = (spinFace + 1) % 6;
    animTimer.set(animationInterval);
  }
}

void flopperDisplay() {
  setColor(makeColorHSB(teamHues[signalTeam], 255, 255));
  bool multiFlopper = false;

  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) { //a neighbor!
      byte neighborData = getLastValueReceivedOnFace(f);
      if (getScoringTeam(neighborData) == 0) { //it's another FLOPPER
        //am I celebrating?
        if (animationInterval < ANIMATION_INTERVAL) { //I am celebrating
          setColorOnFace(makeColorHSB(teamHues[signalTeam], 255, 255), f);
        } else {//not celebrating
          setColorOnFace(OFF, f);
        }
        multiFlopper = true;
      }
    }
  }

  if (!multiFlopper) {
    setColorOnFace(OFF, spinFace);
  }
}

void flickerDisplay() {
  setColor(OFF);

  if (gameState == FLICKER_UNSCORED) {
    setColorOnFace(WHITE, spinFace);
  } else if (gameState == FLICKER_SCORED) {
    setColorOnFace(makeColorHSB(teamHues[scoringTeam], 255, 255), spinFace);
    setColorOnFace(makeColorHSB(teamHues[signalTeam], 255, 255), (spinFace + 2) % 6);
    setColorOnFace(makeColorHSB(teamHues[signalTeam], 255, 255), (spinFace + 3) % 6);
    setColorOnFace(makeColorHSB(teamHues[signalTeam], 255, 255), (spinFace + 4) % 6);
  } else if (gameState == FLICKER_DISPLAY) {
    setColorOnFace(makeColorHSB(teamHues[scoringTeam], 255, 255), spinFace);
    setColorOnFace(makeColorHSB(teamHues[scoringTeam], 255, 255), (spinFace + 2) % 6);
    setColorOnFace(makeColorHSB(teamHues[scoringTeam], 255, 255), (spinFace + 4) % 6);
  }
}

/////////////////////////
//CONVENIENCE FUNCTIONS//
/////////////////////////

byte getSignalTeam(byte data) {
  return (data >> 4);//first and second bit
}

byte getScoringTeam(byte data) {
  return ((data >> 2) & 3);//third and fourth bit
}

byte getCelebrationState(byte data) {
  return (data & 3);//5th and 6th bit
}
