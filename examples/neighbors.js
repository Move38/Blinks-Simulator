/*
void loop() {
    FOREACH_FACE(f) {//check every face
        if (isValueReceivedOnFaceExpired(f)) {//no one there
            setColorOnFace(BLUE, f);
        } else {//someone there
            setColorOnFace(WHITE, f);
        }
    }
}
*/
self.importScripts('js/blink.js')

function loop(){
    for (let f = 0; f < FACE_COUNT; f++) {//check every face
        if (isValueReceivedOnFaceExpired(f)) {//no one there
            setColorOnFace(BLUE, f);
        } else {//someone there
            setColorOnFace(WHITE, f);
        }
    }
}