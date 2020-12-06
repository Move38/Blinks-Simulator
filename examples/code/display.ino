void loop() {
  // this code gets called ~30 times per second
  setColor(RED);
  setColorOnFace(BLUE, (millis()/1000)%6);
}