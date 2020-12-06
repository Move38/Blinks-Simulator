enum signalStates { INERT, GO, RESOLVE };
byte signalState = INERT;
enum gameModes {MODE1, MODE2, MODE3, MODE4};//these modes will simply be different colors
byte gameMode = MODE1;//the default mode when the game begins
void loop() {
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
    byte sendData = (signalState << 2) + (gameMode);
    setValueSentOnAllFaces(sendData);
}
void inertLoop() {
    //set myself to GO
    if (buttonSingleClicked()) {
        signalState = GO;
        gameMode = (gameMode + 1) % 4;//adds one to game mode, but 3+1 becomes 0
    }
    //listen for neighbors in GO
    FOREACH_FACE(f) {
        if (!isValueReceivedOnFaceExpired(f)) { //a neighbor!
            if (getSignalState(getLastValueReceivedOnFace(f)) == GO) { //a neighbor saying GO!
                signalState = GO;
                gameMode = getGameMode(getLastValueReceivedOnFace(f));
            }
        }
    }
}
void goLoop() {
    signalState = RESOLVE; //I default to this at the start of the loop. Only if I see a problem does this not happen

    //look for neighbors who have not heard the GO news
    FOREACH_FACE(f) {
        if (!isValueReceivedOnFaceExpired(f)) { //a neighbor!
            if (getSignalState(getLastValueReceivedOnFace(f)) == INERT) {//This neighbor doesn't know it's GO time. Stay in GO
                signalState = GO;
            }
        }
    }
}
void resolveLoop() {
    signalState = INERT; //I default to this at the start of the loop. Only if I see a problem does this not happen

    //look for neighbors who have not moved to RESOLVE
    FOREACH_FACE(f) {
        if (!isValueReceivedOnFaceExpired(f)) { //a neighbor!
            if (getSignalState(getLastValueReceivedOnFace(f)) == GO) {//This neighbor isn't in RESOLVE. Stay in RESOLVE
                signalState = RESOLVE;
            }
        }
    }
}
void displaySignalState() {
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

byte getGameMode(byte data) {
  return (data & 3);//returns bits E and F
}

byte getSignalState(byte data) {
  return ((data >> 2) & 3);//returns bits C and D
}