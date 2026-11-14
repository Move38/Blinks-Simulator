/*
 * Upload to a Blink: builds a sketch with avr-gcc, as hardware-exact mode does, and writes it with
 * the BlinkBIOS to a Blink through a USBtinyISP over WebUSB (js/hardware/usbtiny.js): what the
 * Arduino IDE's Upload does for a Blink. Works for a sketch of one file or several, on Move38's
 * blinklib or Custom Blinklib. The playground and the learn page both open it.
 */

import { SDKS } from '../compiler/sdk.js';

// What Upload to a Blink can build for. `standard` is whichever of blink (168PB) or blink328
// matches the chip it finds; the others are 328PB boards (js/hardware/build.js)
export const UPLOAD_BOARDS = {
  standard: { name: 'Blink', note: 'ATmega168PB or ATmega328PB, found when you upload' },
  blink328max: { name: 'Blink MAX', note: 'ATmega328PB, with room for a 7936-byte game and isMAXblink()', beta: true },
  blink328nfc: { name: 'Blink NFC', note: 'ATmega328PB with an NFC chip, isNFCblink() and saveGameStat()', beta: true },
};

/*
 * Open the dialog `d` (a <dialog class="upload">).
 *   sketch()        what to build, read when Upload is pressed: an .ino's text, or { files, main }
 *   sdk             the blinklib it's written for (compiler/sdk.js)
 *   name()          what to call it in messages
 *   board           the board picked last time; setBoard(key) is told when it changes
 *   toolchain(p)    resolves to the loaded avr-gcc toolchain (js/hardware/toolchain.js), telling
 *                   p(fraction) how loading goes
 *   onUploaded(t)   told a line about what was written, for a console
 */
export async function openUploadDialog(d, { sketch, sdk, name, board, setBoard, toolchain, onUploaded }) {
  const { UsbTiny, uploadFlash, UploadError, hex2, hostOS, UDEV_RULE } = await import('../hardware/usbtiny.js');
  const os = hostOS();
  const bga = sdk === 'bga';
  if (!UPLOAD_BOARDS[board]) board = 'standard';
  const radio = (key) => `<label class="up-board"><input type="radio" name="board" value="${key}"><span><span class="t"></span><span class="b"></span></span></label>`;
  const keys = Object.keys(UPLOAD_BOARDS);
  d.innerHTML = `<form method="dialog" class="up">
    <button type="button" class="btn icon ghost close" aria-label="Close"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg></button>
    <h2>Upload to a Blink</h2>
    <p class="up-hint">Plug in your Dev Blink via USB and choose Upload. Your sketch is built with avr-gcc and written along with the BlinkBIOS, just like in the Arduino IDE.</p>
    ${bga ? `<p class="up-hint up-lib">Built on ${SDKS.bga.name}, with the BIOS its board package uses for the Blink’s chip. Blink MAX and NFC need Move38’s blinklib.</p>` : ''}
    ${os === 'windows' ? `<details class="up-setup"><summary>Setting up Windows (once)</summary>
      <p>Chrome can only use a programmer that has Windows’ WinUSB driver:</p>
      <ol><li>Download <a href="https://zadig.akeo.ie" target="_blank" rel="noopener">Zadig</a> and run it.</li>
      <li>In its Options menu, choose List All Devices, then pick <b>USBtinyISP</b> (USB ID 1781 0C9F).</li>
      <li>Choose <b>WinUSB</b> as the driver and click Replace Driver.</li>
      <li>Unplug the programmer, plug it back in, and upload again.</li></ol>
      <p class="up-note">The Arduino IDE uploads through the libusb-win32 driver instead. To upload from the IDE again, pick libusb-win32 in Zadig the same way.</p>
    </details>` : ''}
    ${os === 'linux' ? `<details class="up-setup"><summary>Setting up Linux (once)</summary>
      <p>Let the browser use the programmer with a udev rule, as avrdude needs too:</p>
      <pre class="up-cmd"></pre>
      <p class="up-note">Then unplug the programmer, plug it back in, and upload again.</p>
    </details>` : ''}
    <fieldset class="up-boards"><legend>Board</legend>
      ${keys.filter(k => !UPLOAD_BOARDS[k].beta).map(radio).join('')}
      ${bga ? '' : `<details class="up-beta"><summary>Beta boards</summary>${keys.filter(k => UPLOAD_BOARDS[k].beta).map(radio).join('')}</details>`}
    </fieldset>
    <div class="up-bar" hidden><i></i></div>
    <div class="up-status" role="status"></div>
    <div class="actions"><button type="button" class="btn ghost up-cancel">Close</button><button type="button" class="btn primary up-go">Upload</button></div>
  </form>`;
  for (const input of d.querySelectorAll('input[name=board]')) {
    const b = UPLOAD_BOARDS[input.value], label = input.closest('label');
    label.querySelector('.t').textContent = b.name;
    label.querySelector('.b').textContent = b.note;
    input.checked = input.value === (bga ? 'standard' : board);
    input.onchange = () => { board = input.value; setBoard?.(board); };
  }
  if (!bga) d.querySelector('.up-beta').open = !!UPLOAD_BOARDS[board].beta;
  const cmd = d.querySelector('.up-cmd');
  if (cmd) cmd.textContent = `echo '${UDEV_RULE}' | sudo tee /etc/udev/rules.d/60-usbtiny.rules\nsudo udevadm control --reload-rules`;
  const setup = d.querySelector('.up-setup');
  const status = d.querySelector('.up-status'), bar = d.querySelector('.up-bar'), go = d.querySelector('.up-go'), cancel = d.querySelector('.up-cancel');
  const say = (text, kind = '') => { status.textContent = text; status.className = 'up-status ' + kind; };
  const progress = (f) => { bar.hidden = f === null; if (f !== null) bar.firstChild.style.width = (f * 100).toFixed(1) + '%'; };
  let busy = false;
  const close = () => { if (!busy) d.close(); };
  d.querySelector('.close').onclick = cancel.onclick = close;
  d.onclick = e => { if (e.target === d) close(); };
  d.oncancel = e => { if (busy) e.preventDefault(); };   // Escape mid-upload would leave the Blink half-written

  if (!navigator.usb) { say('Uploading needs a browser with WebUSB: Chrome, Edge or Opera on a computer. Or download your sketch and upload it with the Arduino IDE.', 'err'); go.disabled = true; }

  // Asked in the dialog when the Blink's fuses aren't a Blink's: the answer is one of the two buttons
  const confirmFuses = ({ found, want }) => new Promise(resolve => {
    const f = (o) => `L ${hex2(o.low)} H ${hex2(o.high)} E ${hex2(o.ext)}`;
    say(`This Blink’s fuses (${f(found)}) aren’t a Blink’s (${f(want)}), so it wouldn’t start the BIOS. Set them, as the Arduino IDE’s Burn Bootloader does?`, 'ask');
    go.textContent = 'Set fuses and upload';
    cancel.textContent = 'Stop';
    go.disabled = cancel.disabled = false;
    const answer = (yes) => { go.onclick = upload; cancel.onclick = close; go.textContent = 'Upload'; cancel.textContent = 'Close'; go.disabled = cancel.disabled = true; resolve(yes); };
    go.onclick = () => answer(true);
    cancel.onclick = () => answer(false);
  });

  async function upload() {
    busy = true;
    go.disabled = cancel.disabled = true;
    d.querySelectorAll('input').forEach(i => { i.disabled = true; });
    // what to build, as it is now: it may change while avr-gcc loads
    const code = sketch(), title = name(), choice = bga ? 'standard' : board;
    const several = typeof code === 'object';
    let tiny = null;
    try {
      say('Choose your programmer…');
      tiny = await UsbTiny.connect(navigator.usb, os);   // first, while this still counts as the click
      progress(0);
      say('Loading avr-gcc…');
      const tc = await toolchain(p => { say(`Loading avr-gcc… ${Math.round(p * 100)}%`); progress(p); });
      let built = null;
      const r = await uploadFlash(tiny, async chip => {
        if (chip === 'atmega168pb' && choice !== 'standard') throw new UploadError(`This Blink has an ATmega168PB, so it isn’t a ${UPLOAD_BOARDS[choice].name}. Choose Blink and upload again.`);
        built = choice !== 'standard' ? choice : chip === 'atmega168pb' ? 'blink' : 'blink328';
        const b = await tc.build(code, built, sdk);
        const err = (b.diagnostics || []).find(x => x.severity === 'err');
        const at = err && [several && err.file, err.line && `line ${err.line}`].filter(Boolean).join(' ');
        if (!b.ok) throw new UploadError(`avr-gcc couldn’t build this sketch${err ? `: ${at ? `${at}: ` : ''}${err.message}` : '.'}`);
        if (b.flashUsed > b.flashBudget) throw new UploadError(`The game is ${b.flashUsed} bytes, but a ${UPLOAD_BOARDS[choice].name} has room for ${b.flashBudget}.`);
        return b.flash;
      }, {
        onProgress: (f, text) => { progress(f); say(text); },
        confirmFuses,
      });
      progress(1);
      const chipName = r.chip === 'atmega168pb' ? 'ATmega168PB' : 'ATmega328PB';
      say(`Uploaded “${title}” to a ${UPLOAD_BOARDS[choice].name} (${chipName})${r.fusesSet ? ', and set its fuses' : ''}.`, 'ok');
      onUploaded?.(`Uploaded “${title}” to a Blink with an ${chipName} (${built}): ${r.bytes} bytes of game and BIOS written and checked.`);
    } catch (e) {
      progress(null);
      say(e instanceof UploadError ? e.message : `The upload failed: ${e.message || e}`, 'err');
      if (e.driver && setup) setup.open = true;
    } finally {
      await tiny?.close();
      busy = false;
      go.disabled = cancel.disabled = false;
      d.querySelectorAll('input').forEach(i => { i.disabled = false; });
    }
  }
  go.onclick = upload;
  d.returnValue = '';
  d.showModal();
  if (!go.disabled) go.focus();
}
