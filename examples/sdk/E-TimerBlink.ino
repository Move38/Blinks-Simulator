void setup() {

  // No setup needed for this simple example!  

}

bool onFlag = false;

Timer nextChange;


void loop() {

  if (nextChange.isExpired()) {

    if (onFlag) {

      setColor( OFF );      
      onFlag = false;

    } else {

      setColor(BLUE);
      onFlag = true; 
      
    }

    nextChange.set(500);   // Toggle every 500 milliseconds 

  }
  
}
