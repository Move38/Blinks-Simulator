// SPDX-License-Identifier: MIT
// Copyright (c) Uri Shaked and contributors
// Register bits:
const MCUSR_WDRF = 0x8; //  Watchdog System Reset Flag
const WDTCSR_WDIF = 0x80;
const WDTCSR_WDIE = 0x40;
const WDTCSR_WDP3 = 0x20;
const WDTCSR_WDCE = 0x10; // Watchdog Change Enable
const WDTCSR_WDE = 0x8;
const WDTCSR_WDP2 = 0x4;
const WDTCSR_WDP1 = 0x2;
const WDTCSR_WDP0 = 0x1;
const WDTCSR_WDP210 = WDTCSR_WDP2 | WDTCSR_WDP1 | WDTCSR_WDP0;
const WDTCSR_PROTECT_MASK = WDTCSR_WDE | WDTCSR_WDP3 | WDTCSR_WDP210;
export const watchdogConfig = {
    watchdogInterrupt: 0x0c,
    MCUSR: 0x54,
    WDTCSR: 0x60,
};
export class AVRWatchdog {
    constructor(cpu, config, clock) {
        this.cpu = cpu;
        this.config = config;
        this.clock = clock;
        this.clockFrequency = 128000;
        /**
         * Used to keep track on the last write to WDCE. Once written, the WDE/WDP* bits can be changed.
         */
        this.changeEnabledCycles = 0;
        this.watchdogTimeout = 0;
        this.enabledValue = false;
        this.scheduled = false;
        // Interrupts
        this.Watchdog = {
            address: this.config.watchdogInterrupt,
            flagRegister: this.config.WDTCSR,
            flagMask: WDTCSR_WDIF,
            enableRegister: this.config.WDTCSR,
            enableMask: WDTCSR_WDIE,
        };
        this.checkWatchdog = () => {
            if (this.enabled && this.cpu.cycles >= this.watchdogTimeout) {
                // Watchdog timed out!
                const wdtcsr = this.cpu.data[this.config.WDTCSR];
                if (wdtcsr & WDTCSR_WDIE) {
                    this.cpu.setInterruptFlag(this.Watchdog);
                }
                if (wdtcsr & WDTCSR_WDE) {
                    if (wdtcsr & WDTCSR_WDIE) {
                        this.cpu.data[this.config.WDTCSR] &= ~WDTCSR_WDIE;
                    }
                    else {
                        this.cpu.reset();
                        this.scheduled = false;
                        this.cpu.data[this.config.MCUSR] |= MCUSR_WDRF;
                        return;
                    }
                }
                this.resetWatchdog();
            }
            if (this.enabled) {
                this.scheduled = true;
                this.cpu.addClockEvent(this.checkWatchdog, this.watchdogTimeout - this.cpu.cycles);
            }
            else {
                this.scheduled = false;
            }
        };
        const { WDTCSR } = config;
        this.cpu.onWatchdogReset = () => {
            this.resetWatchdog();
        };
        cpu.writeHooks[WDTCSR] = (value, oldValue) => {
            if (value & WDTCSR_WDCE && value & WDTCSR_WDE) {
                this.changeEnabledCycles = this.cpu.cycles + 4;
                value = value & ~WDTCSR_PROTECT_MASK;
            }
            else {
                if (this.cpu.cycles >= this.changeEnabledCycles) {
                    value = (value & ~WDTCSR_PROTECT_MASK) | (oldValue & WDTCSR_PROTECT_MASK);
                }
                this.enabledValue = !!(value & WDTCSR_WDE || value & WDTCSR_WDIE);
                this.cpu.data[WDTCSR] = value;
            }
            if (this.enabled) {
                this.resetWatchdog();
            }
            if (this.enabled && !this.scheduled) {
                this.cpu.addClockEvent(this.checkWatchdog, this.watchdogTimeout - this.cpu.cycles);
            }
            this.cpu.clearInterruptByFlag(this.Watchdog, value);
            return true;
        };
    }
    resetWatchdog() {
        const cycles = Math.floor((this.clock.frequency / this.clockFrequency) * this.prescaler);
        this.watchdogTimeout = this.cpu.cycles + cycles;
    }
    get enabled() {
        return this.enabledValue;
    }
    /**
     * The base clock frequency is 128KHz. Thus, a prescaler of 2048 gives 16ms timeout.
     */
    get prescaler() {
        const wdtcsr = this.cpu.data[this.config.WDTCSR];
        const value = ((wdtcsr & WDTCSR_WDP3) >> 2) | (wdtcsr & WDTCSR_WDP210);
        return 2048 << value;
    }
}
