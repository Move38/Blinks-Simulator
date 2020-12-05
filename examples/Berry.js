self.importScripts('js/blink.js')

/*
 *  Berry
 *  by VV Studio
 *  at IndieCade East 2018 Game Jam
 *  Lead development by Jonathan Bobrow, Move38 Inc.
 *  original game by ViVi and Vanilla
 *
 *  Rules: https:
 *
 *  --------------------
 *  Blinks by Move38
 *  Brought to life via Kickstarter 2018
 *
 *  @madewithblinks
 *  www.move38.com
 *  --------------------
 */

let colors = [ BLUE, RED, YELLOW ];
let currentColorIndex = 0;
let faceIndex = 0;
let faceStartIndex = 0;

let isWaiting = false;

const FACE_DURATION = 60
const WAIT_DURATION = 2000

let faceTimer = new Timer(self);
let waitTimer = new Timer(self);

function setup() {
  

}

function loop() {
  

  if ( buttonSingleClicked() ) {

    currentColorIndex++;

    if (currentColorIndex >= COUNT_OF(colors)) {
      currentColorIndex = 0;
    }

  }

  if ( waitTimer.isExpired() ) {
    if ( faceTimer.isExpired() ) {
      faceTimer.set( FACE_DURATION );
      faceIndex++;

      if (faceIndex >= 7) {
        faceIndex = 0;
        waitTimer.set( WAIT_DURATION );
        isWaiting = true;

        
        faceStartIndex++;
        if (faceStartIndex >= 6) {
          faceStartIndex = 0;
        }
      }
      else {
        isWaiting  = false;
      }
    }
  }

  
  setColor( colors[currentColorIndex] );

  
  if (isPositionLocked()) {
    
    let bri = 153 + (sin8_C((millis() / 6) % 255)*2)/5;
    setColor(dim(colors[currentColorIndex], bri));
  }

  
  if (!isWaiting) {
    let nextColorIndex = (currentColorIndex + 1) % 3;
    let face = (faceStartIndex + faceIndex - 1) % FACE_COUNT;
    setFaceColor( face, colors[nextColorIndex] );
  }
}

function isPositionLocked() {
  
  let neighborPattern = [];
  let lockedA = [1, 0, 1, 0, 1, 0];
  let lockedB = [1, 0, 1, 0, 0, 0];

  for(let f = 0; f < FACE_COUNT; f++) {
    neighborPattern[f] = !isValueReceivedOnFaceExpired(f);
  }

  
  for (let i = 0; i < 3; i++) {
    if (neighborPattern[i] && neighborPattern[i + 3]) {
      return true;
    }
  }

  
  if ( isThisPatternPresent(lockedA, neighborPattern)) {
    return true;
  }
  if ( isThisPatternPresent(lockedB, neighborPattern)) {
    return true;
  }

  return false;
}





function isThisPatternPresent( pat, source) {

  
  let source_double = [];

  for (let i = 0; i < 12; i++) {
    source_double[i] = source[i % 6];
  }

  
  let pat_index = 0;

  for (let i = 0; i < 12; i++) {
    if (source_double[i] == pat[pat_index]) {
      
      pat_index++;

      if ( pat_index == 6 ) {
        
        return true;
      }
    }
    else {
      
      pat_index = 0;
    }
  }

  return false;
}  