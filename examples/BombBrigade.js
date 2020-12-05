self.importScripts('js/blink.js')

/*
    BombBrigade
    by Jeff Kowalski, Holly Gore, Collin Gallo
    Lead development by Jonathan Bobrow
    original game by Jeff Kowalski, Holly Gore, Collin Gallo

    Rules: https:

    --------------------
    Blinks by Move38
    Brought to life via Kickstarter 2018

    @madewithblinks
    www.move38.com
    --------------------
*/

const SHIELD_MAX_HEALTH = 4
const SHIELD_MIN_HEALTH = 0

const MAX_CLICK_COUNT = 10

const SHOW_FACE_DURATION_MS = 750

const SPREAD_READY = 0;
const SPREAD_RESOLVE = 1;
const READY = 2;
const BOMB = 3;
const SHIELD = 4;
const SPARK = 5;
const SPARK_SPECIAL = 6;
const EXPLOSION = 7;


let mode = READY;

let shieldHealth;

let bombTickTimer = new Timer(self);
let bombShowFaceTimer = new Timer(self);

let  bSpinning;
let  bExplode;
let  bExplodeIntoShield;
let  bombTickFace;
let  bombClickCount;

let  bombCountDownCount;

let  bShareExplosion;
let  shareExplosionFace;

let timeOfReset = 0;

let bReset = false;

function setup() {

  
  resetAll();
  mode = READY;
}

function loop() {

  /*
     Button Actions
  */
  if ( buttonPressed() ) {

    if ( mode == BOMB ) {

      
      bombShowFaceTimer.set( SHOW_FACE_DURATION_MS );

      if (bombClickCount < MAX_CLICK_COUNT) {

        bombClickCount++;

        
        if ( random(100) < bombClickCount * 5 ) {
          bExplode = true;
          bSpinning = false;
        }
      }
      else {
        
        
        bExplode = true;
        bSpinning = false;
      }
    } 

    else if (mode == SHIELD ) {

      

    }

    else if (mode == READY ) {

      

    }
  }


  if ( buttonDoubleClicked() ) {

    if ( mode == READY ) {
      
      mode = BOMB;

      
      resetSpin();
      bSpinning = true;
    }

    else if ( mode == BOMB ) {
      
      if (bSpinning == false ) { 
        resetSpin();
        bSpinning = true;
      }
    }

    else if ( mode == SHIELD ) {
      
    }
  }

  
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
      
      
      for(let  f  = 0;  f  < FACE_COUNT;  f ++) {
        if ( !isValueReceivedOnFaceExpired( f ) ) {
          let neighbor = getLastValueReceivedOnFace( f );

          if (neighbor == BOMB) {
            mode = SHIELD;
          }
        }
      }
      break;

    case BOMB:
      
      if ( bSpinning ) {
        if (!bombShowFaceTimer.isExpired()) {
          
        }
        else {

          if ( bombTickTimer.isExpired() ) {
            bombTickTimer.set( getTickRate( bombClickCount ) );
            bombTickFace++;
            if ( bombTickFace >= FACE_COUNT ) {
              bombTickFace = 0;
            }

            
            if ( bombCountDownCount != 0 ) {
              bombCountDownCount--;
            }
          }
        }
      }
      else {
        
        if ( !isValueReceivedOnFaceExpired( bombTickFace ) ) {
          
          bExplodeIntoShield = true;
        }
      }
      
      
      
      
      break;

    case SHIELD:
      
      bShareExplosion = false;

      for(let  f  = 0;  f  < FACE_COUNT;  f ++) {
        if ( !isValueReceivedOnFaceExpired( f ) ) {

          let neighbor = getLastValueReceivedOnFace( f );
          let didNeighborJustChange = didValueOnFaceChange( f );

          if ( neighbor == SPARK && didNeighborJustChange ) {

            
            if ( shieldHealth == SHIELD_MIN_HEALTH ) {
              

            } else {
              shieldHealth--;
            }
          }

          
          if ( neighbor == EXPLOSION ) {
            
            bShareExplosion = true;
            shareExplosionFace = f;
          }
        }
      }
      
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
      
      
      {
        
        let hue = ((millis() - timeOfReset) / 40) % 350;
        if (hue > 175) {
          hue = (350 - hue + 127) % 255;  
          setColor(makeColorHSB(hue, 255, 255));
        }
        else {
          hue = (hue + 127) % 255;  
          setColor(makeColorHSB(hue, 255, 255));
        }
        break;
      }
    case BOMB:
      
      
      if ( bSpinning ) {

        if ( bombCountDownCount == 0 ) {
          
          let prevFace = (FACE_COUNT + bombTickFace - 1) % FACE_COUNT;
          setFaceColor( prevFace, OFF);
          setFaceColor( bombTickFace, ORANGE );

          
          if (!bombShowFaceTimer.isExpired()) {
            setFaceColor( bombTickFace, dim( YELLOW, random(255)));  
          }
        }
        else {
          switch (bombCountDownCount) {
            case 5: setFaceColor( bombTickFace, makeColorRGB(255, 255, 150) ); break; 
            case 4: setFaceColor( bombTickFace, makeColorRGB(255, 235,  75) ); break; 
            case 3: setFaceColor( bombTickFace, makeColorRGB(255, 215,  30) ); break; 
            case 2: setFaceColor( bombTickFace, makeColorRGB(255, 195,   0) ); break; 
            case 1: setFaceColor( bombTickFace, makeColorRGB(255, 175,   0) ); break; 
          }
        }
      }
      else {
        if ( bExplode ) {
          if ( bExplodeIntoShield ) {
            for(let  f  = 0;  f  < FACE_COUNT;  f ++) {
              setFaceColor( f, GREEN);         
            }
            setFaceColor( bombTickFace, dim( ORANGE, random(255)));  
          }
          else {
            for(let  f  = 0;  f  < FACE_COUNT;  f ++) {
              setFaceColor( f, makeColorHSB(random(25), 255, random(1) * 255));         
            }
            setFaceColor( bombTickFace, WHITE );
          }
          
          
        }
      }
      
      
      break;

    case SHIELD:
      
      if ( shieldHealth == SHIELD_MIN_HEALTH ) {
        

        if ( isAlone() ) {
          
          setFaceColor( (millis() / 40) % 6, makeColorHSB( ( millis() / 5) % 255, 255, 255) ); 
        }
        else {
          
          setColor(OFF);
          setFaceColor( random(5), makeColorHSB( ( millis() / 5) % 255, 255, 255) ); 
          setFaceColor( random(5), makeColorHSB( ( (millis() + 127) / 5) % 255, 255, 255) ); 
        }
      }
      else {
        setColor( getShieldColor( shieldHealth ) );

        
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
      
      setValueSentOnAllFaces( mode );
      break;

    case BOMB:
      
      setValueSentOnAllFaces( mode );

      
      if ( bExplode ) {

        if ( bExplodeIntoShield ) {
          setValueSentOnFace( SPARK, bombTickFace );
        }
        else {
          
          setValueSentOnAllFaces( EXPLOSION );
        }
      }
      
      break;

    case SHIELD:
      setValueSentOnAllFaces( SHIELD );
      
      
      break;

    default: break;
  }
}

/*
   Get ready to spin again
*/
function resetSpin() {
  
  
  
  bSpinning = false;
  bombClickCount = 0;
  bExplode = false;
  bExplodeIntoShield = false;
  bombCountDownCount = FACE_COUNT;
}

/*
   Spread the good word, reset is called for :)
*/

function propogateReset() {
  if (mode == SPREAD_READY) {

    mode = SPREAD_RESOLVE;

    for(let f = 0; f < FACE_COUNT; f++) {
      if (!isValueReceivedOnFaceExpired(f)) {
        let neighborData = getLastValueReceivedOnFace(f);

        if (neighborData == SPREAD_READY || neighborData == SPREAD_RESOLVE) {
          
        } else {
          mode = SPREAD_READY;
        }
      }
    }
  } else if (mode == SPREAD_RESOLVE) {
    mode = READY;
    for(let f = 0; f < FACE_COUNT; f++) {
      if (!isValueReceivedOnFaceExpired(f)) {
        let neighborData = getLastValueReceivedOnFace(f);
        if (neighborData == SPREAD_READY) {
          mode = SPREAD_RESOLVE;
        }
      }
    }
  } else {
    for(let  f  = 0;  f  < FACE_COUNT;  f ++) {
      if (!isValueReceivedOnFaceExpired(f)) {
        let neighborData = getLastValueReceivedOnFace(f);
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
function resetAll() {
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
function getTickRate(clickCount) {

  let tickRate = 200;

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

function getShieldColor( health ) {

  let shieldColor = OFF;  

  switch ( health ) {
    case 0: shieldColor = WHITE; break;                         
    case 1: shieldColor = makeColorHSB(  0, 255, 255); break;   
    case 2: shieldColor = makeColorHSB( 25, 255, 255); break;   
    case 3: shieldColor = makeColorHSB( 50, 255, 255); break;   
    case 4: shieldColor = makeColorHSB( 75, 255, 255); break;   
  }

  return shieldColor;
}

/*
   Share explosion
*/
function shareExplosion( face ) {

  setFaceColor( shareExplosionFace, makeColorHSB(random(25), 255, 255 - ((millis() / 2) % 255) ) );

  
  let prevFace = (FACE_COUNT + face - 1) % FACE_COUNT;
  let nextFace = (face + 1) % FACE_COUNT;

  setFaceColor( prevFace, makeColorHSB(random(25), 255, 255 - (((millis() - 40) / 2) % 255) ) );
  setFaceColor( nextFace, makeColorHSB(random(25), 255, 255 - (((millis() - 40) / 2) % 255) ) );

}
