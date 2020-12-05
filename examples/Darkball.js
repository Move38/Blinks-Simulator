self.importScripts('js/blink.js')

/*
   Darkball
   by Che-Wei Wang,  CWT
   for Blinks by Move38

  setup:
   place blinks in a single path (two player mode), or branches (multiplayer mode), or a single path with a loop ( P shape, single player mode)
   endpoints will be green
   paths will be yellow
   cyan endpoints have the ball


  each player plays at one endpoint. finger on the end tile


  cyan endpoints can send the ball alet the path
  green endpoints try to hit the ball back
  if players swing too late, or swing too early, they lose a polet
  game ends when one player to loses 6 points

*/

const DURATION_FOR_GAME_PIECE_TO_RESET = 5000  
const SHOW_COLOR_TIME_MS = 110   
const EXHAUST_TRAIL_DURATION = 500   
const DEFAULT_HUE = 20    
const MAX_HUE_SHIFT = 80    



let errorOnFaceTimer = Array.from({ length: FACE_COUNT }, () => new Timer(self));

let showErrTime_ms = 500;    

let showColorOnFaceTimer = Array.from({ length: FACE_COUNT }, () => new Timer(self));
let gameOverTimer = new Timer(self);
let timeBallLastOnFace = []

let ball = [ 1, 0, 6, 3 ];

const MAGIC_VALUE = 22

let hasNeigbhorAtFace = []
let neighborCount = 0;
let lastMillis = 0;
let sendBall = -1;
let hp = FACE_COUNT ;
let lastNeighbor;
let lastReceivedBall = 0;
let ballResponseRange = 100;
let hasBall = true;
let missed = true;
let swung = false;
let lastSwing = 0;
let slowestBallSpeed = 110; 
let endAnimCount = 0;
let lastWasEndpoint = 0;
let superMode = false;

function setup() {

  setValueSentOnAllFaces(MAGIC_VALUE);
}


function loop() {

  
  if (sendBall >= 0) { 
    if (millis() - lastMillis > ball[0]) { 
      if (superMode) {

        showColorOnFaceTimer[sendBall].set( SHOW_COLOR_TIME_MS ); 
        timeBallLastOnFace[sendBall] = millis();

      }
      else {
        
        showColorOnFaceTimer[sendBall].set( SHOW_COLOR_TIME_MS ); 
        timeBallLastOnFace[sendBall] = millis();
      }
      
      sendDatagramOnFace( ball , sizeof( ball ) , sendBall ); 
      

      sendBall = -1; 
    }
  }


  if (hasBall && neighborCount == 1 && missed == false)  { 
    if ( millis() - lastReceivedBall > ballResponseRange) { 
      hp--;
      missed = true;
    }
  }


  
  for(let f = 0; f < FACE_COUNT; f++) {

    if ( isDatagramReadyOnFace( f ) ) { 

      let datagramPayload = getDatagramOnFace(f);


      
      
      ball[0] = datagramPayload[0]; 
      ball[1] = datagramPayload[1]; 
      ball[2] = datagramPayload[2]; 
      superMode = ball[1];
      ball[2]++;

      showColorOnFaceTimer[f].set( SHOW_COLOR_TIME_MS ); 
      timeBallLastOnFace[f] = millis();
      lastMillis = millis();

      
      let avalableNeighboringFaces = []
      let count = 0;

      
      for(let nf = 0; nf < FACE_COUNT; nf++) { 
        if (f != nf) { 
          if (hasNeigbhorAtFace[nf]) { 
            avalableNeighboringFaces[count] = nf;
            count++;
          }
        }
      }

      if (count > 0) sendBall = avalableNeighboringFaces[int(random(count - 1))]; 

      if (neighborCount == 1) { 
        hasBall = true;
        lastReceivedBall = millis();
        
        if (swung ) {
          if ( millis() - lastSwing < ballResponseRange ) { 
            shoot((millis() - lastSwing) / float(ballResponseRange));
          }
        }
        swung = false;
      }
      else hasBall = false;
      

      
      markDatagramReadOnFace( f );
    }

    
    if ( !isValueReceivedOnFaceExpired( f ) ) {
      if (getLastValueReceivedOnFace(f) == MAGIC_VALUE ) { 
        hasNeigbhorAtFace[f] = true;
      }
    }
    else {
      hasNeigbhorAtFace[f] = false;
    }
  }


  
  neighborCount = 0;
  for (let i = 0; i < FACE_COUNT; i++) {
    if (hasNeigbhorAtFace[i]) {
      neighborCount++;
      lastNeighbor = i;
    }
  }

  
  if (swung && millis() - lastSwing >= 500) {
    swung = false;
  }


  
  
  if (neighborCount == 1) {
    drawPaddle();

  } else if (neighborCount == 0 && endAnimCount == 0) { 
    spinAnimation(110);
  }
  else { 

    for(let f = 0; f < FACE_COUNT; f++) {
      if (hasNeigbhorAtFace[f]) {

        if (superMode) {
          setColorOnFace(makeColorHSB( DEFAULT_HUE, 255 , 255 ) , f ); 
        }
        else {
          
          
          
          let timeSinceBall = millis() - timeBallLastOnFace[f];
          let exhaust_trail_duration = 2 * (100 - ball[0]) * EXHAUST_TRAIL_DURATION / 100;

          if (timeSinceBall > exhaust_trail_duration) {
            timeSinceBall = exhaust_trail_duration;
          }
          let hueShift = MAX_HUE_SHIFT - map(timeSinceBall, 0, exhaust_trail_duration, 0, MAX_HUE_SHIFT);
          let hue = DEFAULT_HUE - hueShift;  
          let bri = 255; 
          let sat;
          if (ball[0] < 10 && timeSinceBall < 300) 
            sat = 255 - 80 * random(3); 
          else
            sat = 255;

          setColorOnFace( makeColorHSB( hue, sat , bri ) , f );
        }

      }
      else {  
        setColorOnFace(OFF, f);
      }

      
      if (!showColorOnFaceTimer[f].isExpired()) {
        if (superMode) {
          
          if (ball[2] % 3 == 0)
          {
            setColorOnFace(OFF, f);
          }

        }
        else {
          setColorOnFace(OFF, f);
        }


      }

    }
  }

  if (hp == 0) {
    
    if (gameOverTimer.isExpired()) {
      randomAnimation(RED, 30);
      gameOverTimer.set( 30 );
      endAnimCount++;
    }

    if (endAnimCount > 36) {
      reset();
    }

  }


  
  if (buttonDoubleClicked()) {
    if (neighborCount == 0 ) hp = 0; 
  }
  if ( millis() - lastWasEndpoint > DURATION_FOR_GAME_PIECE_TO_RESET ) {
    if (neighborCount == 0 || neighborCount > 1) reset(); 
  }


  
  if (buttonPressed()) {
    
    if (neighborCount == 1 ) { 

      if (swung == false) { 
        swung = true;
        lastSwing = millis();

        if (hasBall && millis() - lastReceivedBall < ballResponseRange  ) { 
          shoot((millis() - lastReceivedBall) / float(ballResponseRange)); 
        }

      }

      
      if (missed) {
        if ( hasBall && millis() - lastReceivedBall > 500) { 
          shoot(.5); 
        }
      }
    }
  }

  
  if (buttonMultiClicked()) {
    if (neighborCount == 0 ) {
      superMode = !superMode;
      hp = 0;
    }

  }
}

function reset() {
  
  hasBall = true;
  hp = FACE_COUNT ;
  missed = true;
  endAnimCount = 0;

}

let animStepTimer = new Timer(self);
let animCount = 0;

function spinAnimation(delayTime) {
  
  drawPaddle();












}

function randomAnimation(c, delayTime) {
  if (animStepTimer.isExpired()) {
    setColor(c);
    animCount++;
    setColorOnFace( OFF, random( FACE_COUNT ));
    animStepTimer.set( delayTime );
  }
}

function swingAnimation(c, delayTime) {
  if (animStepTimer.isExpired()) {
    setColor(c);
    animCount++;
    setColorOnFace( OFF, animCount % FACE_COUNT );
    animStepTimer.set( delayTime );
  }
}

function drawPaddle() {
  let count = lastNeighbor + 1; 
  
  if(!isAlone()) lastWasEndpoint = millis();

  for(let f = 0; f < FACE_COUNT; f++) {
    

    if (hp > 0) {
      if (count < hp + lastNeighbor + 1) {
        let healthColor;
        if(superMode) {
          if(hasBall) healthColor = makeColorHSB(random(255),100,255);
          else healthColor = WHITE;
        }
        else healthColor = GREEN;        
        
        if (swung && hasBall == false) setColorOnFace( dim( healthColor, 60), count % FACE_COUNT );
        
        else setColorOnFace( healthColor, count % FACE_COUNT );
      }
      else {
        
        if (swung && hasBall == false)  setColorOnFace( dim( RED, 60), count % FACE_COUNT );
        
        else setColorOnFace( RED, count % FACE_COUNT );
      }

      if (hasBall && !isAlone()) {
        setColorOnFace(OFF, (millis() / 100) % 6); 
      }

      count++;
    }
  }
}



function shoot(ballSpeed) {
  let s = ballSpeed * slowestBallSpeed;
  for(let f = 0; f < FACE_COUNT; f++) {
    ball[0] = byte(s); 
    ball[1] = superMode;
    ball[2] = 1 + random(2); 
    sendDatagramOnFace( ball , sizeof( ball ) , f );
  }
  missed = false;
  hasBall = false;
  swung = false;
}