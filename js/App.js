/* SETUP */
const blk = new BLINKS();
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
            //generate random colors for blocks
            for (let i = 0; i < BLOCKS_NUM; i++) {
                blk.setColors(i, Array.from({ length: 6 }, () => Array.from({ length: 3 }, () => Math.random() > 0.2 ? 0.0 : 1.0)))
            }
        },
    },
};
const gui = new dat.GUI();
gui.add(SETTINGS.global, "debug").onFinishChange((d) => (blk.debugMode = d));
gui.add(SETTINGS.global, "clear");
gui.add(SETTINGS.global, "reset");

let frameCount = 0;
blk.createBlocks(BLOCKS_NUM);
//generate random colors for blocks
for (let i = 0; i < BLOCKS_NUM; i++) {
    blk.setColor(i, blk.YELLOW)
    blk.setColorOnFace(i, Math.floor(Math.random() * 6), blk.CYAN)
}


/* UPDATE */

blk.beforeFrameUpdated = function () {
    stats.begin();

    if (frameCount % 30 === 0) {
        for (let i = 0; i < blk.blockNum; i++) {
            let colors = blk.getColors(i);
            if (colors) {
                if (i % 2 === 0) {
                    colors.unshift(colors.pop())
                }
                else {
                    colors.push(colors.shift())
                }
                blk.setColors(i, colors)
            }
        }
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
    blk.setColors(blk.blockNum - 1, Array.from({ length: 6 }, () => Array.from({ length: 3 }, () => Math.random() > 0.2 ? 0.0 : 1.0)))
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
