/*
 * Example showing how to use the serial port.
 * 
 * Enter the letters "R", "G", or "B" over the serial port to change the color of the blink.
 * Push the button on the blink to set back to WHITE. 
 * 
 * To use this you'll need to connect a serial terminal to the Blinks service port. 
 * More info on how to do that here...
 * https://github.com/bigjosh/Move38-Arduino-Platform/blob/master/Service%20Port.MD
 */

#include "Serial.h"

ServicePortSerial Serial;

void setup() {

  Serial.begin();
  Serial.println("Send the letter R,G, or B to change color...");

  setColor( WHITE ) ; 
  
}


void loop() {

  if (Serial.available()) {

    int c = Serial.read();    // We know this will return a non-negative value since we checked that there was a byte available above

    switch (c) {

      case 'R': 
      case 'r':      
        setColor(RED);
        Serial.println("Color set to RED.");        
        break;
        
      case 'G':
      case 'g': 
        setColor(GREEN);
        Serial.println("Color set to GREEN.");                
        break;
        
      case 'B':
      case 'b': 
        setColor(BLUE);
        Serial.println("Color set to BLUE.");                
        break;

      case '\r':
      case '\n':
        break;      // Ignore carridge return/enter key
       
      default: 
        Serial.println("I didn't understand.");
        break;

    }

  }


  if (buttonPressed()) {

    
        Serial.println("Button pressed.");                
        setColor(WHITE);
        Serial.println("Color set to WHITE.");                

  }
  
}
