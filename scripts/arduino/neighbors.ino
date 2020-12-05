void loop() {
    FOREACH_FACE(f) { //check every face
        if (isValueReceivedOnFaceExpired(f)) { //no one there
            setColorOnFace(BLUE, f);
        } else { //someone there
            setColorOnFace(WHITE, f);
        }
    }
}