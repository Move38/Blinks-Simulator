/*
 *  Berry
 *  by VV Studio
 *  at IndieCade East 2018 Game Jam
 *  Lead development by Jonathan Bobrow, Move38 Inc.
 *  original game by ViVi and Vanilla
 *
 *  Rules: https://github.com/Move38/Berry/blob/master/README.md
 *
 *  --------------------
 *  Blinks by Move38
 *  Brought to life via Kickstarter 2018
 *
 *  @madewithblinks
 *  www.move38.com
 *  --------------------
 */

Color colors[] = { BLUE, RED, YELLOW };
byte currentColorIndex = 0;
byte faceIndex = 0;
byte faceStartIndex = 0;

bool isWaiting = false;

#define FACE_DURATION 60
#define WAIT_DURATION 2000

Timer faceTimer;
Timer waitTimer;

void setup() {
  // put your setup code here, to run once:

}

void loop() {
  // put your main code here, to run repeatedly:

  if ( buttonSingleClicked() ) {

    currentColorIndex++;

    if (currentColorIndex >= COUNT_OF(colors)) {
      currentColorIndex = 0;
    }

  }

  if ( waitTimer.isExpired() ) {
    if ( faceTimer.isExpired() ) {
      faceTimer.set( FACE_DURATION );
      faceIndex++;

      if (faceIndex >= 7) {
        faceIndex = 0;
        waitTimer.set( WAIT_DURATION );
        isWaiting = true;

        // shift the starting point
        faceStartIndex++;
        if (faceStartIndex >= 6) {
          faceStartIndex = 0;
        }
      }
      else {
        isWaiting  = false;
      }
    }
  }

  // display color
  setColor( colors[currentColorIndex] );

  // show locked sides
  if (isPositionLocked()) {
    // show the state of locked animation on all faces
    byte bri = 153 + (sin8_C((millis() / 6) % 255)*2)/5;
    setColor(dim(colors[currentColorIndex], bri));
  }

  // show next color
  if (!isWaiting) {
    byte nextColorIndex = (currentColorIndex + 1) % 3;
    byte face = (faceStartIndex + faceIndex - 1) % FACE_COUNT;
    setFaceColor( face, colors[nextColorIndex] );
  }
}

bool isPositionLocked() {
  // based on the arrangement of neighbors, am I locked...
  bool neighborPattern[6];
  bool lockedA[6] = {1, 0, 1, 0, 1, 0};
  bool lockedB[6] = {1, 0, 1, 0, 0, 0};

  FOREACH_FACE(f) {
    neighborPattern[f] = !isValueReceivedOnFaceExpired(f);
  }

  // neighbors across from each other
  for (byte i = 0; i < 3; i++) {
    if (neighborPattern[i] && neighborPattern[i + 3]) {
      return true;
    }
  }

  // special case lock patterns
  if ( isThisPatternPresent(lockedA, neighborPattern)) {
    return true;
  }
  if ( isThisPatternPresent(lockedB, neighborPattern)) {
    return true;
  }

  return false;
}

// check to see if pattern is in the array
// return true if the pattern is in fact in the array
// pattern is always 6 bools
// source is always 12 bools (2 x 6 bools)
bool isThisPatternPresent( bool pat[], bool source[]) {

  // first double the source to be cyclical
  bool source_double[12];

  for (byte i = 0; i < 12; i++) {
    source_double[i] = source[i % 6];
  }

  // then find the pattern
  byte pat_index = 0;

  for (byte i = 0; i < 12; i++) {
    if (source_double[i] == pat[pat_index]) {
      // increment index
      pat_index++;

      if ( pat_index == 6 ) {
        // found the entire pattern
        return true;
      }
    }
    else {
      // set index back to 0
      pat_index = 0;
    }
  }

  return false;
}  
