/*
 * The C code editor: CodeMirror 5 with Blinks-aware highlighting, autocomplete,
 * and inline compile / runtime messages.
 */

/* global CodeMirror */

const API = [
  ['setColor', '(color)'], ['setColorOnFace', '(color, face)'], ['makeColorRGB', '(red, green, blue)'], ['makeColorHSB', '(hue, saturation, brightness)'],
  ['dim', '(color, brightness)'], ['lighten', '(color, amount)'],
  ['buttonPressed', '()'], ['buttonReleased', '()'], ['buttonSingleClicked', '()'], ['buttonDoubleClicked', '()'], ['buttonMultiClicked', '()'],
  ['buttonClickCount', '()'], ['buttonLongPressed', '()'], ['buttonLongLongPressed', '()'], ['buttonDown', '()'],
  ['setValueSentOnAllFaces', '(value)'], ['setValueSentOnFace', '(value, face)'], ['getLastValueReceivedOnFace', '(face)'],
  ['isValueReceivedOnFaceExpired', '(face)'], ['didValueOnFaceChange', '(face)'], ['isAlone', '()'],
  ['sendDatagramOnFace', '(data, length, face)'], ['isDatagramReadyOnFace', '(face)'], ['getDatagramOnFace', '(face)'],
  ['getDatagramLengthOnFace', '(face)'], ['markDatagramReadOnFace', '(face)'],
  ['millis', '()'], ['random', '(limit)'], ['randomize', '()'], ['randomWord', '()'], ['map', '(x, inMin, inMax, outMin, outMax)'], ['sin8_C', '(angle)'],
  ['getSerialNumberByte', '(n)'], ['hasWoken', '()'], ['startState', '()'],
  ['min', '(a, b)'], ['max', '(a, b)'], ['abs', '(x)'], ['constrain', '(x, low, high)'],
  ['FOREACH_FACE', '(f)'], ['COUNT_OF', '(array)'],
];
const ATOMS = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'CYAN', 'BLUE', 'MAGENTA', 'WHITE', 'OFF', 'FACE_COUNT', 'IR_DATA_VALUE_MAX', 'IR_DATAGRAM_LEN', 'MAX_BRIGHTNESS',
  'START_STATE_POWER_UP', 'START_STATE_WE_ARE_ROOT', 'START_STATE_DOWNLOAD_SUCCESS', 'true', 'false', 'NULL', 'nullptr', 'HEX', 'BIN', 'DEC'];
const TYPES = ['byte', 'word', 'boolean', 'Color', 'Timer', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'ServicePortSerial'];
const KEYWORD_SNIPPETS = ['Timer', 'Serial.println', 'Serial.print', 'void', 'byte', 'bool', 'int', 'long', 'unsigned long', 'Color', 'enum', 'struct', 'switch', 'case', 'break', 'return', 'const'];

let modeDefined = false;
function defineMode() {
  if (modeDefined) return;
  modeDefined = true;
  const base = CodeMirror.resolveMode('text/x-c++src');
  const set = list => Object.fromEntries(list.map(w => [w, true]));
  const types = Object.assign({}, base.types || {}, set(TYPES));
  CodeMirror.defineMIME('text/x-blinks', Object.assign({}, base, {
    name: 'clike',
    types,
    builtin: Object.assign({}, base.builtin || {}, set(API.map(a => a[0]).concat(['Serial']))),
    atoms: Object.assign({}, base.atoms || {}, set(ATOMS)),
  }));
}

// onCursor(from, to): the lines (from 1) the cursor or selection is on, when the person moves it
export function createCodeEditor(host, { onChange, onRun, onCursor }) {
  defineMode();
  const cm = CodeMirror(host, {
    mode: 'text/x-blinks',
    lineNumbers: true,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    gutters: ['marks', 'CodeMirror-linenumbers'],
    extraKeys: {
      'Cmd-Enter': () => onRun(), 'Ctrl-Enter': () => onRun(),
      'Cmd-S': () => onRun(), 'Ctrl-S': () => onRun(),
      'Cmd-/': 'toggleComment', 'Ctrl-/': 'toggleComment',
      'Ctrl-Space': 'autocomplete',
      Tab: c => c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('  ', 'end'),
      'Shift-Tab': c => c.indentSelection('subtract'),
    },
  });

  // CodeMirror measures itself when created; re-measure when the pane or fonts change
  new ResizeObserver(() => cm.refresh()).observe(host);
  if (document.fonts) document.fonts.ready.then(() => cm.refresh());

  let silent = false;
  cm.on('change', (c, ch) => {
    if (silent) return;
    onChange(cm.getValue());
  });
  cm.on('cursorActivity', () => {
    if (silent || !onCursor) return;
    clearMark();
    const { from, to } = selection();
    onCursor(from, to);
  });
  const selection = () => {
    const a = cm.getCursor('from'), b = cm.getCursor('to');
    // a selection ending at the start of a line doesn't take that line in
    return { from: a.line + 1, to: Math.max(a.line, b.ch === 0 && b.line > a.line ? b.line - 1 : b.line) + 1 };
  };

  // lines marked as the ones a block beside the code is, or the ones a change to the blocks changed
  let marked = [];   // their line handles, which follow the lines as the text changes
  function clearMark() {
    cm.operation(() => { for (const h of marked) cm.removeLineClass(h, 'background', 'cm-linked-line'); });
    marked = [];
  }
  // ranges: [[from, to], ...] (from 1); the one `show` is scrolled into view, unless it already is
  function mark(ranges, show = ranges[0]) {
    clearMark();
    const last = cm.lineCount() - 1, at = l => Math.max(0, Math.min(last, l - 1));
    cm.operation(() => {
      for (const [from, to] of ranges) for (let l = at(from); l <= Math.max(at(from), at(to)); l++) marked.push(cm.addLineClass(l, 'background', 'cm-linked-line'));
    });
    if (!show) return;
    const a = at(show[0]), b = Math.max(a, at(show[1]));
    const view = cm.getScrollInfo(), top = cm.heightAtLine(a, 'local'), bottom = cm.heightAtLine(b + 1, 'local');
    if (top < view.top || bottom > view.top + view.clientHeight) cm.scrollIntoView({ from: { line: a, ch: 0 }, to: { line: b, ch: 0 } }, 40);
  }
  const markLines = (from, to = from) => mark([[from, to]]);

  cm.on('inputRead', (c, ch) => {
    if (ch.origin !== '+input' || cm.state.completionActive) return;
    const cur = cm.getCursor(), tok = cm.getTokenAt(cur);
    if (/^[A-Za-z_]\w{2,}$/.test(tok.string) && tok.end === cur.ch) cm.showHint({ hint, completeSingle: false });
  });

  function hint(c) {
    const cur = c.getCursor(), tok = c.getTokenAt(cur);
    const start = /^\w+$/.test(tok.string) ? tok.start : cur.ch;
    const word = c.getLine(cur.line).slice(start, cur.ch);
    const lw = word.toLowerCase();
    const seen = new Set();
    const list = [];
    const add = (text, sig, kind) => {
      if (seen.has(text) || text === word) return;
      if (!text.toLowerCase().startsWith(lw)) return;
      seen.add(text);
      list.push({ text: kind === 'fn' ? text + '(' : text, displayText: text, sig, render: (el, self, d) => { el.innerHTML = ''; el.append(d.displayText); if (d.sig) { const s = document.createElement('span'); s.className = 'sig'; s.textContent = d.sig; el.append(s); } } });
    };
    for (const [n, s] of API) add(n, s, n === 'FOREACH_FACE' || s ? 'fn' : '');
    for (const a of ATOMS) add(a, '', '');
    for (const t of TYPES.concat(KEYWORD_SNIPPETS)) add(t, '', '');
    const words = new Set(c.getValue().match(/[A-Za-z_]\w{2,}/g) || []);
    for (const w of words) add(w, '', '');
    return { list: list.slice(0, 40), from: CodeMirror.Pos(cur.line, start), to: CodeMirror.Pos(cur.line, cur.ch) };
  }

  // ---------- diagnostics ----------
  let marks = [];
  function clearDiagnostics() {
    for (const m of marks) m.clear ? m.clear() : null;
    marks = [];
    cm.clearGutter('marks');
  }
  function setDiagnostics(list) {
    cm.operation(() => {
      clearDiagnostics();
      let widgets = 0;
      for (const d of list) {
        const line = Math.max(0, Math.min(cm.lineCount() - 1, (d.line || 1) - 1));
        const sev = d.severity || 'err';
        const dot = document.createElement('div');
        dot.className = sev === 'warn' ? 'gutter-warn' : 'gutter-err';
        dot.title = d.message;
        cm.setGutterMarker(line, 'marks', dot);
        const cls = d.runtime ? 'cm-run-line' : (sev === 'warn' ? '' : 'cm-err-line');
        if (cls) {
          cm.addLineClass(line, 'background', cls);
          marks.push({ clear: () => cm.removeLineClass(line, 'background', cls) });
        }
        if (widgets < 4 && (sev !== 'warn' || d.inline)) {
          const w = document.createElement('div');
          w.className = 'line-msg ' + (sev === 'warn' ? 'warn' : 'err');
          const label = document.createElement('b');
          label.textContent = d.runtime ? 'Runtime' : (sev === 'warn' ? 'Note' : 'Error');
          const msg = document.createElement('span');
          msg.innerHTML = formatMessage(d.message);
          w.append(label, msg);
          marks.push(cm.addLineWidget(line, w, { coverGutter: false, noHScroll: true }));
          widgets++;
        }
      }
    });
  }

  // each file of a sketch keeps its own document, so switching files keeps its undo history
  const docs = new Map();
  let docKey = null;
  return {
    cm,
    getValue: () => cm.getValue(),
    setValue(v, key = null) {
      silent = true;
      clearDiagnostics();
      marked = [];
      docs.clear();
      cm.swapDoc(CodeMirror.Doc(v, 'text/x-blinks'));
      docKey = key;
      silent = false;
    },
    // show file `key`, whose text is `v`
    openDoc(key, v) {
      if (key === docKey) return;
      silent = true;
      clearDiagnostics();
      clearMark();
      if (docKey !== null) docs.set(docKey, cm.getDoc());
      let d = docs.get(key);
      if (!d || d.getValue() !== v) d = CodeMirror.Doc(v, 'text/x-blinks');
      cm.swapDoc(d);
      docKey = key;
      silent = false;
    },
    // the text as `v`, changing only the part that differs (keeping the view and undo history), and
    // marking the lines that changed
    // marking the lines that changed, and showing the change nearest line `near`
    update(v, near = null) {
      const old = cm.getValue();
      if (old === v) return;
      let a = 0, b = 0;
      while (a < old.length && a < v.length && old[a] === v[a]) a++;
      while (b < old.length - a && b < v.length - a && old[old.length - 1 - b] === v[v.length - 1 - b]) b++;
      const scroll = cm.getScrollInfo();
      silent = true;
      cm.replaceRange(v.slice(a, v.length - b), cm.posFromIndex(a), cm.posFromIndex(old.length - b), 'blocks');
      cm.scrollTo(scroll.left, scroll.top);
      silent = false;
      const hunks = changedLines(old, v);
      const away = h => (near == null ? 0 : near < h[0] ? h[0] - near : near > h[1] ? near - h[1] : 0);
      mark(hunks, hunks.reduce((best, h) => (away(h) < away(best) ? h : best), hunks[0]));
    },
    markLines,
    clearMark,
    selection,
    setDiagnostics,
    clearDiagnostics,
    focusLine(line) {
      cm.focus();
      cm.setCursor({ line: Math.max(0, line - 1), ch: 0 });
      cm.scrollIntoView({ line: Math.max(0, line - 1), ch: 0 }, 120);
    },
    refresh: () => cm.refresh(),
    focus: () => cm.focus(),
  };
}

// The lines of `b` that differ from `a`, by the longest run of lines they share: [[from, to], ...]
// (from 1). Where lines were only taken out, the line now in their place
function changedLines(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  let p = 0, s = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  const xs = x.slice(p, x.length - s), ys = y.slice(p, y.length - s), n = xs.length, m = ys.length;
  const atLine = j => Math.min(y.length, p + j + 1);
  if (n * m > 250000) return [[atLine(0), Math.max(atLine(0), y.length - s)]];
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = xs[i] === ys[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const hunks = [];
  const add = line => {
    const h = hunks[hunks.length - 1];
    if (h && line <= h[1]) return;
    if (h && line === h[1] + 1) h[1] = line;
    else hunks.push([line, line]);
  };
  for (let i = 0, j = 0; i < n || j < m;) {
    if (i < n && j < m && xs[i] === ys[j]) { i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) add(atLine(j++));
    else {
      // a line taken out: unless it was swapped for the line just before, mark the line now there
      if (!(j > 0 && hunks.at(-1)?.[1] === atLine(j - 1))) add(atLine(j));
      i++;
    }
  }
  return hunks;
}

// `code` spans in messages
export function formatMessage(s) {
  const esc = s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return esc.replace(/`([^`]+)`/g, '<code>$1</code>');
}
