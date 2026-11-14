// SPDX-License-Identifier: MIT
// Copyright (c) Uri Shaked and contributors
import { PinOverrideMode } from './gpio.js';
// TCCR1 bits
const CTC1 = 1 << 7;
const PWM1A = 1 << 6;
const CS_MASK = 0x0f;
// GTCCR bits
const PWM1B_BIT = 1 << 6;
const FOC1B = 1 << 3;
const FOC1A = 1 << 2;
const PSR1 = 1 << 1;
export const attinyTimer1Config = {
    TCCR1: 0x50,
    GTCCR: 0x4c,
    TCNT1: 0x4f,
    OCR1A: 0x4e,
    OCR1B: 0x4b,
    OCR1C: 0x4d,
    TIFR: 0x58,
    TIMSK: 0x59,
    ovfInterrupt: 0x04,
    compAInterrupt: 0x03,
    compBInterrupt: 0x09,
    TOV1: 1 << 2,
    OCF1A: 1 << 6,
    OCF1B: 1 << 5,
    TOIE1: 1 << 2,
    OCIE1A: 1 << 6,
    OCIE1B: 1 << 5,
    compPortB: 0x38,
    compPinA: 1, // PB1
    compPinB: 4, // PB4
    dividers: {
        0: 0,
        1: 1,
        2: 2,
        3: 4,
        4: 8,
        5: 16,
        6: 32,
        7: 64,
        8: 128,
        9: 256,
        10: 512,
        11: 1024,
        12: 2048,
        13: 4096,
        14: 8192,
        15: 16384,
    },
};
export class ATtinyTimer1 {
    constructor(cpu, config) {
        this.cpu = cpu;
        this.config = config;
        this.lastCycle = 0;
        this.tcnt = 0;
        this.tcntNext = 0;
        this.tcntUpdated = false;
        this.ocrA = 0;
        this.ocrB = 0;
        this.ocrC = 0;
        this.divider = 0;
        this.updateDivider = false;
        this.countingUp = true;
        this.OVF = {
            address: this.config.ovfInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.TOV1,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.TOIE1,
        };
        this.OCFA = {
            address: this.config.compAInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.OCF1A,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.OCIE1A,
        };
        this.OCFB = {
            address: this.config.compBInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.OCF1B,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.OCIE1B,
        };
        this.count = (reschedule = true) => {
            var _a;
            const { divider, lastCycle, cpu } = this;
            const { cycles } = cpu;
            const delta = cycles - lastCycle;
            if (divider && delta >= divider) {
                const counterDelta = Math.floor(delta / divider);
                this.lastCycle += counterDelta * divider;
                const val = this.tcnt;
                const top = this.TOP;
                const phasePwm = (this.pwmA || this.pwmB) && !this.ctcMode;
                const newVal = phasePwm
                    ? this.phasePwmCount(val, counterDelta)
                    : (val + counterDelta) % (top + 1);
                const overflow = val + counterDelta > top;
                if (!this.tcntUpdated) {
                    this.tcnt = newVal;
                    if (!phasePwm) {
                        this.timerUpdated(newVal, val);
                    }
                }
                if (!phasePwm && overflow) {
                    cpu.setInterruptFlag(this.OVF);
                }
            }
            if (this.tcntUpdated) {
                this.tcnt = this.tcntNext;
                this.tcntUpdated = false;
            }
            if (this.updateDivider) {
                const cs = this.CS;
                const newDivider = (_a = this.config.dividers[cs]) !== null && _a !== void 0 ? _a : 0;
                this.lastCycle = newDivider ? this.cpu.cycles : 0;
                this.updateDivider = false;
                this.divider = newDivider;
                if (newDivider) {
                    cpu.addClockEvent(this.count, this.lastCycle + newDivider - cpu.cycles);
                }
                return;
            }
            if (reschedule && divider) {
                cpu.addClockEvent(this.count, this.lastCycle + divider - cpu.cycles);
            }
        };
        const { TCCR1, GTCCR, TCNT1, OCR1A, OCR1B, OCR1C, TIFR, TIMSK } = config;
        cpu.readHooks[TCNT1] = () => {
            this.count(false);
            return (cpu.data[TCNT1] = this.tcnt & 0xff);
        };
        cpu.writeHooks[TCNT1] = (value) => {
            this.tcntNext = value;
            this.countingUp = true;
            this.tcntUpdated = true;
            cpu.updateClockEvent(this.count, 0);
            if (this.divider) {
                this.timerUpdated(this.tcntNext, this.tcntNext);
            }
        };
        cpu.writeHooks[OCR1A] = (value) => {
            this.ocrA = value;
        };
        cpu.writeHooks[OCR1B] = (value) => {
            this.ocrB = value;
        };
        cpu.writeHooks[OCR1C] = (value) => {
            this.ocrC = value;
        };
        cpu.writeHooks[TCCR1] = (value) => {
            cpu.data[TCCR1] = value;
            this.updateDivider = true;
            cpu.clearClockEvent(this.count);
            cpu.addClockEvent(this.count, 0);
            this.updateCompConfig();
            return true;
        };
        // GTCCR is shared with Timer0 (PSR0) — chain with existing hook
        const prevGtccrHook = cpu.writeHooks[GTCCR];
        cpu.writeHooks[GTCCR] = (value, oldValue, addr, mask) => {
            if (value & FOC1A) {
                this.forceCompare('A');
            }
            if (value & FOC1B) {
                this.forceCompare('B');
            }
            if (value & PSR1) {
                this.lastCycle = this.cpu.cycles;
            }
            value &= ~(FOC1A | FOC1B | PSR1);
            if (prevGtccrHook) {
                prevGtccrHook(value, oldValue, addr, mask);
            }
            else {
                cpu.data[GTCCR] = value;
            }
            this.updateCompConfig();
            return true;
        };
        // TIFR/TIMSK are shared with Timer0 — chain with existing hooks
        const prevTifrHook = cpu.writeHooks[TIFR];
        cpu.writeHooks[TIFR] = (value, oldValue, addr, mask) => {
            if (prevTifrHook) {
                prevTifrHook(value, oldValue, addr, mask);
            }
            else {
                cpu.data[TIFR] = value;
            }
            cpu.clearInterruptByFlag(this.OVF, value);
            cpu.clearInterruptByFlag(this.OCFA, value);
            cpu.clearInterruptByFlag(this.OCFB, value);
            return true;
        };
        const prevTimskHook = cpu.writeHooks[TIMSK];
        cpu.writeHooks[TIMSK] = (value, oldValue, addr, mask) => {
            if (prevTimskHook) {
                prevTimskHook(value, oldValue, addr, mask);
            }
            cpu.updateInterruptEnable(this.OVF, value);
            cpu.updateInterruptEnable(this.OCFA, value);
            cpu.updateInterruptEnable(this.OCFB, value);
        };
    }
    get tccr1() {
        return this.cpu.data[this.config.TCCR1];
    }
    get gtccr() {
        return this.cpu.data[this.config.GTCCR];
    }
    get CS() {
        return this.tccr1 & CS_MASK;
    }
    get ctcMode() {
        return !!(this.tccr1 & CTC1);
    }
    get pwmA() {
        return !!(this.tccr1 & PWM1A);
    }
    get pwmB() {
        return !!(this.gtccr & PWM1B_BIT);
    }
    get comA() {
        return (this.tccr1 >> 4) & 0x3;
    }
    get comB() {
        return (this.gtccr >> 4) & 0x3;
    }
    /** TOP = OCR1C in CTC/PWM modes, 0xFF in Normal mode */
    get TOP() {
        if (this.ctcMode || this.pwmA || this.pwmB) {
            return this.ocrC;
        }
        return 0xff;
    }
    phasePwmCount(value, delta) {
        const top = this.TOP;
        while (delta > 0) {
            if (this.countingUp) {
                value++;
                if (value >= top) {
                    value = top;
                    this.countingUp = false;
                }
            }
            else {
                value--;
                if (value <= 0) {
                    value = 0;
                    this.countingUp = true;
                    this.cpu.setInterruptFlag(this.OVF);
                }
            }
            if (!this.tcntUpdated) {
                if (value === this.ocrA) {
                    this.cpu.setInterruptFlag(this.OCFA);
                    this.updateCompPinPwm('A');
                }
                if (value === this.ocrB) {
                    this.cpu.setInterruptFlag(this.OCFB);
                    this.updateCompPinPwm('B');
                }
            }
            delta--;
        }
        return value & 0xff;
    }
    timerUpdated(value, prevValue) {
        const { ocrA, ocrB } = this;
        const overflow = prevValue > value;
        if (((prevValue < ocrA || overflow) && value >= ocrA) || (prevValue < ocrA && overflow)) {
            this.cpu.setInterruptFlag(this.OCFA);
            if (this.comA && !this.pwmA) {
                this.updateCompPinNonPwm('A');
            }
        }
        if (((prevValue < ocrB || overflow) && value >= ocrB) || (prevValue < ocrB && overflow)) {
            this.cpu.setInterruptFlag(this.OCFB);
            if (this.comB && !this.pwmB) {
                this.updateCompPinNonPwm('B');
            }
        }
    }
    forceCompare(channel) {
        if (channel === 'A' && !this.pwmA && this.comA) {
            this.updateCompPinNonPwm('A');
        }
        else if (channel === 'B' && !this.pwmB && this.comB) {
            this.updateCompPinNonPwm('B');
        }
    }
    updateCompPinNonPwm(channel) {
        var _a;
        const com = channel === 'A' ? this.comA : this.comB;
        const pin = channel === 'A' ? this.config.compPinA : this.config.compPinB;
        let mode;
        switch (com) {
            case 1:
                mode = PinOverrideMode.Toggle;
                break;
            case 2:
                mode = PinOverrideMode.Clear;
                break;
            case 3:
                mode = PinOverrideMode.Set;
                break;
            default:
                return;
        }
        (_a = this.cpu.gpioByPort[this.config.compPortB]) === null || _a === void 0 ? void 0 : _a.timerOverridePin(pin, mode);
    }
    updateCompPinPwm(channel) {
        var _a;
        const com = channel === 'A' ? this.comA : this.comB;
        const pin = channel === 'A' ? this.config.compPinA : this.config.compPinB;
        const invertingMode = com === 3;
        const isSet = this.countingUp === invertingMode;
        let mode;
        switch (com) {
            case 1:
                mode = PinOverrideMode.Toggle;
                break;
            case 2:
            case 3:
                mode = isSet ? PinOverrideMode.Set : PinOverrideMode.Clear;
                break;
            default:
                return;
        }
        (_a = this.cpu.gpioByPort[this.config.compPortB]) === null || _a === void 0 ? void 0 : _a.timerOverridePin(pin, mode);
    }
    updateCompConfig() {
        const port = this.cpu.gpioByPort[this.config.compPortB];
        if (!port)
            return;
        port.timerOverridePin(this.config.compPinA, this.comA ? PinOverrideMode.Enable : PinOverrideMode.None);
        port.timerOverridePin(this.config.compPinB, this.comB ? PinOverrideMode.Enable : PinOverrideMode.None);
    }
}
