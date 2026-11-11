/*
 * IR Link Tester
 * 
 * Great for testing if blinks work and can communicate over IR
 * 
 * Sends a series of messages with sequence numbers so it can detect a missed message. 
 * The messages also have a checksum so it can detect corrupted messages. 
 * 
 * Each face shows:
 *   BLUE   - No neighbor on this face
 *   GREEN  - Blinks to show good data being received 
 *   ORANGE - Shows that a message was missed
 *   RED    - Shows that an invalid message was received.
 *   
 *   Press the button to clear ORANGE and RED.
 * 
 */


// Use unsigned long becuase they tak a long time to wrap and have lots of bits that can have errors

typedef unsigned SeqType;

struct MessageType {
  byte txFace;          // The face of the sending blink
  SeqType seq;
  SeqType inverted;     // Inverted bits check 
};

// Next seq to send. 
SeqType nextSeqOut[ FACE_COUNT ];

// Next expected
SeqType nextSeqIn[ FACE_COUNT ];

// Did we get an error on this face recently?
bool showErrorFlag[ FACE_COUNT ]; 

// Did we miss a message on this face recently?
bool showMissedFlag[ FACE_COUNT ]; 


// When should we do next blind send?
// Note that we also send faster by ping ponging when we get a message in
Timer nextSendTimer[ FACE_COUNT ];  

// Has it been so long ince we saw something that we should give up showing is as present?
Timer expireFaceTimer[ FACE_COUNT ];

//const int ErrorShowTime_ms  = 500;    // 
//const int MissedShowTime_ms = 250;    // 

const int ResendTime_ms     = 300;    // Show the errror for 0.5 second so people can see it 
const int ExpireTime_ms     = 1000;    


// Remember the pervious face seen so we don't generate a miss when a dffifernt face is swapped in
byte lastTxFace[FACE_COUNT];


void setup() {

  FOREACH_FACE(f) {
    nextSeqOut[f]=0x5566;
    nextSeqIn[f]=0x5566; 
  }
  
}

void loop() {

  if (buttonPressed()) {

    FOREACH_FACE(f) {
    
      showErrorFlag[f] = false;
      showMissedFlag[f] = false;

    }
  }
  


  FOREACH_FACE(f) {

    // If we have been asleep, then start everything fresh
    if (hasWoken()) {

      nextSendTimer[f].set(0);
      expireFaceTimer[f].set(0);
      
    }

    boolean sendNowFlag = false;

    // *** Incomming

    if ( isDatagramReadyOnFace( f ) ) {
      
      if ( getDatagramLengthOnFace(f) ==sizeof( MessageType ) ) {

        // We got a valid length message

        const MessageType *rxMessagePtr = (MessageType *) getDatagramOnFace(f);

        if ( rxMessagePtr->seq != ~rxMessagePtr->inverted ) {

          // Currupted data. Bad. 

          //showErrorTimer[f].set( ErrorShowTime_ms );
          showErrorFlag[f] = true;
          
        } else {

          // If we get here, then packet is the right length and the checksum is correct (valid packet) 
  
          // If the face is expired, or this is a new face from the last message, then no need to show an error on the first message, just sync to it. 

          // We check if the seq matches either the expected seq or +1 or +2. This way, we need to miss three or more consecutive packets to show an error. 
  
          if ( !expireFaceTimer[f].isExpired() && lastTxFace[f] == rxMessagePtr->txFace &&  rxMessagePtr->seq !=nextSeqIn[f] && rxMessagePtr->seq != (nextSeqIn[f]+1) && rxMessagePtr->seq != (nextSeqIn[f]+2) ) {
   
            showMissedFlag[f] = true;
  
          }

          // NOTE: Here we depend on overflow to wrap
          nextSeqIn[f] = (rxMessagePtr->seq) + 1;    // Sync to incomming message 

          lastTxFace[f] = rxMessagePtr->txFace;

        }

        // We got something, so we know someone is there
        expireFaceTimer[f].set( ExpireTime_ms );
    
        // Also send our response immedeately (ping pong)        
        sendNowFlag = true; 

          
      } else {

        // Invalid packet length
        // TODO: Should this be a different kind of error?

        //showErrorTimer[f].set( ErrorShowTime_ms );
        showErrorFlag[f] = true;
        

      }

      markDatagramReadOnFace(f);
      
    }

    // *** Outgoing 

    if (sendNowFlag || nextSendTimer[f].isExpired()) {

      MessageType txMessage;

      // NOTE: Here we depend on overflow to wrap 

      txMessage.txFace    = f;
      txMessage.seq       = nextSeqOut[f];
      txMessage.inverted  = ~nextSeqOut[f];
      
      sendDatagramOnFace( &txMessage , sizeof( txMessage ) , f );

      nextSeqOut[f]++;
      
      nextSendTimer[f].set( ResendTime_ms ); 
      
    }

    // *** Display


    if ( showErrorFlag[f]) {

      setColorOnFace( RED , f );

    } else if ( showMissedFlag[f]) { 
      
      setColorOnFace( dim( ORANGE , 128 ) , f );    
    
    } else if (expireFaceTimer[f].isExpired() ) {

      // No partner on this face, so show blue

      setColorOnFace( dim( BLUE , 128 ) , f );

    } else {

      // Otherwise, everything is hunky-dory

      // Make the green pulse to show the speed of transmitions and also just give a feel that data is really flowing

      //uint8_t brightness = sin8_C( ( nextSeqIn[f] * 16 ) & 0xff );

      uint8_t brightness = (( nextSeqIn[f] & 0x01 ) * 128 ) + 127;
      
      setColorOnFace( dim( GREEN , brightness ) , f );

    }
 

  }
        
}
