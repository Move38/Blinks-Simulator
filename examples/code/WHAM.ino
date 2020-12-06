/*
    WHAM!
    by Move38, Inc. 2019
    Lead development by Dan King
    original game by Dan King, Jonathan Bobrow
    based on concept for Whack-A-Mole

    Rules: https://github.com/Move38/WHAM/blob/master/README.md

    --------------------
    Blinks by Move38
    Brought to life via Kickstarter 2018

    @madewithblinks
    www.move38.com
    --------------------
*/

enum gameStates {SETUP, GAME, DEATH, VICTORY};//cycles through the game
byte gameState = SETUP;
byte grassHue = 70;

#define DIFFICULTY_MIN 1 //starting round
#define DIFFICULTY_MAX 15 //final difficulty level, though the game continues
byte difficultyLevel = 0;

#define VICTORY_ROUND_COUNT 30
enum goVictorySignals {INERT, WAVE, SETTLE};//used in game state
byte goVictorySignal = INERT;
byte roundCounter = 0;
Timer roundTimer;
bool roundActive = false;
byte lifeSignal = 0;

enum goStrikeSignals {INERT0, INERT1, INERT2, GO, RESOLVING};//used in game state
byte goStrikeSignal = INERT0;
bool isRippling = false;
#define RIPPLING_INTERVAL 500
Timer ripplingTimer;

#define SETUP_FADE_UP_INTERVAL 500
#define SETUP_RED_INTERVAL 1000
#define SETUP_FADE_DELAY 3000
byte setupFadeFace;
Timer setupFadeTimer;
word redTime;

#define EMERGE_INTERVAL_MAX 2000
#define EMERGE_INTERVAL_MIN 500
#define EMERGE_DRIFT 200
Timer emergeTimer;//triggered when the GO signal is received, interval shrinks as difficultyLevel increases

bool isAbove = false;
#define ABOVE_INTERVAL_MAX 3000
#define ABOVE_INTERVAL_MIN 1500
Timer aboveTimer;

bool isFlashing = false;
#define FLASHING_INTERVAL 500
Timer flashingTimer;

bool isStriking = false;
#define STRIKING_INTERVAL 200
Timer strikingTimer;
byte strikes = 0;//communicated in game mode, incremented which each strike
Color strikeColors[3] = {YELLOW, ORANGE, RED};

bool isSourceOfDeath;
long timeOfDeath;
#define DEATH_ANIMATION_INTERVAL 750

void setup() {
  // put your setup code here, to run once:
  randomize();
  setupFadeFace = random(5);
  redTime = SETUP_RED_INTERVAL + random(SETUP_RED_INTERVAL / 2);
  setupFadeTimer.set(redTime + SETUP_FADE_UP_INTERVAL + random(SETUP_FADE_DELAY));
}

void loop() {
  // put your main code here, to run repeatedly:
  switch (gameState) {
    case SETUP:
      setupLoop();
      setupDisplayLoop();
      break;
    case GAME:
      gameLoop();
      gameDisplayLoop();
      break;
    case DEATH:
      deathLoop();
      deathDisplayLoop();
      break;
    case VICTORY:
      victoryLoop();
      victoryDisplayLoop();
  }

  //dump button data
  buttonSingleClicked();
  buttonDoubleClicked();
  buttonPressed();

  //do communication (done here to avoid miscommunication)
  byte sendData;
  switch (gameState) {
    case SETUP:
      sendData = (gameState << 4);
      break;
    case GAME:
      sendData = (gameState << 4) + (goStrikeSignal << 1) + (lifeSignal);
      break;
    case DEATH:
      sendData = (gameState << 4);
      break;
    case VICTORY:
      sendData = (gameState << 4) + (goVictorySignal << 2);
  }
  setValueSentOnAllFaces(sendData);
}

//////////////
//GAME LOOPS//
//////////////

void setupLoop() {

  //listen for neighbors with higher player counts and conform
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {//a neighbor!
      byte neighborGameState = getGameState(getLastValueReceivedOnFace(f));
    }
  }

  //listen for double-clicks to move into game mode
  if (buttonDoubleClicked()) {
    gameState = GAME;
    roundActive = false;
    roundTimer.set(EMERGE_INTERVAL_MAX);
    isFlashing = true;
    flashingTimer.set(FLASHING_INTERVAL);
  }

  //listen for neighbors in game mode to move to game mode myself and become receiver
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {//a neighbor!
      byte neighborGameState = getGameState(getLastValueReceivedOnFace(f));
      if (neighborGameState == GAME) {
        gameState = GAME;
        roundActive = false;
        roundTimer.set(EMERGE_INTERVAL_MAX);
        isFlashing = true;
        flashingTimer.set(FLASHING_INTERVAL);
      }
    }
  }
}

void gameLoop() {

  //start new round?
  if (!roundActive) {
    bool newRoundInitiated = false;

    //look for neighbors commanding us to start a round
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) { //neighbor!
        if (getGameState(getLastValueReceivedOnFace(f)) == GAME) { //a trusted neighbor
          if (getGoStrikeSignal(getLastValueReceivedOnFace(f)) == GO) {//telling us to go
            newRoundInitiated = true;
          }
        }
      }
    }

    //listen for internal timer telling us to go
    if (!roundActive && roundTimer.isExpired()) {
      newRoundInitiated = true;
    }

    //we get to start a new round!
    if (newRoundInitiated) {
      roundCounter++;
      if (roundCounter > VICTORY_ROUND_COUNT) {//GAME OVER: VICTORY
        gameState = VICTORY;
        //        word emergeInterval = map(difficultyLevel, DIFFICULTY_MIN, DIFFICULTY_MAX, EMERGE_INTERVAL_MAX, EMERGE_INTERVAL_MIN);
        word emergeInterval = EMERGE_INTERVAL_MAX - ((difficultyLevel * (EMERGE_INTERVAL_MAX - EMERGE_INTERVAL_MIN)) / (DIFFICULTY_MAX - DIFFICULTY_MIN));
        word driftVal = (EMERGE_DRIFT / 3) * random(3);
        roundTimer.set(emergeInterval + driftVal);
      } else {//GAME IS STILL ON
        if (difficultyLevel < DIFFICULTY_MAX) {
          difficultyLevel++;
        }

        //we also need to declare out intention to go up
        lifeSignal = random(1);//using this in place of real stuff for a moment

        isRippling = true;
        ripplingTimer.set(RIPPLING_INTERVAL);
        goStrikeSignal = GO;
        roundActive = true;

        //        word emergeInterval = map(difficultyLevel, DIFFICULTY_MIN, DIFFICULTY_MAX, EMERGE_INTERVAL_MAX, EMERGE_INTERVAL_MIN);
        word emergeInterval = EMERGE_INTERVAL_MAX - (((difficultyLevel - DIFFICULTY_MIN) * (EMERGE_INTERVAL_MAX - EMERGE_INTERVAL_MIN)) / (DIFFICULTY_MAX - DIFFICULTY_MIN));
        emergeTimer.set(emergeInterval + random(EMERGE_DRIFT));
        //        word aboveInterval = map(difficultyLevel, DIFFICULTY_MIN, DIFFICULTY_MAX, ABOVE_INTERVAL_MAX, ABOVE_INTERVAL_MIN);
        word aboveInterval = ABOVE_INTERVAL_MAX - (((difficultyLevel - DIFFICULTY_MIN) * (ABOVE_INTERVAL_MAX - ABOVE_INTERVAL_MIN)) / (DIFFICULTY_MAX - DIFFICULTY_MIN));

        word roundInterval = emergeInterval + EMERGE_DRIFT + aboveInterval + FLASHING_INTERVAL + emergeInterval;
        roundTimer.set(roundInterval);
      }
    }
  }

  //resolve goStrikeSignal propogation
  if (goStrikeSignal == GO) {//we are going. Do all our neighbors know this?
    bool canResolve = true;

    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
        if (isGoStrikeInert(getGoStrikeSignal(getLastValueReceivedOnFace(f)))) {//this neighbor has not been told
          canResolve = false;
        }
      }
    }

    if (canResolve) {
      goStrikeSignal = RESOLVING;
    }
  } else if (goStrikeSignal == RESOLVING) {
    bool canInert = true;

    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
        if (getGoStrikeSignal(getLastValueReceivedOnFace(f)) == GO) {//this neighbor still has work to do
          canInert = false;
        }
      }
    }

    if (canInert) {
      switch (strikes) {
        case 0:
          goStrikeSignal = INERT0;
          break;
        case 1:
          goStrikeSignal = INERT1;
          break;
        case 2:
          goStrikeSignal = INERT2;
          break;
      }
    }
  }

  //PLAY THE GAME OF LIFE
  if (isGoStrikeInert(goStrikeSignal) && roundActive) {
    byte neighborsUp = 0;
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) { //neighbor!
        if (getLifeSignal(getLastValueReceivedOnFace(f)) == 1) {
          neighborsUp++;
        }
      }
    }

    if (neighborsUp == 0) {//too few up neighbors. ARISE!
      lifeSignal = 1;
    } else if (neighborsUp > 3) {//too many neighbors. DESCEND!
      lifeSignal = 0;
    }
  }

  //listen for my emerge timer to expire so I can go above
  if (roundActive && emergeTimer.isExpired()) {
    roundActive = false;

    if (lifeSignal == 1) {
      isAbove = true;
      //      word fadeTime = map(difficultyLevel, DIFFICULTY_MIN, DIFFICULTY_MAX, ABOVE_INTERVAL_MAX, ABOVE_INTERVAL_MIN);
      word fadeTime = ABOVE_INTERVAL_MAX - (((difficultyLevel - DIFFICULTY_MIN) * (ABOVE_INTERVAL_MAX - ABOVE_INTERVAL_MIN)) / (DIFFICULTY_MAX - DIFFICULTY_MIN));
      aboveTimer.set(fadeTime);
    }

  }

  //listen for button presses
  if (buttonPressed()) {
    if (isAbove) { //there is a mole here
      isAbove = false;//kill the mole
      isFlashing = true;//start the flash
      flashingTimer.set(FLASHING_INTERVAL);
      roundActive = false;
    } else {//there is no mole here
      strikes++;
      //we need to check if we are in an inert state and update that
      if (isGoStrikeInert(goStrikeSignal)) { //update our INERT type
        switch (strikes) {
          case 0:
            goStrikeSignal = INERT0;
            break;
          case 1:
            goStrikeSignal = INERT1;
            break;
          case 2:
            goStrikeSignal = INERT2;
            break;
        }
      }
      strikingTimer.set(STRIKING_INTERVAL);
      isStriking = true;
      if (strikes == 3) {
        gameState = DEATH;
        isSourceOfDeath = true;
      }


    }
  }//end button press check

  //listen for strikes from neighbors
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) { //neighbor!
      byte neighborGameState = getGameState(getLastValueReceivedOnFace(f));
      if (neighborGameState == GAME) { //this neighbor is in game state, so we can trust their communication
        if (isGoStrikeInert(getGoStrikeSignal(getLastValueReceivedOnFace(f)))) {//this is an inert neighbror, they communicating
          byte neighborStrikes = getStrikes(getLastValueReceivedOnFace(f));
          if (neighborStrikes > strikes) { //that neighbor is reporting more strikes than me. Take that number
            strikes = neighborStrikes;
            if (isGoStrikeInert(goStrikeSignal)) { //update our INERT type
              switch (strikes) {
                case 0:
                  goStrikeSignal = INERT0;
                  break;
                case 1:
                  goStrikeSignal = INERT1;
                  break;
                case 2:
                  goStrikeSignal = INERT2;
                  break;
              }
            }
            isStriking = true;
            strikingTimer.set(STRIKING_INTERVAL);
          }
        }
      }
    }
  }

  //listen for my mole to cause death
  if (isAbove && aboveTimer.isExpired()) { //my fade timer expired and I haven't been clicked, so...
    gameState = DEATH;
    isSourceOfDeath = true;
    timeOfDeath = millis();
  }

  //listen for death
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {//a neighbor!
      byte neighborGameState = getGameState(getLastValueReceivedOnFace(f));
      if (neighborGameState == DEATH) {
        gameState = DEATH;
        isSourceOfDeath = false;
        timeOfDeath = millis();
      }
    }
  }//end death check
}

void deathLoop() {
  setupCheck();
}

void victoryLoop() {
  //listen for neighbors in death, because that maybe could happen but probably won't
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
      if (getGameState(getLastValueReceivedOnFace(f)) == DEATH) {
        gameState = DEATH;
        isSourceOfDeath = false;
      }
    }
  }

  //randomly flash
  if (emergeTimer.isExpired()) {
    isFlashing = true;
    flashingTimer.set(FLASHING_INTERVAL / 2);

    //reset the timer
    emergeTimer.set((FLASHING_INTERVAL / 2) + random(FLASHING_INTERVAL / 2));
  }

  setupCheck();
}

void setupCheck() {
  //listen for double clicks to go back to setup
  if (buttonDoubleClicked()) {
    gameState = SETUP;
    resetAllVariables();
  }

  //listen for signal to go to setup
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) {//a neighbor!
      byte neighborGameState = getGameState(getLastValueReceivedOnFace(f));
      if (neighborGameState == SETUP) {
        gameState = SETUP;
        resetAllVariables();
      }
    }
  }//end setup check
}

void resetAllVariables() {
  //RESET ALL GAME VARIABLES
  goStrikeSignal = INERT0;
  goVictorySignal = INERT;
  difficultyLevel = 0;
  roundActive = false;
  roundCounter = 0;
  strikes = 0;
  lifeSignal = 0;
  isSourceOfDeath = false;
  isAbove = false;
  isFlashing = false;
  isRippling = false;
  isStriking = false;
}

/////////////////
//DISPLAY LOOPS//
/////////////////

void setupDisplayLoop() {

  setColor(makeColorHSB(grassHue, 255, 255));

  if (setupFadeTimer.isExpired()) {
    setupFadeFace = (setupFadeFace + random(4)) % 6;
    redTime = SETUP_RED_INTERVAL + random(SETUP_RED_INTERVAL / 2);
    setupFadeTimer.set(redTime + SETUP_FADE_UP_INTERVAL + random(SETUP_FADE_DELAY));
  }

  Color fadeColor;
  byte saturation;

  if (setupFadeTimer.getRemaining() < redTime + SETUP_FADE_UP_INTERVAL) {//we are inside the animation
    if (setupFadeTimer.getRemaining() < SETUP_FADE_UP_INTERVAL) {//we are fading from white to green
      saturation = 255 - map(setupFadeTimer.getRemaining(), 0, SETUP_FADE_UP_INTERVAL, 0, 255);
      fadeColor = makeColorHSB(grassHue, saturation, 255);
    } else {//we are red
      fadeColor = RED;
    }

    setColorOnFace(fadeColor, setupFadeFace);
  }
}

void gameDisplayLoop() {
  //do each animation
  if (isFlashing) {//fade from white to green based on flashingTimer
    //    byte currentSaturation = map(flashingTimer.getRemaining(), 0, FLASHING_INTERVAL, 255, 0);
    byte currentSaturation = 255 - ((255 * flashingTimer.getRemaining()) / FLASHING_INTERVAL);
    setColor(makeColorHSB(grassHue, currentSaturation, 255));
  } else if (isAbove) {//fade from [color] to off based on aboveTimer
    long currentInterval = ABOVE_INTERVAL_MAX - (((difficultyLevel - DIFFICULTY_MIN) * (ABOVE_INTERVAL_MAX - ABOVE_INTERVAL_MIN) ) / (DIFFICULTY_MAX - DIFFICULTY_MIN));
    byte currentFullPips = (aboveTimer.getRemaining()) / (currentInterval / 6);//6 >>> 0
    byte dimmingPipBrightness = map(aboveTimer.getRemaining() - ((currentInterval / 6) * currentFullPips), 0, currentInterval / 6, 0, 255);

    FOREACH_FACE(f) {
      if (f < currentFullPips) {
        setColorOnFace(RED, f);
      } else if (f == currentFullPips) {
        setColorOnFace(dim(RED, dimmingPipBrightness), f);
      } else {
        setColorOnFace(OFF, f);
      }
      //should my face be all the way on?
    }

    //    long currentTime = aboveTimer.getRemaining();
    //    byte brightnessSubtraction = 255 - ((255 * currentTime) / currentInterval);
    //    brightnessSubtraction = (brightnessSubtraction * brightnessSubtraction) / 255;
    //    brightnessSubtraction = (brightnessSubtraction * brightnessSubtraction) / 255;
    //    byte currentBrightness = 255 - brightnessSubtraction;
    //    setColor(dim(currentColor, currentBrightness));

  } else if (isStriking) {//flash [color] for a moment
    //which color? depends on number of strikes
    setColor(strikeColors[strikes - 1]);
  } else if (isRippling) {//randomize green hue for a moment
    FOREACH_FACE(f) {
      setColorOnFace(makeColorHSB(grassHue, 255, random(50) + 205), f);
      //setColorOnFace(makeColorHSB(grassHue + random(20), 255, 255), f);
    }
  } else {//just be green
    setColor(makeColorHSB(grassHue, 255, 255));
  }

  //resolve non-death animation timers
  if (flashingTimer.isExpired()) {
    isFlashing = false;
  }
  if (strikingTimer.isExpired()) {
    isStriking = false;
  }
  if (ripplingTimer.isExpired()) {
    isRippling = false;
  }
}

void deathDisplayLoop() {
  long currentAnimationPosition = (millis() - timeOfDeath) % (DEATH_ANIMATION_INTERVAL * 2);
  byte animationValue;
  if (currentAnimationPosition < DEATH_ANIMATION_INTERVAL) { //we are in the down swing (255 >> 0)
    //    animationValue = map(currentAnimationPosition, 0, DEATH_ANIMATION_INTERVAL, 255, 0);
    animationValue = 255 - ((255 * currentAnimationPosition) / DEATH_ANIMATION_INTERVAL);
  } else {//we are in the up swing (0 >> 255)
    //    animationValue = map(currentAnimationPosition - DEATH_ANIMATION_INTERVAL, 0, DEATH_ANIMATION_INTERVAL, 0, 255);
    animationValue = ((255 * (currentAnimationPosition - DEATH_ANIMATION_INTERVAL)) / DEATH_ANIMATION_INTERVAL);
  }

  if (isSourceOfDeath) {
    setColor(makeColorHSB(0, animationValue, 255));
  } else {
    setColor(makeColorHSB(0, 255, animationValue));
  }
}

void victoryDisplayLoop() {
  if (isFlashing) {//fade from white to green based on flashingTimer
    byte currentSaturation = 255 - map(flashingTimer.getRemaining(), 0, FLASHING_INTERVAL, 0, 255);
    setColor(makeColorHSB(grassHue, currentSaturation, 255));
  }

  //resolve flashing animation timers
  if (flashingTimer.isExpired()) {
    isFlashing = false;
  }
}

/////////////////
//COMMUNICATION//
/////////////////

byte getGameState(byte data) {//1st and 2nd bit
  return (data >> 4);
}

byte getGoStrikeSignal(byte data) {
  return ((data >> 1) & 7);
}

bool isGoStrikeInert (byte data) {//is this neighbor in an inert state?
  if (data == INERT0 || data == INERT1 || data == INERT2) {
    return true;
  } else {
    return false;
  }
}

byte getStrikes(byte data) {//returns a number of strikes
  byte s = getGoStrikeSignal(data);
  switch (s) {
    case INERT0:
      return 0;
      break;
    case INERT1:
      return 1;
      break;
    case INERT2:
      return 2;
      break;
    default:
      return 0;
      break;
  }
}

byte getLifeSignal(byte data) {//6th bit
  return (data & 1);
}

byte getGoVictorySignal(byte data) {//3rd and 4th bit
  return ((data >> 2) & 3);
}
