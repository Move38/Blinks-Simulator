self.importScripts('js/blink.js')

/*
 *  Fracture
 *  by Move38, Inc. 2019
 *  Lead development by Jonathan Bobrow, Daniel King
 *  original game by Celia Pearce, Em Lazer-Walker, Jonathan Bobrow, Joshua Sloane
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

const HAPPY_FLASH_DURATION = 500
const EDGE_FADE_DURAION = 500
const SPARKLE_OFFSET = 80
const SPARKLE_DURATION = 800
const SPARKLE_CYCLE_DURATION = 1600

let displayColor;


let teamHues = [22, 49, 82, 99, 160, 200];

let teamIndex = 0;

let happyFlashTimer = new Timer(self);
let happyFlashOn;

let sparkleOffset = [0, 3, 5, 1, 4, 2];

let edgeTimer = [];
let  edgeAcquired;

let hasRecentlySeenNeighbor = [];

function setup() {
}

function loop() {

  
  if (buttonDoubleClicked()) {
    teamIndex++;
    if (teamIndex >= COUNT_OF(teamHues)) {
      teamIndex = 0;
    }
  }

  let numNeighbors = 0;
  let noNeighborsOfSameColor = true;

  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) {

      if (hasRecentlySeenNeighbor[f] == false) {
        edgeAcquired = true;
        edgeTimer[f].set(EDGE_FADE_DURAION);
      }
      hasRecentlySeenNeighbor[f] = true;

      numNeighbors++;

      
      if (getLastValueReceivedOnFace(f) == teamIndex) {
        noNeighborsOfSameColor = false;
      }
    }
    else {
      if (hasRecentlySeenNeighbor[f] == true) {
        edgeAcquired = false;
        edgeTimer[f].set(EDGE_FADE_DURAION);
      }
      hasRecentlySeenNeighbor[f] = false;
    }
  }

  let isHappy = false;

  
  if (numNeighbors >= 2 && noNeighborsOfSameColor) {
    isHappy = true;
  }

  
  if (isHappy) {
    displayHappy();
  }
  else {
    displayNotHappy();
  }

  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!edgeTimer[f].isExpired()) {
      if (edgeAcquired) {
        
        let sat = 255 - (255 * edgeTimer[f].getRemaining() ) / EDGE_FADE_DURAION;
        setColorOnFace(makeColorHSB(teamHues[teamIndex], sat, 255), f);
      }
      else {
        
        let bri = 255 - (255 * edgeTimer[f].getRemaining() ) / EDGE_FADE_DURAION;
        setColorOnFace(makeColorHSB(teamHues[teamIndex], 255, bri), f);
      }
    }
  }

  setValueSentOnAllFaces(teamIndex);
}

function displayHappy() {

  
  let bri = 185 + sin8_C( (millis() / 14) % 255) * 70 / 255; 
  setColor(dim(getColorForTeam(teamIndex), bri));

  
  let delta = millis() % SPARKLE_CYCLE_DURATION; 

  if (delta > SPARKLE_DURATION) {
    delta = SPARKLE_DURATION;
  }

  for(let f = 0; f < FACE_COUNT; f++) {

    
    let sparkleStart = sparkleOffset[f] * SPARKLE_OFFSET;
    let sparkleEnd = sparkleStart + SPARKLE_DURATION - (6 * SPARKLE_OFFSET);

    if ( delta > sparkleStart ) {
      
      let phaseShift = 60 * f;
      let amplitude = 55;
      let midline = 185;
      let rate = 6;
      let lowBri = midline + (amplitude * sin8_C( (phaseShift + millis() / rate) % 255) / 100);
      let brightness;
      let saturation;

      if ( delta < sparkleEnd ) {
        brightness = map(delta, sparkleStart, sparkleStart + SPARKLE_DURATION - (6 * SPARKLE_OFFSET), 255, lowBri);
        saturation = map(delta, sparkleStart, sparkleStart + SPARKLE_DURATION - (6 * SPARKLE_OFFSET), 0, 255);
      }
      else {
        
        saturation = 255;
      }

      let faceColor = makeColorHSB(teamHues[teamIndex], saturation, 255);
      setColorOnFace(faceColor, f);
    }
  }

}

function displayNotHappy() {
  
  let bri = 185 + sin8_C( (millis() / 14) % 255) * 70 / 255; 
  setColor(dim(getColorForTeam(teamIndex), bri));
}


function getColorForTeam(t) {
  return makeColorHSB(teamHues[t], 255, 255);
}