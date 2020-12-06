/*
    Blinks Simulator by Move38
    
    Find out more about this project: 
    https://github.com/Move38/Blinks-Simulator
*/

void setup() {
    setColor(WHITE);
}

void loop() {
    setColorOnFace(ORANGE, (millis() / 1000) % 6);
}