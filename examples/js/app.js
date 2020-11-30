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


/* SETUP */
const blk = new blinks.init();
const BLOCKS_NUM = 6;
let frameCount = 0;
blk.createBlocks(BLOCKS_NUM);
let workers = [];

// setup webworkers for each blink
for (let i = 0; i < BLOCKS_NUM; i++) {
    let index = i;
    let worker = new Worker('../time.js');
    worker.postMessage({
        name: 'index',
        value: index
    })

    // listen to message event of worker
    worker.addEventListener('message', function (event) {
        // console.log('message received => ', event.data);
        let eventName = event.data.name;
        let eventValues = event.data.values;
        blk[eventName].apply(this, eventValues);
    });
    // listen to error event of worker
    worker.addEventListener('error', function (event) {
        console.error('error received => ', event);
    });
    workers.push(worker);
}


/* UPDATE */

blk.beforeFrameUpdated = function () {
    stats.begin();

    workers.map(w => {
        w.postMessage({
            name: 'loop',
            value: blk.millis()
        })
    })
}

blk.afterFrameUpdated = function () {
    frameCount++;
    stats.end();
}

/* EVENTS */

blk.doubleClicked = function () {
    console.log('double clicked on canvas');
    // blk.createBlockAt(blk.mouseX, blk.mouseY);
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
