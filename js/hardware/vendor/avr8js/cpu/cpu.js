// SPDX-License-Identifier: MIT
// Copyright (c) Uri Shaked and contributors
import { avrInterrupt } from './interrupt.js';
const registerSpace = 0x100;
const MAX_INTERRUPTS = 128; // Enough for ATMega2560
export class CPU {
    constructor(progMem, sramBytes = 8192) {
        this.progMem = progMem;
        this.sramBytes = sramBytes;
        this.data = new Uint8Array(this.sramBytes + registerSpace);
        this.data16 = new Uint16Array(this.data.buffer);
        this.dataView = new DataView(this.data.buffer);
        this.progBytes = new Uint8Array(this.progMem.buffer);
        this.readHooks = [];
        this.writeHooks = [];
        this.pendingInterrupts = new Array(MAX_INTERRUPTS);
        this.nextClockEvent = null;
        this.clockEventPool = []; // helps avoid garbage collection
        /**
         * Whether the program counter (PC) can address 22 bits (the default is 16)
         */
        this.pc22Bits = this.progBytes.length > 0x20000;
        this.gpioPorts = new Set();
        this.gpioByPort = [];
        /**
         * This function is called by the WDR instruction. The Watchdog peripheral attaches
         * to it to listen for WDR (watchdog reset).
         */
        this.onWatchdogReset = () => {
            /* empty by default */
        };
        /**
         * Program counter
         */
        this.pc = 0;
        /**
         * Clock cycle counter
         */
        this.cycles = 0;
        this.nextInterrupt = -1;
        this.maxInterrupt = 0;
        this.reset();
    }
    reset() {
        this.SP = this.data.length - 1;
        this.pc = 0;
        this.pendingInterrupts.fill(null);
        this.nextInterrupt = -1;
        this.nextClockEvent = null;
    }
    readData(addr) {
        if (addr >= 32 && this.readHooks[addr]) {
            return this.readHooks[addr](addr);
        }
        return this.data[addr];
    }
    writeData(addr, value, mask = 0xff) {
        const hook = this.writeHooks[addr];
        if (hook) {
            if (hook(value, this.data[addr], addr, mask)) {
                return;
            }
        }
        this.data[addr] = value;
    }
    get SP() {
        return this.dataView.getUint16(93, true);
    }
    set SP(value) {
        this.dataView.setUint16(93, value, true);
    }
    get SREG() {
        return this.data[95];
    }
    get interruptsEnabled() {
        return this.SREG & 0x80 ? true : false;
    }
    setInterruptFlag(interrupt) {
        const { flagRegister, flagMask, enableRegister, enableMask } = interrupt;
        if (interrupt.inverseFlag) {
            this.data[flagRegister] &= ~flagMask;
        }
        else {
            this.data[flagRegister] |= flagMask;
        }
        if (this.data[enableRegister] & enableMask) {
            this.queueInterrupt(interrupt);
        }
    }
    updateInterruptEnable(interrupt, registerValue) {
        const { enableMask, flagRegister, flagMask, inverseFlag } = interrupt;
        if (registerValue & enableMask) {
            const bitSet = this.data[flagRegister] & flagMask;
            if (inverseFlag ? !bitSet : bitSet) {
                this.queueInterrupt(interrupt);
            }
        }
        else {
            this.clearInterrupt(interrupt, false);
        }
    }
    queueInterrupt(interrupt) {
        const { address } = interrupt;
        this.pendingInterrupts[address] = interrupt;
        if (this.nextInterrupt === -1 || this.nextInterrupt > address) {
            this.nextInterrupt = address;
        }
        if (address > this.maxInterrupt) {
            this.maxInterrupt = address;
        }
    }
    clearInterrupt({ address, flagRegister, flagMask }, clearFlag = true) {
        if (clearFlag) {
            this.data[flagRegister] &= ~flagMask;
        }
        const { pendingInterrupts, maxInterrupt } = this;
        if (!pendingInterrupts[address]) {
            return;
        }
        pendingInterrupts[address] = null;
        if (this.nextInterrupt === address) {
            this.nextInterrupt = -1;
            for (let i = address + 1; i <= maxInterrupt; i++) {
                if (pendingInterrupts[i]) {
                    this.nextInterrupt = i;
                    break;
                }
            }
        }
    }
    clearInterruptByFlag(interrupt, registerValue) {
        const { flagRegister, flagMask } = interrupt;
        if (registerValue & flagMask) {
            this.data[flagRegister] &= ~flagMask;
            this.clearInterrupt(interrupt);
        }
    }
    addClockEvent(callback, cycles) {
        const { clockEventPool } = this;
        cycles = this.cycles + Math.max(1, cycles);
        const maybeEntry = clockEventPool.pop();
        const entry = maybeEntry !== null && maybeEntry !== void 0 ? maybeEntry : { cycles, callback, next: null };
        entry.cycles = cycles;
        entry.callback = callback;
        let { nextClockEvent: clockEvent } = this;
        let lastItem = null;
        while (clockEvent && clockEvent.cycles < cycles) {
            lastItem = clockEvent;
            clockEvent = clockEvent.next;
        }
        if (lastItem) {
            lastItem.next = entry;
            entry.next = clockEvent;
        }
        else {
            this.nextClockEvent = entry;
            entry.next = clockEvent;
        }
        return callback;
    }
    updateClockEvent(callback, cycles) {
        if (this.clearClockEvent(callback)) {
            this.addClockEvent(callback, cycles);
            return true;
        }
        return false;
    }
    clearClockEvent(callback) {
        let { nextClockEvent: clockEvent } = this;
        if (!clockEvent) {
            return false;
        }
        const { clockEventPool } = this;
        let lastItem = null;
        while (clockEvent) {
            if (clockEvent.callback === callback) {
                if (lastItem) {
                    lastItem.next = clockEvent.next;
                }
                else {
                    this.nextClockEvent = clockEvent.next;
                }
                if (clockEventPool.length < 10) {
                    clockEventPool.push(clockEvent);
                }
                return true;
            }
            lastItem = clockEvent;
            clockEvent = clockEvent.next;
        }
        return false;
    }
    tick() {
        const { nextClockEvent } = this;
        if (nextClockEvent && nextClockEvent.cycles <= this.cycles) {
            nextClockEvent.callback();
            this.nextClockEvent = nextClockEvent.next;
            if (this.clockEventPool.length < 10) {
                this.clockEventPool.push(nextClockEvent);
            }
        }
        const { nextInterrupt } = this;
        if (this.interruptsEnabled && nextInterrupt >= 0) {
            const interrupt = this.pendingInterrupts[nextInterrupt];
            avrInterrupt(this, interrupt.address);
            if (!interrupt.constant) {
                this.clearInterrupt(interrupt);
            }
        }
    }
}
