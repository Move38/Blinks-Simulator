# Blinks Playground

Write code for [Blinks](https://move38.com) in C or with Scratch-style blocks, and watch it run on simulated Blinks right in your browser. **[Open the playground](https://learn.move38.com/play/)**

New to programming? **[Light the Board](https://learn.move38.com/)** teaches it with Blinks, one level at a time, on the same simulated Blinks: six worlds of levels with live checks, hints, and a map that lights up as you go.

- **Code or blocks.** Switch between the C code you'd load onto a Blink and a block editor. Changes in one show up in the other. Blocks cover light (named colors or your own red/green/blue mix), the button, neighbors (values and datagrams), timers, math, bits (shifts and masks, drawn as a strip of bits), logic, switch, variables (global or local), lists (C arrays, including lists of timers), grids (2D arrays, shown row by row), constants (#define and enum) and your own functions; anything else stays as editable C.
- **Live.** Your sketch recompiles and restarts as you type, so you see every change right away.
- **Faithful to the hardware.** The simulator compiles your sketch the way the Blinks SDK does and emulates blinklib and the Blink's BIOS, so code that works here should work on real Blinks.
- **Hardware-exact mode.** The chip button under the table goes further. avr-gcc, the compiler the Arduino IDE uses for Blinks, compiles your sketch in the browser, and every Blink becomes an emulated ATmega168PB running the real BlinkBIOS and blinklib. Timing, IR and sleep are the real firmware's, and the console shows the flash and RAM the game really uses. It downloads about 6 MB the first time it's turned on, and nothing until then.
- **Upload to a Blink.** With a USBtinyISP programmer, ⋯ → Upload to a Blink… builds your sketch with avr-gcc and writes it, with the BlinkBIOS, to a real Blink, as the Arduino IDE's Upload does. It works for sketches of one file or several, on Move38's blinklib or Custom Blinklib, for 168PB and 328PB Blinks, in Chrome, Edge or Opera. On Windows the programmer needs the WinUSB driver first; the dialog shows how.
- **Examples** to learn from: ten short lessons, ten one-Blink games from the [Blinks Arcade](https://blinksarcade.jonbobrow.com), Move38's games and the SDK examples. **Open from GitHub** (in the ⋯ menu or under Examples) loads a sketch from any public repository, folder or .ino link. A sketch folder's tabs and local headers are combined into one file; a bigger one, with .cpp files, a `src/` folder (git submodules too) or a `config/` folder, opens as all its files, in tabs, and is built the way the Arduino IDE builds it.
- **Custom Blinklib.** Games written for Bruno Albuquerque's [Custom Blinklib](https://github.com/brunoga/blinklib), like [Hexxagon](https://github.com/brunoga/blinks-hexxagon), run with its whole-byte face values, datagrams that are resent until they arrive, and the settings in their `config/blinklib_config.h`. The playground picks it when a sketch names it; ⋯ → Blinks library switches.

## Using the table

| | |
| --- | --- |
| Press a Blink's center | press its button (hold for long presses) |
| Drag a Blink's rim | move it; drop it on the bin to remove it |
| Right-click, or <kbd>R</kbd> | rotate a Blink (real Blinks can face any way) |
| Double-click the table | add a Blink |
| <kbd>Space</kbd> | press the button of the last Blink you touched |
| Hover a Blink | see what each face sends and hears (Tooltip debug view) |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> | run |
| <kbd>F</kbd> | full screen: just the table, without the code and console (<kbd>Esc</kbd> comes back) |

The debug button under the table switches between three views: **None**, **Tooltip** (hover a Blink to see what each face sends and hears) and **Comms** (every face's sent value drawn on its rim, orange when a neighbor hears it, plus a bubble with each datagram's bytes that pops into a green check when received or a red X when dropped, and is grey when nobody is there). Pause and step through time, or slow it down, from the controls on the right.

## How close is it to a real Blink?

Your sketch runs through a small C++ compiler written for this project (`js/compiler`). It targets the Blink's ATmega168PB the way avr-gcc does, and every Blink gets its own 64 KB of simulated memory:

- `int` is 16 bits, `long` is 32, `float` and `double` are both 32-bit floats, and arithmetic overflows the same way.
- Structs, unions and bitfields use the AVR layout, so `sizeof`, pointer casts and datagrams of structs work as on hardware. Arduino's `min()`, `max()`, `abs()` and friends are the real macros.
- The button follows the BlinkBIOS state machine: 20 ms debounce, a 330 ms click window, long press at 1.2 s. Holding a Blink that is alone for 3 s shares its game, and 6 s puts the group to sleep with a blue fade that ripples from Blink to Blink; a press wakes them with a white one.
- IR follows blinklib: faces ping-pong values (each taking about 6 ms to cross), probe every 150 ms when alone, and expire 200 ms after the last message. `getLastValueReceivedOnFace()` keeps its old value, and an unread datagram blocks the next one.
- `random()` is blinklib's xorshift with the same seed on every Blink until `randomize()` is called, which takes about half a second, just like hardware.
- `loop()` runs once each time the LEDs finish a frame (7.68 ms, about 130 times a second), and sending IR slows it down, one face after another, as on hardware: a Blink alone runs `loop()` about 110 times a second, and one surrounded by six neighbors about 35.
- Colors are 5 bits per channel, `millis()` is frozen for the whole of `loop()`, and Blinks warm-sleep after 10 minutes without a button press.
- Every Blink keeps its own time. Real Blinks have no crystal, so each clock runs a little fast or slow, and the simulator gives each Blink its own clock speed (±2% by default; the speed menu has a slider to change it). Timers on different Blinks slowly drift apart, as they do on a table.
- Printing works as with a dev cable: `#include "Serial.h"`, declare `ServicePortSerial Serial;`, call `Serial.begin()`, and the output shows in the console.

The simulator also tells you about things that would go wrong on a Blink: compile errors, `delay()` (Blinks don't have it), a loop that never ends, an array index out of range, face numbers above 5, and globals that won't fit in the ~330 bytes of RAM blinklib leaves for your sketch.

IR messages take time to arrive, about 3 ms a byte as on hardware, and datagrams a little longer to make up for the ones a real table loses. Not simulated: collisions and lost messages of real infrared, flash size limits, and multi-file sketches (paste headers into the sketch). [docs/SIMULATION.md](docs/SIMULATION.md) explains how the simulation works and lists every known difference from hardware. Hardware-exact mode closes most of those differences; [hardware/README.md](hardware/README.md) explains how it works and what it doesn't emulate yet.

## Run locally

It's a static site with no build step:

```sh
npm start          # or: python3 tools/serve.py 8000
# then open http://localhost:8000 (Light the Board) or http://localhost:8000/play/
```

Run the compiler and simulator tests with `npm test` (Node 20+).

## Project layout

```
index.html                  Light the Board, the learning path (js/learn/, css/learn.css)
play/index.html, css/       the playground
js/app.js                   wires the editor, compiler, simulation and console together
js/learn/                   the learning path: its levels (worlds/), checks run on hidden Blinks, the map
js/compiler/                preprocessor, parser, type checker and code generator (C++ -> JS)
js/compiler/sdk.js          the blinklibs a sketch can be built against (Move38's, Custom Blinklib)
js/runtime/blink.js         one Blink: blinklib + BIOS emulation
js/runtime/world.js         the table: hex grid, IR links, time
js/ui/                      board rendering, code editor, block editor, console
js/hardware/                hardware-exact mode: avr-gcc in a worker, the emulated chip, its table
js/hardware/toolchain/      what that mode downloads (built by hardware/make-toolchain.mjs)
hardware/                   how hardware-exact mode was built and tested, and the tools to rebuild it
examples/                   example sketches (.ino)
test/                       tests for the compiler, the runtime, hardware-exact mode and every level
```
