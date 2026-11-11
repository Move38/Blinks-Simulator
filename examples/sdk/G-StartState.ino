// Show how the current game was loaded
// BLUE  - We are the root of a download seed
// GREEN - We downloaded the game from someone else (not root)
// RED   - Anything else (battery changed, failed download, etc)

void setup() {

  // No setup needed for this simple example!  

}

void loop() {


  Color color; 

  switch ( startState() ) {

    case START_STATE_WE_ARE_ROOT:
      color = BLUE;
      break;

    case START_STATE_DOWNLOAD_SUCCESS:
      color = GREEN;
      break;

    default:
      color = RED;
      break;
            
  }

  byte brightness = sin8_C( millis() & 0xff  );    // throb at about 4 Hz (1000 millis / 256 steps-per-sin8_C-cycle) 

  setColor( dim( color ,  brightness  ) );

 
}
