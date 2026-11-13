// SPDX-License-Identifier: MIT
// Copyright (c) Uri Shaked and contributors
import { PinOverrideMode, portBConfig, portDConfig } from './gpio.js';
const timer01Dividers = {
    0: 0,
    1: 1,
    2: 8,
    3: 64,
    4: 256,
    5: 1024,
    6: 0, // External clock - see ExternalClockMode
    7: 0, // Ditto
};
var ExternalClockMode;
(function (ExternalClockMode) {
    ExternalClockMode[ExternalClockMode["FallingEdge"] = 6] = "FallingEdge";
    ExternalClockMode[ExternalClockMode["RisingEdge"] = 7] = "RisingEdge";
})(ExternalClockMode || (ExternalClockMode = {}));
/** These are differnet for some devices (e.g. ATtiny85) */
const defaultTimerBits = {
    // TIFR bits
    TOV: 1,
    OCFA: 2,
    OCFB: 4,
    OCFC: 0, // Unused
    // TIMSK bits
    TOIE: 1,
    OCIEA: 2,
    OCIEB: 4,
    OCIEC: 0, // Unused
};
export const timer0Config = Object.assign({ bits: 8, captureInterrupt: 0, compAInterrupt: 0x1c, compBInterrupt: 0x1e, compCInterrupt: 0, ovfInterrupt: 0x20, TIFR: 0x35, OCRA: 0x47, OCRB: 0x48, OCRC: 0, ICR: 0, TCNT: 0x46, TCCRA: 0x44, TCCRB: 0x45, TCCRC: 0, TIMSK: 0x6e, dividers: timer01Dividers, compPortA: portDConfig.PORT, compPinA: 6, compPortB: portDConfig.PORT, compPinB: 5, compPortC: 0, compPinC: 0, externalClockPort: portDConfig.PORT, externalClockPin: 4 }, defaultTimerBits);
export const timer1Config = Object.assign({ bits: 16, captureInterrupt: 0x14, compAInterrupt: 0x16, compBInterrupt: 0x18, compCInterrupt: 0, ovfInterrupt: 0x1a, TIFR: 0x36, OCRA: 0x88, OCRB: 0x8a, OCRC: 0, ICR: 0x86, TCNT: 0x84, TCCRA: 0x80, TCCRB: 0x81, TCCRC: 0x82, TIMSK: 0x6f, dividers: timer01Dividers, compPortA: portBConfig.PORT, compPinA: 1, compPortB: portBConfig.PORT, compPinB: 2, compPortC: 0, compPinC: 0, externalClockPort: portDConfig.PORT, externalClockPin: 5 }, defaultTimerBits);
export const timer2Config = Object.assign({ bits: 8, captureInterrupt: 0, compAInterrupt: 0x0e, compBInterrupt: 0x10, compCInterrupt: 0, ovfInterrupt: 0x12, TIFR: 0x37, OCRA: 0xb3, OCRB: 0xb4, OCRC: 0, ICR: 0, TCNT: 0xb2, TCCRA: 0xb0, TCCRB: 0xb1, TCCRC: 0, TIMSK: 0x70, dividers: {
        0: 0,
        1: 1,
        2: 8,
        3: 32,
        4: 64,
        5: 128,
        6: 256,
        7: 1024,
    }, compPortA: portBConfig.PORT, compPinA: 3, compPortB: portDConfig.PORT, compPinB: 3, compPortC: 0, compPinC: 0, externalClockPort: 0, externalClockPin: 0 }, defaultTimerBits);
/* All the following types and constants are related to WGM (Waveform Generation Mode) bits: */
var TimerMode;
(function (TimerMode) {
    TimerMode[TimerMode["Normal"] = 0] = "Normal";
    TimerMode[TimerMode["PWMPhaseCorrect"] = 1] = "PWMPhaseCorrect";
    TimerMode[TimerMode["CTC"] = 2] = "CTC";
    TimerMode[TimerMode["FastPWM"] = 3] = "FastPWM";
    TimerMode[TimerMode["PWMPhaseFrequencyCorrect"] = 4] = "PWMPhaseFrequencyCorrect";
    TimerMode[TimerMode["Reserved"] = 5] = "Reserved";
})(TimerMode || (TimerMode = {}));
var TOVUpdateMode;
(function (TOVUpdateMode) {
    TOVUpdateMode[TOVUpdateMode["Max"] = 0] = "Max";
    TOVUpdateMode[TOVUpdateMode["Top"] = 1] = "Top";
    TOVUpdateMode[TOVUpdateMode["Bottom"] = 2] = "Bottom";
})(TOVUpdateMode || (TOVUpdateMode = {}));
var OCRUpdateMode;
(function (OCRUpdateMode) {
    OCRUpdateMode[OCRUpdateMode["Immediate"] = 0] = "Immediate";
    OCRUpdateMode[OCRUpdateMode["Top"] = 1] = "Top";
    OCRUpdateMode[OCRUpdateMode["Bottom"] = 2] = "Bottom";
})(OCRUpdateMode || (OCRUpdateMode = {}));
const TopOCRA = 1;
const TopICR = 2;
// Enable Toggle mode for OCxA in PWM Wave Generation mode
const OCToggle = 1;
const { Normal, PWMPhaseCorrect, CTC, FastPWM, Reserved, PWMPhaseFrequencyCorrect } = TimerMode;
const wgmModes8Bit = [
    /*0*/ [Normal, 0xff, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
    /*1*/ [PWMPhaseCorrect, 0xff, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
    /*2*/ [CTC, TopOCRA, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
    /*3*/ [FastPWM, 0xff, OCRUpdateMode.Bottom, TOVUpdateMode.Max, 0],
    /*4*/ [Reserved, 0xff, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
    /*5*/ [PWMPhaseCorrect, TopOCRA, OCRUpdateMode.Top, TOVUpdateMode.Bottom, OCToggle],
    /*6*/ [Reserved, 0xff, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
    /*7*/ [FastPWM, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle],
];
// Table 16-4 in the datasheet
const wgmModes16Bit = [
    /*0 */ [Normal, 0xffff, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
    /*1 */ [PWMPhaseCorrect, 0x00ff, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
    /*2 */ [PWMPhaseCorrect, 0x01ff, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
    /*3 */ [PWMPhaseCorrect, 0x03ff, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
    /*4 */ [CTC, TopOCRA, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
    /*5 */ [FastPWM, 0x00ff, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
    /*6 */ [FastPWM, 0x01ff, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
    /*7 */ [FastPWM, 0x03ff, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
    /*8 */ [PWMPhaseFrequencyCorrect, TopICR, OCRUpdateMode.Bottom, TOVUpdateMode.Bottom, 0],
    /*9 */ [PWMPhaseFrequencyCorrect, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Bottom, OCToggle],
    /*10*/ [PWMPhaseCorrect, TopICR, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
    /*11*/ [PWMPhaseCorrect, TopOCRA, OCRUpdateMode.Top, TOVUpdateMode.Bottom, OCToggle],
    /*12*/ [CTC, TopICR, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
    /*13*/ [Reserved, 0xffff, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
    /*14*/ [FastPWM, TopICR, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle],
    /*15*/ [FastPWM, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle],
];
function compToOverride(comp) {
    switch (comp) {
        case 1:
            return PinOverrideMode.Toggle;
        case 2:
            return PinOverrideMode.Clear;
        case 3:
            return PinOverrideMode.Set;
        default:
            return PinOverrideMode.Enable;
    }
}
// Force Output Compare (FOC) bits
const FOCA = 1 << 7;
const FOCB = 1 << 6;
const FOCC = 1 << 5;
export class AVRTimer {
    constructor(cpu, config) {
        this.cpu = cpu;
        this.config = config;
        this.MAX = this.config.bits === 16 ? 0xffff : 0xff;
        this.lastCycle = 0;
        this.ocrA = 0;
        this.nextOcrA = 0;
        this.ocrB = 0;
        this.nextOcrB = 0;
        this.hasOCRC = this.config.OCRC > 0;
        this.ocrC = 0;
        this.nextOcrC = 0;
        this.ocrUpdateMode = OCRUpdateMode.Immediate;
        this.tovUpdateMode = TOVUpdateMode.Max;
        this.icr = 0; // only for 16-bit timers
        this.tcnt = 0;
        this.tcntNext = 0;
        this.tcntUpdated = false;
        this.updateDivider = false;
        this.countingUp = true;
        this.divider = 0;
        this.externalClockRisingEdge = false;
        // This is the temporary register used to access 16-bit registers (section 16.3 of the datasheet)
        this.highByteTemp = 0;
        // Interrupts
        this.OVF = {
            address: this.config.ovfInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.TOV,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.TOIE,
        };
        this.OCFA = {
            address: this.config.compAInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.OCFA,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.OCIEA,
        };
        this.OCFB = {
            address: this.config.compBInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.OCFB,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.OCIEB,
        };
        this.OCFC = {
            address: this.config.compCInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.OCFC,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.OCIEC,
        };
        this.count = (reschedule = true, external = false) => {
            const { divider, lastCycle, cpu } = this;
            const { cycles } = cpu;
            const delta = cycles - lastCycle;
            if ((divider && delta >= divider) || external) {
                const counterDelta = external ? 1 : Math.floor(delta / divider);
                this.lastCycle += counterDelta * divider;
                const val = this.tcnt;
                const { timerMode, TOP } = this;
                const phasePwm = timerMode === PWMPhaseCorrect || timerMode === PWMPhaseFrequencyCorrect;
                const newVal = phasePwm
                    ? this.phasePwmCount(val, counterDelta)
                    : (val + counterDelta) % (TOP + 1);
                const overflow = val + counterDelta > TOP;
                // A CPU write overrides (has priority over) all counter clear or count operations.
                if (!this.tcntUpdated) {
                    this.tcnt = newVal;
                    if (!phasePwm) {
                        this.timerUpdated(newVal, val);
                    }
                }
                if (!phasePwm) {
                    if (timerMode === FastPWM && overflow) {
                        const { compA, compB } = this;
                        if (compA) {
                            this.updateCompPin(compA, 'A', true);
                        }
                        if (compB) {
                            this.updateCompPin(compB, 'B', true);
                        }
                    }
                    if (this.ocrUpdateMode == OCRUpdateMode.Bottom && overflow) {
                        // OCRUpdateMode.Top only occurs in Phase Correct modes, handled by phasePwmCount()
                        this.ocrA = this.nextOcrA;
                        this.ocrB = this.nextOcrB;
                        this.ocrC = this.nextOcrC;
                    }
                    // OCRUpdateMode.Bottom only occurs in Phase Correct modes, handled by phasePwmCount().
                    // Thus we only handle TOVUpdateMode.Top or TOVUpdateMode.Max here.
                    if (overflow && (this.tovUpdateMode == TOVUpdateMode.Top || TOP === this.MAX)) {
                        cpu.setInterruptFlag(this.OVF);
                    }
                }
            }
            if (this.tcntUpdated) {
                this.tcnt = this.tcntNext;
                this.tcntUpdated = false;
                if ((this.tcnt === 0 && this.ocrUpdateMode === OCRUpdateMode.Bottom) ||
                    (this.tcnt === this.TOP && this.ocrUpdateMode === OCRUpdateMode.Top)) {
                    this.ocrA = this.nextOcrA;
                    this.ocrB = this.nextOcrB;
                    this.ocrC = this.nextOcrC;
                }
            }
            if (this.updateDivider) {
                const { CS } = this;
                const { externalClockPin } = this.config;
                const newDivider = this.config.dividers[CS];
                this.lastCycle = newDivider ? this.cpu.cycles : 0;
                this.updateDivider = false;
                this.divider = newDivider;
                if (this.config.externalClockPort && !this.externalClockPort) {
                    this.externalClockPort = this.cpu.gpioByPort[this.config.externalClockPort];
                }
                if (this.externalClockPort) {
                    this.externalClockPort.externalClockListeners[externalClockPin] = null;
                }
                if (newDivider) {
                    cpu.addClockEvent(this.count, this.lastCycle + newDivider - cpu.cycles);
                }
                else if (this.externalClockPort &&
                    (CS === ExternalClockMode.FallingEdge || CS === ExternalClockMode.RisingEdge)) {
                    this.externalClockPort.externalClockListeners[externalClockPin] =
                        this.externalClockCallback;
                    this.externalClockRisingEdge = CS === ExternalClockMode.RisingEdge;
                }
                return;
            }
            if (reschedule && divider) {
                cpu.addClockEvent(this.count, this.lastCycle + divider - cpu.cycles);
            }
        };
        this.externalClockCallback = (value) => {
            if (value === this.externalClockRisingEdge) {
                this.count(false, true);
            }
        };
        this.updateWGMConfig();
        this.cpu.readHooks[config.TCNT] = (addr) => {
            this.count(false);
            if (this.config.bits === 16) {
                this.cpu.data[addr + 1] = this.tcnt >> 8;
            }
            return (this.cpu.data[addr] = this.tcnt & 0xff);
        };
        this.cpu.writeHooks[config.TCNT] = (value) => {
            this.tcntNext = (this.highByteTemp << 8) | value;
            this.countingUp = true;
            this.tcntUpdated = true;
            this.cpu.updateClockEvent(this.count, 0);
            if (this.divider) {
                this.timerUpdated(this.tcntNext, this.tcntNext);
            }
        };
        this.cpu.writeHooks[config.OCRA] = (value) => {
            this.nextOcrA = (this.highByteTemp << 8) | value;
            if (this.ocrUpdateMode === OCRUpdateMode.Immediate) {
                this.ocrA = this.nextOcrA;
            }
        };
        this.cpu.writeHooks[config.OCRB] = (value) => {
            this.nextOcrB = (this.highByteTemp << 8) | value;
            if (this.ocrUpdateMode === OCRUpdateMode.Immediate) {
                this.ocrB = this.nextOcrB;
            }
        };
        if (this.hasOCRC) {
            this.cpu.writeHooks[config.OCRC] = (value) => {
                this.nextOcrC = (this.highByteTemp << 8) | value;
                if (this.ocrUpdateMode === OCRUpdateMode.Immediate) {
                    this.ocrC = this.nextOcrC;
                }
            };
        }
        if (this.config.bits === 16) {
            this.cpu.writeHooks[config.ICR] = (value) => {
                this.icr = (this.highByteTemp << 8) | value;
            };
            const updateTempRegister = (value) => {
                this.highByteTemp = value;
            };
            const updateOCRHighRegister = (value, old, addr) => {
                this.highByteTemp = value & (this.ocrMask >> 8);
                cpu.data[addr] = this.highByteTemp;
                return true;
            };
            this.cpu.writeHooks[config.TCNT + 1] = updateTempRegister;
            this.cpu.writeHooks[config.OCRA + 1] = updateOCRHighRegister;
            this.cpu.writeHooks[config.OCRB + 1] = updateOCRHighRegister;
            if (this.hasOCRC) {
                this.cpu.writeHooks[config.OCRC + 1] = updateOCRHighRegister;
            }
            this.cpu.writeHooks[config.ICR + 1] = updateTempRegister;
        }
        cpu.writeHooks[config.TCCRA] = (value) => {
            this.cpu.data[config.TCCRA] = value;
            this.updateWGMConfig();
            return true;
        };
        cpu.writeHooks[config.TCCRB] = (value) => {
            if (!config.TCCRC) {
                this.checkForceCompare(value);
                value &= ~(FOCA | FOCB);
            }
            this.cpu.data[config.TCCRB] = value;
            this.updateDivider = true;
            this.cpu.clearClockEvent(this.count);
            this.cpu.addClockEvent(this.count, 0);
            this.updateWGMConfig();
            return true;
        };
        if (config.TCCRC) {
            cpu.writeHooks[config.TCCRC] = (value) => {
                this.checkForceCompare(value);
            };
        }
        cpu.writeHooks[config.TIFR] = (value) => {
            this.cpu.data[config.TIFR] = value;
            this.cpu.clearInterruptByFlag(this.OVF, value);
            this.cpu.clearInterruptByFlag(this.OCFA, value);
            this.cpu.clearInterruptByFlag(this.OCFB, value);
            return true;
        };
        cpu.writeHooks[config.TIMSK] = (value) => {
            this.cpu.updateInterruptEnable(this.OVF, value);
            this.cpu.updateInterruptEnable(this.OCFA, value);
            this.cpu.updateInterruptEnable(this.OCFB, value);
        };
    }
    reset() {
        this.divider = 0;
        this.lastCycle = 0;
        this.ocrA = 0;
        this.nextOcrA = 0;
        this.ocrB = 0;
        this.nextOcrB = 0;
        this.ocrC = 0;
        this.nextOcrC = 0;
        this.icr = 0;
        this.tcnt = 0;
        this.tcntNext = 0;
        this.tcntUpdated = false;
        this.countingUp = false;
        this.updateDivider = true;
    }
    get TCCRA() {
        return this.cpu.data[this.config.TCCRA];
    }
    get TCCRB() {
        return this.cpu.data[this.config.TCCRB];
    }
    get TIMSK() {
        return this.cpu.data[this.config.TIMSK];
    }
    get CS() {
        return (this.TCCRB & 0x7);
    }
    get WGM() {
        const mask = this.config.bits === 16 ? 0x18 : 0x8;
        return ((this.TCCRB & mask) >> 1) | (this.TCCRA & 0x3);
    }
    get TOP() {
        switch (this.topValue) {
            case TopOCRA:
                return this.ocrA;
            case TopICR:
                return this.icr;
            default:
                return this.topValue;
        }
    }
    get ocrMask() {
        switch (this.topValue) {
            case TopOCRA:
            case TopICR:
                return 0xffff;
            default:
                return this.topValue;
        }
    }
    /** Expose the raw value of TCNT, for use by the unit tests */
    get debugTCNT() {
        return this.tcnt;
    }
    updateWGMConfig() {
        const { config, WGM } = this;
        const wgmModes = config.bits === 16 ? wgmModes16Bit : wgmModes8Bit;
        const TCCRA = this.cpu.data[config.TCCRA];
        const [timerMode, topValue, ocrUpdateMode, tovUpdateMode, flags] = wgmModes[WGM];
        this.timerMode = timerMode;
        this.topValue = topValue;
        this.ocrUpdateMode = ocrUpdateMode;
        this.tovUpdateMode = tovUpdateMode;
        const pwmMode = timerMode === FastPWM ||
            timerMode === PWMPhaseCorrect ||
            timerMode === PWMPhaseFrequencyCorrect;
        const prevCompA = this.compA;
        this.compA = ((TCCRA >> 6) & 0x3);
        if (this.compA === 1 && pwmMode && !(flags & OCToggle)) {
            this.compA = 0;
        }
        if (!!prevCompA !== !!this.compA) {
            this.updateCompA(this.compA ? PinOverrideMode.Enable : PinOverrideMode.None);
        }
        const prevCompB = this.compB;
        this.compB = ((TCCRA >> 4) & 0x3);
        if (this.compB === 1 && pwmMode) {
            this.compB = 0; // Reserved, according to the datasheet
        }
        if (!!prevCompB !== !!this.compB) {
            this.updateCompB(this.compB ? PinOverrideMode.Enable : PinOverrideMode.None);
        }
        if (this.hasOCRC) {
            const prevCompC = this.compC;
            this.compC = ((TCCRA >> 2) & 0x3);
            if (this.compC === 1 && pwmMode) {
                this.compC = 0; // Reserved, according to the datasheet
            }
            if (!!prevCompC !== !!this.compC) {
                this.updateCompC(this.compC ? PinOverrideMode.Enable : PinOverrideMode.None);
            }
        }
    }
    phasePwmCount(value, delta) {
        const { ocrA, ocrB, ocrC, hasOCRC, TOP, MAX, tcntUpdated } = this;
        if (!value && !TOP) {
            delta = 0;
            if (this.ocrUpdateMode === OCRUpdateMode.Top) {
                this.ocrA = this.nextOcrA;
                this.ocrB = this.nextOcrB;
                this.ocrC = this.nextOcrC;
            }
        }
        while (delta > 0) {
            if (this.countingUp) {
                value++;
                if (value === TOP && !tcntUpdated) {
                    this.countingUp = false;
                    if (this.ocrUpdateMode === OCRUpdateMode.Top) {
                        this.ocrA = this.nextOcrA;
                        this.ocrB = this.nextOcrB;
                        this.ocrC = this.nextOcrC;
                    }
                }
            }
            else {
                value--;
                if (!value && !tcntUpdated) {
                    this.countingUp = true;
                    this.cpu.setInterruptFlag(this.OVF);
                    if (this.ocrUpdateMode === OCRUpdateMode.Bottom) {
                        this.ocrA = this.nextOcrA;
                        this.ocrB = this.nextOcrB;
                        this.ocrC = this.nextOcrC;
                    }
                }
            }
            if (!tcntUpdated) {
                if (value === ocrA) {
                    this.cpu.setInterruptFlag(this.OCFA);
                    if (this.compA) {
                        this.updateCompPin(this.compA, 'A');
                    }
                }
                if (value === ocrB) {
                    this.cpu.setInterruptFlag(this.OCFB);
                    if (this.compB) {
                        this.updateCompPin(this.compB, 'B');
                    }
                }
                if (hasOCRC && value === ocrC) {
                    this.cpu.setInterruptFlag(this.OCFC);
                    if (this.compC) {
                        this.updateCompPin(this.compC, 'C');
                    }
                }
            }
            delta--;
        }
        return value & MAX;
    }
    timerUpdated(value, prevValue) {
        const { ocrA, ocrB, ocrC, hasOCRC } = this;
        const overflow = prevValue > value;
        if (((prevValue < ocrA || overflow) && value >= ocrA) || (prevValue < ocrA && overflow)) {
            this.cpu.setInterruptFlag(this.OCFA);
            if (this.compA) {
                this.updateCompPin(this.compA, 'A');
            }
        }
        if (((prevValue < ocrB || overflow) && value >= ocrB) || (prevValue < ocrB && overflow)) {
            this.cpu.setInterruptFlag(this.OCFB);
            if (this.compB) {
                this.updateCompPin(this.compB, 'B');
            }
        }
        if (hasOCRC &&
            (((prevValue < ocrC || overflow) && value >= ocrC) || (prevValue < ocrC && overflow))) {
            this.cpu.setInterruptFlag(this.OCFC);
            if (this.compC) {
                this.updateCompPin(this.compC, 'C');
            }
        }
    }
    checkForceCompare(value) {
        if (this.timerMode == TimerMode.FastPWM ||
            this.timerMode == TimerMode.PWMPhaseCorrect ||
            this.timerMode == TimerMode.PWMPhaseFrequencyCorrect) {
            // The FOCnA/FOCnB/FOCnC bits are only active when the WGMn3:0 bits specifies a non-PWM mode
            return;
        }
        if (value & FOCA) {
            this.updateCompPin(this.compA, 'A');
        }
        if (value & FOCB) {
            this.updateCompPin(this.compB, 'B');
        }
        if (this.config.compPortC && value & FOCC) {
            this.updateCompPin(this.compC, 'C');
        }
    }
    updateCompPin(compValue, pinName, bottom = false) {
        let newValue = PinOverrideMode.None;
        const invertingMode = compValue === 3;
        const isSet = this.countingUp === invertingMode;
        switch (this.timerMode) {
            case Normal:
            case CTC:
                newValue = compToOverride(compValue);
                break;
            case FastPWM:
                if (compValue === 1) {
                    newValue = bottom ? PinOverrideMode.None : PinOverrideMode.Toggle;
                }
                else {
                    newValue = invertingMode !== bottom ? PinOverrideMode.Set : PinOverrideMode.Clear;
                }
                break;
            case PWMPhaseCorrect:
            case PWMPhaseFrequencyCorrect:
                if (compValue === 1) {
                    newValue = PinOverrideMode.Toggle;
                }
                else {
                    newValue = isSet ? PinOverrideMode.Set : PinOverrideMode.Clear;
                }
                break;
        }
        if (newValue !== PinOverrideMode.None) {
            if (pinName === 'A') {
                this.updateCompA(newValue);
            }
            else if (pinName === 'B') {
                this.updateCompB(newValue);
            }
            else {
                this.updateCompC(newValue);
            }
        }
    }
    updateCompA(value) {
        const { compPortA, compPinA } = this.config;
        const port = this.cpu.gpioByPort[compPortA];
        port === null || port === void 0 ? void 0 : port.timerOverridePin(compPinA, value);
    }
    updateCompB(value) {
        const { compPortB, compPinB } = this.config;
        const port = this.cpu.gpioByPort[compPortB];
        port === null || port === void 0 ? void 0 : port.timerOverridePin(compPinB, value);
    }
    updateCompC(value) {
        const { compPortC, compPinC } = this.config;
        const port = this.cpu.gpioByPort[compPortC];
        port === null || port === void 0 ? void 0 : port.timerOverridePin(compPinC, value);
    }
}
