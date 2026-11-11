// SimpleDatagramDemo
// Simplest example of how to send and recieve datagrams over the IR link.
// Face shows:
//    GREEN when it sees a neighboor and is getting a valid value from it (the number `42` is sent in this demo)
//    CYAN  when it sees a neighboor and is getting an invalid value from it (anything other than the number `42` in this demo)
//    BLUE blink for 250ms when it sees a valid datagram (the three bytes {'C','A','T'} in the demo)
//    RED  blink for 250ms when it sees an invalid datagram (anything but the three bytes {'C','A','T'} in the demo)
//
// Pressing the button sends the sample datagram on all faces

// A datagram is a multibyte message that is sent on a best-efforts basis
// Each datagram sent will be recieved at most one time (it might never be recieved)
// Datagrams can be up to `IR_DATAGRAM_LEN` bytes long

// Send somethign on all faces so we can check that we got it

#define MAGIC_VALUE 42

// Leave the current color on this face until this timer expires
static Timer showColorOnFaceTimer[ FACE_COUNT ];

#define SHOW_COLOR_TIME_MS  250   // Long enough to see

byte sampleDatagram[] { 'C' , 'A' , 'T' };     // A sample 3 byte long datagram


void setup() {
 setValueSentOnAllFaces(MAGIC_VALUE); 
}


/*
 * Compare memory regions. Returns 0 if all bytes in the blocks match. 
 * Lifted from https://github.com/f32c/arduino/blob/master/hardware/fpga/f32c/system/src/memcmp.c
 */
 
 int memcmp(const void *s1, const void *s2, unsigned n)
{
  if (n != 0) {
    const unsigned char *p1 = s1, *p2 = s2;

    do {
      if (*p1++ != *p2++)
        return (*--p1 - *--p2);
    } while (--n != 0);
  }
  return (0);
}


void loop() {

    // First check all faces for an incoming datagram

    FOREACH_FACE(f) {

        if ( isDatagramReadyOnFace( f ) ) {

          const byte *datagramPayload = getDatagramOnFace(f);

          // Check that the length and all of the data btyes of the recieved datagram match what we were expecting
          // Note that `memcmp()` returns 0 if it is a match

          if ( getDatagramLengthOnFace(f)==sizeof( sampleDatagram )  &&  !memcmp( datagramPayload , sampleDatagram , sizeof( sampleDatagram )) ) {

            // This is the datagram we are looking for!
          
            setColorOnFace( BLUE , f );

          } else {

            // Oops, we goty a datagram, but not the one we are loooking for             

            setColorOnFace( RED , f );

          }
          

          showColorOnFaceTimer[f].set( SHOW_COLOR_TIME_MS );

          // We are done with the datagram, so free up the buffer so we can get another on this face
          markDatagramReadOnFace( f );
          
          
        } else if ( showColorOnFaceTimer[f].isExpired() ) {
        
            if ( !isValueReceivedOnFaceExpired( f ) ) {

              // Show green if we do have a neighbor

              if (getLastValueReceivedOnFace(f) == MAGIC_VALUE ) {
             
                setColorOnFace( GREEN , f );

              } else {
                
                setColorOnFace( CYAN, f );

              
              }

            } else {

              // Or off if no neighbor

              setColorOnFace( OFF , f );
              
            }
          
        }

    }


    if (buttonPressed()) {

        // When the button is click, trigger a datagram send on all faces

        FOREACH_FACE(f) {

          sendDatagramOnFace( &sampleDatagram , sizeof( sampleDatagram ) , f );
          
        }

    }

}           // loop()
