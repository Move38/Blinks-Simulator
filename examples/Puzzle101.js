self.importScripts('js/blink.js')

/*
    Puzzle101
    by Move38, Inc. 2019
    Lead development by Dan King
    original game by Vanilla Liu, Dan King

    Rules: https:

    --------------------
    Blinks by Move38
    Brought to life via Kickstarter 2018

    @madewithblinks
    www.move38.com
    --------------------
*/


const SETUPAUTO = 0;
const PACKETREADY = 1;
const PACKETSENDING = 2;
const PACKETLISTENING = 3;
const PACKETRECEIVED = 4;
const GAMEAUTO = 5;

let gameMode = SETUPAUTO;
let packetStates = [PACKETREADY, PACKETREADY, PACKETREADY, PACKETREADY, PACKETREADY, PACKETREADY];


let piecesPlaced = 0;
const UNDECLARED = 0;
const APIECE = 1;
const BPIECE = 2;
const CPIECE = 3;
const DPIECE = 4;
const EPIECE = 5;
const FPIECE = 6;
const NONEIGHBOR = 7;

let neighborsArr = Array.from({ length: 6 }, () => [])
let colorsArr = Array.from({ length: 6 }, () => [])


let canBeginAlgorithm = false;
let isMaster = false;
let masterFace = 0;
let sparkleTimer = new Timer(self);

let packetTimer = new Timer(self);
const TIMEOUT_DURATION = 700


let autoColors = [OFF, makeColorRGB(255, 0, 128), makeColorRGB(255, 255, 0), makeColorRGB(0, 128, 255), WHITE];
let faceColors = [0, 0, 0, 0, 0, 0];
let faceBrightness = [0, 0, 0, 0, 0, 0];
let faceSolved = []
let colorDim = 160;
let whiteDim = 64;


let syncTimer = new Timer(self);
const PERIOD_DURATION = 2000
const BUFFER_DURATION = 200
let neighborState = []
let syncVal = 0;

function setup() {

}

function loop() {
  switch (gameMode) {
    case SETUPAUTO:
      setupAutoLoop();
      assembleDisplay();
      break;
    case PACKETREADY:
      communicationMasterLoop();
      communicationDisplay();
      break;
    case PACKETSENDING:
      communicationMasterLoop();
      communicationDisplay();
      break;
    case PACKETLISTENING:
      communicationReceiverLoop();
      communicationDisplay();
      break;
    case PACKETRECEIVED:
      communicationReceiverLoop();
      communicationDisplay();
      break;
    case GAMEAUTO:
      gameLoop();
      syncLoop();
      gameDisplay();
      break;
  }

  
  buttonDoubleClicked();

  
  for(let f = 0; f < FACE_COUNT; f++) {
    let sendData = (syncVal << 5) + (gameMode << 2) + (faceColors[f]);
    setValueSentOnFace(sendData, f);
  }
}





function setupAutoLoop() {
  
  let numNeighbors = 0;
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) { 
      let neighborData = getLastValueReceivedOnFace(f);
      if (getGameMode(neighborData) == SETUPAUTO) { 
        numNeighbors++;
        faceBrightness[f] = 255;
      } else {
        faceBrightness[f] = whiteDim;
      }
    } else {
      faceBrightness[f] = whiteDim;
    }
  }

  if (numNeighbors == 5) {
    canBeginAlgorithm = true;
  } else {
    canBeginAlgorithm = false;
  }

  if (buttonDoubleClicked() && canBeginAlgorithm == true) {
    makePuzzle();
    gameMode = PACKETREADY;
    canBeginAlgorithm = false;
    isMaster = true;
  }

  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) {
      let neighborData = getLastValueReceivedOnFace(f);
      if (getGameMode(neighborData) == PACKETREADY) { 
        gameMode = PACKETLISTENING;
        masterFace = f;
      }
    }
  }
}





function gameLoop() {
  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) { 
      let neighborData = getLastValueReceivedOnFace(f);
      let neighborColor = getColorInfo(neighborData);
      if (neighborColor == faceColors[f]) { 
        faceBrightness[f] = 255;
        faceSolved[f] = true;
      } else {
        faceBrightness[f] = colorDim;
        faceSolved[f] = false;
      }

      

      if (getGameMode(neighborData) == SETUPAUTO) {
        gameMode = SETUPAUTO;
      }


    } else {
      faceBrightness[f] = colorDim;
      faceSolved[f] = false;
    }
  }

  
  if (buttonDoubleClicked()) {
    if (gameMode == GAMEAUTO) {
      gameMode = SETUPAUTO;
    }
  }
}





function assembleDisplay() {
  if (sparkleTimer.isExpired() && canBeginAlgorithm) {
    for(let f = 0; f < FACE_COUNT; f++) {
      setColorOnFace(autoColors[random(3) + 1], f);
      sparkleTimer.set(50);
    }
  }

  if (!canBeginAlgorithm) {
    for(let f = 0; f < FACE_COUNT; f++) {
      setColorOnFace(dim(WHITE, faceBrightness[f]), f);
    }
  }
}

function gameDisplay() {

  let displayColor;
  for(let f = 0; f < FACE_COUNT; f++) {
    displayColor = autoColors[faceColors[f]];
    let displayBrightness;
    if (faceSolved[f]) {
      displayBrightness = sin8_C(map(syncTimer.getRemaining(), 0, PERIOD_DURATION, 0, 255));
    }
    else {
      displayBrightness = 255;
    }
    setColorOnFace(dim(displayColor, displayBrightness), f);
  }
}





function communicationMasterLoop() {

  if (gameMode == PACKETREADY) {

    let neighborsListening = 0;
    let emptyFace;
    for(let f = 0; f < FACE_COUNT; f++) {
      if (!isValueReceivedOnFaceExpired(f)) {
        let neighborData = getLastValueReceivedOnFace(f);
        if (getGameMode(neighborData) == PACKETLISTENING) {
          neighborsListening++;
        }
      } else {
        emptyFace = f;
      }
    }

    if (neighborsListening == 5) {
      gameMode = PACKETSENDING;
      sendPuzzlePackets(emptyFace);
      packetTimer.set(TIMEOUT_DURATION);
    }

  } else if (gameMode == PACKETSENDING) {

    let neighborsReceived = 0;
    let emptyFace;
    for(let f = 0; f < FACE_COUNT; f++) {
      if (!isValueReceivedOnFaceExpired(f)) {
        let neighborData = getLastValueReceivedOnFace(f);
        if (getGameMode(neighborData) == PACKETRECEIVED) {
          neighborsReceived++;
        }
      } else {
        emptyFace = f;
      }
    }

    if (neighborsReceived == 5) { 
      gameMode = GAMEAUTO;
      return;
    }

    if (gameMode != GAMEAUTO && packetTimer.isExpired()) { 
      sendPuzzlePackets(emptyFace);
      packetTimer.set(TIMEOUT_DURATION);
    }
  }

  if (buttonDoubleClicked()) {
    gameMode = SETUPAUTO;
  }
}

function sendPuzzlePackets(blankFace) {
  
  let packet = Array.from({ length: 6 }, () => [])

  
  for(let f = 0; f < FACE_COUNT; f++) {
    for(let ff = 0; ff < FACE_COUNT; ff++) {
      packet[f][ff] = colorsArr[f][ff];
    }
    sendDatagramOnFace( packet[f], sizeof(packet[f]), f);
  }

  
  for(let f = 0; f < FACE_COUNT; f++) {
    faceColors[f] = colorsArr[blankFace][f];
  }
}

function communicationReceiverLoop() {
  if (gameMode == PACKETLISTENING) {

    
    if (isDatagramReadyOnFace(masterFace)) {
      if (getDatagramLengthOnFace(masterFace) == 6) {
        let data =  getDatagramOnFace(masterFace);
        
        for(let f = 0; f < FACE_COUNT; f++) {
          faceColors[f] = data[f];
        }
        
        gameMode = PACKETRECEIVED;

      }
    }

    
    if (getGameMode(getLastValueReceivedOnFace(masterFace)) == SETUPAUTO) { 
      gameMode = SETUPAUTO;
    }

  } else if (gameMode == PACKETRECEIVED) {
    
    if (getGameMode(getLastValueReceivedOnFace(masterFace)) == GAMEAUTO) { 
      gameMode = GAMEAUTO;

      
      for(let f = 0; f < FACE_COUNT; f++) {
        markDatagramReadOnFace(f);
      }
    }
  }

  if (buttonDoubleClicked()) {
    gameMode = SETUPAUTO;
  }
}

function getSyncVal(data) {
  return (data >> 5) & 1;
}

function getGameMode(data) {
  return (data >> 2) & 7;
}

function getColorInfo(data) {
  return (data & 3);
}

function communicationDisplay() {
  if (sparkleTimer.isExpired()) {
    for(let f = 0; f < FACE_COUNT; f++) {
      setColorOnFace(autoColors[random(3) + 1], f);
      sparkleTimer.set(50);
    }
  }
}





function makePuzzle() {
  resetAll();
  piecesPlaced++;
  
  let emptySpots = random(2) + 2;
  for(let f = 0; f < FACE_COUNT; f++) {
    if (f < emptySpots) {
      neighborsArr[0][f] = NONEIGHBOR;
    }
  }

  for (let j = 0; j < 12; j++) {
    let swapA = random(5);
    let swapB = random(5);
    let temp = neighborsArr[0][swapA];
    neighborsArr[0][swapA] = neighborsArr[0][swapB];
    neighborsArr[0][swapB] = temp;
  }

  
  for (let j = 0; j < 6 - emptySpots; j++) {
    addBlink(0, 0);
  }

  let remainingBlinks = 6 - piecesPlaced;
  let lastRingBlinkIndex = piecesPlaced - 1;
  for (let k = 0; k < remainingBlinks; k++) {
    addBlink(1, lastRingBlinkIndex);
  }
  colorConnections();
}

function resetAll() {
  piecesPlaced = 0;

  for(let f = 0; f < FACE_COUNT; f++) {
    for(let i = 0; i < FACE_COUNT; i++) {
      neighborsArr[f][i] = 0;
      colorsArr[f][i] = 0;
    }
  }
}

function addBlink(minSearchIndex, maxSearchIndex) {
  
  let eligiblePositions = 0;
  for (let i = minSearchIndex; i <= maxSearchIndex; i++) {
    for(let f = 0; f < FACE_COUNT; f++) {
      if (neighborsArr[i][f] == 0) { 
        eligiblePositions ++;
      }
    }
  }

  
  let chosenPosition = random(eligiblePositions - 1) + 1;
  let blinkIndex;
  let faceIndex;
  
  let positionCountdown = 0;
  for (let i = minSearchIndex; i <= maxSearchIndex; i++) {
    for(let f = 0; f < FACE_COUNT; f++) {
      if (neighborsArr[i][f] == 0) { 
        positionCountdown ++;
        if (positionCountdown == chosenPosition) {
          
          blinkIndex = i;
          faceIndex = f;
        }
      }
    }
  }

  
  neighborsArr[blinkIndex][faceIndex] = getCurrentPiece();
  neighborsArr[piecesPlaced][getNeighborFace(faceIndex)] = blinkIndex + 1;
  piecesPlaced++;

  
  let counterclockwiseNeighborInfo = neighborsArr[blinkIndex][nextCounterclockwise(faceIndex)];
  if (counterclockwiseNeighborInfo != UNDECLARED) { 
    
    let newNeighborConnectionFace = nextClockwise(getNeighborFace(faceIndex));
    neighborsArr[piecesPlaced - 1][newNeighborConnectionFace] = counterclockwiseNeighborInfo;

    if (counterclockwiseNeighborInfo != NONEIGHBOR) { 
      neighborsArr[counterclockwiseNeighborInfo - 1][getNeighborFace(newNeighborConnectionFace)] = piecesPlaced;
    }
  }

  
  let clockwiseNeighborInfo = neighborsArr[blinkIndex][nextClockwise(faceIndex)];
  if (clockwiseNeighborInfo != UNDECLARED) { 
    
    let newNeighborConnectionFace = nextCounterclockwise(getNeighborFace(faceIndex));
    neighborsArr[piecesPlaced - 1][newNeighborConnectionFace] = clockwiseNeighborInfo;

    if (clockwiseNeighborInfo != NONEIGHBOR) { 
      neighborsArr[clockwiseNeighborInfo - 1][getNeighborFace(newNeighborConnectionFace)] = piecesPlaced;
    }
  }
}

function colorConnections() {
  
  for(let f = 0; f < FACE_COUNT; f++) {
    for(let ff = 0; ff < FACE_COUNT; ff++) {
      if (neighborsArr[f][ff] != UNDECLARED && neighborsArr[f][ff] != NONEIGHBOR) { 
        let foundIndex = neighborsArr[f][ff] - 1;
        if (colorsArr[f][ff] == 0) { 
          
          let connectionColor = random(2) + 1;
          colorsArr[f][ff] = connectionColor;
          for(let fff = 0; fff < FACE_COUNT; fff++) { 
            if (neighborsArr[foundIndex][fff] == f + 1) {
              colorsArr[foundIndex][fff] = connectionColor;
            }
          }
        }
      }
    }
  }
}

function getNeighborFace(face) {
  return ((face + 3) % 6);
}

function nextClockwise (face) {
  if (face == 5) {
    return 0;
  } else {
    return face + 1;
  }
}

function nextCounterclockwise (face) {
  if (face == 0) {
    return 5;
  } else {
    return face - 1;
  }
}

function getCurrentPiece () {
  
  
  
  
  return piecesPlaced + 1;
}

/*
   Keep ourselves on the same time loop as our neighbors
   if a neighbor passed go,
   we want to pass go as well
   (if we didn't just pass go)
   ... or collect $200
*/
function syncLoop() {

  let didNeighborChange = false;

  
  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (isValueReceivedOnFaceExpired(f)) {
      neighborState[f] = 2; 
    }
    else {
      let data = getLastValueReceivedOnFace(f);
      if (neighborState[f] != 2) {  
        if (getSyncVal(data) != neighborState[f]) { 
          didNeighborChange = true;
        }
      }

      neighborState[f] = getSyncVal(data);  
    }
  }

  
  
  if ( (didNeighborChange && syncTimer.getRemaining() < PERIOD_DURATION - BUFFER_DURATION)
       || syncTimer.isExpired()
     ) {

    syncTimer.set(PERIOD_DURATION); 
    syncVal = !syncVal; 
  }
}