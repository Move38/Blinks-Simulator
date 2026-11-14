/*
 * Blinks Playground: wires the editor (code or blocks), the compiler, the simulated
 * Blinks and the console together. Everything runs in the browser.
 */

import { compile, compileSketch } from './compiler/index.js';
import { SDKS, detectSdk } from './compiler/sdk.js';
import { World, DRIFT } from './runtime/world.js';
import { Board, LAYOUTS, nextCell, isQuiet } from './ui/board.js';
import { createCodeEditor } from './ui/editor.js';
import { Console } from './ui/console.js';
import { EXAMPLES, STARTER } from './examples.js';
import { zip } from './zip.js';
import { parseGitHub, repoFiles, sketchesIn, loadSketch as loadFromGitHub, GitHubError } from './github.js';

const $ = s => document.querySelector(s);
const STORE = 'blinks.playground.v2';

// ---------------- state ----------------
const DEBUG_MODES = ['none', 'tooltip', 'comms'];
// What Upload to a Blink can build for. `standard` is whichever of blink (168PB) or blink328
// matches the chip it finds; the others are 328PB boards (js/hardware/build.js)
const UPLOAD_BOARDS = {
  standard: { name: 'Blink', note: 'ATmega168PB or ATmega328PB, found when you upload' },
  blink328max: { name: 'Blink MAX', note: 'ATmega328PB, with room for a 7936-byte game and isMAXblink()', beta: true },
  blink328nfc: { name: 'Blink NFC', note: 'ATmega328PB with an NFC chip, isNFCblink() and saveGameStat()', beta: true },
};
const saved = loadState();
const urlEngine = new URLSearchParams(location.search).has('hardware') ? 'hardware' : null;
const state = {
  engine: urlEngine ?? (saved.engine === 'hardware' ? 'hardware' : 'sim'),   // sim: the JS simulator; hardware: emulated chips (js/hardware)
  hwExplained: saved.hwExplained === true,   // "Don't show this again" on the hardware-exact explainer
  uploadBoard: UPLOAD_BOARDS[saved.uploadBoard] ? saved.uploadBoard : 'standard',   // the board picked in Upload to a Blink
  code: saved.code ?? STARTER,      // the text in the editor: the sketch, or the open file of one with several
  // a sketch of several files (.cpp files, a src/ or config/ folder): { path: text }, its main .ino,
  // and the file open in the editor. null for a sketch that is one file (state.code).
  files: saved.files && typeof saved.files === 'object' && saved.main in saved.files ? saved.files : null,
  main: saved.main ?? null,
  file: saved.file ?? saved.main ?? null,
  sdk: SDKS[saved.sdk] ? saved.sdk : 'move38',   // which blinklib the sketch is written for (compiler/sdk.js)
  name: saved.name ?? 'My sketch',
  view: saved.view === 'blocks' ? 'blocks' : 'code',
  live: saved.live ?? true,
  debug: DEBUG_MODES.includes(saved.debug) ? saved.debug : saved.faces ? 'comms' : 'tooltip',
  bits: saved.bits === true,        // face values shown as bits (dots) instead of numbers
  drift: typeof saved.drift === 'number' && saved.drift >= DRIFT.min && saved.drift <= DRIFT.max ? saved.drift : DRIFT.typical,
  consoleOpen: saved.consoleOpen ?? true,
  split: saved.split ?? null,
  source: saved.source ?? null,     // the example (or starter) text this sketch started from
  speed: 1,
  paused: false,
  compiled: null,                   // last successful compile
  running: null,                    // code currently loaded on the Blinks
  dirty: false,
};

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
}
let saveTimer = 0;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        code: state.code, files: state.files, main: state.main, file: state.file, sdk: state.sdk, name: state.name, view: state.view, live: state.live, debug: state.debug, bits: state.bits, drift: state.drift, engine: state.engine, hwExplained: state.hwExplained, uploadBoard: state.uploadBoard,
        consoleOpen: state.consoleOpen, split: state.split, source: state.source,
        cells: world.blinks.map(b => [b.q, b.r, b.rot]),
      }));
    } catch (e) { /* storage full or blocked: fine */ }
  }, 300);
}

// ---------------- simulation ----------------
const con = new Console($('#consoleBody'), { onJump: (line, file) => jumpTo(file, line) });

// A line of the running program (encoded with its file, see compiler/lexer.js) as { file, line }
function where(line) {
  if (state.compiled && state.compiled.where) return state.compiled.where(line);
  return { file: null, line: line || 0 };
}
const lineText = at => (at.file && state.files ? `${at.file} line ${at.line}` : `line ${at.line}`);
// Show a file and line in the code editor
function jumpTo(file, line) {
  setView('code');
  if (file && state.files && file in state.files && file !== state.file) openFile(file);
  editor.focusLine(line);
}
const runtimeDiags = new Map();

const events = {
  onSerial: (b, text) => con.add('out', text, { who: b.id }),
  onError: (b, err) => {
    const at = where(err.line);
    con.add('err', err.message, { who: b.id, ...at });
    if (!runtimeDiags.has(err.message)) {
      runtimeDiags.set(err.message, { ...at, line: at.line || 1, message: err.message, runtime: true });
      refreshDiagnostics();
    }
    setStatus('err', at.line ? `Stopped on ${lineText(at)}` : 'Stopped: runtime error');
  },
  onWarn: (b, message, line) => con.add('warn', message, { who: b.id, ...where(line) }),
  onSeed: b => con.add('info', `Blink #${b.id} is sharing its game. Put it next to other Blinks within 5 s to send them the game.`),
  onSeedDone: (b, n) => con.add('info', n ? `Game shared with ${n} Blink${n === 1 ? '' : 's'}. They restarted with startState() = START_STATE_DOWNLOAD_SUCCESS.` : 'Game sharing ended.'),
  onSleep: () => {},
};
// The table: the JS simulator, or in hardware-exact mode a HardwareWorld (loaded on demand, see setEngine)
let world = new World(events);

const board = new Board($('#board'), world, {
  bin: $('#bin'),
  onInteract: () => $('#hint').style.opacity = 0,
  onLayout: refit => { updateCount(); saveState(); if (refit) board.fit(); },
});

function setCells(cells) {
  world.clear();
  for (const [q, r, rot] of cells) world.addBlink(q, r, rot || 0);
  board.lastTouched = null;
  updateCount();
  board.fit();
  saveState();
}
function updateCount() {
  $('#blinkCount').textContent = world.blinks.length;
  $('#removeBlink').disabled = world.blinks.length <= 1;
  if ($('#status').classList.contains('ok')) setStatus('ok', runningText());
}
const runningText = () => `Running on ${world.blinks.length} Blink${world.blinks.length === 1 ? '' : 's'}`;

// ---------------- editor ----------------
const editor = createCodeEditor($('#code'), {
  onChange: code => {
    state.code = code;
    if (state.files) state.files[state.file] = code;
    state.blocksStale = true;
    codeChanged();
  },
  onRun: () => run(true),
});

let blocks = null;            // lazily created block editor
let blocksLoading = null;

let buildTimer = 0;
function codeChanged() {
  saveState();
  markDirty();
  clearTimeout(buildTimer);
  if (state.live) {
    setStatus('busy', 'Editing…');
    buildTimer = setTimeout(() => run(false), 650);
  } else {
    buildTimer = setTimeout(() => check(), 650);
  }
}

// What's being run, to tell whether it changed: the code, or all the files, and the SDK
function sketchKey() {
  return state.sdk + '\n' + (state.files ? JSON.stringify(state.files) : state.code);
}
// The sketch as avr-gcc builds it (js/hardware): an .ino's text, or a sketch folder
const avrSketch = () => (state.files ? { files: state.files, main: state.main } : state.code);
// gcc's messages as the editor's: { file, line, message }, with no file for a one-file sketch
const avrDiags = (r, severity) => (r.diagnostics || []).filter(d => d.severity === severity).map(d => ({ file: state.files ? d.file : null, line: d.line, message: d.message }));
function compileCurrent() {
  if (state.files) return compileSketch({ files: state.files, main: state.main, sdk: state.sdk });
  return compile(state.code, { sdk: state.sdk });
}

function markDirty() {
  state.dirty = sketchKey() !== state.running;
  $('#runBtn').classList.toggle('dirty', state.dirty && !state.live);
}

// compile only, to show errors while typing (Live off)
function check() {
  if (hardwareActive()) { hardwareBuild(false); return; }
  const r = compileCurrent();
  showCompile(r, false);
  return r;
}

let lastDiags = [];
function showCompile(r, ran) {
  const diags = [];
  if (!r.ok) {
    for (const e of r.errors) diags.push({ file: e.file, line: e.line || 1, message: e.message, severity: 'err' });
    const e = r.errors[0];
    setStatus('err', e.line ? `Error on ${lineText(e)}` : 'Error');
    statusLine = e.line;
    statusFile = e.file;
    // an error in another file: say so in the console, where it can be clicked
    if (state.files && e.file && e.file !== state.file) con.add('err', e.message, { line: e.line, file: e.file });
  } else {
    for (const w of r.warnings) diags.push({ file: w.file, line: w.line || 1, message: w.message, severity: 'warn', inline: r.warnings.length <= 3 });
    $('#serialForm').hidden = !r.serialInput;
    if (ran) setStatus('ok', runningText());
    else if (!state.live) setStatus('busy', state.dirty ? 'Changed — press Run' : 'Ready');
    showRam(r.ram, r.flash);
  }
  lastDiags = diags;
  refreshDiagnostics();
}
// the open file's messages
function refreshDiagnostics() {
  const here = d => !state.files || !d.file || d.file === state.file;
  editor.setDiagnostics(lastDiags.concat([...runtimeDiags.values()]).filter(here));
  renderFileTabs();
}

function run(force) {
  clearTimeout(buildTimer);
  if (hardwareActive()) {
    if (hardwareSupports()) { hardwareBuild(true, force); return true; }
    con.add('info', hardwareUnsupported());
    toast('Back to the simulator: hardware-exact mode can’t build this sketch yet');
    setEngine('sim');
    return true;
  }
  const r = compileCurrent();
  if (!r.ok) {
    showCompile(r, false);
    return false;
  }
  const key = sketchKey();
  if (!force && state.running === key) { showCompile(r, true); return true; }
  runtimeDiags.clear();
  state.compiled = r;
  state.running = key;
  world.load(r);
  board.valueBits = valueBits();
  markDirty();
  showCompile(r, true);
  if (state.paused) setStatus('paused', 'Paused');
  return true;
}

let statusLine = 0, statusFile = null;
function setStatus(kind, text) {
  const s = $('#status');
  s.className = 'status ' + kind;
  s.querySelector('.txt').textContent = text;
}
$('#status').addEventListener('click', () => { if ($('#status').classList.contains('err') && statusLine) jumpTo(statusFile, statusLine); });

function showRam(ram, flash) {
  const el = $('#ram');
  const pct = ram.used / ram.budget;
  el.className = 'ram' + (pct > 1 ? ' over' : pct > 0.8 ? ' high' : '');
  const bar = p => `<span class="bar"><i style="width:${Math.min(100, p * 100).toFixed(1)}%"></i></span>`;
  if (flash) {
    // hardware-exact: what avr-gcc's build really uses, counted like the Arduino IDE (blinklib and the BIOS's shared memory included)
    // on a narrow screen the budgets (.of) are hidden
    el.innerHTML = `<span>Flash ${flash.used}<span class="of"> / ${flash.budget} B</span></span>${bar(flash.used / flash.budget)}<span>RAM ${ram.used}<span class="of"> / ${ram.budget} B</span></span>${bar(pct)}`;
    el.title = 'Flash: the game\'s code and constants, out of the space a Blink keeps for a game. RAM: global variables, blinklib\'s and the BIOS\'s included; the rest is left for the stack.';
    return;
  }
  el.innerHTML = `<span>RAM ${ram.used} / ${ram.budget} B</span>${bar(pct)}`;
  el.title = pct > 1
    ? 'Your global variables use more memory than a Blink has left after blinklib. This sketch would not fit on a real Blink.'
    : 'Memory used by your global variables (and strings), out of about what a Blink has left after blinklib.';
}

// ---------------- hardware-exact mode ----------------
// The real BlinkBIOS and blinklib on emulated ATmega168PB chips, with the sketch compiled by
// avr-gcc in a worker (js/hardware). None of it is downloaded until the switch is turned on;
// the simulator keeps the table running while it loads.
let hw = null;                // { HardwareWorld, toolchain } once loaded
let hwLoading = null;
let hwProgress = null;        // also told how loading is going, while an upload waits for it
let buildSeq = 0;
let hwWhole = false;          // the latest build only fit as one unit (build.js)
const hardwareActive = () => !!hw && world instanceof hw.HardwareWorld;
// hardware-exact runs Move38's blinklib (js/hardware/build.js). Custom Blinklib games build
// too, for Upload, but the debug views only know where Move38's blinklib keeps its state.
const hardwareSupports = () => state.sdk === 'move38';
const hardwareUnsupported = () => `Hardware-exact mode runs Move38’s blinklib for now, so this ${SDKS[state.sdk].name} sketch runs in the simulator. It can still be uploaded to a real Blink.`;

function loadHardware() {
  if (!hwLoading) {
    hwLoading = (async () => {
      const [{ HardwareWorld }, { Toolchain }] = await Promise.all([import('./hardware/world.js'), import('./hardware/toolchain.js')]);
      const toolchain = new Toolchain();
      await toolchain.load(p => {
        if (state.engine === 'hardware') setStatus('busy', `Loading avr-gcc… ${Math.round(p * 100)}%`);
        hwProgress?.(p);
      });
      return (hw = { HardwareWorld, toolchain });
    })();
    hwLoading.catch(() => { hwLoading = null; });
  }
  return hwLoading;
}

// Swap the table's engine, keeping the Blinks where they are
async function setEngine(engine) {
  if (engine === 'hardware' && !hardwareSupports()) {
    con.add('info', hardwareUnsupported());
    toast('Hardware-exact mode can’t build this sketch yet');
    engine = 'sim';
  }
  state.engine = engine;
  const btn = $('#hwBtn');
  btn.classList.toggle('on', engine === 'hardware');
  btn.setAttribute('aria-pressed', engine === 'hardware');
  saveState();
  renderFlags();
  if (engine === 'hardware' && !hw) {
    setStatus('busy', 'Loading avr-gcc… 0%');
    try { await loadHardware(); }
    catch (e) {
      con.add('err', `Hardware-exact mode didn't load: ${e.message}`);
      toast('Hardware-exact mode didn’t load, so the simulator is still running');
      return setEngine('sim');
    }
    if (state.engine !== 'hardware') return;   // switched back while it loaded
  }
  if ((engine === 'hardware') === hardwareActive()) return;
  const cells = world.blinks.map(b => [b.q, b.r, b.rot]);
  world = engine === 'hardware' ? new hw.HardwareWorld(events) : new World(events);
  board.world = world;
  board.hover = board.hoverChip = board.lastTouched = null;
  world.drift = state.drift;
  for (const [q, r, rot] of cells) world.addBlink(q, r, rot);
  runtimeDiags.clear();
  state.compiled = null;
  state.running = null;
  if (engine === 'hardware') con.add('info', 'Hardware-exact: each Blink is an emulated ATmega168PB running the real BlinkBIOS and blinklib, with your sketch compiled by avr-gcc 7.3.0.');
  renderFlags();
  run(true);
}

// Compile with avr-gcc in the worker; with `load`, flash the Blinks with the result
async function hardwareBuild(load, force) {
  const code = avrSketch(), key = sketchKey();
  if (load && !force && state.running === key) return;
  const seq = ++buildSeq;
  setStatus('busy', 'Compiling with avr-gcc…');
  const r = await hw.toolchain.build(code);
  if (seq !== buildSeq || !hardwareActive()) return;   // a newer build, or the engine changed
  const res = {
    ok: r.ok,
    errors: avrDiags(r, 'err'),
    warnings: avrDiags(r, 'warn'),
    serialInput: /\bSerial\b/.test(state.files ? Object.values(state.files).join('\n') : code),
    ram: { used: r.ramUsed, budget: r.ramBudget },
    flash: { used: r.flashUsed, budget: r.flashBudget },
  };
  if (!r.ok && !res.errors.length) res.errors.push({ line: 0, message: 'avr-gcc couldn\'t build this sketch' });
  // said once each time it starts happening, not on every build
  if (r.ok && r.whole && !hwWhole) con.add('info', `This game only fits on a Blink when it's built as one unit, which shrinks it almost as much as the Arduino IDE's link-time optimization does.`);
  if (r.ok) hwWhole = r.whole;
  if (!r.ok || !load) { showCompile(res, false); return; }
  runtimeDiags.clear();
  state.compiled = res;
  state.running = key;
  world.load({ chip: r.chip, flash: r.flash, symbols: r.symbols });
  markDirty();
  showCompile(res, true);
  if (state.paused) setStatus('paused', 'Paused');
}
// Turning it on explains the trade-offs first, since it works the computer much harder,
// unless the user has asked not to see that again
$('#hwBtn').addEventListener('click', async () => {
  if (state.engine === 'hardware') return setEngine('sim');
  if (!hardwareSupports()) return setEngine('hardware');   // says why it can't
  if (!state.hwExplained && !await ask('Your sketch is compiled with avr-gcc, the compiler the Arduino IDE uses, and every Blink becomes an emulated ATmega168PB running the real BlinkBIOS and blinklib.', 'Switch to hardware-exact', {
    title: 'Hardware-exact mode',
    points: [
      'Timing, IR, sleep and game sharing come from the real firmware, and the console shows the flash and RAM your game really uses.',
      'It downloads about 6 MB the first time, and keeps it for next time. The simulator keeps running while it loads.',
      'It runs slower: a big table may fall behind real time.',
      'The simulator’s checks (loops that never end, array indexes, face numbers) don’t happen, just as on a real Blink.',
    ],
    optOut: () => { state.hwExplained = true; saveState(); },
  })) return;
  setEngine('hardware');
});

// ---------------- upload to a real Blink ----------------
// Builds the sketch with avr-gcc, as hardware-exact mode does, and writes it with the
// BlinkBIOS to a Blink through a USBtinyISP over WebUSB (js/hardware/usbtiny.js): what the
// Arduino IDE's Upload does for a Blink. Works in either engine, for a sketch of one file or
// several, on Move38's blinklib or Custom Blinklib.
async function openUpload() {
  closePopovers();
  const d = $('#uploadDialog');
  const { UsbTiny, uploadFlash, UploadError, hex2, hostOS, UDEV_RULE } = await import('./hardware/usbtiny.js');
  const os = hostOS();
  const bga = state.sdk === 'bga';
  const radio = (key) => `<label class="up-board"><input type="radio" name="board" value="${key}"><span><span class="t"></span><span class="b"></span></span></label>`;
  const keys = Object.keys(UPLOAD_BOARDS);
  d.innerHTML = `<form method="dialog" class="up">
    <button type="button" class="btn icon ghost close" aria-label="Close"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg></button>
    <h2>Upload to a Blink</h2>
    <p class="up-hint">Plug in your USBtinyISP programmer, hold its pins on the Blink’s programming pads, and choose Upload. Your sketch is built with avr-gcc and written along with the BlinkBIOS, as the Arduino IDE’s Upload does.</p>
    ${bga ? `<p class="up-hint up-lib">Built on ${SDKS.bga.name} with its own BIOS, as its Arduino board package does. It only builds for the original Blinks’ ATmega168PB.</p>` : ''}
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
    label.querySelector('.b').textContent = bga ? 'ATmega168PB' : b.note;
    input.checked = input.value === (bga ? 'standard' : state.uploadBoard);
    input.onchange = () => { state.uploadBoard = input.value; saveState(); };
  }
  if (!bga) d.querySelector('.up-beta').open = !!UPLOAD_BOARDS[state.uploadBoard].beta;
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
    const code = state.files ? { files: { ...state.files }, main: state.main } : state.code;
    const lib = state.sdk, name = title(), choice = bga ? 'standard' : state.uploadBoard;
    let tiny = null;
    try {
      say('Choose your programmer…');
      tiny = await UsbTiny.connect(navigator.usb, os);   // first, while this still counts as the click
      if (!hw) {
        progress(0);
        hwProgress = p => { say(`Loading avr-gcc… ${Math.round(p * 100)}%`); progress(p); };
        say('Loading avr-gcc…');
        try { await loadHardware(); } finally { hwProgress = null; }
      }
      let board = null;
      const r = await uploadFlash(tiny, async chip => {
        if (chip === 'atmega168pb' && choice !== 'standard') throw new UploadError(`This Blink has an ATmega168PB, so it isn’t a ${UPLOAD_BOARDS[choice].name}. Choose Blink and upload again.`);
        if (lib === 'bga' && chip !== 'atmega168pb') throw new UploadError(`${SDKS.bga.name} only builds for the original Blinks’ ATmega168PB, and this Blink has an ATmega328PB.`);
        board = choice !== 'standard' ? choice : chip === 'atmega168pb' ? 'blink' : 'blink328';
        const b = await hw.toolchain.build(code, board, lib);
        const err = (b.diagnostics || []).find(x => x.severity === 'err');
        const at = err && [state.files && err.file, err.line && `line ${err.line}`].filter(Boolean).join(' ');
        if (!b.ok) throw new UploadError(`avr-gcc couldn’t build this sketch${err ? `: ${at ? `${at}: ` : ''}${err.message}` : '.'}`);
        if (b.flashUsed > b.flashBudget) throw new UploadError(`The game is ${b.flashUsed} bytes, but a ${UPLOAD_BOARDS[choice].name} has room for ${b.flashBudget}.`);
        return b.flash;
      }, {
        onProgress: (f, text) => { progress(f); say(text); },
        confirmFuses,
      });
      progress(1);
      const chipName = r.chip === 'atmega168pb' ? 'ATmega168PB' : 'ATmega328PB';
      say(`Uploaded “${name}” to a ${UPLOAD_BOARDS[choice].name} (${chipName})${r.fusesSet ? ', and set its fuses' : ''}. Take the programmer off and it starts.`, 'ok');
      con.add('info', `Uploaded “${name}” to a Blink with an ${chipName} (${board}): ${r.bytes} bytes of game and BIOS written and checked.`);
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

// ---------------- code / blocks views ----------------
async function getBlocks() {
  if (blocks) return blocks;
  if (!blocksLoading) {
    blocksLoading = import('./ui/blocks.js').then(m => m.createBlocksEditor($('#blocks'), {
      onChange: code => {
        state.code = code;
        state.blocksStale = false;
        editor.setValue(code);
        codeChanged();
      },
    }));
  }
  blocks = await blocksLoading;
  return blocks;
}

async function setView(view) {
  if (view === state.view && !setView.initial) return;
  setView.initial = false;
  const note = $('#viewNote');
  note.hidden = true;
  if (view === 'blocks' && state.files) {
    showNote('Blocks show sketches that are one file. This one has several, so it stays as code.');
    view = 'code';
  } else if (view === 'blocks') {
    let b;
    try { b = await getBlocks(); }
    catch (e) {
      console.error(e);
      showNote('The block editor couldn\'t load. Check your internet connection and try again.');
      return;
    }
    if (state.blocksStale !== false || !state.blocksShown) {
      const res = b.setCode(state.code);
      if (!res.ok) {
        showNote(`This code can't be shown as blocks yet: ${res.message}`);
        return;
      }
      state.blocksStale = false;
      state.blocksShown = true;
      if (res.lossy) showNote('Parts of this sketch don\'t have blocks yet, so they appear as C code blocks. They still run.');
    }
  }
  state.view = view;
  $('#code').hidden = view !== 'code';
  $('#blocks').hidden = view !== 'blocks';
  $('#tabCode').setAttribute('aria-selected', view === 'code');
  $('#tabBlocks').setAttribute('aria-selected', view === 'blocks');
  if (view === 'code') { editor.refresh(); }
  else { blocks.resize(); }
  saveState();
}
setView.initial = true;

function showNote(text) {
  const note = $('#viewNote');
  note.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text;
  const close = document.createElement('button');
  close.className = 'link';
  close.textContent = 'OK';
  close.onclick = () => { note.hidden = true; };
  note.append(span, close);
  note.hidden = false;
  // along the bottom of the editor, clear of the block categories on the left and the trash can on
  // the right
  requestAnimationFrame(() => {
    const blocks = $('#blocks');
    const box = note.parentElement.getBoundingClientRect();
    const at = sel => (!blocks.hidden && blocks.querySelector(sel)?.getBoundingClientRect()) || null;
    const toolbox = at('.blocklyToolbox'), controls = [at('.blocklyTrash')].filter(r => r && r.width);
    note.style.left = 12 + (toolbox ? toolbox.right - box.left : 0) + 'px';
    note.style.right = 12 + (controls.length ? box.right - Math.min(...controls.map(r => r.left)) : 0) + 'px';
  });
}

document.querySelectorAll('.seg [data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ---------------- files of a sketch ----------------
// A sketch of several files shows them as tabs over the editor: the main .ino, the other files at
// the top of its folder, then the ones in folders. A tab with an error in it gets a red dot.
const fileOrder = paths => paths.slice().sort((a, b) => (a === state.main ? -1 : b === state.main ? 1 : (a.includes('/') - b.includes('/')) || a.localeCompare(b)));
function renderFileTabs() {
  const bar = $('#fileTabs');
  bar.hidden = !state.files;
  if (!state.files) return;
  const bad = new Set([...lastDiags, ...runtimeDiags.values()].filter(d => d.severity !== 'warn' && d.file).map(d => d.file));
  const want = fileOrder(Object.keys(state.files)).map(p => `${p}|${p === state.file}|${bad.has(p)}`).join('/');
  if (bar.dataset.shown === want) return;
  bar.dataset.shown = want;
  bar.replaceChildren(...fileOrder(Object.keys(state.files)).map(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', p === state.file);
    b.title = p;
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
    if (dir) b.append(Object.assign(document.createElement('span'), { className: 'dir', textContent: dir }));
    b.append(p.slice(dir.length));
    if (bad.has(p)) b.append(Object.assign(document.createElement('i'), { className: 'bad', title: 'Has an error' }));
    b.addEventListener('click', () => openFile(p));
    return b;
  }));
  bar.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
// the tabs scroll sideways with a mouse wheel too (their scrollbar is hidden)
$('#fileTabs').addEventListener('wheel', e => {
  const bar = e.currentTarget;
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && bar.scrollWidth > bar.clientWidth) { bar.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
function openFile(path) {
  if (!state.files || !(path in state.files)) return;
  state.file = path;
  state.code = state.files[path];
  editor.openDoc(path, state.code);
  refreshDiagnostics();
  saveState();
}

// Which blinklib the sketch is written for (compiler/sdk.js)
function buildLibraryMenu() {
  const pop = $('#libPop');
  pop.innerHTML = '<h3>Blinks library</h3><p class="pop-note">The blinklib this sketch is written for. Most games use Move38’s; a few use Custom Blinklib, whose IR sends whole bytes and resends datagrams until they arrive.</p>';
  for (const sdk of Object.values(SDKS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.dataset.sdk = sdk.id;
    b.innerHTML = '<span class="t"></span><span class="b"></span>';
    b.querySelector('.t').textContent = sdk.name;
    b.querySelector('.b').textContent = sdk.about;
    b.addEventListener('click', () => { closePopovers(); setSdk(sdk.id); });
    pop.append(b);
  }
}
buildLibraryMenu();
function setSdk(id) {
  if (id === state.sdk) return;
  state.sdk = id;
  saveState();
  renderFlags();
  con.add('info', `Building with ${SDKS[id].name}.`);
  run(true);
}
new MutationObserver(() => {
  for (const b of $('#libPop').querySelectorAll('[data-sdk]')) b.setAttribute('aria-checked', b.dataset.sdk === state.sdk);
}).observe($('#libPop'), { attributes: true, attributeFilter: ['hidden'] });

// ---------------- header actions ----------------
$('#runBtn').addEventListener('click', () => { run(true); });
const liveToggle = $('#liveToggle');
liveToggle.checked = state.live;
liveToggle.addEventListener('change', () => {
  state.live = liveToggle.checked;
  saveState();
  if (state.live) run(false); else markDirty();
});
$('#sketchName').value = state.name;
$('#sketchName').addEventListener('input', e => { state.name = e.target.value; saveState(); });
$('#sketchName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(true); }
  if (e.key === 'Escape') closePopovers();
});

// ---------------- popovers ----------------
function openPopover(pop, anchor) {
  closePopovers();
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  // open upward when there's no room below (the table dock sits at the bottom)
  pop.style.top = (r.bottom + 8 + h > window.innerHeight - 8 ? Math.max(8, r.top - 8 - h) : r.bottom + 8) + 'px';
  pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left)) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  pop._anchor = anchor;
  const first = pop.querySelector('[aria-checked="true"]') || pop.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}
function closePopovers() {
  for (const p of document.querySelectorAll('.popover')) {
    if (!p.hidden) { p.hidden = true; p._anchor?.setAttribute('aria-expanded', 'false'); }
  }
}
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.popover') && !e.target.closest('#examplesBtn') && !e.target.closest('#menuBtn') && !e.target.closest('#debugBtn') && !e.target.closest('#speedBtn')) closePopovers();
});

function buildExamples() {
  const pop = $('#examplesPop');
  for (const g of EXAMPLES) {
    const sec = document.createElement('div');
    sec.className = 'ex-group';
    const h = document.createElement('h3');
    h.textContent = g.group;
    sec.append(h);
    if (g.note) {
      const note = document.createElement('p');
      note.className = 'ex-note';
      note.textContent = g.note;
      sec.append(note);
    }
    for (const ex of g.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="t"></span><span class="b"></span>`;
      b.querySelector('.t').textContent = ex.title;
      b.querySelector('.b').textContent = ex.blurb || ex.file.split('/').pop();
      if (ex.about) b.title = `${ex.about}\n\n${ex.players} ${ex.players === '1' ? 'player' : 'players'} · ${ex.time}`;
      b.addEventListener('click', () => { closePopovers(); openExample(ex); });
      sec.append(b);
    }
    pop.append(sec);
  }
  const foot = document.createElement('div');
  foot.className = 'ex-foot';
  foot.innerHTML = '<button type="button" class="btn ghost">Open from GitHub…</button>';
  foot.querySelector('button').addEventListener('click', openGitHub);
  pop.append(foot);
}
buildExamples();
$('#examplesBtn').addEventListener('click', e => {
  const pop = $('#examplesPop');
  if (!pop.hidden) closePopovers(); else openPopover(pop, e.currentTarget);
});
$('#debugBtn').addEventListener('click', e => {
  const pop = $('#debugPop');
  if (!pop.hidden) closePopovers(); else openPopover(pop, e.currentTarget);
});
$('#menuBtn').addEventListener('click', e => {
  const pop = $('#menuPop');
  if (!pop.hidden) closePopovers(); else openPopover(pop, e.currentTarget);
});

// Has the sketch been changed since it was opened? Blocks add a header line, which isn't a change.
const plain = code => code.replace(/^\/\/ Made with blocks in the Blinks Playground\n+/, '').trim();
function modified() {
  if (state.files) return JSON.stringify(state.files) !== state.source;
  const code = plain(state.code);
  return code && code !== plain(state.source ?? '') && code !== plain(STARTER);
}

// In-app confirm: the browser's own confirm dialog is blocked in some embedded browsers,
// which silently cancelled every example load.
// An optional title and list of points turn it into a short explainer. With `optOut`, a
// "Don't show this again" box; if it's ticked when OK is chosen, optOut() is called.
function ask(message, okLabel, { title = '', points = [], optOut = null } = {}) {
  const d = $('#confirmDialog');
  d.innerHTML = `<form method="dialog">${title ? '<h2></h2>' : ''}<p></p>${points.length ? '<ul></ul>' : ''}<div class="actions">
    ${optOut ? '<label class="opt-out"><input type="checkbox"> Don’t show this again</label>' : ''}
    <button class="btn ghost" value="cancel">Cancel</button>
    <button class="btn primary" value="ok"></button></div></form>`;
  if (title) d.querySelector('h2').textContent = title;
  d.querySelector('p').textContent = message;
  for (const point of points) d.querySelector('ul').appendChild(document.createElement('li')).textContent = point;
  d.querySelector('.primary').textContent = okLabel;
  return new Promise(resolve => {
    d.addEventListener('close', () => {
      const ok = d.returnValue === 'ok';
      if (ok && optOut && d.querySelector('.opt-out input').checked) optOut();
      resolve(ok);
    }, { once: true });
    d.onclick = e => { if (e.target === d) d.close(); };
    d.returnValue = '';
    d.showModal();
    d.querySelector('.primary').focus();
  });
}
const title = () => state.name.trim() || 'untitled';
const replaceOk = what => !modified() || ask(`Replace your changes to “${title()}” with ${what}? Download your sketch first if you want to keep it.`, 'Replace');

async function openExample(ex) {
  if (!await replaceOk(`the “${ex.title}” example`)) return;
  let text;
  try {
    const res = await fetch('examples/' + ex.file);
    if (!res.ok) throw new Error(res.status);
    text = await res.text();
  } catch (e) {
    toast('Couldn\'t load that example');
    return;
  }
  loadSketch(text, ex.title, ex.layout);
}

// `sketch` is the code of a one-file sketch, or { files, main } for one of several files. The
// SDK it's written for is guessed from its code unless given.
function loadSketch(sketch, name, layout, sdk) {
  const multi = typeof sketch !== 'string';
  state.files = multi ? { ...sketch.files } : null;
  state.main = state.file = multi ? sketch.main : null;
  state.code = multi ? state.files[state.main] : sketch;
  state.source = multi ? JSON.stringify(state.files) : sketch;
  state.sdk = SDKS[sdk] ? sdk : detectSdk(multi ? state.files : { sketch });
  state.name = name;
  state.blocksStale = true;
  $('#sketchName').value = name;
  editor.setValue(state.code, state.file);
  renderFileTabs();
  renderFlags();
  if (state.files && state.view === 'blocks') setView('code');
  con.clear();
  if (layout) setCells(Array.isArray(layout) ? layout : LAYOUTS[layout](world.blinks.length).map(([q, r]) => [q, r, 0]));
  runtimeDiags.clear();
  run(true);
  if (state.view === 'blocks') { state.view = 'code'; setView('blocks'); }
  saveState();
}

$('#menuPop').addEventListener('click', async e => {
  const a = e.target.closest('[data-action]')?.dataset.action;
  if (!a) return;
  closePopovers();
  if (a === 'new') {
    if (!await replaceOk('a new sketch')) return;
    loadSketch(STARTER, 'My sketch', null);
  } else if (a === 'open') {
    $('#fileInput').click();
  } else if (a === 'github') {
    openGitHub();
  } else if (a === 'download') {
    // a sketch of several files: a .zip of its folder, named after its main .ino as Arduino wants
    const folder = state.files ? state.main.replace(/\.ino$/i, '') : '';
    const blob = state.files
      ? new Blob([zip(Object.entries(state.files).map(([path, text]) => [folder + '/' + path, text]))], { type: 'application/zip' })
      : new Blob([state.code], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = state.files ? folder + '.zip' : (title().replace(/[^\w-]+/g, '') || 'untitled') + '.ino';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } else if (a === 'upload') {
    openUpload();
  } else if (a === 'library') {
    openPopover($('#libPop'), $('#menuBtn'));
  } else if (a === 'share') {
    const url = await shareLink();
    try { await navigator.clipboard.writeText(url); toast('Link copied — anyone with it can open this sketch'); }
    catch (err) { prompt('Copy this link:', url); }
  } else if (a === 'arrangement') {
    const text = arrangementText();
    try { await navigator.clipboard.writeText(text); toast('Arrangement copied: paste it into an example in js/examples.js'); }
    catch (err) { prompt('Copy this arrangement:', text); }
  } else if (a === 'help') {
    showHelp();
  }
});
// Open files picked or dropped: one is a sketch; several are the files of one, with an .ino first
async function openLocal(list) {
  const fs = [...list].filter(f => /\.(ino|h|hh|hpp|c|cc|cpp|txt)$/i.test(f.name));
  if (!fs.length) return;
  if (fs.length === 1) {
    const text = await fs[0].text();
    if (!await replaceOk(fs[0].name)) return;
    loadSketch(text, fs[0].name.replace(/\.\w+$/, ''), null);
    return;
  }
  const main = fs.find(f => /\.ino$/i.test(f.name));
  if (!main) { toast('Pick a sketch’s .ino file along with its other files'); return; }
  const files = {};
  for (const f of fs) files[f.name] = (await f.text()).replace(/\r\n?/g, '\n');
  if (!await replaceOk(main.name)) return;
  loadSketch({ files, main: main.name }, main.name.replace(/\.ino$/i, ''), null);
}
$('#fileInput').addEventListener('change', async e => {
  const list = [...e.target.files];
  e.target.value = '';
  await openLocal(list);
});
// drop sketch files anywhere
document.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', async e => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  await openLocal(e.dataTransfer.files);
});

// ---------------- open from GitHub ----------------
const GH_KEY = 'blinks.playground.github';
function openGitHub() {
  closePopovers();
  const d = $('#githubDialog');
  d.innerHTML = `<form class="gh" autocomplete="off">
    <button type="button" class="btn icon ghost close" aria-label="Close"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg></button>
    <h2>Open from GitHub</h2>
    <p class="gh-hint">Paste a link to a public repository, a folder in one, or a .ino file.</p>
    <div class="gh-row"><input class="gh-url" type="text" spellcheck="false" autocapitalize="off" placeholder="github.com/owner/repository" aria-label="GitHub link"><button class="btn primary gh-go" type="submit">Open</button></div>
    <div class="gh-status" role="status"></div>
    <div class="gh-list"></div>
  </form>`;
  const input = d.querySelector('.gh-url'), status = d.querySelector('.gh-status'), list = d.querySelector('.gh-list');
  try { input.value = localStorage.getItem(GH_KEY) || ''; } catch (e) { /* storage blocked: fine */ }
  const say = (text, err) => { status.textContent = text; status.classList.toggle('err', !!err); };
  d.querySelector('.close').onclick = () => d.close();
  d.onclick = e => { if (e.target === d) d.close(); };
  let latest = 0;
  let modules = [];
  const open = async (g, path, paths) => {
    say(`Loading ${path}…`);
    const s = await loadFromGitHub(g, path, paths, modules);
    d.close();
    if (!await replaceOk(`“${s.name}” from GitHub`)) return;
    loadSketch(s.files ? { files: s.files, main: s.main } : s.code, s.name, null);
    con.add('info', `Opened ${s.url}`);
    if (s.files) {
      const n = Object.keys(s.files).length;
      con.add('info', `${n} files, built the way the Arduino IDE builds a sketch folder${s.submodules.length ? `, with the submodule${s.submodules.length === 1 ? '' : 's'} ${s.submodules.join(', ')}` : ''}.`);
    } else if (s.combined.length) con.add('info', `Combined with ${s.combined.join(', ')} into one sketch, the way Arduino builds a sketch folder.`);
    if (state.sdk !== 'move38') con.add('info', `Written for ${SDKS[state.sdk].name} (${SDKS[state.sdk].url}), so it runs with that blinklib. Change it in the menu, under Blinks library.`);
    toast(`Opened ${s.name} from GitHub`);
  };
  d.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    list.replaceChildren();
    const g = parseGitHub(input.value);
    if (!g) { say('That doesn’t look like a GitHub link. Try github.com/owner/repository.', true); return; }
    try { localStorage.setItem(GH_KEY, input.value.trim()); } catch (err) { /* fine */ }
    const run = ++latest;
    say('Looking on GitHub…');
    try {
      // the whole file list lets a sketch bring its other tabs and headers along
      let files = null;
      try { files = await repoFiles(g); } catch (err) { if (!g.file) throw err; }
      if (run !== latest) return;
      modules = (files && files.submodules) || [];
      const at = { ...g, ref: (files && files.ref) || g.ref };
      if (g.file) { await open(at, g.path, files && files.paths); return; }
      const found = sketchesIn(files.paths, g.path, g.repo);
      if (!found.length) { say(`No .ino sketches ${g.path ? 'in that folder' : 'in that repository'}.`, true); return; }
      if (found.length === 1) { await open(at, found[0], files.paths); return; }
      say(`${found.length} sketches${files.truncated ? ' (the repository is large, so some may be missing)' : ''}. Pick one:`);
      for (const path of found) {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<span class="t"></span><span class="b"></span>';
        b.querySelector('.t').textContent = path.split('/').pop().replace(/\.ino$/i, '');
        b.querySelector('.b').textContent = path;
        b.onclick = () => open(at, path, files.paths).catch(err => say(err instanceof GitHubError ? err.message : 'Couldn’t open that sketch.', true));
        list.append(b);
      }
    } catch (err) {
      if (run !== latest) return;
      if (!(err instanceof GitHubError)) console.error(err);
      say(err instanceof GitHubError ? err.message : 'Couldn’t open that from GitHub.', true);
    }
  };
  d.showModal();
  input.focus();
  input.select();
}

// The Blinks on the table as an example's layout: [q, r] or [q, r, rotation] each, centered on 0, 0
function arrangementText() {
  const bs = world.blinks, n = bs.length || 1;
  const dq = Math.round(bs.reduce((s, b) => s + b.q, 0) / n), dr = Math.round(bs.reduce((s, b) => s + b.r, 0) / n);
  const cells = bs.map(b => [b.q - dq, b.r - dr, b.rot]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return `layout: [${cells.map(([q, r, rot]) => `[${q}, ${r}${rot ? ', ' + rot : ''}]`).join(', ')}]`;
}

// ---------------- share links ----------------
async function shareLink() {
  const sketch = state.files ? { f: state.files, m: state.main } : { c: state.code };
  const payload = JSON.stringify({ n: state.name, ...sketch, s: state.sdk, b: world.blinks.map(b => [b.q, b.r, b.rot]) });
  const bytes = new TextEncoder().encode(payload);
  let encoded;
  if (typeof CompressionStream !== 'undefined') {
    const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(cs).arrayBuffer());
    encoded = 'z' + b64url(buf);
  } else encoded = 'p' + b64url(bytes);
  return location.origin + location.pathname + '#s=' + encoded;
}
async function readShareLink() {
  const m = /#s=([zp])([\w-]+)/.exec(location.hash);
  if (!m) return null;
  try {
    let bytes = unb64url(m[2]);
    if (m[1] === 'z') {
      const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(ds).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
}
function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

// ---------------- table controls ----------------
$('#addBlink').addEventListener('click', () => {
  const [q, r] = nextCell(world);
  world.addBlink(q, r, 0);
  updateCount(); board.fit(); saveState();
});
$('#removeBlink').addEventListener('click', () => {
  if (world.blinks.length <= 1) return;
  const b = world.blinks.reduce((a, x) => x.id > a.id ? x : a);
  world.removeBlink(b);
  updateCount(); board.fit(); saveState();
});
document.querySelectorAll('#layouts [data-layout]').forEach(btn => btn.addEventListener('click', () => {
  const n = world.blinks.length;
  setCells(LAYOUTS[btn.dataset.layout](n).map(([q, r]) => [q, r, 0]));
}));
$('#shuffleRot').addEventListener('click', () => {
  for (const b of world.blinks) b.rot = Math.floor(Math.random() * 6);
  saveState();
});
// debug view: none, a tooltip on hover, or every face's sent value drawn on the Blinks
function setDebug(mode) {
  state.debug = mode;
  board.debug = mode;
  $('#debugBtn').classList.toggle('on', mode !== 'none');
  for (const b of document.querySelectorAll('#debugPop [data-debug]')) b.setAttribute('aria-checked', b.dataset.debug === mode);
  saveState();
}
setDebug(state.debug);
// face values as numbers or as bits, in the tooltip and on the Blinks
function setBits(on) {
  state.bits = on;
  board.bits = on;
  for (const b of document.querySelectorAll('#debugPop [data-bits]')) b.setAttribute('aria-checked', b.dataset.bits === (on ? '1' : '0'));
  saveState();
}
setBits(state.bits);
$('#debugPop').addEventListener('click', e => {
  const bits = e.target.closest('[data-bits]');
  if (bits) { setBits(bits.dataset.bits === '1'); return; }
  const b = e.target.closest('[data-debug]');
  if (!b) return;
  closePopovers();
  setDebug(b.dataset.debug);
});
$('#restartBtn').addEventListener('click', () => {
  runtimeDiags.clear();
  refreshDiagnostics();
  if (state.compiled) { world.restart(); setStatus('ok', runningText()); }
});
const pauseBtn = $('#pauseBtn');
pauseBtn.addEventListener('click', () => setPaused(!state.paused));
function setPaused(p) {
  state.paused = p;
  pauseBtn.classList.toggle('paused', p);
  pauseBtn.setAttribute('aria-label', p ? 'Play' : 'Pause');
  pauseBtn.title = p ? 'Play' : 'Pause time';
  $('#stepBtn').disabled = !p;
  if (p) setStatus('paused', 'Paused');
  else if (state.compiled) showCompile(state.compiled, true);
  renderFlags();
}
$('#stepBtn').addEventListener('click', () => world.advance(16));
// full screen: hide the code and the console, and fill the screen if the browser lets us
const fullBtn = $('#fullBtn');
fullBtn.addEventListener('click', () => setFull(!$('#app').classList.contains('full')));
function setFull(on) {
  $('#app').classList.toggle('full', on);
  fullBtn.setAttribute('aria-pressed', on);
  fullBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  fullBtn.title = on ? 'Show the code and console (F)' : 'Full screen: just the Blinks (F)';
  const el = document.documentElement;
  if (on && !document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
// leaving the browser's full screen (Esc) leaves ours too
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) setFull(false); });
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable], .editor-pane, dialog')) return;
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setFull(!$('#app').classList.contains('full')); }
  else if (e.key === 'Escape' && $('#app').classList.contains('full') && !document.querySelector('.popover:not([hidden])')) setFull(false);
}, true);   // before the handler that closes popovers on Escape, so Escape closes an open popover first
// time menu: the speed, and how far apart the Blinks' clocks drift
const speedLabel = s => (s === 0.25 ? '¼' : s === 0.5 ? '½' : s) + '×';
function setSpeed(s, init) {
  state.speed = s;
  $('#speedVal').textContent = speedLabel(s);
  for (const b of document.querySelectorAll('#timePop [data-speed]')) b.setAttribute('aria-checked', +b.dataset.speed === s);
  if (!init) renderFlags();
}
setSpeed(state.speed, true);
$('#speedBtn').addEventListener('click', e => {
  const pop = $('#timePop');
  if (!pop.hidden) closePopovers(); else openPopover(pop, e.currentTarget);
});
$('#timePop').addEventListener('click', e => {
  const b = e.target.closest('[data-speed]');
  if (!b) return;
  closePopovers();
  setSpeed(+b.dataset.speed);
});
// drift never goes to zero: no two real Blinks keep the same time. It snaps to the typical amount.
const driftRange = $('#driftRange');
driftRange.min = DRIFT.min * 100; driftRange.max = DRIFT.max * 100;
driftRange.parentElement.style.setProperty('--at', (DRIFT.typical - DRIFT.min) / (DRIFT.max - DRIFT.min));
function setDrift(d) {
  state.drift = d;
  world.drift = d;
  driftRange.value = (d * 100).toFixed(1);
  $('#driftVal').textContent = `±${(d * 100).toFixed(1)}%`;
  saveState();
}
setDrift(state.drift);
driftRange.addEventListener('input', () => {
  let pct = +driftRange.value;
  if (Math.abs(pct - DRIFT.typical * 100) <= 0.35) pct = DRIFT.typical * 100;
  setDrift(pct / 100);
});

// typing into the console sends bytes to the last Blink you touched, like the Arduino serial monitor
$('#serialForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#serialInput');
  const target = (board.lastTouched && world.blinks.includes(board.lastTouched)) ? board.lastTouched : world.blinks[0];
  if (!target || !input.value) return;
  for (const ch of new TextEncoder().encode(input.value)) target.serialIn.push(ch);
  con.add('info', `→ #${target.id}: ${input.value}`);
  input.value = '';
});

// console collapse
const consoleEl = $('#console');
function setConsole(open) {
  state.consoleOpen = open;
  consoleEl.classList.toggle('collapsed', !open);
  $('#toggleConsole').setAttribute('aria-expanded', open);
  saveState();
}
setConsole(state.consoleOpen);
$('#toggleConsole').addEventListener('click', () => setConsole(!state.consoleOpen));
$('#clearConsole').addEventListener('click', () => con.clear());

// splitter
const work = $('#work');
if (state.split) document.documentElement.style.setProperty('--split', state.split);
$('#splitter').addEventListener('pointerdown', e => {
  const sp = e.currentTarget;
  sp.setPointerCapture(e.pointerId);
  sp.classList.add('drag');
  const rect = work.getBoundingClientRect();
  const move = ev => {
    const pct = Math.max(24, Math.min(70, (ev.clientX - rect.left) / rect.width * 100));
    state.split = pct.toFixed(1) + '%';
    document.documentElement.style.setProperty('--split', state.split);
  };
  const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); saveState(); editor.refresh(); blocks?.resize(); };
  sp.addEventListener('pointermove', move);
  sp.addEventListener('pointerup', up);
});

// ---------------- inspector (hover a Blink) ----------------
const insp = $('#inspector');
let inspAt = 0, inspFor = null, inspLeaving = null;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches || !insp.animate;
// it grows out of the Blink with a little bounce, and shrinks back into it
const inspOrigin = () => `var(--caret, 50%) ${insp.classList.contains('below') ? 'top' : 'bottom'}`;
function inspectorIn() {
  if (calm()) return;
  insp.style.transformOrigin = inspOrigin();
  insp.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, offset: 0.4 }, { opacity: 1, transform: 'scale(1)' }],
    { duration: 300, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
}
function inspectorOut() {
  if (insp.hidden || inspLeaving) return;
  if (calm()) { insp.hidden = true; inspFor = null; return; }
  insp.style.transformOrigin = inspOrigin();
  const anim = inspLeaving = insp.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.7)' }],
    { duration: 140, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
  anim.finished.then(() => {
    if (inspLeaving !== anim) return;   // shown again before it finished
    inspLeaving = null;
    insp.hidden = true;
    inspFor = null;
    anim.cancel();
  }, () => {});
}
function updateInspector(now) {
  const b = state.debug === 'tooltip' ? board.hover : null;
  if (!b || board.dragging || !world.blinks.includes(b)) {
    inspectorOut();
    // it follows its Blink while it shrinks away
    if (inspLeaving && inspFor && world.blinks.includes(inspFor)) placeInspector(inspFor);
    return;
  }
  // a new Blink, or the same one again while the card was leaving: it bounces in
  const fresh = b !== inspFor || insp.hidden || inspLeaving;
  if (inspLeaving) { inspLeaving.cancel(); inspLeaving = null; }
  if (!fresh && now - inspAt < 120) { placeInspector(b); return; }
  inspAt = now;
  inspFor = b;
  const quiet = isQuiet(b);
  const rows = b.faces.map((f, i) => {
    const linked = !quiet && !(f.expireTime < b.now);
    return `<tr><td>${i}</td><td class="${quiet ? 'off' : ''}">${quiet ? '—' : faceValue(f.outValue)}</td><td class="${linked ? '' : 'off'}">${linked ? faceValue(f.inValue) : '—'}</td></tr>`;
  }).join('');
  const mode = { run: '', sleeping: ' · going to sleep', sleep: ' · asleep', waking: ' · waking up', crashed: ' · stopped', seeding: ' · sharing', seedspin: ' · hold to share', idle: '' }[b.mode] || '';
  const rate = (world.clockRate(b) - 1) * 100;
  const clock = world.drift ? ` · clock ${rate >= 0 ? '+' : '−'}${Math.abs(rate).toFixed(1)}%` : '';
  insp.innerHTML = `<h4>Blink #${b.id}<span>${(b.millis / 1000).toFixed(1)} s${clock}${mode}</span></h4>
    <table><tr><th>face</th><th>sends</th><th>hears</th></tr>${rows}</table>
    ${b.error ? `<div class="err">${b.error.message.replace(/[<>&]/g, '')}</div>` : ''}`;
  insp.hidden = false;
  placeInspector(b);
  if (fresh) inspectorIn();
}
// How many bits a face value has: six with Move38's blinklib (0 to 63), a byte (or the game's own
// type) with Custom Blinklib
function valueBits() {
  const sdk = state.compiled && state.compiled.sdk;
  return sdk && sdk.id === 'bga' ? Math.min(16, sdk.value.size * 8) : 6;
}
// A face value: its number, or its bits as dots, the highest first
const faceValue = v => (state.bits ? bitDots(v) : v);
function bitDots(v) {
  let dots = '';
  for (let bit = valueBits() - 1; bit >= 0; bit--) dots += `<i class="${(v >> bit) & 1 ? 'on' : ''}"></i>`;
  return `<span class="bit-dots" title="${v}">${dots}</span>`;
}
// Float the card above the Blink with its caret pointing down at it (below, if there's no room above)
function placeInspector(b) {
  const [x, y] = board.pos(b);
  const reach = board.view.S * 0.84 + 12;   // the Blink's top edge, plus room for the caret
  const w = insp.offsetWidth, h = insp.offsetHeight;
  const below = y - reach - h < 8;
  const left = Math.max(8, Math.min(board.W - w - 8, x - w / 2));
  insp.classList.toggle('below', below);
  insp.style.left = left + 'px';
  insp.style.top = (below ? y + reach : y - reach - h) + 'px';
  insp.style.setProperty('--caret', Math.max(16, Math.min(w - 16, x - left)) + 'px');
}

// ---------------- comms value tip (hover a face's value) ----------------
// In the comms view, hovering a face's value shows it the other way: a number's bits, or bits' number
const chipTip = $('#chipTip');
let chipShown = '';
function updateChipTip() {
  const hc = state.debug === 'comms' && !board.dragging ? board.hoverChip : null;
  const ch = hc && world.blinks.includes(hc.b) && !isQuiet(hc.b) ? board.commsChips(hc.b)[hc.f] : null;
  if (!ch) { chipTip.hidden = true; chipShown = ''; return; }
  const shown = `${state.bits}:${ch.v}`;
  if (shown !== chipShown) { chipShown = shown; chipTip.innerHTML = state.bits ? String(ch.v) : bitDots(ch.v); }
  chipTip.hidden = false;
  // just above the chip, however it's turned
  const reach = Math.abs(ch.w / 2 * Math.sin(ch.rot)) + Math.abs(ch.h / 2 * Math.cos(ch.rot)) + 8;
  chipTip.style.left = (ch.x - chipTip.offsetWidth / 2) + 'px';
  chipTip.style.top = (ch.y - reach - chipTip.offsetHeight) + 'px';
}

// ---------------- flags (paused / slowed) ----------------
let slowFactor = 1, asleep = 0, crashed = 0, flagCheck = 0;
function checkModes(now) {
  if (now - flagCheck < 400) return;
  flagCheck = now;
  let s = 0, c = 0;
  for (const b of world.blinks) { if (b.mode === 'sleep') s++; else if (b.mode === 'crashed') c++; }
  if (s !== asleep || c !== crashed) { asleep = s; crashed = c; renderFlags(); }
}
function renderFlags() {
  const f = $('#simFlags');
  const items = [];
  if (state.engine === 'hardware') items.push([hardwareActive() ? 'Hardware-exact · ATmega168PB' : 'Hardware-exact · loading', '']);
  if (state.sdk !== 'move38') items.push([SDKS[state.sdk].name, '']);
  if (state.paused) items.push(['Paused', 'warn']);
  const sp = state.speed;
  if (sp !== 1 && !state.paused) items.push([`${sp}× speed`, '']);
  if (slowFactor < 0.95 && !state.paused) items.push([`Running at ${(slowFactor * sp).toFixed(1)}× — too many Blinks for this computer`, 'warn']);
  if (asleep) items.push([asleep === world.blinks.length ? 'Asleep · press a Blink to wake it' : `${asleep} asleep`, '']);
  if (crashed) items.push([`${crashed === world.blinks.length ? 'Stopped' : crashed + ' stopped'} · see the console`, 'warn']);
  f.innerHTML = items.map(([t, c]) => `<span class="flag ${c}">${t}</span>`).join('');
}

// ---------------- main loop ----------------
let last = performance.now();
let costPerMs = 0.02;
function frame(now) {
  const dt = Math.min(100, now - last);
  last = now;
  if (!state.paused && world.program) {
    let simDt = dt * state.speed;
    const budget = 12;
    const allowed = budget / costPerMs;
    const capped = simDt > allowed;
    if (capped) simDt = allowed;
    const t0 = performance.now();
    world.advance(simDt);
    const spent = performance.now() - t0;
    if (simDt > 1) costPerMs = costPerMs * 0.9 + (spent / simDt) * 0.1;
    const f = capped ? simDt / (dt * state.speed) : 1;
    const nf = slowFactor * 0.95 + f * 0.05;
    if (Math.abs(nf - slowFactor) > 0.01 || (slowFactor < 0.95) !== (nf < 0.95)) { slowFactor = nf; renderFlags(); }
    else slowFactor = nf;
  }
  board.draw(now);
  updateInspector(now);
  updateChipTip();
  checkModes(now);
  requestAnimationFrame(frame);
}

// ---------------- help ----------------
function showHelp() {
  const d = $('#helpDialog');
  d.innerHTML = `
    <button class="btn icon ghost close" aria-label="Close"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg></button>
    <h2>How the simulator works</h2>
    <p>Your sketch is compiled in the browser by a C++ compiler built for Blinks, then every Blink on the table runs its own copy, with its own memory, just like real hardware.</p>
    <h3>Just like a real Blink</h3>
    <ul>
      <li><code>int</code> is 16 bits, <code>long</code> is 32 bits and numbers overflow the same way. A Blink has about ${1024 - 694} bytes of memory for your variables.</li>
      <li>The button follows the Blinks BIOS: 330&nbsp;ms to tell clicks apart, long press after 1.2&nbsp;s. Holding a Blink that is alone for 3&nbsp;s shares its game; 6&nbsp;s puts the group to sleep.</li>
      <li>Faces send their value about every loop. A face counts as expired 200&nbsp;ms after it last heard anything, and <code>getLastValueReceivedOnFace()</code> keeps the old value.</li>
      <li><code>random()</code> gives every Blink the same numbers until you call <code>randomize()</code>, which takes half a second.</li>
      <li>Blinks fall asleep after 10 minutes without a button press, and wake when you press one.</li>
      <li>To print to the console, add <code>#include "Serial.h"</code> and <code>ServicePortSerial Serial;</code> to your sketch and call <code>Serial.begin()</code> in <code>setup()</code>, as on a Blink with a dev cable.</li>
    </ul>
    <h3>Using the table</h3>
    <ul>
      <li>Press the center of a Blink to press its button. <kbd>Space</kbd> presses the last Blink you touched.</li>
      <li>Drag a Blink by its rim to move it. Drop it on the bin to remove it. Double-click the table to add one.</li>
      <li>Right-click or press <kbd>R</kbd> to rotate a Blink. Real Blinks can be turned any way, so test your game with rotated Blinks.</li>
      <li>The debug button under the table picks what you see: <b>Tooltip</b> shows what each face sends and hears when you hover a Blink, <b>Comms</b> shows every face's value on the Blinks themselves (blue when a neighbor hears it), and each datagram as a bubble showing its bytes. It ends in a green check when the neighbor gets it, a red X when it's dropped because the last one wasn't read yet, and is grey when nobody is there. The switch at the top right of that menu shows face values as numbers or as six dots, their bits, highest first: a lit dot is a 1.</li>
      <li>Real Blinks don't keep exactly the same time: each one's clock runs a little fast or slow. The simulator does the same, so timers on different Blinks drift apart. The speed menu (under the table) has a slider to make the drift bigger or smaller.</li>
      <li>The full screen button at the end of the controls under the table, or <kbd>F</kbd>, hides the code and the console so the table fills the screen. Press it again, or <kbd>Esc</kbd>, to come back.</li>
    </ul>
    <h3>Sketches of several files</h3>
    <p>A sketch with <code>.cpp</code> files, a <code>src/</code> folder or a <code>config/</code> folder opens with its files in tabs over the code. It's built the way the Arduino IDE builds a sketch folder, namespaces and all. An error shows the file it's in. Download saves the folder as a .zip. Blocks show sketches that are one file.</p>
    <h3>Blinks library</h3>
    <p>Most sketches use Move38's blinklib. A few games are written for Bruno Albuquerque's Custom Blinklib, whose faces send whole bytes and whose datagrams are resent until they arrive. The playground picks it when a sketch mentions it, and the ⋯ menu's Blinks library switches.</p>
    <h3>When it says no</h3>
    <p>If something would not work on a real Blink, the simulator tells you: code that doesn't compile, a loop that never ends, an array index out of range, or a face number above 5.</p>
    <h3>Hardware-exact</h3>
    <p>The chip button under the table switches to hardware-exact mode. Your sketch is compiled by avr-gcc, the compiler the Arduino IDE uses for Blinks, and every Blink is an emulated ATmega168PB chip running the real BlinkBIOS and blinklib. Timing, IR and sleep are the real thing, and the console shows how much flash and RAM the game really uses. The first time, it downloads about 6&nbsp;MB.</p>
    <p>The simulator's checks (loops that never end, array indexes, face numbers) don't happen there, just as on a real Blink, and a big table runs slower than real time. Sharing a game sends all of it over IR, as on real Blinks, so it takes about 20 s. The BIOS allows two Blinks' clocks to be at most 5% apart, so with the clock drift slider above ±2.5% some Blinks can't share.</p>`;
  d.querySelector('.close').onclick = () => d.close();
  d.onclick = e => { if (e.target === d) d.close(); };
  d.showModal();
}

let toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------- start ----------------
(async function start() {
  const shared = await readShareLink();
  const sharedFiles = shared && shared.f && typeof shared.f === 'object' && shared.m in shared.f;
  if (shared && (typeof shared.c === 'string' || sharedFiles)) {
    history.replaceState(null, '', location.pathname);
    setCells(Array.isArray(shared.b) && shared.b.length ? shared.b : LAYOUTS.flower());
    loadSketch(sharedFiles ? { files: shared.f, main: shared.m } : shared.c, shared.n || 'Shared sketch', null, shared.s);
  } else {
    if (!saved.code) state.source = STARTER;
    setCells(Array.isArray(saved.cells) && saved.cells.length ? saved.cells : LAYOUTS.flower().map(([q, r]) => [q, r, 0]));
    if (state.files) {
      if (!(state.file in state.files)) state.file = state.main;
      state.code = state.files[state.file];
    }
    editor.setValue(state.code, state.file);
    renderFileTabs();
    renderFlags();
  }
  board.fit(false);
  run(true);
  setView(state.view);
  requestAnimationFrame(frame);
  // hardware-exact mode loads in the background; the simulator runs the sketch meanwhile
  if (state.engine === 'hardware') setEngine('hardware');
})();

// handy for poking at the simulation from the browser console
window.playground = { get world() { return world; }, board, state, compile, compileSketch, setEngine, shareLink };
