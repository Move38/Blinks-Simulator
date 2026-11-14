/*
 * Light the Board: the learning path's page. Two views, picked by the address's hash:
 *   #map          the map of worlds, and the open world's side panel
 *   #level/1.3    a level: the mission panel, the code (as blocks, code or both), and the table
 * Progress lives in this browser (js/learn/progress.js). Checks run on hidden Blinks
 * (js/learn/harness.js) every time the code changes.
 */

import { WORLDS, LEVELS, SKILLS } from './worlds/index.js';
import * as P from './progress.js';
import { drawMap } from './map.js';
import { DEFS, blinkSvg } from './blink-svg.js';
import { makeTable } from './table.js';
import { runChecks, compileLevelCode } from './harness.js';
import { createCodeEditor } from '../ui/editor.js';
import { Console } from '../ui/console.js';
import { openUploadDialog } from '../ui/upload.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// `code` spans in level text
const rich = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\b([a-zA-Z_]\w*\(\))/g, '<code>$1</code>');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

document.body.insertAdjacentHTML('afterbegin', DEFS);
let state = P.load();
const persist = () => P.save(state);

// ---------------- the map ----------------
let selWorld = null;

function showMap() {
  closeLevel();
  $('#mapView').hidden = false;
  $('#levelView').hidden = true;
  $('#crumb').hidden = true;
  $('#mapLink').hidden = true;
  document.title = 'Light the Board · Learn Blinks';
  const next = P.nextLevel(state, WORLDS);
  if (!selWorld || !P.worldOpen(state, WORLDS, selWorld)) selWorld = next ? next.world : WORLDS[WORLDS.length - 1];
  renderMap();
}

function renderMap() {
  drawMap($('#mapSvg'), {
    state, worlds: WORLDS, selected: selWorld,
    onLevel: id => go(id),
    onWorld: w => { selWorld = w; renderMap(); },
  });
  renderSide(selWorld);
}

function renderSide(w) {
  const side = $('#mapSide');
  side.style.setProperty('--wc', w.color);
  const open = P.worldOpen(state, WORLDS, w);
  const n = P.ringCount(state, w), boss = P.bossDone(state, w);
  // Continue: the next level in this world, or wherever the path goes on
  let cont = null;
  if (open) for (let i = 0; i < 7 && !cont; i++) if (P.hexState(state, WORLDS, w, i) === 'open') cont = i === 6 ? w.boss : w.levels[i];
  cont = cont || P.nextLevel(state, WORLDS);
  const skills = Object.entries(SKILLS).filter(([k]) => WORLDS.some(x => [...x.levels, x.boss].some(l => (l.skills || []).includes(k))));
  const pips = v => [0, 1, 2].map(i => `<i class="${v >= i + 1 ? 'on' : v > i ? 'half' : ''}"></i>`).join('');
  const arcade = WORLDS.filter(x => P.bossDone(state, x));
  side.innerHTML = `
    <div>
      <p class="eyebrow" style="color:${w.color}">World ${w.n}</p>
      <h2>${esc(w.name)}</h2>
      <p class="sub">${esc(w.blurb)}</p>
    </div>
    <div style="display:grid;gap:6px">
      <div class="row"><span class="muted">${n} of 6 levels</span><span class="muted">${boss ? 'Boss beaten' : n >= P.BOSS_AT ? 'Boss open' : `Boss opens at ${P.BOSS_AT}`}</span></div>
      <div class="meter">${w.levels.map((l, i) => `<i class="${P.ringDone(state, w, i) ? 'on' : ''}"></i>`).join('')}</div>
    </div>
    ${open ? '' : `<p class="sub">Beat the World ${w.n - 1} boss to open this world.</p>`}
    ${cont ? `<button class="btn primary" id="continue"><span>${n || Object.keys(state.levels).length ? 'Continue' : 'Start'}</span><span style="font-weight:600;opacity:.9">${esc(cont.id + ' ' + cont.title)}</span></button>` : ''}
    ${open && !boss && n < P.BOSS_AT ? `<button class="btn ghost" id="challenge">Challenge the boss early</button>` : ''}
    <div class="skills">
      <p class="eyebrow">Skills</p>
      ${skills.map(([k, name]) => `<div class="row"><span>${esc(name)}</span><span class="pips">${pips(state.skills[k] || 0)}</span></div>`).join('')}
    </div>
    ${arcade.length ? `<div style="display:grid;gap:8px"><p class="eyebrow">Your arcade</p><div class="row" style="justify-content:flex-start;flex-wrap:wrap">${arcade.map(x => `<a class="btn" href="#level/${encodeURIComponent(x.boss.id)}" title="Play your ${esc(x.boss.title)} again">${esc(x.boss.title)}</a>`).join('')}</div></div>` : ''}
    <div class="foot"><button class="link" id="saveCode">Save progress code</button><button class="link" id="loadCode">Load progress</button></div>`;
  $('#continue')?.addEventListener('click', () => go(cont.id));
  $('#challenge')?.addEventListener('click', () => go(w.boss.id));
  $('#saveCode').onclick = showExport;
  $('#loadCode').onclick = showImport;
}

function showExport() {
  openModal(`<p class="eyebrow">Progress code</p><h2>Take your progress with you</h2>
    <p class="muted" style="margin:0">Copy this code. On another computer, open the map, choose Load progress and paste it.</p>
    <textarea id="exportText" rows="4" readonly>${esc(P.exportCode(state))}</textarea>
    <div class="acts"><button class="btn" id="copyCode">Copy</button><button class="btn primary" data-close>Done</button></div>`);
  $('#exportText').select();
  $('#copyCode').onclick = async () => {
    try { await navigator.clipboard.writeText($('#exportText').value); $('#copyCode').textContent = 'Copied'; }
    catch (e) { $('#exportText').select(); }
  };
}
function showImport() {
  openModal(`<p class="eyebrow">Load progress</p><h2>Paste a progress code</h2>
    <p class="muted" style="margin:0">This replaces the progress in this browser.</p>
    <textarea id="importText" rows="4" placeholder="LTB1.…"></textarea>
    <p class="note" id="importErr" hidden>That code didn't work. Check that you copied all of it.</p>
    <div class="acts"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="doImport">Load</button></div>`);
  $('#importText').focus();
  $('#doImport').onclick = () => {
    const s = P.importCode($('#importText').value);
    if (!s) { $('#importErr').hidden = false; return; }
    state = s; persist(); closeModal(); selWorld = null; showMap();
  };
}

// ---------------- modal and toast ----------------
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  for (const b of $('#modalBody').querySelectorAll('[data-close]')) b.onclick = closeModal;
}
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', e => { if (e.target === $('#modal') && !$('#modal').dataset.sticky) closeModal(); });
let toastFor = null;
function toast(html, actions = []) {
  const t = $('#toast');
  t.innerHTML = `<div>${html}</div><div class="acts">${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : 'ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`;
  t.hidden = false;
  toastFor = L?.level;
  t.querySelectorAll('button').forEach(b => b.onclick = () => { t.hidden = true; actions[+b.dataset.i].run?.(); });
}
const hideToast = () => { $('#toast').hidden = true; };

// ---------------- a level ----------------
const con = new Console($('#consoleBody'), { onJump: line => { setView(view === 'blocks' ? 'split' : view); editor.focusLine(line); } });
const tableEvents = {
  onError: (b, err) => con.add('err', err.message || String(err), { who: b.id, line: err.line || 0 }),
  onWarn: (b, message, line) => con.add('warn', message, { who: b.id, line }),
  onSerial: (b, text) => con.add('out', text, { who: b.id }),
};
const table = makeTable($('#board'), { events: tableEvents, bin: $('#bin'), margins: { top: 44, bottom: 56, side: 28 } });
const goalTable = makeTable($('#goalBoard'), { fixed: true, margins: { top: 4, bottom: 4, side: 4 } });

const editor = createCodeEditor($('#code'), { onChange: code => codeChanged(code, 'code'), onRun: () => check() });
let blocks = null, blocksLoading = null;
function getBlocks() {
  if (!blocksLoading) {
    blocksLoading = import('../ui/blocks.js').then(m => m.createBlocksEditor($('#blocks'), { onChange: code => codeChanged(code, 'blocks') }))
      .then(b => (blocks = b));
  }
  return blocksLoading;
}

// L: the level being played, and how this attempt is going
let L = null;
let view = 'code';

const DONE_TITLES = { fix: 'Fixed.', build: 'Built.', boss: 'Boss beaten!', tweak: 'Done.', order: 'In order.', discover: 'Found it.', bridge: 'Done.' };
const RUNGS = ['Nudge', 'The idea', 'Look here', 'Fill in', 'Show me'];

function go(id) {
  location.hash = 'level/' + encodeURIComponent(id);
}

function openLevel(level) {
  closeLevel();
  hideToast();
  closeModal();
  const w = level.world;
  const draft = state.drafts[level.id];
  L = {
    level, mode: 'main',
    code: draft ?? (level.order ? level.order.scrambled.join('\n') : level.start || ''),
    started: Date.now(), lastEdit: Date.now(), hints: 0, fails: [], firstTry: true, shown: false,
    guess: null, guessed: false, lastError: null, sameError: 0, nudged: false, bridgeOffered: false, done: false,
  };
  document.documentElement.style.setProperty('--wc', w.color);
  $('#mapView').hidden = true;
  $('#levelView').hidden = false;
  $('#crumb').hidden = false;
  $('#mapLink').hidden = false;
  $('#crumb .txt').textContent = `World ${w.n} · ${w.name}`;
  document.title = `${level.id} ${level.title} · Light the Board`;
  con.clear();

  // the table, and the Goal Blink beside it
  const cells = level.cells || [[0, 0]];
  table.reset(cells);
  table.unload();
  const goal = level.goal && level.type !== 'predict' ? compileLevelCode(level.goal) : null;
  $('#pip').hidden = !goal?.ok;
  $('#pip').classList.toggle('wide', cells.length > 1);
  if (goal?.ok) showGoal(goal, 'Goal');
  setGoalHidden(!!state.hideGoal);
  $('#lockedOver').hidden = level.type !== 'predict';

  // the code: blocks, code or both, as the world teaches; an Order level shows its lines instead
  const ordering = !!level.order;
  $('#order').hidden = !ordering;
  $('#viewSeg').hidden = ordering;
  $('#resetCode').hidden = level.type === 'predict';
  $('#shield').hidden = level.type !== 'predict';
  editor.setValue(L.code);
  editor.cm.setOption('readOnly', level.type === 'predict' ? 'nocursor' : false);
  if (blocks) blocks.stale = true;
  if (ordering) { $('#blocks').hidden = $('#code').hidden = true; $('#edBody').classList.remove('split'); renderOrder(); }
  else setView(level.view || w.view || 'code', true);

  renderMission();
  if (level.type !== 'predict') runLive();
  else setStatus('', 'Read the code, then guess');
}

// The learner's Blinks sit below the Goal panel, never under it
function fitTable() {
  const pip = $('#pip');
  table.board.hooks.margins = { top: pip.hidden ? 44 : pip.offsetHeight + 24, bottom: 56, side: 28 };
  table.board.fit(false);
}

// A learner can hide the Goal Blink, to work out the end result on their own. The choice stays.
// Icons drawn like the playground's (20 x 20 strokes, as its debug microscope): an open eye, and a
// closed one, its lid curved down with four lashes
const EYE_OPEN = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10c1.8-3.4 4.8-5.3 8-5.3s6.2 1.9 8 5.3c-1.8 3.4-4.8 5.3-8 5.3S3.8 13.4 2 10z"/><circle cx="10" cy="10" r="2.3"/></svg>';
const EYE_CLOSED = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 8.5c1.8 3.1 4.8 4.8 8 4.8s6.2-1.7 8-4.8M3.2 10.2l-1.3 1.4M7.2 12.85 6.6 15M12.8 12.85l.6 2.15M16.8 10.2l1.3 1.4"/></svg>';
function setGoalHidden(hide) {
  const eye = $('#goalEye'), say = hide ? 'Show the goal' : 'Hide the goal';
  $('#pip').classList.toggle('closed', hide);
  eye.innerHTML = hide ? EYE_CLOSED : EYE_OPEN;
  eye.setAttribute('aria-pressed', hide);
  eye.title = say;
  eye.setAttribute('aria-label', say);
  if (!hide) goalTable.board.fit(false);
  fitTable();
}
$('#goalEye').addEventListener('click', () => {
  state.hideGoal = !state.hideGoal;
  persist();
  setGoalHidden(state.hideGoal);
});

// Run a compiled sketch on the Goal Blink, under a label: Goal, Twist or One idea
function showGoal(compiled, label) {
  goalTable.reset(L.level.cells || [[0, 0]]);
  goalTable.load(compiled);
  goalTable.board.fit(false);
  $('#pip .pip-lbl').textContent = label;
  $('#pip').classList.toggle('twist', label !== 'Goal');
}

function closeLevel() {
  if (!L) return;
  clearTimeout(liveTimer);
  clearTimeout(blocksTimer);
  clearPoint();
  L = null;
  table.unload();
  goalTable.unload();
}

// ---------------- code views ----------------
async function setView(v, force) {
  if (!L || L.level.order) return;
  if (v !== 'code') {
    let b;
    try { b = await getBlocks(); }
    catch (e) { console.error(e); toast('<b>The blocks couldn\'t load.</b><p>Check your internet connection. You can keep going in code.</p>', [{ label: 'OK' }]); v = 'code'; }
    if (b && (b.stale !== false || force)) {
      const r = b.setCode(L.code);
      if (!r.ok) { v = 'code'; con.add('info', `This code can't be shown as blocks yet: ${r.message}`); }
      else b.stale = false;
    }
  }
  view = v;
  $('#blocks').hidden = v === 'code';
  $('#code').hidden = v === 'blocks';
  $('#edBody').classList.toggle('split', v === 'split');
  for (const t of document.querySelectorAll('#viewSeg button')) t.setAttribute('aria-selected', t.dataset.view === v);
  editor.refresh();
  blocks?.resize();
}
document.querySelectorAll('#viewSeg button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

let liveTimer = 0, blocksTimer = 0;
function codeChanged(code, from) {
  if (!L) return;
  L.code = code;
  L.lastEdit = Date.now();
  L.nudged = false;
  state.drafts[L.level.id] = code;
  persist();
  clearPoint();
  if (from === 'blocks') editor.setValue(code);
  if (from === 'code' && blocks) {
    blocks.stale = true;
    // in Both, the blocks follow the code once it compiles
    if (view === 'split') {
      clearTimeout(blocksTimer);
      blocksTimer = setTimeout(() => { if (L && compileLevelCode(L.code).ok && blocks.setCode(L.code).ok) blocks.stale = false; }, 900);
    }
  }
  clearTimeout(liveTimer);
  setStatus('', 'Editing…');
  liveTimer = setTimeout(runLive, 450);
}

$('#resetCode').addEventListener('click', () => {
  if (!L) return;
  const fresh = L.level.order ? L.level.order.scrambled.join('\n') : L.level.start;
  delete state.drafts[L.level.id];
  persist();
  L.code = fresh;
  editor.setValue(fresh);
  if (L.level.order) renderOrder();
  else if (blocks && view !== 'code') { blocks.setCode(fresh); blocks.stale = false; }
  else if (blocks) blocks.stale = true;
  runLive();
});
$('#restart').addEventListener('click', () => { table.restart(); goalTable.restart(); });

// ---------------- upload to a real Blink ----------------
// The code on the table, built with avr-gcc and written to a Blink through a USBtinyISP
// (js/ui/upload.js). avr-gcc downloads the first time, about 6 MB.
let toolchainLoading = null;
function loadToolchain(onProgress) {
  if (!toolchainLoading) {
    toolchainLoading = import('../hardware/toolchain.js').then(async ({ Toolchain }) => {
      const tc = new Toolchain();
      await tc.load(p => toolchainLoading.onProgress?.(p));
      return tc;
    });
    toolchainLoading.catch(() => { toolchainLoading = null; });
  }
  toolchainLoading.onProgress = onProgress;
  return toolchainLoading;
}
function openUpload() {
  if (!L) return;
  const lv = L.level;
  openUploadDialog($('#uploadDialog'), {
    sketch: () => L?.code ?? '',
    sdk: 'move38',
    name: () => `${lv.id} ${lv.title}`,
    board: state.uploadBoard,
    setBoard: b => { state.uploadBoard = b; persist(); },
    toolchain: loadToolchain,
    onUploaded: text => con.add('info', text),
  });
}
$('#uploadBtn').addEventListener('click', openUpload);

function setStatus(kind, text) {
  const s = $('#status');
  s.className = 'run-chip ' + kind;
  s.querySelector('.txt').textContent = text;
}

// the checks that apply now: the level's, or its twist's
const currentChecks = () => (L.mode === 'twist' ? L.level.twist.checks : L.level.checks) || [];

// Compile, run the code on the table, and tick off the checks it already passes
function runLive() {
  if (!L) return;
  const c = compileLevelCode(L.code);
  if (!c.ok) {
    const e = c.errors[0];
    L.sameError = e.message === L.lastError ? L.sameError + 1 : 1;
    L.lastError = e.message;
    if (L.level.order) setStatus('', 'Not a sketch yet');
    else setStatus('err', e.line ? `Error on line ${e.line}` : 'Error');
    editor.setDiagnostics(c.errors.map(x => ({ line: x.line || 1, message: x.message, severity: 'err' })));
    L.live = null;
    renderChecks();
    maybeStuck();
    return;
  }
  L.lastError = null;
  L.sameError = 0;
  editor.setDiagnostics(c.warnings.map(w => ({ line: w.line || 1, message: w.message, severity: 'warn', inline: true })));
  if (L.level.type !== 'predict' || L.guessed) {
    con.clear();
    table.load(c);
    setStatus('ok', `Running on ${plural(table.world.blinks.length, 'Blink')}`);
  }
  const checks = currentChecks();
  L.live = checks.length ? runChecks(L.level, L.code, checks) : null;
  renderChecks();
}
$('#status').addEventListener('click', () => {
  const c = L && compileLevelCode(L.code);
  if (c && !c.ok && c.errors[0].line) { if (view === 'blocks') setView('split'); editor.focusLine(c.errors[0].line); }
});

// ---------------- the mission panel ----------------
function renderMission() {
  const lv = L.level, w = lv.world;
  const k = w.levels.indexOf(lv);
  const ring = w.levels.map((l, i) => `<i class="${i === k ? 'cur' : P.ringDone(state, w, i) ? 'done' : ''}"></i>`).join('');
  const kind = lv.parent ? 'bridge' : lv.type;
  const twist = L.mode === 'twist';
  let html = `
    <div class="lvl-head"><span class="tag ${kind}">${kind === 'bridge' ? 'Smaller step' : esc(lv.type)}</span><span class="ring" aria-hidden="true">${ring}</span></div>
    <div><p class="eyebrow">${esc(lv.id)}${twist ? ' · Twist' : ''}</p><h1 style="margin-top:6px">${esc(lv.title)}</h1></div>
    <p class="brief">${rich(lv.brief)}</p>
    ${twist ? `<p class="brief twist">★ ${rich(lv.twist.brief)}</p>` : ''}`;
  if (lv.type === 'predict') html += predictHtml();
  else {
    html += '<ul class="checklist" id="checklist"></ul><div id="hintBox"></div>';
    if (lv.ask && !twist) html += askHtml();
    html += `<div class="foot">
      ${lv.hints ? `<button class="btn" id="hintBtn">Hint<span class="hintpips">${[0, 1, 2, 3, 4].map(i => `<i class="${i < L.hints ? 'on' : ''}"></i>`).join('')}</span></button>` : ''}
      <button class="btn primary" id="checkBtn">Check</button></div>`;
  }
  $('#mission').innerHTML = html;
  if (lv.type === 'predict') return bindPredict();
  $('#hintBtn')?.addEventListener('click', () => { if (L.hints < 5) { L.hints++; renderMission(); renderChecks(); } });
  $('#checkBtn').addEventListener('click', check);
  if (lv.ask) bindAsk();
  renderHints();
  renderChecks();
}

function renderChecks() {
  const ul = $('#checklist');
  if (!ul) return;
  const checks = currentChecks();
  const err = L.live === null && compileLevelCode(L.code);
  if (err && !err.ok && L.level.order) {
    // scrambled cards don't make a sketch yet: that's the puzzle, not a mistake
    ul.innerHTML = `<li class="note order-note">Drag the lines into order. The checks run once they make a sketch.</li>`;
    return;
  }
  if (err && !err.ok) {
    const e = err.errors[0];
    ul.innerHTML = `<li class="note">Fix the error${e.line ? ` on line ${e.line}` : ''} first. Then the checks run again.<br><small>${esc(e.message)}</small></li>`;
    return;
  }
  ul.innerHTML = checks.map((c, i) => {
    const r = L.live?.results[i];
    // a check shows red, with what it saw, only after Check is pressed
    const failShown = L.checked && r && !r.pass;
    const cls = r?.pass ? 'pass' : failShown ? 'fail' : '';
    return `<li class="ck ${cls}"><span class="mk">${r?.pass ? '✓' : failShown ? '✗' : ''}</span><span>${esc(c.say)}${failShown && r.saw ? `<small>${esc(r.saw)}</small>` : ''}</span></li>`;
  }).join('');
  // a Discover level may have no checks, only its question
  const all = (checks.length ? L.live && L.live.results.every(r => r.pass) : true) && askAnswered();
  $('#checkBtn')?.classList.toggle('ready', !!all);
}

// Check: the learner says they're done. Every check passes, or we count the misses.
function check() {
  if (!L || L.level.type === 'predict') return;
  clearTimeout(liveTimer);
  runLive();
  L.checked = true;
  const c = compileLevelCode(L.code);
  if (!c.ok) { L.firstTry = false; renderChecks(); return; }
  const results = L.live ? L.live.results : [];
  const passed = results.every(r => r.pass);
  if (passed && askAnswered()) return complete();
  if (!passed) {
    L.firstTry = false;
    results.forEach((r, i) => { if (!r.pass) L.fails[i] = (L.fails[i] || 0) + 1; });
  } else toast('<b>The checks pass.</b><p>Answer the question in the mission panel to finish.</p>', [{ label: 'OK' }]);
  renderChecks();
  maybeStuck();
}

// ---------------- staying in the zone ----------------
function maybeStuck() {
  if (!L || L.done || !L.level.hints) return;
  const why = P.stuck({ fails: L.fails, idleMs: Date.now() - L.lastEdit, sameError: L.sameError });
  if (!why) return;
  if (why === 'fails' && L.hints < 3) {
    // three misses on one item: the next rung of the ladder opens by itself
    L.fails = L.fails.map(() => 0);
    L.hints++;
    renderMission();
    toast(`<b>Here's a hint.</b><p>That check missed a few times, so the next hint is open in the mission panel.</p>`, [{ label: 'OK' }]);
  } else if (L.hints >= 3 && L.level.bridge && !L.bridgeOffered) {
    L.bridgeOffered = true;
    toast(`<b>Want a smaller step first?</b><p>"${esc(L.level.bridge.title)}" takes a couple of minutes, then you come back here.</p>`,
      [{ label: 'Keep going' }, { label: 'Try it', primary: true, run: () => go(L.level.bridge.id) }]);
  } else if (why === 'error' && L.sameError === P.SAME_ERROR) {
    toast('<b>Same error again.</b><p>Click the red message in your code to see the line. The Hint button can help too.</p>', [{ label: 'OK' }]);
  }
}
// two minutes without an edit: offer a hint, once
setInterval(() => {
  if (!L || L.done || L.nudged || L.level.type === 'predict' || !L.level.hints || !$('#modal').hidden) return;
  if (P.stuck({ idleMs: Date.now() - L.lastEdit }) === 'idle') {
    L.nudged = true;
    toast('<b>Thinking it over?</b><p>A hint can get you moving. It costs nothing.</p>',
      [{ label: 'Not now' }, { label: 'Show a hint', primary: true, run: () => { if (L && L.hints < 5) { L.hints++; renderMission(); } } }]);
  }
}, 15000);

// ---------------- hints ----------------
function renderHints() {
  const box = $('#hintBox');
  const h = L.level.hints;
  if (!box || !h || !L.hints) { if (box) box.innerHTML = ''; return; }
  const body = [
    () => rich(h.nudge),
    () => rich(h.concept),
    () => `${rich(h.point.text)}${view === 'blocks' ? `<br><button class="btn" id="showLine">Show me the line</button>` : ''}`,
    () => `Fill in the blanks:<pre>${esc(h.fill)}</pre>`,
    () => `One way to write it:<pre>${esc(h.show || L.level.goal)}</pre><button class="btn" id="useAnswer">Use this code</button>`,
  ];
  box.innerHTML = `<div class="rungs">${body.slice(0, L.hints).map((f, i) => `<div class="rung${i === L.hints - 1 ? ' now' : ''}"><span class="rn">${i + 1}</span><span><b>${RUNGS[i]}</b>${f()}</span></div>`).join('')}</div>`;
  if (L.hints >= 3) pointAt(h.point.line);
  $('#showLine')?.addEventListener('click', () => { setView('split'); pointAt(h.point.line); });
  $('#useAnswer')?.addEventListener('click', () => {
    L.shown = true;
    const code = h.show || L.level.goal;
    editor.setValue(code);
    codeChanged(code, 'code');
    if (blocks && view !== 'code') { blocks.setCode(code); blocks.stale = false; }
  });
}
let pointed = null;
function pointAt(line) {
  clearPoint();
  if (!line) return;
  if (L?.level.order) {
    // the line the hint means is a card; it may have moved since
    const text = L.level.order.scrambled[line - 1];
    const li = [...$('#order').children].find(c => c.textContent.replace(/⠿$/, '') === text);
    li?.classList.add('point');
    return;
  }
  if (view === 'blocks') return;
  pointed = editor.cm.addLineClass(line - 1, 'background', 'cm-point-line');
}
function clearPoint() { $('#order').querySelector('.point')?.classList.remove('point'); if (pointed) { editor.cm.removeLineClass(pointed, 'background', 'cm-point-line'); pointed = null; } }

// ---------------- Predict ----------------
function predictHtml() {
  const p = L.level.predict;
  return `<p style="margin:0;font-weight:600">${rich(p.q)}</p>
    <div class="choices">${p.options.map((o, i) => `<button class="choice" data-i="${i}"><span class="l">${'ABCD'[i]}</span><span>${esc(o.text)}</span><span class="pics">${o.pics.map(f => blinkSvg(f, 10)).join('')}</span></button>`).join('')}</div>
    <div id="why"></div>
    <div class="foot"><button class="btn primary" id="lockIn" disabled>Pick an answer</button></div>`;
}
function bindPredict() {
  const p = L.level.predict;
  const btns = [...document.querySelectorAll('.choice')];
  btns.forEach(b => b.addEventListener('click', () => {
    if (L.guessed) return;
    L.guess = +b.dataset.i;
    btns.forEach(x => x.classList.toggle('sel', x === b));
    $('#lockIn').disabled = false;
    $('#lockIn').textContent = `Lock in ${'ABCD'[L.guess]} and run`;
  }));
  $('#lockIn').addEventListener('click', () => {
    if (L.guessed) return complete();
    L.guessed = true;
    const right = p.options[L.guess].right;
    L.firstTry = !!right;
    btns.forEach((x, i) => { x.disabled = true; x.classList.remove('sel'); if (p.options[i].right) x.classList.add('right'); else if (i === L.guess) x.classList.add('wrong'); });
    $('#why').innerHTML = `<div class="why${right ? '' : ' wrong'}">${rich(p.options[L.guess].why)}${right ? '' : `<br><br>${rich(p.options.find(o => o.right).why.replace(/^Right\.\s*/, ''))}`}</div>`;
    $('#lockedOver').hidden = true;
    $('#shield').hidden = true;
    editor.cm.setOption('readOnly', false);
    runLive();
    $('#lockIn').textContent = 'Next';
    con.add('info', 'Your guess is locked in, and the code is running. Try changing it to see what else it can do.');
  });
}

// ---------------- a question to answer (Discover levels) ----------------
function askHtml() {
  const a = L.level.ask;
  return `<div class="q-ask"><p style="margin:0 0 8px;font-weight:600">${rich(a.q)}</p><div class="choices">${a.options.map((o, i) => `<button class="choice" data-ask="${i}"><span class="l">${'ABCD'[i]}</span><span>${rich(o)}</span><span></span></button>`).join('')}</div><div id="askWhy"></div></div>`;
}
function bindAsk() {
  const a = L.level.ask;
  document.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.ask;
    if (L.askRight) return;
    const right = i === a.answer;
    if (!right) L.firstTry = false;
    b.classList.add(right ? 'right' : 'wrong');
    if (right) { L.askRight = true; document.querySelectorAll('[data-ask]').forEach(x => x.disabled = true); }
    $('#askWhy').innerHTML = `<div class="why${right ? '' : ' wrong'}" style="margin-top:8px">${right ? rich(a.why) : 'Not quite. Try the table again and look closely.'}</div>`;
    renderChecks();
  }));
}
const askAnswered = () => !L.level.ask || L.mode === 'twist' || !!L.askRight;

// ---------------- Order ----------------
function renderOrder() {
  const ol = $('#order');
  const lines = L.code.split('\n');
  const fixed = new Set(L.level.order.fixed || []);
  ol.innerHTML = lines.map((t, i) => `<li draggable="${fixed.has(t) ? 'false' : 'true'}" class="${fixed.has(t) ? 'fixed' : ''}" tabindex="0" data-i="${i}"><span>${esc(t) || ' '}</span>${fixed.has(t) ? '' : '<span class="grip" aria-hidden="true">⠿</span>'}</li>`).join('');
  let dragged = null;
  const commit = () => {
    const code = [...ol.children].map(li => lines[+li.dataset.i]).join('\n');
    codeChanged(code, 'order');
    renderOrder();
  };
  ol.querySelectorAll('li[draggable="true"]').forEach(li => {
    li.addEventListener('dragstart', e => { dragged = li; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragend', () => { li.classList.remove('dragging'); if (dragged) { dragged = null; commit(); } });
    // keyboard: Alt + up or down moves a line
    li.addEventListener('keydown', e => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const sib = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
      if (!sib) return;
      if (e.key === 'ArrowUp') ol.insertBefore(li, sib); else ol.insertBefore(sib, li);
      const i = li.dataset.i;
      commit();
      ol.querySelector(`[data-i="${i}"]`)?.focus();
    });
  });
  ol.ondragover = e => {
    if (!dragged) return;
    e.preventDefault();
    const after = [...ol.children].find(c => c !== dragged && e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
    if (after) ol.insertBefore(dragged, after); else ol.appendChild(dragged);
  };
}

// ---------------- finishing ----------------
function complete() {
  const lv = L.level, w = lv.world;
  L.done = true;
  hideToast();
  const r = { ms: Date.now() - L.started, hints: L.hints, firstTry: L.firstTry, shown: L.shown };
  if (L.mode === 'twist') {
    P.star(state, lv);
    persist();
    return finishModal({ starred: true });
  }
  const wasBoss = P.bossDone(state, w);
  P.finish(state, lv, r);
  const coasting = lv.type !== 'boss' && !lv.parent && P.coasting(state, lv, r) && !P.bossDone(state, w);
  persist();
  finishModal({ coasting, worldDone: lv === w.boss && !wasBoss });
}

function finishModal({ starred, coasting, worldDone }) {
  const lv = L.level, w = lv.world;
  const next = lv.parent || P.after(state, WORLDS, lv);
  const refl = !starred && lv.reflect;
  const title = starred ? 'Star earned.' : lv.type === 'predict' ? (L.firstTry ? 'You called it.' : 'Now you know.') : worldDone ? `World ${w.n} done!` : DONE_TITLES[lv.parent ? 'bridge' : lv.type] || 'Done.';
  const skillRows = (lv.skills || []).map(s => {
    const v = state.skills[s] || 0;
    return `<div style="display:grid;justify-items:end;gap:5px"><span class="muted" style="font-size:12px">${esc(SKILLS[s] || s)}</span><span class="pips" style="--sc:${w.color}">${[0, 1, 2].map(i => `<i class="${v >= i + 1 ? 'on' : v > i ? 'half' : ''}"></i>`).join('')}</span></div>`;
  }).join('');
  const offers = [];
  if (!starred && lv.twist && !state.levels[lv.id]?.star) offers.push(`<div class="offer star"><b>★ Twist</b><p>${rich(lv.twist.brief)}</p></div>`);
  if (coasting) offers.push(`<div class="offer"><b>You're flying</b><p>Three clean, quick levels in a row. Skip ahead to the World ${w.n} boss?</p></div>`);
  if (worldDone) offers.push(`<div class="offer"><b>${esc(lv.title)} joins your arcade</b><p>Play it again any time from the map.${WORLDS[WORLDS.indexOf(w) + 1] ? ` World ${w.n + 1} is open.` : ''}</p></div>`);
  if (lv.parent) offers.push(`<div class="offer"><b>Back to ${esc(lv.parent.id)}</b><p>${esc(lv.parent.title)} is waiting, with your code as you left it.</p></div>`);
  openModal(`
    <div class="row" style="align-items:flex-start">
      <div><p class="eyebrow" style="color:${w.color}">Level ${esc(lv.id)}</p><h2>${esc(title)}</h2></div>
      <div style="display:flex;gap:14px">${starred ? '' : skillRows}</div>
    </div>
    ${refl ? `<div class="q">${refl.code ? `<pre class="refl-code">${esc(refl.code)}</pre>` : ''}<b>${rich(refl.q)}</b>${refl.options.map((o, i) => `<button class="opt" data-r="${i}"><span class="l">${'ABC'[i]}</span>${rich(o)}</button>`).join('')}<div id="reflWhy"></div></div>` : ''}
    ${offers.length ? `<div class="offers">${offers.join('')}</div>` : ''}
    <div class="acts">
      <a class="btn ghost" href="#map">Map</a>
      ${coasting ? `<button class="btn ghost" id="toBoss">Challenge the boss</button>` : ''}
      ${lv.type === 'boss' && !starred ? `<button class="btn" id="toBlink">Play it on a real Blink</button>` : ''}
      ${!starred && lv.twist && !state.levels[lv.id]?.star ? `<button class="btn" id="twist">Try the twist</button>` : ''}
      ${next ? `<button class="btn primary" id="next">${lv.parent ? `Back to ${esc(lv.parent.id)}` : 'Next level'}</button>` : ''}
    </div>`);
  $('#modal').dataset.sticky = '1';
  document.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => {
    if (L.reflected) return;
    L.reflected = true;
    const right = +b.dataset.r === refl.answer;
    document.querySelectorAll('[data-r]').forEach((x, i) => { x.disabled = true; if (i === refl.answer) x.classList.add('right'); else if (x === b) x.classList.add('wrong'); });
    $('#reflWhy').innerHTML = `<div class="why${right ? '' : ' wrong'}">${right ? '' : 'Not quite. '}${rich(refl.why)}</div>`;
    // a wrong answer takes a little off what the level added
    if (!right) for (const s of lv.skills || []) state.skills[s] = Math.max(0, (state.skills[s] || 0) - 0.25);
    persist();
  }));
  $('#next')?.addEventListener('click', () => { delete $('#modal').dataset.sticky; closeModal(); go(next.id); });
  $('#toBlink')?.addEventListener('click', () => { delete $('#modal').dataset.sticky; closeModal(); openUpload(); });
  $('#toBoss')?.addEventListener('click', () => { delete $('#modal').dataset.sticky; closeModal(); go(w.boss.id); });
  $('#twist')?.addEventListener('click', () => {
    delete $('#modal').dataset.sticky;
    closeModal();
    L.mode = 'twist'; L.done = false; L.checked = false; L.fails = [];
    // the Goal Blink plays the twist now: its answer, or one idea when it has many
    const tw = compileLevelCode(lv.twist.solution);
    if (tw.ok) { $('#pip').hidden = false; showGoal(tw, lv.twist.open ? 'One idea' : 'Twist'); fitTable(); }
    renderMission();
    runLive();
  });
  document.querySelector('#modalBody a[href="#map"]').addEventListener('click', () => { delete $('#modal').dataset.sticky; closeModal(); });
}

// ---------------- #dev/blocks: can every level a learner sees as blocks become blocks? ----------------
async function blocksReport() {
  closeLevel();
  $('#mapView').hidden = false;
  $('#levelView').hidden = true;
  $('#mapSide').innerHTML = '<p class="eyebrow">Blocks check</p><p class="sub">Loading the block editor…</p>';
  // the block editor needs a visible host to lay out in
  $('#levelView').hidden = false;
  $('#blocks').hidden = false;
  const b = await getBlocks();
  $('#levelView').hidden = true;
  const rows = [];
  for (const w of WORLDS) {
    if (w.view === 'code') continue;
    for (const l of [...w.levels, w.boss].filter(Boolean)) {
      for (const lv of [l, l.bridge].filter(Boolean)) {
        const sources = { start: lv.order ? null : lv.start, goal: lv.goal, twist: lv.twist?.solution };
        for (const [which, src] of Object.entries(sources)) {
          if (!src || (which === 'start' && lv.startFails)) continue;
          const r = b.setCode(src);
          rows.push({ id: lv.id, which, ok: r.ok, lossy: r.ok && r.lossy, note: r.ok ? (r.notes || []).join('; ') : r.message });
        }
      }
    }
  }
  const bad = rows.filter(r => !r.ok || r.lossy);
  $('#mapSide').innerHTML = `<p class="eyebrow">Blocks check</p><h2>${bad.length ? `${bad.length} of ${rows.length} need a look` : `All ${rows.length} convert`}</h2>
    <p class="sub">Every start, goal and twist solution in the worlds that open in blocks, loaded into the block editor. "C code" means part of it shows as a C block.</p>
    <div class="skills">${rows.map(r => `<div class="row"><span>${esc(r.id)} ${r.which}</span><b style="color:${!r.ok ? 'var(--err)' : r.lossy ? 'var(--warn)' : 'var(--ok)'}">${!r.ok ? 'fails' : r.lossy ? 'C code' : 'ok'}</b></div>${(!r.ok || r.lossy) && r.note ? `<p class="sub" style="margin:0 0 6px">${esc(r.note)}</p>` : ''}`).join('')}</div>`;
  window.blocksReportResult = { total: rows.length, bad };
}

// ---------------- routing ----------------
function route() {
  if (location.hash === '#dev/blocks') return blocksReport();
  const m = /^#level\/(.+)$/.exec(location.hash);
  const level = m && LEVELS.get(decodeURIComponent(m[1]));
  if (level) openLevel(level);
  else showMap();
}
window.addEventListener('hashchange', route);
route();
