# Hardware-exact Blinks

The playground's hardware-exact mode (the chip button under the table) runs each Blink as real hardware: an emulated AVR running the BlinkBIOS, blinklib and the sketch as machine code, with the sketch compiled in the browser by avr-gcc. The playground's default engine emulates the *software stack* in JavaScript instead (see [docs/SIMULATION.md](../docs/SIMULATION.md)).

The real BIOS checks the battery, switches up to 8 MHz, copies the game into place with `SPM` and starts it. Pixels light, the button works, and Blinks talk to each other over emulated IR, with no Blinks-specific behavior written in JavaScript. One core of an M1 Max runs about **7 Blinks at real speed**.

The mode itself lives in [js/hardware](../js/hardware):

| File | |
| --- | --- |
| `blink-avr.js` | one Blink: avr8js plus what a Blink adds (below) |
| `world.js` | `HardwareWorld`, the table: the same interface as the simulator's `World`, so the board, inspector and debug views work on it |
| `build.js`, `sketch.js`, `elf.js` | building a sketch without the gcc driver, the `.ino` → `.cpp` step, and reading the result |
| `tools.js`, `compile-worker.js`, `toolchain.js` | avr-gcc in WebAssembly, run in a worker, and the page's side of it |
| `toolchain/` | what the browser downloads, built by `make-toolchain.mjs` |
| `vendor/avr8js/` | [avr8js](https://github.com/wokwi/avr8js) 0.21.1 with `.js` added to its imports, by `vendor-avr8js.mjs` |

This folder holds how it was built and tested:

```sh
cd hardware
npm install
npm test            # boots every board, checks IR, the speedups, and that WebAssembly builds match the IDE's
npm run bench       # how many Blinks run at real speed on this machine
npm run profile     # where a Blink's cycles go
npm run toolchain   # rebuild js/hardware/toolchain (needs the Arduino IDE's avr-gcc and the Move38 SDK 1.3.0)
npm run vendor      # re-copy avr8js into js/hardware/vendor
```

The tests that need nothing installed are in [test/hardware.test.mjs](../test/hardware.test.mjs), with the rest of the playground's.

## Uploading to a real Blink

**Upload to a Blink…** in the menu writes the sketch to a real Blink through a USBtinyISP programmer, over WebUSB ([js/hardware/usbtiny.js](../js/hardware/usbtiny.js)). It does what the Arduino IDE's Upload does for a Blink, `avrdude -B 5 -cusbtiny` with the game and the BIOS:

1. Enter programming mode at a 200 kHz SPI clock, and read the signature to tell a 168PB from a 328PB.
2. Build the sketch for that chip, whether it's one file or a folder of them. **Blink** picks `blink` or `blink328`. **Blink MAX** and **Blink NFC**, under "Beta boards", build for `blink328max` and `blink328nfc`, and refuse a 168PB. A Custom Blinklib sketch builds for the 168PB only, with Custom Blinklib's own BIOS, as its board package does.
3. Check the fuses against boards.txt. If they differ (a fresh chip doesn't jump to the BIOS), it asks before setting them, as Burn Bootloader does.
4. Erase the chip, write each 128-byte page that holds anything, and read the pages back to check them.

It needs Chrome, Edge or Opera, on https or localhost. What the computer needs:

- **macOS, ChromeOS, Android**: nothing.
- **Linux**: the same udev rule avrdude needs. The dialog shows it.
- **Windows**: Chrome can only open a device that uses Windows' WinUSB driver. A USBtiny's driver installer sets up libusb-win32, which the Arduino IDE's avrdude needs instead. So the programmer is switched to WinUSB with [Zadig](https://zadig.akeo.ie) to upload from the browser, and back to libusb-win32 to upload from the IDE. The dialog shows the steps, and opens them when Windows won't give the browser the programmer. Programmer firmware that told Windows to use WinUSB (Microsoft OS descriptors) would make this step unnecessary, but the IDE's avrdude would then need a build that speaks WinUSB, like [mariusgreuel/avrdude](https://github.com/mariusgreuel/avrdude).

[test/usbtiny.test.mjs](../test/usbtiny.test.mjs) runs it against a pretend programmer and chip ([test/fake-usbtiny.mjs](../test/fake-usbtiny.mjs)), including the ways Windows and Linux refuse it.

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
- **`SPM`**, so the BIOS can copy the game into place, and write games downloaded from a neighbor.
- **IVSEL**: the BIOS moves the interrupt vectors into the boot section.
- **PORTE**, which only the PB chips have. It carries two pixel anodes and the blue LED's charge pump.
- **`SLEEP`**, which skips ahead to the next event.
- **Pixels**: `takeColors()` measures how much of its 2048-cycle PWM phase each color of each pixel was lit on the pixel's latest turn. `HardwareWorld` maps that back through the BIOS's brightness curve (measured: 4/256 at level 0, full from level 30) to the 5-bit color the sketch set.
- **IR**: a lit LED (anode high, cathode low) shines on the facing LED of the Blink it touches. A floating, charged cathode that is in that light discharges and reads 0, just as the BIOS expects. Light is timestamped and arrives one 5 µs slice later, so every pulse lands at the same moment on the receiver's own clock whichever Blink ran first in the slice.
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

## Game sharing

Sharing is the BIOS's own bootloader: SEED, PULL and PUSH packets over IR, with each page written to flash by `SPM`.
- **Starting.** Hold a Blink that is alone. After 3 s it spins blue, and letting go then starts sharing; at 6 s it goes to sleep instead. Put it beside the other Blinks within 5 s.
- **How long.** The BIOS always sends the whole game area, whatever the game's size: 0x1700 bytes on the 168PB, in 184 blocks of 32 bytes. Each block takes about 100 ms of IR, so a pair takes 15 to 20 s.
- **Clocks.** The BIOS's IR timing allows the two clocks to be at most 5% apart (`IR_CLOCK_SPREAD_PCT` in its source). Here sharing works at 6% apart, and at 8% the neighbor never starts downloading. The playground's default drift of ±2% keeps every pair within 4%, but at the slider's ±10% about 4 pairs in 10 can't share.
- **Tested.** `hardware.test.mjs` checks both: a Blink with Spin built in receives Neighbors byte for byte and runs it, with clocks 4% apart, and nothing happens at 8%.

## Not emulated yet, and known issues

- `SPM` erase and write finish instantly (about 4 ms on hardware), and signature-row reads (`SIGRD`) return nothing.
- The NFC chip on BlinkNFC. Its BIOS boots about 100 ms later, probably because it times out looking for the chip.
- GTCCR timer sync. The BIOS uses it to start timers 0 and 2 together.
- Power-down sleep treats timers as if they keep running. Real power-down stops them, so the warm and deep sleep paths need work.
- The battery always reads 3.0 V.
- IR light is all or nothing between touching faces: no ambient light, no distance or angle, and no light leaking to the faces next door.

## Compiling in the browser

Real Blinks games are built with avr-gcc 7.3.0, so the browser uses the same compiler, built for WebAssembly, rather than clang. A browser can't run the `avr-gcc` driver, because it starts other programs. So [build.js](../js/hardware/build.js) does the driver's job itself:

1. Run `cc1plus` on blinklib and the sketch. These are the same flags the Move38 platform uses, minus LTO, plus `-fno-rtti` and the defines the device specs would add. A sketch folder is built as the IDE builds it ([sketch.js](../js/hardware/sketch.js)): its `.ino` tabs joined into one file with prototypes, then each `.cpp` file in its folder and under `src/` on its own. `.c` files are refused, since there's no C compiler here.
2. Run `cc1plus -E -lang-asm` on `startup.S`.
3. Run `as`, then `ld` with the SDK's link script and `-nostartfiles` layout, then `objcopy` to the built-in address.
4. Lay the BlinkBIOS over the result.

Every path is on a virtual file system, so the same steps run with either set of tools:
- [native-tools.mjs](native-tools.mjs) uses the Arduino IDE's avr-gcc 7.3.0.
- [js/hardware/tools.js](../js/hardware/tools.js) uses avr-gcc 7.3.0 and binutils 2.42 built for WebAssembly by [@horang-corp/avr-gcc-wasm](https://github.com/horang-corp/avr-gcc-wasm) 0.2.0. Each tool is compiled once and gets a fresh instance per run. [wasm-tools.mjs](wasm-tools.mjs) loads it in Node, either from the package or from the toolchain the browser downloads.

`-fno-rtti` is needed because without LTO, classes with virtual methods, like `Serial`, need type info from a C++ runtime that isn't linked.

### Results, for all 46 of the playground's examples

| | |
| --- | --- |
| WebAssembly vs native avr-gcc | **45 of 46 byte-identical.** Widgets differs by 11 bytes in one function, where `r28` and `r29` swap and one `mov` moves: the same length and timing. |
| Size without LTO | Between 619 bytes smaller and 225 bytes bigger than the IDE's build. None goes over 5888 bytes, but SpeedRacer reaches 5884. |
| Running | Every one boots on an emulated Blink and keeps its interrupts running, and D-SerialTest's serial output comes through. Six start dark, and the IDE's builds of the same six do too. |
| Time per edit | Compiling the sketch, then `as`, `ld` and `objcopy`, with blinklib compiled ahead of time: **36 ms median in Node, about 40 ms in Chrome**. |
| Sketch preprocessing | [sketch.js](../js/hardware/sketch.js) adds `#include <Arduino.h>` and a prototype for each function, as the IDE does. All 46 build to exactly the same game as with arduino-cli's preprocessing. |

### Custom Blinklib

Bruno Albuquerque's [Custom Blinklib](https://github.com/brunoga/blinklib) is its own Arduino platform (`blinklib:avr` 1.4.3): its own blinklib, link script and BIOS (Move38's 1.2.0), C++17, and the 168PB only. Its `platform.local.txt` puts the sketch's `config/` folder on the include path for blinklib too, so a game's `config/blinklib_config.h` changes blinklib itself. The toolchain ships Custom Blinklib's blinklib compiled without a config, and its sources: a game with a config gets blinklib compiled with it, kept for as long as the page is open.

Its BIOS spends ten seconds at power-up looking for a game to download, spinning blue, before it starts the game. The emulator does the same. Hardware-exact mode doesn't run Custom Blinklib games yet, because its debug views only know where Move38's blinklib keeps its state; uploading them works.

### Games that only fit with LTO

The IDE builds Blinks games with link-time optimization, which this toolchain can't do: the WebAssembly package has no `lto1`, and `ld` couldn't load the LTO plugin anyway. Some games only fit with it. Hexxagon, a Custom Blinklib game of 25 files, is 5596 bytes from the IDE and 6580 built file by file, over the 5888-byte limit. So when a game doesn't fit, build.js builds it again as one unit: every file of the sketch and of blinklib `#include`d into one, with `-fwhole-program`. That shrinks Hexxagon to 5632 bytes (5670 with WebAssembly's codegen), and it runs as the IDE's build does. Without `-fwhole-program`, one unit is still 492 bytes over. Sketches that fit build file by file, as before, which keeps errors pointing at the right file and builds fast.

Byte-for-byte, the WebAssembly cc1plus isn't always the IDE's: in Hexxagon, 2 of 25 files compile with different register choices (the IDE's is Atmel's patched gcc 7.3.0, and gcc 7 sorts with the host's `qsort`). The code is equivalent.

### What the browser downloads

Only when hardware-exact mode is turned on, and from then on from the browser's Cache Storage, keyed by the toolchain's hash:

| | gzipped |
| --- | --- |
| `cc1plus.wasm` | 4.3 MB |
| `avr-as`, `avr-ld`, `avr-objcopy` | 1.0 MB |
| their Emscripten glue (`.mjs`) | 0.6 MB, less once the server compresses it |
| `blinks.pack.gz`: headers, libraries (debug info stripped), link scripts, BIOS images, both blinklibs' sources, and them compiled for each chip they build for | 0.4 MB |

The `.wasm` files are stored gzipped and unpacked in the worker with `DecompressionStream`, so the download is the same on any static host, GitHub Pages included. The avr8js engine itself adds about 60 KB, also loaded on demand.

- **Licensing.** The tools are GPL v3; [toolchain/NOTICE.md](../js/hardware/toolchain/NOTICE.md) says where their source is. Building them ourselves in CI, from the package's approach, would remove the dependence on someone else's binaries.
- **LTO.** The WebAssembly build has no `lto1`, so games are compiled without LTO, and one that doesn't fit is built as one unit instead (above). That gets within a few dozen bytes of LTO; a game that fits only by those bytes would need `lto1` added to the WebAssembly build.

## Rebuilding the fixtures

`fixtures/*/build/` holds images built with the Move38 SDK 1.3.0. To rebuild one:

```sh
CLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
"$CLI" compile -b move38:avr:blink --export-binaries fixtures/Spin
```

Use `blink`, `blink328`, `blink328max` or `blink328nfc` as the board. The tests read `faces` and `now` from the Neighbors sketch at fixed addresses (`0x2a1` and `0x3a9`). If blinklib changes, take the new addresses from `avr-nm` on the `.elf`.
