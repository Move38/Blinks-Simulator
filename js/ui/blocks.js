/*
 * Blocks editor: a Scratch-style view of a Blinks sketch, built on Blockly (Zelos renderer).
 *
 * C is the source of truth. getCode() turns the workspace into clean, idiomatic C, and setCode()
 * parses C with the compiler's own front end and rebuilds the blocks. Anything without a block is
 * kept verbatim in a "C code" block, so nothing is lost in either direction.
 *
 * The importer (C -> Blockly workspace JSON) is pure, and the generator only needs Blockly's
 * headless core, so both run in node: createBlocksEditor(null) returns a headless editor when
 * globalThis.Blockly is already loaded.
 */

import { preprocess, PRELUDE } from '../compiler/preprocess.js';
import { parse } from '../compiler/parser.js';
import { tokenize, tokenText, CompileError } from '../compiler/lexer.js';
import { BUILTINS } from '../compiler/builtins.js';

const BLOCKLY_VERSION = '12.5.1';
const CDN = `https://cdn.jsdelivr.net/npm/blockly@${BLOCKLY_VERSION}/`;
const BLOCKLY_SCRIPTS = ['blockly_compressed.js', 'blocks_compressed.js', 'msg/en.js'];

const UI_FONT = 'Figtree, system-ui, -apple-system, sans-serif';
const MONO_FONT = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
const HEADER = 'Made with blocks in the Blinks Playground';

// Category colors: bright, evenly spaced hues that sit well on the dark panel
const PALETTE = {
  events: '#E3A21F', light: '#F25A1F', button: '#E0559B', neighbors: '#1EAE9B', time: '#8A63E6',
  control: '#3C89EA', math: '#3BAA63', logic: '#6E9F2E', bits: '#5E77D8', variables: '#E2524C', lists: '#2FA8D8', constants: '#B07A57', functions: '#B65BD0',
  code: '#5D5670',
};

// The named colors (5-bit RGB as in blinklib) and how their swatches look on screen
const COLORS = [
  ['RED', '#ff3b30'], ['ORANGE', '#ff8a00'], ['YELLOW', '#ffd60a'], ['GREEN', '#30d158'], ['CYAN', '#32d4f5'],
  ['BLUE', '#2f6bff'], ['MAGENTA', '#e040fb'], ['WHITE', '#ffffff'], ['OFF', '#1a1622'],
];
const COLOR_NAMES = new Set(COLORS.map(c => c[0]));
const COLOR_HEX = Object.fromEntries(COLORS);
// blinklib's named colors in 5-bit channels, so the color picker's sliders can start there
const COLOR_RGB5 = {
  RED: [31, 0, 0], ORANGE: [31, 15, 0], YELLOW: [31, 31, 0], GREEN: [0, 31, 0], CYAN: [0, 31, 31],
  BLUE: [0, 0, 31], MAGENTA: [31, 0, 31], WHITE: [31, 31, 31], OFF: [0, 0, 0],
};
// A color block holds a name (RED) or a mix "r,g,b" (0 to 255 each), which is makeColorRGB(r, g, b)
function parseMix(value) {
  const m = /^(\d{1,3}),(\d{1,3}),(\d{1,3})$/.exec(String(value));
  if (!m) return null;
  const c = m.slice(1).map(Number);
  return c.every(x => x <= 255) ? c : null;
}
const colorRGB = value => (COLOR_RGB5[value] ? COLOR_RGB5[value].map(x => Math.round(x * 255 / 31)) : parseMix(value));
const colorCss = value => COLOR_HEX[value] || (c => (c ? `rgb(${c.join(',')})` : '#888'))(parseMix(value));

// [label, blinklib function]
const BUTTON_EVENTS = [
  ['clicked', 'buttonSingleClicked'], ['double-clicked', 'buttonDoubleClicked'], ['multi-clicked', 'buttonMultiClicked'],
  ['long-pressed', 'buttonLongPressed'], ['pressed', 'buttonPressed'], ['released', 'buttonReleased'],
];
const BUTTON_STATES = [...BUTTON_EVENTS, ['held down', 'buttonDown']];
const BUTTON_FNS = new Set(BUTTON_STATES.map(b => b[1]));

// Variable types (Blockly variable type == C type). '' is a parameter made in the function editor (int).
const NUM_TYPES = ['byte', 'int', 'word', 'long', 'unsigned long', 'char', 'int8_t', 'float', ''];
const VAR_TYPE_ORDER = ['bool', 'byte', 'char', 'int8_t', 'int', 'word', 'long', 'unsigned long', 'float', 'Color', 'Timer', '', 'face'];
// Lists (C arrays) are variables whose type is the item type plus "[]": byte[] is a list of bytes
const isList = type => typeof type === 'string' && type.endsWith('[]');
const itemType = type => type.slice(0, -2);
// A local variable (made inside an event or function) has its C type plus "@local": int@local
const LOCAL_TAG = '@local';
const isLocalType = type => typeof type === 'string' && type.endsWith(LOCAL_TAG);
const baseType = type => (isLocalType(type) ? type.slice(0, -LOCAL_TAG.length) : type);
const localType = type => baseType(type) + LOCAL_TAG;
const kindOf = type => { type = baseType(type); return isList(type) ? 'list' : type === 'bool' ? 'bool' : type === 'Color' ? 'color' : type === 'Timer' ? 'timer' : type === 'face' ? 'face' : 'num'; };
// the global and local variable types of each kind of variable block
const KIND_TYPES = { num: NUM_TYPES, bool: ['bool'], color: ['Color'] };
// The number types a variable can have, in the order they're offered, and what each one holds
const NUMBER_TYPES = ['byte', 'int', 'word', 'long', 'unsigned long', 'float'];
const TYPE_INFO = {
  byte: 'whole numbers from 0 to 255', int: 'whole numbers from -32,768 to 32,767', word: 'whole numbers from 0 to 65,535 (unsigned int)',
  long: 'whole numbers from about -2.1 to 2.1 billion', 'unsigned long': 'whole numbers from 0 to about 4.3 billion, like millis()',
  float: 'numbers with decimals, like 0.5', char: 'whole numbers from -128 to 127', int8_t: 'whole numbers from -128 to 127',
  '': 'whole numbers (int)', bool: 'true or false', Color: 'a color, like RED', Timer: 'a countdown in milliseconds',
};
// Example values each type plays in the variable dialogs: [value, note, swatch color]. A note stays
// for the values after it while it's still true, until another note replaces it or the loop restarts.
const TYPE_EXAMPLES = {
  byte: [['253'], ['254'], ['255'], ['0', 'wrapped around to 0'], ['1']],
  int: [['32,766'], ['32,767'], ['-32,768', 'wrapped around to negative'], ['-32,767']],
  word: [['65,534'], ['65,535'], ['0', 'wrapped around to 0'], ['1']],
  long: [['30,000'], ['40,000', 'too big for an int'], ['1,000,000'], ['2,000,000,000']],
  'unsigned long': [['0'], ['1,000', 'a second of millis()'], ['60,000', 'a minute'], ['3,600,000', 'an hour']],
  float: [['0.25'], ['0.5'], ['0.75'], ['1.5'], ['3.14']],
  bool: [['true'], ['false']],
  Color: [['RED', null, '#ff3b30'], ['GREEN', null, '#30d158'], ['BLUE', null, '#2f6bff'], ['OFF', null, '#1a1622']],
  Timer: [['1000 ms'], ['600 ms'], ['200 ms'], ['0', 'done!']],
};
const aType = type => (/^[aeiou]/i.test(type) ? 'An ' : 'A ') + type;
const FLOAT_WARNING = 'Floats use a lot of memory on a Blink: float math adds a big chunk of code to your game, and each float takes 4 bytes. It\'s slow too. Use whole numbers when you can.';
const LOCAL_TYPES = { num: NUM_TYPES.filter(Boolean).map(localType), bool: ['bool' + LOCAL_TAG], color: ['Color' + LOCAL_TAG] };
const listKind = type => kindOf(itemType(type));
const LIST_TYPES = { num: NUM_TYPES.filter(Boolean).map(t => t + '[]'), bool: ['bool[]'], color: ['Color[]'] };
const ALL_LIST_TYPES = [...LIST_TYPES.num, ...LIST_TYPES.bool, ...LIST_TYPES.color];
const LIST_SIZE = 6;   // a list without a "list … with N items" block gets one item per face
const LIST_MAX = 64;
const cType = type => (type === '' ? 'int' : baseType(type));
const GETTER = { num: 'bk_get_num', bool: 'bk_get_bool', color: 'bk_get_color' };
// One set block for every variable: its value slot follows the kind of variable chosen
const SETTER = { num: 'bk_set', bool: 'bk_set', color: 'bk_set' };
const SET_DEFAULT = { num: 0, bool: null, color: 'RED' };
const KIND_CHECK = { num: 'Number', bool: 'Boolean', color: 'Color' };

// C operator precedence, doubled so the left operand of a left-associative operator can ask for
// order + 1 (Blockly floors fractional orders). Lower binds tighter.
const ORDER = {
  ATOMIC: 0, POSTFIX: 4, UNARY: 6, MUL: 10, ADD: 12, SHIFT: 14, REL: 16, EQ: 18, BAND: 20, BXOR: 22, BOR: 24,
  AND: 26, OR: 28, COND: 30, ASSIGN: 32, COMMA: 34, NONE: 99,
};

/*
 * Blocks that are a single blinklib call. One table drives the block definition, the generator,
 * the importer and the toolbox.
 *   [type, style, message, C function, args: [input, check, default], output check (null = statement), tooltip]
 */
const N = 'Number', B = 'Boolean', C = 'Color';
const CALL_BLOCKS = [
  ['bk_set_color', 'light', 'set all faces to %1', 'setColor', [['COLOR', C, 'RED']], null,
    'Light up every face of the Blink with one color.'],
  ['bk_set_face_color', 'light', 'set face %1 to %2', 'setColorOnFace', [['COLOR', C, 'GREEN'], ['FACE', N, 0]], null,
    'Light up one face (0 to 5) with a color.', [1, 0]],
  ['bk_color_rgb', 'light', 'mix red %1 green %2 blue %3', 'makeColorRGB', [['R', N, 255], ['G', N, 0], ['B', N, 128]], C,
    'A color mixed from red, green and blue light, each 0 to 255.'],
  ['bk_color_hsb', 'light', 'color hue %1 saturation %2 brightness %3', 'makeColorHSB', [['H', N, 0], ['S', N, 255], ['B', N, 255]], C,
    'A color from hue (0 to 255 goes around the rainbow), saturation and brightness (0 to 255).'],
  ['bk_dim', 'light', 'dim %1 to %2', 'dim', [['COLOR', C, 'BLUE'], ['BRIGHTNESS', N, 128]], C,
    'The color at a lower brightness: 255 is full, 0 is off.'],
  ['bk_lighten', 'light', 'lighten %1 by %2', 'lighten', [['COLOR', C, 'BLUE'], ['AMOUNT', N, 128]], C,
    'The color mixed toward white: 0 keeps it, 255 is white.'],
  ['bk_click_count', 'button', 'click count', 'buttonClickCount', [], N,
    'How many times the button was clicked in a row in the last multi-click.'],
  ['bk_send_all', 'neighbors', 'send %1 on all faces', 'setValueSentOnAllFaces', [['VALUE', N, 1]], null,
    'Keep sending a number (0 to 63) to every neighbor.'],
  ['bk_send_face', 'neighbors', 'send %1 on face %2', 'setValueSentOnFace', [['VALUE', N, 1], ['FACE', N, 0]], null,
    'Keep sending a number (0 to 63) to the neighbor on one face.'],
  ['bk_received', 'neighbors', 'value on face %1', 'getLastValueReceivedOnFace', [['FACE', N, 0]], N,
    'The last number the neighbor on this face sent.'],
  ['bk_value_changed', 'neighbors', 'face %1 value changed?', 'didValueOnFaceChange', [['FACE', N, 0]], B,
    'True once when the neighbor on this face sends a different number.'],
  ['bk_alone', 'neighbors', 'alone?', 'isAlone', [], B,
    'True when no Blinks are touching this one.'],
  ['bk_millis', 'time', 'milliseconds since start', 'millis', [], N,
    'How long this Blink has been running, in milliseconds (1000 per second).'],
  ['bk_random', 'math', 'pick random 0 to %1', 'random', [['MAX', N, 10]], N,
    'A random whole number from 0 up to and including the limit.'],
  ['bk_map', 'math', 'map %1 from %2 – %3 to %4 – %5', 'map', [['X', N, 128], ['FROM_LOW', N, 0], ['FROM_HIGH', N, 255], ['TO_LOW', N, 0], ['TO_HIGH', N, 5]], N,
    'Scale a number from one range into another.'],
  ['bk_sin8', 'math', 'wave %1', 'sin8_C', [['X', N, 0]], N,
    'A smooth wave: as the input goes 0 to 255 the output swings 128 → 255 → 0 → 128.'],
  ['bk_abs', 'math', 'absolute value of %1', 'abs', [['X', N, -5]], N,
    'The number without its minus sign.'],
  ['bk_constrain', 'math', 'keep %1 between %2 and %3', 'constrain', [['X', N, 300], ['LOW', N, 0], ['HIGH', N, 255]], N,
    'The number, kept inside the range.'],
  ['bk_randomize', 'math', 'shuffle random numbers', 'randomize', [], null,
    'Seed the random numbers so each Blink picks different ones. Use it once when the Blink starts.'],
];
const CALL_BY_TYPE = new Map(CALL_BLOCKS.map(d => [d[0], d]));
const CALL_BY_FN = new Map(CALL_BLOCKS.map(d => [d[3], d]));

// Default shadow values for the inputs the importer fills
const SHADOW_DEFAULTS = { bk_change: 1, bk_timer_set: 1000, bk_timer_add: 1000, bk_neighbor: 0, controls_repeat_ext: 10 };

const numBlock = n => ({ type: 'math_number', fields: { NUM: n } });
const colorBlock = name => ({ type: 'bk_color', fields: { COLOR: name } });
function shadowFor(check, def) {
  if (check === N && def != null) return numBlock(def);
  if (check === C && def != null) return colorBlock(def);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Loading Blockly
// ---------------------------------------------------------------------------------------------

let blocklyPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

function loadBlockly() {
  if (globalThis.Blockly && globalThis.Blockly.Workspace) return Promise.resolve(globalThis.Blockly);
  if (!blocklyPromise) {
    blocklyPromise = (async () => {
      for (const f of BLOCKLY_SCRIPTS) await loadScript(CDN + f);
      return globalThis.Blockly;
    })();
    blocklyPromise.catch(() => { blocklyPromise = null; });
  }
  return blocklyPromise;
}

function loadCss() {
  if (typeof document === 'undefined' || document.getElementById('bk-css')) return;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => /(^|\/)css\/blocks\.css(\?|$)/.test(l.getAttribute('href') || ''))) return;
  const link = document.createElement('link');
  link.id = 'bk-css';
  link.rel = 'stylesheet';
  link.href = new URL('../../css/blocks.css', import.meta.url).href;
  document.head.appendChild(link);
}

// ---------------------------------------------------------------------------------------------
// Block definitions
// ---------------------------------------------------------------------------------------------

let installed = null;

function install(Blockly) {
  if (installed) return installed;
  registerRenderer(Blockly);
  setMessages(Blockly);
  defineFields(Blockly);
  defineBlocks(Blockly);
  installed = { generator: makeGenerator(Blockly) };
  return installed;
}

// Zelos, with room above each case of a switch after the first: a case row right after the blocks
// of the case above sits tight against them, and the smallest spacer row would be far too tall
function registerRenderer(Blockly) {
  if (!Blockly.zelos || Blockly.registry.hasItem(Blockly.registry.Type.RENDERER, 'bk_zelos')) return;
  class Info extends Blockly.zelos.RenderInfo {
    getSpacerRowHeight_(prev, next) {
      const h = super.getSpacerRowHeight_(prev, next);
      const laterCase = this.block_.type === 'bk_switch' && next.elements && next.elements.some(e => e.input && /^CASE[1-9]/.test(e.input.name));
      return laterCase ? h + SWITCH_GAP : h;
    }
  }
  class Renderer extends Blockly.zelos.Renderer {
    makeRenderInfo_(block) { return new Info(this, block); }
  }
  Blockly.blockRendering.register('bk_zelos', Renderer);
}

function setMessages(Blockly) {
  const M = Blockly.Msg;
  Object.assign(M, {
    CONTROLS_IF_MSG_THEN: 'then', CONTROLS_IF_MSG_ELSEIF: 'else if', CONTROLS_IF_MSG_ELSE: 'else',
    CONTROLS_REPEAT_INPUT_DO: '', CONTROLS_WHILEUNTIL_INPUT_DO: '',
    CONTROLS_REPEAT_TITLE: 'repeat %1', CONTROLS_REPEAT_TOOLTIP: 'Run the blocks inside this many times.',
    CONTROLS_WHILEUNTIL_OPERATOR_WHILE: 'repeat while', CONTROLS_WHILEUNTIL_OPERATOR_UNTIL: 'repeat until',
    PROCEDURES_DEFNORETURN_TITLE: 'define', PROCEDURES_DEFRETURN_TITLE: 'define',
    PROCEDURES_DEFNORETURN_PROCEDURE: 'do something', PROCEDURES_DEFRETURN_PROCEDURE: 'calculate',
    PROCEDURES_DEFNORETURN_DO: '', PROCEDURES_DEFRETURN_DO: '', PROCEDURES_BEFORE_PARAMS: 'with',
    PROCEDURES_CALL_BEFORE_PARAMS: 'with', PROCEDURES_DEFRETURN_RETURN: 'return',
    PROCEDURES_DEFNORETURN_TOOLTIP: 'Your own block. Give it a name, then use it from the Functions category.',
    PROCEDURES_DEFRETURN_TOOLTIP: 'Your own block that works out a number and returns it.',
    MATH_NUMBER_TOOLTIP: 'A number. Whole numbers do whole-number math; type a decimal point for fractions.',
  });
}

const monoCache = new WeakMap();
function monoConstants(c) {
  if (!c) return c;
  let m = monoCache.get(c);
  if (!m) {
    m = Object.create(c, { FIELD_TEXT_FONTFAMILY: { value: MONO_FONT }, FIELD_TEXT_FONTWEIGHT: { value: '500' } });
    monoCache.set(c, m);
  }
  return m;
}

function defineFields(Blockly) {
  // An inline-editable text field in a monospace font for C source
  class FieldCode extends Blockly.FieldTextInput {
    constructor(value, validator, config) {
      super(value, validator, config);
      this.maxDisplayLength = 160;
      this.spellcheck_ = false;
    }
    static fromJson(o) { return new FieldCode(o.text ?? '', undefined, o); }
    getConstants() { return monoConstants(super.getConstants()); }
    initView() { super.initView(); if (this.textElement_) this.textElement_.classList.add('bkMono'); }
    showEditor_(e, quiet) {
      super.showEditor_(e, quiet);
      const input = this.htmlInput_;
      if (input) { input.classList.add('bkMono'); input.spellcheck = false; input.style.fontFamily = MONO_FONT; }
    }
    doValueUpdate_(v) {
      super.doValueUpdate_(v);
      const b = this.sourceBlock_;
      if (b && b.onCodeChange_) b.onCodeChange_();
    }
  }
  class FieldCodeLine extends Blockly.FieldLabel {
    getConstants() { return monoConstants(super.getConstants()); }
  }
  // Several lines of code shown as one compact text (read-only; edited in a dialog)
  class FieldCodeLines extends Blockly.Field {
    constructor(value) { super(value); this.SERIALIZABLE = false; this.EDITABLE = false; }
    getConstants() { return monoConstants(super.getConstants()); }
    initView() { this.createTextElement_(); this.textElement_.classList.add('bkMono'); }
    render_() {
      const el = this.textElement_;
      if (!el) return;
      const c = this.getConstants();
      const size = Number(c.FIELD_TEXT_FONTSIZE) || 11;
      const lh = Math.round(size * 1.55);
      const lines = String(this.getValue() ?? '').split('\n');
      while (el.firstChild) el.removeChild(el.firstChild);
      const ctx = (FieldCodeLines.canvas ||= document.createElement('canvas')).getContext('2d');
      ctx.font = `500 ${size}pt ${MONO_FONT}`;
      let width = 0;
      lines.forEach((line, i) => {
        const t = Blockly.utils.dom.createSvgElement('tspan', { x: 0, dy: i ? lh : 0 }, el);
        const text = line.replace(/\t/g, '  ').replace(/ /g, '\u00a0') || '\u00a0';
        t.textContent = text;
        width = Math.max(width, ctx.measureText(text).width);
      });
      el.setAttribute('y', Math.round(size * 1.25));
      el.removeAttribute('x');
      el.setAttribute('dominant-baseline', 'auto');
      this.size_ = new Blockly.utils.Size(Math.ceil(width), lh * (lines.length - 1) + Math.round(size * 1.6));
    }
  }
  // A color swatch: one of the named colors, or any mix of red, green and blue
  class FieldBlinkColor extends Blockly.Field {
    constructor(value, validator, config) {
      super(value ?? 'RED', validator, config);
      this.SERIALIZABLE = true;
      this.CURSOR = 'pointer';
    }
    static fromJson(o) { return new FieldBlinkColor(o.value, undefined, o); }
    doClassValidation_(v) { return COLOR_HEX[v] || parseMix(v) ? String(v) : null; }
    initView() {
      this.swatch_ = Blockly.utils.dom.createSvgElement('circle', { cx: 11, cy: 11, r: 10, 'stroke-width': 1.5 }, this.fieldGroup_);
    }
    render_() {
      const v = this.getValue();
      this.swatch_.setAttribute('fill', colorCss(v));
      this.swatch_.setAttribute('stroke', v === 'WHITE' ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.35)');
      this.size_ = new Blockly.utils.Size(22, 22);
    }
    getText_() {
      const v = this.getValue();
      const mix = parseMix(v);
      return mix ? `red ${mix[0]} green ${mix[1]} blue ${mix[2]}` : String(v).toLowerCase();
    }
    showEditor_() { openColorPicker(Blockly, this); }
  }

  // A dropdown of the names made by enum or define blocks on the workspace. It keeps any name it's
  // given, so a block can name something that is set up in C code or not made yet.
  class FieldNameRef extends Blockly.FieldDropdown {
    constructor(value, kind, config) {
      super(function () { return nameOptions(this, kind); }, undefined, config);
      if (value) this.setValue(value);
    }
    static fromJson(o) { return new FieldNameRef(o.value, o.kind, o); }
    getOptions() { return super.getOptions(false); }
    doClassValidation_(v) { return /^[A-Za-z_]\w*$/.test(String(v)) ? String(v) : null; }
  }

  // Eight bit cells, bit 7 on the left. `cells(block)` says how each looks: 'on' (a 1 or a bit of
  // the value), 'off' (a 0), 'fill' (a 0 that a shift moved in), 'skip' (not used here). Shows
  // where a shift moves bits, or which bits are taken. `editable` makes the cells clickable (a
  // literal you set bit by bit).
  class FieldBitStrip extends Blockly.Field {
    constructor(value, cells, arrow, editable) {
      super(value ?? 0);
      this.cells_ = cells;
      this.arrow_ = arrow;
      this.SERIALIZABLE = !!editable;
      this.EDITABLE = !!editable;
      this.CURSOR = editable ? 'pointer' : 'default';
    }
    doClassValidation_(v) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : null; }
    initView() { this.group_ = Blockly.utils.dom.createSvgElement('g', {}, this.fieldGroup_); }
    key_() {
      const b = this.getSourceBlock();
      return JSON.stringify([b ? this.cells_(b, this.getValue()) : [], this.arrow_ ? this.arrow_(b) : '', this.EDITABLE && this.getValue()]);
    }
    render_() {
      const g = this.group_;
      if (!g) return;
      const b = this.getSourceBlock();
      const cells = b ? this.cells_(b, this.getValue()) : new Array(8).fill('on');
      const arrow = this.arrow_ && b ? this.arrow_(b) : '';
      this.lastKey_ = this.key_();
      while (g.firstChild) g.removeChild(g.firstChild);
      const W = 10, H = 16, GAP = 2, Y = 3, el = (name, attrs) => Blockly.utils.dom.createSvgElement(name, attrs, g);
      const fill = { on: '#ffffff', off: 'rgba(255,255,255,.22)', fill: 'rgba(0,0,0,.25)', skip: 'rgba(255,255,255,.1)' };
      let x = 0;
      if (arrow === 'left') { el('text', { x: 0, y: Y + 12, class: 'bkBitArrow' }).textContent = '«'; x = 13; }
      cells.forEach((c, i) => {
        el('rect', { x, y: Y, width: W, height: H, rx: 2.5, fill: fill[c] || fill.off, stroke: c === 'fill' ? 'rgba(255,255,255,.45)' : 'none', 'stroke-dasharray': c === 'fill' ? '2 1.5' : '' });
        if (c === 'fill') el('text', { x: x + W / 2, y: Y + 11.5, class: 'bkBitZero' }).textContent = '0';
        x += W + (i === 3 ? GAP + 3 : GAP);   // a wider gap between the two halves
      });
      x -= GAP;
      if (arrow === 'right') { el('text', { x: x + 3, y: Y + 12, class: 'bkBitArrow' }).textContent = '»'; x += 13; }
      if (this.EDITABLE) { el('text', { x: x + 6, y: Y + 12, class: 'bkBitValue' }).textContent = '= ' + this.getValue(); x += 6 + 8 * String(this.getValue()).length + 14; }
      this.size_ = new Blockly.utils.Size(x, H + 2 * Y);
    }
    // re-draw when what the cells show has changed
    refresh_() { if (this.group_ && this.key_() !== this.lastKey_) { this.render_(); const b = this.getSourceBlock(); if (b && b.rendered) b.queueRender(); } }
    showEditor_(e) {
      if (!this.EDITABLE || !e) return;
      const rects = [...this.group_.querySelectorAll('rect')];
      const hit = rects.findIndex(r => { const bb = r.getBoundingClientRect(); return e.clientX >= bb.left - 1 && e.clientX <= bb.right + 1; });
      if (hit < 0) return;
      this.setValue(this.getValue() ^ (1 << (7 - hit)));
    }
    getText_() { return (this.getValue() >>> 0).toString(2).padStart(8, '0'); }
  }
  defineFields.FieldBitStrip = FieldBitStrip;

  // A variable dropdown that marks a local variable with a "local" pill just before its name, inside
  // the box, and in its menu, where local variables come first
  const PILL_W = 34, PILL_H = 15, PILL_GAP = 5, CHANGE_TYPE = 'BK_CHANGE_TYPE';
  class FieldScopedVariable extends Blockly.FieldVariable {
    constructor(name, validator, types, defaultType, config) {
      super(name, validator, types, defaultType, config);
      this.menuGenerator_ = function () {
        const options = Blockly.FieldVariable.dropdownCreate.call(this);
        const map = this.getSourceBlock() && this.getSourceBlock().workspace.getVariableMap();
        const vars = [], rest = [];
        for (const o of options) {
          const v = map && Array.isArray(o) && map.getVariableById(o[1]);
          (v ? vars : rest).push(v ? [o, v] : o);
        }
        vars.sort((x, y) => isLocalType(y[1].type) - isLocalType(x[1].type) || x[1].name.localeCompare(y[1].name));
        // a number variable can change its type: before Blockly's rename and delete
        const v = this.getVariable();
        if (v && kindOf(v.type) === 'num' && baseType(v.type) !== '') rest.unshift(['Change type…', CHANGE_TYPE]);
        return [...vars.map(([o, v]) => [varLabel(v), o[1]]), ...rest];
      };
    }
    onItemSelected_(menu, item) {
      if (item.getValue() !== CHANGE_TYPE) return super.onItemSelected_(menu, item);
      const v = this.getVariable();
      if (v) changeVariableType(Blockly, this.getSourceBlock().workspace, v);
    }
    static fromJson(o) { return new FieldScopedVariable(o.variable, undefined, o.variableTypes, o.defaultType, o); }
    getText_() { const v = this.getVariable(); return v ? v.name : super.getText_(); }
    initView() {
      super.initView();
      this.pill_ = Blockly.utils.dom.createSvgElement('g', { class: 'bkLocalPill' }, this.fieldGroup_);
      this.pillRect_ = Blockly.utils.dom.createSvgElement('rect', { rx: PILL_H / 2, width: PILL_W, height: PILL_H }, this.pill_);
      this.pillText_ = Blockly.utils.dom.createSvgElement('text', { x: PILL_W / 2 }, this.pill_);
      this.pillText_.textContent = 'local';
    }
    renderSelectedText() {
      super.renderSelectedText();
      if (!this.pill_) return;
      const v = this.getVariable();
      const local = !!(v && isLocalType(v.type));
      if (v) this.setTooltip(`${v.name}: a ${local ? 'local' : 'global'} ${cType(v.type)}${cType(v.type) === 'bool' ? ' (boolean)' : ''}, holding ${TYPE_INFO[baseType(v.type)] || 'a value'}.`);
      this.pill_.style.display = local ? '' : 'none';
      if (!local) return;
      // make room for the pill between the box's edge and the name
      const pad = this.borderRect_ ? this.getConstants().FIELD_BORDER_RECT_X_PADDING : 0, shift = PILL_W + PILL_GAP;
      const text = this.getTextElement();
      text.setAttribute('x', Number(text.getAttribute('x') || 0) + shift);
      const m = this.svgArrow && /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(this.svgArrow.getAttribute('transform') || '');
      if (m) this.svgArrow.setAttribute('transform', `translate(${Number(m[1]) + shift},${m[2]})`);
      const h = this.size_.height;
      this.pill_.setAttribute('transform', `translate(${pad},${(h - PILL_H) / 2})`);
      this.pillText_.setAttribute('y', PILL_H / 2 + 3.5);
      this.size_ = new Blockly.utils.Size(this.size_.width + shift, h);
    }
  }
  defineFields.FieldScopedVariable = FieldScopedVariable;

  if (Blockly.registry.hasItem(Blockly.registry.Type.FIELD, 'field_code')) Blockly.fieldRegistry.unregister('field_code');
  Blockly.fieldRegistry.register('field_code', FieldCode);
  if (Blockly.registry.hasItem(Blockly.registry.Type.FIELD, 'field_blink_color')) Blockly.fieldRegistry.unregister('field_blink_color');
  Blockly.fieldRegistry.register('field_blink_color', FieldBlinkColor);
  if (Blockly.registry.hasItem(Blockly.registry.Type.FIELD, 'field_name_ref')) Blockly.fieldRegistry.unregister('field_name_ref');
  Blockly.fieldRegistry.register('field_name_ref', FieldNameRef);
  if (Blockly.registry.hasItem(Blockly.registry.Type.FIELD, 'field_scoped_variable')) Blockly.fieldRegistry.unregister('field_scoped_variable');
  Blockly.fieldRegistry.register('field_scoped_variable', FieldScopedVariable);
  defineFields.FieldCode = FieldCode;
  defineFields.FieldCodeLine = FieldCodeLine;
  defineFields.FieldCodeLines = FieldCodeLines;
}

// A variable's menu label: a "local" pill for a local one, its name, and its C type for a number
// (the menu sits outside the editor, so it's styled here)
function varLabel(v) {
  const el = document.createElement('span');
  el.className = 'bkMenuVar';
  el.style.cssText = 'display:inline-flex;align-items:center;gap:6px';
  if (isLocalType(v.type)) {
    const pill = document.createElement('span');
    pill.textContent = 'local';
    pill.style.cssText = 'font:700 10px Figtree,system-ui,sans-serif;padding:1px 6px;border-radius:8px;background:rgba(0,0,0,.28);color:#fff';
    el.append(pill);
  }
  el.append(document.createTextNode(v.name));
  {
    const type = document.createElement('span');
    type.textContent = cType(v.type);
    type.style.cssText = 'opacity:.55;font:500 11px "JetBrains Mono",monospace';
    el.append(type);
  }
  el.setAttribute('aria-label', `${v.name}, ${isLocalType(v.type) ? 'local' : 'global'} ${cType(v.type)}`);
  return el;
}

// "Change type…": pick another number type for a variable (it keeps its scope)
function changeVariableType(Blockly, ws, v) {
  const host = ws.getInjectionDiv().parentElement;
  const wrap = document.createElement('div');
  wrap.className = 'bk-dialog';
  wrap.innerHTML = `<form class="bk-dialog-card bk-dialog-small bk-make-var" role="dialog" autocomplete="off">
    <div class="bk-dialog-title bk-dialog-message"></div>
    ${numberTypeChoices(baseType(v.type))}
    ${exampleRow}
    <div class="bk-dialog-hint bk-type-hint"></div>
    <div class="bk-dialog-actions"><span class="bk-dialog-hint"></span>
      <button type="button" class="bk-btn" data-act="cancel">Cancel</button>
      <button type="submit" class="bk-btn bk-btn-primary">Change</button></div></form>`;
  const form = wrap.querySelector('form');
  form.querySelector('.bk-dialog-message').textContent = `What kind of number is ${v.name}?`;
  const hint = wrap.querySelector('.bk-type-hint');
  const sync = () => { hint.textContent = `${aType(form.elements.numtype.value)} holds ${TYPE_INFO[form.elements.numtype.value]}.`; };
  sync();
  form.addEventListener('change', sync);
  const stop = typeExamples(form, () => form.elements.numtype.value);
  const close = () => { stop(); wrap.remove(); };
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.dataset.act === 'cancel') close(); });
  wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const type = isLocalType(v.type) ? localType(form.elements.numtype.value) : form.elements.numtype.value;
    close();
    if (type === v.type) return;
    Blockly.Events.setGroup(true);
    try { ws.getVariableMap().changeVariableType(v, type); } finally { Blockly.Events.setGroup(false); }
    // redraw the blocks that show it (their tooltips and menus)
    for (const b of ws.getAllBlocks(false)) for (const input of b.inputList) for (const f of input.fieldRow) if (f.getValue && f.getValue() === v.getId() && f.forceRerender) f.forceRerender();
  });
  host.appendChild(wrap);
  setTimeout(() => form.querySelector('input:checked').focus(), 0);
}

// The examples tooltip and float warning of a variable dialog. Hovering a choice (or moving to it with
// the keyboard) pops up a tooltip over it with example values that change; `chosen()` names the type
// picked now, for the float warning. Returns a function that stops it.
function typeExamples(form, chosen) {
  const warn = form.querySelector('.bk-warn');
  const tip = document.createElement('div');
  tip.className = 'bk-tip';
  tip.setAttribute('role', 'tooltip');
  tip.innerHTML = '<div class="bk-tip-type"></div><div class="bk-ex-val"></div><div class="bk-ex-note"></div>';
  tip.hidden = true;
  form.append(tip);
  const [label, value, note] = ['.bk-tip-type', '.bk-ex-val', '.bk-ex-note'].map(q => tip.querySelector(q));
  // the width of a text set in one of the tooltip's parts
  const measure = (part, text) => {
    const m = document.createElement('span');
    m.className = part.className;
    m.style.cssText = 'position:absolute;visibility:hidden;display:inline-block;white-space:nowrap;width:auto;animation:none';
    m.textContent = text;
    tip.append(m);
    const w = m.getBoundingClientRect().width;
    m.remove();
    return w;
  };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer = 0, over = null;
  const show = (type, anchor) => {
    clearInterval(timer);
    over = anchor;
    // numbers sit at the right; with decimals, their points line up (figure spaces are digit-wide blanks)
    const numeric = x => /^[-\d,.]+$/.test(x);
    const places = x => (x.includes('.') ? x.length - x.indexOf('.') : 0);
    const decimals = Math.max(0, ...(TYPE_EXAMPLES[type] || []).filter(f => numeric(f[0])).map(f => places(f[0])));
    const frames = (TYPE_EXAMPLES[type] || []).map(([v, ...rest]) => [numeric(v) && decimals ? v + '\u2007'.repeat(decimals - places(v)) : v, ...rest]);
    label.textContent = type === 'bool' ? 'bool (boolean)' : type;
    let i = 0, shown = '';
    note.textContent = '';
    // as wide as its widest value or note, so it holds still while they change; it grows taller
    // (upward, above the choice) when a note shows
    tip.hidden = false;
    tip.style.width = '';
    const widest = Math.max(measure(label, label.textContent), ...frames.map(f => measure(value, f[0]) + (f[2] ? 18 : 0)), ...frames.map(f => (f[1] ? measure(note, f[1]) : 0)));
    tip.style.width = Math.ceil(widest + 24) + 'px';
    const place = () => {
      const card = form.getBoundingClientRect(), at = anchor.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      const left = Math.max(8, Math.min(card.width - w - 8, at.left - card.left + at.width / 2 - w / 2));
      tip.style.left = left + 'px';
      tip.style.top = (at.top - card.top - h - 8) + 'px';
      tip.style.setProperty('--arrow', (at.left - card.left + at.width / 2 - left) + 'px');
    };
    const step = () => {
      const [v, n, color] = frames[i % frames.length] || [''];
      value.replaceChildren();
      if (color) { const dot = document.createElement('i'); dot.style.background = color; value.append(dot); }
      value.append(rollDigits(shown, v, still));
      shown = v;
      const text = n || (i % frames.length ? note.textContent : '');
      if (text !== note.textContent) {
        note.textContent = text;
        note.classList.remove('in'); void note.offsetWidth; note.classList.add('in');
      }
      i++;
      if (!tip.hidden) place();
    };
    tip.hidden = true;
    step();
    if (!still && frames.length > 1) timer = setInterval(step, 1300);
    tip.hidden = false;
    place();
    tip.classList.remove('in'); void tip.offsetWidth; tip.classList.add('in');
  };
  const hide = anchor => {
    if (anchor && anchor !== over) return;
    clearInterval(timer);
    over = null;
    tip.hidden = true;
  };
  const typeOf = input => (input.name === 'kind' ? (input.value === 'num' ? form.elements.numtype.value : input.value) : input.value);
  for (const l of form.querySelectorAll('label')) {
    const input = l.querySelector('input[name="numtype"], input[name="kind"]');
    if (!input) continue;
    l.addEventListener('mouseenter', () => show(typeOf(input), l));
    l.addEventListener('mouseleave', () => hide(l));
    input.addEventListener('focus', () => { if (input.matches(':focus-visible')) show(typeOf(input), l); });
    input.addEventListener('blur', () => hide(l));
  }
  const warning = () => { warn.hidden = chosen() !== 'float'; };
  form.addEventListener('change', warning);
  warning();
  return () => clearInterval(timer);
}
const exampleRow = `<div class="bk-warn" hidden>${FLOAT_WARNING}</div>`;

// A value whose changed characters roll like an odometer: each old digit slides up and out as the new
// one rises in (rightmost first). Numbers line up from the right; a word changes as a whole.
function rollDigits(from, to, still) {
  const out = document.createElement('span');
  out.className = 'bk-digits';
  const numeric = x => /^[-\d,.\u2007]+$/.test(x);
  const cell = (a, b, delay) => {
    const c = document.createElement('span');
    c.className = 'bk-dig';
    if (a === b || still || !from) { c.textContent = b; return c; }
    if (a) { const o = document.createElement('span'); o.className = 'bk-dig-out'; o.textContent = a; o.style.animationDelay = delay + 'ms'; c.append(o); }
    const n = document.createElement('span');
    n.className = 'bk-dig-in';
    n.textContent = b || '\u200b';
    n.style.animationDelay = delay + 'ms';
    c.append(n);
    return c;
  };
  if (!(numeric(from) && numeric(to))) { out.append(cell(from, to, 0)); return out; }
  const w = Math.max(from.length, to.length), a = from.padStart(w), b = to.padStart(w);
  for (let k = 0; k < w; k++) if (a[k] !== ' ' || b[k] !== ' ') out.append(cell(a[k].replace(' ', ''), b[k].replace(' ', ''), (w - 1 - k) * 45));
  return out;
}

// The number types as a segmented choice
function numberTypeChoices(selected) {
  return `<div class="bk-seg bk-seg-wrap" role="radiogroup" aria-label="Number type">${NUMBER_TYPES.map(t =>
    `<label title="${TYPE_INFO[t]}"><input type="radio" name="numtype" value="${t}"${t === selected ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>`;
}

// The names enum blocks (kind 'enum') or define blocks (kind 'define') make, for a name dropdown
function nameOptions(field, kind) {
  const block = field.getSourceBlock();
  let ws = block && block.workspace;
  if (ws && ws.targetWorkspace) ws = ws.targetWorkspace;   // in the flyout, list the workspace's names
  const names = new Set();
  if (ws) {
    for (const b of ws.getAllBlocks(false)) {
      if (kind === 'enum' && b.type === 'bk_enum') b.itemNames_().forEach(n => names.add(n));
      if (kind === 'define' && b.type === 'bk_define') names.add(b.getFieldValue('NAME'));
    }
  }
  const v = field.getValue && field.getValue();
  if (v) names.add(v);
  if (!names.size) names.add(kind === 'enum' ? 'READY' : 'SPEED');
  return [...names].filter(Boolean).sort().map(n => [n, n]);
}

// A C name from what someone typed: letters, digits and _ only, not starting with a digit
const cName = (text, fallback = 'NAME') => String(text ?? '').trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').replace(/^(?=\d)/, '_') || fallback;

// The color picker: the named colors, then sliders to mix any color from red, green and blue
function openColorPicker(Blockly, field) {
  const DD = Blockly.DropDownDiv;
  const root = document.createElement('div');
  root.className = 'bkPicker';
  const named = document.createElement('div');
  named.className = 'bkPickerNamed';
  for (const [name, hex] of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bkPickerSwatch';
    b.style.background = hex;
    b.title = b.ariaLabel = name.toLowerCase();
    if (field.getValue() === name) b.classList.add('on');
    b.addEventListener('click', () => { field.setValue(name); DD.hideIfOwner(field); });
    named.append(b);
  }
  const head = document.createElement('div');
  head.className = 'bkPickerHead';
  head.innerHTML = '<span>Mix your own</span><span class="bkPickerPreview"></span>';
  const preview = head.lastChild;
  const rgb = colorRGB(field.getValue()) || [255, 0, 0];
  const rows = ['red', 'green', 'blue'].map((label, i) => {
    const row = document.createElement('label');
    row.className = 'bkPickerRow';
    row.innerHTML = `<span>${label[0].toUpperCase()}</span><input type="range" min="0" max="255" step="1" aria-label="${label}"><output></output>`;
    const input = row.querySelector('input');
    input.value = rgb[i];
    return { row, input, out: row.querySelector('output') };
  });
  const paint = () => {
    const c = rows.map(r => Number(r.input.value));
    preview.style.background = `rgb(${c.join(',')})`;
    rows.forEach((r, i) => {
      const lo = c.slice(), hi = c.slice();
      lo[i] = 0; hi[i] = 255;
      r.input.style.background = `linear-gradient(90deg, rgb(${lo.join(',')}), rgb(${hi.join(',')}))`;
      r.out.textContent = c[i];
    });
    return c;
  };
  paint();
  // one slider drag is one undo step
  let grouped = false;
  for (const r of rows) {
    r.input.addEventListener('input', () => {
      if (!grouped) { Blockly.Events.setGroup(true); grouped = true; }
      field.setValue(paint().join(','));
      named.querySelector('.on')?.classList.remove('on');
    });
    r.input.addEventListener('change', () => { if (grouped) { Blockly.Events.setGroup(false); grouped = false; } });
  }
  root.append(named, head, ...rows.map(r => r.row));
  const content = DD.getContentDiv();
  content.replaceChildren(root);
  DD.showPositionedByField(field, () => { if (grouped) { Blockly.Events.setGroup(false); grouped = false; } });
  DD.setColour('#2a2337', '#3a3149');
}

function defineBlocks(Blockly) {
  const val = (name, check) => ({ type: 'input_value', name, ...(check ? { check } : {}) });
  const timerField = { type: 'field_variable', name: 'TIMER', variable: 'myTimer', variableTypes: ['Timer'], defaultType: 'Timer' };
  const faceField = { type: 'field_variable', name: 'VAR', variable: 'f', variableTypes: ['face'], defaultType: 'face' };
  const varField = kind => ({
    type: 'field_scoped_variable', name: 'VAR', variable: null,
    variableTypes: [...KIND_TYPES[kind], ...LOCAL_TYPES[kind]],
    defaultType: kind === 'num' ? 'int' : kind === 'bool' ? 'bool' : 'Color',
  });
  const stmt = { previousStatement: null, nextStatement: null };
  const hat = { nextStatement: null };
  const defs = [
    // Events
    { type: 'bk_setup', message0: 'when Blink starts', ...hat, style: 'bk_events',
      tooltip: 'Runs once when the Blink starts (the body of setup()).' },
    { type: 'bk_loop', message0: 'forever', ...hat, style: 'bk_events',
      tooltip: 'Runs again and again, many times a second (the body of loop()).' },
    { type: 'bk_when_button', message0: 'when button %1', args0: [{ type: 'field_dropdown', name: 'EVENT', options: BUTTON_EVENTS }],
      ...hat, style: 'bk_events', tooltip: 'Runs when the button does this.' },
    { type: 'bk_when_timer', message0: 'when timer %1 finishes', args0: [timerField], ...hat, style: 'bk_events',
      tooltip: 'Runs every loop while the timer is done. Set the timer again inside to make it repeat.' },

    // Light
    { type: 'bk_color', message0: '%1', args0: [{ type: 'field_blink_color', name: 'COLOR', value: 'RED' }],
      output: C, style: 'bk_light', tooltip: 'A color: pick a named one (OFF is no light) or mix your own from red, green and blue.' },
    { type: 'bk_random_color', message0: 'random color', output: C, style: 'bk_light',
      tooltip: 'A bright color with a random hue.' },

    // Button
    { type: 'bk_button', message0: 'button %1 ?', args0: [{ type: 'field_dropdown', name: 'EVENT', options: BUTTON_STATES }],
      output: B, style: 'bk_button', tooltip: 'Did the button do this since the last time you asked? (Asking clears it, except "held down".)' },
    { type: 'bk_button_clear', message0: 'clear button %1', args0: [{ type: 'field_dropdown', name: 'EVENT', options: BUTTON_EVENTS }],
      ...stmt, style: 'bk_button',
      tooltip: 'Forget this button action if it happened and hasn\'t been asked about yet, so an old click doesn\'t count later (it asks and ignores the answer).' },

    // Neighbors
    { type: 'bk_neighbor', message0: 'neighbor on face %1 ?', args0: [val('FACE', N)], output: B, style: 'bk_neighbors',
      tooltip: 'True when another Blink is touching this face.', inputsInline: true },

    // Time
    { type: 'bk_timer_set', message0: 'set timer %1 to %2 ms', args0: [timerField, val('MS', N)], ...stmt, style: 'bk_time',
      tooltip: 'Start the timer: it finishes after this many milliseconds (1000 = one second).', inputsInline: true },
    { type: 'bk_timer_add', message0: 'add %1 ms to timer %2', args0: [val('MS', N), timerField], ...stmt, style: 'bk_time',
      tooltip: 'Make the timer run longer.', inputsInline: true },
    { type: 'bk_timer_never', message0: 'stop timer %1', args0: [timerField], ...stmt, style: 'bk_time',
      tooltip: 'Stop the timer so it never finishes.' },
    { type: 'bk_timer_done', message0: 'timer %1 done?', args0: [timerField], output: B, style: 'bk_time',
      tooltip: 'True when the timer has finished.' },
    { type: 'bk_timer_left', message0: 'time left on timer %1', args0: [timerField], output: N, style: 'bk_time',
      tooltip: 'Milliseconds until the timer finishes.' },

    // Control
    { type: 'bk_for_each_face', message0: 'for each face %1', args0: [faceField], message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }],
      ...stmt, style: 'bk_control',
      tooltip: 'Run the blocks inside once for each face, 0 to 5.' },
    { type: 'bk_face_var', message0: '%1', args0: [faceField], output: N, style: 'bk_control', extensions: ['bk_face_warning'],
      tooltip: 'The face number of the "for each face" loop around this block.' },
    { type: 'bk_flow', message0: '%1', args0: [{ type: 'field_dropdown', name: 'FLOW', options: [['break out of loop', 'BREAK'], ['skip to next turn', 'CONTINUE']] }],
      ...stmt, style: 'bk_control', extensions: ['bk_flow_warning'],
      tooltip: 'Leave the loop now, or jump to its next turn.' },

    { type: 'bk_case_or', message0: '%1 or %2', args0: [val('A', [N, 'CaseValues']), val('B', [N, 'CaseValues'])], inputsInline: true,
      output: 'CaseValues', style: 'bk_control', tooltip: 'Use in a switch case: the case runs for either value.' },

    // Bits
    { type: 'bk_bitwise', message0: '%1 %2 %3', args0: [val('A', N), { type: 'field_dropdown', name: 'OP',
      options: [['& (and)', 'AND'], ['| (or)', 'OR'], ['^ (xor)', 'XOR']] }, val('B', N)], inputsInline: true, output: null, style: 'bk_bits',
      tooltip: 'Works bit by bit: & keeps a 1 where both have a 1, | where either does, ^ where just one does. Use & to test or clear bits and | to set them.' },
    { type: 'bk_bitnot', message0: '~ %1', args0: [val('A', N)], inputsInline: true, output: N, style: 'bk_bits',
      tooltip: 'Flips every bit: 1s become 0s and 0s become 1s.' },

    // Constants
    { type: 'bk_define', message0: 'define %1 as %2', args0: [{ type: 'field_input', name: 'NAME', text: 'SPEED' }, val('VALUE')],
      inputsInline: true, style: 'bk_constants', extensions: ['bk_c_name'],
      tooltip: 'A name for a value that never changes (#define). Use the name anywhere the value goes.' },
    { type: 'bk_define_value', message0: '%1', args0: [{ type: 'field_name_ref', name: 'NAME', kind: 'define', value: 'SPEED' }],
      output: null, style: 'bk_constants', tooltip: 'The value of a name made with "define".' },
    { type: 'bk_enum_value', message0: '%1', args0: [{ type: 'field_name_ref', name: 'NAME', kind: 'enum', value: 'READY' }],
      output: N, style: 'bk_constants', tooltip: 'One of the names in an enum. Each name stands for a different number.' },

    // Math
    { type: 'bk_arith', message0: '%1 %2 %3', args0: [val('A', N), { type: 'field_dropdown', name: 'OP',
      options: [['+', 'ADD'], ['−', 'SUB'], ['×', 'MUL'], ['÷', 'DIV'], ['% (mod)', 'MOD']] }, val('B', N)],
      inputsInline: true, output: N, style: 'bk_math',
      tooltip: 'Add, subtract, multiply, divide or take the remainder. Whole numbers give a whole-number answer.' },
    { type: 'bk_minmax', message0: '%1 of %2 and %3', args0: [{ type: 'field_dropdown', name: 'OP', options: [['min', 'min'], ['max', 'max']] },
      val('A', N), val('B', N)], inputsInline: true, output: N, style: 'bk_math', tooltip: 'The smaller (min) or larger (max) of two numbers.' },

    // Logic
    { type: 'bk_compare', message0: '%1 %2 %3', args0: [val('A'), { type: 'field_dropdown', name: 'OP',
      options: [['==', 'EQ'], ['!=', 'NEQ'], ['<', 'LT'], ['<=', 'LTE'], ['>', 'GT'], ['>=', 'GTE']] }, val('B')],
      inputsInline: true, output: B, style: 'bk_logic', tooltip: 'Compare two values. == asks "are they equal?" and != asks "are they different?" (in C, a single = stores a value instead).' },
    { type: 'bk_and_or', message0: '%1 %2 %3', args0: [val('A', B), { type: 'field_dropdown', name: 'OP', options: [['and', 'AND'], ['or', 'OR']] }, val('B', B)],
      inputsInline: true, output: B, style: 'bk_logic', tooltip: '"and" is true when both are true; "or" when at least one is.' },
    { type: 'bk_not', message0: 'not %1', args0: [val('BOOL', B)], output: B, style: 'bk_logic', tooltip: 'True when the input is false.' },
    { type: 'bk_bool', message0: '%1', args0: [{ type: 'field_dropdown', name: 'BOOL', options: [['true', 'TRUE'], ['false', 'FALSE']] }],
      output: B, style: 'bk_logic', tooltip: 'True or false.' },

    // Variables
    ...['num', 'bool', 'color'].map(kind => (
      { type: GETTER[kind], message0: '%1', args0: [varField(kind)], output: KIND_CHECK[kind], style: 'bk_variables',
        tooltip: 'The value of this variable. A local one (marked local) belongs to its event or function.' })),
    { type: 'bk_change', message0: 'change %1 by %2', args0: [varField('num'), val('DELTA', N)], ...stmt, inputsInline: true,
      style: 'bk_variables', tooltip: 'Add to the variable (use a negative number to subtract).' },

    // Functions
    { type: 'bk_return', message0: 'stop this script', ...stmt, style: 'bk_functions',
      tooltip: 'Leave the current event, function or loop() right away (return).' },
    { type: 'bk_return_value', message0: 'return %1', args0: [val('VALUE')], ...stmt, style: 'bk_functions',
      extensions: ['bk_return_warning'], tooltip: 'Finish this function and give back a value.' },

    // C code
    { type: 'bk_c_expr', message0: '%1', args0: [{ type: 'field_code', name: 'CODE', text: 'x' }], output: null, style: 'bk_code',
      tooltip: 'A C expression, used as it is.' },
  ];
  for (const [type, style, message, , args, out, tooltip, order] of CALL_BLOCKS) {
    const ins = args.map(([name, check]) => val(name, check));
    const def = { type, message0: message, args0: order ? order.map(i => ins[i]) : ins, style: 'bk_' + style, tooltip, inputsInline: true };
    if (!ins.length) delete def.args0;
    if (out) def.output = out; else Object.assign(def, stmt);
    defs.push(def);
  }

  // Lists: get, set and change an item, and the length
  const listField = types => ({ type: 'field_variable', name: 'LIST', variable: null, variableTypes: types, defaultType: types[0] });
  for (const kind of ['num', 'bool', 'color']) {
    const what = { num: 'number', bool: 'true/false', color: 'color' }[kind];
    defs.push(
      { type: 'bk_list_get_' + kind, message0: 'item %1 of %2', args0: [val('INDEX', N), listField(LIST_TYPES[kind])],
        output: KIND_CHECK[kind], inputsInline: true, style: 'bk_lists', tooltip: `The ${what} at this place in the list. The first item is item 0.` },
      { type: 'bk_list_set_' + kind, message0: 'set item %1 of %2 to %3', args0: [val('INDEX', N), listField(LIST_TYPES[kind]), val('VALUE', KIND_CHECK[kind])],
        ...stmt, inputsInline: true, style: 'bk_lists', tooltip: `Put a ${what} at this place in the list. The first item is item 0.` },
    );
  }
  defs.push(
    { type: 'bk_list_change', message0: 'change item %1 of %2 by %3', args0: [val('INDEX', N), listField(LIST_TYPES.num), val('DELTA', N)],
      ...stmt, inputsInline: true, style: 'bk_lists', tooltip: 'Add to the number at this place in the list (use a negative number to subtract).' },
    { type: 'bk_list_length', message0: 'length of %1', args0: [listField(ALL_LIST_TYPES)], output: N, style: 'bk_lists',
      tooltip: 'How many items the list holds.' },
  );

  registerExtensions(Blockly);
  for (const d of defs) delete Blockly.Blocks[d.type];
  Blockly.common.defineBlocksWithJsonArray(defs);
  defineCodeBlocks(Blockly);
  defineListBlocks(Blockly);
  defineSwitchAndEnum(Blockly);
  defineBitBlocks(Blockly);
  defineSetBlock(Blockly);
}

// switch: a value, cases (each ends by itself, as if with break), and "default" for the rest
const SWITCH_GAP = 12;  // extra room above each case after the first (see registerRenderer)
function defineSwitchAndEnum(Blockly) {
  const fire = (block, before) => Blockly.Events.fire(new (Blockly.Events.get(Blockly.Events.BLOCK_CHANGE))(block, 'mutation', null, before, JSON.stringify(block.saveExtraState())));
  const buttons = (block, label, onMinus, onPlus) => block.appendDummyInput('TAIL')
    .appendField(new Blockly.FieldImage(PLUS_MINUS('-'), 18, 18, 'remove the last ' + label, onMinus))
    .appendField(new Blockly.FieldImage(PLUS_MINUS('+'), 18, 18, 'add a ' + label, onPlus));

  Blockly.Blocks.bk_switch = {
    init() {
      this.cases_ = 2;
      this.appendValueInput('SWITCH').setCheck(N).appendField('switch');
      this.appendStatementInput('DEFAULT').appendField('default');
      buttons(this, 'case', () => this.resize_(-1), () => this.resize_(1));
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setStyle('bk_control');
      this.setTooltip('Runs the blocks of the case that matches the value, or "default" when none does. Each case ends by itself. Use "or" for a case with more than one value.');
      this.updateShape_();
    },
    saveExtraState() { return { cases: this.cases_ }; },
    loadExtraState(state) {
      this.cases_ = Math.max(1, Math.min(32, Number(state && state.cases) || 1));
      this.updateShape_();
    },
    resize_(delta) {
      if (this.isInFlyout) return;
      const n = Math.max(1, Math.min(32, this.cases_ + delta));
      if (n === this.cases_) return;
      const before = JSON.stringify(this.saveExtraState());
      Blockly.Events.setGroup(true);
      try {
        for (let i = n; i < this.cases_; i++) {
          for (const name of ['CASE' + i, 'DO' + i]) {
            const t = this.getInputTargetBlock(name);
            if (t && !t.isShadow()) t.dispose(false);
          }
        }
        this.cases_ = n;
        this.updateShape_();
        fire(this, before);
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
    updateShape_() {
      for (let i = this.cases_; this.getInput('CASE' + i); i++) { this.removeInput('CASE' + i); this.removeInput('DO' + i); }
      for (let i = 0; i < this.cases_; i++) {
        if (this.getInput('CASE' + i)) continue;
        const input = this.appendValueInput('CASE' + i).setCheck([N, 'CaseValues']).appendField('case');
        this.appendStatementInput('DO' + i);
        this.moveInputBefore('CASE' + i, 'DEFAULT');
        this.moveInputBefore('DO' + i, 'DEFAULT');
        input.connection.setShadowState(numBlock(i));
      }
    },
  };

  // enum: names that stand for 0, 1, 2…
  Blockly.Blocks.bk_enum = {
    init() {
      this.items_ = 3;
      this.appendDummyInput('HEAD').appendField('enum').appendField(new Blockly.FieldTextInput('mode', v => cName(v, '').replace(/^$/, '')), 'NAME');
      buttons(this, 'name', () => this.resize_(-1), () => this.resize_(1));
      this.setInputsInline(true);
      this.setStyle('bk_constants');
      this.setTooltip('A set of names that stand for 0, 1, 2… Use them with the enum name blocks, in comparisons and switch cases. The enum\'s own name is optional.');
      this.updateShape_();
    },
    itemNames_() {
      const out = [];
      for (let i = 0; i < this.items_; i++) { const v = this.getFieldValue('ITEM' + i); if (v) out.push(v); }
      return out;
    },
    saveExtraState() { return { items: this.items_ }; },
    loadExtraState(state) {
      this.items_ = Math.max(1, Math.min(32, Number(state && state.items) || 1));
      this.updateShape_();
    },
    resize_(delta) {
      if (this.isInFlyout) return;
      const n = Math.max(1, Math.min(32, this.items_ + delta));
      if (n === this.items_) return;
      const before = JSON.stringify(this.saveExtraState());
      Blockly.Events.setGroup(true);
      try {
        const names = new Set(this.itemNames_());
        const old = this.items_;
        this.items_ = n;
        this.updateShape_();
        // each added name is one that isn't taken yet
        for (let i = old; i < n; i++) {
          let k = i + 1, name = 'ITEM' + k;
          while (names.has(name)) name = 'ITEM' + ++k;
          names.add(name);
          this.setFieldValue(name, 'ITEM' + i);
        }
        fire(this, before);
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
    updateShape_() {
      for (let i = this.items_; this.getInput('ITEM' + i); i++) this.removeInput('ITEM' + i);
      for (let i = 0; i < this.items_; i++) {
        if (this.getInput('ITEM' + i)) continue;
        const f = new Blockly.FieldTextInput(['READY', 'PLAYING', 'DONE'][i] || 'ITEM' + (i + 1), v => cName(v, 'ITEM' + (i + 1)));
        this.appendDummyInput('ITEM' + i).appendField(f, 'ITEM' + i);
        this.moveInputBefore('ITEM' + i, 'TAIL');
      }
    },
  };
}

// set: one block for every variable, global or local. Its value slot takes the kind of value the
// chosen variable holds (a number, true/false or a color).
function defineSetBlock(Blockly) {
  const shadows = { num: numBlock(0), bool: null, color: colorBlock('RED') };
  Blockly.Blocks.bk_set = {
    init() {
      this.kind_ = null;
      this.appendValueInput('VALUE')
        .appendField('set')
        .appendField(new defineFields.FieldScopedVariable(null, id => { this.fit_(id); return id; },
          [...KIND_TYPES.num, ...LOCAL_TYPES.num, ...KIND_TYPES.bool, ...LOCAL_TYPES.bool, ...KIND_TYPES.color, ...LOCAL_TYPES.color], 'int'), 'VAR')
        .appendField('to');
      this.setInputsInline(true);
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setStyle('bk_variables');
      this.setTooltip('Store a value in the variable. A local variable (marked local) belongs to its event or function: the first time it\'s set there, it\'s made, fresh each time they run.');
    },
    fit_(id) {
      const v = id && this.workspace && this.workspace.getVariableMap().getVariableById(id);
      const kind = v ? kindOf(v.type) : 'num';
      if (kind === this.kind_ || !KIND_CHECK[kind]) return;
      this.kind_ = kind;
      const input = this.getInput('VALUE'), conn = input.connection;
      // swap the default before the check, or the old one would be pushed out onto the workspace
      if (conn.getShadowState()) conn.setShadowState(null);
      input.setCheck(KIND_CHECK[kind]);
      if (shadows[kind]) conn.setShadowState(shadows[kind]);
    },
  };
}

// Bits: shifting, taking some bits of a number, and a number set bit by bit
function defineBitBlocks(Blockly) {
  const { FieldBitStrip } = defineFields;
  // the number in an input, if it's a plain number block
  const known = (block, name) => {
    const t = block.getInputTargetBlock(name);
    if (t && t.type === 'math_number') return Math.floor(Number(t.getFieldValue('NUM')));
    if (t && t.type === 'bk_bits') return t.getFieldValue('BITS');
    return null;
  };
  const watch = function () { this.setOnChange(function () { for (const n of ['STRIP', 'BITS']) { const f = this.getField(n); if (f && f.refresh_) f.refresh_(); } }); };

  Blockly.Blocks.bk_shift = {
    init() {
      this.appendValueInput('A').setCheck(N);
      this.appendValueInput('B').setCheck(N).appendField(new Blockly.FieldDropdown([['<<', 'LEFT'], ['>>', 'RIGHT']]), 'DIR');
      this.appendDummyInput().appendField(new FieldBitStrip(0, b => {
        // where the bits end up: the value's bits (exactly, if it's a plain number), and the 0s moved in
        const n = known(b, 'B'), x = known(b, 'A'), left = b.getFieldValue('DIR') === 'LEFT';
        return Array.from({ length: 8 }, (_, k) => {
          const bit = 7 - k;
          if (n == null || n < 0) return x == null ? 'on' : (x >> bit) & 1 ? 'on' : 'off';
          const from = left ? bit - n : bit + n;
          if (from < 0 || from > 7) return 'fill';   // a byte: 0s move in at the ends
          return x == null ? 'on' : (x >> from) & 1 ? 'on' : 'off';
        });
      }, b => (b.getFieldValue('DIR') === 'LEFT' ? 'left' : 'right')), 'STRIP');
      this.setInputsInline(true);
      this.setOutput(true, N);
      this.setStyle('bk_bits');
      this.setTooltip('Shifts the bits of a number: << moves them left (each step doubles it), >> moves them right (each step halves it). 0s move in at the other end. The strip shows the result.');
      watch.call(this);
    },
  };

  Blockly.Blocks.bk_get_bits = {
    init() {
      this.appendValueInput('A').setCheck(N)
        .appendField('bits').appendField(new Blockly.FieldNumber(0, 0, 15, 1), 'LO')
        .appendField('to').appendField(new Blockly.FieldNumber(1, 0, 15, 1), 'HI')
        .appendField('of');
      this.appendDummyInput().appendField(new FieldBitStrip(0, b => {
        const lo = Number(b.getFieldValue('LO')), hi = Number(b.getFieldValue('HI'));
        return Array.from({ length: 8 }, (_, k) => (7 - k >= Math.min(lo, hi) && 7 - k <= Math.max(lo, hi) ? 'on' : 'skip'));
      }), 'STRIP');
      this.setInputsInline(true);
      this.setOutput(true, N);
      this.setStyle('bk_bits');
      this.setTooltip('Takes some of the bits of a number (bit 0 is the rightmost) and gives them as a number of their own, like reading one part of a value that packs several together.');
      watch.call(this);
    },
  };

  Blockly.Blocks.bk_bits = {
    init() {
      this.appendDummyInput().appendField(new FieldBitStrip(0, (b, v) => Array.from({ length: 8 }, (_, k) => ((v >> (7 - k)) & 1 ? 'on' : 'off')), null, true), 'BITS');
      this.setOutput(true, N);
      this.setStyle('bk_bits');
      this.setTooltip('A number set bit by bit: click a square to turn that bit on or off. Bit 0 is the rightmost (worth 1), bit 7 the leftmost (worth 128).');
    },
  };
}

const PLUS_MINUS = sign => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="9" fill="rgba(255,255,255,.22)"/>` +
  `<path d="M6 10h8${sign === '+' ? 'M10 6v8' : ''}" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`);

// The blocks that set up a list (a global C array): with a size, or with its starting items
// The default item of a list (0, false or off): the shadow left in a slot when its item is dragged away
const itemShadow = kind => (kind === 'color' ? colorBlock('OFF') : kind === 'bool' ? { type: 'bk_bool', fields: { BOOL: 'FALSE' } } : numBlock(0));
// List items are real blocks over that shadow, so they can be picked up and dragged into a new place
const itemInput = (kind, block) => ({ shadow: itemShadow(kind), block: block || itemShadow(kind) });

function defineListBlocks(Blockly) {
  const kindOfId = (block, id) => {
    const v = id && block.workspace && block.workspace.getVariableMap().getVariableById(id);
    return v && isList(v.type) ? listKind(v.type) : 'num';
  };
  const warnDuplicate = function () {
    this.setOnChange(function () {
      if (!this.workspace || this.isInFlyout || !this.rendered) return;
      const id = this.getFieldValue('LIST');
      const first = this.workspace.getTopBlocks(true).find(b => (b.type === 'bk_list_decl' || b.type === 'bk_list_init') && b.isEnabled() && b.getFieldValue('LIST') === id);
      this.setWarningText(first && first !== this ? 'Another block already sets up this list, so this one is ignored.' : null);
    });
  };

  Blockly.Blocks.bk_list_decl = {
    init() {
      this.appendDummyInput()
        .appendField('list')
        .appendField(new Blockly.FieldVariable(null, undefined, ALL_LIST_TYPES, 'int[]'), 'LIST')
        .appendField('with')
        .appendField(new Blockly.FieldNumber(LIST_SIZE, 1, LIST_MAX, 1), 'COUNT')
        .appendField('items');
      this.setStyle('bk_lists');
      this.setTooltip('Sets up a list with this many items. Numbers start at 0, colors off and true/false at false.');
      warnDuplicate.call(this);
    },
  };

  Blockly.Blocks.bk_list_init = {
    init() {
      this.items_ = 3;
      this.kind_ = 'num';
      this.appendDummyInput('HEAD')
        .appendField('list')
        .appendField(new Blockly.FieldVariable(null, id => { this.updateShape_(kindOfId(this, id)); return id; }, ALL_LIST_TYPES, 'int[]'), 'LIST')
        .appendField('starts as');
      this.appendDummyInput('TAIL')
        .appendField(new Blockly.FieldImage(PLUS_MINUS('+'), 18, 18, 'one more item', () => this.resize_(1)), 'PLUS');
      this.setInputsInline(true);
      this.setStyle('bk_lists');
      this.setTooltip('Sets up a list with these starting items. Drag an item out to remove it, or drag a block between items to add it there. + adds a copy of the last item.');
      this.updateShape_();
      warnDuplicate.call(this);
    },
    // the item kind is saved too: the item slots are made before the list field is loaded
    saveExtraState() { return { items: this.items_, kind: this.kind_ }; },
    // the item blocks in order (null where a slot holds only its default)
    itemIds_() {
      const ids = [];
      for (let k = 0; this.getInput('ITEM' + k); k++) {
        const t = this.getInputTargetBlock('ITEM' + k);
        ids.push(t && !t.isShadow() ? t.id : null);
      }
      return ids;
    },
    // put these item blocks in the slots, growing or shrinking the list to fit (an undo step)
    setItems_(ids) {
      const before = JSON.stringify(this.saveExtraState());
      this.placeItems_(ids, -1, () => {
        const after = JSON.stringify(this.saveExtraState());
        if (after !== before) Blockly.Events.fire(new (Blockly.Events.get(Blockly.Events.BLOCK_CHANGE))(this, 'mutation', null, before, after));
      });
    },
    // the same without the mutation event; slot `empty` is left as an open, empty slot
    placeItems_(ids, empty, reshaped) {
      for (let k = 0; this.getInput('ITEM' + k); k++) {
        const t = this.getInputTargetBlock('ITEM' + k);
        if (t && !t.isShadow()) t.unplug(false);
      }
      this.items_ = Math.max(1, Math.min(LIST_MAX + 1, ids.length));
      this.updateShape_();
      if (reshaped) reshaped();
      if (empty >= 0 && this.getInput('ITEM' + empty)) this.getInput('ITEM' + empty).connection.setShadowState(null);
      ids.slice(0, this.items_).forEach((id, k) => {
        const b = id && this.workspace.getBlockById(id);
        if (b && !b.isDeadOrDying() && !b.getParent()) this.getInput('ITEM' + k).connection.connect(b.outputConnection);
      });
    },
    loadExtraState(state) {
      this.items_ = Math.max(1, Math.min(LIST_MAX, Number(state && state.items) || 1));
      this.updateShape_(KIND_CHECK[state && state.kind] ? state.kind : 'num');
    },
    resize_(delta) {
      if (this.isInFlyout) return;
      const n = Math.max(1, Math.min(LIST_MAX, this.items_ + delta));
      if (n === this.items_) return;
      const before = JSON.stringify(this.saveExtraState());
      Blockly.Events.setGroup(true);
      try {
        for (let i = n; i < this.items_; i++) {
          const gone = this.getInputTargetBlock('ITEM' + i);
          if (gone && !gone.isShadow()) gone.dispose(false);
        }
        const last = delta > 0 && this.getInputTargetBlock('ITEM' + (this.items_ - 1));
        const old = this.items_;
        this.items_ = n;
        this.updateShape_();
        Blockly.Events.fire(new (Blockly.Events.get(Blockly.Events.BLOCK_CHANGE))(this, 'mutation', null, before, JSON.stringify(this.saveExtraState())));
        // a new item starts as a copy of the last one
        for (let i = old; i < n; i++) {
          const state = last ? Blockly.serialization.blocks.save(last, { addCoordinates: false, addNextBlocks: false, doFullSerialization: false }) : itemShadow(this.kind_);
          delete state.id;
          const b = Blockly.serialization.blocks.append(state, this.workspace, { recordUndo: true });
          this.getInput('ITEM' + i).connection.connect(b.outputConnection);
        }
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
    updateShape_(kind = kindOfId(this, this.getFieldValue('LIST'))) {
      this.kind_ = kind;
      for (let i = this.items_; this.getInput('ITEM' + i); i++) this.removeInput('ITEM' + i);
      const shadow = itemShadow(kind);
      for (let i = 0; i < this.items_; i++) {
        let input = this.getInput('ITEM' + i);
        if (!input) {
          input = this.appendValueInput('ITEM' + i);
          this.moveInputBefore('ITEM' + i, 'TAIL');
        }
        // swap the shadow before the check, or the old one would be pushed out onto the workspace
        const conn = input.connection;
        const now = conn.getShadowState();
        if (now && now.type !== shadow.type) conn.setShadowState(null);
        input.setCheck(KIND_CHECK[kind]);
        if (!now || now.type !== shadow.type) conn.setShadowState(shadow);
      }
    },
  };
}

function registerExtensions(Blockly) {
  const reg = (name, fn) => { if (!Blockly.Extensions.isRegistered(name)) Blockly.Extensions.register(name, fn); };
  const LOOPS = new Set(['controls_repeat_ext', 'controls_whileUntil', 'bk_for_each_face', 'bk_c_wrap', 'bk_switch']);
  const warn = (test, msg) => function () {
    this.setOnChange(function () {
      if (!this.workspace || this.isInFlyout || !this.rendered) return;
      this.setWarningText(test(this) ? null : msg);
    });
  };
  const ancestors = function* (b) { for (let p = b.getSurroundParent(); p; p = p.getSurroundParent()) yield p; };
  // names typed into define blocks stay valid C names
  reg('bk_c_name', function () {
    const f = this.getField('NAME');
    if (f) f.setValidator(v => cName(v, 'SPEED'));
  });
  reg('bk_flow_warning', warn(b => [...ancestors(b)].some(p => LOOPS.has(p.type)), 'Put this inside a loop.'));
  reg('bk_return_warning', warn(b => [...ancestors(b)].some(p => p.type === 'procedures_defreturn'), 'Use this inside a function that returns a value.'));
  reg('bk_face_warning', warn(b => {
    const id = b.getFieldValue('VAR');
    return [...ancestors(b)].some(p => p.type === 'bk_for_each_face' && p.getFieldValue('VAR') === id);
  }, 'Use this inside a "for each face" loop with the same name.'));
}

// The "C code" blocks keep source text. Multi-line code shows as rows of labels and is edited in a dialog.
function defineCodeBlocks(Blockly) {
  const { FieldCode, FieldCodeLine, FieldCodeLines } = defineFields;
  const MAX_LINES = 80;
  const rows = {
    onCodeChange_() {
      const code = String(this.getFieldValue('CODE') ?? '');
      const lines = code.split('\n');
      const multi = lines.length > 1;
      const field = this.getField('CODE');
      if (field && field.isVisible() === multi) field.setVisible(!multi);
      const main = this.getInput('MAIN');
      if (main && this.type === 'bk_c_stmt') main.setVisible(!multi);
      if (multi && !this.getInput('LINES')) this.appendDummyInput('LINES').appendField(new FieldCodeLines(''), 'LINES_TEXT');
      if (!multi && this.getInput('LINES')) this.removeInput('LINES');
      if (multi) {
        const shown = lines.length > MAX_LINES ? lines.slice(0, MAX_LINES - 1).concat(`… ${lines.length - MAX_LINES + 1} more lines`) : lines;
        this.getField('LINES_TEXT').setValue(shown.join('\n'));
      }
      if (this.rendered && this.queueRender) this.queueRender();
    },
  };
  Blockly.Blocks.bk_c_stmt = {
    ...rows,
    init() {
      this.appendDummyInput('MAIN').appendField(new FieldCode('setColor(WHITE);'), 'CODE');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setStyle('bk_code');
      this.setTooltip('C code, used as it is. Click it to edit.');
    },
  };
  Blockly.Blocks.bk_c_top = {
    ...rows,
    init() {
      this.appendDummyInput('MAIN').appendField(new Blockly.FieldLabel('C code', 'bkCodeTitle')).appendField(new FieldCode('byte level = 0;'), 'CODE');
      this.setStyle('bk_code');
      this.setTooltip('C code placed at the top of the sketch, outside setup() and loop(): types, arrays, #defines and functions.');
    },
  };
  Blockly.Blocks.bk_c_wrap = {
    init() {
      this.appendDummyInput('HEAD_ROW').appendField(new FieldCode('for (int i = 0; i < 10; i++)'), 'HEAD').appendField(new FieldCodeLine('{', 'bkMono'));
      this.appendStatementInput('DO');
      this.appendDummyInput('END').appendField(new FieldCodeLine('}', 'bkMono')).appendField(new FieldCode(''), 'TAIL');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setStyle('bk_code');
      this.setTooltip('C code wrapped around blocks, used as it is.');
    },
    onCodeChange_() {
      const tail = this.getField('TAIL');
      if (tail) tail.setVisible(String(tail.getValue() ?? '') !== '');
    },
  };
}

// ---------------------------------------------------------------------------------------------
// C generator
// ---------------------------------------------------------------------------------------------

const C_KEYWORDS = `alignas alignof and asm auto bool break case catch char char16_t char32_t class const constexpr const_cast
continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if
inline int long mutable namespace new noexcept not nullptr operator or private protected public register reinterpret_cast
return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef
typeid typename union unsigned using virtual void volatile wchar_t while xor
setup loop byte word boolean Color Timer FOREACH_FACE uint8_t int8_t uint16_t int16_t uint32_t int32_t
Serial main`.split(/\s+/);
let reservedNames = null;
function reserved() {
  if (!reservedNames) {
    reservedNames = new Set(C_KEYWORDS);
    for (const k of Object.keys(BUILTINS)) reservedNames.add(k);
    // object-like macros only: a function-like macro name (min, degrees) is fine as a variable
    for (const m of PRELUDE.matchAll(/#define\s+(\w+)(\(?)/g)) if (!m[2]) reservedNames.add(m[1]);
  }
  return reservedNames;
}

// A readable, valid C identifier for a block-made name ("my score" -> myScore)
function cIdent(name) {
  name = String(name || '');
  if (/^[A-Za-z_]\w*$/.test(name) && !reserved().has(name)) return name;
  const words = name.match(/[A-Za-z0-9_]+/g) || [];
  let id = words.map((w, i) => i ? w[0].toUpperCase() + w.slice(1) : w).join('') || 'x';
  if (/^\d/.test(id)) id = '_' + id;
  if (reserved().has(id)) id += '_';
  return id;
}

function identsIn(text) {
  return new Set(String(text).match(/[A-Za-z_]\w*/g) || []);
}

function commentLines(text) {
  return String(text).split('\n').map(l => ('// ' + l).trimEnd()).join('\n') + '\n';
}

function makeGenerator(Blockly) {
  const G = new (Blockly.CodeGenerator || Blockly.Generator)('C');
  G.INDENT = '  ';
  G.ORDER_OVERRIDES = [];
  G.orderOverrides = [];
  G.prefixLines = (text, prefix) => text.replace(/^(?=.)/gm, prefix);

  // Locals made so far, one set per C block ({ … }) being generated: the first set of a local
  // variable in a block makes it there
  G.scopes_ = [new Set()];
  const statementToCode = G.statementToCode.bind(G);
  G.statementToCode = function (block, name) {
    this.scopes_.push(new Set());
    try { return statementToCode(block, name); } finally { this.scopes_.pop(); }
  };

  G.init = function (ws) {
    this.isInitialized = true;
    this.scopes_ = [new Set()];
    this.ws_ = ws;
    // Names that are already good C stay exactly as they are (C code blocks may use them);
    // block-made names like "my score" become myScore, numbered if that clashes
    const used = new Set();
    this.names_ = new Map();
    const entries = sortedVars(ws).map(v => ['v:' + v.getId(), v.name]);
    for (const b of ws.getTopBlocks(true)) {
      if (b.type.startsWith('procedures_def')) entries.push(['p:' + b.getFieldValue('NAME'), b.getFieldValue('NAME')]);
    }
    const fixed = entries.filter(([, raw]) => cIdent(raw) === raw);
    for (const [key, raw] of fixed) { used.add(raw); this.names_.set(key, raw); }
    for (const [key, raw] of entries) {
      if (this.names_.has(key)) continue;
      let base = cIdent(raw), name = base;
      for (let n = 2; used.has(name); n++) name = base + n;
      used.add(name);
      this.names_.set(key, name);
    }
    for (const b of ws.getAllBlocks(false)) {
      if (b.type === 'bk_c_stmt' || b.type === 'bk_c_expr' || b.type === 'bk_c_top') identsIn(b.getFieldValue('CODE')).forEach(n => used.add(n));
      if (b.type === 'bk_c_wrap') identsIn(b.getFieldValue('HEAD') + ' ' + b.getFieldValue('TAIL')).forEach(n => used.add(n));
    }
    this.used_ = used;
  };
  G.varName = function (id) {
    if (this.names_ && this.names_.has('v:' + id)) return this.names_.get('v:' + id);
    const v = this.ws_ && this.ws_.getVariableMap().getVariableById(id);
    return cIdent(v ? v.name : 'x');
  };
  G.procName = function (name) {
    return (this.names_ && this.names_.get('p:' + name)) || cIdent(name);
  };
  G.loopVar = function (block) {
    let depth = 0;
    for (let p = block.getSurroundParent(); p; p = p.getSurroundParent()) if (p.type === 'controls_repeat_ext') depth++;
    const free = [];
    for (let n = 1; free.length <= depth; n++) {
      for (const c of ['i', 'j', 'k']) {
        const name = n === 1 ? c : c + n;
        if (!this.used_ || !this.used_.has(name)) free.push(name);
      }
    }
    return free[depth];
  };

  // Comments: a statement's own comment and those of the values inside it go above it
  G.scrub_ = function (block, code, thisOnly) {
    if (!block.outputConnection) {
      const notes = [];
      const c = block.getCommentText && block.getCommentText();
      if (c) notes.push(c);
      collectValueComments(block, notes);
      if (notes.length && code) code = notes.map(commentLines).join('') + code;
      if (!thisOnly && block.nextConnection) code += this.blockToCode(block.nextConnection.targetBlock());
    }
    return code;
  };

  const v = (block, name, order, fallback) => G.valueToCode(block, name, order) || fallback;
  const fieldVar = (block, name) => G.varName(block.getFieldValue(name));
  const body = (block, name) => G.statementToCode(block, name);
  const def = { [N]: '0', [B]: 'false', [C]: 'OFF' };
  const F = G.forBlock;

  for (const [type, , , fn, args, out] of CALL_BLOCKS) {
    F[type] = block => {
      const code = `${fn}(${args.map(([name, check]) => v(block, name, ORDER.COMMA, def[check] || '0')).join(', ')})`;
      return out ? [code, ORDER.POSTFIX] : code + ';\n';
    };
  }
  F.bk_color = block => {
    const value = block.getFieldValue('COLOR');
    const mix = parseMix(value);
    return mix ? [`makeColorRGB(${mix.join(', ')})`, ORDER.POSTFIX] : [value, ORDER.ATOMIC];
  };
  F.bk_random_color = () => ['makeColorHSB(random(255), 255, 255)', ORDER.POSTFIX];
  F.bk_button = block => [block.getFieldValue('EVENT') + '()', ORDER.POSTFIX];
  F.bk_button_clear = block => block.getFieldValue('EVENT') + '();\n';
  F.bk_neighbor = block => ['!isValueReceivedOnFaceExpired(' + v(block, 'FACE', ORDER.COMMA, '0') + ')', ORDER.UNARY];
  F.bk_timer_set = block => `${fieldVar(block, 'TIMER')}.set(${v(block, 'MS', ORDER.COMMA, '0')});\n`;
  F.bk_timer_add = block => `${fieldVar(block, 'TIMER')}.add(${v(block, 'MS', ORDER.COMMA, '0')});\n`;
  F.bk_timer_never = block => `${fieldVar(block, 'TIMER')}.never();\n`;
  F.bk_timer_done = block => [`${fieldVar(block, 'TIMER')}.isExpired()`, ORDER.POSTFIX];
  F.bk_timer_left = block => [`${fieldVar(block, 'TIMER')}.getRemaining()`, ORDER.POSTFIX];

  F.controls_if = block => {
    let code = '';
    for (let n = 0; block.getInput('IF' + n); n++) {
      code += (n ? ' else if (' : 'if (') + v(block, 'IF' + n, ORDER.NONE, 'false') + ') {\n' + body(block, 'DO' + n) + '}';
    }
    if (block.getInput('ELSE')) code += ' else {\n' + body(block, 'ELSE') + '}';
    return code + '\n';
  };
  F.controls_whileUntil = block => {
    const until = block.getFieldValue('MODE') === 'UNTIL';
    const cond = until ? '!' + v(block, 'BOOL', ORDER.UNARY, 'false') : v(block, 'BOOL', ORDER.NONE, 'false');
    return `while (${cond}) {\n${body(block, 'DO')}}\n`;
  };
  F.controls_repeat_ext = block => {
    const i = G.loopVar(block);
    return `for (int ${i} = 0; ${i} < ${v(block, 'TIMES', ORDER.REL, '0')}; ${i}++) {\n${body(block, 'DO')}}\n`;
  };
  F.bk_for_each_face = block => `FOREACH_FACE(${fieldVar(block, 'VAR')}) {\n${body(block, 'DO')}}\n`;
  F.bk_face_var = block => [fieldVar(block, 'VAR'), ORDER.ATOMIC];
  F.bk_flow = block => block.getFieldValue('FLOW') === 'CONTINUE' ? 'continue;\n' : 'break;\n';
  F.bk_return = () => 'return;\n';
  F.bk_return_value = block => `return ${v(block, 'VALUE', ORDER.NONE, '0')};\n`;

  F.math_number = block => {
    const n = Number(block.getFieldValue('NUM'));
    return [String(n), n < 0 ? ORDER.UNARY : ORDER.ATOMIC];
  };
  const ARITH = { ADD: ['+', ORDER.ADD], SUB: ['-', ORDER.ADD], MUL: ['*', ORDER.MUL], DIV: ['/', ORDER.MUL], MOD: ['%', ORDER.MUL] };
  const binary = (block, op, order, fb) =>
    [`${v(block, 'A', order + 1, fb)} ${op} ${v(block, 'B', order, fb)}`, order];
  F.bk_arith = block => { const [op, order] = ARITH[block.getFieldValue('OP')]; return binary(block, op, order, '0'); };
  F.bk_minmax = block => [`${block.getFieldValue('OP')}(${v(block, 'A', ORDER.COMMA, '0')}, ${v(block, 'B', ORDER.COMMA, '0')})`, ORDER.POSTFIX];
  const COMPARE = { EQ: ['==', ORDER.EQ], NEQ: ['!=', ORDER.EQ], LT: ['<', ORDER.REL], LTE: ['<=', ORDER.REL], GT: ['>', ORDER.REL], GTE: ['>=', ORDER.REL] };
  F.bk_compare = block => { const [op, order] = COMPARE[block.getFieldValue('OP')]; return binary(block, op, order, '0'); };
  F.bk_and_or = block => block.getFieldValue('OP') === 'OR' ? binary(block, '||', ORDER.OR, 'false') : binary(block, '&&', ORDER.AND, 'false');
  F.bk_not = block => {
    const inner = block.getInputTargetBlock('BOOL');
    if (inner && inner.type === 'bk_neighbor' && inner.isEnabled()) {
      return [`isValueReceivedOnFaceExpired(${v(inner, 'FACE', ORDER.COMMA, '0')})`, ORDER.POSTFIX];
    }
    return ['!' + v(block, 'BOOL', ORDER.UNARY, 'false'), ORDER.UNARY];
  };
  F.bk_bool = block => [block.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false', ORDER.ATOMIC];

  for (const kind of ['num', 'bool', 'color']) {
    F[GETTER[kind]] = block => [fieldVar(block, 'VAR'), ORDER.ATOMIC];
  }
  F.bk_set = block => {
    const m = block.getField('VAR').getVariable();
    const kind = m ? kindOf(m.type) : 'num';
    const code = `${fieldVar(block, 'VAR')} = ${v(block, 'VALUE', ORDER.COMMA, def[KIND_CHECK[kind]] || '0')};\n`;
    if (!m || !isLocalType(m.type) || G.scopes_.some(sc => sc.has(m.getId()))) return code;
    G.scopes_[G.scopes_.length - 1].add(m.getId());
    return `${cType(m.type)} ${code}`;
  };
  F.bk_change = block => {
    const name = fieldVar(block, 'VAR');
    const by = block.getInputTargetBlock('DELTA');
    if (by && by.type === 'math_number' && by.isEnabled()) {
      const n = Number(by.getFieldValue('NUM'));
      if (n === 1) return `${name}++;\n`;
      if (n === -1) return `${name}--;\n`;
      if (n < 0) return `${name} -= ${-n};\n`;
    }
    return `${name} += ${v(block, 'DELTA', ORDER.COMMA, '1')};\n`;
  };

  // Lists
  const listVar = block => {
    const id = block.getFieldValue('LIST');
    const m = id && G.ws_ && G.ws_.getVariableMap().getVariableById(id);
    return { name: G.varName(id), item: m && isList(m.type) ? cType(itemType(m.type)) : 'int' };
  };
  const item = block => `${listVar(block).name}[${v(block, 'INDEX', ORDER.NONE, '0')}]`;
  F.bk_list_decl = block => {
    const l = listVar(block);
    const n = Math.max(1, Math.min(LIST_MAX, Math.floor(Number(block.getFieldValue('COUNT')) || LIST_SIZE)));
    return `${l.item} ${l.name}[${n}];\n`;
  };
  F.bk_list_init = block => {
    const l = listVar(block);
    const items = [];
    for (let i = 0; block.getInput('ITEM' + i); i++) items.push(v(block, 'ITEM' + i, ORDER.COMMA, '0'));
    return `${l.item} ${l.name}[] = { ${items.join(', ')} };\n`;
  };
  for (const kind of ['num', 'bool', 'color']) {
    F['bk_list_get_' + kind] = block => [item(block), ORDER.POSTFIX];
    F['bk_list_set_' + kind] = block => `${item(block)} = ${v(block, 'VALUE', ORDER.COMMA, def[KIND_CHECK[kind]])};\n`;
  }
  F.bk_list_change = block => {
    const it = item(block);
    const by = block.getInputTargetBlock('DELTA');
    if (by && by.type === 'math_number' && by.isEnabled()) {
      const n = Number(by.getFieldValue('NUM'));
      if (n === 1) return `${it}++;\n`;
      if (n === -1) return `${it}--;\n`;
      if (n < 0) return `${it} -= ${-n};\n`;
    }
    return `${it} += ${v(block, 'DELTA', ORDER.COMMA, '1')};\n`;
  };
  F.bk_list_length = block => [`COUNT_OF(${listVar(block).name})`, ORDER.POSTFIX];

  // switch: each case ends with break; "or" values become stacked case labels
  const caseLabels = (block, name) => {
    const t = block.getInputTargetBlock(name);
    if (!t || !t.isEnabled()) return [];
    if (t.type === 'bk_case_or') return [...caseLabels(t, 'A'), ...caseLabels(t, 'B')];
    return [G.valueToCode(block, name, ORDER.NONE)].filter(Boolean);
  };
  F.bk_switch = block => {
    const I = G.INDENT;
    let code = `switch (${v(block, 'SWITCH', ORDER.NONE, '0')}) {\n`;
    for (let i = 0; block.getInput('CASE' + i); i++) {
      const labels = caseLabels(block, 'CASE' + i);
      if (!labels.length) continue;
      code += labels.map(l => `${I}case ${l}:\n`).join('') + G.prefixLines(body(block, 'DO' + i), I) + `${I}${I}break;\n`;
    }
    const other = body(block, 'DEFAULT');
    if (other) code += `${I}default:\n` + G.prefixLines(other, I) + `${I}${I}break;\n`;
    return code + '}\n';
  };
  // outside a switch case, "or" means either is true
  F.bk_case_or = block => [`${v(block, 'A', ORDER.OR + 1, '0')} || ${v(block, 'B', ORDER.OR, '0')}`, ORDER.OR];

  // Bits
  F.bk_shift = block => binary(block, block.getFieldValue('DIR') === 'LEFT' ? '<<' : '>>', ORDER.SHIFT, '0');
  const BITWISE = { AND: ['&', ORDER.BAND], OR: ['|', ORDER.BOR], XOR: ['^', ORDER.BXOR] };
  F.bk_bitwise = block => { const [op, order] = BITWISE[block.getFieldValue('OP')]; return binary(block, op, order, '0'); };
  F.bk_bitnot = block => ['~' + v(block, 'A', ORDER.UNARY, '0'), ORDER.UNARY];
  F.bk_get_bits = block => {
    const a = Number(block.getFieldValue('LO')), b = Number(block.getFieldValue('HI'));
    const lo = Math.min(a, b), mask = 2 ** (Math.abs(b - a) + 1) - 1;
    if (!lo) return [`${v(block, 'A', ORDER.BAND + 1, '0')} & ${mask}`, ORDER.BAND];
    return [`(${v(block, 'A', ORDER.SHIFT + 1, '0')} >> ${lo}) & ${mask}`, ORDER.BAND];
  };
  F.bk_bits = block => ['0b' + (block.getFieldValue('BITS') >>> 0).toString(2).padStart(8, '0'), ORDER.ATOMIC];

  // Constants
  F.bk_define = block => `#define ${cName(block.getFieldValue('NAME'), 'SPEED')} ${v(block, 'VALUE', ORDER.ATOMIC, '0')}\n`;
  F.bk_define_value = block => [block.getFieldValue('NAME'), ORDER.ATOMIC];
  F.bk_enum = block => {
    const name = cName(block.getFieldValue('NAME'), '');
    return `enum ${name ? name + ' ' : ''}{ ${block.itemNames_().join(', ')} };\n`;
  };
  F.bk_enum_value = block => [block.getFieldValue('NAME'), ORDER.ATOMIC];

  F.procedures_callnoreturn = block => procCall(block) + ';\n';
  F.procedures_callreturn = block => [procCall(block), ORDER.POSTFIX];
  F.procedures_ifreturn = block => {
    const ret = block.hasReturnValue_ ? ' ' + v(block, 'VALUE', ORDER.NONE, '0') : '';
    return `if (${v(block, 'CONDITION', ORDER.NONE, 'false')}) {\n${G.INDENT}return${ret};\n}\n`;
  };
  function procCall(block) {
    const args = [];
    for (let i = 0; block.getInput('ARG' + i); i++) args.push(v(block, 'ARG' + i, ORDER.COMMA, '0'));
    return `${G.procName(block.getFieldValue('NAME'))}(${args.join(', ')})`;
  }

  F.bk_c_stmt = block => {
    const code = String(block.getFieldValue('CODE') ?? '').trimEnd();
    return code ? code + '\n' : '';
  };
  F.bk_c_expr = block => {
    const code = String(block.getFieldValue('CODE') ?? '').trim();
    return code ? [code, rawExprOrder(code)] : ['0', ORDER.ATOMIC];
  };
  F.bk_c_wrap = block => {
    const head = String(block.getFieldValue('HEAD') ?? '').trim();
    const tail = String(block.getFieldValue('TAIL') ?? '').trim();
    return `${head ? head + ' ' : ''}{\n${body(block, 'DO')}}${tail ? ' ' + tail : ''}\n`;
  };
  F.bk_c_top = () => '';
  return G;
}

// C types of a function block that blocks can't show: { ret, params: { name: type } } in block.data
function procInfo(d) {
  let info = {};
  try { info = d.data ? JSON.parse(d.data) : {}; } catch (e) { info = { ret: d.data }; }
  if (!info || typeof info !== 'object') info = {};
  if (!info.params || typeof info.params !== 'object') info.params = {};
  return info;
}

function collectValueComments(block, out) {
  for (const input of block.inputList) {
    if (!input.connection || input.connection.type !== 1 /* INPUT_VALUE */) continue;
    const child = input.connection.targetBlock();
    if (!child || !child.isEnabled()) continue;
    const c = child.getCommentText && child.getCommentText();
    if (c) out.push(c);
    collectValueComments(child, out);
  }
}

// Raw C expressions keep their text; they only need parentheses when they aren't a simple operand
function rawExprOrder(code) {
  let toks;
  try { toks = tokenize(code).tokens.filter(t => t.t !== 'eof'); } catch (e) { return ORDER.ASSIGN; }
  if (!toks.length) return ORDER.ATOMIC;
  const isOp = (t, v) => t && t.t === 'op' && t.v === v;
  const match = i => {
    const open = toks[i].v, close = open === '(' ? ')' : ']';
    let d = 0;
    for (let k = i; k < toks.length; k++) {
      if (isOp(toks[k], open)) d++;
      else if (isOp(toks[k], close) && --d === 0) return k;
    }
    return -1;
  };
  if (isOp(toks[0], '(') && match(0) === toks.length - 1) return ORDER.ATOMIC;
  let i = 0;
  if (toks[0].t === 'num' || toks[0].t === 'char') return toks.length === 1 ? ORDER.ATOMIC : ORDER.ASSIGN;
  if (toks[0].t === 'str') return toks.every(t => t.t === 'str') ? ORDER.ATOMIC : ORDER.ASSIGN;
  if (toks[0].t !== 'id') return hasTopComma(toks) ? ORDER.COMMA : ORDER.ASSIGN;
  i = 1;
  while (i < toks.length) {
    if (isOp(toks[i], '::') || isOp(toks[i], '.') || isOp(toks[i], '->')) {
      if (!toks[i + 1] || toks[i + 1].t !== 'id') break;
      i += 2;
    } else if (isOp(toks[i], '(') || isOp(toks[i], '[')) {
      const k = match(i);
      if (k < 0) break;
      i = k + 1;
    } else break;
  }
  if (i === toks.length) return ORDER.POSTFIX;
  return hasTopComma(toks) ? ORDER.COMMA : ORDER.ASSIGN;
}

function hasTopComma(toks) {
  let d = 0;
  for (const t of toks) {
    if (t.t !== 'op') continue;
    if (t.v === '(' || t.v === '[' || t.v === '{') d++;
    else if (t.v === ')' || t.v === ']' || t.v === '}') d--;
    else if (t.v === ',' && d === 0) return true;
  }
  return false;
}

function sortedVars(ws) {
  const all = ws.getVariableMap().getAllVariables();
  const rank = t => { const i = VAR_TYPE_ORDER.indexOf(t); return i < 0 ? VAR_TYPE_ORDER.length : i; };
  return all.map((v, i) => [v, i]).sort((a, b) => rank(a[0].type) - rank(b[0].type) || a[1] - b[1]).map(x => x[0]);
}

const DEFINES_SETUP = /\bvoid\s+setup\s*\(\s*(void\s*)?\)\s*\{/;
const DEFINES_LOOP = /\bvoid\s+loop\s*\(\s*(void\s*)?\)\s*\{/;

// The whole sketch: header, globals, top-level C, setup(), loop() (events first), then functions
function generateProgram(ws, G) {
  G.init(ws);
  const tops = ws.getTopBlocks(true).filter(b => b.isEnabled());
  const of = (...types) => tops.filter(b => types.includes(b.type));
  const hatBody = hat => G.prefixLines(G.blockToCode(hat.getNextBlock()) || '', G.INDENT);
  const fresh = () => { G.scopes_ = [new Set()]; };   // a new C function or block
  const hatComment = hat => { const c = hat.getCommentText(); return c ? commentLines(c) : ''; };

  // Variables: params of functions are not globals unless something outside the function uses them too
  const defs = of('procedures_defnoreturn', 'procedures_defreturn');
  const paramOf = new Map();
  for (const d of defs) for (const m of d.getVarModels()) {
    if (!paramOf.has(m.getId())) paramOf.set(m.getId(), new Set());
    paramOf.get(m.getId()).add(d.id);
  }
  const useGlobal = new Set(), usedAtAll = new Set();
  for (const b of ws.getAllBlocks(false)) {
    if (b.type.startsWith('procedures_') || !b.isEnabled()) continue;
    for (const input of b.inputList) for (const f of input.fieldRow) {
      if (typeof f.getVariable !== 'function') continue;
      const id = f.getValue();
      usedAtAll.add(id);
      const root = b.getRootBlock();
      if (!(paramOf.get(id) && paramOf.get(id).has(root.id))) useGlobal.add(id);
    }
  }
  const globals = [];
  for (const m of sortedVars(ws)) {
    const id = m.getId();
    if (m.type === 'face' || !VAR_TYPE_ORDER.includes(m.type)) continue;
    const declare = useGlobal.has(id) || (!paramOf.has(id) && !usedAtAll.has(id) && m.type !== '');
    if (declare) globals.push(`${cType(m.type)} ${G.varName(id)};`);
  }

  // Lists are set up by the first block for each one, in workspace order with the C code blocks
  // (their starting items may use names those define); a list without one gets an item per face
  const setUp = new Set();
  const listSetups = new Set(of('bk_list_decl', 'bk_list_init').filter(b => {
    const id = b.getFieldValue('LIST');
    if (setUp.has(id)) return false;
    setUp.add(id);
    return true;
  }));
  for (const m of sortedVars(ws)) {
    if (isList(m.type) && !setUp.has(m.getId())) globals.push(`${cType(itemType(m.type))} ${G.varName(m.getId())}[${LIST_SIZE}];`);
  }

  const parts = ['// ' + HEADER];
  for (const c of ws.getTopComments(true)) {
    const text = String(c.getText() ?? '').replace(/\s+$/, '');
    if (text) parts.push(commentLines(text).trimEnd());
  }
  if (globals.length) parts.push(globals.join('\n'));
  const raws = of('bk_c_top');
  // list setups, defines and enums sit in workspace order with the C code blocks, since each may
  // use names another one makes; neighbors of one kind share a paragraph
  let run = [], runType = null;
  const flush = () => { if (run.length) parts.push(run.join('\n')); run = []; runType = null; };
  for (const b of of('bk_c_top', 'bk_list_decl', 'bk_list_init', 'bk_define', 'bk_enum')) {
    if (b.type === 'bk_c_top') {
      flush();
      const text = String(b.getFieldValue('CODE') ?? '').trimEnd();
      if (text) parts.push(hatComment(b) + text);
      continue;
    }
    if (b.type.startsWith('bk_list') && !listSetups.has(b)) continue;
    const kind = b.type.startsWith('bk_list') ? 'list' : b.type;
    if (runType && runType !== kind) flush();
    runType = kind;
    run.push(G.blockToCode(b).trimEnd());
  }
  flush();
  const rawText = raws.map(r => r.getFieldValue('CODE')).join('\n');

  const setups = of('bk_setup'), loops = of('bk_loop');
  if (setups.length || !DEFINES_SETUP.test(rawText)) {
    fresh();
    parts.push(setups.map(hatComment).join('') + 'void setup() {\n' + setups.map(hatBody).join('') + '}');
  }

  // Events become ifs at the top of loop(); the same event twice shares one if (a button flag clears when read)
  const events = new Map();
  for (const hat of of('bk_when_button', 'bk_when_timer')) {
    const cond = hat.type === 'bk_when_button' ? hat.getFieldValue('EVENT') + '()' : G.varName(hat.getFieldValue('TIMER')) + '.isExpired()';
    if (!events.has(cond)) events.set(cond, []);
    events.get(cond).push(hat);
  }
  let eventCode = '';
  for (const [cond, hats] of events) {
    fresh();
    eventCode += hats.map(hatComment).join('') + `if (${cond}) {\n` + hats.map(hatBody).join('') + '}\n';
  }
  if (loops.length || events.size || !DEFINES_LOOP.test(rawText)) {
    fresh();
    parts.push(loops.map(hatComment).join('') + 'void loop() {\n' + G.prefixLines(eventCode, G.INDENT) + loops.map(hatBody).join('') + '}');
  }

  for (const d of defs) {
    fresh();
    const name = G.procName(d.getFieldValue('NAME'));
    const info = procInfo(d);
    const params = d.getVarModels().map(m => `${(m.type === '' && info.params[m.name]) || cType(m.type)} ${G.varName(m.getId())}`).join(', ');
    const stack = G.statementToCode(d, 'STACK');
    if (d.type === 'procedures_defreturn') {
      const ret = info.ret || 'int';
      const notes = [];
      const rv = d.getInputTargetBlock('RETURN');
      if (rv && rv.isEnabled()) {
        const c = rv.getCommentText();
        if (c) notes.push(c);
        collectValueComments(rv, notes);
      }
      const value = G.valueToCode(d, 'RETURN', ORDER.NONE) || ({ bool: 'false', Color: 'OFF' }[ret] || '0');
      const retLine = G.prefixLines(notes.map(commentLines).join('') + `return ${value};\n`, G.INDENT);
      parts.push(hatComment(d) + `${ret} ${name}(${params}) {\n${stack}${retLine}}`);
    } else {
      parts.push(hatComment(d) + `void ${name}(${params}) {\n${stack}}`);
    }
  }
  return parts.join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// C -> blocks importer
// ---------------------------------------------------------------------------------------------

class Unsupported extends Error {}

const CONDITIONAL_DIRECTIVES = new Set(['if', 'ifdef', 'ifndef', 'elif', 'else', 'endif']);

let preludeFnMacros = null;
function functionLikeMacros(userDefines) {
  if (!preludeFnMacros) preludeFnMacros = new Set([...PRELUDE.matchAll(/#define\s+(\w+)\(/g)].map(m => m[1]));
  const s = new Set(preludeFnMacros);
  for (const d of userDefines) if (d.params) s.add(d.name);
  return s;
}

// C type descriptor -> variable type, or null if blocks can't hold it
function varTypeOf(t) {
  if (!t) return null;
  if (t.k === 'int') {
    if (t.isBool) return 'bool';
    if (t.wide) return null;
    if (t.size === 1) return t.signed ? (t.name === 'char' ? 'char' : 'int8_t') : 'byte';
    if (t.size === 2) return t.signed ? 'int' : 'word';
    if (t.size === 4) return t.signed ? 'long' : 'unsigned long';
  }
  if (t.k === 'float') return 'float';
  if (t.k === 'enum' && t.base && t.base.k === 'int' && t.base.size === 2 && t.base.signed) return 'int';   // enums are ints
  if (t.k === 'color') return 'Color';
  if (t.k === 'struct' && t.def && t.def.builtin === 'timer') return 'Timer';
  return null;
}

// Comments with their source offsets (the lexer's list has no columns)
function scanComments(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  let lineStart = 0;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; lineStart = i; continue; }
    if (c === '"' || (c === "'" && !(/[0-9a-fA-F]/.test(src[i - 1] || '') && /[0-9a-fA-F]/.test(src[i + 1] || '') && /\d/.test(src.slice(lineStart, i).match(/[\w']*$/)[0][0] || '')))) {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      i = src[j] === '\n' ? j : j + 1;
      continue;
    }
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      const start = i, l0 = line;
      const bol = /^\s*$/.test(src.slice(lineStart, i));
      let text;
      if (src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i += (src[i] === '\\' && src[i + 1] === '\n') ? 2 : 1;
        text = src.slice(start + 2, i).replace(/^\/*/, '').replace(/^ /, '').trimEnd();
      } else {
        const end = src.indexOf('*/', i + 2);
        i = end < 0 ? n : end + 2;
        text = blockCommentText(src.slice(start + 2, end < 0 ? n : end));
        for (let k = start; k < i; k++) if (src[k] === '\n') { line++; lineStart = k + 1; }
      }
      out.push({ start, end: i, line: l0, endLine: line, text, bol });
      continue;
    }
    i++;
  }
  return out;
}

// /* ... */ text without the decoration, keeping relative indentation
function blockCommentText(body) {
  let lines = body.split('\n');
  lines[0] = lines[0].replace(/^\*+/, '').replace(/^ /, '');
  const rest = lines.slice(1);
  if (rest.every(l => !l.trim() || /^\s*\*/.test(l))) {
    lines = [lines[0], ...rest.map(l => l.replace(/^\s*\*(?!\/) ?/, ''))];
  } else {
    const ind = Math.min(...rest.filter(l => l.trim()).map(l => l.match(/^[ \t]*/)[0].length));
    lines = [lines[0], ...rest.map(l => l.slice(Math.min(ind, l.match(/^[ \t]*/)[0].length)))];
  }
  return lines.map(l => l.trimEnd()).join('\n').replace(/^\n+|\n+$/g, '');
}

function chain(blocks) {
  let first = null, prev = null;
  for (const b of blocks) {
    if (!b) continue;
    let last = b;
    while (last.next) last = last.next.block;
    if (prev) prev.next = { block: b }; else first = b;
    prev = last;
  }
  return first;
}

const stripParens = e => { while (e && e.kind === 'Paren') e = e.expr; return e; };

// The value of a constant whole-number expression (an array size), or null
function constInt(e) {
  e = stripParens(e);
  if (!e) return null;
  if (e.kind === 'Num') return e.isFloat ? null : e.value;
  if (e.kind === 'Unary' && e.op === '-') { const v = constInt(e.arg); return v == null ? null : -v; }
  if (e.kind === 'Binary') {
    const a = constInt(e.l), b = constInt(e.r);
    if (a == null || b == null) return null;
    switch (e.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b ? Math.trunc(a / b) : null;
      case '%': return b ? a % b : null;
    }
  }
  return null;
}

function importSketch(source) {
  const src = String(source ?? '').replace(/\r\n?/g, '\n');
  let pp, ast, toks;
  try {
    pp = preprocess(src);
  } catch (e) {
    if (e instanceof CompileError) return { ok: false, message: (e.line ? `Line ${e.line}: ` : '') + e.message };
    throw e;
  }
  // Parse with each token's index as its "line": every AST node then points at its first token
  toks = pp.tokens.map((t, i) => ({ ...t, line: i, realLine: t.line }));
  try {
    ast = parse(toks);
  } catch (e) {
    if (e instanceof CompileError) {
      const t = pp.tokens[e.line];
      return { ok: false, message: (t ? `Line ${t.line}: ` : '') + e.message };
    }
    throw e;
  }
  const im = new Importer(src, pp, toks, ast);
  let result;
  try {
    result = im.run();
  } catch (e) {
    if (!(e instanceof Unsupported)) console.warn('Blocks import fell back to C:', e);
    result = im.wholeProgramAsC();
  }
  result.fallback = () => im.wholeProgramAsC();
  return result;
}

class Importer {
  constructor(src, pp, toks, ast) {
    this.src = src;
    this.pp = pp;
    this.toks = toks;
    this.ast = ast;
    this.lineStarts = [0];
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') this.lineStarts.push(i + 1);
    this.orig = tokenize(src).tokens;
    this.origAt = new Map(this.orig.map((t, i) => [this.offAt(t.line, t.col), i]));
    this.fnMacros = functionLikeMacros(pp.defines);
    this.comments = scanComments(src);
    this.notes = new Set();
    this.rawCount = 0;
    this.vars = [];             // { name, id, type } for the workspace
    this.globals = new Map();   // name -> var
    this.procs = new Map();     // name -> { ret, params: [var], node }
    this.anchors = [];          // { line, target } blocks that comments can attach to
    this.rawRanges = [];        // [start, end) source offsets kept verbatim
    this.prologue = [];         // global starting values, run first in setup
    this.notesOnWorkspace = []; // file comments shown as workspace comments
    this.nextId = 1;
    // names the sketch makes with enum, and its own #defines of values (not function-like ones)
    this.enumNames = new Set(ast.items.filter(it => it.kind === 'TypeDecl' && it.type && it.type.k === 'enum' && it.type.def).flatMap(it => it.type.def.items.map(x => x.name)));
    this.userDefines = new Set();
    this.orig.forEach((t, i) => {
      const d = this.orig[i + 1], n = this.orig[i + 2], after = this.orig[i + 3];
      if (t.t === 'op' && t.v === '#' && t.bol && d && d.v === 'define' && n && n.t === 'id' && !(after && after.v === '(' && !after.space && after.line === n.line)) this.userDefines.add(n.v);
    });
  }

  offAt(line, col) { return this.lineStarts[line - 1] + col - 1; }
  off(i) { const t = this.toks[i]; return this.offAt(t.realLine, t.col); }
  realLine(i) { return this.toks[Math.min(i, this.toks.length - 1)].realLine; }

  // ---- macro expansions: a run of tokens that all come from one macro use ----
  samePos(i, j) { const a = this.toks[i], b = this.toks[j]; return a && b && a.hide && b.hide && a.realLine === b.realLine && a.col === b.col; }
  runStart(i) { while (i > 0 && this.samePos(i - 1, i)) i--; return i; }
  runEnd(i) { while (i + 1 < this.toks.length && this.samePos(i + 1, i)) i++; return i; }
  isExactRun(lo, hi) { return !!this.toks[lo].hide && this.runStart(lo) === lo && this.runEnd(lo) === hi; }
  macroName(i) { const o = this.origAt.get(this.off(i)); return o == null ? null : this.orig[o].v; }

  // Source offset just after token i (for a macro, after its whole use, arguments included)
  tokEnd(i) {
    const t = this.toks[i];
    const start = this.off(i);
    if (!t.hide) return start + tokenText(t).length;
    let o = this.origAt.get(start);
    if (o == null) throw new Unsupported('macro position');
    const ot = this.orig[o];
    const nx = this.orig[o + 1];
    if (ot.t === 'id' && this.fnMacros.has(ot.v) && nx && nx.t === 'op' && nx.v === '(') {
      let d = 0;
      for (let k = o + 1; k < this.orig.length; k++) {
        const x = this.orig[k];
        if (x.t !== 'op') continue;
        if (x.v === '(') d++;
        else if (x.v === ')' && --d === 0) return this.offAt(x.line, x.col) + 1;
      }
      throw new Unsupported('macro parens');
    }
    return start + tokenText(ot).length;
  }

  // Source text of tokens lo..hi, if it can be cut out cleanly
  slice(lo, hi, { stmt = false, expr = false } = {}) {
    if (lo > hi) throw new Unsupported('empty');
    if (this.toks[lo].hide && this.runStart(lo) !== lo) throw new Unsupported('inside macro');
    if (this.toks[hi].hide && this.runEnd(hi) !== hi) throw new Unsupported('inside macro');
    const a = this.off(lo);
    let b = this.tokEnd(hi);
    if (expr && this.comments.some(c => c.start >= a && c.start < b)) throw new Unsupported('comment in expression');
    if (stmt) {
      const c = this.comments.find(c => c.start >= b && !c.text.includes('\n') && c.line === this.lineOf(b) && /^[ \t]*$/.test(this.src.slice(b, c.start)) && !this.src.slice(c.start, c.end).includes('\n'));
      if (c) b = c.end;
    }
    this.rawRanges.push([a, b]);
    let text = this.src.slice(a, b);
    if (expr) return text.replace(/\s*\n\s*/g, ' ').trim();
    const base = this.toks[lo].col - 1;
    text = text.split('\n').map((l, k) => {
      if (k) { let n = 0; while (n < base && (l[n] === ' ' || l[n] === '\t')) n++; l = l.slice(n); }
      return l.trimEnd();
    }).join('\n');
    return text;
  }
  lineOf(offset) {
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.lineStarts[m] <= offset) lo = m; else hi = m - 1; }
    return lo + 1;
  }

  // Token range [lo, hi] covered by an expression
  exprRange(node) {
    let lo = Infinity, hi = -Infinity;
    const toks = this.toks;
    const skipParens = i => {
      while (i < toks.length && !(toks[i].t === 'op' && (toks[i].v === '(' || toks[i].v === '{'))) i++;
      let d = 0;
      for (let k = i; k < toks.length; k++) {
        const t = toks[k];
        if (t.t !== 'op') continue;
        if (t.v === '(' || t.v === '{' || t.v === '[') d++;
        else if ((t.v === ')' || t.v === '}' || t.v === ']') && --d === 0) return k;
      }
      return i;
    };
    const visit = n => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(visit); return; }
      if (typeof n.kind !== 'string') return;
      if (typeof n.line === 'number') { lo = Math.min(lo, n.line); hi = Math.max(hi, n.line); }
      if (n.kind === 'Member') hi = Math.max(hi, n.line + 1);
      if (n.kind === 'Ident' && n.name.includes('::')) hi = Math.max(hi, n.line + 2 * (n.name.split('::').length - 1));
      if (n.kind === 'Str') { let k = n.line; while (toks[k + 1] && toks[k + 1].t === 'str') k++; hi = Math.max(hi, k); }
      if (n.kind === 'Construct' || n.kind === 'SizeofType') hi = Math.max(hi, skipParens(n.line));
      for (const k of Object.keys(n)) if (k !== 'type' && k !== 'line') visit(n[k]);
    };
    visit(node);
    let d = 0;
    const adj = t => { if (t.t !== 'op') return; if (t.v === '(' || t.v === '[' || t.v === '{') d++; else if (t.v === ')' || t.v === ']' || t.v === '}') d--; };
    for (let i = lo; i <= hi; i++) adj(toks[i]);
    while (d > 0 && hi + 1 < toks.length) adj(toks[++hi]);
    return [lo, hi];
  }

  // ---- workspace pieces ----
  newVar(name, type) {
    const v = { name, id: 'bkv' + this.nextId++, type };
    this.vars.push(v);
    return v;
  }
  findVar(name, type) { return this.vars.find(v => v.name === name && v.type === type); }
  varFor(name, type) { return this.findVar(name, type) || this.newVar(name, type); }
  canName(name, type) {
    // Blockly treats names case-insensitively within a type
    return !this.vars.some(v => v.type === type && v.name !== name && v.name.toLowerCase() === name.toLowerCase());
  }
  anchor(node, target) { this.anchors.push({ line: this.realLine(node.line), target }); return target; }

  // `#define NAME value` where the value is a number or a named color: a define block. The tokens
  // after the name, on the directive's line (a comment there becomes the block's comment).
  defineBlock(hash, a, b) {
    const i = this.orig.indexOf(hash);
    const d = this.orig[i + 1], n = this.orig[i + 2];
    if (!d || d.v !== 'define' || !n || n.t !== 'id' || !this.userDefines.has(n.v)) return null;
    const body = [];
    for (let k = i + 3; this.orig[k] && this.orig[k].t !== 'eof' && this.orig[k].line === hash.line; k++) body.push(this.orig[k]);
    let toks = body;
    while (toks.length >= 3 && toks[0].v === '(' && toks[toks.length - 1].v === ')') toks = toks.slice(1, -1);
    let value = null;
    const num = t => (t && t.t === 'num' && /^(\d+(\.\d+)?|0[xX][0-9a-fA-F]+)$/.test(t.v) ? Number(t.v) : null);
    if (toks.length === 1 && num(toks[0]) !== null) value = numBlock(num(toks[0]));
    else if (toks.length === 2 && toks[0].v === '-' && num(toks[1]) !== null) value = numBlock(-num(toks[1]));
    else if (toks.length === 1 && COLOR_NAMES.has(toks[0].v)) value = colorBlock(toks[0].v);
    if (!value || Math.abs(value.fields ? Number(value.fields.NUM ?? 0) : 0) > 2147483647) return null;
    const json = { type: 'bk_define', fields: { NAME: n.v }, inputs: { VALUE: { shadow: value.type === 'math_number' ? value : numBlock(0), ...(value.type === 'math_number' ? {} : { block: value }) } } };
    this.anchors.push({ line: hash.line, target: json });
    return { json, end: b };
  }

  // A global C array that can be a list: one dimension, a number/true-false/color item type,
  // a constant size, and starting items (if any) that fit
  listDecl(d) {
    const t = d.type;
    if (!t || t.k !== 'arr' || d.ctorArgs) return null;
    const item = varTypeOf(t.of);
    if (!item || item === 'Timer' || item === 'char' || !ALL_LIST_TYPES.includes(item + '[]')) return null;
    const init = d.init ? stripParens(d.init) : null;
    if (init && init.kind !== 'InitList') return null;
    let size = null;
    if (t.nExpr) {
      size = constInt(t.nExpr);
      if (size == null) return null;
    }
    const given = init ? init.items.length : 0;
    if (size == null) size = given;
    if (size < 1 || size > LIST_MAX || given > size) return null;
    return { type: item + '[]', size, items: init ? init.items : null };
  }

  listSetup(v, list, d, decl) {
    const kind = listKind(v.type);
    let json;
    if (!list.items) {
      json = { type: 'bk_list_decl', fields: { LIST: { id: v.id }, COUNT: list.size } };
    } else {
      json = { type: 'bk_list_init', extraState: { items: list.size, kind }, fields: { LIST: { id: v.id } }, inputs: {} };
      const ctx = { scopes: [], fn: { name: null } };
      for (let i = 0; i < list.size; i++) {
        if (i >= list.items.length) { json.inputs['ITEM' + i] = itemInput(kind); continue; }
        const slot = this.slot(list.items[i], KIND_CHECK[kind], ctx, null);
        json.inputs['ITEM' + i] = itemInput(kind, slot.block || slot.shadow);
      }
    }
    this.anchors.push({ line: this.realLine(d.line || decl.line), target: json });
    return json;
  }

  // `list[i]` where list is a list variable: { v, index }
  listItem(e, ctx) {
    e = stripParens(e);
    if (!e || e.kind !== 'Index') return null;
    const obj = stripParens(e.obj);
    const entry = obj.kind === 'Ident' ? this.lookup(obj.name, ctx) : null;
    return entry && entry.kind === 'var' && isList(entry.v.type) ? { v: entry.v, index: e.index } : null;
  }
  mark() { return [this.anchors.length, this.rawRanges.length, this.rawCount]; }
  rollback(m) { this.anchors.length = m[0]; this.rawRanges.length = m[1]; this.rawCount = m[2]; }

  // ---- program ----
  run() {
    for (let i = 0; i < this.orig.length; i++) {
      const t = this.orig[i];
      if (t.t === 'op' && t.v === '#' && t.bol) {
        const nx = this.orig[i + 1];
        if (nx && CONDITIONAL_DIRECTIVES.has(nx.v)) {
          this.notes.add('This sketch uses #if/#ifdef, so it is kept as one C code block.');
          throw new Unsupported('conditional directives');
        }
      }
    }
    const items = this.ast.items;
    const eof = this.toks.length - 1;
    const ends = items.map((it, i) => (i + 1 < items.length ? items[i + 1].line : eof) - 1);

    // Pass 1: functions that can be blocks, and typed globals
    const funcs = new Map();
    for (const it of items) if (it.kind === 'FuncDef' && it.body) funcs.set(it.name, it);
    for (const [name, fn] of funcs) {
      if (name === 'setup' || name === 'loop' || fn.cls || fn.isCtor) continue;
      const ret = fn.type.ret.k === 'void' ? 'void' : varTypeOf(fn.type.ret);
      if (!ret || ret === 'Timer' || fn.type.variadic) continue;
      // Number parameters use the variable type the function editor gives new parameters (''); their
      // C type is kept on the function block, so call blocks don't make look-alike variables
      const params = fn.params.map(p => {
        const ctype = varTypeOf(p.type);
        return { name: p.name, ctype, type: ctype && kindOf(ctype) === 'num' ? '' : ctype, def: p.def };
      });
      if (params.some(p => !p.name || p.type == null || p.type === 'Timer' || p.def)) continue;
      this.procs.set(name, { ret, params, node: fn });
    }
    const pieces = [];   // top-level parts in source order: { lo, hi (tokens), a, b (offsets), raw | fn | skip }
    const globalInits = [];
    const hasWord = (i, word) => { for (let k = items[i].line; k <= ends[i]; k++) if (this.toks[k].v === word && this.toks[k].t === 'id') return true; return false; };
    items.forEach((it, i) => {
      const rawPiece = () => pieces.push({ lo: it.line, hi: ends[i], raw: true });
      if (it.kind === 'TypeDecl' && it.type && it.type.k === 'enum' && it.type.def && !it.type.def.scoped && !hasWord(i, 'typedef')
          && it.type.def.items.length && it.type.def.items.length <= 32 && it.type.def.items.every(x => !x.value)) {
        const names = it.type.def.items.map(x => x.name);
        const json = { type: 'bk_enum', extraState: { items: names.length }, fields: { NAME: it.type.def.tag || '' } };
        names.forEach((n, k) => { json.fields['ITEM' + k] = n; });
        this.anchors.push({ line: this.realLine(it.line), target: json });
        pieces.push({ lo: it.line, hi: ends[i], blocks: [json] });
        return;
      }
      if (it.kind === 'VarDecl' && hasWord(i, 'enum')) return rawPiece();
      if (it.kind === 'VarDecl') {
        const lists = it.decls.map(d => this.listDecl(d));
        const types = it.decls.map((d, k) => (lists[k] ? lists[k].type : varTypeOf(d.type)));
        const ok = !it.isConst && !it.isExtern && it.decls.every((d, k) => types[k] && !d.ctorArgs
          && (lists[k] || !(d.init && d.init.kind === 'InitList'))
          && !this.globals.has(d.name) && !this.procs.has(d.name) && !funcs.has(d.name) && this.canName(d.name, types[k])
          && !(types[k] === 'Timer' && d.init));
        if (!ok) return rawPiece();
        const blocks = [];
        it.decls.forEach((d, k) => {
          const v = this.newVar(d.name, types[k]);
          this.globals.set(d.name, v);
          if (lists[k]) blocks.push(this.listSetup(v, lists[k], d, it));
          else if (d.init) globalInits.push({ v, d });
        });
        pieces.push(blocks.length ? { lo: it.line, hi: ends[i], blocks } : { lo: it.line, hi: ends[i], skip: true });
        return;
      }
      if (it.kind === 'FuncDef' && !it.body) {
        // prototypes aren't needed by blocks; keep only ones for functions that stay C
        if (this.procs.has(it.name) && !it.params.some(p => p.def)) pieces.push({ lo: it.line, hi: ends[i], skip: true });
        else rawPiece();
        return;
      }
      if (it.kind === 'FuncDef' && (it.name === 'setup' || it.name === 'loop') && !it.cls) {
        pieces.push({ lo: it.line, hi: ends[i], fn: it });
        return;
      }
      if (it.kind === 'FuncDef' && this.procs.has(it.name) && this.procs.get(it.name).node === it) {
        pieces.push({ lo: it.line, hi: ends[i], fn: it });
        return;
      }
      rawPiece();
    });

    // Locals that can become globals: one function, one type, no clash with anything else
    this.localGlobals = this.planLocals(funcs);
    for (const p of this.procs.values()) {
      p.vars = p.params.map(q => this.findVar(q.name, q.type) || (this.canName(q.name, q.type) ? this.newVar(q.name, q.type) : null));
      if (p.vars.some(v => !v)) { this.procs.delete(p.node.name); }
    }
    for (const piece of pieces) if (piece.fn && piece.fn.name !== 'setup' && piece.fn.name !== 'loop' && !this.procs.has(piece.fn.name)) { delete piece.fn; piece.raw = true; }

    // Starting values of globals go first in "when Blink starts"
    for (const { v, d } of globalInits) {
      const zero = (n => n && ((n.kind === 'Num' && n.value === 0) || (n.kind === 'Bool' && !n.value)))(stripParens(d.init));
      if (zero && v.type !== 'Color') continue;
      const kind = kindOf(v.type);
      const json = { type: SETTER[kind], fields: { VAR: { id: v.id } }, inputs: {} };
      this.anchors.push({ line: this.realLine(d.line), target: json });
      json.inputs.VALUE = this.slot(d.init, KIND_CHECK[kind], { scopes: [], fn: { name: null } }, SET_DEFAULT[kind]);
      this.prologue.push(json);
    }
    if (this.prologue.length) this.notes.add(`Starting values of global variables moved into "when Blink starts" (${this.prologue.length}).`);

    // Pass 2: convert functions
    const tops = [];
    let setupHat = null, loopHat = null;
    // setup goes last: static locals elsewhere add starting values to it
    const order = pieces.filter(p => p.fn).sort((x, y) => (x.fn.name === 'setup') - (y.fn.name === 'setup'));
    for (const piece of order) {
      const fn = piece.fn;
      const m = this.mark();
      try {
        if (fn.name === 'setup') { setupHat = this.convertSetup(fn); piece.blocks = [setupHat]; }
        else if (fn.name === 'loop') { const r = this.convertLoop(fn); loopHat = r.forever; piece.blocks = r.events; piece.forever = r.forever; }
        else piece.blocks = [this.convertProc(fn)];
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        this.rollback(m);
        piece.raw = true;
        delete piece.fn;
        if (fn.name === 'setup') setupHat = null;
      }
    }
    if (!setupHat && this.prologue.length) {
      setupHat = { type: 'bk_setup' };
      setupHat.next = chain(this.prologue) ? { block: chain(this.prologue) } : undefined;
      pieces.push({ lo: -1, blocks: [setupHat], first: true });
    }

    // Source spans of the top-level pieces kept as C (with a comment at the end of their last line)
    for (const p of pieces) {
      if (p.lo < 0) continue;
      p.a = this.off(p.lo);
      if (!p.raw) continue;
      if (this.toks[p.lo].hide && this.runStart(p.lo) !== p.lo) throw new Unsupported('top-level macro');
      if (this.toks[p.hi].hide && this.runEnd(p.hi) !== p.hi) throw new Unsupported('top-level macro');
      p.b = this.tokEnd(p.hi);
      const c = this.comments.find(c => c.start >= p.b && c.line === this.lineOf(p.b) && /^[ \t]*$/.test(this.src.slice(p.b, c.start)) && !this.src.slice(c.start, c.end).includes('\n'));
      if (c) p.b = c.end;
    }

    // Directive lines (#define, #include) outside those spans are kept as C at the top
    const rawSpans = pieces.filter(p => p.raw).map(p => [p.a, p.b]).concat(this.rawRanges);
    for (const t of this.orig) {
      if (!(t.t === 'op' && t.v === '#' && t.bol)) continue;
      const a = this.offAt(t.line, t.col);
      if (rawSpans.some(([x, y]) => a >= x && a < y)) continue;
      let b = a;
      while (b < this.src.length && !(this.src[b] === '\n' && this.src[b - 1] !== '\\')) b++;
      const def = this.defineBlock(t, a, b);
      if (def) { pieces.push({ a, b: def.end, blocks: [def.json] }); continue; }
      pieces.push({ a, b, directive: true, raw: true });
    }

    // Order pieces by position and merge neighboring raw ones into one C code block
    pieces.sort((x, y) => (x.first ? -1 : y.first ? 1 : x.a - y.a));
    let run = null;
    const flush = () => {
      if (!run) return;
      const a = run[0].a, b = run[run.length - 1].b;
      this.rawRanges.push([a, b]);
      const text = this.src.slice(a, b).split('\n').map(l => l.trimEnd()).join('\n');
      const json = { type: 'bk_c_top', fields: { CODE: text } };
      this.anchors.push({ line: this.lineOf(a), target: json });
      tops.push(json);
      this.rawCount++;
      run = null;
    };
    for (const p of pieces) {
      if (p.raw) {
        // only pieces with nothing but space and comments between them share a block
        const prev = run && run[run.length - 1];
        if (prev && this.orig.some(t => t.t !== 'eof' && (o => o >= prev.b && o < p.a)(this.offAt(t.line, t.col)))) flush();
        (run = run || []).push(p);
      } else {
        flush();
        if (p.blocks) tops.push(...p.blocks);
        if (p.forever) tops.push(p.forever);
      }
    }
    flush();

    if (!setupHat && !loopHat && !tops.some(b => b.type !== 'bk_c_top')) {
      tops.push({ type: 'bk_setup' }, { type: 'bk_loop' });
    }
    this.attachComments(tops);
    // loop() with only events needs no empty "forever"
    if (loopHat && !loopHat.next && !loopHat.icons && tops.some(b => b.type === 'bk_when_button' || b.type === 'bk_when_timer')) {
      tops.splice(tops.indexOf(loopHat), 1);
    }
    return this.finish(tops);
  }

  finish(tops) {
    tops.forEach((b, i) => { b.x = 0; b.y = i * 100; });
    const notes = [...this.notes];
    if (this.rawCount) notes.unshift(`${this.rawCount} part${this.rawCount === 1 ? '' : 's'} of the code ha${this.rawCount === 1 ? 's' : 've'} no block and ${this.rawCount === 1 ? 'is' : 'are'} shown as C code.`);
    const used = new Set();
    const walk = o => { if (o && typeof o === 'object') { if (o.id && typeof o.id === 'string' && o.id.startsWith('bkv')) used.add(o.id); Object.values(o).forEach(walk); } };
    walk(tops);
    const variables = this.vars.filter(v => v.type !== 'face' || used.has(v.id)).map(v => ({ name: v.name, id: v.id, type: v.type }));
    const workspaceComments = this.notesOnWorkspace.map((text, i) => ({
      text, x: 0, y: -400 + i * 100, width: 360, height: Math.min(260, 40 + 18 * text.split('\n').length),
    }));
    return {
      ok: true, lossy: this.rawCount > 0, notes,
      state: { ...(workspaceComments.length ? { workspaceComments } : {}), blocks: { languageVersion: 0, blocks: tops }, variables },
    };
  }

  wholeProgramAsC() {
    let text = this.src;
    const c = this.comments[0];
    if (c && c.text === HEADER && !this.src.slice(0, c.start).trim()) text = this.src.slice(c.end);
    text = text.split('\n').map(l => l.trimEnd()).join('\n').replace(/^\n+|\n+$/g, '');
    const notes = [...this.notes];
    if (!notes.length) notes.push('This sketch could not be turned into blocks, so it is kept as one C code block.');
    return {
      ok: true, lossy: true, notes,
      state: { blocks: { languageVersion: 0, blocks: [{ type: 'bk_c_top', x: 0, y: 0, fields: { CODE: text } }] }, variables: [] },
    };
  }

  attachComments(tops) {
    const firstTok = this.toks.length > 1 ? this.off(0) : this.src.length;
    let list = this.comments.filter(c => !this.rawRanges.some(([a, b]) => c.start >= a && c.start < b));
    list = list.filter((c, i) => !(i === 0 && c.text === HEADER && c.end <= firstTok));
    // Comment paragraphs at the top of the file, set apart by a blank line, become workspace notes
    const lead = list.filter(c => c.end <= firstTok);
    const blankAfter = (c, next) => /\n[ \t]*\n/.test(this.src.slice(c.end, next));
    let para = [];
    for (let i = 0; i < lead.length; i++) {
      para.push(lead[i]);
      const next = i + 1 < lead.length ? lead[i + 1].start : firstTok;
      if (blankAfter(lead[i], next) || (i + 1 === lead.length && this.toks.length <= 1)) {
        this.notesOnWorkspace.push(para.map(c => c.text).join('\n'));
        para.forEach(c => { c.done = true; });
        para = [];
      }
    }
    list = list.filter(c => !c.done);
    if (!list.length) return;
    if (!this.anchors.length) {
      let hat = tops.find(b => b.type === 'bk_setup');
      if (!hat) { hat = { type: 'bk_setup' }; tops.unshift(hat); }
      this.anchors.push({ line: 1, target: hat });
    }
    const add = (target, text) => {
      const prev = target.icons && target.icons.comment ? target.icons.comment.text + '\n' : '';
      target.icons = { comment: { text: prev + text, pinned: false, height: 80, width: 220 } };
    };
    for (const c of list) {
      let best = null;
      if (!c.bol) best = this.anchors.find(a => a.line === c.line);
      if (!best) {
        const line = c.bol ? c.endLine : c.line + 1;
        for (const a of this.anchors) if (a.line >= line && (!best || a.line < best.line)) best = a;
      }
      if (!best) for (const a of this.anchors) if (!best || a.line >= best.line) best = a;
      add(best.target, c.text);
    }
  }

  // Locals declared in one function, always with the same supported type, become global variables
  planLocals(funcs) {
    const seen = new Map();
    const bad = new Set();
    const walk = (n, fn) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(x => walk(x, fn)); return; }
      if (n.kind === 'VarDecl') {
        for (const d of n.decls) {
          const type = varTypeOf(d.type);
          const prev = seen.get(d.name);
          if (!type || type === 'Timer' || d.ctorArgs || (d.init && d.init.kind === 'InitList') || n.isConst || (prev && (prev.fn !== fn || prev.type !== type))) bad.add(d.name);
          else seen.set(d.name, { fn, type, isStatic: n.isStatic });
        }
      }
      if (n.kind === 'For' && n.init && n.init.kind === 'VarDecl') { n.init.decls.forEach(d => bad.add(d.name)); }
      for (const k of Object.keys(n)) if (k !== 'type' && n[k] && typeof n[k] === 'object') walk(n[k], fn);
    };
    const calls = (n, name) => JSON.stringify(n, (k, v) => (k === 'type' ? undefined : v)).includes(`"kind":"Ident","name":"${name}"`);
    for (const [name, fn] of funcs) walk(fn.body, name);
    const out = new Map();
    for (const [name, info] of seen) {
      if (bad.has(name) || this.globals.has(name) || this.procs.has(name) || funcs.has(name)) continue;
      if ([...this.procs.values()].some(p => p.params.some(q => q.name === name))) continue;
      if (calls(funcs.get(info.fn).body, info.fn)) continue; // recursion needs real locals
      if (!this.canName(name, info.type) || this.findVar(name, info.type)) continue;
      out.set(name, info);
    }
    return out;
  }

  localVar(name) {
    const info = this.localGlobals.get(name);
    if (!info) return null;
    if (!info.v) {
      info.v = this.newVar(name, info.type);
      this.notes.add('Local variables became global variables so blocks can use them.');
    }
    return info.v;
  }

  // ---- functions ----
  ctxFor(fn, kind, ret, params = []) {
    const scope = new Map();
    for (const v of params) scope.set(v.name, { kind: 'var', v });
    return { scopes: [scope], fn: { kind, ret, name: fn.name } };
  }

  convertSetup(fn) {
    const hat = this.anchor(fn, { type: 'bk_setup' });
    const ctx = this.ctxFor(fn, 'void');
    const blocks = this.convertGroups(this.groups(fn.body.body, fn.body.endLine), ctx);
    this.anchors.push({ line: this.realLine(fn.body.endLine), target: hat });
    const first = chain([...this.prologue, ...blocks]);
    if (first) hat.next = { block: first };
    return hat;
  }

  convertLoop(fn) {
    const ctx = this.ctxFor(fn, 'void');
    const groups = this.groups(fn.body.body, fn.body.endLine);
    const blocks = [];
    const seen = new Set();
    let k = 0;
    for (; k < groups.length; k++) {
      const g = groups[k];
      const s = g.nodes[0];
      if (g.nodes.length !== 1 || s.kind !== 'If' || s.else) break;
      const ev = this.eventOf(s.cond, ctx);
      if (!ev || seen.has(ev.key)) break;
      seen.add(ev.key);
      const hat = this.anchor(s, ev.json);
      const inner = this.body(s.then, g.end, ctx, hat);
      if (inner) hat.next = { block: inner };
      blocks.push(hat);
    }
    const forever = this.anchor(fn, { type: 'bk_loop' });
    const first = chain(this.convertGroups(groups.slice(k), ctx));
    this.anchors.push({ line: this.realLine(fn.body.endLine), target: forever });
    if (first) forever.next = { block: first };
    return { events: blocks, forever };
  }

  eventOf(cond, ctx) {
    const e = stripParens(cond);
    if (e.kind !== 'Call' || e.args.length) return null;
    if (e.callee.kind === 'Ident' && BUTTON_EVENTS.some(b => b[1] === e.callee.name) && !this.lookup(e.callee.name, ctx)) {
      return { key: e.callee.name, json: { type: 'bk_when_button', fields: { EVENT: e.callee.name } } };
    }
    const t = this.timerOf(e.callee, 'isExpired', ctx);
    if (t && this.globals.get(t.name) === t) return { key: 'timer:' + t.name, json: { type: 'bk_when_timer', fields: { TIMER: { id: t.id } } } };
    return null;
  }

  convertProc(fn) {
    const p = this.procs.get(fn.name);
    const isValue = p.ret !== 'void';
    const json = this.anchor(fn, {
      type: isValue ? 'procedures_defreturn' : 'procedures_defnoreturn',
      fields: { NAME: fn.name },
      extraState: p.vars.length ? { params: p.vars.map(v => ({ name: v.name, id: v.id })) } : undefined,
      inputs: {},
    });
    if (!json.extraState) delete json.extraState;
    const info = {};
    if (isValue && p.ret !== 'int') info.ret = p.ret;
    const typed = p.params.filter(q => q.type === '' && q.ctype !== 'int');
    if (typed.length) info.params = Object.fromEntries(typed.map(q => [q.name, q.ctype]));
    if (Object.keys(info).length) json.data = JSON.stringify(info);
    const ctx = this.ctxFor(fn, isValue ? 'value' : 'void', p.ret, p.vars);
    let list = fn.body.body;
    let ret = null;
    if (isValue) {
      const real = list.filter(s => s.kind !== 'Empty');
      const last = real[real.length - 1];
      if (last && last.kind === 'Return' && last.arg) { ret = last; list = list.slice(0, list.indexOf(last)); }
    }
    const end = ret ? ret.line : fn.body.endLine;
    const blocks = this.convertGroups(this.groups(list, end), ctx);
    if (!ret) this.anchors.push({ line: this.realLine(fn.body.endLine), target: json });
    const first = chain(blocks);
    if (first) json.inputs.STACK = { block: first };
    if (ret) {
      const slot = this.slot(ret.arg, null, ctx);
      json.inputs.RETURN = slot;
      this.anchors.push({ line: this.realLine(ret.line), target: slot.block || slot.shadow });
    }
    if (!Object.keys(json.inputs).length) delete json.inputs;
    return json;
  }

  // ---- statements ----

  // Split a statement list into groups; statements sharing a source line stay together as C
  groups(list, containerEnd) {
    const out = [];
    list.forEach((s, i) => {
      const end = (i + 1 < list.length ? list[i + 1].line : containerEnd) - 1;
      if (s.kind === 'Empty') return;
      const g = out[out.length - 1];
      if (g && this.realLine(g.end) === this.realLine(s.line)) { g.nodes.push(s); g.end = end; return; }
      out.push({ nodes: [s], start: s.line, end });
    });
    return out;
  }

  convertGroups(groups, ctx) {
    const out = [];
    for (const g of groups) {
      if (g.nodes.length === 1) out.push(...this.stmtOrRaw(g.nodes[0], g.start, g.end, ctx));
      else out.push(this.rawStmt(g.start, g.end, g.nodes, ctx));
    }
    return out;
  }

  stmtOrRaw(node, start, end, ctx) {
    const m = this.mark();
    try {
      return this.stmt(node, end, ctx);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      this.rollback(m);
      return [this.rawStmt(start, end, [node], ctx)];
    }
  }

  rawStmt(start, end, nodes, ctx) {
    const json = { type: 'bk_c_stmt', fields: { CODE: this.slice(start, end, { stmt: true }) } };
    this.anchors.push({ line: this.realLine(start), target: json });
    this.rawCount++;
    // A declaration kept as C hides any global of the same name for the rest of the block
    for (const n of nodes) if (n.kind === 'VarDecl') for (const d of n.decls) ctx.scopes[ctx.scopes.length - 1].set(d.name, { kind: 'raw' });
    return json;
  }

  // A statement used as a body: a { block } or a single statement. Comments just before its
  // closing brace belong to the block that owns it.
  body(stmt, end, ctx, owner) {
    ctx.scopes.push(new Map());
    try {
      if (stmt.kind !== 'Block') return chain(this.convertGroups(this.groups([stmt], end + 1), ctx));
      const b = chain(this.convertGroups(this.groups(stmt.body, stmt.endLine), ctx));
      if (owner) this.anchors.push({ line: this.realLine(stmt.endLine), target: owner });
      return b;
    } finally {
      ctx.scopes.pop();
    }
  }

  stmt(node, end, ctx) {
    switch (node.kind) {
      case 'ExprStmt': return [this.exprStmt(node, ctx)];
      case 'If': return [this.ifStmt(node, end, ctx)];
      case 'While': {
        const json = this.anchor(node, { type: 'controls_whileUntil', fields: { MODE: 'WHILE' }, inputs: {} });
        json.inputs.BOOL = this.slot(node.cond, B, ctx);
        const b = this.body(node.body, end, ctx, json);
        if (b) json.inputs.DO = { block: b };
        return [json];
      }
      case 'For': return [this.forStmt(node, end, ctx)];
      case 'DoWhile': {
        if (node.body.kind !== 'Block') throw new Unsupported('do');
        return [this.wrap(node, this.slice(node.line, node.body.line - 1, { expr: true }), node.body, this.slice(node.body.endLine + 1, end, { expr: true }), ctx)];
      }
      case 'Switch': {
        if (node.body.kind !== 'Block') throw new Unsupported('switch');
        const m = this.mark();
        try {
          return [this.switchStmt(node, ctx)];
        } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          this.rollback(m);
        }
        return [this.wrap(node, this.slice(node.line, node.body.line - 1, { expr: true }), node.body, '', ctx)];
      }
      case 'Block': return [this.wrap(node, '', node, '', ctx)];
      case 'Break': case 'Continue':
        return [this.anchor(node, { type: 'bk_flow', fields: { FLOW: node.kind === 'Break' ? 'BREAK' : 'CONTINUE' } })];
      case 'Return': {
        if (!node.arg) return [this.anchor(node, { type: 'bk_return' })];
        if (ctx.fn.kind !== 'value') throw new Unsupported('return value');
        const json = this.anchor(node, { type: 'bk_return_value', inputs: {} });
        json.inputs.VALUE = this.slot(node.arg, null, ctx);
        return [json];
      }
      case 'VarDecl': return this.localDecl(node, ctx);
      case 'Empty': return [];
      default: throw new Unsupported(node.kind);
    }
  }

  // A switch block: every case ends with break (or leaves with return/continue), except maybe the
  // last; labels stacked on one body become "or"; default goes last
  switchStmt(node, ctx) {
    const list = node.body.body.filter(x => x.kind !== 'Empty');
    const groups = [];
    for (const x of list) {
      if (x.kind === 'Case' || x.kind === 'Default') {
        const g = groups[groups.length - 1];
        if (g && !g.stmts.length) g.labels.push(x); else groups.push({ labels: [x], stmts: [] });
      } else {
        if (!groups.length) throw new Unsupported('code before the first case');
        groups[groups.length - 1].stmts.push(x);
      }
    }
    if (!groups.length) throw new Unsupported('empty switch');
    groups.forEach((g, i) => {
      const last = g.stmts[g.stmts.length - 1];
      g.end = i + 1 < groups.length ? groups[i + 1].labels[0].line : node.body.endLine;
      if (last && last.kind === 'Break') { g.end = last.line; g.stmts.pop(); }
      else if (i + 1 < groups.length && !(last && (last.kind === 'Return' || last.kind === 'Continue'))) throw new Unsupported('falls through');
      if (g.labels.some(l => l.kind === 'Default') && g.labels.length > 1) throw new Unsupported('default shares a case');
    });
    if (groups.filter(g => g.labels[0].kind === 'Default').length > 1) throw new Unsupported('two defaults');
    const json = this.anchor(node, { type: 'bk_switch', inputs: {} });
    json.inputs.SWITCH = this.slot(node.disc, N, ctx, 0);
    const bodyOf = g => {
      ctx.scopes.push(new Map());
      try { return chain(this.convertGroups(this.groups(g.stmts, g.end), ctx)); } finally { ctx.scopes.pop(); }
    };
    let n = 0;
    for (const g of groups) {
      const b = bodyOf(g);
      if (g.labels[0].kind === 'Default') { if (b) json.inputs.DEFAULT = { block: b }; continue; }
      const values = g.labels.map(l => this.slot(l.test, N, ctx, 0));
      let value = values[values.length - 1];
      for (let k = values.length - 2; k >= 0; k--) value = { block: { type: 'bk_case_or', inputs: { A: values[k], B: value } } };
      json.inputs['CASE' + n] = value;
      if (b) json.inputs['DO' + n] = { block: b };
      n++;
    }
    if (!n) throw new Unsupported('only default');
    json.extraState = { cases: n };
    return json;
  }

  wrap(node, head, block, tail, ctx) {
    const json = this.anchor(node, { type: 'bk_c_wrap', fields: { HEAD: head, TAIL: tail }, inputs: {} });
    this.rawCount++;
    const b = this.body(block, block.endLine, ctx, json);
    if (b) json.inputs.DO = { block: b };
    else delete json.inputs;
    return json;
  }

  // A local: a local block for each variable (a static one keeps its value between runs, so it
  // becomes a global whose starting value is set when the Blink starts)
  localDecl(node, ctx) {
    if (!node.isStatic) {
      if (node.isConst) throw new Unsupported('const local');
      const out = [];
      for (const d of node.decls) {
        const type = varTypeOf(d.type);
        if (!type || type === 'Timer' || d.ctorArgs || (d.init && d.init.kind === 'InitList') || this.procs.has(d.name)) throw new Unsupported('local');
        const lt = localType(type);
        const v = this.findVar(d.name, lt) || (this.canName(d.name, lt) ? this.newVar(d.name, lt) : null);
        if (!v) throw new Unsupported('local name');
        const kind = kindOf(v.type);
        const json = this.anchor(d.line != null ? d : node, { type: SETTER[kind], fields: { VAR: { id: v.id } }, inputs: {} });
        // a local with no starting value starts at 0, false or OFF
        json.inputs.VALUE = d.init ? this.slot(d.init, KIND_CHECK[kind], ctx, SET_DEFAULT[kind])
          : { shadow: kind === 'bool' ? { type: 'bk_bool', fields: { BOOL: 'FALSE' } } : kind === 'color' ? colorBlock('OFF') : numBlock(0) };
        ctx.scopes[ctx.scopes.length - 1].set(d.name, { kind: 'var', v });
        out.push(json);
      }
      return out;
    }
    const vs = node.decls.map(d => this.localGlobals.get(d.name) ? this.localVar(d.name) : null);
    if (vs.some(v => !v)) throw new Unsupported('local');
    const out = [];
    node.decls.forEach((d, i) => {
      const v = vs[i];
      ctx.scopes[ctx.scopes.length - 1].set(d.name, { kind: 'var', v });
      if (!d.init) return;
      const kind = kindOf(v.type);
      const json = { type: SETTER[kind], fields: { VAR: { id: v.id } }, inputs: {} };
      this.anchors.push({ line: this.realLine(d.line || node.line), target: json });
      json.inputs.VALUE = this.slot(d.init, KIND_CHECK[kind], ctx, SET_DEFAULT[kind]);
      if (node.isStatic) this.prologue.push(json); else out.push(json);
    });
    return out;
  }

  ifStmt(node, end, ctx) {
    const json = this.anchor(node, { type: 'controls_if', inputs: {} });
    let cur = node, n = 0;
    for (;;) {
      json.inputs['IF' + n] = this.slot(cur.cond, B, ctx);
      const thenEnd = cur.else ? cur.else.line - 2 : end;
      const b = this.body(cur.then, thenEnd, ctx, json);
      if (b) json.inputs['DO' + n] = { block: b };
      if (cur.else && cur.else.kind === 'If') { cur = cur.else; n++; continue; }
      if (cur.else) {
        const e = this.body(cur.else, end, ctx, json);
        if (e) json.inputs.ELSE = { block: e };
      }
      break;
    }
    if (n || cur.else) json.extraState = { ...(n ? { elseIfCount: n } : {}), ...(cur.else ? { hasElse: true } : {}) };
    return json;
  }

  forStmt(node, end, ctx) {
    const init = node.init && node.init.kind === 'VarDecl' && node.init.decls.length === 1 ? node.init.decls[0] : null;
    const cond = stripParens(node.cond);
    const name = init && init.name;
    const isVar = e => { e = stripParens(e); return e && e.kind === 'Ident' && e.name === name; };
    const stepsByOne = s => s && (((s.kind === 'Unary' || s.kind === 'Postfix') && s.op === '++' && isVar(s.arg))
      || (s.kind === 'Assign' && s.op === '+=' && isVar(s.target) && stripParens(s.value).kind === 'Num' && stripParens(s.value).value === 1));
    const startsAtZero = init && init.init && (n => n.kind === 'Num' && n.value === 0 && !n.isFloat)(stripParens(init.init));
    const shape = startsAtZero && cond && cond.kind === 'Binary' && cond.op === '<' && isVar(cond.l) && stepsByOne(node.step);
    const t = init && varTypeOf(init.type);

    // FOREACH_FACE(f), or the same loop written out with a byte
    const isFaces = shape && t === 'byte' && (this.macroName(node.line) === 'FOREACH_FACE' && this.toks[node.line].hide
      || (n => n.kind === 'Num' && n.value === 6)(stripParens(cond.r)));
    if (isFaces && this.canName(name, 'face')) {
      const v = this.varFor(name, 'face');
      const json = this.anchor(node, { type: 'bk_for_each_face', fields: { VAR: { id: v.id } }, inputs: {} });
      ctx.scopes.push(new Map([[name, { kind: 'face', v }]]));
      try {
        const b = this.body(node.body, end, ctx, json);
        if (b) json.inputs.DO = { block: b }; else delete json.inputs;
      } finally { ctx.scopes.pop(); }
      return json;
    }
    // for (int i = 0; i < n; i++) that doesn't use i: repeat n
    const mentions = n => JSON.stringify(n, (k, v) => (k === 'type' ? undefined : v)).includes(`"kind":"Ident","name":"${name}"`);
    if (shape && t === 'int' && init.type.name === 'int' && !mentions(node.body) && !mentions(cond.r)) {
      const json = this.anchor(node, { type: 'controls_repeat_ext', inputs: {} });
      json.inputs.TIMES = this.slot(cond.r, N, ctx, 10);
      const b = this.body(node.body, end, ctx, json);
      if (b) json.inputs.DO = { block: b };
      return json;
    }
    if (node.body.kind !== 'Block') throw new Unsupported('for');
    const head = this.slice(node.line, node.body.line - 1, { expr: true });
    const scope = new Map();
    if (node.init && node.init.kind === 'VarDecl') for (const d of node.init.decls) scope.set(d.name, { kind: 'raw' });
    ctx.scopes.push(scope);
    try { return this.wrap(node, head, node.body, '', ctx); } finally { ctx.scopes.pop(); }
  }

  exprStmt(node, ctx) {
    const e = node.expr;
    const [lo, hi] = this.exprRange(e);
    if (this.isExactRun(lo, hi) && !COLOR_NAMES.has(this.macroName(lo))) throw new Unsupported('macro statement');
    if (e.kind === 'Call' && e.callee.kind === 'Ident' && !this.lookup(e.callee.name, ctx)) {
      const name = e.callee.name;
      if (BUTTON_FNS.has(name) && name !== 'buttonDown' && !e.args.length) return this.anchor(node, { type: 'bk_button_clear', fields: { EVENT: name } });
      const def = CALL_BY_FN.get(name);
      if (def && !def[5]) return this.callBlock(node, def, e.args, ctx);
      const p = this.procs.get(name);
      if (p && p.ret === 'void' && e.args.length === p.params.length) return this.procCall(node, 'procedures_callnoreturn', p, e.args, ctx);
      throw new Unsupported('call');
    }
    if (e.kind === 'Call' && e.callee.kind === 'Member') {
      for (const [method, type] of [['set', 'bk_timer_set'], ['add', 'bk_timer_add'], ['never', 'bk_timer_never']]) {
        const t = this.timerOf(e.callee, method, ctx);
        if (!t) continue;
        const json = this.anchor(node, { type, fields: { TIMER: { id: t.id } }, inputs: {} });
        if (method === 'never') { if (e.args.length) throw new Unsupported('never'); delete json.inputs; return json; }
        if (e.args.length !== 1) throw new Unsupported('timer');
        json.inputs.MS = this.slot(e.args[0], N, ctx, 1000);
        return json;
      }
      throw new Unsupported('method');
    }
    const li = this.listItem(e.kind === 'Assign' ? e.target : (e.kind === 'Postfix' || e.kind === 'Unary') ? e.arg : null, ctx);
    if (li) return this.listStmt(node, e, li, ctx);
    if ((e.kind === 'Postfix' || e.kind === 'Unary') && (e.op === '++' || e.op === '--')) {
      const v = this.varTarget(e.arg, ctx, 'num');
      const json = this.anchor(node, { type: 'bk_change', fields: { VAR: { id: v.id } }, inputs: { DELTA: { shadow: numBlock(e.op === '++' ? 1 : -1) } } });
      return json;
    }
    if (e.kind === 'Assign') {
      const target = stripParens(e.target);
      const entry = target.kind === 'Ident' ? this.lookup(target.name, ctx) : null;
      if (!entry || entry.kind !== 'var') throw new Unsupported('assign');
      const v = entry.v, kind = kindOf(v.type);
      if (!SETTER[kind]) throw new Unsupported('assign');
      if (e.op === '=') {
        const json = this.anchor(node, { type: SETTER[kind], fields: { VAR: { id: v.id } }, inputs: {} });
        json.inputs.VALUE = this.slot(e.value, KIND_CHECK[kind], ctx, SET_DEFAULT[kind]);
        return json;
      }
      if (kind !== 'num') throw new Unsupported('compound');
      const val = stripParens(e.value);
      if (e.op === '+=' || (e.op === '-=' && val.kind === 'Num' && !val.isFloat && !val.unsigned && !val.long)) {
        const json = this.anchor(node, { type: 'bk_change', fields: { VAR: { id: v.id } }, inputs: {} });
        json.inputs.DELTA = e.op === '+=' ? this.slot(e.value, N, ctx, 1) : { shadow: numBlock(-val.value) };
        return json;
      }
      const shiftOp = { '<<=': 'LEFT', '>>=': 'RIGHT' }[e.op], bitOp = { '&=': 'AND', '|=': 'OR', '^=': 'XOR' }[e.op];
      if (shiftOp || bitOp) {
        const json = this.anchor(node, { type: SETTER.num, fields: { VAR: { id: v.id } }, inputs: {} });
        const self = { block: { type: 'bk_get_num', fields: { VAR: { id: v.id } } } };
        json.inputs.VALUE = { block: shiftOp
          ? { type: 'bk_shift', fields: { DIR: shiftOp }, inputs: { A: self, B: this.slot(e.value, N, ctx, 1) } }
          : { type: 'bk_bitwise', fields: { OP: bitOp }, inputs: { A: self, B: this.slot(e.value, N, ctx, 0) } } };
        return json;
      }
      const op = { '-=': 'SUB', '*=': 'MUL', '/=': 'DIV', '%=': 'MOD' }[e.op];
      if (!op) throw new Unsupported('compound');
      const json = this.anchor(node, { type: SETTER.num, fields: { VAR: { id: v.id } }, inputs: {} });
      json.inputs.VALUE = { block: { type: 'bk_arith', fields: { OP: op }, inputs: { A: { block: { type: 'bk_get_num', fields: { VAR: { id: v.id } } } }, B: this.slot(e.value, N, ctx, 1) } } };
      return json;
    }
    throw new Unsupported(e.kind);
  }

  listStmt(node, e, { v, index }, ctx) {
    const kind = listKind(v.type);
    const at = { LIST: { id: v.id } };
    if ((e.kind === 'Postfix' || e.kind === 'Unary') && (e.op === '++' || e.op === '--')) {
      if (kind !== 'num') throw new Unsupported('list ++');
      return this.anchor(node, { type: 'bk_list_change', fields: at, inputs: { INDEX: this.slot(index, N, ctx, 0), DELTA: { shadow: numBlock(e.op === '++' ? 1 : -1) } } });
    }
    if (e.kind !== 'Assign') throw new Unsupported('list');
    if (e.op === '=') {
      const json = this.anchor(node, { type: 'bk_list_set_' + kind, fields: at, inputs: {} });
      json.inputs.INDEX = this.slot(index, N, ctx, 0);
      json.inputs.VALUE = this.slot(e.value, KIND_CHECK[kind], ctx, kind === 'color' ? 'RED' : kind === 'num' ? 0 : null);
      return json;
    }
    const val = stripParens(e.value);
    if (kind === 'num' && (e.op === '+=' || (e.op === '-=' && val.kind === 'Num' && !val.isFloat && !val.unsigned && !val.long))) {
      const json = this.anchor(node, { type: 'bk_list_change', fields: at, inputs: {} });
      json.inputs.INDEX = this.slot(index, N, ctx, 0);
      json.inputs.DELTA = e.op === '+=' ? this.slot(e.value, N, ctx, 1) : { shadow: numBlock(-val.value) };
      return json;
    }
    throw new Unsupported('list compound');
  }

  varTarget(e, ctx, kind) {
    e = stripParens(e);
    const entry = e.kind === 'Ident' ? this.lookup(e.name, ctx) : null;
    if (!entry || entry.kind !== 'var' || kindOf(entry.v.type) !== kind) throw new Unsupported('target');
    return entry.v;
  }

  // A Timer variable used as `t.method(...)`
  timerOf(callee, method, ctx) {
    if (!callee || callee.kind !== 'Member' || callee.arrow || callee.prop !== method) return null;
    const obj = stripParens(callee.obj);
    if (obj.kind !== 'Ident') return null;
    const entry = this.lookup(obj.name, ctx);
    return entry && entry.kind === 'var' && entry.v.type === 'Timer' ? entry.v : null;
  }

  callBlock(node, def, args, ctx) {
    const [type, , , , specs] = def;
    if (args.length !== specs.length) throw new Unsupported('arity');
    const json = node ? this.anchor(node, { type, inputs: {} }) : { type, inputs: {} };
    specs.forEach(([name, check, d], i) => { json.inputs[name] = this.slot(args[i], check, ctx, d); });
    if (!specs.length) delete json.inputs;
    return json;
  }

  procCall(node, type, p, args, ctx) {
    const json = { type, extraState: { name: p.node.name, params: p.vars.map(v => v.name) }, inputs: {} };
    if (node) this.anchor(node, json);
    args.forEach((a, i) => { json.inputs['ARG' + i] = this.slot(a, null, ctx); });
    if (!args.length) delete json.inputs;
    return json;
  }

  lookup(name, ctx) {
    for (let i = ctx.scopes.length - 1; i >= 0; i--) {
      const e = ctx.scopes[i].get(name);
      if (e) return e;
    }
    const g = this.globals.get(name);
    if (g) return { kind: 'var', v: g };
    const l = this.localGlobals && this.localGlobals.get(name);
    if (l && l.v && ctx.fn && l.fn === ctx.fn.name) return { kind: 'var', v: l.v };
    return null;
  }

  // ---- expressions ----

  // An input holding the expression; anything without a matching block becomes a C expression
  slot(node, check, ctx, shadowDefault) {
    const shadow = shadowFor(check, shadowDefault);
    let res = null;
    const m = this.mark();
    try {
      res = this.expr(node, ctx);
      if (check && res.out && res.out !== check) res = null;
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      res = null;
    }
    if (!res) {
      this.rollback(m);
      const [lo, hi] = this.exprRange(node);
      res = { json: { type: 'bk_c_expr', fields: { CODE: this.slice(lo, hi, { expr: true }) } }, out: null };
      this.rawCount++;
    }
    const j = res.json;
    if ((shadow && j.type === shadow.type && !j.inputs) || j.type === 'math_number') return { shadow: j };
    return shadow ? { shadow, block: j } : { block: j };
  }

  expr(node, ctx) {
    const [lo, hi] = this.exprRange(node);
    if (this.isExactRun(lo, hi)) return this.macroExpr(this.macroName(lo), node, ctx);
    const e = node;
    switch (e.kind) {
      case 'Paren': return this.expr(e.expr, ctx);
      case 'Num': {
        if (/^0[bB]/.test(e.raw) && !e.unsigned && !e.long && e.value <= 255) return { json: { type: 'bk_bits', fields: { BITS: e.value } }, out: N };
        if (e.unsigned || e.long || (e.isFloat && (/[fF]$/.test(e.raw) || Number.isInteger(e.value))) || !Number.isFinite(e.value) || Math.abs(e.value) > 2147483647) throw new Unsupported('number');
        return { json: numBlock(e.value), out: N };
      }
      case 'Bool': return { json: { type: 'bk_bool', fields: { BOOL: e.value ? 'TRUE' : 'FALSE' } }, out: B };
      case 'Index': {
        const li = this.listItem(e, ctx);
        if (!li) throw new Unsupported('index');
        const kind = listKind(li.v.type);
        return { json: { type: 'bk_list_get_' + kind, fields: { LIST: { id: li.v.id } }, inputs: { INDEX: this.slot(li.index, N, ctx, 0) } }, out: KIND_CHECK[kind] };
      }
      case 'Ident': {
        const entry = this.lookup(e.name, ctx);
        if (!entry && this.enumNames.has(e.name)) return { json: { type: 'bk_enum_value', fields: { NAME: e.name } }, out: N };
        if (!entry || entry.kind === 'raw') throw new Unsupported('name');
        if (entry.kind === 'face') return { json: { type: 'bk_face_var', fields: { VAR: { id: entry.v.id } } }, out: N };
        const kind = kindOf(entry.v.type);
        if (!GETTER[kind]) throw new Unsupported('timer value');
        return { json: { type: GETTER[kind], fields: { VAR: { id: entry.v.id } } }, out: KIND_CHECK[kind] };
      }
      case 'Unary': {
        const arg = stripParens(e.arg);
        if (e.op === '-' && e.arg.kind === 'Num' && !arg.isFloat && !arg.unsigned && !arg.long && arg.value <= 2147483647) {
          return { json: numBlock(-arg.value), out: N };
        }
        if (e.op === '~') return { json: { type: 'bk_bitnot', inputs: { A: this.slot(e.arg, N, ctx, 0) } }, out: N };
        if (e.op === '!') {
          if (arg.kind === 'Call' && arg.callee.kind === 'Ident' && arg.callee.name === 'isValueReceivedOnFaceExpired' && arg.args.length === 1 && !this.lookup(arg.callee.name, ctx)) {
            return { json: { type: 'bk_neighbor', inputs: { FACE: this.slot(arg.args[0], N, ctx, 0) } }, out: B };
          }
          return { json: { type: 'bk_not', inputs: { BOOL: this.slot(e.arg, B, ctx) } }, out: B };
        }
        throw new Unsupported('unary');
      }
      case 'Binary': {
        const arith = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '%': 'MOD' }[e.op];
        if (arith) return { json: { type: 'bk_arith', fields: { OP: arith }, inputs: { A: this.slot(e.l, N, ctx, 0), B: this.slot(e.r, N, ctx, 0) } }, out: N };
        if (e.op === '<<' || e.op === '>>') {
          return { json: { type: 'bk_shift', fields: { DIR: e.op === '<<' ? 'LEFT' : 'RIGHT' }, inputs: { A: this.slot(e.l, N, ctx, 0), B: this.slot(e.r, N, ctx, 1) } }, out: N };
        }
        if (e.op === '&') {
          // (x >> lo) & 0b11 or x & 0b11: some bits of x
          const mask = stripParens(e.r), l = stripParens(e.l);
          const width = mask.kind === 'Num' && !mask.isFloat && mask.value > 0 && mask.value < 65536 && ((mask.value + 1) & mask.value) === 0 ? Math.log2(mask.value + 1) : 0;
          const shifted = l.kind === 'Binary' && l.op === '>>' && stripParens(l.r).kind === 'Num' && !stripParens(l.r).isFloat ? stripParens(l.r).value : null;
          const lo = shifted ?? 0;
          if (width && lo >= 0 && lo + width <= 16) {
            return { json: { type: 'bk_get_bits', fields: { LO: lo, HI: lo + width - 1 }, inputs: { A: this.slot(shifted == null ? e.l : l.l, N, ctx, 0) } }, out: N };
          }
        }
        const bit = { '&': 'AND', '|': 'OR', '^': 'XOR' }[e.op];
        if (bit) return { json: { type: 'bk_bitwise', fields: { OP: bit }, inputs: { A: this.slot(e.l, N, ctx, 0), B: this.slot(e.r, N, ctx, 0) } }, out: null };
        const cmp = { '==': 'EQ', '!=': 'NEQ', '<': 'LT', '<=': 'LTE', '>': 'GT', '>=': 'GTE' }[e.op];
        if (cmp) return { json: { type: 'bk_compare', fields: { OP: cmp }, inputs: { A: this.slot(e.l, null, ctx), B: this.slot(e.r, null, ctx) } }, out: B };
        throw new Unsupported('binary');
      }
      case 'Logical':
        return { json: { type: 'bk_and_or', fields: { OP: e.op === '&&' ? 'AND' : 'OR' }, inputs: { A: this.slot(e.l, B, ctx), B: this.slot(e.r, B, ctx) } }, out: B };
      case 'Call': {
        if (e.callee.kind === 'Member') {
          const done = this.timerOf(e.callee, 'isExpired', ctx), left = this.timerOf(e.callee, 'getRemaining', ctx);
          if ((done || left) && !e.args.length) {
            return { json: { type: done ? 'bk_timer_done' : 'bk_timer_left', fields: { TIMER: { id: (done || left).id } } }, out: done ? B : N };
          }
          throw new Unsupported('method');
        }
        if (e.callee.kind !== 'Ident' || this.lookup(e.callee.name, ctx)) throw new Unsupported('call');
        const name = e.callee.name;
        if (BUTTON_FNS.has(name) && !e.args.length) return { json: { type: 'bk_button', fields: { EVENT: name } }, out: B };
        if (name === 'isValueReceivedOnFaceExpired' && e.args.length === 1) {
          return { json: { type: 'bk_not', inputs: { BOOL: { block: { type: 'bk_neighbor', inputs: { FACE: this.slot(e.args[0], N, ctx, 0) } } } } }, out: B };
        }
        if (name === 'makeColorHSB' && e.args.length === 3) {
          const [h, s, b] = e.args.map(stripParens);
          const isNum = (x, v) => x.kind === 'Num' && x.value === v && !x.isFloat && x.raw === String(v);
          if (h.kind === 'Call' && h.callee.kind === 'Ident' && h.callee.name === 'random' && h.args.length === 1 && isNum(stripParens(h.args[0]), 255) && isNum(s, 255) && isNum(b, 255)) {
            return { json: { type: 'bk_random_color' }, out: C };
          }
        }
        if (name === 'makeColorRGB' && e.args.length === 3) {
          const lit = x => (x = stripParens(x), x.kind === 'Num' && !x.isFloat && !x.unsigned && !x.long && x.value <= 255 && x.raw === String(x.value) ? x.value : null);
          const mix = e.args.map(lit);
          if (mix.every(x => x !== null)) return { json: colorBlock(mix.join(',')), out: C };
        }
        const def = CALL_BY_FN.get(name);
        if (def && def[5]) return { json: this.callBlock(null, def, e.args, ctx), out: def[5] };
        const p = this.procs.get(name);
        if (p && p.ret !== 'void' && e.args.length === p.params.length) return { json: this.procCall(null, 'procedures_callreturn', p, e.args, ctx), out: null };
        throw new Unsupported('call');
      }
      default: throw new Unsupported(e.kind);
    }
  }

  // An expression that is exactly one macro use: named colors, FACE_COUNT, min/max/abs/constrain
  macroExpr(name, node, ctx) {
    if (COLOR_NAMES.has(name)) return { json: colorBlock(name), out: C };
    if (name === 'FACE_COUNT') return { json: numBlock(6), out: N };
    if (/^B[01]{1,8}$/.test(name)) return { json: { type: 'bk_bits', fields: { BITS: parseInt(name.slice(1), 2) } }, out: N };
    if (this.userDefines.has(name)) return { json: { type: 'bk_define_value', fields: { NAME: name } }, out: null };
    if (name === 'COUNT_OF') {
      // ((sizeof(x)/sizeof(x[0])))
      const div = stripParens(node);
      const arg = div && div.kind === 'Binary' && div.op === '/' && div.l.kind === 'SizeofExpr' ? stripParens(div.l.arg) : null;
      const entry = arg && arg.kind === 'Ident' ? this.lookup(arg.name, ctx) : null;
      if (entry && entry.kind === 'var' && isList(entry.v.type)) return { json: { type: 'bk_list_length', fields: { LIST: { id: entry.v.id } } }, out: N };
      throw new Unsupported('COUNT_OF');
    }
    const e = stripParens(node);
    const arg = x => stripParens(x);
    if ((name === 'min' || name === 'max') && e.kind === 'Cond' && e.test.kind === 'Binary') {
      return { json: { type: 'bk_minmax', fields: { OP: name }, inputs: { A: this.slot(arg(e.test.l), N, ctx, 0), B: this.slot(arg(e.test.r), N, ctx, 0) } }, out: N };
    }
    if (name === 'abs' && e.kind === 'Cond' && e.test.kind === 'Binary') {
      return { json: { type: 'bk_abs', inputs: { X: this.slot(arg(e.test.l), N, ctx, 0) } }, out: N };
    }
    if (name === 'constrain' && e.kind === 'Cond' && e.test.kind === 'Binary' && e.alt && stripParens(e.alt).kind === 'Cond') {
      const inner = stripParens(e.alt);
      return { json: { type: 'bk_constrain', inputs: { X: this.slot(arg(e.test.l), N, ctx, 0), LOW: this.slot(arg(e.test.r), N, ctx, 0), HIGH: this.slot(arg(inner.test.r), N, ctx, 255) } }, out: N };
    }
    throw new Unsupported('macro');
  }
}

// ---------------------------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------------------------

const STARTER = {
  blocks: {
    languageVersion: 0,
    blocks: [
      { type: 'bk_setup', x: 0, y: 0, next: { block: { type: 'bk_set_color', inputs: { COLOR: { shadow: colorBlock('BLUE') } } } } },
      { type: 'bk_when_button', x: 0, y: 100, fields: { EVENT: 'buttonSingleClicked' },
        next: { block: { type: 'bk_set_color', inputs: { COLOR: { shadow: colorBlock('RED'), block: { type: 'bk_random_color' } } } } } },
    ],
  },
};

function makeTheme(Blockly) {
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = s => Math.round(Math.min(255, Math.max(0, f > 0 ? s + (255 - s) * f : s * (1 + f)))).toString(16).padStart(2, '0');
    return '#' + ch(n >> 16) + ch((n >> 8) & 255) + ch(n & 255);
  };
  const style = (hex, extra) => ({ colourPrimary: hex, colourSecondary: shade(hex, 0.25), colourTertiary: shade(hex, -0.22), ...extra });
  const blockStyles = {};
  const categoryStyles = {};
  for (const [k, hex] of Object.entries(PALETTE)) {
    blockStyles['bk_' + k] = style(hex, k === 'events' ? { hat: 'cap' } : {});
    categoryStyles['bk_' + k] = { colour: hex };
  }
  blockStyles.logic_blocks = style(PALETTE.control);
  blockStyles.loop_blocks = style(PALETTE.control);
  blockStyles.math_blocks = style(PALETTE.math);
  blockStyles.procedure_blocks = style(PALETTE.functions, { hat: 'cap' });
  blockStyles.variable_blocks = style(PALETTE.variables);
  blockStyles.variable_dynamic_blocks = style(PALETTE.variables);
  blockStyles.text_blocks = style(PALETTE.code);
  blockStyles.list_blocks = style(PALETTE.code);
  blockStyles.colour_blocks = style(PALETTE.light);
  blockStyles.hat_blocks = style(PALETTE.events, { hat: 'cap' });
  return Blockly.Theme.defineTheme('blinks-dark', {
    name: 'blinks-dark',
    base: Blockly.Themes.Classic,
    blockStyles,
    categoryStyles,
    componentStyles: {
      workspaceBackgroundColour: '#1d1827',
      toolboxBackgroundColour: '#17131f',
      toolboxForegroundColour: '#eee9f5',
      flyoutBackgroundColour: '#231d30',
      flyoutForegroundColour: '#a69db8',
      flyoutOpacity: 0.97,
      scrollbarColour: '#4a4060',
      scrollbarOpacity: 0.6,
      insertionMarkerColour: '#ffffff',
      insertionMarkerOpacity: 0.25,
      markerColour: '#FA4616',
      cursorColour: '#FA4616',
      selectedGlowColour: '#FA4616',
    },
    fontStyle: { family: UI_FONT, weight: '600', size: 12 },
    startHats: false,
  });
}

function toolbox() {
  const shadowInputs = specs => Object.fromEntries(specs.filter(([, c, d]) => shadowFor(c, d)).map(([n, c, d]) => [n, { shadow: shadowFor(c, d) }]));
  const call = type => ({ kind: 'block', type, ...(CALL_BY_TYPE.get(type)[4].length ? { inputs: shadowInputs(CALL_BY_TYPE.get(type)[4]) } : {}) });
  const block = (type, extra = {}) => ({ kind: 'block', type, ...extra });
  const num = n => ({ shadow: numBlock(n) });
  const bool = { block: { type: 'bk_button', fields: { EVENT: 'buttonSingleClicked' } } };
  const cat = (name, style, contents) => ({ kind: 'category', name, categorystyle: 'bk_' + style, contents: [heading(name), ...contents] });
  return {
    kind: 'categoryToolbox',
    contents: [
      cat('Events', 'events', [
        block('bk_setup'), block('bk_loop'), block('bk_when_button'), block('bk_when_timer'),
      ]),
      cat('Light', 'light', [
        call('bk_set_color'), call('bk_set_face_color'),
        block('bk_color', { fields: { COLOR: 'ORANGE' } }), block('bk_random_color'),
        call('bk_color_rgb'), call('bk_color_hsb'), call('bk_dim'), call('bk_lighten'),
      ]),
      cat('Button', 'button', [
        block('bk_button'), block('bk_button', { fields: { EVENT: 'buttonDown' } }), call('bk_click_count'),
        block('bk_button_clear'),
      ]),
      cat('Neighbors', 'neighbors', [
        call('bk_send_all'), call('bk_send_face'), call('bk_received'),
        block('bk_neighbor', { inputs: { FACE: num(0) } }), call('bk_value_changed'), call('bk_alone'),
        block('bk_for_each_face'), block('bk_face_var'),
      ]),
      cat('Time', 'time', [
        block('bk_timer_set', { inputs: { MS: num(1000) } }), block('bk_timer_done'), block('bk_timer_left'),
        block('bk_timer_add', { inputs: { MS: num(1000) } }), block('bk_timer_never'), call('bk_millis'),
      ]),
      cat('Control', 'control', [
        block('controls_if', { inputs: { IF0: bool } }),
        block('controls_if', { extraState: { hasElse: true } }),
        block('controls_repeat_ext', { inputs: { TIMES: num(6) } }),
        block('controls_whileUntil'),
        block('bk_for_each_face'), block('bk_face_var'),
        block('bk_switch', { extraState: { cases: 2 }, inputs: { SWITCH: num(0), CASE0: num(0), CASE1: num(1) } }),
        block('bk_case_or', { inputs: { A: num(1), B: num(2) } }),
        block('bk_flow'),
      ]),
      cat('Math', 'math', [
        block('math_number', { fields: { NUM: 0 } }),
        block('bk_arith', { fields: { OP: 'ADD' }, inputs: { A: num(1), B: num(1) } }),
        block('bk_arith', { fields: { OP: 'MOD' }, inputs: { A: num(7), B: num(6) } }),
        call('bk_random'), call('bk_randomize'),
        block('bk_minmax', { inputs: { A: num(3), B: num(5) } }),
        call('bk_abs'), call('bk_constrain'), call('bk_map'), call('bk_sin8'),
      ]),
      cat('Bits', 'bits', [
        block('bk_shift', { fields: { DIR: 'LEFT' }, inputs: { A: num(1), B: num(3) } }),
        block('bk_shift', { fields: { DIR: 'RIGHT' }, inputs: { A: num(48), B: num(4) } }),
        block('bk_get_bits', { fields: { LO: 4, HI: 5 }, inputs: { A: num(48) } }),
        block('bk_bitwise', { fields: { OP: 'AND' }, inputs: { A: num(12), B: num(4) } }),
        block('bk_bitwise', { fields: { OP: 'OR' }, inputs: { A: num(12), B: num(1) } }),
        block('bk_bitnot', { inputs: { A: num(0) } }),
        block('bk_bits', { fields: { BITS: 37 } }),
      ]),
      cat('Logic', 'logic', [
        block('bk_compare', { fields: { OP: 'EQ' }, inputs: { A: num(0), B: num(0) } }),
        block('bk_compare', { fields: { OP: 'LT' }, inputs: { A: num(0), B: num(10) } }),
        block('bk_and_or'), block('bk_not'), block('bk_bool'),
      ]),
      { kind: 'category', name: 'Variables', categorystyle: 'bk_variables', custom: 'BK_VARIABLES' },
      { kind: 'category', name: 'Lists', categorystyle: 'bk_lists', custom: 'BK_LISTS' },
      { kind: 'category', name: 'Constants', categorystyle: 'bk_constants', custom: 'BK_CONSTANTS' },
      { kind: 'category', name: 'Functions', categorystyle: 'bk_functions', custom: 'BK_FUNCTIONS' },
      cat('C code', 'code', [block('bk_c_stmt'), block('bk_c_expr'), block('bk_c_wrap'), block('bk_c_top')]),
    ],
  };
}

const heading = text => ({ kind: 'label', text, 'web-class': 'bkFlyoutHeading' });

// A thin line across the drawer (an empty label; decorateRules draws the line)
const subheading = text => ({ kind: 'label', text: text.toUpperCase(), 'web-class': 'bkFlyoutSub' });
const rule = () => [{ kind: 'sep', gap: 20 }, { kind: 'label', text: '\u00a0', 'web-class': 'bkFlyoutRule' }, { kind: 'sep', gap: 12 }];

// Variables: making one, then set (its dropdown holds every variable; a local one shows a "local"
// pill), an example of setting a local variable, change, and below a rule each variable, global
// ones and then local ones, ready to drag
function variablesFlyout(ws) {
  const vm = ws.getVariableMap();
  const of = types => vm.getAllVariables().filter(v => types.includes(v.type)).sort((a, b) => a.name.localeCompare(b.name));
  const items = [heading('Variables'), { kind: 'button', text: 'Make a variable…', callbackkey: 'BK_MAKE_VAR' }, { kind: 'sep', gap: 24 }];
  const ref = v => ({ VAR: { id: v.getId() } });
  const value = { num: numBlock(0), bool: null, color: colorBlock('RED') };
  const kinds = ['num', 'bool', 'color'].map(kind => ({ kind, globals: of(KIND_TYPES[kind]), locals: of(LOCAL_TYPES[kind]) }));
  const globals = kinds.flatMap(k => k.globals.map(v => [k.kind, v])), locals = kinds.flatMap(k => k.locals.map(v => [k.kind, v]));
  const setOf = (fields, kind) => ({ kind: 'block', type: SETTER[kind], fields, inputs: value[kind] ? { VALUE: { shadow: value[kind] } } : {} });
  if (globals.length) items.push(setOf(ref(globals[0][1]), globals[0][0]));
  // an example local variable to drag out (it makes a local x if there isn't one)
  items.push(locals.length ? setOf(ref(locals[0][1]), locals[0][0]) : setOf({ VAR: { name: 'x', type: localType('int') } }, 'num'));
  const nums = [...kinds[0].globals, ...kinds[0].locals];
  if (nums.length) items.push({ kind: 'block', type: 'bk_change', fields: ref(nums[0]), inputs: { DELTA: { shadow: numBlock(1) } } });
  const timers = of(['Timer']);
  if (timers.length) {
    items.push({ kind: 'block', type: 'bk_timer_set', fields: { TIMER: { id: timers[0].getId() } }, inputs: { MS: { shadow: numBlock(1000) } } });
    items.push({ kind: 'block', type: 'bk_timer_done', fields: { TIMER: { id: timers[0].getId() } } });
  }
  const getters = list => list.map(([kind, v]) => ({ kind: 'block', type: GETTER[kind], fields: ref(v), gap: 8 }));
  if (globals.length || locals.length) items.push(...rule());
  if (globals.length) items.push(subheading('Global'), ...getters(globals));
  if (locals.length) items.push(...(globals.length ? [{ kind: 'sep', gap: 16 }] : []), subheading('Local'), ...getters(locals));
  return items;
}

// "Make a variable…": a name, what it holds, and whether it's global or local to its event or function
function makeVariable(Blockly, ws) {
  const host = ws.getInjectionDiv().parentElement;
  const wrap = document.createElement('div');
  wrap.className = 'bk-dialog';
  wrap.innerHTML = `<form class="bk-dialog-card bk-dialog-small bk-make-var" role="dialog" aria-label="Make a variable" autocomplete="off">
    <div class="bk-dialog-title bk-dialog-message">Make a variable</div>
    <input class="bk-dialog-input" name="name" placeholder="name" spellcheck="false" autocapitalize="off">
    <div class="bk-seg" role="radiogroup" aria-label="It holds">
      <label><input type="radio" name="kind" value="num" checked><span>number</span></label>
      <label><input type="radio" name="kind" value="bool"><span>true/false</span></label>
      <label><input type="radio" name="kind" value="Color"><span>color</span></label>
      <label><input type="radio" name="kind" value="Timer"><span>timer</span></label>
    </div>
    <div class="bk-number-types">${numberTypeChoices('int')}</div>
    ${exampleRow}
    <div class="bk-seg" role="radiogroup" aria-label="Scope">
      <label><input type="radio" name="scope" value="global" checked><span>global</span></label>
      <label><input type="radio" name="scope" value="local"><span>local</span></label>
    </div>
    <div class="bk-dialog-hint bk-scope-hint"></div>
    <div class="bk-dialog-actions"><span class="bk-dialog-hint bk-make-err"></span>
      <button type="button" class="bk-btn" data-act="cancel">Cancel</button>
      <button type="submit" class="bk-btn bk-btn-primary">Make</button></div></form>`;
  const form = wrap.querySelector('form'), name = form.elements.name, err = wrap.querySelector('.bk-make-err'), hint = wrap.querySelector('.bk-scope-hint');
  const sync = () => {
    const kind = form.elements.kind.value, timer = kind === 'Timer';
    form.querySelector('input[value="local"]').disabled = timer;
    if (timer) form.elements.scope.value = 'global';
    form.querySelector('.bk-number-types').hidden = kind !== 'num';
    const type = kind === 'num' ? form.elements.numtype.value : kind;
    const holds = `${aType(type)}${type === 'bool' ? ' (boolean)' : ''} holds ${TYPE_INFO[type]}. `;
    hint.textContent = holds + (form.elements.scope.value === 'local'
      ? 'Local: belongs to the event or function where it\'s set, and starts fresh each time it runs.'
      : 'Global: every event and function shares it, and it keeps its value.');
  };
  sync();
  form.addEventListener('change', sync);
  const stop = typeExamples(form, () => (form.elements.kind.value === 'num' ? form.elements.numtype.value : form.elements.kind.value));
  const close = () => { stop(); wrap.remove(); };
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.dataset.act === 'cancel') close(); });
  wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = name.value.trim();
    const kind = form.elements.kind.value === 'num' ? form.elements.numtype.value : form.elements.kind.value;
    const type = form.elements.scope.value === 'local' ? localType(kind) : kind;
    if (!text) { err.textContent = 'Give it a name.'; return; }
    // names are unique among the global variables and among the local ones (a local may share a global's name)
    const taken = ws.getVariableMap().getAllVariables().some(v => v.type !== 'face' && isLocalType(v.type) === isLocalType(type) && v.name.toLowerCase() === text.toLowerCase());
    if (taken) { err.textContent = `There's already a ${isLocalType(type) ? 'local' : 'global'} variable called ${text}.`; return; }
    Blockly.Events.setGroup(true);
    try { ws.getVariableMap().createVariable(text, type); } finally { Blockly.Events.setGroup(false); }
    close();
    const tb = ws.getToolbox && ws.getToolbox();
    if (tb && tb.refreshSelection) tb.refreshSelection();
  });
  host.appendChild(wrap);
  // after Blockly has finished with the click that opened this (it takes focus back)
  setTimeout(() => name.focus(), 0);
}

// Constants: the blocks that make a define or an enum, then below a rule each name they made
function constantsFlyout(ws) {
  const items = [
    heading('Constants'),
    { kind: 'block', type: 'bk_define', fields: { NAME: 'SPEED' }, inputs: { VALUE: { shadow: numBlock(100) } } },
    { kind: 'block', type: 'bk_enum', extraState: { items: 3 }, fields: { NAME: 'mode', ITEM0: 'READY', ITEM1: 'PLAYING', ITEM2: 'DONE' } },
  ];
  const blocks = ws.getAllBlocks(false);
  const defines = [...new Set(blocks.filter(b => b.type === 'bk_define').map(b => b.getFieldValue('NAME')))].sort();
  const enumNames = [...new Set(blocks.filter(b => b.type === 'bk_enum').flatMap(b => b.itemNames_()))];
  if (!defines.length && !enumNames.length) return items;
  items.push(...rule());
  for (const name of defines) items.push({ kind: 'block', type: 'bk_define_value', fields: { NAME: name }, gap: 8 });
  if (defines.length && enumNames.length) items.push({ kind: 'sep', gap: 20 });
  for (const name of enumNames) items.push({ kind: 'block', type: 'bk_enum_value', fields: { NAME: name }, gap: 8 });
  return items;
}

function listsFlyout(ws) {
  const lists = ws.getVariableMap().getAllVariables().filter(v => isList(v.type)).sort((a, b) => a.name.localeCompare(b.name));
  const items = [
    heading('Lists'),
    { kind: 'button', text: 'Make a number list', callbackkey: 'BK_LIST_int[]' },
    { kind: 'button', text: 'Make a true/false list', callbackkey: 'BK_LIST_bool[]' },
    { kind: 'button', text: 'Make a color list', callbackkey: 'BK_LIST_Color[]' },
  ];
  if (!lists.length) return items;
  const ref = v => ({ LIST: { id: v.getId() } });
  const index = { INDEX: { shadow: numBlock(0) } };
  items.push({ kind: 'sep', gap: 24 });
  items.push({ kind: 'block', type: 'bk_list_decl', fields: { ...ref(lists[0]), COUNT: LIST_SIZE } });
  const kind0 = listKind(lists[0].type);
  const samples = { num: [1, 2, 3].map(numBlock), color: ['RED', 'GREEN', 'BLUE'].map(colorBlock), bool: [true, false, true].map(b => ({ type: 'bk_bool', fields: { BOOL: b ? 'TRUE' : 'FALSE' } })) }[kind0];
  items.push({ kind: 'block', type: 'bk_list_init', fields: ref(lists[0]), extraState: { items: 3, kind: kind0 },
    inputs: Object.fromEntries(samples.map((b, i) => ['ITEM' + i, itemInput(kind0, b)])) });
  for (const kind of ['num', 'bool', 'color']) {
    const of = lists.filter(v => listKind(v.type) === kind);
    if (!of.length) continue;
    items.push({ kind: 'sep', gap: 24 });
    for (const v of of) items.push({ kind: 'block', type: 'bk_list_get_' + kind, fields: ref(v), inputs: index, gap: 8 });
    items.push({ kind: 'sep', gap: 16 });
    const value = kind === 'num' ? { VALUE: { shadow: numBlock(0) } } : kind === 'color' ? { VALUE: { shadow: colorBlock('RED') } } : {};
    items.push({ kind: 'block', type: 'bk_list_set_' + kind, fields: ref(of[0]), inputs: { ...index, ...value } });
    if (kind === 'num') items.push({ kind: 'block', type: 'bk_list_change', fields: ref(of[0]), inputs: { ...index, DELTA: { shadow: numBlock(1) } } });
  }
  items.push({ kind: 'sep', gap: 24 }, { kind: 'block', type: 'bk_list_length', fields: ref(lists[0]) });
  return items;
}

// "Make a … list": name it, then put a block that sets it up on the workspace
function makeList(Blockly, ws, type) {
  const title = Blockly.Msg.NEW_VARIABLE_TITLE;
  Blockly.Msg.NEW_VARIABLE_TITLE = 'New list name:';
  try {
    Blockly.Variables.createVariableButtonHandler(ws, name => placeListSetup(Blockly, ws, name && ws.getVariableMap().getVariable(name, type)), type);
  } finally {
    Blockly.Msg.NEW_VARIABLE_TITLE = title;
  }
}
function placeListSetup(Blockly, ws, v) {
  if (!v) return;
  Blockly.Events.setGroup(true);
  try {
    // made from JSON with the list already chosen, so no default variable gets created
    const b = Blockly.serialization.blocks.append({ type: 'bk_list_decl', fields: { LIST: { id: v.getId() }, COUNT: LIST_SIZE } }, ws, { recordUndo: true });
    const view = ws.getMetricsManager().getViewMetrics(true);
    const flyout = ws.getFlyout && ws.getFlyout();
    const left = flyout && flyout.isVisible() ? flyout.getWidth() / ws.scale : 0;
    b.moveBy(view.left + left + 32, view.top + 32);
  } finally {
    Blockly.Events.setGroup(false);
  }
}

function functionsFlyout(Blockly, ws) {
  let items = Blockly.Procedures.flyoutCategory(ws, false);
  items = [heading('Functions'), ...items.filter(it => !(it.type === 'procedures_ifreturn'))];
  items.push({ kind: 'sep', gap: 24 }, { kind: 'block', type: 'bk_return' }, { kind: 'block', type: 'bk_return_value' });
  return items;
}

// A small dialog for editing multi-line C code
function openCodeDialog(host, title, value, onSave) {
  const wrap = document.createElement('div');
  wrap.className = 'bk-dialog';
  wrap.innerHTML = `<div class="bk-dialog-card" role="dialog" aria-label="${title}">
    <div class="bk-dialog-title">${title}</div>
    <textarea class="bk-dialog-code" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
    <div class="bk-dialog-actions"><span class="bk-dialog-hint">⌘/Ctrl + Enter to save</span>
      <button type="button" class="bk-btn" data-act="cancel">Cancel</button>
      <button type="button" class="bk-btn bk-btn-primary" data-act="save">Save</button></div></div>`;
  const ta = wrap.querySelector('textarea');
  ta.value = value;
  ta.rows = Math.min(18, Math.max(4, value.split('\n').length + 1));
  const close = () => wrap.remove();
  const save = () => { const v = ta.value.replace(/\s+$/, ''); close(); onSave(v); };
  wrap.addEventListener('click', e => {
    if (e.target === wrap) close();
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'cancel') close();
    if (act === 'save') save();
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.setRangeText('  ', s, ta.selectionEnd, 'end');
    }
  });
  host.appendChild(wrap);
  ta.focus();
}

// Blockly's prompts (naming a variable, renaming, "delete 3 uses?") as in-page dialogs: the browser's
// own prompt() and confirm() are blocked in some embedded browsers
function openAsk(message, value, done) {
  const B = globalThis.Blockly;
  const ws = B && B.getMainWorkspace && B.getMainWorkspace();
  const host = (ws && ws.getInjectionDiv && ws.getInjectionDiv().parentElement) || document.body;
  const wrap = document.createElement('div');
  wrap.className = 'bk-dialog';
  const asking = typeof value === 'string';
  const cancel = done.length > 0;
  wrap.innerHTML = `<div class="bk-dialog-card bk-dialog-small" role="dialog">
    <div class="bk-dialog-title bk-dialog-message"></div>
    ${asking ? '<input class="bk-dialog-input" spellcheck="false" autocapitalize="off" autocomplete="off">' : ''}
    <div class="bk-dialog-actions"><span class="bk-dialog-hint"></span>
      ${cancel ? '<button type="button" class="bk-btn" data-act="cancel">Cancel</button>' : ''}
      <button type="button" class="bk-btn bk-btn-primary" data-act="ok">OK</button></div></div>`;
  wrap.querySelector('.bk-dialog-message').textContent = message;
  const input = wrap.querySelector('input');
  if (input) input.value = value;
  let finished = false;
  const finish = ok => {
    if (finished) return;
    finished = true;
    wrap.remove();
    done(ok ? (input ? input.value : true) : null);
  };
  wrap.addEventListener('click', e => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'ok') finish(true);
    else if (act === 'cancel' || (e.target === wrap && cancel)) finish(false);
  });
  wrap.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(!cancel); }
  });
  host.appendChild(wrap);
  setTimeout(() => { (input || wrap.querySelector('.bk-btn-primary')).focus(); if (input) input.select(); }, 0);
}

function installUi(Blockly) {
  if (installUi.done) return;
  installUi.done = true;
  installListItemDrag(Blockly);

  if (Blockly.dialog && Blockly.dialog.setPrompt) {
    Blockly.dialog.setPrompt((message, value, callback) => openAsk(message, String(value ?? ''), v => callback(v)));
    Blockly.dialog.setConfirm((message, callback) => openAsk(message, null, v => callback(v === true)));
    Blockly.dialog.setAlert((message, callback) => openAsk(message, null, () => callback && callback()));
  }

  // Toolbox rows: a colored dot and the name, instead of a colored stripe
  class Category extends Blockly.ToolboxCategory {
    createIconDom_() {
      const dot = document.createElement('span');
      dot.className = 'bkCatDot';
      dot.style.background = this.colour_ || '#888';
      return dot;
    }
    addColourBorder_() {}
    setSelected(selected) {
      super.setSelected(selected);
      if (this.rowDiv_) {
        this.rowDiv_.style.backgroundColor = '';
        this.rowDiv_.classList.toggle('bkCatSelected', selected);
      }
    }
  }
  Blockly.registry.register(Blockly.registry.Type.TOOLBOX_ITEM, Blockly.ToolboxCategory.registrationName, Category, true);

  if (Blockly.ContextMenuRegistry.registry.getItem('bk_edit_code')) Blockly.ContextMenuRegistry.registry.unregister('bk_edit_code');
  Blockly.ContextMenuRegistry.registry.register({
    id: 'bk_edit_code',
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    displayText: 'Edit C code…',
    weight: -10,
    preconditionFn: scope => (scope.block && (scope.block.type === 'bk_c_stmt' || scope.block.type === 'bk_c_top') && !scope.block.isInFlyout ? 'enabled' : 'hidden'),
    callback: scope => editCode(scope.block),
  });
}

function editCode(block) {
  const ws = block.workspace;
  const host = ws.getInjectionDiv().parentElement;
  openCodeDialog(host, 'C code', String(block.getFieldValue('CODE') ?? ''), value => {
    const Blockly = globalThis.Blockly;
    Blockly.Events.setGroup(true);
    block.setFieldValue(value, 'CODE');
    Blockly.Events.setGroup(false);
  });
}

export async function createBlocksEditor(container, { onChange } = {}) {
  const Blockly = await loadBlockly();
  const { generator } = install(Blockly);
  let ws, host = null;

  if (container) {
    loadCss();
    installUi(Blockly);
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    host = document.createElement('div');
    host.className = 'bk-host';
    container.appendChild(host);
    const small = Math.min(container.clientWidth || innerWidth, innerWidth) < 640;
    ws = Blockly.inject(host, {
      renderer: Blockly.registry.hasItem(Blockly.registry.Type.RENDERER, 'bk_zelos') ? 'bk_zelos' : 'zelos',
      theme: makeTheme(Blockly),
      toolbox: toolbox(),
      media: CDN + 'media/',
      sounds: false,
      trashcan: true,
      grid: { spacing: 28, length: 2.5, colour: '#2f2840', snap: false },
      zoom: { controls: true, wheel: false, pinch: true, startScale: small ? 0.8 : 0.9, maxScale: 2, minScale: 0.4, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: true },
      oneBasedIndex: false,
    });
    animateFlyout(ws.getToolbox()?.getFlyout());
    decorateRules(ws.getToolbox()?.getFlyout());
    ws.registerToolboxCategoryCallback('BK_VARIABLES', variablesFlyout);
    ws.registerToolboxCategoryCallback('BK_FUNCTIONS', w => functionsFlyout(Blockly, w));
    ws.registerToolboxCategoryCallback('BK_LISTS', listsFlyout);
    ws.registerToolboxCategoryCallback('BK_CONSTANTS', constantsFlyout);
    for (const type of ['int[]', 'bool[]', 'Color[]']) {
      ws.registerButtonCallback('BK_LIST_' + type, btn => makeList(Blockly, btn.getTargetWorkspace(), type));
    }
    ws.registerButtonCallback('BK_MAKE_VAR', btn => makeVariable(Blockly, btn.getTargetWorkspace()));
  } else {
    ws = new Blockly.Workspace();
  }

  let timer = null;
  let loading = false;
  let pendingLayout = false;   // laid out once the container is visible
  const getCode = () => generateProgram(ws, generator);
  ws.addChangeListener(e => {
    if (loading || e.isUiEvent) {
      if (e.type === Blockly.Events.CLICK && e.targetType === 'block' && !loading) {
        const b = ws.getBlockById(e.blockId);
        if (b && (b.type === 'bk_c_stmt' || b.type === 'bk_c_top') && String(b.getFieldValue('CODE')).includes('\n')) editCode(b);
      }
      return;
    }
    if (!onChange) return;
    clearTimeout(timer);
    timer = setTimeout(() => onChange(getCode()), 300);
  });

  const load = state => {
    loading = true;
    Blockly.Events.disable();
    try {
      ws.clear();
      Blockly.serialization.workspaces.load(state, ws, { recordUndo: false });
      if (ws.rendered) {
        pendingLayout = !host.clientWidth;
        if (!pendingLayout) layout(ws);
      }
    } finally {
      Blockly.Events.enable();
      ws.clearUndo();
      loading = false;
    }
  };
  load(STARTER);

  return {
    setCode(src) {
      if (!String(src ?? '').trim()) { load(STARTER); return { ok: true, lossy: false, notes: [] }; }
      let r = importSketch(src);
      if (!r.ok) return { ok: false, message: r.message };
      try {
        load(r.state);
      } catch (e) {
        console.warn('Blocks import fell back to C:', e);
        r = r.fallback();
        load(r.state);
      }
      return { ok: true, lossy: r.lossy, notes: r.notes };
    },
    getCode,
    resize() {
      if (!ws.rendered) return;
      Blockly.svgResize(ws);
      if (pendingLayout && host.clientWidth) {
        pendingLayout = false;
        // tidying the blocks is not an edit, so it must not rewrite the sketch
        loading = true;
        Blockly.Events.disable();
        try { layout(ws); } finally { Blockly.Events.enable(); loading = false; }
      }
    },
    focus() {
      if (!ws.rendered) return;
      try { Blockly.getFocusManager().focusTree(ws); } catch (e) { ws.getParentSvg().focus && ws.getParentSvg().focus(); }
    },
  };
}

// One tidy column: file notes first, then the scripts in order, a little away from the edges
// Lists take items by insertion: picking an item up takes it out of its list (the others close
// up), and while a block that fits is dragged near a gap between items, the items slide apart
// around an empty slot where dropping will put it. Item slots themselves aren't drop targets.
// Blockly's block drag is wrapped so all of this happens inside the drag, in its undo step; the
// open-slot preview is made with events off and taken back before the drop, so undo never sees it.
function installListItemDrag(Blockly) {
  const P = Blockly.dragging && Blockly.dragging.BlockDragStrategy && Blockly.dragging.BlockDragStrategy.prototype;
  if (!P || P.bkListItems) return;
  P.bkListItems = true;
  const itemSlot = conn => {
    const list = conn && conn.getSourceBlock();
    if (!list || list.type !== 'bk_list_init') return null;
    const input = list.inputList.find(i => i.connection === conn);
    const m = input && /^ITEM(\d+)$/.exec(input.name);
    return m ? { list, index: Number(m[1]) } : null;
  };
  const { startDrag, drag, endDrag, revertDrag } = P;
  const quietly = fn => {
    Blockly.Events.disable();
    try { fn(); } finally { Blockly.Events.enable(); }
  };
  // open (or close) an empty slot at `index` in a list
  const preview = (gap, open) => {
    if (!gap || gap.list.isDeadOrDying()) return;
    quietly(() => {
      const ids = gap.list.itemIds_();
      if (open) ids.splice(gap.index, 0, null); else ids.splice(gap.index, 1);
      gap.list.placeItems_(ids, open ? gap.index : -1);
    });
  };
  const same = (a, b) => (a && b ? a.list === b.list && a.index === b.index : a === b);
  const unpreview = strategy => { preview(strategy.bkGap, false); strategy.bkGap = null; };

  P.startDrag = function (e) {
    const slot = !this.block.isShadow() && this.block.outputConnection && itemSlot(this.block.outputConnection.targetConnection);
    let result;
    slideItems(Blockly, slot ? [slot.list] : [], () => {
      result = startDrag.call(this, e);
      if (slot && slot.list.items_ > 1) {
        const ids = slot.list.itemIds_();
        ids.splice(slot.index, 1);
        slot.list.setItems_(ids);
      }
    });
    this.bkLayouts = new Map();
    return result;
  };
  // Blockly's own search, minus list item slots
  P.getConnectionCandidate = function (block, delta) {
    let radius = this.getSearchRadius(), best = null;
    for (const local of this.getLocalConnections(block)) {
      const { connection, radius: r } = local.closest(radius, delta);
      if (connection && !itemSlot(connection)) { best = { local, neighbour: connection, distance: r }; radius = r; }
    }
    return best;
  };
  P.drag = function (newLoc, e) {
    const result = drag.call(this, newLoc, e);
    const layouts = this.bkLayouts || (this.bkLayouts = new Map());
    const gap = this.block.isShadow() || this.connectionCandidate ? null : findListGap(this.block, newLoc, this.bkGap, layouts);
    if (!same(gap, this.bkGap)) {
      const lists = [this.bkGap && this.bkGap.list, gap && gap.list].filter(Boolean);
      slideItems(Blockly, lists, () => {
        unpreview(this);
        if (gap) { preview(gap, true); this.bkGap = gap; }
      });
    }
    return result;
  };
  P.revertDrag = function (...args) {
    slideItems(Blockly, this.bkGap ? [this.bkGap.list] : [], () => unpreview(this));
    return revertDrag.apply(this, args);
  };
  P.endDrag = function (e) {
    const gap = this.bkGap && { list: this.bkGap.list, index: this.bkGap.index };
    let result;
    slideItems(Blockly, gap ? [gap.list] : [], () => {
      unpreview(this);
      result = endDrag.call(this, e);
      const block = this.block;
      if (gap && !block.isDeadOrDying() && !block.getParent() && !gap.list.isDeadOrDying()) {
        const ids = gap.list.itemIds_();
        if (ids.length === 1 && ids[0] === null) ids[0] = block.id;   // a list holding only its default
        else ids.splice(gap.index, 0, block.id);
        if (ids.length <= LIST_MAX) gap.list.setItems_(ids);
      }
    });
    this.bkLayouts = null;
    return result;
  };
}

// Run fn, which moves items around in these lists, then slide each item (and the + button) from
// where it was drawn to its new place. An item still sliding starts from where it is now.
function slideItems(Blockly, lists, fn) {
  lists = [...new Set(lists)].filter(l => l && !l.isDeadOrDying() && l.rendered);
  const offset = el => {
    const t = getComputedStyle(el).translate;
    return t && t !== 'none' ? parseFloat(t) || 0 : 0;
  };
  const parts = list => {
    const out = [];
    for (let k = 0; list.getInput('ITEM' + k); k++) {
      const t = list.getInputTargetBlock('ITEM' + k);
      if (t) out.push([t.id, t.getSvgRoot(), () => t.getRelativeToSurfaceXY().x]);
    }
    const plus = list.getField('PLUS');
    const el = plus && plus.getSvgRoot();
    // its place in the block (the transform attribute, so a running slide isn't counted)
    if (el) out.push(['+' + list.id, el, () => { const m = el.transform.baseVal.consolidate(); return m ? m.matrix.e : 0; }]);
    return out;
  };
  const before = new Map();
  for (const list of lists) for (const [id, el, x] of parts(list)) before.set(id, x() + offset(el));
  fn();
  if (!lists.length) return;
  if (Blockly.renderManagement) Blockly.renderManagement.triggerQueuedRenders(lists[0].workspace);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const list of lists) {
    if (list.isDeadOrDying()) continue;
    for (const [id, el, x] of parts(list)) {
      if (!before.has(id)) continue;
      el.getAnimations().forEach(a => a.cancel());
      const dx = before.get(id) - x();
      if (still || Math.abs(dx) < 0.5) continue;
      el.animate([{ translate: `${dx}px 0` }, { translate: '0 0' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
}

// Where a list's items would part for each gap, measured with no gap open: an open gap moves the
// items after it, and measuring that would make the gap jump between places
function listGaps(list) {
  const rects = [];
  for (let k = 0; list.getInput('ITEM' + k); k++) {
    const t = list.getInputTargetBlock('ITEM' + k);
    if (t) rects.push(t.getBoundingRectangle());
  }
  const gaps = [];
  for (let k = 0; k <= rects.length && rects.length; k++) {
    const r = rects[Math.min(k, rects.length - 1)];
    gaps.push({
      x: k === 0 ? r.left - 3 : k === rects.length ? r.right + 3 : (rects[k - 1].right + rects[k].left) / 2,
      y: (r.top + r.bottom) / 2,
      h: r.bottom - r.top,
    });
  }
  return gaps;
}

// The gap between list items nearest the dragged block's left edge (where it would connect).
// `layouts` keeps each list's gaps as first measured in this drag, before any opened (lists don't
// move during a drag); the open gap is a little stickier, so it doesn't flick between two.
function findListGap(block, loc, open, layouts) {
  const out = block.outputConnection;
  if (!out) return null;
  const check = out.getCheck();
  const height = block.getHeightWidth().height;
  const px = loc.x, py = loc.y + height / 2;
  let best = null, bestD = 44;
  for (const list of block.workspace.getTopBlocks(false)) {
    if (list.type !== 'bk_list_init' || !list.isEnabled()) continue;
    if (check && !check.includes(KIND_CHECK[list.kind_])) continue;
    const isOpen = open && open.list === list;
    if (!isOpen && list.items_ >= LIST_MAX) continue;
    if (!layouts.has(list)) layouts.set(list, listGaps(list));
    layouts.get(list).forEach((g, k) => {
      if (Math.abs(py - g.y) > g.h) return;
      const d = Math.abs(px - g.x) - (isOpen && k === open.index ? 8 : 0);
      if (d < bestD) { bestD = d; best = { list, index: k }; }
    });
  }
  return best;
}

// Draw the line of each rule label in a drawer, across the drawer's width, each time it opens
function decorateRules(flyout) {
  if (!flyout) return;
  const show = flyout.show.bind(flyout);
  flyout.show = (...args) => {
    const result = show(...args);
    const width = flyout.getWidth() / flyout.getWorkspace().scale;
    for (const g of flyout.getWorkspace().getCanvas().parentNode.querySelectorAll('.bkFlyoutRule')) {
      g.querySelector('.bkRuleLine')?.remove();
      globalThis.Blockly.utils.dom.createSvgElement('rect', { class: 'bkRuleLine', x: 0, y: 8, height: 1, width: Math.max(40, width - 32) }, g);
    }
    return result;
  };
}

// Slide the block drawer in and out instead of popping it. Blockly shows and hides the
// flyout (and its scrollbar) in updateDisplay(), so closing waits for the slide to finish.
function animateFlyout(flyout) {
  if (!flyout || !Element.prototype.animate) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const update = flyout.updateDisplay.bind(flyout);
  const parts = () => [flyout.svgGroup_, flyout.workspace_?.scrollbar?.vScroll?.outerSvg].filter(Boolean);
  const OUT = { opacity: 0, translate: '-16px 0' }, IN = { opacity: 1, translate: '0 0' };
  let shown = false, closing = null;
  flyout.updateDisplay = () => {
    const show = flyout.containerVisible && flyout.isVisible();
    if (closing) { for (const a of closing) a.cancel(); closing = null; for (const el of parts()) el.style.pointerEvents = ''; }
    if (show || !shown || reduce.matches) {
      update();
      if (show && !shown && !reduce.matches) {
        for (const el of parts()) el.animate([OUT, IN], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      shown = show;
      return;
    }
    const anims = closing = parts().map(el => {
      el.style.pointerEvents = 'none';
      return el.animate([IN, OUT], { duration: 140, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    });
    anims[0].finished.then(() => {
      if (closing !== anims) return;     // reopened before the slide finished
      closing = null;
      shown = false;
      update();
      for (const el of parts()) el.style.pointerEvents = '';
      for (const a of anims) a.cancel();
    }, () => {});
  };
}

function layout(ws) {
  const C = globalThis.Blockly.utils.Coordinate;
  let y = 36;
  for (const item of [...ws.getTopComments(true), ...ws.getTopBlocks(true)]) {
    item.moveTo(new C(36, y));
    const size = item.getHeightWidth ? item.getHeightWidth() : item.getSize();
    y += size.height + 36;
  }
  ws.scroll(0, 0);
}
