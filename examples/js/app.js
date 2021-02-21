/* 
*   Javascript that runs the code editor and simulation
*   Code Editor is supported by Code Mirror
*   Interaction (mouse click / drag) and rendering are done in `Blinks.js`
*   Multithreading webworker, messagings among them are created here at `app.js`
*/

window.URL = window.URL || window.webkitURL;

// STATS
const stats = new Stats();
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: customß
document.body.appendChild(stats.dom);
stats.dom.style.left = null;
stats.dom.style.top = null;
stats.dom.style.right = 0;
stats.dom.style.bottom = 0;

const examples = {
    "Template": 'code/template.ino',
    "Learn: Time": 'code/time.ino',
    'Learn: Display': 'code/display.ino',
    'Learn: Button Click': 'code/buttonClick.ino',
    'Learn: Button Press': 'code/buttonPress.ino',
    'Learn: Neighbors': 'code/neighbors.ino',
    'Learn: Communication': 'code/communication.ino',
    'Learn: Send Signal': 'code/sendSignal.ino',
    'Game: WHAM': 'code/WHAM.ino',
    'Game: Fracture': 'code/Fracture.ino',
    'Game: Berry': 'code/Berry.ino',
    'Game: Bomb Brigade': 'code/BombBrigade.ino',
    'Game: Mortals': 'code/Mortals.ino',
    'Game: Puzzle101': 'code/Puzzle101.ino',
    'Game: Darkball': 'code/Darkball.ino'
}

// Dat GUI
const SETTINGS = {
    'Debug Mode': false,
    'Run Code': () => {
        clear();
        webWorkerURL = createWebWorker(editor.getValue());
        init();
    },
    'Load File': examples["Template"],
    'Blinks Number': 6
};
const gui = new dat.GUI({ hideable: false });
gui.width = 300;
gui.add(SETTINGS, 'Load File', examples).onChange(s => {
    clear();
    loadCode(s);
});
gui.add(SETTINGS, 'Blinks Number', 6, 18).step(1); 
gui.add(SETTINGS, "Run Code");
gui.add(SETTINGS, "Debug Mode").onFinishChange(d => blk.debugMode = d);

// Editor

const editorEl = document.getElementById('editor');
const editor = CodeMirror.fromTextArea(editorEl, {
    theme: 'material-darker',
    mode: "text/x-c++src",
    tabSize: 4,
    styleActiveLine: true,
    matchBrackets: true,
    lineNumbers: true
});

// autorun on save
document.addEventListener("keydown", function (e) {
    if (e.keyCode == 83 && (navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey)) {
        e.preventDefault();
        
        clear();
        webWorkerURL = createWebWorker(editor.getValue());
        init();
    }
}, false);

/* SETUP */
const blk = new blinks.init(SETTINGS['Load File']);
blk.debugMode = SETTINGS['Debug Mode'];
let frameCount = 0;
let workers = [];
let webWorkerURL;
let blinkFns;

// close GUI folders & remove framecount display on mobile devices
if (blk.isTouchDevice > 0) {
    gui.close();
    document.body.removeChild(stats.dom);
    editorEl.style.display = 'none';
}
else {
    blk.resizeCanvas(blk.width / 2, blk.height);
}

/* UPDATE */

blk.beforeFrameUpdated = function () {
    stats.begin();
    workers.map(w => {  // calling update on each web worker thread
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

// function get called when blink cluster get updated
blk.groupUpdated = function (bks) {
    if (SETTINGS['Debug Mode'])
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

blk.receiveDatagramOnFace = function (index, data, face) {
    workers[index].postMessage({
        name: 'data',
        face: face,
        datagram: data
    })
}

blk.doubleClicked = function () {
    if (SETTINGS['Debug Mode'])
        console.log('double clicked on canvas');
    // blk.createBlockAt(blk.mouseX, blk.mouseY);
}

blk.buttonPressed = function (id) {
    if (SETTINGS['Debug Mode'])
        console.log("#", id, "button is pressed");
    if (id < workers.length) {
        workers[id].postMessage({
            name: 'btnpressed'
        })
    }
}

blk.buttonReleased = function (id) {
    if (SETTINGS['Debug Mode'])
        console.log("#", id, "button is released");
    if (id < workers.length) {
        workers[id].postMessage({
            name: 'btnreleased'
        })
    }
}

blk.buttonSingleClicked = function (id) {
    if (SETTINGS['Debug Mode'])
        console.log("#", id, "button is single clicked");
    if (id < workers.length) {
        workers[id].postMessage({
            name: 'btnclicked',
            value: 1
        })
    }
}

blk.buttonDoubleClicked = function (id) {
    if (SETTINGS['Debug Mode'])
        console.log("#", id, "button is double clicked");
    if (id < workers.length) {
        workers[id].postMessage({
            name: 'btnclicked',
            value: 2
        })
    }
}

blk.buttonMultiClicked = function (id, count) {
    if (SETTINGS['Debug Mode'])
        console.log("#", id, "button is multi clicked, count: ", count);
    if (id < workers.length) {
        workers[id].postMessage({
            name: 'btnclicked',
            value: count
        })
    }
}

blk.buttonLongPressed = function (id) {
    if (SETTINGS['Debug Mode'])
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

function init() {
    // console.log( 'init blocks', SETTINGS['Blinks Number'], workers.length )
    // setup webworkers for each blink
    for (let i = 0; i < SETTINGS['Blinks Number']; i++) {
        let index = i;
        let worker = new Worker(webWorkerURL);
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
    blk.createBlocks(SETTINGS['Blinks Number']);
    blk.resetMillis();
}

loadCode(SETTINGS['Load File'])

// Utilities
function loadCode(path) {
    if (!blinkFns) {    // load blink library if not yet
        fetch('js/blink.js')
            .then(response => response.text())
            .then(data => {
                blinkFns = data;
                loadWorkerFns(path)
            })
            .catch((error) => {
                console.error('Error:', error);
            });
    }
    else {
        loadWorkerFns(path)
    }
}

function loadWorkerFns(path) {
    fetch(path)
        .then(response => response.text())
        .then(data => {
            // pass data to editor
            editor.setValue(data);
            // convert code into js and create webworker URL
            webWorkerURL = createWebWorker(data);
            init()  // start simulator

        })
        .catch((error) => {
            console.error('Error:', error);
        });
}

function createWebWorker(data) {
    const jsString = blinkFns + parseCode(data);    // combine blink library and newly converted JS code
    console.log(parseCode(data))
    // create web worker URL    // web worker are only created using URL, here we are using Blob to generate an URL dynamically
    var blob;
    try {
        blob = new Blob([jsString], { type: 'application/javascript' });
    } catch (e) { // Backwards-compatibility
        window.BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder;
        blob = new BlobBuilder();
        blob.append(response);
        blob = blob.getBlob();
    }
    return URL.createObjectURL(blob);
}