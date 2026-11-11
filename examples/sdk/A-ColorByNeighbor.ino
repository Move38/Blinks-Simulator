/*
 * Color By Number/Neighbor
 * 
 * An example showing how to count the number of neighbors.
 * 
 * Each Blink displays a color based on the number of neighbors around it.
 *  
 */

// color by number of neighbors
Color colors[] = {  
  dim(WHITE,40),   // 0 neighbors
  RED,            // 1 neighbors
  YELLOW,         // 2 neighbors
  GREEN,          // 3 neighbors
  CYAN,           // 4 neighbors
  BLUE,           // 5 neighbors
  MAGENTA,        // 6 neighbors
}; 

void setup() {
  // Blank
}


void loop() {

  // count neighbors we have right now
  int numNeighbors = 0;
 
  FOREACH_FACE(f) {

    if ( !isValueReceivedOnFaceExpired( f ) ) {      // Have we seen an neighbor on this face recently?
    numNeighbors++;
  }
  
  }

  // look up the color to show based on number of neighbors
  // No need to bounds check here since we know we can never see more than 6 neighbors 
  // because we only have 6 sides.
  
  setColor( colors[ numNeighbors ] );
  
}
