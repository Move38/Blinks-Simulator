/*
 * 
 * Exercise the button functions to see how they work and 
 * and also show off some fancy C++ footwork!
 * 
 * Each of the button events lights one of the pixels 
 * so you can see that it happened. Check `indicators` for the
 * list of events and what pixel/color they will show up as.
 * 
 */

// How long should an inidcator stay lit after trigger?  
static const word fade_time_ms = 200;   

void setup() {

  // No setup needed for this simple example!  

}


class fadingIndicator_t {  


  private: 

    bool (*testFunction)();

    byte face;
  
    Color color;


    unsigned long trigger_time_ms;   

    byte get_current_brightness() {

      if ( millis() > trigger_time_ms + fade_time_ms ) {
        return 0; 
      }

      word age_ms = millis() - trigger_time_ms;

      //word brightness = fade_time_ms - age_ms;

      word inverted_brightness = map( age_ms , 0 , fade_time_ms , 0 , 255 );

      return 255-inverted_brightness;
   
    }
    
  public: 

    inline void trigger(void) {
  
      trigger_time_ms = millis(); 
  
    }

    inline void show() {
      setFaceColor( face , dim( color ,  get_current_brightness() ) ); 
    }
  
      
    inline void update(void ) {
  
      if ( (*testFunction)() ) {
  
        trigger();
        
      } 
         
    }

    fadingIndicator_t( byte face, Color color , bool (*testFunction)() ) :  face(face), color(color) , testFunction( testFunction ) {}
      
};

fadingIndicator_t indicators[] {

  { 0 , RED    , buttonPressed },
  { 1 , GREEN  , buttonReleased },
  { 2 , BLUE   , buttonSingleClicked },
  { 3 , MAGENTA, buttonDoubleClicked },
  { 4 , YELLOW , buttonMultiClicked },
  { 5 , CYAN   , buttonLongPressed },
    
};


void loop() {
  
  for(auto &item : indicators ) {

    item.update();
    item.show(); 
 
  }

}
