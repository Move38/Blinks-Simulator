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

export function createCodeEditor(host, { onChange, onRun }) {
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
      if (docKey !== null) docs.set(docKey, cm.getDoc());
      let d = docs.get(key);
      if (!d || d.getValue() !== v) d = CodeMirror.Doc(v, 'text/x-blinks');
      cm.swapDoc(d);
      docKey = key;
      silent = false;
    },
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

// `code` spans in messages
export function formatMessage(s) {
  const esc = s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return esc.replace(/`([^`]+)`/g, '<code>$1</code>');
}
