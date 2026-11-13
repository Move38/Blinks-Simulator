# Hardware-exact Blinks (spike)

This folder tests whether the playground could run each Blink as real hardware: an emulated AVR running the same `.hex` the Arduino IDE flashes, with the BlinkBIOS, blinklib and the sketch all running as machine code. The main playground emulates the *software stack* in JavaScript instead (see [docs/SIMULATION.md](../docs/SIMULATION.md)).

**Result: it works.** The real BIOS checks the battery, switches up to 8 MHz, copies the game into place with `SPM` and starts it. Pixels light, the button works, and Blinks talk to each other over emulated IR, with no Blinks-specific behavior written in JavaScript. One core of an M1 Max runs about **7 Blinks at real speed**.

```sh
cd hardware
npm install
npm test          # boots every board, checks IR, and checks the speedups change nothing
npm run bench     # how many Blinks run at real speed on this machine
npm run profile   # where a Blink's cycles go
```

## Chips and BIOS versions

Blinks have shipped on two chips. The newer BIOS in SDK 1.3.0 ([bigjosh/Move38-Arduino-Platform](https://github.com/bigjosh/Move38-Arduino-Platform)) supports both, and the spike runs all four of its boards:

| Board (`move38:avr:…`) | Chip | Game size | Boot section | Notes |
| --- | --- | --- | --- | --- |
| `blink` | ATmega168PB, 16 KB flash, 1 KB RAM | 5888 B | 0x3800 (efuse 0xF8) | The original Blinks |
| `blink328` | ATmega328PB, 32 KB flash, 2 KB RAM | 5888 B | 0x7000 (hfuse 0xD8) | |
| `blink328max` | ATmega328PB | 7936 B | 0x7000 | `isMAXblink()` |
| `blink328nfc` | ATmega328PB | 7936 B | 0x7000 | `isNFCblink()`, `saveGameStat()` |

The 1.3.0 SDK also adds `getBlinkbiosVersion()` and `gamestat.h`. Games call these features through the BIOS's version vector, so emulating the real BIOS gets them without any extra work. A 168PB and a 328PB on the same table talk to each other normally.

On every board, the BIOS lives at the top of flash. The `.hex` puts the game in the "built-in" area (0x1700 on the 168PB, 0x3900 on the 328PB), and at reset the BIOS copies it down to 0x0000 and jumps there.

## What `blink-avr.js` adds to avr8js

[avr8js](https://github.com/wokwi/avr8js) (MIT) provides the CPU, timers, ports, ADC, USART, EEPROM and watchdog. A Blink needs more than an Arduino Uno does:

- **Boot**: reset starts at the boot section (the BOOTRST fuse) at 1 MHz (CKDIV8).
- **`SPM`**, so the BIOS can copy the game into place. Later it could also write games downloaded from a neighbor.
- **IVSEL**: the BIOS moves the interrupt vectors into the boot section.
- **PORTE**, which only the PB chips have. It carries two pixel anodes and the blue LED's charge pump.
- **`SLEEP`**, which skips ahead to the next event.
- **Pixels**: `takeColors()` adds up how long each pixel's anode is high while each color's PWM sink is low, which is roughly what an eye or camera sees.
- **IR**: a lit LED (anode high, cathode low) shines on the facing LED of the Blink it touches. A floating, charged cathode that is in that light discharges and reads 0, just as the BIOS expects. Light is timestamped, so each Blink sees it at the right moment on its own clock.
- **A clock per Blink** (`clockScale`), so timing drifts between Blinks as it does on a real table.

## Speed

Measured on an Apple M1 Max, one core, Node 22. "×" is how fast the table runs compared with real time:

| Blinks | plain avr8js | with the two speedups below |
| --- | --- | --- |
| 1 | 4.2× | 8.0× |
| 6 | 0.55× | 1.2× |
| 12 | 0.26× | 0.59× |
| 24 | 0.13× | 0.29× |

A Blink spends 99% of its cycles in the BIOS, and much of that is waiting: about 40% waiting for vertical blank, 8% waiting for an IR send to finish, and 15% in an ISR polling a timer. Two speedups help:

- **Lazy timers.** avr8js schedules an event on every timer tick, every 8 cycles for the pixel timers. `LazyTimer` sleeps until the next compare match or overflow, and catches up whenever the firmware touches the timer. That makes it about 2× faster.
- **Idle-loop skipping.** If a short loop goes round with the same registers, stores nothing and reads no live register, nothing can change until the next event. So the CPU jumps ahead by whole rounds. That gives another 10–20%.

Both are **exact**. A test runs two Blinks talking over IR with and without them and checks that every RAM byte, register and cycle count matches.

The rest of the time is split about evenly between avr8js's instruction decoder (a long `if` chain) and the run loop. A lookup table for decoding, or compiling basic blocks to JavaScript, is the next likely 2–4×.

## Bugs found along the way

- avr8js's `tick()` runs one clock event per instruction and removes it from the queue *after* running it, which loses any event the callback reschedules. We run every due event and remove each one first.
- A timer that catches up across a whole period in one step misses its compare match. The lazy timer stops at each event on the way.
- Interrupts must be redirected to the boot-section vectors at the moment they're taken. Our first attempt checked for a PC change afterward. When an interrupt arrived with the PC already at its vector's address (Timer0 overflow is word 0x20, and byte 0x40 is inside the game's `setColor()`), the redirect didn't happen. The Blink then ran game code as its ISR and hung with interrupts off after about 9 seconds.

## Collisions

IR collisions come from the firmware itself. In a line of six Blinks with clocks up to 2% apart, a link sometimes drops for about 150 ms, when both ends probe at once and keep colliding for a few rounds, then comes back. We haven't checked whether real Blinks drop at the same rate.

## Not emulated yet

- `SPM` erase and write finish instantly (about 4 ms on hardware), and signature-row reads (`SIGRD`) return nothing.
- The NFC chip on BlinkNFC. Its BIOS boots about 100 ms later, probably because it times out looking for the chip.
- GTCCR timer sync. The BIOS uses it to start timers 0 and 2 together.
- Power-down sleep treats timers as if they keep running. Real power-down stops them, so the warm and deep sleep paths need work.
- The battery always reads 3.0 V.
- IR light is all or nothing between touching faces: no ambient light, no distance or angle, and no light leaking to the faces next door.

## Getting this into the playground

1. **Compiling in the browser with avr-gcc built for WebAssembly.** This is the chosen path. Real Blinks games are built with avr-gcc 7.3.0, so this produces the same code, which clang wouldn't. See [Compiling in the browser](#compiling-in-the-browser) below.
2. **Speed**: a faster decoder, plus web workers for big tables. IR needs Blinks to stay within a few microseconds of each other, so workers would need to share a slice clock.
3. **The table UI** already has what the hardware model needs: neighbors, a button and LED colors. A "hardware-exact" switch could swap `js/runtime/blink.js` for `AvrBlink` and keep the JavaScript engine for big tables and its learner-friendly errors.

## Compiling in the browser

A browser can't run the `avr-gcc` driver, because it starts other programs. So [build-sketch.mjs](build-sketch.mjs) does the driver's job itself:

1. Run `cc1plus` on blinklib and the sketch. These are the same flags the Move38 platform uses, minus LTO, plus `-fno-rtti` and the defines the device specs would add.
2. Run `cc1plus -E -lang-asm` on `startup.S`.
3. Run `as`, then `ld` with the SDK's link script and `-nostartfiles` layout, then `objcopy` to the built-in address.
4. Lay the BlinkBIOS over the result.

Every path is on a virtual file system, so the same steps run with either set of tools:
- [native-tools.mjs](native-tools.mjs) uses the Arduino IDE's avr-gcc 7.3.0.
- [wasm-tools.mjs](wasm-tools.mjs) uses avr-gcc 7.3.0 and binutils 2.42 built for WebAssembly by [@horang-corp/avr-gcc-wasm](https://github.com/horang-corp/avr-gcc-wasm) 0.2.0. Each tool is compiled once and gets a fresh instance per run.

`-fno-rtti` is needed because without LTO, classes with virtual methods, like `Serial`, need type info from a C++ runtime that isn't linked.

### Results, for all 46 of the playground's examples

| | |
| --- | --- |
| WebAssembly vs native avr-gcc | **45 of 46 byte-identical.** Widgets differs by 11 bytes in one function, where `r28` and `r29` swap and one `mov` moves: the same length and timing. |
| Size without LTO | Between 619 bytes smaller and 225 bytes bigger than the IDE's build. None goes over 5888 bytes, but SpeedRacer reaches 5884. |
| Running | Every one boots on an emulated Blink and keeps its interrupts running, and D-SerialTest's serial output comes through. Six start dark, and the IDE's builds of the same six do too. |
| Time per edit, in Node | Compiling the sketch, then `as`, `ld` and `objcopy`: **42 ms median, 91 ms at most**. Compiling blinklib as well takes about 0.6 s the first time. |

blinklib never changes, so it can be compiled once and shipped as `.o` files. Each edit then only rebuilds the sketch.

### What shipping it needs

- **Download size.** The four tools are 5.4 MB gzipped, or 4.2 MB with brotli; `cc1plus.wasm` alone is 13.2 MB raw and 4.3 MB gzipped. Load them only when the hardware-exact mode is turned on.
- **Files the package lacks.** We would serve the headers, the SDK's blinklib and link scripts, and four files the package doesn't ship: gcc's `include-fixed/limits.h` and `libatmega168pb.a` / `libatmega328pb.a`. For now, wasm-tools.mjs borrows those from the Arduino IDE.
- **Licensing.** The tools are GPL v3, so serving them from learn.move38.com means also offering their source and build scripts. Building them ourselves from the package's approach, in CI, would give us both, and wouldn't depend on someone else's binaries.
- **LTO.** The WebAssembly build has no `lto1`, so games are compiled without LTO. That costs code size: SpeedRacer comes within 4 bytes of the limit, so some games may not fit without it. Adding `lto1` to the WebAssembly build, or compiling the sketch and blinklib as one file, would close that gap.
- **Sketch preprocessing.** The tests use arduino-cli's preprocessing, which adds `#include <Arduino.h>` and function prototypes. The playground's own preprocessor would have to do the same.

## Rebuilding the fixtures

`fixtures/*/build/` holds images built with the Move38 SDK 1.3.0. To rebuild one:

```sh
CLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
"$CLI" compile -b move38:avr:blink --export-binaries fixtures/Spin
```

Use `blink`, `blink328`, `blink328max` or `blink328nfc` as the board. The tests read `faces` and `now` from the Neighbors sketch at fixed addresses (`0x2a1` and `0x3a9`). If blinklib changes, take the new addresses from `avr-nm` on the `.elf`.
