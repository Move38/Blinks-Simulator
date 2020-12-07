const INERT = 0;
const GO = 1;
const RESOLVE = 2;

let signalState = INERT;
const MODE1 = 0;
const MODE2 = 1;
const MODE3 = 2;
const MODE4 = 3;

let gameMode = MODE1;
function loop() {
    switch (signalState) {
        case INERT:
            inertLoop();
            break;
        case GO:
            goLoop();
            break;
        case RESOLVE:
            resolveLoop();
            break;
    }
    displaySignalState();
    let sendData = (signalState << 2) + (gameMode);
    setValueSentOnAllFaces(sendData);
}
function inertLoop() {
    
    if (buttonSingleClicked()) {
        signalState = GO;
        gameMode = (gameMode + 1) % 4;
    }
    
    for(let f = 0; f < FACE_COUNT; f++) {
        if (!isValueReceivedOnFaceExpired(f)) { 
            if (getSignalState(getLastValueReceivedOnFace(f)) == GO) { 
                signalState = GO;
                gameMode = getGameMode(getLastValueReceivedOnFace(f));
            }
        }
    }
}
function goLoop() {
    signalState = RESOLVE; 

    
    for(let f = 0; f < FACE_COUNT; f++) {
        if (!isValueReceivedOnFaceExpired(f)) { 
            if (getSignalState(getLastValueReceivedOnFace(f)) == INERT) {
                signalState = GO;
            }
        }
    }
}
function resolveLoop() {
    signalState = INERT; 

    
    for(let f = 0; f < FACE_COUNT; f++) {
        if (!isValueReceivedOnFaceExpired(f)) { 
            if (getSignalState(getLastValueReceivedOnFace(f)) == GO) {
                signalState = RESOLVE;
            }
        }
    }
}
function displaySignalState() {
  switch (signalState) {
    case INERT:
      switch (gameMode) {
        case MODE1:
          setColor(RED);
          break;
        case MODE2:
          setColor(YELLOW);
          break;
        case MODE3:
          setColor(GREEN);
          break;
        case MODE4:
          setColor(CYAN);
          break;
      }
      break;
    case GO:
    case RESOLVE:
      setColor(WHITE);
      break;
  }
}

function getGameMode(data) {
  return (data & 3);
}

function getSignalState(data) {
  return ((data >> 2) & 3);
}