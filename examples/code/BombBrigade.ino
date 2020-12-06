/*
    BombBrigade
    by Jeff Kowalski, Holly Gore, Collin Gallo
    Lead development by Jonathan Bobrow
    original game by Jeff Kowalski, Holly Gore, Collin Gallo

    Rules: https://github.com/Move38/BombBrigade/blob/master/README.md

    --------------------
    Blinks by Move38
    Brought to life via Kickstarter 2018

    @madewithblinks
    www.move38.com
    --------------------
*/

#define SHIELD_MAX_HEALTH  4
#define SHIELD_MIN_HEALTH  0

#define MAX_CLICK_COUNT    10

#define SHOW_FACE_DURATION_MS  750

enum Modes {
  SPREAD_READY,   // tell others to get ready for the game to start
  SPREAD_RESOLVE,  // waiting for READY to be fully spread

  READY,          // waiting for the game to start
  BOMB,           // center piece you are trying to defuse
  SHIELD,         // surrounding pieces to protect you from the bomb
  SPARK,          // let the shield know it's been damaged
  SPARK_SPECIAL,  // let the shield know it's been damaged fully
  EXPLOSION       // let the shield help our bomb in displaying an explosion
};

byte mode = READY;

byte shieldHealth;

Timer bombTickTimer;
Timer bombShowFaceTimer;

bool  bSpinning;
bool  bExplode;
bool  bExplodeIntoShield;
byte  bombTickFace;
byte  bombClickCount;

byte  bombCountDownCount;

bool  bShareExplosion;
byte  shareExplosionFace;

uint32_t timeOfReset = 0;

bool bReset = false;

void setup() {

  // Initialize all of our variables
  resetAll();
  mode = READY;
}

void loop() {

  /*
     Button Actions
  */
  if ( buttonPressed() ) {

    if ( mode == BOMB ) {

      // we were just pushed, give user feedback on which face they just landed on
      bombShowFaceTimer.set( SHOW_FACE_DURATION_MS );

      if (bombClickCount < MAX_CLICK_COUNT) {

        bombClickCount++;

        // chance of explode based on clickCount
        if ( random(100) < bombClickCount * 5 ) {
          bExplode = true;
          bSpinning = false;
        }
      }
      else {
        // we've been clicked the maximum amount of times
        // time to explode
        bExplode = true;
        bSpinning = false;
      }
    } // END BOMB

    else if (mode == SHIELD ) {

      // respond with a fun hello... don't effect game state

    }

    else if (mode == READY ) {

      // respond with a fun hello... don't effect game state

    }
  }


  if ( buttonDoubleClicked() ) {

    if ( mode == READY ) {
      // become the bomb
      mode = BOMB;

      // and start spinning
      resetSpin();
      bSpinning = true;
    }

    else if ( mode == BOMB ) {
      // start the spinning again
      if (bSpinning == false ) { // don't allow a reset mid-round
        resetSpin();
        bSpinning = true;
      }
    }

    else if ( mode == SHIELD ) {
      // respond with a fun hello... don't effect game state
    }
  }

  //long press business
  if (hasWoken()) {
    bReset = false;
  }

  if (buttonLongPressed()) {
    bReset = true;
  }

  if (buttonReleased() && bReset) {
    resetAll();
    bReset = false;
  }

  /*
     Game Logic
  */

  propogateReset();

  switch (mode) {

    case READY:
      // keep a look out for incoming signal saying we are a shield
      // if we get that message, change to shield mode
      FOREACH_FACE( f ) {
        if ( !isValueReceivedOnFaceExpired( f ) ) {
          byte neighbor = getLastValueReceivedOnFace( f );

          if (neighbor == BOMB) {
            mode = SHIELD;
          }
        }
      }
      break;

    case BOMB:
      // if we are spinning, spin the speed expected
      if ( bSpinning ) {
        if (!bombShowFaceTimer.isExpired()) {
          // hold on this face to show spark on this face
        }
        else {

          if ( bombTickTimer.isExpired() ) {
            bombTickTimer.set( getTickRate( bombClickCount ) );
            bombTickFace++;
            if ( bombTickFace >= FACE_COUNT ) {
              bombTickFace = 0;
            }

            // move our countdown for us
            if ( bombCountDownCount != 0 ) {
              bombCountDownCount--;
            }
          }
        }
      }
      else {
        // we're exploded
        if ( !isValueReceivedOnFaceExpired( bombTickFace ) ) {
          // if someone present where we exploded, we safe
          bExplodeIntoShield = true;
        }
      }
      // if we've sparked, check to see if we've hit a sheild, or nothing
      // if nothing, then the spark becomes an explosion
      // if we hit a shield, the spark shows direction
      // if we have only one shield and we blow it away, we win
      break;

    case SHIELD:
      // if we see a spark lower our shield value by 1
      bShareExplosion = false;

      FOREACH_FACE( f ) {
        if ( !isValueReceivedOnFaceExpired( f ) ) {

          byte neighbor = getLastValueReceivedOnFace( f );
          bool didNeighborJustChange = didValueOnFaceChange( f );

          if ( neighbor == SPARK && didNeighborJustChange ) {

            // if our shield value is 0, become an explosion
            if ( shieldHealth == SHIELD_MIN_HEALTH ) {
              // explode this shield (maybe rainbow fun here)

            } else {
              shieldHealth--;
            }
          }

          // if we see an explosion, react to it
          if ( neighbor == EXPLOSION ) {
            // explosion here
            bShareExplosion = true;
            shareExplosionFace = f;
          }
        }
      }
      // if we see an explosion, help animate that explosion
      break;

    default: break;
  }

  /*
     Display
  */
  switch (mode) {

    case SPREAD_READY:
    case SPREAD_RESOLVE:
    case READY:
      // display readiness or waiting
      // slowly progressing rainbow
      {
        // ping pong the hue between blue and yellow/orange and then back never green...
        word hue = ((millis() - timeOfReset) / 40) % 350;
        if (hue > 175) {
          hue = (350 - hue + 127) % 255;  // shift to start in the blue
          setColor(makeColorHSB(hue, 255, 255));
        }
        else {
          hue = (hue + 127) % 255;  // shift to start in the blue
          setColor(makeColorHSB(hue, 255, 255));
        }
        break;
      }
    case BOMB:
      // display countdown
      // or spinner
      if ( bSpinning ) {

        if ( bombCountDownCount == 0 ) {
          // when done with the countdown, no need to have the cool wipe effect :)
          byte prevFace = (FACE_COUNT + bombTickFace - 1) % FACE_COUNT;
          setFaceColor( prevFace, OFF);
          setFaceColor( bombTickFace, ORANGE );

          // flicker if we are paused and showing face
          if (!bombShowFaceTimer.isExpired()) {
            setFaceColor( bombTickFace, dim( YELLOW, random(255)));  // flicker YELLOW
          }
        }
        else {
          switch (bombCountDownCount) {
            case 5: setFaceColor( bombTickFace, makeColorRGB(255, 255, 150) ); break; // WHITE-YELLOW
            case 4: setFaceColor( bombTickFace, makeColorRGB(255, 235,  75) ); break; // --
            case 3: setFaceColor( bombTickFace, makeColorRGB(255, 215,  30) ); break; // --
            case 2: setFaceColor( bombTickFace, makeColorRGB(255, 195,   0) ); break; // --
            case 1: setFaceColor( bombTickFace, makeColorRGB(255, 175,   0) ); break; // YELLOW-ORANGE
          }
        }
      }
      else {
        if ( bExplode ) {
          if ( bExplodeIntoShield ) {
            FOREACH_FACE( f ) {
              setFaceColor( f, GREEN);         // show that we are safe
            }
            setFaceColor( bombTickFace, dim( ORANGE, random(255)));  // flicker YELLOW
          }
          else {
            FOREACH_FACE( f ) {
              setFaceColor( f, makeColorHSB(random(25), 255, random(1) * 255));         // show that we are out... huge explosion
            }
            setFaceColor( bombTickFace, WHITE );
          }
          // show white if safe
          // red if out....
        }
      }
      // or spark
      // or explosion
      break;

    case SHIELD:
      // display shield level
      if ( shieldHealth == SHIELD_MIN_HEALTH ) {
        // show explosion

        if ( isAlone() ) {
          // rotating rainbow now that we have a token
          setFaceColor( (millis() / 40) % 6, makeColorHSB( ( millis() / 5) % 255, 255, 255) ); // ROTATING RAINBOW
        }
        else {
          // disco explosion
          setColor(OFF);
          setFaceColor( random(5), makeColorHSB( ( millis() / 5) % 255, 255, 255) ); // ROTATING RAINBOW
          setFaceColor( random(5), makeColorHSB( ( (millis() + 127) / 5) % 255, 255, 255) ); // ROTATING RAINBOW
        }
      }
      else {
        setColor( getShieldColor( shieldHealth ) );

        // or helping show internal explosion
        if (bShareExplosion) {
          shareExplosion( shareExplosionFace );
        }

      }
      break;

    default: break;
  }

  if (bReset) {
    setColor(CYAN);
  }

  /*
     Communications (Sending)
  */
  switch (mode) {

    case SPREAD_READY:
      setValueSentOnAllFaces( mode );
      break;

    case SPREAD_RESOLVE:
      setValueSentOnAllFaces( mode );
      break;

    case READY:
      // broadcast ready state... nothing to do here
      setValueSentOnAllFaces( mode );
      break;

    case BOMB:
      // broadcast bomb (let shields know you are a bomb)
      setValueSentOnAllFaces( mode );

      // if sparked, send in a direction
      if ( bExplode ) {

        if ( bExplodeIntoShield ) {
          setValueSentOnFace( SPARK, bombTickFace );
        }
        else {
          // share the explosion with others
          setValueSentOnAllFaces( EXPLOSION );
        }
      }
      // once spark received, return to bomb broadcast
      break;

    case SHIELD:
      setValueSentOnAllFaces( SHIELD );
      // confirm spark received
      // share shield strength to the bomb
      break;

    default: break;
  }
}

/*
   Get ready to spin again
*/
void resetSpin() {
  // reset the spin variables
  // set spin speed to slowest
  // start the spin countdown
  bSpinning = false;
  bombClickCount = 0;
  bExplode = false;
  bExplodeIntoShield = false;
  bombCountDownCount = FACE_COUNT;
}

/*
   Spread the good word, reset is called for :)
*/

void propogateReset() {
  if (mode == SPREAD_READY) {//check if all of my neighbors know we are propogating

    mode = SPREAD_RESOLVE;//assume I can resolve as long as it all works out

    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
        byte neighborData = getLastValueReceivedOnFace(f);

        if (neighborData == SPREAD_READY || neighborData == SPREAD_RESOLVE) {
          //this neighbor is spreading, which I'm cool with
        } else {//This neighbor hasn't gotten the message yet
          mode = SPREAD_READY;//not ready to resolve
        }
      }
    }
  } else if (mode == SPREAD_RESOLVE) {
    mode = READY;//assume I can become ready as long as it all works out
    FOREACH_FACE(f) {
      if (!isValueReceivedOnFaceExpired(f)) {//neighbor!
        byte neighborData = getLastValueReceivedOnFace(f);
        if (neighborData == SPREAD_READY) {//this neighbor is still informing other people
          mode = SPREAD_RESOLVE;//not ready to go to READY state
        }
      }
    }
  } else {//any other mode, which is not part of the spread (INERT)
    FOREACH_FACE( f ) {
      if (!isValueReceivedOnFaceExpired(f)) {
        byte neighborData = getLastValueReceivedOnFace(f);
        if (neighborData == SPREAD_READY) {
          resetAll();
        }
      }
    }
  }
}

/*
   Reset all of our variables for a new game
*/
void resetAll() {
  mode = SPREAD_READY;
  shieldHealth = SHIELD_MAX_HEALTH;
  bSpinning = false;
  bombTickFace = 0;
  bombClickCount = 0;
  bExplode = false;
  bExplodeIntoShield = false;
  bombCountDownCount = FACE_COUNT;
  bShareExplosion = false;
  timeOfReset = millis();
}

/*
   Return a frequency at which the bomb should spin
   Fine tune this to get more an more exciting
   The optimal tuning does not seem to be linear
*/
byte getTickRate(byte clickCount) {

  byte tickRate = 200;

  switch (clickCount) {
    case 0:  tickRate = 120; break;
    case 1:  tickRate = 100; break;
    case 2:  tickRate =  80; break;
    case 3:  tickRate =  60; break;
    case 4:  tickRate =  50; break;
    case 5:  tickRate =  45; break;
    case 6:  tickRate =  40; break;
    case 7:  tickRate =  35; break;
    case 8:  tickRate =  30; break;
    case 9:  tickRate =  25; break;
    case 10: tickRate =  20; break;
  }

  return tickRate;
}

Color getShieldColor( byte health ) {

  Color shieldColor = OFF;  // default

  switch ( health ) {
    case 0: shieldColor = WHITE; break;                         // WHITE - TODO: replace w/ EXPLOSION
    case 1: shieldColor = makeColorHSB(  0, 255, 255); break;   // RED
    case 2: shieldColor = makeColorHSB( 25, 255, 255); break;   // ORANGE
    case 3: shieldColor = makeColorHSB( 50, 255, 255); break;   // YELLOW
    case 4: shieldColor = makeColorHSB( 75, 255, 255); break;   // GREEN
  }

  return shieldColor;
}

/*
   Share explosion
*/
void shareExplosion( byte face ) {

  setFaceColor( shareExplosionFace, makeColorHSB(random(25), 255, 255 - ((millis() / 2) % 255) ) );

  // use the neighboring faces as well
  byte prevFace = (FACE_COUNT + face - 1) % FACE_COUNT;
  byte nextFace = (face + 1) % FACE_COUNT;

  setFaceColor( prevFace, makeColorHSB(random(25), 255, 255 - (((millis() - 40) / 2) % 255) ) );
  setFaceColor( nextFace, makeColorHSB(random(25), 255, 255 - (((millis() - 40) / 2) % 255) ) );

}
