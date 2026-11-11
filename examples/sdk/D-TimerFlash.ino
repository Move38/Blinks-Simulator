void setup() {

  // No setup needed for this simple example!  

}

Timer nextFlash;    // Timers are initialized as already being expired, so we will flash the first time loop() called. 

void loop() {

  if (nextFlash.isExpired()) {

    setColor( RED );      

    nextFlash.set(200);   // Flash again in 200 millseconds  

  } else {

    setColor( OFF ); 
    
  }

  // Any color set in loop() is guaranteed to show up on the tile for at least one frame, 
  // which is about 1/60th of a second. It will be a fast flash, but visible.
  
}
