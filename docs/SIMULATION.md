# How the simulator works

This document explains how the Blinks Playground runs a sketch on simulated Blinks. It also lists where the simulator differs from real hardware. It is meant for anyone changing the runtime or the compiler, or deciding how far to trust a result from the playground.

The playground is an **emulator of the software stack**, not of the chip. A sketch is compiled to JavaScript that follows AVR C++ rules. It then runs against a JavaScript copy of blinklib and the BlinkBIOS. The ATmega168PB's instructions, cycles, interrupts and IR hardware are not emulated. Because of that, anything a game does through the Blinks API behaves like hardware. Anything that depends on how *long* things take on the real chip does not.

The reference for blinklib behavior is the Move38 SDK 1.2.0 (`blinklib.cpp`, `blinklib.h`, `shared/blinkbios_shared_*.h`), the version Arduino installs as `move38:avr`. The button timings and game sharing come from the BlinkBIOS source (`bigjosh/Move38-BlinkBIOS`, `bootloader.cpp`).

```
 sketch.ino ──► preprocess ──► parse ──► codegen ──► JS factory
                (macros)       (AST)     (AVR types,     │
                                          64 KB RAM)     │ one instance per Blink
                                                         ▼
 page frame loop ──► World.advance(dt) ──► per Blink, per simulated ms:
 (app.js)            (world.js)              tick1ms()  BIOS: button state machine
                                             pass()     blinklib run(): RX, loop(), display, TX
                                          ──► deliver() IR packets to touching faces
```

## 1. Compiling a sketch

[`js/compiler`](../js/compiler) is a small C++ compiler written for this project. `compile(source)` in [index.js](../js/compiler/index.js) runs four stages:

1. **Preprocess** ([preprocess.js](../js/compiler/preprocess.js)). This handles `#define`, `#if`, `#include` and the rest. A built-in prelude copies the macros from the SDK's `Arduino.h` and `blinklib.h`, so `min()`, `abs()`, `FOREACH_FACE()` and the color constants expand exactly as they do on hardware.
2. **Parse** ([lexer.js](../js/compiler/lexer.js), [parser.js](../js/compiler/parser.js)). This builds a typed AST.
3. **Generate** ([codegen.js](../js/compiler/codegen.js)). This turns the AST into JavaScript that gives the same results as avr-gcc output:
   - **Types use AVR sizes** ([types.js](../js/compiler/types.js)):
     - `char`/`byte` are 8 bits, `int` is 16, `long` is 32.
     - `float` and `double` are both 32-bit.
     - Pointers are 16 bits, structs have no padding, and memory is little-endian.
   - Every expression is wrapped to the range of its C type, so overflow, integer promotion and the usual arithmetic conversions match.
   - avr-gcc's `-Os` folding of `(x * C1) / C2` is copied too, because some games rely on it.
   - **Memory.** Each Blink has a 64 KB `Uint8Array` laid out like this:

     | Address | Contents |
     | --- | --- |
     | `0x0100` | 6 × 16 bytes of incoming datagram buffers, written by the runtime |
     | `0x0160` | globals, statics and string literals, in declaration order |
     | after the globals | a 512-byte scratch area for temporaries |
     | from `0xFFF0` | the stack, growing down |

     Anything whose address is taken, plus every array and struct, lives in that memory with AVR layout. Pointers, casts, bitfields, `sizeof`, `memcpy` and datagrams of structs therefore behave as they do on hardware. Plain scalar locals become JS variables, for speed.
   - **Checks.** Every loop back-edge decrements a budget. 3 million iterations in one `setup()` or `loop()` call stops the Blink with "this loop never ends". Array indexes, face numbers, null pointers and division by zero are also checked. They warn and then carry on with the AVR result, or crash the Blink when there is no sensible result.
4. **Build the factory.** The generated code is wrapped in `new Function('env', js)`. Each Blink calls it with its own memory and runtime, so every Blink has separate globals and state.

`compile()` also reports RAM use: user globals against a budget of 1024 − 694 = 330 bytes, the space blinklib and the BIOS leave free.

The API a sketch can call is listed in [builtins.js](../js/compiler/builtins.js). Each entry gives the C signature, so arguments convert as on hardware: a face is a `byte`, so 257 becomes face 1. Pure helpers are ported line for line from blinklib or avr-libc in [rt.js](../js/compiler/rt.js):
- `makeColorHSB`, `dim`, `lighten`, `map`, `sin8_C`
- the xorshift32 behind `random()`
- avr-libc's `rand()`
- AVR division by zero

## 2. One Blink

[`js/runtime/blink.js`](../js/runtime/blink.js) is one Blink. It holds its own RAM, pixel buffers, face state and a running instance of the sketch. It has two entry points, both called by the world.

### `tick1ms()`: the BIOS, once per millisecond of the Blink's own clock

This is the BlinkBIOS button state machine:
- 20 ms debounce, a 330 ms click window and a long press at 1.2 s.
- `BUTTON_BITFLAG_3SECPRESSED` after 3 s and `6SECPRESSED` after 6 s.
- It ORs flags into `btn.bitflags` exactly as the BIOS does into `blinkbios_button_block`.

A mouse click can be shorter than the debounce. `press()` therefore holds the button down for at least 40 ms, about the shortest press a finger makes.

### `pass()`: one trip around blinklib's `run()` loop

This follows `run()` in `blinklib.cpp` step by step:

1. If the 3-second flag is set and the Blink is alone, enter seed mode (game sharing). If the 6-second flag is set, warm sleep.
2. `now = millis`. `millis()` returns this snapshot, so time stands still for the whole of `loop()`, as on hardware.
3. On the first pass, run `setup()`.
4. A button press "virally" postpones warm sleep. The Blink sets a flag to send on all six faces, then locks out for 2 s.
5. **RX** (`rxFaces`). For each face holding a packet:
   - Extend its expire time to now + 200 ms.
   - Set `sendTime = 0`, so this face answers right away. This is how values ping-pong across a link at full speed.
   - Store a value, store a datagram, or start warm sleep if it was a sleep packet.
   - A datagram is accepted only if the last one has been read. Otherwise it is dropped, as on hardware.
6. Snapshot the button. `buttonDown()` and the `button…()` flags read this snapshot and are cleared when read.
7. Run `loop()`.
8. Copy the pixel buffer to the display. On hardware this waits for the LEDs to finish their frame.
9. **TX** (`txFaces`). Every face whose `sendTime` has passed sends one packet: a pending datagram if there is one, otherwise the face value. Then `sendTime = now + 150 ms + face`. The 150 ms is the "probe" when nobody answers; a neighbor's reply resets it to 0.
10. If 10 minutes have passed with no button press, warm sleep.

Other modes take over `pass()`:
- **Warm sleep** fades blue over 30 steps while sending a sleep packet on each face in turn, five times round, then goes dark. `millis()` is saved and restored, so timers don't all expire while asleep.
- Any non-sleep packet or a button press wakes the Blink with a white fade that sends "nop" packets to wake its neighbors in turn.
- **Seed mode** spins blue while the button stays down. Let go before 6 s and the world starts sharing the game.

Randomness is blinklib's: xorshift32 with the same seed on every Blink until `randomize()` is called. `randomize()` takes a fresh seed and pauses the Blink for 512 ms. On hardware that is the time it spends collecting watchdog-timer jitter.

## 3. The table

[`js/runtime/world.js`](../js/runtime/world.js) holds the Blinks on a hex grid and owns simulated time.

**Grid and faces.**
- Blinks sit on flat-top hexes in axial coordinates. `DIRS[d]` is the neighbor offset for direction `d`, clockwise from the top.
- Each Blink has a rotation `rot`, so its face `f` points in direction `(f + rot) % 6`.
- `neighbor(b, f)` looks up the Blink in that direction and returns which of *its* faces touches: `((d + 3) % 6 − n.rot) mod 6`.
- A lifted Blink (being dragged) touches nothing.

**Time** is `advance(dt)`. For every true millisecond:

1. Each Blink adds `1 + clockSkew × drift` to its clock accumulator, and runs `tick1ms()` once for each whole millisecond in it.
   - `clockSkew` is fixed per Blink, between −1 and 1.
   - `drift` is the table-wide setting, ±2% by default.
   - So a Blink with a fast clock occasionally ticks twice in one true millisecond, and a slow one occasionally skips.
2. When its pass is due, a Blink runs one `pass()`, then waits at least one LED frame of its own time (`FRAME_MS`, 7.68 ms) before the next.
   - On hardware, `run()` calls `loop()`, waits for the LEDs to finish the frame they are showing, then sends IR. The BIOS lights one face at a time, five 256 µs steps a face, so a frame is 6 × 5 × 256 µs = 7.68 ms, and `loop()` runs at most ~130 times a second.
   - Sending blocks the chip, one face after another. `passFrames()` adds up the airtime of the packets the pass sent and rounds up to whole frames: one 6 ms value fits in the frame, two spill into a second.
   - Faces without a neighbor only send every 150 ms, while faces with one answer every pass. So a Blink alone, or with one neighbor, runs about 110 passes a second, with 3 neighbors about 85, and surrounded by 6 about 35.
3. After any pass, `deliver()` puts each outgoing packet in flight toward the face it touches, for its **airtime**:
   - Airtime is 3 ms a byte, from the bootloader's figure of 98 ms for a 32-byte block.
   - Every packet starts with the BIOS packet type byte. A face value adds one more byte (6 ms) and a sleep or wake packet two (9 ms).
   - A datagram adds a header byte, its payload and a checksum, and is made half again as slow: 18 ms for 1 byte, 86 ms for 16. Datagrams always get through here, and the slowdown stands in for the ones a real table loses and a game has to send again.
   - A Blink sends on one face after another, so each packet in a pass leaves when the one before it is done.
   - Until a packet lands, neither end of the link sends anything else on that face.
4. When the airtime is up, `land()` puts the packet in the receiver's slot.
   - If the slot is still full, the packet is dropped.
   - If the Blinks were moved apart on the way, it is lost.
   - Each datagram records what happened to it (`ok`, `dropped` or `lost`) for the Comms view.

Each Blink starts with its millisecond counter and frame phase at random offsets, so Blinks never run in lockstep.

**Game sharing** ([seed.js](../js/runtime/seed.js)) follows the bootloader's `download_and_seed_mode()`. It uses links and blocks instead of SEED/PULL/PUSH packets.

- **Searching.** Every Blink in the share seeds one face at a time, clockwise.
  - The root starts at face 0. A downloading Blink starts at the face after the one it downloads from.
  - The face being seeded shows full blue.
  - A face where nobody answers is given up after three tries, about 200 ms. The search therefore looks like a blue face stepping around the Blink.
  - The root doesn't give up on any face for its first 5 s, so it can be put down into a group after being held alone.
- **Downloading.**
  - A Blink there that isn't sharing yet starts downloading, block by block.
  - Both ends of the link show blue stepping up with each block (block × 4, wrapping every 8 blocks).
  - The new Blink starts its own clockwise search right away and passes each block on as soon as it has it. A line of Blinks therefore downloads together, each a block behind the one before, like a game of telephone.
- **Finishing a link.**
  - When a neighbor has the whole game, both ends of the link turn half green. The seeder moves on to its next face, and keeps coming back to check on that neighbor.
  - The link turns full green once the neighbor, and everything past it, is done. The end of a line finishes first, then the green works back toward the root.
- **Starting the game.**
  - When all of the root's faces are done, it starts the game (`startState()` = 1, `WE_ARE_ROOT`).
  - A LETSGO passes out along the links, 50 ms a hop, and each Blink starts with `startState()` = 2 (`DOWNLOAD_SUCCESS`).
- **Stopping.**
  - A press stops sharing on that Blink and passes LETSGO on.
  - A Blink without the whole game shows half red until it is pressed again, then runs the game it already had.
  - A link that goes quiet, for example because a Blink was picked up, is given up after 360 ms. The Blink downloading on it waits until it is pressed.

**The page** ([app.js](../js/app.js), `frame()`) calls `advance()` every animation frame with the elapsed time times the speed setting. One frame covers at most 100 ms. Simulation work is capped at about 12 ms per frame. With too many Blinks or a heavy sketch, simulated time runs slower than real time and the page says so ("Running at 0.6×…"). Simulated time never skips ahead.

## 4. Constants

| Constant | Value | Source |
| --- | --- | --- |
| Button debounce | 20 ms | BlinkBIOS |
| Click window | 330 ms | BlinkBIOS |
| Long press | 1200 ms | BlinkBIOS |
| Seed (share) hold | 3 s, only when alone | BlinkBIOS flag + `run()` |
| IR airtime | 3 ms a byte: value 6 ms, sleep/wake 9 ms | bootloader: 98 ms per 32-byte block |
| Datagram airtime | (bytes + 3) × 3 ms × 1.5: 18–86 ms | **simulator only** (the 1.5) |
| Seed tries per face | 3 (~200 ms a face) | `SEND_TRY_COUNT`, `TIMEOUT_COLD_SEND_MS` |
| Root's first try window | 5 s | `TIMEOUT_ROOT_STARTUP_MS` |
| Game transfer per link | ~2 s (32 blocks of 62 ms) | **simulator only** |
| SEED answer, LETSGO hop | 50 ms | **simulator only** |
| Force-sleep hold | 6 s | BlinkBIOS flag + `run()` |
| Face value range | 0–63 (larger values send 63) | `IR_DATA_VALUE_MAX` |
| Datagram length | ≤ 16 bytes (longer ones are ignored) | `IR_DATAGRAM_LEN` |
| Probe interval | 150 ms + face index | `TX_PROBE_TIME_MS` |
| Neighbor expiry | 200 ms after the last packet | `RX_EXPIRE_TIME_MS` |
| Viral wake lockout | 2 s | `VIRAL_BUTTON_PRESS_LOCKOUT_MS` |
| Warm sleep timeout | 10 min | `WARM_SLEEP_TIMEOUT_MS` |
| Sleep/wake fade | 5 rounds × 6 faces, brightness 200 → 0 | `warm_sleep_cycle()` |
| `randomize()` pause | 512 ms | 32 watchdog ticks of 16 ms |
| LED frame (`loop()` at most once a frame) | 7.68 ms, ~130 Hz | BIOS pixel timer: 6 faces × 5 × 256 µs |
| Sleep relay delay | 50 ms | **simulator only** |
| Clock drift | ±2% (0.5–10% on the slider) | **estimate** |
| User RAM budget | 330 bytes | **estimate** (1024 − 694) |

## 5. Where it differs from real Blinks

The items are ordered roughly by how likely they are to make a game behave differently on a table.

### Timing and speed (the biggest gap)

- **Your code takes no time.**
  - Here `loop()` runs once an LED frame (7.68 ms), more slowly when its IR sends spill over, as on hardware (see [Time](#3-the-table)). Only the sends count, though.
  - On a Blink, the code in `loop()` takes time too. A sketch that does heavy float math, or loops over large arrays, keeps the same pace here but slows down on hardware once a pass takes longer than a frame. Its animations and its replies to neighbors slow with it.
  - Code that counts loop passes as a clock (`if (++frames == 100)`) runs at about the same rate here as on hardware: ~110 passes a second alone, ~35 surrounded. The exact rates on a real Blink haven't been measured.
- **Sending doesn't hold up receiving.** On hardware, the chip is busy while it sends and the BIOS refuses to start a send on a face that is receiving. Here packets in flight and a Blink's own sends don't get in each other's way.
- **Sending never fails.** On hardware, `blinkbios_irdata_send_packet()` refuses to send while that face is receiving, and blinklib retries on the next pass. A pending datagram stays queued until a send succeeds. Here every send goes through on the first try.
- **A long loop is treated as infinite.** 3 million loop iterations in one call stop the Blink with an error. On hardware the loop would eventually finish, after freezing the Blink for seconds.
- **Clock drift is an estimate.** The ±2% default and each Blink's fixed skew are guesses about the internal RC oscillator. Real drift also changes with battery voltage and temperature over time.

### Infrared

- **Links are perfect.**
  - No bit errors, parity failures, checksum failures or collisions are simulated. Real links lose and garble packets, and blinklib silently discards bad ones.
  - The value protocol (face values that resend until they arrive) hides most of this. A game that depends on every datagram arriving exactly once can work here and still fail on hardware.
- **Neighbors are exact.** Two faces are linked only when the Blinks sit on adjacent hexes. On a table, Blinks that are slightly apart or misaligned may still link, may link intermittently, or may (rarely) pick up a nearby face. Links here appear and disappear the instant a Blink is dropped or lifted.
- **The packet format is abstracted.** Packets are JS objects, not bytes. There is no parity bit, viral-button bit or checksum byte on the wire. Their effects (the viral wake flag, dropped datagrams) are modeled directly.

### Memory

- **There are 64 KB instead of 1 KB.**
  - The RAM meter compares globals with the 330-byte budget, but nothing stops a sketch that goes over it.
  - The stack is not counted at all. Deep recursion, large local arrays or long call chains can overflow a real Blink's stack while running fine here. On hardware, the stack watcher halts the Blink with an error code.
  - A runaway recursion is still caught here, much later, as "out of memory".
- **The RAM meter is approximate.**
  - The 694 bytes for the system are an estimate.
  - Every global counts, including `const` scalars that avr-gcc folds away. `PROGMEM` tables and `F("...")` strings also count, though on hardware they live in flash.
  - So the meter tends to over-count for sketches that use those.
- **Uninitialized locals are 0.** On hardware they hold whatever was left on the stack. A sketch that forgets to initialize a local can work here and misbehave on a Blink.
- **Undefined behavior lands differently.**
  - An out-of-range array index warns and then reads or writes the simulator's memory. That memory is laid out differently from avr-gcc's, so the variable that gets clobbered is not the one hardware would clobber.
  - Division by zero returns the AVR result (−1, or the dividend for `%`) and warns.

### Language and toolchain

- `long long` / `int64_t` are 32 bits here (with a warning). They are 64 bits on hardware.
- These features are not supported and give a compile error:
  - templates
  - class inheritance
  - destructors
  - static class members
  - `goto`
  - case ranges
- Direct hardware access is not available: registers, ISRs, `<avr/...>` peripherals. `cli()`/`sei()` do nothing.
- Float math functions use JavaScript's `Math` rounded to 32 bits. Results can differ from avr-libc in the last bit.
- Flash size is not checked. A sketch that runs here may be too big to upload.
- A multi-file sketch has to be combined into one file. Open from GitHub does this for a sketch folder.

### Power, sleep and game sharing

- **Game sharing is faster here.**
  - The order, the colors and the rules for giving up follow the bootloader. The transfer itself is shortened: 32 blocks in about 2 s per link.
  - On hardware a game is 176 blocks of 32 bytes (5.5 KB). Each block takes about 100 ms of IR time, so a link takes roughly 17 s, and the blocks are checked and burned to flash.
  - No blocks are lost or retried.
  - The root also skips the moment it spends copying and checksumming its game before the first SEED.
- **There is no cold sleep.** On hardware, a Blink left in warm sleep long enough is put into deep sleep by the BIOS. After that, only its own button wakes it, and `hasWoken()` reports that wake too. Here a warm-sleeping Blink can always be woken by a neighbor.
- **The sleep wave is slowed.** A Blink put to sleep by a neighbor waits 50 ms before its own fade, so the wave is visible. On hardware the only gap is the time the packets take.
- **There are no batteries.** Low voltage, brown-outs and power-up order aren't modeled. Restart powers every Blink on at once, with up to 40 ms of random offset.

### Display

- **The LED colors are a straight scale.**
  - Each 5-bit channel is scaled linearly to the screen's 0–255.
  - A real Blink drives an RGB LED behind a diffuser. Its brightness isn't linear, its red, green and blue aren't balanced like a screen's, and very dim colors can look off or tinted.
  - Use the simulator for which faces are lit and roughly what color. Check subtle shades and low brightness on hardware.

### Things the simulator adds

These have no hardware equivalent. They exist to help while writing a sketch:
- warnings for out-of-range faces and indexes, division by zero, and a missing `Serial.begin()`
- crash messages
- the debug views
- the 40 ms minimum press

Serial output appears instantly and costs no time. On hardware it goes out over the service port at a fixed baud rate.

## 6. Keeping it faithful

When changing the runtime:
- Compare against `blinklib.cpp` (`run()`, `RX_IRFaces()`, `TX_IRFaces()`, `warm_sleep_cycle()`) in the Move38 SDK.
- Keep the constants in `BIOS` at the top of `blink.js` named after their SDK counterparts.
- Label anything that is simulator-only, as `SLEEP_RELAY_MS` is.

`npm test` runs these checks:
- [semantics.test.mjs](../test/semantics.test.mjs) covers C semantics, including integer widths, promotion, struct layout and the AVR folding rules.
- [examples.test.mjs](../test/examples.test.mjs) compiles every example with no warnings, then runs it for 3 simulated seconds on seven rotated Blinks while pressing their buttons. It fails on any crash.
