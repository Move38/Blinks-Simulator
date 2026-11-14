// Flash a real Blink from the browser through a USBtinyISP programmer, over WebUSB.
// It does what the Arduino IDE's Upload does for a Blink (Move38 platform.txt):
//
//   avrdude -B 5 -p<mcu> -cusbtiny -Uflash:w:<game>.hex -Uflash:w:<BlinkBIOS>.hex
//
// that is: erase the chip, write the game and the BIOS together, and read them back.
// The protocol is avrdude's usbtiny.c: every command is a vendor control transfer,
// and ISP instructions are sent four bytes at a time with USBTINY_SPI.
//
//   const tiny = await UsbTiny.connect();       // asks for the programmer the first time
//   await uploadFlash(tiny, async chip => flashImageFor(chip), { onProgress, confirmFuses });
//
// Works where WebUSB does: Chrome, Edge and Opera on a secure page (https or localhost).

export const USBTINY_FILTER = { vendorId: 0x1781, productId: 0x0c9f };

const REQ = { POWERUP: 5, POWERDOWN: 6, SPI: 7, FLASH_READ: 9, FLASH_WRITE: 10 };
const RESET_LOW = 0, RESET_HIGH = 1;
// -B 5: a 5 µs SPI clock period (200 kHz), the fastest a Blink takes while it runs at 1 MHz
// under reset. Platform.txt says some Blinks wouldn't program at 250 kHz.
const SCK_PERIOD = 5;
const PAGE = 128;   // flash page and USBtiny chunk size, on both chips

// The chips Blinks have shipped on, by signature, and the fuses Burn Bootloader gives
// them (boards.txt). `mask` leaves out fuse bits that don't exist or don't matter, which
// chips read back differently.
export const CHIPS = {
  atmega168pb: { name: 'ATmega168PB', signature: [0x1e, 0x94, 0x15], flashBytes: 0x4000, fuses: { low: 0x62, high: 0xdf, ext: 0xf8 }, mask: { low: 0xff, high: 0xff, ext: 0x07 } },
  atmega328pb: { name: 'ATmega328PB', signature: [0x1e, 0x95, 0x16], flashBytes: 0x8000, fuses: { low: 0x62, high: 0xd8, ext: 0xff }, mask: { low: 0xff, high: 0xff, ext: 0x07 } },
};
export const chipBySignature = (sig) => Object.keys(CHIPS).find((k) => CHIPS[k].signature.every((b, i) => b === sig[i])) ?? null;
export const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');

// `driver`: the computer hasn't let the browser have the programmer (see DRIVER_HELP)
export class UploadError extends Error {
  constructor(message, { driver = false } = {}) { super(message); this.driver = driver; }
}

// Which computer the page is on, for what it takes to let the browser have the programmer:
//   windows  Chrome can only open a device that uses the WinUSB driver. A USBtiny comes with
//            libusb-win32, which the Arduino IDE's avrdude needs, so Zadig switches between them.
//   linux    the same udev rule avrdude needs
//   other    macOS, ChromeOS and Android need nothing
export function hostOS(nav = globalThis.navigator) {
  const p = `${nav?.userAgentData?.platform ?? ''} ${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
  if (/Win/i.test(p)) return 'windows';
  if (/Linux/i.test(p) && !/Android|CrOS/i.test(p)) return 'linux';
  return 'other';
}

export const UDEV_RULE = 'SUBSYSTEM=="usb", ATTR{idVendor}=="1781", ATTR{idProduct}=="0c9f", TAG+="uaccess"';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class UsbTiny {
  constructor(device, os = 'other') { this.device = device; this.os = os; }

  // The programmer this page was already allowed to use, or else the browser's picker.
  // Call it from a click: the picker needs one.
  static async connect(usb = globalThis.navigator?.usb, os = hostOS()) {
    if (!usb) throw new UploadError('Uploading needs a browser with WebUSB: Chrome, Edge or Opera on a computer.');
    const match = (d) => d.vendorId === USBTINY_FILTER.vendorId && d.productId === USBTINY_FILTER.productId;
    let device = (await usb.getDevices()).find(match);
    if (!device) {
      try { device = await usb.requestDevice({ filters: [USBTINY_FILTER] }); }
      catch (e) {
        if (e.name !== 'NotFoundError') throw new UploadError(`The browser couldn't open the programmer: ${e.message}`);
        // on Windows, a programmer without the WinUSB driver may not be listed at all
        throw new UploadError(os === 'windows' ? 'No programmer was chosen. If yours wasn’t in the list, Windows needs to give it the WinUSB driver first.' : 'No programmer was chosen.', { driver: os === 'windows' });
      }
    }
    const tiny = new UsbTiny(device, os);
    await tiny.open();
    return tiny;
  }

  async open() {
    const d = this.device;
    try {
      if (!d.opened) await d.open();
      if (d.configuration === null) await d.selectConfiguration(1);
      // Device-level control transfers don't need an interface, but on Windows Chrome sends them through one
      try { await d.claimInterface(0); } catch (e) { if (this.os === 'windows') throw e; }
    } catch (e) {
      try { await d.close(); } catch { /* fine */ }
      if (this.os === 'windows') throw new UploadError('Windows won’t let the browser use the programmer. It needs the WinUSB driver, which takes a minute to set up once.', { driver: true });
      if (this.os === 'linux' && e.name === 'SecurityError') throw new UploadError('Linux won’t let the browser use the programmer. It needs a udev rule, once.', { driver: true });
      throw new UploadError(`The programmer is busy or blocked (${e.message}). Close the Arduino IDE and any other tab using it, then try again.`);
    }
  }

  async close() {
    try { await this.control(REQ.POWERDOWN, 0, 0); } catch { /* unplugged: fine */ }
    try { await this.device.close(); } catch { /* fine */ }
  }

  // One vendor request, retried as avrdude does: the USBtiny is a low-speed device and drops one now and then
  async transfer(fn) {
    let last;
    for (let tries = 0; tries < 3; tries++) {
      try {
        let timer;
        const r = await Promise.race([fn(), new Promise((_, no) => { timer = setTimeout(() => no(new Error('timed out')), 2000); })]).finally(() => clearTimeout(timer));
        if (r.status === 'ok') return r;
        last = new Error(`USB ${r.status}`);
      } catch (e) {
        if (e.name === 'NotFoundError') throw new UploadError('The programmer was unplugged.');
        last = e;
      }
    }
    throw new UploadError(`The programmer stopped answering (${last.message}).`);
  }

  setup(request, value, index) { return { requestType: 'vendor', recipient: 'device', request, value, index }; }
  control(request, value, index) { return this.transfer(() => this.device.controlTransferIn(this.setup(request, value, index), 0)); }
  async in(request, value, index, length) {
    const r = await this.transfer(() => this.device.controlTransferIn(this.setup(request, value, index), length));
    if (r.data.byteLength !== length) throw new UploadError(`The programmer sent ${r.data.byteLength} bytes instead of ${length}.`);
    return new Uint8Array(r.data.buffer, r.data.byteOffset, length);
  }
  out(request, value, index, data) { return this.transfer(() => this.device.controlTransferOut(this.setup(request, value, index), data)); }

  // A four-byte ISP instruction; returns the four bytes the chip shifted back
  spi(a, b, c, d) { return this.in(REQ.SPI, a | (b << 8), c | (d << 8), 4); }

  // Power the target, hold it in reset and enter programming mode. The chip echoes 0x53 as
  // the third byte when it's in sync; if not, pulse reset and try again (the datasheet's way).
  async enable() {
    for (let tries = 0; tries < 4; tries++) {
      await this.control(REQ.POWERUP, SCK_PERIOD, RESET_LOW);
      await sleep(50);
      if ((await this.spi(0xac, 0x53, 0, 0))[2] === 0x53) return;
      await this.control(REQ.POWERUP, SCK_PERIOD, RESET_HIGH);
      await sleep(20);
    }
    throw new UploadError('No Blink answered. Check that it’s connected to the programmer and its battery is charged, then try again.');
  }

  async signature() { return [(await this.spi(0x30, 0, 0, 0))[3], (await this.spi(0x30, 0, 1, 0))[3], (await this.spi(0x30, 0, 2, 0))[3]]; }

  async readFuses() {
    return { low: (await this.spi(0x50, 0x00, 0, 0))[3], high: (await this.spi(0x58, 0x08, 0, 0))[3], ext: (await this.spi(0x50, 0x08, 0, 0))[3] };
  }

  // In Burn Bootloader's order: extended, high, low
  async writeFuses({ low, high, ext }) {
    for (const [cmd, value] of [[0xa4, ext], [0xa8, high], [0xa0, low]]) {
      await this.spi(0xac, cmd, 0, value);
      await sleep(10);
    }
  }

  // Erasing ends programming mode on some chips, so enter it again, as avrdude does
  async erase() {
    await this.spi(0xac, 0x80, 0, 0);
    await sleep(20);
    await this.enable();
  }

  async writePage(addr, data) {
    await this.out(REQ.FLASH_WRITE, 0, addr, data);   // loads the chip's page buffer
    const word = addr >> 1;
    await this.spi(0x4c, word >> 8, word & 0xff, 0);   // writes the page
    await sleep(6);   // up to 4.5 ms on these chips
  }

  readPage(addr) { return this.in(REQ.FLASH_READ, 0, addr, PAGE); }
}

// The pages of an image that hold anything: after an erase the rest is already 0xFF
export function usedPages(flash) {
  const pages = [];
  for (let addr = 0; addr < flash.length; addr += PAGE) {
    if (flash.subarray(addr, addr + PAGE).some((b) => b !== 0xff)) pages.push(addr);
  }
  return pages;
}

// Find the chip, get the image for it, check its fuses, then erase, write and verify.
//   imageFor(chip) → the whole flash image for that chip (game + BIOS, from the compile worker);
//                    the Blink is held in reset while it builds
//   onProgress(fraction, text)
//   confirmFuses({ found, want }) → true to set them, false to stop; only asked when they differ
export async function uploadFlash(tiny, imageFor, { onProgress = () => {}, confirmFuses = async () => false } = {}) {
  onProgress(0, 'Looking for a Blink…');
  await tiny.enable();
  const sig = await tiny.signature();
  const found = chipBySignature(sig);
  if (!found) {
    const blank = sig.every((b) => b === 0) || sig.every((b) => b === 0xff);
    throw new UploadError(blank
      ? 'The programmer is connected, but no Blink answered. Check that a Blink is connected to it and try again.'
      : `This chip (signature ${sig.map(hex2).join(' ')}) isn’t one a Blink uses.`);
  }
  const c = CHIPS[found];
  onProgress(0, `Found an ${c.name}. Building for it…`);
  const flash = await imageFor(found);
  if (flash.length !== c.flashBytes) throw new UploadError(`The image is ${flash.length} bytes, but an ${c.name} holds ${c.flashBytes}.`);

  const fuses = await tiny.readFuses();
  const off = Object.keys(c.fuses).filter((k) => (fuses[k] & c.mask[k]) !== (c.fuses[k] & c.mask[k]));
  if (off.length) {
    if (!await confirmFuses({ found: fuses, want: c.fuses })) throw new UploadError('Stopped before changing anything.');
    onProgress(0, 'Setting the fuses…');
    await tiny.writeFuses(c.fuses);
    const after = await tiny.readFuses();
    if (Object.keys(c.fuses).some((k) => (after[k] & c.mask[k]) !== (c.fuses[k] & c.mask[k]))) throw new UploadError('The fuses didn’t take. Try again, and if it keeps failing, the Arduino IDE’s Burn Bootloader sets them too.');
  }

  onProgress(0, 'Erasing…');
  await tiny.erase();
  const pages = usedPages(flash);
  const steps = pages.length * 2;
  for (const [i, addr] of pages.entries()) {
    onProgress(i / steps, 'Writing…');
    await tiny.writePage(addr, flash.subarray(addr, addr + PAGE));
  }
  for (const [i, addr] of pages.entries()) {
    onProgress((pages.length + i) / steps, 'Checking…');
    const got = await tiny.readPage(addr);
    const at = got.findIndex((b, j) => b !== flash[addr + j]);
    if (at >= 0) throw new UploadError(`Checking found 0x${hex2(got[at])} at 0x${(addr + at).toString(16)} instead of 0x${hex2(flash[addr + at])}. Upload again.`);
  }
  onProgress(1, 'Done');
  return { chip: found, pages: pages.length, bytes: pages.length * PAGE, fusesSet: off.length > 0 };
}
