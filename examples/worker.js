const RED = [1.0, 0, 0];
const ORANGE = [1.0, 1.0 / 2, 0];
const YELLOW = [1.0, 1.0, 0];
const GREEN = [0, 1.0, 0];
const CYAN = [0, 1.0, 1.0];
const BLUE = [0, 0, 1.0];
const MAGENTA = [1.0, 0, 1.0];
const WHITE = [1.0, 1.0, 1.0];
const OFF = [0, 0, 0];
const NEVER = Number.MAX_SAFE_INTEGER;

self.milliseconds = 0;
self.millisOffset = Math.floor(Math.random() * 1000);

self.onmessage = function (event) {
    if (event.data.name === 'index') {
        self.index = event.data.value;
        setup();
    }
    else if (event.data.name === 'loop') {
        self.milliseconds = event.data.value + self.millisOffset;
        loop();
    }
}

function millis() {
    return self.milliseconds;
}

function dim(color, brightness) {
    return color.map(c => c * brightness / 255);
}

function sin8_C(theta) {
    return Math.sin(theta / 256.0 * Math.PI) * 128 + 128;
}

function map(x, in_min, in_max, out_min, out_max) {
    let val = out_min + (out_max - out_min) * ((x - in_min) * 1.0 / (in_max - in_min));
    if (out_min < out_max) {
        return Math.min(Math.max(val, out_min), out_max);
    } else {
        return Math.min(Math.max(val, out_max), out_min);
    }
}

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

class Timer {
    constructor(s) {
        this.worker = s;
    }

    set(ms) {
        this.m_expireTime = this.worker.milliseconds + ms;
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
        return this.worker.milliseconds > this.m_expireTime;
    }

    getRemaining() {
        let timeRemaining;
        if (this.worker.milliseconds >= this.m_expireTime) {
            timeRemaining = 0;
        } else {
            timeRemaining = this.m_expireTime - this.worker.milliseconds;
        }
        return timeRemaining;
    }
}