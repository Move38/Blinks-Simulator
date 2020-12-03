// STATS
const stats = new Stats();
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: customß
document.body.appendChild(stats.dom);

const examples = [
    'time', 
    'display',
    'buttonClick',
    'buttonPress',
    'neighbors',
    'communication',
    'sendSignal'
];

// Dat GUI
const SETTINGS = {
    global: {
        debug: false,
        clear: () => { clear(); },
        reset: () => {
            clear();
            init(SETTINGS.global.select);
        },
        select: examples[4]
    },
};
const gui = new dat.GUI();
gui.add(SETTINGS.global, 'select', examples).onFinishChange(s => {
    clear();
    init(s);
});
gui.add(SETTINGS.global, "debug").onFinishChange( d => blk.debugMode = d);
// gui.add(SETTINGS.global, "clear");
// gui.add(SETTINGS.global, "reset");
// gui.close();


/* SETUP */
const blk = new blinks.init(SETTINGS.global.select);
blk.debugMode = SETTINGS.global.debug;
const BLOCKS_NUM = 6;
let frameCount = 0;
let workers = [];


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

blk.groupUpdated = function (bks) {
    if (SETTINGS.global.debug)
        console.log('group updated', bks)
    workers.map((w, i) => {
        w.postMessage({
            name: 'connects',
            values: bks[i],
        })
    })
}

blk.receiveValueOnFace = function (index, value, face) {
    workers[index].postMessage({
        name: 'receive',
        face: face,
        value: value
    })
}

blk.doubleClicked = function () {
    if (SETTINGS.global.debug)
        console.log('double clicked on canvas');
    // blk.createBlockAt(blk.mouseX, blk.mouseY);
}

blk.buttonPressed = function (id) {
    if (SETTINGS.global.debug)
        console.log("#", id, "button is pressed");
    if (id < workers.length) {
        workers[id].postMessage({
            name: 'btnpressed'
        })
    }
}

blk.buttonReleased = function (id) {
    if (SETTINGS.global.debug)
        console.log("#", id, "button is released");
    if (id < workers.length) {
        workers[id].postMessage({
            name: 'btnreleased'
        })
    }
}

blk.buttonSingleClicked = function (id) {
    if (SETTINGS.global.debug)
        console.log("#", id, "button is single clicked");
    if (id < workers.length) {
        workers[id].postMessage({
            name: 'btnclicked',
            value: 1
        })
    }
}

blk.buttonDoubleClicked = function (id) {
    if (SETTINGS.global.debug)
        console.log("#", id, "button is double clicked");
    if (id < workers.length) {
        workers[id].postMessage({
            name: 'btnclicked',
            value: 2
        })
    }
}

blk.buttonMultiClicked = function (id, count) {
    if (SETTINGS.global.debug)
        console.log("#", id, "button is multi clicked, count: ", count);
    if (id < workers.length) {
        workers[id].postMessage({
            name: 'btnclicked',
            value: count
        })
    }
}

blk.buttonLongPressed = function (id) {
    if (SETTINGS.global.debug)
        console.log("#", id, "button is long pressed");
    if (id < workers.length) {
        workers[id].postMessage({
            name: 'btnlongpressed'
        })
    }
}

function clear() {
    blk.clearCanvas();
    workers.map(w => w.terminate())
    workers = []
    frameCount = 0;
}

function init(f) {
    // setup webworkers for each blink
    for (let i = 0; i < BLOCKS_NUM; i++) {
        let index = i;
        let worker = new Worker('js/examples/' + f + '.js');
        worker.postMessage({
            name: 'index',
            value: index
        })

        // listen to message event of worker
        worker.addEventListener('message', function (event) {
            // console.log('message received => ', event.data);
            let eventName = event.data.name;
            let eventValues = event.data.values;
            if (blk[eventName]) {
                blk[eventName].apply(this, eventValues);
            }
        });
        // listen to error event of worker
        worker.addEventListener('error', function (event) {
            console.error('error received => ', event);
        });
        workers.push(worker);
    }
    blk.createBlocks(BLOCKS_NUM);
}

init(SETTINGS.global.select);