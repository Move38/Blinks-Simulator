/// Show some soothing color ramps.

void setup() {

  // No setup needed for this simple example!  

}


// There are 255 brightness levels in each ramp.
// We step 30 levels every 10 milliseconds, so...
// Each ramp will take about ((100 ms/step)/(1000 ms/sec)) / ( (255 levels/ramp ) / ( 30 levels/step) ) =
// ~1.17 secs/ramp
// We do an up ramp and then a down ramp for each color

#define STEP_SIZE 10  
#define STEP_TIME_MS 30

Color colors[] = { BLUE ,   RED , GREEN   };

byte colorIndex = 0; 

int brightness = 1; 

int step = STEP_SIZE;

Timer nextStepTimer;

void loop() {

  if (nextStepTimer.isExpired()) {

    // Change direction if we hit either boundary

    if ( (brightness + step > MAX_BRIGHTNESS ) || (brightness + step < 0 ) ) {      
      
      step = -step; 

      if (step>0) {   // If we hit bottom, then time to move on to next color

        colorIndex++;

        if (colorIndex >= COUNT_OF( colors ) ) {

          colorIndex =0; 
        
        }

      
      }
             
    
    } 

    brightness += step;     
    
    setColor( dim( colors[colorIndex] ,  brightness  ) );

    nextStepTimer.set( STEP_TIME_MS ); 

  }
 
}
