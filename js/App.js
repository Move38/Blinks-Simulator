/* SETUP */
const blk = new BLINKS();
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
            blk.createBlocks(6);
        },
    },
};
const gui = new dat.GUI();
gui.add(SETTINGS.global, "debug").onFinishChange((d) => (blk.debugMode = d));
gui.add(SETTINGS.global, "clear");
gui.add(SETTINGS.global, "reset");

let frameCount = 0;
blk.createBlocks(6);

/* UPDATE */

blk.beforeFrameUpdated = function () {
    stats.begin();

    if (frameCount % 30 === 0) {
        // if (i % 2 === 0) {
        //     block.colors.unshift(block.colors.pop())
        // }
        // else {
        //     block.colors.push(block.colors.shift())
        // }
    }
}

blk.afterFrameUpdated = function () {
    frameCount++;
    stats.end();
}

/* EVENTS */

function blockIsClicked(id) {
    console.log("Block #", id, " is clicked");
}

function blockIsDoubleClicked(id) {
    console.log("Block #", id, " is double clicked");
}

function blockIsLongPressed(id) {
    console.log("Block #", id, " is long pressed");
}