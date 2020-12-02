/*
#define PRESS_FADE_DURATION 500
Timer pressFadeTimer;
bool longPressing = false;

void loop() {
    if (buttonPressed()) {//begin the press fade
        pressFadeTimer.set(PRESS_FADE_DURATION);
    }
    if (buttonReleased()) {//begin the press fade
        pressFadeTimer.set(PRESS_FADE_DURATION);
        longPressing = false;
    }
    if (buttonLongPressed()) {
        longPressing = true;
    }
    displayLoop();
}

void displayLoop() {
    //set color for when there are no active clicks or presses, just button down
    if (buttonDown()) {
        if (longPressing) {
            setColor(BLUE);
        } else {
            setColor(RED);
        }
    } else {
        setColor(WHITE);
    }
    //check for press fades
    if (!pressFadeTimer.isExpired()) {//the fade is currently active
        setColor(dim(YELLOW, pressFadeTimer.getRemaining() / 2));//dims from 250 to 0
    }
}
*/

self.importScripts('../blink.js')

const PRESS_FADE_DURATION = 500;
let pressFadeTimer = new Timer(self);
let longPressing = false;

function loop() {
    if (buttonPressed()) {//begin the press fade
        pressFadeTimer.set(PRESS_FADE_DURATION);
    }
    if (buttonReleased()) {//begin the press fade
        pressFadeTimer.set(PRESS_FADE_DURATION);
        longPressing = false;
    }
    if (buttonLongPressed()) {
        longPressing = true;
    }
    displayLoop();
}

function displayLoop() {
    //set color for when there are no active clicks or presses, just button down
    if (buttonDown()) {
        if (longPressing) {
            setColor(BLUE);
        } else {
            setColor(RED);
        }
    } else {
        setColor(WHITE);
    }

    //check for press fades
    if (!pressFadeTimer.isExpired()) {//the fade is currently active
        setColor(dim(YELLOW, pressFadeTimer.getRemaining() / 2));//dims from 250 to 0
    }
}