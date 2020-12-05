self.importScripts('js/blink.js')

/*
    WHAM!
    by Move38, Inc. 2019
    Lead development by Dan King
    original game by Dan King, Jonathan Bobrow
    based on concept for Whack-A-Mole

    Rules: https:

    --------------------
    Blinks by Move38
    Brought to life via Kickstarter 2018

    @madewithblinks
    www.move38.com
    --------------------
*/

const SETUP = 0;
const GAME = 1;
const DEATH = 2;
const VICTORY = 3;

let gameState = SETUP;
let grassHue = 70;

const DIFFICULTY_MIN = 1 
const DIFFICULTY_MAX = 15 
let difficultyLevel = 0;

const VICTORY_ROUND_COUNT = 30
const INERT = 0;
const WAVE = 1;
const SETTLE = 2;

let goVictorySignal = INERT;
let roundCounter = 0;
let roundTimer = new Timer(self);
let roundActive = false;
let lifeSignal = 0;

const INERT0 = 0;
const INERT1 = 1;
const INERT2 = 2;
const GO = 3;
const RESOLVING = 4;

let goStrikeSignal = INERT0;
let isRippling = false;
const RIPPLING_INTERVAL = 500
let ripplingTimer = new Timer(self);

const SETUP_FADE_UP_INTERVAL = 500
const SETUP_RED_INTERVAL = 1000
const SETUP_FADE_DELAY = 3000
let setupFadeFace;
let setupFadeTimer = new Timer(self);
let redTime;

const EMERGE_INTERVAL_MAX = 2000
const EMERGE_INTERVAL_MIN = 500
const EMERGE_DRIFT = 200
let emergeTimer = new Timer(self);

let isAbove = false;
const ABOVE_INTERVAL_MAX = 3000
const ABOVE_INTERVAL_MIN = 1500
let aboveTimer = new Timer(self);

let isFlashing = false;
const FLASHING_INTERVAL = 500
let flashingTimer = new Timer(self);

let isStriking = false;
const STRIKING_INTERVAL = 200
let strikingTimer = new Timer(self);
let strikes = 0;
let strikeColors = [YELLOW, ORANGE, RED];

let isSourceOfDeath;
let timeOfDeath;
const DEATH_ANIMATION_INTERVAL = 750

function setup() {
  

  setupFadeFace = random(5);
  redTime = SETUP_RED_INTERVAL + random(SETUP_RED_INTERVAL / 2);
  setupFadeTimer.set(redTime + SETUP_FADE_UP_INTERVAL + random(SETUP_FADE_DELAY));
}

function loop() {
  
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

  
  buttonSingleClicked();
  buttonDoubleClicked();
  buttonPressed();

  
  let sendData;
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





function setupLoop() {

  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) {
      let neighborGameState = getGameState(getLastValueReceivedOnFace(f));
    }
  }

  
  if (buttonDoubleClicked()) {
    gameState = GAME;
    roundActive = false;
    roundTimer.set(EMERGE_INTERVAL_MAX);
    isFlashing = true;
    flashingTimer.set(FLASHING_INTERVAL);
  }

  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) {
      let neighborGameState = getGameState(getLastValueReceivedOnFace(f));
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

function gameLoop() {

  
  if (!roundActive) {
    let newRoundInitiated = false;

    
    for(let f = 0; f < FACE_COUNT; f++) {
      if (!isValueReceivedOnFaceExpired(f)) { 
        if (getGameState(getLastValueReceivedOnFace(f)) == GAME) { 
          if (getGoStrikeSignal(getLastValueReceivedOnFace(f)) == GO) {
            newRoundInitiated = true;
          }
        }
      }
    }

    
    if (!roundActive && roundTimer.isExpired()) {
      newRoundInitiated = true;
    }

    
    if (newRoundInitiated) {
      roundCounter++;
      if (roundCounter > VICTORY_ROUND_COUNT) {
        gameState = VICTORY;
        
        let emergeInterval = EMERGE_INTERVAL_MAX - ((difficultyLevel * (EMERGE_INTERVAL_MAX - EMERGE_INTERVAL_MIN)) / (DIFFICULTY_MAX - DIFFICULTY_MIN));
        let driftVal = (EMERGE_DRIFT / 3) * random(3);
        roundTimer.set(emergeInterval + driftVal);
      } else {
        if (difficultyLevel < DIFFICULTY_MAX) {
          difficultyLevel++;
        }

        
        lifeSignal = random(1);

        isRippling = true;
        ripplingTimer.set(RIPPLING_INTERVAL);
        goStrikeSignal = GO;
        roundActive = true;

        
        let emergeInterval = EMERGE_INTERVAL_MAX - (((difficultyLevel - DIFFICULTY_MIN) * (EMERGE_INTERVAL_MAX - EMERGE_INTERVAL_MIN)) / (DIFFICULTY_MAX - DIFFICULTY_MIN));
        emergeTimer.set(emergeInterval + random(EMERGE_DRIFT));
        
        let aboveInterval = ABOVE_INTERVAL_MAX - (((difficultyLevel - DIFFICULTY_MIN) * (ABOVE_INTERVAL_MAX - ABOVE_INTERVAL_MIN)) / (DIFFICULTY_MAX - DIFFICULTY_MIN));

        let roundInterval = emergeInterval + EMERGE_DRIFT + aboveInterval + FLASHING_INTERVAL + emergeInterval;
        roundTimer.set(roundInterval);
      }
    }
  }

  
  if (goStrikeSignal == GO) {
    let canResolve = true;

    for(let f = 0; f < FACE_COUNT; f++) {
      if (!isValueReceivedOnFaceExpired(f)) {
        if (isGoStrikeInert(getGoStrikeSignal(getLastValueReceivedOnFace(f)))) {
          canResolve = false;
        }
      }
    }

    if (canResolve) {
      goStrikeSignal = RESOLVING;
    }
  } else if (goStrikeSignal == RESOLVING) {
    let canInert = true;

    for(let f = 0; f < FACE_COUNT; f++) {
      if (!isValueReceivedOnFaceExpired(f)) {
        if (getGoStrikeSignal(getLastValueReceivedOnFace(f)) == GO) {
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

  
  if (isGoStrikeInert(goStrikeSignal) && roundActive) {
    let neighborsUp = 0;
    for(let f = 0; f < FACE_COUNT; f++) {
      if (!isValueReceivedOnFaceExpired(f)) { 
        if (getLifeSignal(getLastValueReceivedOnFace(f)) == 1) {
          neighborsUp++;
        }
      }
    }

    if (neighborsUp == 0) {
      lifeSignal = 1;
    } else if (neighborsUp > 3) {
      lifeSignal = 0;
    }
  }

  
  if (roundActive && emergeTimer.isExpired()) {
    roundActive = false;

    if (lifeSignal == 1) {
      isAbove = true;
      
      let fadeTime = ABOVE_INTERVAL_MAX - (((difficultyLevel - DIFFICULTY_MIN) * (ABOVE_INTERVAL_MAX - ABOVE_INTERVAL_MIN)) / (DIFFICULTY_MAX - DIFFICULTY_MIN));
      aboveTimer.set(fadeTime);
    }

  }

  
  if (buttonPressed()) {
    if (isAbove) { 
      isAbove = false;
      isFlashing = true;
      flashingTimer.set(FLASHING_INTERVAL);
      roundActive = false;
    } else {
      strikes++;
      
      if (isGoStrikeInert(goStrikeSignal)) { 
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
  }

  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) { 
      let neighborGameState = getGameState(getLastValueReceivedOnFace(f));
      if (neighborGameState == GAME) { 
        if (isGoStrikeInert(getGoStrikeSignal(getLastValueReceivedOnFace(f)))) {
          let neighborStrikes = getStrikes(getLastValueReceivedOnFace(f));
          if (neighborStrikes > strikes) { 
            strikes = neighborStrikes;
            if (isGoStrikeInert(goStrikeSignal)) { 
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

  
  if (isAbove && aboveTimer.isExpired()) { 
    gameState = DEATH;
    isSourceOfDeath = true;
    timeOfDeath = millis();
  }

  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) {
      let neighborGameState = getGameState(getLastValueReceivedOnFace(f));
      if (neighborGameState == DEATH) {
        gameState = DEATH;
        isSourceOfDeath = false;
        timeOfDeath = millis();
      }
    }
  }
}

function deathLoop() {
  setupCheck();
}

function victoryLoop() {
  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) {
      if (getGameState(getLastValueReceivedOnFace(f)) == DEATH) {
        gameState = DEATH;
        isSourceOfDeath = false;
      }
    }
  }

  
  if (emergeTimer.isExpired()) {
    isFlashing = true;
    flashingTimer.set(FLASHING_INTERVAL / 2);

    
    emergeTimer.set((FLASHING_INTERVAL / 2) + random(FLASHING_INTERVAL / 2));
  }

  setupCheck();
}

function setupCheck() {
  
  if (buttonDoubleClicked()) {
    gameState = SETUP;
    resetAllVariables();
  }

  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) {
      let neighborGameState = getGameState(getLastValueReceivedOnFace(f));
      if (neighborGameState == SETUP) {
        gameState = SETUP;
        resetAllVariables();
      }
    }
  }
}

function resetAllVariables() {
  
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





function setupDisplayLoop() {

  setColor(makeColorHSB(grassHue, 255, 255));

  if (setupFadeTimer.isExpired()) {
    setupFadeFace = (setupFadeFace + random(4)) % 6;
    redTime = SETUP_RED_INTERVAL + random(SETUP_RED_INTERVAL / 2);
    setupFadeTimer.set(redTime + SETUP_FADE_UP_INTERVAL + random(SETUP_FADE_DELAY));
  }

  let fadeColor;
  let saturation;

  if (setupFadeTimer.getRemaining() < redTime + SETUP_FADE_UP_INTERVAL) {
    if (setupFadeTimer.getRemaining() < SETUP_FADE_UP_INTERVAL) {
      saturation = 255 - map(setupFadeTimer.getRemaining(), 0, SETUP_FADE_UP_INTERVAL, 0, 255);
      fadeColor = makeColorHSB(grassHue, saturation, 255);
    } else {
      fadeColor = RED;
    }

    setColorOnFace(fadeColor, setupFadeFace);
  }
}

function gameDisplayLoop() {
  
  if (isFlashing) {
    
    let currentSaturation = 255 - ((255 * flashingTimer.getRemaining()) / FLASHING_INTERVAL);
    setColor(makeColorHSB(grassHue, currentSaturation, 255));
  } else if (isAbove) {
    let currentInterval = ABOVE_INTERVAL_MAX - (((difficultyLevel - DIFFICULTY_MIN) * (ABOVE_INTERVAL_MAX - ABOVE_INTERVAL_MIN) ) / (DIFFICULTY_MAX - DIFFICULTY_MIN));
    let currentFullPips = (aboveTimer.getRemaining()) / (currentInterval / 6);
    let dimmingPipBrightness = map(aboveTimer.getRemaining() - ((currentInterval / 6) * currentFullPips), 0, currentInterval / 6, 0, 255);

    for(let f = 0; f < FACE_COUNT; f++) {
      if (f < currentFullPips) {
        setColorOnFace(RED, f);
      } else if (f == currentFullPips) {
        setColorOnFace(dim(RED, dimmingPipBrightness), f);
      } else {
        setColorOnFace(OFF, f);
      }
      
    }

    
    
    
    
    
    

  } else if (isStriking) {
    
    setColor(strikeColors[strikes - 1]);
  } else if (isRippling) {
    for(let f = 0; f < FACE_COUNT; f++) {
      setColorOnFace(makeColorHSB(grassHue, 255, random(50) + 205), f);
      
    }
  } else {
    setColor(makeColorHSB(grassHue, 255, 255));
  }

  
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

function deathDisplayLoop() {
  let currentAnimationPosition = (millis() - timeOfDeath) % (DEATH_ANIMATION_INTERVAL * 2);
  let animationValue;
  if (currentAnimationPosition < DEATH_ANIMATION_INTERVAL) { 
    
    animationValue = 255 - ((255 * currentAnimationPosition) / DEATH_ANIMATION_INTERVAL);
  } else {
    
    animationValue = ((255 * (currentAnimationPosition - DEATH_ANIMATION_INTERVAL)) / DEATH_ANIMATION_INTERVAL);
  }

  if (isSourceOfDeath) {
    setColor(makeColorHSB(0, animationValue, 255));
  } else {
    setColor(makeColorHSB(0, 255, animationValue));
  }
}

function victoryDisplayLoop() {
  if (isFlashing) {
    let currentSaturation = 255 - map(flashingTimer.getRemaining(), 0, FLASHING_INTERVAL, 0, 255);
    setColor(makeColorHSB(grassHue, currentSaturation, 255));
  }

  
  if (flashingTimer.isExpired()) {
    isFlashing = false;
  }
}





function getGameState(data) {
  return (data >> 4);
}

function getGoStrikeSignal(data) {
  return ((data >> 1) & 7);
}

function isGoStrikeInert (data) {
  if (data == INERT0 || data == INERT1 || data == INERT2) {
    return true;
  } else {
    return false;
  }
}

function getStrikes(data) {
  let s = getGoStrikeSignal(data);
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

function getLifeSignal(data) {
  return (data & 1);
}

function getGoVictorySignal(data) {
  return ((data >> 2) & 3);
}
