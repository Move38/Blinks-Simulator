# Blinks Playground

Write code for [Blinks](https://move38.com) in C or with Scratch-style blocks, and watch it run on simulated Blinks right in your browser. **[Open the playground](https://move38.github.io/Blinks-Simulator/)**

- **Code or blocks.** Switch between the C code you'd load onto a Blink and a block editor. Changes in one show up in the other.
- **Live.** Your sketch recompiles and restarts as you type, so you see every change right away.
- **Faithful to the hardware.** The simulator compiles your sketch the way the Blinks SDK does and emulates blinklib and the Blink's BIOS, so code that works here should work on real Blinks.
- **Examples** to learn from: ten short lessons, the ten [Blinks Arcade](https://blinksarcade.jonbobrow.com) games, Move38's games and the SDK examples.

## Using the table

| | |
| --- | --- |
| Press a Blink's center | press its button (hold for long presses) |
| Drag a Blink's rim | move it; drop it on the bin to remove it |
| Right-click, or <kbd>R</kbd> | rotate a Blink (real Blinks can face any way) |
| Double-click the table | add a Blink |
| <kbd>Space</kbd> | press the button of the last Blink you touched |
| Hover a Blink | see what each face sends and hears |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> | run |

The face button under the table shows face numbers and the value each face is sending. Pause and step through time, or slow it down, from the controls on the right.

## How close is it to a real Blink?

Your sketch runs through a small C++ compiler written for this project (`js/compiler`). It targets the Blink's ATmega168PB the way avr-gcc does, and every Blink gets its own 64 KB of simulated memory:

- `int` is 16 bits, `long` is 32, `float` and `double` are both 32-bit floats, and arithmetic overflows the same way.
- Structs, unions and bitfields use the AVR layout, so `sizeof`, pointer casts and datagrams of structs work as on hardware. Arduino's `min()`, `max()`, `abs()` and friends are the real macros.
- The button follows the BlinkBIOS state machine: 20 ms debounce, a 330 ms click window, long press at 1.2 s. Holding a Blink that is alone for 3 s shares its game, and 6 s puts the group to sleep.
- IR follows blinklib: faces ping-pong values, probe every 150 ms when alone, and expire 200 ms after the last message. `getLastValueReceivedOnFace()` keeps its old value, and an unread datagram blocks the next one.
- `random()` is blinklib's xorshift with the same seed on every Blink until `randomize()` is called, which takes about half a second, just like hardware.
- Colors are 5 bits per channel, `millis()` is frozen for the whole of `loop()`, and Blinks warm-sleep after 10 minutes without a button press.
- Printing works as with a dev cable: `#include "Serial.h"`, declare `ServicePortSerial Serial;`, call `Serial.begin()`, and the output shows in the console.

The simulator also tells you about things that would go wrong on a Blink: compile errors, `delay()` (Blinks don't have it), a loop that never ends, an array index out of range, face numbers above 5, and globals that won't fit in the ~330 bytes of RAM blinklib leaves for your sketch.

Not simulated: the IR transfer time and collisions of real infrared, flash size limits, and multi-file sketches (paste headers into the sketch).

## Run locally

It's a static site with no build step:

```sh
npm start          # or: python3 tools/serve.py 8000
# then open http://localhost:8000
```

Run the compiler and simulator tests with `npm test` (Node 20+).

## Project layout

```
index.html, css/            the page
js/app.js                   wires the editor, compiler, simulation and console together
js/compiler/                preprocessor, parser, type checker and code generator (C++ -> JS)
js/runtime/blink.js         one Blink: blinklib + BIOS emulation
js/runtime/world.js         the table: hex grid, IR links, time
js/ui/                      board rendering, code editor, block editor, console
examples/                   example sketches (.ino)
test/                       semantics tests for the compiler and runtime
```
