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
    blk.setValue(i, 'shift', Math.random() > 0.5)
}


/* UPDATE */

blk.beforeFrameUpdated = function () {
    stats.begin();

    for (let i = 0; i < blk.blockNum; i++) {
        let blockStatus = blk.getObject(i);
        if ('dim' in blockStatus) {
            if (blockStatus.dim >= 1) {
                blockStatus.speed = -0.01;
            }
            if (blockStatus.dim <= 0) {
                blockStatus.speed = 0.01;
            }
            blockStatus.dim += blockStatus.speed;
            let newColors = []
            for (let m = 0; m < blockStatus.colors.length; m++) {
                let c = blockStatus.colors[m];
                newColors.push([
                    c[0] * blockStatus.dim,
                    c[1] * blockStatus.dim,
                    c[2] * blockStatus.dim,
                ])
            }
            blk.setColors(i, newColors)
            blk.setObject(i, blockStatus)
        }
        else if (frameCount % 30 === 0) {
            // console.log(blk.getValue(i, 'shift'))
            if (blk.getValue(i, 'shift')) {
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
    blk.setValue(id, 'shift', !blk.getValue(id, 'shift'))
}

blk.buttonDoubleClicked = function (id) {
    console.log("#", id, "button is double clicked");
    if (blk.getValue(id, 'dim')) {
        blk.setColors(id, blk.getValue(id, 'colors'));
        blk.setObject(id, {});
    }
    else {
        blk.setObject(id, {
            colors: blk.getColors(id),
            dim: 1
        })
    }
}

blk.buttonMultiClicked = function (id, count) {
    console.log("#", id, "button is multi clicked, count: ", count);
}

blk.buttonLongPressed = function (id) {
    console.log("#", id, "button is long pressed");
    blk.setColor(id, blk.YELLOW)
    blk.setColorOnFace(id, Math.floor(Math.random() * 6), blk.CYAN)
}

blk.buttonDown = function (id) {
    console.log("#", id, "button is down");
}
