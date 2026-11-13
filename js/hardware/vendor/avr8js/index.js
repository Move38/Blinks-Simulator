// SPDX-License-Identifier: MIT
// Copyright (c) Uri Shaked and contributors
export { CPU } from './cpu/cpu.js';
export { avrInstruction } from './cpu/instruction.js';
export { avrInterrupt } from './cpu/interrupt.js';
export { ADCMuxInputType, ADCReference, AVRADC, adcConfig, atmega328Channels, } from './peripherals/adc.js';
export { AVRClock, clockConfig } from './peripherals/clock.js';
export { AVREEPROM, EEPROMMemoryBackend, eepromConfig } from './peripherals/eeprom.js';
export { AVRIOPort, INT0, INT1, PCINT0, PCINT1, PCINT2, PinState, portAConfig, portBConfig, portCConfig, portDConfig, portEConfig, portFConfig, portGConfig, portHConfig, portJConfig, portKConfig, portLConfig, } from './peripherals/gpio.js';
export { AVRSPI, spiConfig } from './peripherals/spi.js';
export { AVRTimer, timer0Config, timer1Config, timer2Config } from './peripherals/timer.js';
export { ATtinyTimer1, attinyTimer1Config } from './peripherals/timer-attiny.js';
export * from './peripherals/twi.js';
export { AVRUSART, usart0Config } from './peripherals/usart.js';
export { AVRUSI } from './peripherals/usi.js';
export { AVRWatchdog, watchdogConfig } from './peripherals/watchdog.js';
