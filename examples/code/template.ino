/*
    Blinks Simulator by Move38

    Find out more about this project: 
    https://github.com/Move38/Blinks-Simulator
    Click and drag blinks to re-arrange them.
    Click and drag in an open space to break them.
    You can use console.log() for debugging info
*/

void setup() {
    setColor(WHITE);
}

void loop() {
    setColorOnFace(ORANGE, (millis() / 1000) % 6);
}
