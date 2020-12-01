/*
void setup() {
    setValueSentOnAllFaces(0);
    setValueSentOnFace(1, 0);
}

void loop() {
    //each frame we'll check to see if we've made a correct connection
    bool isConnectedCorrectly = false;
    if (!isValueReceivedOnFaceExpired(0)) { //a neighbor!
        if (getLastValueReceivedOnFace(0) == 1) {
            isConnectedCorrectly = true;
        }
    }
    //now we set the display
    if (isConnectedCorrectly) {
        setColor(MAGENTA);
    } else {
        setColor(OFF);
    }
    //always set the special face to white regardless
    setColorOnFace(WHITE, 0);
}
*/

self.importScripts('worker.js')

function setup() {
    setValueSentOnAllFaces(0);
    setValueSentOnFace(1, 0);
}

function loop() {
    //each frame we'll check to see if we've made a correct connection
    let isConnectedCorrectly = false;
    if (!isValueReceivedOnFaceExpired(0)) { //a neighbor!
        if (getLastValueReceivedOnFace(0) == 1) {
            isConnectedCorrectly = true;
        }
    }

    //now we set the display
    if (isConnectedCorrectly) {
        setColor(MAGENTA);
    } else {
        setColor(OFF);
    }

    //always set the special face to white regardless
    setColorOnFace(WHITE, 0);
}