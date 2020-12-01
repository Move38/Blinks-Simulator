/*
byte clicks = 1;

void loop() {
    // put your main code here, to run repeatedly:
    if (buttonSingleClicked()) {
        clicks = 1;
    }
    if (buttonDoubleClicked()) {
        clicks = 2;
    }
    if (buttonMultiClicked()) {
        clicks = buttonClickCount();
    }
    displayLoop();
}

void displayLoop() {
    setColor(OFF);
    FOREACH_FACE(f) {
        if (f < clicks) { //this face should be lit
            setColorOnFace(WHITE, f);
        }
        if (clicks > 6) {
            setColor(RED);
        }
    }
}
*/

self.importScripts('worker.js')

let clicks = 1;

function loop() {
    // put your main code here, to run repeatedly:
    if (buttonSingleClicked()) {
        clicks = 1;
    }
    if (buttonDoubleClicked()) {
        clicks = 2;
    }
    if (buttonMultiClicked()) {
        clicks = buttonClickCount();
    }
    displayLoop();
}

function displayLoop() {
    setColor(OFF);
    for (let f = 0; f < 6; f++) {
        if (f < clicks) { //this face should be lit
            setColorOnFace(WHITE, f);
        }
        if (clicks > 6) {
            setColor(RED);
        }
    }
}