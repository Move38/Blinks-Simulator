const FACE_COUNT = 6;
const MAX_BRIGHTNESS = 255;
const START_STATE_POWER_UP = 0;
const START_STATE_WE_ARE_ROOT = 1;
const START_STATE_DOWNLOAD_SUCCESS = 2;
const IR_DATA_VALUE_MAX = 63;

const RED = [1.0, 0, 0];
const ORANGE = [1.0, 1.0 / 2, 0];
const YELLOW = [1.0, 1.0, 0];
const GREEN = [0, 1.0, 0];
const CYAN = [0, 1.0, 1.0];
const BLUE = [0, 0, 1.0];
const MAGENTA = [1.0, 0, 1.0];
const WHITE = [1.0, 1.0, 1.0];
const OFF = [0, 0, 0];

self._millis = 0;
self._connects = Array.from({ length: FACE_COUNT }, () => -1);
self._outs = Array.from({ length: FACE_COUNT }, () => -1);
self._newouts = Array.from({ length: FACE_COUNT }, () => -1); //aggregate all face values during each loop
self._ins = Array.from({ length: FACE_COUNT }, () => {
    return {
        value: -1,
        flag: false // updates
    }
});
self._millisOffset = Math.floor(Math.random() * 1000);

self.onmessage = function (event) {
    if (event.data.name === 'index') {
        self.index = event.data.value;
        if (typeof (setup) === 'function') {
            setup();
            _sendFaces();
        }
    }
    else if (event.data.name === 'loop') {
        self._millis = event.data.value + self._millisOffset;
        if (typeof (loop) === 'function') {
            self._newouts = self._outs.slice();
            loop();
            _sendFaces();
        }
    }
    else if (event.data.name === 'btnreleased') {
        self._buttondown = false;
        self._buttonReleasedFlag = true;

    }
    else if (event.data.name === 'btnclicked') {
        self._buttonClickCount = event.data.value;
        if (event.data.value === 1) {
            self._buttonSingleClickedFlag = true;
        }
        else if (event.data.value === 2) {
            self._buttonDoubleClickedFlag = true;
        }
        else {
            self._buttonMultiClickedFlag = true;
        }
    }
    else if (event.data.name === 'btnlongpressed') {
        self._buttonLongPressedFlag = true;
    }
    else if (event.data.name === 'connects') {
        if (!self._connects.every((c, i) => c === event.data.values[i])) {
            self._connects = event.data.values;
            self.postMessage({
                name: 'setValuesSentOnFaces',
                values: [self.index, self._outs]
            });
        }
    }
    else if (event.data.name === 'receive') {
        if (self._ins[event.data.face].value !== event.data.value) {
            self._ins[event.data.face].value = event.data.value;
            self._ins[event.data.face].flag = true;
        }
    }
    else if (event.data.name === 'btnpressed') {
        self._buttondown = true;
        self._buttonPressedFlag = true;

    }
}

/* Display */

function setColor(newColor) {
    self.postMessage({
        name: 'setColor',
        values: [self.index, newColor]
    });
}

function setColorOnFace(newColor, face) {
    self.postMessage({
        name: 'setColorOnFace',
        values: [self.index, newColor, face]
    })
}


/* Colors */

function makeColorRGB(red, green, blue) {
    return [red / 255.0, green / 255.0, blue / 255.0];
}

function makeColorHSB(hue, saturation, brightness) {
    let r;
    let g;
    let b;

    if (saturation == 0) {
        r = g = b = brightness;
    }
    else {
        let scaledHue = parseInt(hue * 6);
        let sector = scaledHue >> 8; // sector 0 to 5 around the color wheel
        let offsetInSector = scaledHue - (sector << 8);  // position within the sector
        let p = (brightness * (255 - saturation)) >> 8;
        let q = (brightness * (255 - ((saturation * offsetInSector) >> 8))) >> 8;
        let t = (brightness * (255 - ((saturation * (255 - offsetInSector)) >> 8))) >> 8;

        switch (sector) {
            case 0:
                r = brightness;
                g = t;
                b = p;
                break;
            case 1:
                r = q;
                g = brightness;
                b = p;
                break;
            case 2:
                r = p;
                g = brightness;
                b = t;
                break;
            case 3:
                r = p;
                g = q;
                b = brightness;
                break;
            case 4:
                r = t;
                g = p;
                b = brightness;
                break;
            default:    // case 5:
                r = brightness;
                g = p;
                b = q;
                break;
        }
    }

    return (makeColorRGB(r, g, b));
}

function dim(color, brightness) {
    return color.map(c => c * brightness / 255);
}


/* Button */

function buttonDown() {
    return self._buttondown;
}

function buttonPressed() {
    const result = self._buttonPressedFlag;
    self._buttonPressedFlag = false;
    return result;
}

function buttonReleased() {
    const result = self._buttonReleasedFlag;
    self._buttonReleasedFlag = false;
    return result;
}

function buttonLongPressed() {
    const result = self._buttonLongPressedFlag;
    self._buttonLongPressedFlag = false;
    return result;
}

function buttonSingleClicked() {
    const result = self._buttonSingleClickedFlag;
    self._buttonSingleClickedFlag = false;
    return result;
}

function buttonDoubleClicked() {
    const result = self._buttonDoubleClickedFlag;
    self._buttonDoubleClickedFlag = false;
    return result;
}

function buttonMultiClicked() {
    const result = self._buttonMultiClickedFlag;
    self._buttonMultiClickedFlag = false;
    return result;
}

function buttonClickCount() {
    const result = self._buttonClickCount;
    self._buttonClickCount = 0;
    return result;
}


/* Communication */

function _sendFaces() {
    const repeated = self._outs.every((o, i) => o === self._newouts[i]);
    self._outs = self._newouts.slice();
    if (!repeated) {
        self.postMessage({
            name: 'setValuesSentOnFaces',
            values: [self.index, self._newouts]
        });
    }

}

function setValueSentOnAllFaces(value) {
    self._newouts = self._newouts.map(o => o = value);
}

function setValueSentOnFace(value, face) {
    self._newouts[face] = value;
}

function getLastValueReceivedOnFace(face) {
    return self._ins[face].value;
}

function isValueReceivedOnFaceExpired(face) {
    return self._connects[face] < 0;
}

function didValueOnFaceChange(face) {
    let result = self._ins[face].flag;
    if (result) {
        self._ins[face].flag = false;
    }
    return result;
}

function isAlone() {
    return self._connects.reduce(function (prev, curr) { return curr < 0 ? prev : false }, true)
}

/* Datagrams */


/* Time */

const NEVER = Number.MAX_SAFE_INTEGER;

function millis() {
    return self._millis;
}

class Timer {
    constructor(s) {
        this.worker = s;
        this.m_expireTime = this.worker._millis;
    }

    set(ms) {
        this.m_expireTime = this.worker._millis + ms;
    }

    add(ms) {
        const timeLeft = NEVER - this.m_expireTime;
        if (ms > timeLeft) {
            this.m_expireTime = NEVER;
        } else {
            this.m_expireTime += ms;
        }
    }

    never() {
        this.m_expireTime = NEVER;
    }

    isExpired() {
        return this.worker._millis > this.m_expireTime;
    }

    getRemaining() {
        let timeRemaining = 0;
        if (this.worker._millis >= this.m_expireTime) {
            timeRemaining = 0;
        } else {
            timeRemaining = this.m_expireTime - this.worker._millis;
        }
        // return 0;
        return timeRemaining;
    }
}

/* Convenience */

function COUNT_OF(array) {
    return array.length;
}

function sin8_C(theta) {
    return Math.sin(theta / 256.0 * Math.PI) * 128 + 128;
}

function random(limit) {
    return Math.round(Math.random() * limit);
}

function map(x, in_min, in_max, out_min, out_max) {
    let val = out_min + (out_max - out_min) * ((x - in_min) * 1.0 / (in_max - in_min));
    if (out_min < out_max) {
        return Math.min(Math.max(val, out_min), out_max);
    } else {
        return Math.min(Math.max(val, out_max), out_min);
    }
}

/* System */