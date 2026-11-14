# Hardware-exact toolchain

Downloaded only when the playground's hardware-exact mode is turned on. Rebuild it with `hardware/make-toolchain.mjs`.

- `cc1plus` (GCC 7.3.0) and `avr-as`, `avr-ld`, `avr-objcopy` (GNU binutils 2.42), built for WebAssembly by
  [@horang-corp/avr-gcc-wasm](https://github.com/horang-corp/avr-gcc-wasm) 0.2.0. GNU GPL v3 or later. Source:
  [GCC](https://gcc.gnu.org/), [binutils](https://www.gnu.org/software/binutils/), and the build scripts in that repository.
- `blinks.pack.gz` holds:
  - GCC's headers and `libgcc.a` (GPL v3 with the GCC Runtime Library Exception)
  - avr-libc's headers and libraries (BSD-style license)
  - blinklib, its link scripts and the BlinkBIOS images from the Move38 SDK 1.3.0
    ([bigjosh/Move38-Arduino-Platform](https://github.com/bigjosh/Move38-Arduino-Platform); see LICENSE-Move38-SDK.txt), with
    blinklib compiled for the ATmega168PB and ATmega328PB
  - Custom Blinklib 1.4.3's blinklib, link script and BlinkBIOS image
    ([brunoga/blinklib](https://github.com/brunoga/blinklib); see LICENSE-Custom-Blinklib.txt), with blinklib
    compiled for the ATmega168PB
