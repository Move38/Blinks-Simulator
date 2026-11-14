// A pretend USBtiny with a Blink's chip on its pins, behind the WebUSB API, for testing
// js/hardware/usbtiny.js without hardware. The chip acts on ISP instructions the way the
// datasheet says: programming enable echoes 0x53, a page write only clears bits, and so on.
// Plain JS so the page can use it too (see fakeUsb).

const SIGNATURES = { atmega168pb: [0x1e, 0x94, 0x15], atmega328pb: [0x1e, 0x95, 0x16] };
const SIZES = { atmega168pb: 0x4000, atmega328pb: 0x8000 };
const PAGE = 128;

export class FakeUsbTiny {
  // chip: null for nothing on the pins. dropEvery: fail every nth transfer, as a flaky
  // low-speed link does. stuck: a flash byte address whose bit 0 never clears.
  // refuse: 'open' or 'claim' fails that step, as Chrome does on Windows when the
  // programmer doesn't use WinUSB, and on Linux without a udev rule.
  constructor({ chip = 'atmega168pb', fuses = { low: 0x62, high: 0xdf, ext: 0xf8 }, dropEvery = 0, stuck = -1, delay = 0, refuse = null } = {}) {
    this.vendorId = 0x1781;
    this.productId = 0x0c9f;
    this.productName = 'FakeTiny';
    this.opened = false;
    this.configuration = null;
    this.chip = chip;
    this.fuses = { ...fuses };
    this.flash = new Uint8Array(chip ? SIZES[chip] : 0).fill(0xff);
    this.pageBuf = new Uint8Array(PAGE).fill(0xff);
    this.enabled = false;
    this.powered = false;
    this.dropEvery = dropEvery;
    this.stuck = stuck;
    this.delay = delay;
    this.refuse = refuse;
    this.transfers = 0;
    this.log = [];   // ISP instructions and page writes, for tests to look at
  }

  async open() {
    if (this.refuse === 'open') throw Object.assign(new Error('Access denied.'), { name: 'SecurityError' });
    this.opened = true;
  }
  async close() { this.opened = false; this.enabled = false; }
  async selectConfiguration() { this.configuration = { configurationValue: 1 }; }
  async claimInterface() {
    if (this.refuse === 'claim') throw Object.assign(new Error('Unable to claim interface.'), { name: 'NetworkError' });
  }

  async tick() {
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    if (!this.opened) throw Object.assign(new Error('device not opened'), { name: 'InvalidStateError' });
    return this.dropEvery && ++this.transfers % this.dropEvery === 0;
  }
  result(bytes = []) { return { status: 'ok', data: new DataView(new Uint8Array(bytes).buffer) }; }

  async controlTransferIn({ request, value, index }, length) {
    if (await this.tick()) return { status: 'stall', data: new DataView(new ArrayBuffer(0)) };
    if (request === 5) {   // POWERUP: index 0 holds reset low
      this.powered = true;
      if (index !== 0) this.enabled = false;
      return this.result();
    }
    if (request === 6) { this.powered = false; this.enabled = false; return this.result(); }
    if (request === 7) return this.result(this.spi(value & 0xff, value >> 8, index & 0xff, index >> 8));
    if (request === 9) return this.result(this.enabled ? this.flash.slice(index, index + length) : new Uint8Array(length));
    throw new Error(`unexpected request ${request}`);
  }

  async controlTransferOut({ request, index }, data) {
    if (await this.tick()) return { status: 'stall', bytesWritten: 0 };
    if (request !== 10) throw new Error(`unexpected request ${request}`);
    const bytes = new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
    if (this.enabled) bytes.forEach((b, i) => { this.pageBuf[(index + i) % PAGE] = b; });
    return { status: 'ok', bytesWritten: bytes.length };
  }

  // What the chip shifts back for one four-byte instruction
  spi(a, b, c, d) {
    if (!this.chip || !this.powered) return [0, 0, 0, 0];
    if (!this.enabled) {
      if (a === 0xac && b === 0x53) { this.enabled = true; return [0, a, 0x53, c]; }
      return [0xff, 0xff, 0xff, 0xff];
    }
    this.log.push([a, b, c, d]);
    const out = (v) => [0, a, b, v];
    if (a === 0xac && b === 0x53) return [0, a, 0x53, c];
    if (a === 0x30) return out(SIGNATURES[this.chip][c] ?? 0);
    if (a === 0x50 && b === 0x00) return out(this.fuses.low);
    if (a === 0x58 && b === 0x08) return out(this.fuses.high);
    if (a === 0x50 && b === 0x08) return out(this.fuses.ext);
    if (a === 0xac && b === 0x80) { this.flash.fill(0xff); return out(0); }
    if (a === 0xac && b === 0xa0) { this.fuses.low = d; return out(0); }
    if (a === 0xac && b === 0xa8) { this.fuses.high = d; return out(0); }
    if (a === 0xac && b === 0xa4) { this.fuses.ext = d; return out(0); }
    if (a === 0x4c) {
      const start = (((b << 8) | c) * 2) & ~(PAGE - 1);
      for (let i = 0; i < PAGE; i++) {
        let v = this.pageBuf[i];
        if (start + i === this.stuck) v |= 1;
        this.flash[start + i] &= v;   // programming only clears bits
      }
      this.pageBuf.fill(0xff);
      return out(0);
    }
    throw new Error(`unexpected instruction ${[a, b, c, d].map((x) => x.toString(16)).join(' ')}`);
  }
}

// navigator.usb with one fake programmer plugged in (or none)
export function fakeUsb(device = new FakeUsbTiny(), { granted = false } = {}) {
  return {
    device,
    getDevices: async () => (granted && device ? [device] : []),
    requestDevice: async () => {
      if (!device) throw Object.assign(new Error('No device selected.'), { name: 'NotFoundError' });
      granted = true;
      return device;
    },
  };
}
