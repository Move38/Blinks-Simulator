/*
 * Blinks Playground: wires the editor (code or blocks), the compiler, the simulated
 * Blinks and the console together. Everything runs in the browser.
 */

import { compile } from './compiler/index.js';
import { World } from './runtime/world.js';
import { Board, LAYOUTS, nextCell } from './ui/board.js';
import { createCodeEditor } from './ui/editor.js';
import { Console } from './ui/console.js';
import { EXAMPLES, STARTER } from './examples.js';

const $ = s => document.querySelector(s);
const STORE = 'blinks.playground.v2';
const SPEEDS = [1, 2, 4, 0.25, 0.5];

// ---------------- state ----------------
const saved = loadState();
const state = {
  code: saved.code ?? STARTER,
  name: saved.name ?? 'My sketch',
  view: saved.view === 'blocks' ? 'blocks' : 'code',
  live: saved.live ?? true,
  faces: !!saved.faces,
  consoleOpen: saved.consoleOpen ?? true,
  split: saved.split ?? null,
  source: saved.source ?? null,     // the example (or starter) text this sketch started from
  speedIdx: 0,
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
        code: state.code, name: state.name, view: state.view, live: state.live, faces: state.faces,
        consoleOpen: state.consoleOpen, split: state.split, source: state.source,
        cells: world.blinks.map(b => [b.q, b.r, b.rot]),
      }));
    } catch (e) { /* storage full or blocked: fine */ }
  }, 300);
}

// ---------------- simulation ----------------
const con = new Console($('#consoleBody'), { onJump: line => { setView('code'); editor.focusLine(line); } });
const runtimeDiags = new Map();

const world = new World({
  onSerial: (b, text) => con.add('out', text, { who: b.id }),
  onError: (b, err) => {
    con.add('err', err.message, { who: b.id, line: err.line });
    if (!runtimeDiags.has(err.message)) {
      runtimeDiags.set(err.message, { line: err.line || 1, message: err.message, runtime: true });
      refreshDiagnostics();
    }
    setStatus('err', err.line ? `Stopped on line ${err.line}` : 'Stopped: runtime error');
  },
  onWarn: (b, message, line) => con.add('warn', message, { who: b.id, line }),
  onSeed: b => con.add('info', `Blink #${b.id} is sharing its game. Put other Blinks next to it to send them the game.`),
  onSeedDone: (b, n) => con.add('info', n ? `Game shared with ${n} Blink${n === 1 ? '' : 's'}. They restarted with startState() = START_STATE_DOWNLOAD_SUCCESS.` : 'Game sharing ended.'),
  onSleep: () => {},
});

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

function markDirty() {
  state.dirty = state.code !== state.running;
  $('#runBtn').classList.toggle('dirty', state.dirty && !state.live);
}

// compile only, to show errors while typing (Live off)
function check() {
  const r = compile(state.code);
  showCompile(r, false);
  return r;
}

let lastDiags = [];
function showCompile(r, ran) {
  const diags = [];
  if (!r.ok) {
    for (const e of r.errors) diags.push({ line: e.line || 1, message: e.message, severity: 'err' });
    setStatus('err', r.errors[0].line ? `Error on line ${r.errors[0].line}` : 'Error');
    statusLine = r.errors[0].line;
  } else {
    for (const w of r.warnings) diags.push({ line: w.line || 1, message: w.message, severity: 'warn', inline: r.warnings.length <= 3 });
    $('#serialForm').hidden = !r.serialInput;
    if (ran) setStatus('ok', runningText());
    else if (!state.live) setStatus('busy', state.dirty ? 'Changed — press Run' : 'Ready');
    showRam(r.ram);
  }
  lastDiags = diags;
  refreshDiagnostics();
}
function refreshDiagnostics() {
  editor.setDiagnostics(lastDiags.concat([...runtimeDiags.values()]));
}

function run(force) {
  clearTimeout(buildTimer);
  const r = compile(state.code);
  if (!r.ok) {
    showCompile(r, false);
    return false;
  }
  if (!force && state.running === state.code) { showCompile(r, true); return true; }
  runtimeDiags.clear();
  state.compiled = r;
  state.running = state.code;
  world.load(r);
  markDirty();
  showCompile(r, true);
  if (state.paused) setStatus('paused', 'Paused');
  return true;
}

let statusLine = 0;
function setStatus(kind, text) {
  const s = $('#status');
  s.className = 'status ' + kind;
  s.querySelector('.txt').textContent = text;
}
$('#status').addEventListener('click', () => { if ($('#status').classList.contains('err') && statusLine) { setView('code'); editor.focusLine(statusLine); } });

function showRam(ram) {
  const el = $('#ram');
  const pct = ram.used / ram.budget;
  el.className = 'ram' + (pct > 1 ? ' over' : pct > 0.8 ? ' high' : '');
  el.innerHTML = `<span>RAM ${ram.used} / ${ram.budget} B</span><span class="bar"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%"></i></span>`;
  el.title = pct > 1
    ? 'Your global variables use more memory than a Blink has left after blinklib. This sketch would not fit on a real Blink.'
    : 'Memory used by your global variables (and strings), out of about what a Blink has left after blinklib.';
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
  if (view === 'blocks') {
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
}

document.querySelectorAll('.seg [data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

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
  pop.style.top = (r.bottom + 8) + 'px';
  pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left)) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  pop._anchor = anchor;
  const first = pop.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}
function closePopovers() {
  for (const p of document.querySelectorAll('.popover')) {
    if (!p.hidden) { p.hidden = true; p._anchor?.setAttribute('aria-expanded', 'false'); }
  }
}
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.popover') && !e.target.closest('#examplesBtn') && !e.target.closest('#menuBtn')) closePopovers();
});

function buildExamples() {
  const pop = $('#examplesPop');
  for (const g of EXAMPLES) {
    const sec = document.createElement('div');
    sec.className = 'ex-group';
    const h = document.createElement('h3');
    h.textContent = g.group;
    sec.append(h);
    for (const ex of g.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="t"></span><span class="b"></span>`;
      b.querySelector('.t').textContent = ex.title;
      b.querySelector('.b').textContent = ex.blurb || ex.file.split('/').pop();
      b.addEventListener('click', () => { closePopovers(); openExample(ex); });
      sec.append(b);
    }
    pop.append(sec);
  }
}
buildExamples();
$('#examplesBtn').addEventListener('click', e => {
  const pop = $('#examplesPop');
  if (!pop.hidden) closePopovers(); else openPopover(pop, e.currentTarget);
});
$('#menuBtn').addEventListener('click', e => {
  const pop = $('#menuPop');
  if (!pop.hidden) closePopovers(); else openPopover(pop, e.currentTarget);
});

// Has the sketch been changed since it was opened? Blocks add a header line, which isn't a change.
const plain = code => code.replace(/^\/\/ Made with blocks in the Blinks Playground\n+/, '').trim();
function modified() {
  const code = plain(state.code);
  return code && code !== plain(state.source ?? '') && code !== plain(STARTER);
}

// In-app confirm: the browser's own confirm dialog is blocked in some embedded browsers,
// which silently cancelled every example load.
function ask(message, okLabel) {
  const d = $('#confirmDialog');
  d.innerHTML = `<form method="dialog"><p></p><div class="actions">
    <button class="btn ghost" value="cancel">Cancel</button>
    <button class="btn primary" value="ok"></button></div></form>`;
  d.querySelector('p').textContent = message;
  d.querySelector('.primary').textContent = okLabel;
  return new Promise(resolve => {
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.onclick = e => { if (e.target === d) d.close(); };
    d.returnValue = '';
    d.showModal();
    d.querySelector('.primary').focus();
  });
}
const replaceOk = what => !modified() || ask(`Replace your changes to “${state.name}” with ${what}? Download your sketch first if you want to keep it.`, 'Replace');

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

function loadSketch(code, name, layout) {
  state.code = code;
  state.source = code;
  state.name = name;
  state.blocksStale = true;
  $('#sketchName').value = name;
  editor.setValue(code);
  con.clear();
  if (layout) setCells(LAYOUTS[layout](world.blinks.length).map(([q, r]) => [q, r, 0]));
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
  } else if (a === 'download') {
    const blob = new Blob([state.code], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (state.name.trim().replace(/[^\w-]+/g, '') || 'sketch') + '.ino';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } else if (a === 'share') {
    const url = await shareLink();
    try { await navigator.clipboard.writeText(url); toast('Link copied — anyone with it can open this sketch'); }
    catch (err) { prompt('Copy this link:', url); }
  } else if (a === 'help') {
    showHelp();
  }
});
$('#fileInput').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  const text = await f.text();
  e.target.value = '';
  if (!await replaceOk(f.name)) return;
  loadSketch(text, f.name.replace(/\.\w+$/, ''), null);
});
// drop a .ino file anywhere
document.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', async e => {
  const f = e.dataTransfer.files[0];
  if (!f) return;
  e.preventDefault();
  const text = await f.text();
  if (!await replaceOk(f.name)) return;
  loadSketch(text, f.name.replace(/\.\w+$/, ''), null);
});

// ---------------- share links ----------------
async function shareLink() {
  const payload = JSON.stringify({ n: state.name, c: state.code, b: world.blinks.map(b => [b.q, b.r, b.rot]) });
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
const facesBtn = $('#facesToggle');
facesBtn.setAttribute('aria-pressed', state.faces);
board.showFaces = state.faces;
facesBtn.addEventListener('click', () => {
  state.faces = !state.faces;
  board.showFaces = state.faces;
  facesBtn.setAttribute('aria-pressed', state.faces);
  saveState();
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
$('#speedBtn').addEventListener('click', () => {
  state.speedIdx = (state.speedIdx + 1) % SPEEDS.length;
  const s = SPEEDS[state.speedIdx];
  $('#speedBtn').textContent = (s === 0.25 ? '¼' : s === 0.5 ? '½' : s) + '×';
  renderFlags();
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
let inspAt = 0;
function updateInspector(now) {
  const b = board.hover;
  if (!b || board.dragging || !world.blinks.includes(b)) { insp.hidden = true; return; }
  if (now - inspAt < 120 && !insp.hidden) return;
  inspAt = now;
  const rows = b.faces.map((f, i) => {
    const linked = !(f.expireTime < b.now);
    return `<tr><td>${i}</td><td>${f.outValue}</td><td class="${linked ? '' : 'off'}">${linked ? f.inValue : '—'}</td></tr>`;
  }).join('');
  const mode = { run: '', sleep: ' · asleep', crashed: ' · stopped', seeding: ' · sharing', seedspin: ' · hold to share', idle: '' }[b.mode] || '';
  insp.innerHTML = `<h4>Blink #${b.id}<span>${(b.millis / 1000).toFixed(1)} s${mode}</span></h4>
    <table><tr><th>face</th><th>sends</th><th>hears</th></tr>${rows}</table>
    ${b.error ? `<div class="err">${b.error.message.replace(/[<>&]/g, '')}</div>` : ''}`;
  insp.hidden = false;
  const [x, y] = board.pos(b);
  const S = board.view.S;
  const w = insp.offsetWidth, h = insp.offsetHeight;
  let left = x + S * 1.1, top = y - h / 2;
  if (left + w > board.W - 8) left = x - S * 1.1 - w;
  top = Math.max(8, Math.min(board.H - h - 8, top));
  insp.style.left = left + 'px';
  insp.style.top = top + 'px';
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
  if (state.paused) items.push(['Paused', 'warn']);
  const sp = SPEEDS[state.speedIdx];
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
    let simDt = dt * SPEEDS[state.speedIdx];
    const budget = 12;
    const allowed = budget / costPerMs;
    const capped = simDt > allowed;
    if (capped) simDt = allowed;
    const t0 = performance.now();
    world.advance(simDt);
    const spent = performance.now() - t0;
    if (simDt > 1) costPerMs = costPerMs * 0.9 + (spent / simDt) * 0.1;
    const f = capped ? simDt / (dt * SPEEDS[state.speedIdx]) : 1;
    const nf = slowFactor * 0.95 + f * 0.05;
    if (Math.abs(nf - slowFactor) > 0.01 || (slowFactor < 0.95) !== (nf < 0.95)) { slowFactor = nf; renderFlags(); }
    else slowFactor = nf;
  }
  board.draw(now);
  updateInspector(now);
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
      <li>Hover a Blink to see what each face sends and hears. The face button shows face numbers on the table.</li>
    </ul>
    <h3>When it says no</h3>
    <p>If something would not work on a real Blink, the simulator tells you: code that doesn't compile, a loop that never ends, an array index out of range, or a face number above 5.</p>`;
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
  if (shared && typeof shared.c === 'string') {
    state.code = shared.c;
    state.source = shared.c;
    state.name = shared.n || 'Shared sketch';
    $('#sketchName').value = state.name;
    history.replaceState(null, '', location.pathname);
    setCells(Array.isArray(shared.b) && shared.b.length ? shared.b : LAYOUTS.flower());
  } else {
    if (!saved.code) state.source = STARTER;
    setCells(Array.isArray(saved.cells) && saved.cells.length ? saved.cells : LAYOUTS.flower().map(([q, r]) => [q, r, 0]));
  }
  editor.setValue(state.code);
  board.fit(false);
  run(true);
  setView(state.view);
  requestAnimationFrame(frame);
})();

// handy for poking at the simulation from the browser console
window.playground = { world, board, state, compile };
