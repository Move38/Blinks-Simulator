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