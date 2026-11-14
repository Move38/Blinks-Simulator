// SPDX-License-Identifier: MIT
// Copyright (c) Uri Shaked and contributors
export var ADCReference;
(function (ADCReference) {
    ADCReference[ADCReference["AVCC"] = 0] = "AVCC";
    ADCReference[ADCReference["AREF"] = 1] = "AREF";
    ADCReference[ADCReference["Internal1V1"] = 2] = "Internal1V1";
    ADCReference[ADCReference["Internal2V56"] = 3] = "Internal2V56";
    ADCReference[ADCReference["Reserved"] = 4] = "Reserved";
})(ADCReference || (ADCReference = {}));
export var ADCMuxInputType;
(function (ADCMuxInputType) {
    ADCMuxInputType[ADCMuxInputType["SingleEnded"] = 0] = "SingleEnded";
    ADCMuxInputType[ADCMuxInputType["Differential"] = 1] = "Differential";
    ADCMuxInputType[ADCMuxInputType["Constant"] = 2] = "Constant";
    ADCMuxInputType[ADCMuxInputType["Temperature"] = 3] = "Temperature";
})(ADCMuxInputType || (ADCMuxInputType = {}));
export const atmega328Channels = {
    0: { type: ADCMuxInputType.SingleEnded, channel: 0 },
    1: { type: ADCMuxInputType.SingleEnded, channel: 1 },
    2: { type: ADCMuxInputType.SingleEnded, channel: 2 },
    3: { type: ADCMuxInputType.SingleEnded, channel: 3 },
    4: { type: ADCMuxInputType.SingleEnded, channel: 4 },
    5: { type: ADCMuxInputType.SingleEnded, channel: 5 },
    6: { type: ADCMuxInputType.SingleEnded, channel: 6 },
    7: { type: ADCMuxInputType.SingleEnded, channel: 7 },
    8: { type: ADCMuxInputType.Temperature },
    14: { type: ADCMuxInputType.Constant, voltage: 1.1 },
    15: { type: ADCMuxInputType.Constant, voltage: 0 },
};
const fallbackMuxInput = {
    type: ADCMuxInputType.Constant,
    voltage: 0,
};
export const adcConfig = {
    ADMUX: 0x7c,
    ADCSRA: 0x7a,
    ADCSRB: 0x7b,
    ADCL: 0x78,
    ADCH: 0x79,
    DIDR0: 0x7e,
    adcInterrupt: 0x2a,
    numChannels: 8,
    muxInputMask: 0xf,
    muxChannels: atmega328Channels,
    adcReferences: [
        ADCReference.AREF,
        ADCReference.AVCC,
        ADCReference.Reserved,
        ADCReference.Internal1V1,
    ],
};
// Register bits:
const ADPS_MASK = 0x7;
const ADIE = 0x8;
const ADIF = 0x10;
const ADSC = 0x40;
const ADEN = 0x80;
const MUX_MASK = 0x1f;
const ADLAR = 0x20;
const MUX5 = 0x8;
const REFS2 = 0x8;
const REFS_MASK = 0x3;
const REFS_SHIFT = 6;
export class AVRADC {
    constructor(cpu, config) {
        this.cpu = cpu;
        this.config = config;
        /**
         * ADC Channel values, in voltage (0..5). The number of channels depends on the chip.
         *
         * Changing the values here will change the ADC reading, unless you override onADCRead() with a custom implementation.
         */
        this.channelValues = new Array(this.config.numChannels);
        /** AVCC Reference voltage */
        this.avcc = 5;
        /** AREF Reference voltage */
        this.aref = 5;
        /**
         * Invoked whenever the code performs an ADC read.
         *
         * The default implementation reads the result from the `channelValues` array, and then calls
         * `completeADCRead()` after `sampleCycles` CPU cycles.
         *
         * If you override the default implementation, make sure to call `completeADCRead()` after
         * `sampleCycles` cycles (or else the ADC read will never complete).
         */
        this.onADCRead = (input) => {
            var _a;
            // Default implementation
            let voltage = 0;
            switch (input.type) {
                case ADCMuxInputType.Constant:
                    voltage = input.voltage;
                    break;
                case ADCMuxInputType.SingleEnded:
                    voltage = (_a = this.channelValues[input.channel]) !== null && _a !== void 0 ? _a : 0;
                    break;
                case ADCMuxInputType.Differential:
                    voltage =
                        input.gain *
                            ((this.channelValues[input.positiveChannel] || 0) -
                                (this.channelValues[input.negativeChannel] || 0));
                    break;
                case ADCMuxInputType.Temperature:
                    voltage = 0.378125; // 25 celcius
                    break;
            }
            const rawValue = (voltage / this.referenceVoltage) * 1024;
            const result = Math.min(Math.max(Math.floor(rawValue), 0), 1023);
            this.cpu.addClockEvent(() => this.completeADCRead(result), this.sampleCycles);
        };
        this.converting = false;
        this.conversionCycles = 25;
        // Interrupts
        this.ADC = {
            address: this.config.adcInterrupt,
            flagRegister: this.config.ADCSRA,
            flagMask: ADIF,
            enableRegister: this.config.ADCSRA,
            enableMask: ADIE,
        };
        cpu.writeHooks[config.ADCSRA] = (value, oldValue) => {
            var _a;
            if (value & ADEN && !(oldValue & ADEN)) {
                this.conversionCycles = 25;
            }
            cpu.data[config.ADCSRA] = value;
            cpu.updateInterruptEnable(this.ADC, value);
            if (!this.converting && value & ADSC) {
                if (!(value & ADEN)) {
                    // Special case: reading while the ADC is not enabled should return 0
                    this.cpu.addClockEvent(() => this.completeADCRead(0), this.sampleCycles);
                    return true;
                }
                let channel = this.cpu.data[this.config.ADMUX] & MUX_MASK;
                if (cpu.data[config.ADCSRB] & MUX5) {
                    channel |= 0x20;
                }
                channel &= config.muxInputMask;
                const muxInput = (_a = config.muxChannels[channel]) !== null && _a !== void 0 ? _a : fallbackMuxInput;
                this.converting = true;
                this.onADCRead(muxInput);
                return true; // don't update
            }
        };
    }
    completeADCRead(value) {
        const { ADCL, ADCH, ADMUX, ADCSRA } = this.config;
        this.converting = false;
        this.conversionCycles = 13;
        if (this.cpu.data[ADMUX] & ADLAR) {
            this.cpu.data[ADCL] = (value << 6) & 0xff;
            this.cpu.data[ADCH] = value >> 2;
        }
        else {
            this.cpu.data[ADCL] = value & 0xff;
            this.cpu.data[ADCH] = (value >> 8) & 0x3;
        }
        this.cpu.data[ADCSRA] &= ~ADSC;
        this.cpu.setInterruptFlag(this.ADC);
    }
    get prescaler() {
        const { ADCSRA } = this.config;
        const adcsra = this.cpu.data[ADCSRA];
        const adps = adcsra & ADPS_MASK;
        switch (adps) {
            case 0:
            case 1:
                return 2;
            case 2:
                return 4;
            case 3:
                return 8;
            case 4:
                return 16;
            case 5:
                return 32;
            case 6:
                return 64;
            case 7:
            default:
                return 128;
        }
    }
    get referenceVoltageType() {
        var _a;
        const { ADMUX, adcReferences } = this.config;
        let refs = (this.cpu.data[ADMUX] >> REFS_SHIFT) & REFS_MASK;
        if (adcReferences.length > 4 && this.cpu.data[ADMUX] & REFS2) {
            refs |= 0x4;
        }
        return (_a = adcReferences[refs]) !== null && _a !== void 0 ? _a : ADCReference.Reserved;
    }
    get referenceVoltage() {
        switch (this.referenceVoltageType) {
            case ADCReference.AVCC:
                return this.avcc;
            case ADCReference.AREF:
                return this.aref;
            case ADCReference.Internal1V1:
                return 1.1;
            case ADCReference.Internal2V56:
                return 2.56;
            default:
                return this.avcc;
        }
    }
    get sampleCycles() {
        return this.conversionCycles * this.prescaler;
    }
}
