/* SETUP */
const blk = new blinks.init();
const BLOCKS_NUM = 6;
// blk.debugMode = true;
// blk.resizeCanvas(800, 640);

// STATS
const stats = new Stats();
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: customß
document.body.appendChild(stats.dom);

// Dat GUI
const SETTINGS = {
    global: {
        debug: false,
        clear: () => blk.clearCanvas(),
        reset: () => {
            blk.clearCanvas();
            blk.createBlocks(BLOCKS_NUM);
        },
    },
};
const gui = new dat.GUI();
gui.add(SETTINGS.global, "debug").onFinishChange((d) => (blk.debugMode = d));
gui.add(SETTINGS.global, "clear");
gui.add(SETTINGS.global, "reset");
gui.close();

let frameCount = 0;
blk.createBlocks(BLOCKS_NUM);
//generate random colors for blocks
for (let i = 0; i < BLOCKS_NUM; i++) {
    blk.setColor(i, blk.YELLOW)
    blk.setColorOnFace(i, Math.floor(Math.random() * 6), blk.CYAN)
    blk.setValue(i, 'shift', Math.random() > 0.5)
}


/* UPDATE */

blk.beforeFrameUpdated = function () {
    stats.begin();

    for (let i = 0; i < blk.blockNum; i++) {
        blk.setColor(i, blk.RED)
        blk.setColorOnFace(i, parseInt((blk.millis() / 1000)) % 6, blk.BLUE)
    }
}

blk.afterFrameUpdated = function () {
    frameCount++;
    stats.end();
}

/* EVENTS */

blk.doubleClicked = function () {
    console.log('double clicked on canvas');
    blk.createBlockAt(blk.mouseX, blk.mouseY);
}

blk.buttonPressed = function (id) {
    console.log("#", id, "button is pressed");
}

blk.buttonReleased = function (id) {
    console.log("#", id, "button is released");
}

blk.buttonSingleClicked = function (id) {
    console.log("#", id, "button is single clicked");
}

blk.buttonDoubleClicked = function (id) {
    console.log("#", id, "button is double clicked");
}

blk.buttonMultiClicked = function (id, count) {
    console.log("#", id, "button is multi clicked, count: ", count);
}

blk.buttonLongPressed = function (id) {
    console.log("#", id, "button is long pressed");
}

blk.buttonDown = function (id) {
    console.log("#", id, "button is down");
}
