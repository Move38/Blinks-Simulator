// Uploading to a real Blink through a USBtinyISP (js/hardware/usbtiny.js), against a
// pretend programmer and chip (fake-usbtiny.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UsbTiny, uploadFlash, usedPages, CHIPS, UploadError, hostOS } from '../js/hardware/usbtiny.js';
import { parseHex } from '../js/hardware/blink-avr.js';
import { FakeUsbTiny, fakeUsb } from './fake-usbtiny.mjs';

// What the Arduino IDE flashes for Spin: the game in the built-in area plus the BIOS
const image = (board, size) => parseHex(readFileSync(new URL(`../hardware/fixtures/Spin/build/move38.avr.${board}/Spin.ino.with_bootloader.hex`, import.meta.url), 'utf8'), size);
const SPIN_168 = image('blink', 0x4000);
const SPIN_328 = image('blink328', 0x8000);
const imageFor = (chip) => (chip === 'atmega168pb' ? SPIN_168 : SPIN_328);

async function connect(opts) {
  const usb = fakeUsb(new FakeUsbTiny(opts));
  return { tiny: await UsbTiny.connect(usb), dev: usb.device };
}

test('uploads the game and BIOS to a 168PB, writing only the pages that hold something', async () => {
  const { tiny, dev } = await connect();
  dev.flash.fill(0x00);   // an old game everywhere: the erase has to clear it
  const asked = [];
  const r = await uploadFlash(tiny, async (chip) => { asked.push(chip); return SPIN_168; });
  await tiny.close();
  assert.deepEqual(asked, ['atmega168pb']);
  assert.deepEqual(dev.flash, SPIN_168);
  const pages = usedPages(SPIN_168);
  assert.equal(r.pages, pages.length);
  assert.ok(pages.length < 0x4000 / 128 / 2, `${pages.length} pages`);
  assert.equal(dev.log.filter(([a]) => a === 0x4c).length, pages.length);
  assert.equal(r.fusesSet, false);
  assert.equal(dev.powered, false, 'powered down afterwards');
});

test('finds a 328PB by its signature and builds for it', async () => {
  const { tiny, dev } = await connect({ chip: 'atmega328pb', fuses: CHIPS.atmega328pb.fuses });
  const r = await uploadFlash(tiny, async (chip) => imageFor(chip));
  assert.equal(r.chip, 'atmega328pb');
  assert.deepEqual(dev.flash, SPIN_328);
});

test('asks before setting fuses that aren’t a Blink’s, and stops untouched if told no', async () => {
  // a factory-fresh 168PB: BOOTRST unprogrammed, so it wouldn't start the BIOS
  const { tiny, dev } = await connect({ fuses: { low: 0x62, high: 0xdf, ext: 0xf9 } });
  dev.flash.fill(0x12);
  let seen = null;
  await assert.rejects(uploadFlash(tiny, async () => SPIN_168, { confirmFuses: async (f) => { seen = f; return false; } }), /Stopped before changing anything/);
  assert.deepEqual(seen, { found: { low: 0x62, high: 0xdf, ext: 0xf9 }, want: CHIPS.atmega168pb.fuses });
  assert.ok(dev.flash.every((b) => b === 0x12), 'flash untouched');
  assert.equal(dev.fuses.ext, 0xf9);

  const r = await uploadFlash(tiny, async () => SPIN_168, { confirmFuses: async () => true });
  assert.equal(r.fusesSet, true);
  assert.deepEqual(dev.fuses, CHIPS.atmega168pb.fuses);
  assert.deepEqual(dev.flash, SPIN_168);
});

test('fuse bits that don’t exist don’t count as different', async () => {
  // a 168PB's extended fuse only has the three boot bits; the others may read back as anything
  const { tiny } = await connect({ fuses: { low: 0x62, high: 0xdf, ext: 0x00 } });
  const r = await uploadFlash(tiny, async () => SPIN_168, { confirmFuses: async () => assert.fail('asked') });
  assert.equal(r.fusesSet, false);
});

test('says when no Blink is on the pins', async () => {
  const { tiny } = await connect({ chip: null });
  await assert.rejects(uploadFlash(tiny, async () => SPIN_168), (e) => e instanceof UploadError && /No Blink answered/.test(e.message));
});

test('retries transfers a flaky link drops', async () => {
  const { tiny, dev } = await connect({ dropEvery: 7 });
  await uploadFlash(tiny, async () => SPIN_168);
  assert.deepEqual(dev.flash, SPIN_168);
});

test('checking catches a byte that didn’t write', async () => {
  const addr = SPIN_168.findIndex((b, i) => i > usedPages(SPIN_168)[3] && !(b & 1));   // a bit that has to clear
  const { tiny } = await connect({ stuck: addr });
  await assert.rejects(uploadFlash(tiny, async () => SPIN_168), new RegExp(`at 0x${addr.toString(16)} instead`));
});

test('an image for the wrong chip is refused before erasing', async () => {
  const { tiny, dev } = await connect({ chip: 'atmega328pb', fuses: CHIPS.atmega328pb.fuses });
  dev.flash.fill(0x34);
  await assert.rejects(uploadFlash(tiny, async () => SPIN_168), /holds 32768/);
  assert.ok(dev.flash.every((b) => b === 0x34));
});

test('without WebUSB, or with no programmer chosen, it says why', async () => {
  await assert.rejects(UsbTiny.connect(undefined), /WebUSB/);
  await assert.rejects(UsbTiny.connect(fakeUsb(null)), /No programmer was chosen/);
  // a programmer this page was allowed before is used without asking
  const usb = fakeUsb(new FakeUsbTiny(), { granted: true });
  usb.requestDevice = () => assert.fail('asked');
  await UsbTiny.connect(usb);
});

test('on Windows, a programmer without WinUSB is a driver problem, with what to do', async () => {
  for (const refuse of ['open', 'claim']) {
    const err = await UsbTiny.connect(fakeUsb(new FakeUsbTiny({ refuse })), 'windows').catch((e) => e);
    assert.ok(err instanceof UploadError && err.driver, refuse);
    assert.match(err.message, /WinUSB/);
  }
  // not listed at all: the same advice
  const none = await UsbTiny.connect(fakeUsb(null), 'windows').catch((e) => e);
  assert.ok(none.driver);
  // elsewhere, an interface that can't be claimed doesn't matter
  await UsbTiny.connect(fakeUsb(new FakeUsbTiny({ refuse: 'claim' })), 'other');
});

test('on Linux, an access error asks for the udev rule; elsewhere it says the programmer is busy', async () => {
  const linux = await UsbTiny.connect(fakeUsb(new FakeUsbTiny({ refuse: 'open' })), 'linux').catch((e) => e);
  assert.ok(linux.driver);
  assert.match(linux.message, /udev/);
  const mac = await UsbTiny.connect(fakeUsb(new FakeUsbTiny({ refuse: 'open' })), 'other').catch((e) => e);
  assert.equal(mac.driver, false);
  assert.match(mac.message, /busy/);
});

test('the computer is told from the browser’s platform', () => {
  assert.equal(hostOS({ userAgentData: { platform: 'Windows' } }), 'windows');
  assert.equal(hostOS({ platform: 'Win32', userAgent: '' }), 'windows');
  assert.equal(hostOS({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'linux');
  assert.equal(hostOS({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14)' }), 'other');
  assert.equal(hostOS({ userAgentData: { platform: 'Chrome OS' }, userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 1)' }), 'other');
  assert.equal(hostOS({ userAgentData: { platform: 'macOS' }, platform: 'MacIntel', userAgent: '' }), 'other');
});
