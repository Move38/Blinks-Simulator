/*
void loop() {
  // this code gets called ~30 times per second
  setColor(RED);
  setColorOnFace(BLUE, (millis()/1000)%6);
}
*/

self.importScripts('worker.js')

function loop(){
    setColor(RED);
    setColorOnFace(BLUE, parseInt((millis() / 1000)) % 6);
}