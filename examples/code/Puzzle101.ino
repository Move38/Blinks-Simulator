/*
    Puzzle101
    by Move38, Inc. 2019
    Lead development by Dan King
    original game by Vanilla Liu, Dan King

    Rules: https://github.com/Move38/Puzzle101/blob/master/README.md

    --------------------
    Blinks by Move38
    Brought to life via Kickstarter 2018

    @madewithblinks
    www.move38.com
    --------------------
*/

////COMMUNICATION VARIABLES////
enum gameModes {SETUPAUTO, PACKETREADY, PACKETSENDING, PACKETLISTENING, PACKETRECEIVED, GAMEAUTO};
byte gameMode = SETUPAUTO;
byte packetStates[6] = {PACKETREADY, PACKETREADY, PACKETREADY, PACKETREADY, PACKETREADY, PACKETREADY};

///ALGORITHM VARIABLES////
byte piecesPlaced = 0;
enum connections {UNDECLARED, APIECE, BPIECE, CPIECE, DPIECE, EPIECE, FPIECE, NONEIGHBOR};
byte neighborsArr[6][6];//filled with the values from above, denotes neighbors. [x][y] x is piece, y is face
byte colorsArr[6][6];//filled with 0-3, denotes color of connection. [x][y] x is piece, y is face

////ASSEMBLY VARIABLES////
bool canBeginAlgorithm = false;
bool isMaster = false;
byte masterFace = 0;//for receivers, this is the face where the master was found
Timer sparkleTimer;

Timer packetTimer;
#define TIMEOUT_DURATION 700

////GAME VARIABLES////
Color autoColors[5] = {OFF, makeColorRGB(255, 0, 128), makeColorRGB(255, 255, 0), makeColorRGB(0, 128, 255), WHITE};
byte faceColors[6] = {0, 0, 0, 0, 0, 0};
byte faceBrightness[6] = {0, 0, 0, 0, 0, 0};
byte faceSolved[6];
byte colorDim = 160;
byte whiteDim = 64;

// SYNCHRONIZED CELEBRATION
Timer syncTimer;
#define PERIOD_DURATION 2000
#define BUFFER_DURATION 200
byte neighborState[6];
byte syncVal = 0;

void setup() {
  randomize();
}

void loop() {
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

  //clear button presses
  buttonDoubleClicked();

  //set communications
  FOREACH_FACE(f) {
    byte sendData = (syncVal << 5) + (gameMode << 2) + (faceColors[f]);
    setValueSentOnFace(sendData, f);
  }
}

///////////////
//SETUP LOOPS//
///////////////

void setupAutoLoop() {
  //all we do here is wait until we have 5 neighbors
  byte numNeighbors = 0;
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) { //neighbor!
      byte neighborData = getLastValueReceivedOnFace(f);
      if (getGameMode(neighborData) == SETUPAUTO) { //this neighbor is ready for puzzling
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

  if (buttonDoubleClicked() && canBeginAlgorithm == true) {//this lets us become the master blink
    makePuzzle();//RUN THE ALGORITHM
    gameMode = PACKETREADY;
    canBeginAlgorithm = false;
    isMaster = true;
  }

  FOREACH_FACE(f) {//here we listen for other blinks to turn us into receiver blinks
    if (!isValueReceivedOnFaceExpired(f)) {//neighbor here
      byte neighborData = getLastValueReceivedOnFace(f);
      if (getGameMode(neighborData) == PACKETREADY) { //this neighbor will send a puzzle soon
        gameMode = PACKETLISTENING;
        masterFace = f;//will only listen for packets on this face
      }
    }
  }
}

/////////////
//GAME LOOP//
/////////////

void gameLoop() {
  //all we do here is look at our faces and see if they are touching like colors
  FOREACH_FACE(f) {
    if (!isValueReceivedOnFaceExpired(f)) { //neighbor!
      byte neighborData = getLastValueReceivedOnFace(f);
      byte neighborColor = getColorInfo(neighborData);
      if (neighborColor == faceColors[f]) { //hey, a match!
        faceBrightness[f] = 255;
        faceSolved[f] = true;
      } else {//no match :(
        faceBrightness[f] = colorDim;
        faceSolved[f] = false;
      }

      //look for neighbors turning us back to setup

      if (getGameMode(neighborData) == SETUPAUTO) {
        gameMode = SETUPAUTO;
      }


    } else {//no neighbor
      faceBrightness[f] = colorDim;
      faceSolved[f] = false;
    }
  }

  //if we are double clicked, we go to assemble mode
  if (buttonDoubleClicked()) {
    if (gameMode == GAMEAUTO) {
      gameMode = SETUPAUTO;
    }
  }
}

/////////////////
//DISPLAY LOOPS//
/////////////////

void assembleDisplay() {
  if (sparkleTimer.isExpired() && canBeginAlgorithm) {
    FOREACH_FACE(f) {
      setColorOnFace(autoColors[random(3) + 1], f);
      sparkleTimer.set(50);
    }
  }

  if (!canBeginAlgorithm) {
    FOREACH_FACE(f) {
      setColorOnFace(dim(WHITE, faceBrightness[f]), f);
    }
  }
}

void gameDisplay() {

  Color displayColor;
  FOREACH_FACE(f) {
    displayColor = autoColors[faceColors[f]];
    byte displayBrightness;
    if (faceSolved[f]) {
      displayBrightness = sin8_C(map(syncTimer.getRemaining(), 0, PERIOD_DURATION, 0, 255));
    }
    else {
      displayBrightness = 255;
    }
    setColorOnFace(dim(displayColor, displayBrightness), f);
  }
}

///////////////////////
//COMMUNICATION LOOPS//
///////////////////////

void communicationMasterLoop() {

  if (gameMode == PACKETREADY) {//here we wait to send packets to listening neighbors

    byte neighborsListening = 0;
    byte emptyFace;
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {
        byte neighborData = getLastValueReceivedOnFace(f);
        if (getGameMode(neighborData) == PACKETLISTENING) {//this neighbor is ready to get a packet.
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

  } else if (gameMode == PACKETSENDING) {//here we listen for neighbors who have received packets

    byte neighborsReceived = 0;
    byte emptyFace;
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {
        byte neighborData = getLastValueReceivedOnFace(f);
        if (getGameMode(neighborData) == PACKETRECEIVED) {//this neighbor is ready to play
          neighborsReceived++;
        }
      } else {
        emptyFace = f;
      }
    }

    if (neighborsReceived == 5) { //hooray, we did it!
      gameMode = GAMEAUTO;
      return;
    }

    if (gameMode != GAMEAUTO && packetTimer.isExpired()) { //so we've gone a long time without this working out
      sendPuzzlePackets(emptyFace);
      packetTimer.set(TIMEOUT_DURATION);
    }
  }

  if (buttonDoubleClicked()) {
    gameMode = SETUPAUTO;
  }
}

void sendPuzzlePackets(byte blankFace) {
  //declare packets
  byte packet[6][6];

  //SEND PACKETS
  FOREACH_FACE(f) {
    FOREACH_FACE(ff) {
      packet[f][ff] = colorsArr[f][ff];
    }
    sendDatagramOnFace( &packet[f], sizeof(packet[f]), f);
  }

  //assign self the correct info
  FOREACH_FACE(f) {
    faceColors[f] = colorsArr[blankFace][f];
  }
}

void communicationReceiverLoop() {
  if (gameMode == PACKETLISTENING) {

    //listen for a packet on master face
    if (isDatagramReadyOnFace(masterFace)) {//is there a packet?
      if (getDatagramLengthOnFace(masterFace) == 6) {//is it the right length?
        byte *data = (byte *) getDatagramOnFace(masterFace);//grab the data
        //fill our array with this data
        FOREACH_FACE(f) {
          faceColors[f] = data[f];
        }
        //let them know we heard them
        gameMode = PACKETRECEIVED;

      }
    }

    //also listen for the master face to suddenly change back to setup, which is bad
    if (getGameMode(getLastValueReceivedOnFace(masterFace)) == SETUPAUTO) { //looks like we are reverting
      gameMode = SETUPAUTO;
    }

  } else if (gameMode == PACKETRECEIVED) {
    //wait for the master blink to transition to game
    if (getGameMode(getLastValueReceivedOnFace(masterFace)) == GAMEAUTO) { //time to play!
      gameMode = GAMEAUTO;

      // mark datagram as received
      FOREACH_FACE(f) {
        markDatagramReadOnFace(f);
      }
    }
  }

  if (buttonDoubleClicked()) {
    gameMode = SETUPAUTO;
  }
}

byte getSyncVal(byte data) {
  return (data >> 5) & 1;
}

byte getGameMode(byte data) {
  return (data >> 2) & 7;//1st, 2nd, 3rd, and 4th bits
}

byte getColorInfo(byte data) {
  return (data & 3);//returns the 5th and 6th bits
}

void communicationDisplay() {
  if (sparkleTimer.isExpired()) {
    FOREACH_FACE(f) {
      setColorOnFace(autoColors[random(3) + 1], f);
      sparkleTimer.set(50);
    }
  }
}

///////////////////////////////
//PUZZLE GENERATION ALGORITHM//
///////////////////////////////

void makePuzzle() {
  resetAll();
  piecesPlaced++;//this symbolically places the first blink in the center
  //place 2-4 NONEIGHBORS in first ring
  byte emptySpots = random(2) + 2;//this is how many NONEIGHBORS we're putting in
  FOREACH_FACE(f) {
    if (f < emptySpots) {
      neighborsArr[0][f] = NONEIGHBOR;
    }
  }

  for (int j = 0; j < 12; j++) {//quick shuffle method, random enough for our needs
    byte swapA = random(5);
    byte swapB = random(5);
    byte temp = neighborsArr[0][swapA];
    neighborsArr[0][swapA] = neighborsArr[0][swapB];
    neighborsArr[0][swapB] = temp;
  }

  //place blinks in remainings open spots
  for (byte j = 0; j < 6 - emptySpots; j++) {
    addBlink(0, 0);
  }

  byte remainingBlinks = 6 - piecesPlaced;
  byte lastRingBlinkIndex = piecesPlaced - 1;
  for (byte k = 0; k < remainingBlinks; k++) {
    addBlink(1, lastRingBlinkIndex);
  }
  colorConnections();
}

void resetAll() {
  piecesPlaced = 0;

  FOREACH_FACE(f) {
    FOREACH_FACE(i) {
      neighborsArr[f][i] = 0;
      colorsArr[f][i] = 0;
    }
  }
}

void addBlink(byte minSearchIndex, byte maxSearchIndex) {
  //we begin by evaluating how many eligible spots remain
  byte eligiblePositions = 0;
  for (byte i = minSearchIndex; i <= maxSearchIndex; i++) {
    FOREACH_FACE(f) {
      if (neighborsArr[i][f] == 0) { //this is an eligible spot
        eligiblePositions ++;
      }
    }
  }//end of eligible positions counter

  //now choose a random one of those eligible positions
  byte chosenPosition = random(eligiblePositions - 1) + 1;//necessary math to get 1-X values
  byte blinkIndex;
  byte faceIndex;
  //now determine which blink this is coming off of
  byte positionCountdown = 0;
  for (byte i = minSearchIndex; i <= maxSearchIndex; i++) {//same loop as above
    FOREACH_FACE(f) {
      if (neighborsArr[i][f] == 0) { //this is an eligible spot
        positionCountdown ++;
        if (positionCountdown == chosenPosition) {
          //this is it. Record the position!
          blinkIndex = i;
          faceIndex = f;
        }
      }
    }
  }//end of position finder

  //so first we simply place the connection data on the connecting faces
  neighborsArr[blinkIndex][faceIndex] = getCurrentPiece();//placing the new blink on the ring blink
  neighborsArr[piecesPlaced][getNeighborFace(faceIndex)] = blinkIndex + 1;//placing the ring blink on the new blink
  piecesPlaced++;

  //first, the counterclockwise face of the blinked we attached to
  byte counterclockwiseNeighborInfo = neighborsArr[blinkIndex][nextCounterclockwise(faceIndex)];
  if (counterclockwiseNeighborInfo != UNDECLARED) { //there is a neighbor or NONEIGHBOR on the next counterclockwise face of the blink we placed onto
    //we tell the new blink it has a neighbor or NONEIGHBOR clockwise from our connection
    byte newNeighborConnectionFace = nextClockwise(getNeighborFace(faceIndex));
    neighborsArr[piecesPlaced - 1][newNeighborConnectionFace] = counterclockwiseNeighborInfo;

    if (counterclockwiseNeighborInfo != NONEIGHBOR) { //if it's an actual blink, it needs to know about the new connection
      neighborsArr[counterclockwiseNeighborInfo - 1][getNeighborFace(newNeighborConnectionFace)] = piecesPlaced;
    }
  }

  //now, the clockwise face (everything reversed, but identical)
  byte clockwiseNeighborInfo = neighborsArr[blinkIndex][nextClockwise(faceIndex)];
  if (clockwiseNeighborInfo != UNDECLARED) { //there is a neighbor or NONEIGHBOR on the next clockwise face of the blink we placed onto
    //we tell the new blink it has a neighbor or NONEIGHBOR counterclockwise from our connection
    byte newNeighborConnectionFace = nextCounterclockwise(getNeighborFace(faceIndex));
    neighborsArr[piecesPlaced - 1][newNeighborConnectionFace] = clockwiseNeighborInfo;

    if (clockwiseNeighborInfo != NONEIGHBOR) { //if it's an actual blink, it needs to know about the new connection
      neighborsArr[clockwiseNeighborInfo - 1][getNeighborFace(newNeighborConnectionFace)] = piecesPlaced;
    }
  }
}

void colorConnections() {
  //you look through all the neighbor info. When you find a connection with no color, you make it
  FOREACH_FACE(f) {
    FOREACH_FACE(ff) {
      if (neighborsArr[f][ff] != UNDECLARED && neighborsArr[f][ff] != NONEIGHBOR) { //there is a connection here
        byte foundIndex = neighborsArr[f][ff] - 1;
        if (colorsArr[f][ff] == 0) { //we haven't made this connection yet!
          //put a random color there
          byte connectionColor = random(2) + 1;
          colorsArr[f][ff] = connectionColor;
          FOREACH_FACE(fff) { //go through the faces of the connecting blink, find the connection to the current blink
            if (neighborsArr[foundIndex][fff] == f + 1) {//the connection on the found blink's face is the current blink
              colorsArr[foundIndex][fff] = connectionColor;
            }
          }
        }
      }
    }
  }
}

byte getNeighborFace(byte face) {
  return ((face + 3) % 6);
}

byte nextClockwise (byte face) {
  if (face == 5) {
    return 0;
  } else {
    return face + 1;
  }
}

byte nextCounterclockwise (byte face) {
  if (face == 0) {
    return 5;
  } else {
    return face - 1;
  }
}

byte getCurrentPiece () {
  // Because a piece is represented by a value simply 1 greater than the pieces placed numner
  // this is more efficient to compile than the original switch statement. I understand this
  // is less clear to read, but it saves us needed space. Check the enum up top to understand
  // that 0 should return PIECE_A and 1 should return PIECE_B (which are shifted by one)
  return piecesPlaced + 1;
}

/*
   Keep ourselves on the same time loop as our neighbors
   if a neighbor passed go,
   we want to pass go as well
   (if we didn't just pass go)
   ... or collect $200
*/
void syncLoop() {

  bool didNeighborChange = false;

  // look at our neighbors to determine if one of them passed go (changed value)
  // note: absent neighbors changing to not absent don't count
  FOREACH_FACE(f) {
    if (isValueReceivedOnFaceExpired(f)) {
      neighborState[f] = 2; // this is an absent neighbor
    }
    else {
      byte data = getLastValueReceivedOnFace(f);
      if (neighborState[f] != 2) {  // wasn't absent
        if (getSyncVal(data) != neighborState[f]) { // passed go (changed value)
          didNeighborChange = true;
        }
      }

      neighborState[f] = getSyncVal(data);  // update our record of state now that we've check it
    }
  }

  // if our neighbor passed go and we haven't done so within the buffer period, catch up and pass go as well
  // if we are due to pass go, i.e. timer expired, do so
  if ( (didNeighborChange && syncTimer.getRemaining() < PERIOD_DURATION - BUFFER_DURATION)
       || syncTimer.isExpired()
     ) {

    syncTimer.set(PERIOD_DURATION); // aim to pass go in the defined duration
    syncVal = !syncVal; // change our value everytime we pass go
  }
}