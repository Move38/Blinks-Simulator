self.importScripts('js/blink.js')

 /*
 *  Mortals
 *  by Move38, Inc. 2019
 *  Lead development by Jonathan Bobrow
 *  original game by Nick Bentley, Jonathan Bobrow, Justin Ha
 *
 *  Rules: https:
 *
 *  --------------------
 *  Blinks by Move38
 *  Brought to life via Kickstarter 2018
 *
 *  @madewithblinks
 *  www.move38.com
 *  --------------------
 */

const ATTACK_VALUE = 5   
const ATTACK_DURRATION_MS = 500   
const HEALTH_STEP_TIME_MS = 1000   

const INJURED_DURRATION_MS = 750   
const INJURY_DECAY_VALUE = 10   
const INJURY_DECAY_INTERVAL_MS = 30   

const INITIAL_HEALTH = 60
const MAX_HEALTH = 90

const MAX_TEAMS = 2

const COINTOSS_FLIP_DURATION = 100   
const GAME_START_DURATION = 300   

let team = 0;

let health;

let healthTimer = new Timer(self);
let injuryDecayTimer = new Timer(self);

const START_DELAY = 100
let startTimer = new Timer(self);

let injuryBrightness = 0;
let injuredFace;

let deathBrightness = 0;

let attackSuccess = []

let bChangeTeam = false;

const DEAD = 0;
const ALIVE = 1;
const ENGUARDE = 2;
const ATTACKING = 3;
const INJURED = 4;


let mode = DEAD;

const PLAY = 0;
const WAITING = 1;
const START = 2;


let gameState = WAITING;

let neighbors = []

let modeTimeout = new Timer(self);



function setup() {
  
}


function loop() {
  
  if (hasWoken()) {
    bChangeTeam = false;
  }

  if (buttonDoubleClicked()) {
    if (gameState == WAITING) {
      changeGameState( START );
    } else {
      
      mode = DEAD;
      changeGameState( WAITING );
    }
  }


  if (buttonLongPressed()) {
    if (gameState == WAITING) {
      
      bChangeTeam = true;
    }
  }

  if (buttonReleased()) {
    if (bChangeTeam) {
      
      team = getNextTeam();
      bChangeTeam = false;
    }
  }

  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) {
      neighbors[f] = getLastValueReceivedOnFace(f);
    }
  }

  if (healthTimer.isExpired()) {

    if (health > 0) {

      let numDeadNeighbors = 0;

      
      for(let f = 0; f < FACE_COUNT; f++) {
        if (!isValueReceivedOnFaceExpired(f)) {
          if (getGameMode(neighbors[f]) == DEAD) {
            numDeadNeighbors++;
          }
        }
      }

      
      if((health - 1) - numDeadNeighbors < 0) {
        health = 0;
      }
      else {
        health = (health - 1) - numDeadNeighbors;        
      }

      
      if (mode == ENGUARDE && health > 0) {
        health--;
      }

      
      healthTimer.set(HEALTH_STEP_TIME_MS);

    } else {

      mode = DEAD;

    }

  }

  if ( mode != DEAD ) {

    if (isAlone()) {

      mode = ENGUARDE;      

    } else {  

      if (mode == ENGUARDE) {   

        mode = ATTACKING;
        modeTimeout.set( ATTACK_DURRATION_MS );
      }

    }


    if (mode == ATTACKING || mode == INJURED ) {

      if (modeTimeout.isExpired()) {
        mode = ALIVE;
        for(let f = 0; f < FACE_COUNT; f++) {
          if (attackSuccess[f]) {
            health = min( health + ATTACK_VALUE , MAX_HEALTH );
          }
        }
      }
    }
  } 

  
  for(let f = 0; f < FACE_COUNT; f++) {


    if (!isValueReceivedOnFaceExpired(f)) {

      let neighborMode = getGameMode(neighbors[f]);

      if ( mode == ATTACKING ) {

        

        if ( neighborMode == INJURED ) {

          

          attackSuccess[f] = true;
        }

      } else if ( mode == ALIVE ) {

        if ( neighborMode == ATTACKING ) {

          health = max( health - ATTACK_VALUE , 0 ) ;

          mode = INJURED;

          injuredFace = f;  

          injuryBrightness = 255; 

          modeTimeout.set( INJURED_DURRATION_MS );

        }

      } else if (mode == INJURED) {

        if (modeTimeout.isExpired()) {

          mode = ALIVE;

        }
      }
    }
  }

  

  switch (mode) {

    case DEAD:
      displayGhost();
      break;

    case ALIVE:
      resetAttackSuccess();
      displayAlive();
      break;

    case ENGUARDE:
      displayEnguarde();
      break;

    case ATTACKING:
      displayAttack();
      break;

    case INJURED:
      displayInjured( injuredFace );
      break;
  }


  
  switch (gameState) {
    case PLAY:     playUpdate();      break;
    case WAITING:  waitingUpdate();   break;
    case START:    startUpdate();     break;
  }

  if (bChangeTeam) {
    
    for(let f = 0; f < FACE_COUNT; f++) {
      if (f < 3) {
        setColorOnFace(teamColor(team), f);
      }
      else {
        setColorOnFace(teamColor(getNextTeam()), f);
      }
    }
  }

  let data = (gameState << 3) + mode;
  setValueSentOnAllFaces( data );       

}


/*
   -------------------------------------------------------------------------------------
                                 START GAME LOGIC
   -------------------------------------------------------------------------------------
*/
function changeGameState(state) {

  switch (state) {
    case PLAY:          break;
    case WAITING:       break;
    case START:   startTimer.set(START_DELAY);  break;
  }
  gameState = state;
}

function startGame() {
  if (startTimer.isExpired()) {
    mode = ALIVE;
    changeGameState( PLAY );
    health = INITIAL_HEALTH;
    healthTimer.set(HEALTH_STEP_TIME_MS);
  }
}

function getNextTeam() {
  return (team + 1) % MAX_TEAMS;
}

function playUpdate() {
  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) {
      if (getGameState(neighbors[f]) == WAITING) {
        changeGameState( WAITING );
        mode = DEAD;
      }
    }
  }
}

function waitingUpdate() {
  
  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) {
      if (getGameState(neighbors[f]) == START) {
        changeGameState( START );
      }
    }
  }
}

function startUpdate() {
  
  let allReady = true;

  for(let f = 0; f < FACE_COUNT; f++) {
    if (!isValueReceivedOnFaceExpired(f)) {
      if (getGameState(neighbors[f]) != START && getGameState(neighbors[f]) != PLAY) {
        allReady = false;
      }
    }
  }

  if (allReady) {
    startGame();
  }
}

function resetAttackSuccess() {
  for(let f = 0; f < FACE_COUNT; f++) {
    attackSuccess[f] = false;
  }
}

/*
   -------------------------------------------------------------------------------------
                                 END GAME LOGIC
   -------------------------------------------------------------------------------------
*/


/*
   -------------------------------------------------------------------------------------
                                 START DISPLAY
   -------------------------------------------------------------------------------------
*/


/*
   Display state for living Mortals
*/
function displayAlive() {
  setColor(OFF);
  for(let f = 0; f < FACE_COUNT; f++) {

    if ( f <=  (health / 10) ) {
      
      setColorOnFace(teamColor( team ), f);
      
    }
    else {
      
      setColorOnFace(OFF, f);
    }
  }

  if (health <= 0 ) {

    
    setColor( dim(WHITE, deathBrightness) );

    if (deathBrightness > 7) {
      deathBrightness -= 8;
    }
  }

  
  if (deathBrightness == 255) {
    
    for(let f = 0; f < FACE_COUNT; f++) {

      if (!isValueReceivedOnFaceExpired(f)) {

        if (getGameMode(neighbors[f]) == DEAD) {

          
          
          let bri = 143 + (111 * sin_d(millis()));

          if ( f <= (health / 10) ) {
            
            if ( (millis() / 600) % 2 == 0 ) {
              setColorOnFace( dim(RED, bri), f);
            }
            else {
              setColorOnFace( dim( teamColor( team ), bri), f);
            }
          }
          else {
            
            setColorOnFace( dim(RED, bri), f);
          }
        }
      }
    }
  }
}

/*
   Display state for injured Mortal
   takes the face we were injured on

*/
function displayInjured(face) {

  
  displayAlive();

  
  if ( injuryDecayTimer.isExpired() ) {
    injuryDecayTimer.set( INJURY_DECAY_INTERVAL_MS );
    injuryBrightness -= INJURY_DECAY_VALUE;
  }

  
  if ( injuryBrightness > 32 ) {
    setColorOnFace( dim( RED, injuryBrightness), face );
  }

}

/*

*/
function displayGhost() {

  setColor(OFF);

  
  if ( gameState == PLAY ) {
    for(let f = 0; f < FACE_COUNT; f++) {

      setColorOnFace( dim( RED, 64 + 32 * sin_d( (60 * f + millis() / 8) % 360)), f);  

    }
  }
  else if (gameState == WAITING ) {

    setColor( dim(teamColor( team ), 92) );
    setColorOnFace( dim( teamColor( team ), 159 + 96 * sin_d( ( millis() / 4) % 360) ) , 1);

  }
  else if (gameState == START ) {
    setColor(WHITE);  
    deathBrightness = 255;  
  }
}

/*

*/
function displayEnguarde() {

  setColor( OFF );

  setColorOnFace( teamColor( team ) , (millis() / 100) % FACE_COUNT);

}

/*

*/
function displayAttack() {

  setColor( OFF );

  setColorOnFace(  teamColor( team ), random(FACE_COUNT) );

}
/*
   -------------------------------------------------------------------------------------
                                 END DISPLAY
   -------------------------------------------------------------------------------------
*/


/*
   -------------------------------------------------------------------------------------
                                 HELPER FUNCTIONS
   -------------------------------------------------------------------------------------
*/

/*
   Sin in degrees ( standard sin() takes radians )
*/

function sin_d( degrees ) {

  return sin( ( degrees / 360.0 ) * 2.0 * PI   );
}

/*
  get the team color for our team
*/
function teamColor( t ) {
  switch (t) {
    case 0: return makeColorRGB(190, 0, 255);
    case 1: return makeColorRGB(100, 255, 0);
  }
}

function getGameMode(data) {
  return data & 7;  
}

function getGameState(data) {
  return data >> 3; 
}