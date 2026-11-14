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
// Lists (C arrays) are variables whose type is the item type plus "[]": byte[] is a list of bytes.
// A grid (a 2D array, shown as rows) has "[][]": byte[][] is rows of bytes.
const isList = type => typeof type === 'string' && type.endsWith('[]');
const isGrid = type => typeof type === 'string' && type.endsWith('[][]');
const itemType = type => type.replace(/(\[\])+$/, '');
// A local variable (made inside an event or function) has its C type plus "@local": int@local
// A const variable (its value never changes) has "@const" last: byte@const, int@local@const
const LOCAL_TAG = '@local', CONST_TAG = '@const';
const isLocalType = type => typeof type === 'string' && type.includes(LOCAL_TAG);
const isConstType = type => typeof type === 'string' && type.endsWith(CONST_TAG);
const baseType = type => (typeof type === 'string' ? type.replace(/@(local|const)/g, '') : type);
const localType = type => baseType(type) + LOCAL_TAG;
const constType = (type, local) => baseType(type) + (local ? LOCAL_TAG : '') + CONST_TAG;
// another C type with the same scope and const-ness as `like`
const withTagsOf = (type, like) => baseType(type) + (isLocalType(like) ? LOCAL_TAG : '') + (isConstType(like) ? CONST_TAG : '');
// its scope and const-ness in words: "local const"
const scopeWords = type => [isLocalType(type) ? 'local' : 'global', isConstType(type) ? 'const' : ''].filter(Boolean).join(' ');
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
// How much memory a value of each type takes on a Blink (bytes)
const TYPE_BYTES = { byte: 1, char: 1, int8_t: 1, bool: 1, int: 2, word: 2, '': 2, Color: 2, long: 4, 'unsigned long': 4, float: 4, Timer: 4 };
const typeInfo = type => {
  const n = TYPE_BYTES[type];
  return (TYPE_INFO[type] || 'a value') + (n ? `, in ${n} byte${n === 1 ? '' : 's'}` : '');
};
const aType = type => (/^[aeiou]/i.test(type) ? 'An ' : 'A ') + type;
const FLOAT_WARNING = 'Floats use a lot of memory on a Blink: float math adds a big chunk of code to your game, and each float takes 4 bytes. It\'s slow too. Use whole numbers when you can.';
const LOCAL_TYPES = { num: NUM_TYPES.filter(Boolean).map(localType), bool: ['bool' + LOCAL_TAG], color: ['Color' + LOCAL_TAG] };
const CONST_TYPES = { num: NUM_TYPES.filter(Boolean).map(t => constType(t)), bool: [constType('bool')], color: [constType('Color')] };
const LOCAL_CONST_TYPES = { num: NUM_TYPES.filter(Boolean).map(t => constType(t, true)), bool: [constType('bool', true)], color: [constType('Color', true)] };
const ALL_CONST_TYPES = [...CONST_TYPES.num, ...CONST_TYPES.bool, ...CONST_TYPES.color];
const listKind = type => kindOf(itemType(type));
const LIST_TYPES = { num: NUM_TYPES.filter(Boolean).map(t => t + '[]'), bool: ['bool[]'], color: ['Color[]'] };
const ALL_LIST_TYPES = [...LIST_TYPES.num, ...LIST_TYPES.bool, ...LIST_TYPES.color];
// a list of timers is set up with a size (C can't give Timers starting values) and used by the timer blocks
const TIMER_LIST = 'Timer[]';
const GRID_TYPES = { num: NUM_TYPES.filter(Boolean).map(t => t + '[][]'), bool: ['bool[][]'], color: ['Color[][]'] };
const ALL_GRID_TYPES = [...GRID_TYPES.num, ...GRID_TYPES.bool, ...GRID_TYPES.color];
// datagrams are bytes, so a list sent as one holds one-byte numbers
const BYTE_LIST_TYPES = ['byte[]', 'char[]', 'int8_t[]'];
const BYTE_GRID_TYPES = BYTE_LIST_TYPES.map(t => t + '[]');
const LIST_SIZE = 6;   // a list without a "list … with N items" block gets one item per face
const LIST_MAX = 64;
const GRID_MAX = 16;   // rows, and items in a row
const GRID_SLOTS = 64; // a grid with starting items shows at most this many
const cType = type => (type === '' ? 'int' : baseType(type));
const GETTER = { num: 'bk_get_num', bool: 'bk_get_bool', color: 'bk_get_color' };
// One set block for every variable: its value slot follows the kind of variable chosen
const SETTER = { num: 'bk_set', bool: 'bk_set', color: 'bk_set' };
const SET_DEFAULT = { num: 0, bool: null, color: 'RED' };
const KIND_CHECK = { num: 'Number', bool: 'Boolean', color: 'Color' };
// A whole list or grid given to a function is checked by its kind: "List:num", "Grid:color"
const listCheck = type => (isGrid(type) ? 'Grid:' : 'List:') + listKind(baseType(type));
// the check of the slot a function input has in its calls
const inputCheck = type => (isList(type) ? listCheck(type) : KIND_CHECK[kindOf(type)] || null);

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
  ['bk_dg_ready', 'neighbors', 'datagram on face %1 ?', 'isDatagramReadyOnFace', [['FACE', N, 0]], B,
    'True when a datagram from the neighbor on this face is waiting to be read.'],
  ['bk_dg_length', 'neighbors', 'length of datagram on face %1', 'getDatagramLengthOnFace', [['FACE', N, 0]], N,
    'How many bytes are in the datagram waiting on this face.'],
  ['bk_dg_done', 'neighbors', 'done with datagram on face %1', 'markDatagramReadOnFace', [['FACE', N, 0]], null,
    'Let go of the datagram on this face. Until you do, the next one from that neighbor is dropped.'],
  ['bk_millis', 'time', 'milliseconds since start', 'millis', [], N,
    'How long this Blink has been running, in milliseconds (1000 per second).'],
  ['bk_woken', 'time', 'just woke up?', 'hasWoken', [], B,
    'True once after the Blink wakes from sleep. A Blink falls asleep after 10 minutes with nothing happening, or when its button is held for 6 seconds.'],
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
// the count block's directions: [label, C comparison, counting up?]
const FOR_DIRECTIONS = [['up to', '<', true], ['up through', '<=', true], ['down to', '>', false], ['down through', '>=', false]];
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
  registerIcons(Blockly);
  registerVariableMenu(Blockly);
  registerCollapseMenu(Blockly);
  // a disabled block keeps its colors (no hatching) and is ghostly instead, like the ones in the trash
  Blockly.blockRendering.PathObject.prototype.updateDisabled_ = function (disabled) { this.setClass_('blocklyDisabled', disabled); };
  setMessages(Blockly);
  defineFields(Blockly);
  defineBlocks(Blockly);
  installed = { generator: makeGenerator(Blockly) };
  return installed;
}

// Zelos, with room above each case of a switch after the first: a case row right after the blocks
// of the case above sits tight against them, and the smallest spacer row would be far too tall
// A block's comment icon shows a speech bubble instead of Blockly's question mark, and its
// comment opens and closes with a little bounce
function registerIcons(Blockly) {
  const svg = Blockly.utils.dom.createSvgElement, S = Blockly.utils.Svg;
  class CommentIcon extends Blockly.icons.CommentIcon {
    initView(pointerdownListener) {
      const fresh = !this.svgRoot;
      super.initView(pointerdownListener);
      if (!fresh) return;
      for (const el of [...this.svgRoot.querySelectorAll('.blocklyIconSymbol')]) el.remove();
      svg(S.PATH, { class: 'blocklyIconSymbol', d: 'M4.4 3.8h7.2a1.6 1.6 0 0 1 1.6 1.6v4.2a1.6 1.6 0 0 1-1.6 1.6H8.4l-2.9 2.3v-2.3H4.4a1.6 1.6 0 0 1-1.6-1.6V5.4a1.6 1.6 0 0 1 1.6-1.6z' }, this.svgRoot);
    }
    async setBubbleVisible(visible) {
      const was = this.bubbleIsVisible();
      if (was && !visible) await animateBubble(this.getBubble(), false);
      await super.setBubbleVisible(visible);
      if (visible && !was) {
        const bubble = this.getBubble();
        fitCommentBubble(Blockly, bubble);
        const ta = bubble && bubble.getSvgRoot().querySelector('textarea');
        if (ta) ta.addEventListener('input', () => fitCommentBubble(Blockly, bubble, true));
        addBubbleGrip(Blockly, bubble);
        animateBubble(bubble, true);
      }
    }
  }
  Blockly.registry.register(Blockly.registry.Type.ICON, String(Blockly.icons.CommentIcon.TYPE), CommentIcon, true);

  // Tooltips: the whole text, wrapped by the tooltip box (Blockly breaks it into 50-letter lines,
  // which the box then wraps again). Text after a blank line is a hint, in smaller type.
  Blockly.Tooltip.setCustomTooltip((div, element) => {
    const [text, ...hint] = String(Blockly.Tooltip.getTooltipOfObject(element) ?? '').split('\n\n');
    div.textContent = text;
    if (hint.length) div.appendChild(Object.assign(document.createElement('div'), { className: 'bkTipHint', textContent: hint.join('\n\n') }));
  });

  // A collapsed workspace comment shows its first line as a title (Blockly shows 9 letters and
  // "..."), followed by a page icon that says there's more inside
  const View = Blockly.comments.CommentView.prototype;
  View.truncateText = text => {
    const line = (String(text).split('\n').find(l => l.trim()) || '').trim();
    if (line.length <= 48) return line;
    const cut = line.slice(0, 48), space = cut.lastIndexOf(' ');
    return space > 24 ? cut.slice(0, space) : cut;
  };
  const placePage = view => {
    const title = view.textPreview;
    if (!title || !title.parentNode) return;
    if (!view.bkPage) {
      view.bkPage = svg(S.PATH, { class: 'bkCommentPage', d: 'M1.5 .75h6l3.25 3.25v9.25h-9.25z M7.5 .75v3.25h3.25 M3.75 7h4.5 M3.75 9.75h4.5' }, title.parentNode);
    }
    let width = 0;
    try { width = title.getComputedTextLength(); } catch (e) { /* not laid out yet */ }
    const x = (parseFloat(title.getAttribute('x')) || 0) + width + (width ? 8 : 0), y = (parseFloat(title.getAttribute('y')) || 12) - 7;
    view.bkPage.setAttribute('transform', `translate(${x}, ${y})`);
  };
  for (const name of ['updateTextPreview', 'updateTextPreviewSize']) {
    const original = View[name];
    View[name] = function (...args) {
      const result = original.apply(this, args);
      placePage(this);
      return result;
    };
  }

  // The blocks start below a workspace comment, so its collapse button folds it into a bar at its
  // bottom (the top slides down to meet it) and opens it upward from there. Only the button
  // animates: undo and redo replay the collapse and the move as they were.
  const Button = Blockly.comments.CollapseCommentBarButton.prototype;
  const perform = Button.performAction;
  Button.performAction = function (e) {
    const view = this.getCommentView();
    const comment = this.workspace.getTopComments(false).find(c => c.view === view);
    if (!comment || comment.bkAnimating || (e instanceof PointerEvent && e.button === 2)
        || matchMedia('(prefers-reduced-motion: reduce)').matches) return perform.call(this, e);
    if (e) e.stopPropagation();
    view.bringToFront();
    this.workspace.hideChaff();
    slideComment(Blockly, comment, !comment.isCollapsed());
  };
}

// Collapse a workspace comment into a bar at its bottom, or open it upward from that bar
function slideComment(Blockly, comment, collapsed) {
  const root = comment.getSvgRoot();
  const BAR = 36;   // the collapsed bar's height (see blocks.css)
  const drop = Math.max(0, comment.getSize().height - BAR);
  const at = comment.getRelativeToSurfaceXY();
  const clip = top => `inset(${top}px 0px 0px 0px round 10px)`;
  // the collapse and the move are one step to undo
  const change = () => {
    Blockly.Events.setGroup(true);
    try {
      comment.setCollapsed(collapsed);
      comment.moveTo(new Blockly.utils.Coordinate(at.x, at.y + (collapsed ? drop : -drop)));
    } finally {
      Blockly.Events.setGroup(false);
    }
  };
  const done = () => { comment.bkAnimating = false; root.classList.remove('bkSliding'); root.getAnimations().forEach(a => a.cancel()); };
  comment.bkAnimating = true;
  root.classList.add('bkSliding');
  if (collapsed) {
    root.animate([{ clipPath: clip(0) }, { clipPath: clip(drop) }], { duration: 260, easing: 'cubic-bezier(.5, 0, .3, 1)', fill: 'forwards' })
      .finished.then(() => { change(); done(); }, done);
  } else {
    change();
    root.animate([{ clipPath: clip(drop) }, { clipPath: clip(-4), offset: 0.8 }, { clipPath: clip(0) }], { duration: 360, easing: 'cubic-bezier(.4, 0, .2, 1)' })
      .finished.then(done, done);
  }
}

// A tab on the middle of a comment's top edge (shown on hover) that drags it like its border does.
// `width` gives the comment's width, `drag` (if the comment needs it) starts dragging it, and
// `onResize` reports size changes.
function addGrip(Blockly, root, { width, drag, onResize }) {
  if (!root || root.querySelector(':scope > .bkBubbleGrip')) return;
  const svg = Blockly.utils.dom.createSvgElement, S = Blockly.utils.Svg;
  const grip = svg(S.G, { class: 'bkBubbleGrip' });
  const tab = svg(S.RECT, { width: 32, height: 14, rx: 7, ry: 7, y: -7 }, grip);
  // two rows of three dots
  const dots = [-1.75, 1.75].flatMap(y => [-4, 0, 4].map(x => [svg(S.CIRCLE, { r: 1.1, cy: y }, grip), x]));
  // last, so it's drawn over the text area
  root.appendChild(grip);
  const place = () => {
    const w = width();
    tab.setAttribute('x', w / 2 - 16);
    for (const [dot, x] of dots) dot.setAttribute('cx', w / 2 + x);
  };
  place();
  onResize(place);
  if (drag) grip.addEventListener('pointerdown', drag);
  // shown for as long as the comment is held, so it stays while dragging
  root.addEventListener('pointerdown', () => {
    root.classList.add('bkHeld');
    document.addEventListener('pointerup', () => root.classList.remove('bkHeld'), { once: true, capture: true });
  });
}
const addBubbleGrip = (Blockly, bubble) => bubble && addGrip(Blockly, bubble.getSvgRoot(), {
  width: () => bubble.getSize().width,
  drag: e => bubble.onMouseDown(e),
  onResize: f => bubble.addSizeChangeListener && bubble.addSizeChangeListener(f),
});

// A comment on the workspace (the notes at the top of a sketch): sized to show all of its text,
// growing as you type, with the same grip as a block's comment
function decorateWorkspaceComment(Blockly, comment) {
  const root = comment && comment.getSvgRoot && comment.getSvgRoot();
  if (!root) return;
  fitWorkspaceComment(Blockly, comment);
  if (root.querySelector(':scope > .bkBubbleGrip')) return;
  addGrip(Blockly, root, {
    // a workspace comment already starts dragging from a press anywhere on it
    width: () => comment.getSize().width,
    onResize: f => new MutationObserver(f).observe(root, { attributes: true, attributeFilter: ['width'] }),
  });
  const ta = root.querySelector('textarea');
  if (ta) ta.addEventListener('input', () => fitWorkspaceComment(Blockly, comment, true));
}
let measureCtx = null;
function fitWorkspaceComment(Blockly, comment, keepWidth = false) {
  const root = comment.getSvgRoot();
  const ta = root.querySelector('textarea'), fo = root.querySelector('foreignObject');
  if (!ta || !fo || (comment.isCollapsed && comment.isCollapsed())) return;
  const cs = getComputedStyle(ta);
  let w = comment.getSize().width;
  if (!keepWidth) {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = Math.max(0, ...ta.value.split('\n').map(l => measureCtx.measureText(l).width));
    // the text, its padding, the panel's border around the text area, and a little slack
    w = Math.round(Math.max(220, Math.min(560, text + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 12 + 6)));
    comment.setSize(new Blockly.utils.Size(w, comment.getSize().height));
  }
  const was = ta.style.height;
  ta.style.height = '0px';
  const content = ta.scrollHeight;
  ta.style.height = was;
  const h = Math.ceil(parseFloat(fo.getAttribute('y')) + content + 6 + 1);
  if (Math.abs(h - comment.getSize().height) > 1) comment.setSize(new Blockly.utils.Size(w, h));
}

// A block's comment opens sized to its text, as wide as its longest line and as tall as its lines,
// up to a size that still leaves the blocks around it in view; only a longer comment scrolls
const BUBBLE_MIN_W = 160, BUBBLE_MAX_W = 360, BUBBLE_MAX_H = 300;
function fitCommentBubble(Blockly, bubble, keepWidth = false) {
  const root = bubble && bubble.getSvgRoot && bubble.getSvgRoot();
  const ta = root && root.querySelector('textarea'), fo = root && root.querySelector('foreignObject');
  if (!ta || !fo) return;
  const cs = getComputedStyle(ta);
  // the space around the text area inside the bubble
  const insetW = bubble.getSize().width - parseFloat(fo.getAttribute('width'));
  const insetH = bubble.getSize().height - parseFloat(fo.getAttribute('height'));
  const padW = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  let w = bubble.getSize().width;
  if (!keepWidth) {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = Math.max(0, ...ta.value.split('\n').map(l => measureCtx.measureText(l).width));
    w = Math.round(Math.max(BUBBLE_MIN_W, Math.min(BUBBLE_MAX_W, text + padW + insetW + 4)));
    if (Math.abs(w - bubble.getSize().width) > 1) bubble.setSize(new Blockly.utils.Size(w, bubble.getSize().height), true);
  }
  const was = ta.style.height;
  ta.style.height = '0px';
  const content = ta.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  ta.style.height = was;
  const h = Math.ceil(Math.min(BUBBLE_MAX_H, content + insetH + 1));
  if (Math.abs(h - bubble.getSize().height) > 1) bubble.setSize(new Blockly.utils.Size(w, h), true);
}

// A bubble grows out of its icon with a little overshoot, and shrinks back into it when it closes
function animateBubble(bubble, open) {
  const root = bubble && bubble.getSvgRoot && bubble.getSvgRoot();
  if (!root || !root.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const origin = `${-bubble.relativeLeft}px ${-bubble.relativeTop}px`;
  const frames = open
    ? [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, offset: 0.5 }, { opacity: 1, transform: 'scale(1)' }]
    : [{ opacity: 1, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1.04)', offset: 0.3 }, { opacity: 0, transform: 'scale(.6)' }];
  const timing = open ? { duration: 320, easing: 'cubic-bezier(.34, 1.56, .64, 1)' } : { duration: 200, easing: 'ease-in', fill: 'forwards' };
  // the grip and the resize corner sit out the animation (an animated transform would also undo
  // the CSS that moves the resize corner inside the text area)
  const extras = [...root.querySelectorAll(':scope > .bkBubbleGrip, :scope > .blocklyResizeHandle')];
  for (const el of extras) el.style.visibility = 'hidden';
  const runs = [...root.children].filter(el => !extras.includes(el)).map(el => {
    el.style.transformOrigin = origin;
    return el.animate(frames, timing).finished.catch(() => {});
  });
  return Promise.all(runs).then(() => { if (open) for (const el of extras) el.style.visibility = ''; });
}

const BUTTON_PAD = 8;   // a block's padding at its sides, kept under a bottom row of buttons too
function registerRenderer(Blockly) {
  if (!Blockly.zelos || Blockly.registry.hasItem(Blockly.registry.Type.RENDERER, 'bk_zelos')) return;
  class Info extends Blockly.zelos.RenderInfo {
    // a collapsed value block's name isn't tucked into its round ends: it stays where it is open
    getNegativeSpacing_(elem) { return this.isCollapsed ? 0 : super.getNegativeSpacing_(elem); }
    getSpacerRowHeight_(prev, next) {
      const h = super.getSpacerRowHeight_(prev, next);
      const laterCase = this.block_.type === 'bk_switch' && next.elements && next.elements.some(e => e.input && /^CASE[1-9]/.test(e.input.name));
      if (laterCase) return h + SWITCH_GAP;
      // a function call's inputs follow its name ("name with") like the next line of a sentence
      if (/^procedures_call/.test(this.block_.type) && prev.elements && prev.elements.some(e => e.parentInput && e.parentInput.name === 'TOPROW')) return 0;
      // nothing between a bottom row of buttons and the block's bottom edge (see createRows_)
      return Blockly.blockRendering.Types.isBottomRow(next) && this.isButtonRow_(prev) ? 0 : h;
    }
    // A row of buttons along the bottom (a grid's, or an enum's in a column) sits as far from the
    // bottom edge as from the sides: the row is only as tall as the buttons and that padding
    isButtonRow_(row) {
      return (this.block_.type === 'bk_grid_init' || this.block_.column_) && row.elements
        && row.elements.some(e => e.parentInput && e.parentInput.name === 'TAIL');
    }
    createRows_() {
      super.createRows_();
      // a collapsed block (a variable folded to its name, a define on one line) has no jagged edge
      // (Zelos doesn't draw one anyway): its text sits in the middle instead of 8px to the left
      if (this.isCollapsed) {
        for (const r of this.rows) {
          r.elements = r.elements.filter(e => !Blockly.blockRendering.Types.isJaggedEdge(e));
          r.hasJaggedEdge = false;
        }
      }
      const row = this.rows.find(r => this.isButtonRow_(r));
      // (the bottom row adds its own height below, and a button's field is a pixel taller than its picture)
      if (row) row.minHeight = Math.min(row.minHeight, Math.max(...row.elements.map(e => e.height)) - 2 + 2 * (BUTTON_PAD - this.constants_.BOTTOM_ROW_MIN_HEIGHT));
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
    // no "Describe this function..." comment on new functions: it would end up in the C code
    PROCEDURES_DEFNORETURN_COMMENT: '', PROCEDURES_DEFRETURN_COMMENT: '',
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
      // (on the white of the color block, a light color still has an edge)
      this.swatch_.setAttribute('stroke', this.isWholeBlock_() ? 'rgba(0,0,0,.18)' : v === 'WHITE' ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.35)');
      this.size_ = new Blockly.utils.Size(22, 22);
    }
    // the color block is white around its swatch, like a number block around its number
    isWholeBlock_() {
      const b = this.getSourceBlock();
      return !!b && b.type === 'bk_color';
    }
    applyColour() {
      const b = this.getSourceBlock();
      if (b && this.isWholeBlock_() && b.pathObject) b.pathObject.svgPath.setAttribute('fill', this.getConstants().FIELD_BORDER_RECT_COLOUR);
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

  // Eight bit cells, bit 7 on the left. `cells(block)` says how each looks: 'on' (a 1), 'off' (a
  // 0), 'any' (a bit of a value that isn't known here: a pale cell, no digit), 'fill'
  // (a 0 that a shift moved in), 'skip' (not used here). Shows where a shift moves bits, or which
  // bits are taken. `editable` makes the cells clickable (a
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
    // bkBitEditable: the bits themselves take clicks (blocks.css gives them the pointing hand)
    initView() { this.group_ = Blockly.utils.dom.createSvgElement('g', { class: this.EDITABLE ? 'bkBitStrip bkBitEditable' : 'bkBitStrip' }, this.fieldGroup_); }
    key_() {
      const b = this.getSourceBlock();
      return JSON.stringify([b ? this.cells_(b, this.getValue()) : [], this.arrow_ ? this.arrow_(b) : '', this.EDITABLE && this.getValue()]);
    }
    render_() {
      const g = this.group_;
      if (!g) return;
      const b = this.getSourceBlock();
      const cells = b ? this.cells_(b, this.getValue()) : new Array(8).fill('any');
      const arrow = this.arrow_ && b ? this.arrow_(b) : '';
      this.lastKey_ = this.key_();
      while (g.firstChild) g.removeChild(g.firstChild);
      // a 1's digit is the color of a 0's cell: the block's color, lightened as the cell lightens it
      const rgb = b && /^#[0-9a-f]{6}$/i.test(b.getColour()) ? b.getColour().match(/\w\w/g).map(h => parseInt(h, 16)) : null;
      if (rgb) g.style.setProperty('--bit-one', `rgb(${rgb.map(c => Math.round(c + (255 - c) * 0.22)).join(',')})`);
      const W = 10, H = 16, GAP = 2, Y = 3, el = (name, attrs) => Blockly.utils.dom.createSvgElement(name, attrs, g);
      const fill = { on: '#ffffff', any: 'rgba(255,255,255,.5)', off: 'rgba(255,255,255,.22)', fill: 'rgba(0,0,0,.25)', skip: 'rgba(255,255,255,.1)' };
      let x = 0;
      if (arrow === 'left') { el('text', { x: 0, y: Y + 12, class: 'bkBitArrow' }).textContent = '«'; x = 13; }
      cells.forEach((c, i) => {
        el('rect', { x, y: Y, width: W, height: H, rx: 2.5, fill: fill[c] || fill.off, stroke: c === 'fill' ? 'rgba(255,255,255,.45)' : 'none', 'stroke-dasharray': c === 'fill' ? '2 1.5' : '' });
        // each bit says what it is, faintly: a 1 a little darker than its cell, a 0 a little lighter;
        // a 0 a shift moved in, more clearly
        const digit = { on: ['1', 'bkBitOne'], off: ['0', 'bkBitOff'], fill: ['0', 'bkBitZero'] }[c];
        if (digit) el('text', { x: x + W / 2, y: Y + 11.5, class: digit[1] }).textContent = digit[0];
        x += W + GAP;   // a byte, eight in a row, as face values show
      });
      x -= GAP;
      if (arrow === 'right') { el('text', { x: x + 3, y: Y + 12, class: 'bkBitArrow' }).textContent = '»'; x += 13; }
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

  // A variable dropdown that marks a const variable with a "const" pill just before its name, inside
  // the box. Its menu marks local variables (and lists) with a "local" pill too, and lists them
  // first; on the block that would take too much room.
  const PILL_W = 34, PILL_H = 15, PILL_GAP = 5, CHANGE_TYPE = 'BK_CHANGE_TYPE';
  class FieldScopedVariable extends Blockly.FieldVariable {
    constructor(name, validator, types, defaultType, config) {
      super(name, validator, types, defaultType, config);
      this.menuGenerator_ = function () {
        const options = Blockly.FieldVariable.dropdownCreate.call(this);
        const ws = this.getSourceBlock() && this.getSourceBlock().workspace, map = ws && ws.getVariableMap();
        const vars = [], rest = [];
        for (const o of options) {
          const v = map && Array.isArray(o) && map.getVariableById(o[1]);
          (v ? vars : rest).push(v ? [o, v] : o);
        }
        vars.sort((x, y) => isLocalVar(y[1], ws) - isLocalVar(x[1], ws) || x[1].name.localeCompare(y[1].name));
        // a number variable can change its type: before Blockly's rename and delete
        const v = this.getVariable();
        if (v && kindOf(v.type) === 'num' && baseType(v.type) !== '') rest.unshift(['Change type…', CHANGE_TYPE]);
        return [...vars.map(([o, v]) => [varLabel(v, ws), o[1]]), ...rest];
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
      this.pillText_.textContent = 'const';
    }
    renderSelectedText() {
      super.renderSelectedText();
      if (!this.pill_) return;
      const v = this.getVariable(), fixed = !!(v && isConstType(v.type));
      // (worked out on hover: whether a list is local changes as its setup block moves)
      this.setTooltip(() => {
        const v = this.getVariable(), ws = this.getSourceBlock() && this.getSourceBlock().workspace;
        if (!v) return '';
        const local = isLocalVar(v, ws);
        if (isList(v.type)) return `${v.name}: a ${local ? 'local' : 'global'} ${isGrid(v.type) ? 'grid' : 'list'} of ${cType(itemType(v.type))}${local ? ', set up in the event or function it\'s used in' : ''}.`;
        return `${v.name}: a ${scopeWords(v.type)} ${cType(v.type)}${cType(v.type) === 'bool' ? ' (boolean)' : ''}, holding ${typeInfo(baseType(v.type))}${isConstType(v.type) ? ' that never changes' : ''}.`;
      });
      this.pill_.style.display = fixed ? '' : 'none';
      if (!fixed) return;
      const label = 'const', pillW = PILL_W;
      this.pillText_.textContent = label;
      this.pillText_.setAttribute('x', pillW / 2);
      this.pillRect_.setAttribute('width', pillW);
      // make room for the pill between the box's edge and the name
      const pad = this.borderRect_ ? this.getConstants().FIELD_BORDER_RECT_X_PADDING : 0, shift = pillW + PILL_GAP;
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
function varLabel(v, ws) {
  const el = document.createElement('span');
  el.className = 'bkMenuVar';
  el.style.cssText = 'display:inline-flex;align-items:center;gap:6px';
  const local = isLocalVar(v, ws);
  if (local || isConstType(v.type)) {
    const pill = document.createElement('span');
    pill.textContent = [local ? 'local' : '', isConstType(v.type) ? 'const' : ''].filter(Boolean).join(' ');
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
  el.setAttribute('aria-label', `${v.name}, ${scopeWords(v.type)} ${cType(v.type)}`);
  return el;
}

// Right-click a block that uses a variable (or list) to rename it, change its type or delete it, the
// same as in its dropdown
function registerVariableMenu(Blockly) {
  const R = Blockly.ContextMenuRegistry.registry;
  const workspaceOf = b => (b.workspace.isFlyout ? b.workspace.targetWorkspace : b.workspace);
  const varOf = scope => {
    const b = scope.block;
    for (const name of ['VAR', 'LIST', 'TIMER']) {
      const f = b && b.getField(name);
      const v = f && f.getVariable && f.getVariable();
      if (v && v.type !== 'face' && v.type !== '') return v;
    }
    return null;
  };
  // Used from a block in a drawer, the dialog takes the focus and Blockly closes the drawer: it opens
  // again once the dialog is done, so you're back where you were
  let drawer = null;   // the toolbox category open when the menu came up
  const backToDrawer = ws => {
    const tb = ws.getToolbox && ws.getToolbox(), category = drawer;
    if (!tb || !category) return;
    setTimeout(() => {
      const host = ws.getInjectionDiv().parentElement;
      const dialog = host.querySelector('.bk-dialog');
      const reopen = () => { if (!tb.getFlyout().isVisible()) tb.setSelectedItem(category); else tb.refreshSelection(); };
      if (!dialog) { reopen(); return; }
      const watch = new MutationObserver(() => { if (!dialog.isConnected) { watch.disconnect(); reopen(); } });
      watch.observe(host, { childList: true });
    }, 0);
  };
  const item = (id, weight, text, show, act) => {
    if (R.getItem(id)) return;
    R.register({
      id, weight, scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
      displayText: scope => text(varOf(scope)),
      preconditionFn: scope => {
        if (!varOf(scope) || !show(varOf(scope))) return 'hidden';
        const tb = scope.block.workspace.isFlyout && workspaceOf(scope.block).getToolbox();
        drawer = (tb && tb.getSelectedItem()) || null;
        return 'enabled';
      },
      callback: scope => {
        const ws = workspaceOf(scope.block), fromDrawer = scope.block.workspace.isFlyout;
        act(ws, varOf(scope));
        if (fromDrawer) backToDrawer(ws);
      },
    });
  };
  item('bk_var_rename', 10, v => `Rename “${v.name}”…`, () => true, (ws, v) => Blockly.Variables.renameVariable(ws, v));
  item('bk_var_type', 11, v => `Change the type of “${v.name}”…`, v => kindOf(v.type) === 'num', (ws, v) => changeVariableType(Blockly, ws, v));
  item('bk_var_delete', 12, v => `Delete “${v.name}”…`, () => true, (ws, v) => ws.deleteVariableById(v.getId()));
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
  const sync = () => { hint.textContent = `${aType(form.elements.numtype.value)} holds ${typeInfo(form.elements.numtype.value)}.`; };
  sync();
  form.addEventListener('change', sync);
  const stop = typeExamples(form, () => form.elements.numtype.value);
  const close = () => { stop(); wrap.remove(); };
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.dataset.act === 'cancel') close(); });
  wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const type = withTagsOf(form.elements.numtype.value, v.type);
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
    // as wide as its widest value, so it holds still while they change; a note wraps under the
    // number, and the tooltip grows taller (upward, above the choice) while one shows
    tip.hidden = false;
    tip.style.width = '';
    const widest = Math.max(measure(label, label.textContent), ...frames.map(f => measure(value, f[0]) + (f[2] ? 18 : 0)));
    tip.style.width = Math.max(110, Math.ceil(widest + 24)) + 'px';
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
    `<label><input type="radio" name="numtype" value="${t}"${t === selected ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>`;
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
  // a timer, or a list of timers (then an "item" slot appears after it: see bk_timer_item)
  const timerField = { type: 'field_scoped_variable', name: 'TIMER', variable: 'myTimer', variableTypes: ['Timer', TIMER_LIST], defaultType: 'Timer' };
  const timerAt = { type: 'input_dummy', name: 'T' };
  const timerItem = { mutator: 'bk_timer_item' };
  const faceField = { type: 'field_variable', name: 'VAR', variable: 'f', variableTypes: ['face'], defaultType: 'face' };
  const varField = (kind, consts = true) => ({
    type: 'field_scoped_variable', name: 'VAR', variable: null,
    variableTypes: [...KIND_TYPES[kind], ...LOCAL_TYPES[kind], ...(consts ? [...CONST_TYPES[kind], ...LOCAL_CONST_TYPES[kind]] : [])],
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
    { type: 'bk_timer_set', message0: 'set timer %1 %2 to %3 ms', args0: [timerField, timerAt, val('MS', N)], ...stmt, style: 'bk_time', ...timerItem,
      tooltip: 'Start the timer: it finishes after this many milliseconds (1000 = one second).', inputsInline: true },
    { type: 'bk_timer_add', message0: 'add %1 ms to timer %2 %3', args0: [val('MS', N), timerField, timerAt], ...stmt, style: 'bk_time', ...timerItem,
      tooltip: 'Make the timer run longer.', inputsInline: true },
    { type: 'bk_timer_never', message0: 'stop timer %1 %2', args0: [timerField, timerAt], ...stmt, style: 'bk_time', ...timerItem,
      tooltip: 'Stop the timer so it never finishes.', inputsInline: true },
    { type: 'bk_timer_done', message0: 'timer %1 %2 done?', args0: [timerField, timerAt], output: B, style: 'bk_time', ...timerItem,
      tooltip: 'True when the timer has finished.', inputsInline: true },
    { type: 'bk_timer_left', message0: 'time left on timer %1 %2', args0: [timerField, timerAt], output: N, style: 'bk_time', ...timerItem,
      tooltip: 'Milliseconds until the timer finishes.', inputsInline: true },

    // Control
    { type: 'bk_for_each_face', message0: 'for each face %1', args0: [faceField], message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }],
      ...stmt, style: 'bk_control',
      tooltip: 'Run the blocks inside once for each face, 0 to 5.' },
    { type: 'bk_face_var', message0: '%1', args0: [faceField], output: N, style: 'bk_control', extensions: ['bk_face_warning'],
      tooltip: 'The face number of the "for each face" loop around this block.' },
    // a C for loop: count a variable from one number up or down to another
    { type: 'bk_for', message0: 'count %1 from %2 %3 %4 by %5', args0: [varField('num', false), val('FROM', N),
      { type: 'field_dropdown', name: 'DIR', options: FOR_DIRECTIONS.map(([label, op]) => [label, op]) }, val('TO', N), val('BY', N)],
      message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }], ...stmt, inputsInline: true, style: 'bk_control',
      tooltip: 'A for loop: run the blocks inside once for each number. The variable starts at the first number and steps by the last one; "up to" stops before the end number, "up through" includes it. In C: for (int i = 0; i < 6; i++) { … }' },
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
    { type: 'bk_change', message0: 'change %1 by %2', args0: [varField('num', false), val('DELTA', N)], ...stmt, inputsInline: true,
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
  const listField = types => ({ type: 'field_scoped_variable', name: 'LIST', variable: null, variableTypes: types, defaultType: types[0] });
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
    { type: 'bk_list_length', message0: 'length of %1', args0: [listField([...ALL_LIST_TYPES, TIMER_LIST])], output: N, style: 'bk_lists',
      extensions: ['bk_given_list_warning'], tooltip: 'How many items the list holds.' },
    // a whole list or grid, to give to a function (its check follows the list chosen; it has none
    // until then, so it plugs in wherever it's loaded or pasted)
    { type: 'bk_list_pass', message0: 'all of %1', args0: [listField([...ALL_LIST_TYPES, ...ALL_GRID_TYPES])], output: null, style: 'bk_lists',
      extensions: ['bk_list_pass'], tooltip: 'A whole list or grid, to give to a function that takes one.' },
  );
  // Grids (2D arrays): rows of items. Item 0 of row 0 is the first.
  for (const kind of ['num', 'bool', 'color']) {
    const what = { num: 'number', bool: 'true/false', color: 'color' }[kind];
    defs.push(
      { type: 'bk_grid_get_' + kind, message0: 'item %1 of row %2 of %3', args0: [val('INDEX', N), val('ROW', N), listField(GRID_TYPES[kind])],
        output: KIND_CHECK[kind], inputsInline: true, style: 'bk_lists', tooltip: `The ${what} at this place in the grid. Rows and items count from 0.` },
      { type: 'bk_grid_set_' + kind, message0: 'set item %1 of row %2 of %3 to %4', args0: [val('INDEX', N), val('ROW', N), listField(GRID_TYPES[kind]), val('VALUE', KIND_CHECK[kind])],
        ...stmt, inputsInline: true, style: 'bk_lists', tooltip: `Put a ${what} at this place in the grid. Rows and items count from 0.` },
    );
  }
  defs.push(
    { type: 'bk_grid_change', message0: 'change item %1 of row %2 of %3 by %4', args0: [val('INDEX', N), val('ROW', N), listField(GRID_TYPES.num), val('DELTA', N)],
      ...stmt, inputsInline: true, style: 'bk_lists', tooltip: 'Add to the number at this place in the grid (use a negative number to subtract).' },
    { type: 'bk_grid_size', message0: 'number of %1 in %2', args0: [{ type: 'field_dropdown', name: 'WHAT', options: [['rows', 'ROWS'], ['items in a row', 'COLS']] },
      listField(ALL_GRID_TYPES)], output: N, style: 'bk_lists', extensions: ['bk_given_list_warning'], tooltip: 'How many rows the grid has, or how many items are in each row.' },

    // Datagrams: a packet of up to 16 bytes sent once to one neighbor
    // a list of bytes, or a row of a grid of bytes (then a "row" slot appears: see bk_dg_row)
    { type: 'bk_dg_send', message0: 'send list %1 %2 as a datagram on face %3', args0: [
      { type: 'field_scoped_variable', name: 'LIST', variable: 'message', variableTypes: [...BYTE_LIST_TYPES, ...BYTE_GRID_TYPES], defaultType: 'byte[]' },
      { type: 'input_dummy', name: 'T' }, val('FACE', N)],
      ...stmt, inputsInline: true, style: 'bk_neighbors', mutator: 'bk_dg_row',
      tooltip: 'Send the whole list (bytes, up to 16 of them), or one row of a grid, once to the neighbor on this face. It arrives as a datagram.' },
    { type: 'bk_dg_item', message0: 'item %1 of datagram on face %2', args0: [val('INDEX', N), val('FACE', N)], output: N, inputsInline: true,
      style: 'bk_neighbors', tooltip: 'One byte of the datagram waiting on this face. The first is item 0.' },
  );

  registerExtensions(Blockly);
  for (const d of defs) delete Blockly.Blocks[d.type];
  Blockly.common.defineBlocksWithJsonArray(defs);
  // an enum name says which number it stands for
  const enumValue = Blockly.Blocks.bk_enum_value, enumInit = enumValue.init;
  enumValue.init = function () {
    enumInit.call(this);
    const about = this.tooltip;
    this.setTooltip(() => [enumMeaning(this.workspace, this.getFieldValue('NAME')), about].filter(Boolean).join(' '));
  };
  defineCodeBlocks(Blockly);
  defineListBlocks(Blockly);
  defineSwitchAndEnum(Blockly);
  defineTrashedComment(Blockly);
  defineBitBlocks(Blockly);
  defineSetBlock(Blockly);
  defineConstBlock(Blockly);
  defineIfBlock(Blockly);
  defineFunctionInputs(Blockly);
  defineReturnTypes(Blockly);
  defineCollapsedText(Blockly);
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
  // a thin line between an enum's name and its names
  class FieldDivider extends Blockly.Field {
    constructor() { super(''); this.EDITABLE = false; this.SERIALIZABLE = false; }
    initView() { Blockly.utils.dom.createSvgElement('rect', { class: 'bkDivider', x: 5, y: 3, width: 1.5, height: 18, rx: 0.75 }, this.fieldGroup_); }
    updateSize_() { this.size_ = new Blockly.utils.Size(12, 24); }
  }
  // the names of an enum go in a row, or one per line
  const layoutIcon = column => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="9" fill="rgba(255,255,255,.22)"/>' +
    // the button shows the other layout: lines stacked in a column, or standing side by side in a row
    (column ? '<path d="M6.5 7v6M10 7v6M13.5 7v6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>'
      : '<path d="M7 6.5h6M7 10h6M7 13.5h6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>') + '</svg>');

  Blockly.Blocks.bk_enum = {
    init() {
      this.items_ = 3;
      this.column_ = false;
      this.appendDummyInput('HEAD').appendField('enum').appendField(new Blockly.FieldTextInput('mode', v => cName(v, '').replace(/^$/, '')), 'NAME')
        .appendField(new FieldDivider(), 'DIVIDER');
      buttons(this, 'name', () => this.resize_(-1), () => this.resize_(1));
      // the layout button sits in the block's bottom right corner
      this.appendDummyInput('LAYOUT_IN').setAlign(Blockly.inputs.Align.RIGHT)
        .appendField(new Blockly.FieldImage(layoutIcon(false), 18, 18, 'show the names in a column', () => this.toggleLayout_()), 'LAYOUT');
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
    saveExtraState() { return this.column_ ? { items: this.items_, column: true } : { items: this.items_ }; },
    loadExtraState(state) {
      this.items_ = Math.max(1, Math.min(32, Number(state && state.items) || 1));
      this.setColumn_(!!(state && state.column));
      this.updateShape_();
    },
    toggleLayout_() {
      if (this.isInFlyout) return;
      const before = JSON.stringify(this.saveExtraState());
      // (what sits below moves with the block's new height: keepSpacing does that for any change of shape)
      Blockly.Events.setGroup(true);
      try {
        this.setColumn_(!this.column_);
        fire(this, before);
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
    // in a column, the heading and each name end their line; the names keep their text
    setColumn_(column) {
      if (column === this.column_) return;
      const names = [];
      for (let i = 0; this.getInput('ITEM' + i); i++) { names.push(this.getFieldValue('ITEM' + i)); this.removeInput('ITEM' + i); }
      this.column_ = column;
      if (column) { this.appendEndRowInput('HEAD_END'); this.moveInputBefore('HEAD_END', 'TAIL'); } else if (this.getInput('HEAD_END')) this.removeInput('HEAD_END');
      this.getField('DIVIDER').setVisible(!column);
      const layout = this.getField('LAYOUT');
      layout.setValue(layoutIcon(column));
      layout.setTooltip(column ? 'show the names in a row' : 'show the names in a column');
      this.updateShape_();
      names.forEach((n, i) => { if (this.getField('ITEM' + i) && n) this.setFieldValue(n, 'ITEM' + i); });
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
        f.setTooltip(() => enumMeaning(this.workspace, f.getValue()) || this.tooltip);
        (this.column_ ? this.appendEndRowInput('ITEM' + i) : this.appendDummyInput('ITEM' + i)).appendField(f, 'ITEM' + i);
        this.moveInputBefore('ITEM' + i, 'TAIL');
      }
    },
  };
}

// "READY stands for 0 (in the enum mode)." for a name made by an enum block, or null. Names with
// nothing typed are left out of the C enum, so they don't take a number.
function enumMeaning(ws, name) {
  if (!ws || !name) return null;
  for (const b of ws.getAllBlocks(false)) {
    if (b.type !== 'bk_enum' || !b.isEnabled()) continue;
    const i = b.itemNames_().indexOf(name);
    if (i < 0) continue;
    const of = b.getFieldValue('NAME');
    return `${name} stands for ${i}${of ? ` (in the enum ${of})` : ''}.`;
  }
  return null;
}

// A comment from the workspace that was thrown away: it waits in the trash as this block (a drawer only
// holds blocks), showing its first lines; dragged back out, it turns into the comment again (see
// trashDrawer). It makes no code.
function defineTrashedComment(Blockly) {
  Blockly.Blocks.bk_trashed_comment = {
    init() {
      this.comment_ = { text: '' };
      this.setColour('#4a4060');
      this.setTooltip('A comment in the trash. Drag it out to put it back.');
      this.updateShape_();
    },
    saveExtraState() { return { comment: this.comment_ }; },
    loadExtraState(state) { this.comment_ = (state && state.comment) || { text: '' }; this.updateShape_(); },
    updateShape_() {
      for (let i = 0; this.getInput('L' + i); i++) this.removeInput('L' + i);
      if (this.getInput('HEAD')) this.removeInput('HEAD');
      this.appendDummyInput('HEAD').appendField('comment');
      const lines = String(this.comment_.text || '').split('\n').filter(l => l.trim());
      const shown = lines.slice(0, 4).map(l => (l.length > 40 ? l.slice(0, 40) + '…' : l));
      if (lines.length > 4) shown[3] += '  …';
      shown.forEach((l, i) => this.appendDummyInput('L' + i).appendField(l, 'T' + i));
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
          [...KIND_TYPES.num, ...LOCAL_TYPES.num, ...KIND_TYPES.bool, ...LOCAL_TYPES.bool, ...KIND_TYPES.color, ...LOCAL_TYPES.color,
            ...LOCAL_CONST_TYPES.num, ...LOCAL_CONST_TYPES.bool, ...LOCAL_CONST_TYPES.color], 'int'), 'VAR')
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

// A global const variable gets the value it always has from this block, "set MAX to 5", which makes
// const byte MAX = 5;
function defineConstBlock(Blockly) {
  Blockly.Blocks.bk_const = {
    init() {
      this.kind_ = null;
      // it reads like setting any variable: the "const" pill on the variable says the rest
      this.appendValueInput('VALUE')
        .appendField('set')
        .appendField(new defineFields.FieldScopedVariable(null, id => { this.fit_(id); return id; }, ALL_CONST_TYPES, constType('int')), 'VAR')
        .appendField('to');
      this.setInputsInline(true);
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setStyle('bk_variables');
      this.setTooltip('Give a const variable the value it always has. It\'s set once, before the game starts, and can\'t be changed while it runs.');
    },
    // its value slot follows the kind of variable, like the set block's
    fit_: Blockly.Blocks.bk_set.fit_,
  };
}

// A change to a block's shape, as a step to undo (Blockly's own events say no state as '')
function fireMutation(Blockly, block, before) {
  const state = block.saveExtraState();
  Blockly.Events.fire(new (Blockly.Events.get(Blockly.Events.BLOCK_CHANGE))(block, 'mutation', null, before, state ? JSON.stringify(state) : ''));
}
const stateOf = block => { const state = block.saveExtraState(); return state ? JSON.stringify(state) : ''; };
// Take a block out of an input, to be moved beside the block it was in once that has its new shape
function setAside(block, aside) {
  if (!block || block.isShadow()) return;
  block.unplug();
  aside.push(block);
}
function moveAside(Blockly, owner, aside) {
  if (!aside.length || !owner.rendered) return;
  if (Blockly.renderManagement && Blockly.renderManagement.triggerQueuedRenders) Blockly.renderManagement.triggerQueuedRenders(owner.workspace);
  const box = owner.getRootBlock().getBoundingRectangle();
  let y = -Infinity;
  for (const b of aside) {
    y = Math.max(y, b.getRelativeToSurfaceXY().y);
    b.moveTo(new Blockly.utils.Coordinate(box.right + 32, y));
    y += b.getHeightWidth().height + 16;
  }
}

// Collapsed, a define or a const shows all of itself (not cut short with …), and an enum lists its
// names with commas
function defineCollapsedText(Blockly) {
  const whole = function (maxLength, emptyToken) { return Blockly.Block.prototype.toString.call(this, undefined, emptyToken); };
  Blockly.Blocks.bk_define.toString = whole;
  Blockly.Blocks.bk_const.toString = whole;
  Blockly.Blocks.bk_enum.toString = function () {
    const names = [];
    for (let i = 0; this.getInput('ITEM' + i); i++) names.push(this.getFieldValue('ITEM' + i));
    const name = this.getFieldValue('NAME');
    return `enum ${name ? name + ': ' : ''}${names.join(', ')}`;
  };
}

// Right-click the canvas to fold every variable block down to its name, and to open them again, in
// one step to undo. The names an enum or define makes, and true/false, fold with them: they look and
// read alike.
const FOLDING_VARS = new Set([...Object.values(GETTER), 'bk_face_var', 'bk_enum_value', 'bk_define_value', 'bk_bool']);
function registerCollapseMenu(Blockly) {
  const R = Blockly.ContextMenuRegistry.registry;
  if (R.getItem('bk_collapse_vars')) return;
  const blocks = ws => ws.getAllBlocks(false).filter(b => FOLDING_VARS.has(b.type));
  R.register({
    id: 'bk_collapse_vars', weight: 5.1, scopeType: Blockly.ContextMenuRegistry.ScopeType.WORKSPACE,
    displayText: scope => `${blocks(scope.workspace).some(b => !b.isCollapsed()) ? 'Collapse' : 'Expand'} variables`,
    preconditionFn: scope => (scope.workspace && !scope.workspace.isFlyout && blocks(scope.workspace).length ? 'enabled' : 'hidden'),
    callback: scope => {
      const list = blocks(scope.workspace), fold = list.some(b => !b.isCollapsed());
      Blockly.Events.setGroup(true);
      try { for (const b of list) b.setCollapsed(fold); } finally { Blockly.Events.setGroup(false); }
    },
  });
}

// if: a + along the bottom adds an "else if" or the "else", and a − on each takes it away
// (instead of Blockly's gear). The blocks in a part that's taken away are set aside.
function defineIfBlock(Blockly) {
  const button = (sign, tip, onClick) => new Blockly.FieldImage(PLUS_MINUS(sign), 18, 18, tip, onClick);
  const mixin = {
    elseifCount_: 0,
    elseCount_: 0,
    saveExtraState() {
      if (!this.elseifCount_ && !this.elseCount_) return null;
      const state = {};
      if (this.elseifCount_) state.elseIfCount = this.elseifCount_;
      if (this.elseCount_) state.hasElse = true;
      return state;
    },
    loadExtraState(state) {
      this.elseifCount_ = Math.max(0, Number(state && state.elseIfCount) || 0);
      this.elseCount_ = state && state.hasElse ? 1 : 0;
      this.updateShape_();
    },
    // the blocks already in its parts stay where they are
    updateShape_() {
      for (let i = this.elseifCount_ + 1; this.getInput('IF' + i); i++) { this.removeInput('IF' + i); this.removeInput('DO' + i); }
      if (!this.elseCount_) this.removeInput('ELSE', true);
      this.removeInput('TAIL', true);
      for (let i = 1; i <= this.elseifCount_; i++) {
        if (this.getInput('IF' + i)) continue;
        this.appendValueInput('IF' + i).setCheck('Boolean')
          .appendField(Blockly.Msg.CONTROLS_IF_MSG_ELSEIF)
          .appendField(button('-', 'take away this "else if"', () => this.removeElseIf_(i)));
        this.appendStatementInput('DO' + i).appendField(Blockly.Msg.CONTROLS_IF_MSG_THEN);
        if (this.getInput('ELSE')) { this.moveInputBefore('IF' + i, 'ELSE'); this.moveInputBefore('DO' + i, 'ELSE'); }
      }
      if (this.elseCount_ && !this.getInput('ELSE')) {
        this.appendStatementInput('ELSE').appendField(Blockly.Msg.CONTROLS_IF_MSG_ELSE)
          .appendField(button('-', 'take away the "else"', () => this.change_(aside => {
            setAside(this.getInputTargetBlock('ELSE'), aside);
            this.elseCount_ = 0;
          })));
      }
      this.appendDummyInput('TAIL').appendField(button('+', this.elseCount_
        ? 'add an "else if": another test, tried when the ones above are false'
        : 'add an "else if" (another test) or an "else" (blocks to run when every test is false)', () => this.chooseArm_()), 'ADD');
    },
    // + asks whether to add an "else if" or the "else"; once there's an "else", it just adds an "else if"
    chooseArm_() {
      if (this.isInFlyout || !this.isEditable()) return;
      const addElseIf = () => this.change_(() => { this.elseifCount_++; });
      if (this.elseCount_) return addElseIf();
      const r = this.getField('ADD').getSvgRoot().getBoundingClientRect();
      Blockly.ContextMenu.show(new PointerEvent('pointerdown', { clientX: r.left, clientY: r.bottom + 4 }), [
        { text: Blockly.Msg.CONTROLS_IF_MSG_ELSEIF, enabled: true, callback: addElseIf },
        { text: Blockly.Msg.CONTROLS_IF_MSG_ELSE, enabled: true, callback: () => this.change_(() => { this.elseCount_ = 1; }) },
      ], this.RTL, this.workspace);
    },
    // the parts below a removed "else if" move up into its place
    removeElseIf_(i) {
      this.change_(aside => {
        setAside(this.getInputTargetBlock('IF' + i), aside);
        setAside(this.getInputTargetBlock('DO' + i), aside);
        for (let j = i; j < this.elseifCount_; j++) {
          for (const [name, connection] of [['IF', 'outputConnection'], ['DO', 'previousConnection']]) {
            const child = this.getInputTargetBlock(name + (j + 1));
            if (!child) continue;
            child.unplug();
            this.getInput(name + j).connection.connect(child[connection]);
          }
        }
        this.elseifCount_--;
      });
    },
    change_(apply) {
      if (this.isInFlyout || !this.isEditable()) return;
      const before = stateOf(this), aside = [];
      Blockly.Events.setGroup(true);
      try {
        apply(aside);
        this.updateShape_();
        fireMutation(Blockly, this, before);
        moveAside(Blockly, this, aside);
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
  };
  Blockly.Extensions.unregister('controls_if_mutator');
  Blockly.Extensions.registerMutator('controls_if_mutator', mixin, function () { this.updateShape_(); });
}

// The kinds of input a function can have (Blockly variable types: '' is a number), and names for new
// ones. A list or grid then asks what it holds.
const INPUT_KINDS = [['number', ''], ['true/false', 'bool'], ['color', 'Color'], ['list…', '[]'], ['grid…', '[][]']];
const INPUT_ITEMS = [['numbers', 'int'], ['true/false', 'bool'], ['colors', 'Color']];
const INPUT_NAMES = { num: ['x', 'y', 'z', 'a', 'b', 'c', 'n', 'm'], bool: ['on', 'yes', 'flag'], color: ['color', 'tint', 'shade'],
  list: ['list', 'values', 'items'], grid: ['grid', 'cells', 'board'] };

// A function's inputs are edited on its define block (instead of in Blockly's gear): + adds one, and
// each name can be typed over, with a − on its corner while it's being edited to take it away. Its
// calls follow along, keeping the blocks plugged into the inputs that stay.
function defineFunctionInputs(Blockly) {
  const C_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const button = (sign, tip, onClick) => new Blockly.FieldImage(PLUS_MINUS(sign), 18, 18, tip, onClick);
  class FieldInputName extends Blockly.FieldTextInput {
    constructor(value, index) {
      super(value, text => text.replace(/[^A-Za-z0-9_]/g, '') || null);
      this.SERIALIZABLE = false;
      this.index_ = index;
      this.setSpellcheck(false);
    }
    showEditor_(e, quiet) {
      super.showEditor_(e, quiet);
      const block = this.getSourceBlock();
      if (!block || block.isInFlyout || !block.isEditable()) return;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'bkInputRemove';
      remove.title = 'Take away this input';
      remove.setAttribute('aria-label', 'Take away this input');
      // (on press, before the name's text box loses focus and closes)
      remove.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const i = this.index_;
        Blockly.WidgetDiv.hide();
        block.removeInput_(i);
      });
      Blockly.WidgetDiv.getDiv().appendChild(remove);
    }
    onFinishEditing_(value) {
      const block = this.getSourceBlock();
      if (block && !renameInput(block, this.index_, value)) this.setValue(block.arguments_[this.index_], false);
      // the rename is the step to undo, not this field
      this.valueWhenEditorWasOpened_ = this.getValue();
    }
  }
  const callers = def => Blockly.Procedures.getCallers(def.getFieldValue('NAME'), def.workspace);
  // The numbers in a call's inputs are shadow blocks, which Blockly doesn't undo: this event puts
  // them back. Each change is { block, input, before, after } (shadow states, or null for none),
  // with { beforeCheck, afterCheck } when the slot's shape changes too.
  class CallNumbers extends Blockly.Events.Abstract {
    constructor(ws, changes) {
      super();
      this.type = 'bk_call_numbers';
      this.isBlank = !ws;
      if (ws) this.workspaceId = ws.id;
      this.changes = changes || [];
    }
    isNull() { return !this.changes.length; }
    toJson() { return { ...super.toJson(), changes: this.changes }; }
    static fromJson(json, ws, event) {
      const e = super.fromJson(json, ws, event ?? new CallNumbers());
      e.changes = json.changes || [];
      return e;
    }
    run(forward) { apply(this.getEventWorkspace_(), this.changes, forward); }
  }
  Blockly.registry.register(Blockly.registry.Type.EVENT, 'bk_call_numbers', CallNumbers, true);
  function apply(ws, changes, forward = true) {
    for (const c of changes) {
      const input = ws.getBlockById(c.block)?.getInput(c.input);
      if (!input) continue;
      if ('afterCheck' in c) {
        input.connection.setShadowState(null);
        input.connection.setCheck(forward ? c.afterCheck : c.beforeCheck);
      }
      input.connection.setShadowState(forward ? c.after : c.before);
    }
  }
  const numbers = (ws, changes) => {
    apply(ws, changes);
    Blockly.Events.fire(new CallNumbers(ws, changes));
  };
  // a shadow's state, to be made again somewhere else (so without its id)
  const shadowOf = connection => {
    const strip = state => {
      if (!state) return null;
      delete state.id;
      for (const slot of Object.values(state.inputs || {})) { strip(slot.shadow); strip(slot.block); }
      if (state.next) { strip(state.next.shadow); strip(state.next.block); }
      return state;
    };
    return strip(connection.getShadowState(true));
  };
  // blocks in the function (but not in its calls) that use a variable
  const usesOutside = (def, variable) => def.workspace.getAllBlocks(false).some(b => b.getRootBlock() !== def
    && !b.type.startsWith('procedures_call') && b.getVarModels().some(m => m.getId() === variable.getId()));

  function renameInput(def, i, name) {
    const ws = def.workspace, map = ws.getVariableMap(), old = def.argumentVarModels_[i];
    if (!old || def.isInFlyout) return false;
    if (name === old.getName()) return true;
    if (!C_NAME.test(name) || def.arguments_.some((n, j) => j !== i && n === name)) return false;
    const taken = map.getAllVariables().find(v => v.getName() === name);
    // a name another kind of variable has would stand for two things in the C code
    if (taken && taken.getType() !== old.getType()) return false;
    Blockly.Events.setGroup(true);
    try {
      if (!taken && !usesOutside(def, old)) {
        // only this function has it: rename it, and the blocks inside that use it follow
        map.renameVariable(old, name);
      } else {
        // another function's input (or a variable outside) has the name: this function uses its own
        const before = stateOf(def);
        const next = taken || map.createVariable(name, old.getType());
        for (const b of def.getDescendants(false)) {
          if (b === def) continue;
          for (const input of b.inputList) for (const f of input.fieldRow) {
            if (typeof f.getVariable === 'function' && f.getValue() === old.getId()) f.setValue(next.getId());
          }
        }
        def.argumentVarModels_[i] = next;
        def.arguments_[i] = name;
        def.updateParams_();
        Blockly.Procedures.mutateCallers(def);
        fireMutation(Blockly, def, before);
      }
    } finally {
      Blockly.Events.setGroup(false);
    }
    return true;
  }

  const common = {
    // a C type the blocks can't show is kept by name (see procInfo), so it follows a rename
    keepTypes_() {
      const ids = this.argumentVarModels_.map(m => m.getId());
      const was = this.bkInputs_ || [];
      const info = procInfo(this);
      let changed = false;
      ids.forEach((id, i) => {
        const before = was.find(w => w.id === id), name = this.arguments_[i];
        if (!before || before.name === name) return;
        // (a number's C type, and a grid's row size)
        for (const kept of [info.params, info.cols]) {
          if (kept && kept[before.name] != null && kept[name] == null) {
            kept[name] = kept[before.name];
            delete kept[before.name];
            changed = true;
          }
        }
      });
      if (changed) this.data = JSON.stringify(info);
      this.bkInputs_ = ids.map((id, i) => ({ id, name: this.arguments_[i] }));
    },
    updateParams_() {
      this.keepTypes_();
      const row = this.getField('NAME').getParentInput();
      const n = this.arguments_.length;
      // a list or grid input says so before its name
      const kinds = this.argumentVarModels_.map(m => (isGrid(m.type) ? 'grid' : isList(m.type) ? 'list' : ''));
      Blockly.Events.disable();
      try {
        this.setFieldValue(n ? Blockly.Msg.PROCEDURES_BEFORE_PARAMS : '', 'PARAMS');
        if (this.bkKinds_ === kinds.join() && this.getField('ADD') && this.getField('ARG' + (n - 1)) !== null && !this.getField('ARG' + n)) {
          this.arguments_.forEach((name, j) => { if (this.getFieldValue('ARG' + j) !== name) this.setFieldValue(name, 'ARG' + j); });
          return;
        }
        for (let j = 0; this.getField('ARG' + j); j++) { row.removeField('KIND' + j, true); row.removeField('ARG' + j); }
        row.removeField('ADD', true);
        this.arguments_.forEach((name, j) => {
          if (kinds[j]) row.appendField(new Blockly.FieldLabel(kinds[j], 'bkInputKind'), 'KIND' + j);
          row.appendField(new FieldInputName(name, j), 'ARG' + j);
        });
        row.appendField(button('+', 'add an input: something the function is given each time it\'s used', () => this.chooseInput_()), 'ADD');
        this.bkKinds_ = kinds.join();
      } finally {
        Blockly.Events.enable();
      }
    },
    // + asks what kind of input to add, and for a list or grid, then what it holds
    chooseInput_() {
      if (this.isInFlyout || !this.isEditable()) return;
      const r = this.getField('ADD').getSvgRoot().getBoundingClientRect();
      const menu = options => Blockly.ContextMenu.show(new PointerEvent('pointerdown', { clientX: r.left, clientY: r.bottom + 4 }),
        options.map(([text, callback]) => ({ text, enabled: true, callback })), this.RTL, this.workspace);
      menu(INPUT_KINDS.map(([text, type]) => [text, () => {
        if (!type.startsWith('[')) return this.addInput_(type);
        // (once the first menu has closed)
        setTimeout(() => menu(INPUT_ITEMS.map(([what, item]) => [`${type === '[]' ? 'list' : 'grid'} of ${what}`, () => this.addInput_(item + type)])), 0);
      }]));
    },
    addInput_(type = '') {
      if (this.isInFlyout || !this.isEditable()) return;
      const ws = this.workspace;
      const used = new Set([...ws.getVariableMap().getAllVariables().map(v => v.getName()), ...Object.keys(procInfo(this).params)]);
      const names = INPUT_NAMES[isGrid(type) ? 'grid' : isList(type) ? 'list' : kindOf(type)];
      const name = names.find(c => !used.has(c)) || (() => { let k = 2; while (used.has(names[0] + k)) k++; return names[0] + k; })();
      const before = stateOf(this);
      Blockly.Events.setGroup(true);
      try {
        const variable = Blockly.Variables.getOrCreateVariablePackage(ws, null, name, type);
        this.arguments_.push(name);
        this.argumentVarModels_.push(variable);
        this.updateParams_();
        Blockly.Procedures.mutateCallers(this);
        fireMutation(Blockly, this, before);
        // each call gets a 0 to change, for a number
        const slot = 'ARG' + (this.arguments_.length - 1);
        if (type === '') numbers(ws, callers(this).filter(call => call.getInput(slot) && !call.getInputTargetBlock(slot))
          .map(call => ({ block: call.id, input: slot, before: null, after: numBlock(0) })));
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
    // what's plugged into the later inputs of each call (blocks, and the numbers under them) moves
    // up into their places. If blocks in the function use the input, it asks first.
    removeInput_(i, sure = false) {
      if (this.isInFlyout || !this.isEditable()) return;
      const variable = this.argumentVarModels_[i];
      const uses = !variable ? 0 : this.getDescendants(false).filter(b => b !== this
        && b.inputList.some(input => input.fieldRow.some(f => typeof f.getVariable === 'function' && f.getValue() === variable.getId()))).length;
      if (uses && !sure) {
        const name = this.arguments_[i], fn = this.getFieldValue('NAME');
        openAsk(`"${name}" is used by ${uses === 1 ? 'a block' : uses + ' blocks'} in ${fn}. Take the input away anyway? `
          + `${uses === 1 ? 'That block stays' : 'Those blocks stay'}, but "${name}" won't be given to ${fn} any more.`,
          null, ok => { if (ok) this.removeInput_(i, true); }, { ok: 'Take away', danger: true });
        return;
      }
      const before = stateOf(this), calls = callers(this), aside = calls.map(() => []), shifts = [], moves = [];
      // (each later slot takes the shape of the input after it, since inputs can be of different kinds)
      const checks = this.argumentVarModels_.map(m => inputCheck(m.type));
      Blockly.Events.setGroup(true);
      try {
        calls.forEach((call, k) => {
          setAside(call.getInputTargetBlock('ARG' + i), aside[k]);
          const slots = [];
          for (let j = i; call.getInput('ARG' + j); j++) slots.push(call.getInput('ARG' + j).connection);
          // the blocks come out first, so the slots can change shape
          const reals = slots.map(c => {
            const b = c.targetBlock();
            if (!b || b.isShadow()) return null;
            b.unplug();
            return b;
          });
          const states = slots.map(shadowOf);
          slots.forEach((_, j) => {
            const after = states[j + 1] ?? null;
            const beforeCheck = checks[i + j] ?? null, afterCheck = j + 1 < slots.length ? checks[i + j + 1] ?? null : beforeCheck;
            if (JSON.stringify(after) !== JSON.stringify(states[j]) || beforeCheck !== afterCheck) {
              shifts.push({ block: call.id, input: 'ARG' + (i + j), before: states[j], after, beforeCheck, afterCheck });
            }
          });
          moves.push([slots, reals]);
        });
        numbers(this.workspace, shifts);
        for (const [slots, reals] of moves) for (let j = 1; j < slots.length; j++) if (reals[j]) slots[j - 1].connect(reals[j].outputConnection);
        this.arguments_.splice(i, 1);
        this.argumentVarModels_.splice(i, 1);
        this.updateParams_();
        Blockly.Procedures.mutateCallers(this);
        fireMutation(Blockly, this, before);
        calls.forEach((call, k) => moveAside(Blockly, call, aside[k]));
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
  };
  for (const type of ['procedures_defnoreturn', 'procedures_defreturn']) {
    const def = Blockly.Blocks[type], init = def.init;
    Object.assign(def, common, {
      init() {
        init.call(this);
        this.removeIcon(Blockly.icons.MutatorIcon.TYPE);
        this.updateParams_();
      },
    });
  }

  // A call's input slots take the shape of its function's inputs. (Blockly's calls also make a
  // number variable for each input name, which would show up among the variables: they use the
  // function's own.)
  for (const type of ['procedures_callnoreturn', 'procedures_callreturn']) {
    const call = Blockly.Blocks[type];
    if (call.fitInputs_) continue;
    Object.assign(call, {
      setProcedureParameters_(names, ids) {
        const same = names.join('\n') === this.arguments_.join('\n');
        this.arguments_ = names.slice();
        const fn = this.definition_();
        this.argumentVarModels_ = fn && fn.argumentVarModels_.length === names.length ? fn.argumentVarModels_.slice() : [];
        this.quarkConnections_ = {};
        this.quarkIds_ = ids;
        if (!same) this.updateShape_();
        this.fitInputs_();
      },
      definition_() {
        const ws = this.workspace.isFlyout ? this.workspace.targetWorkspace : this.workspace;
        return ws ? Blockly.Procedures.getDefinition(this.getProcedureCall(), ws) : null;
      },
      fitInputs_() {
        const fn = this.definition_();
        if (!fn) return;
        fn.argumentVarModels_.forEach((m, i) => {
          const input = this.getInput('ARG' + i);
          if (input) setCheckAndBump(input.connection, inputCheck(m.type));
        });
        if (this.rendered) this.queueRender();
      },
    });
  }
}

// Give a connection a type check; a block plugged in that no longer fits is nudged aside (and a
// shadow block that doesn't is dropped)
function setCheckAndBump(connection, check) {
  if (!connection) return;
  const shadow = connection.isSuperior() && connection.targetBlock();
  if (shadow && shadow.isShadow() && check) {
    const has = shadow.outputConnection && shadow.outputConnection.getCheck();
    if (has && !has.some(c => [check].flat().includes(c))) connection.setShadowState(null);
  }
  const was = connection.targetBlock();
  connection.setCheck(check);
  if (was && !connection.isConnected()) {
    const child = connection.isSuperior() ? was : connection.getSourceBlock();
    if (child.rendered) child.bumpNeighbours();
  }
}

// A function that returns a value says what kind it returns: a number, true/false or a color. Its
// return slot, the return blocks inside it and its calls take that shape, and the C code gets the
// matching return type (a number keeps the C type it came with, like byte). The type is kept in
// the block's extra state; sketches saved before that kept it in block.data (see procInfo).
const RETURN_KINDS = [['number', 'num'], ['true/false', 'bool'], ['color', 'color']];
const RETURN_TYPE = { num: 'int', bool: 'bool', color: 'Color' };
const returnTypeOf = def => (def && def.returnType_ ? def.returnType_() : (def && procInfo(def).ret) || 'int');
function defineReturnTypes(Blockly) {
  // (each part is set up once on a copy of Blockly, even if this runs again)
  const def = Blockly.Blocks.procedures_defreturn;
  const { init, saveExtraState, loadExtraState } = def;
  if (!def.returnType_) Object.assign(def, {
    init() {
      init.call(this);
      this.ret_ = null;
      // the dropdown only asks: setReturnKind_ makes the change, as one step to undo
      const field = new Blockly.FieldDropdown(RETURN_KINDS, kind => {
        if (this.fitting_) return kind;
        this.setReturnKind_(kind);
        return null;
      });
      field.SERIALIZABLE = false;
      this.getInput('RETURN').appendField(field, 'RET');
      this.setTooltip('Your own block that works out a value (a number, true/false or a color) and returns it.');
    },
    returnType_() { return this.ret_ || procInfo(this).ret || 'int'; },
    saveExtraState() {
      return { ...(saveExtraState.call(this) || {}), ret: this.returnType_() };
    },
    loadExtraState(state) {
      loadExtraState.call(this, state);
      if (state && state.ret) this.ret_ = state.ret;
      this.fitReturn_();
    },
    setReturnKind_(kind) {
      if (!RETURN_TYPE[kind] || kindOf(this.returnType_()) === kind) return;
      const before = stateOf(this);
      Blockly.Events.setGroup(true);
      try {
        this.ret_ = RETURN_TYPE[kind];
        const info = procInfo(this);
        if (info.ret) { delete info.ret; this.data = Object.keys(info.params).length ? JSON.stringify({ params: info.params }) : null; }
        // blocks that no longer fit are moved out first, so undo has the old shape back to put them in
        this.fitReturn_();
        fireMutation(Blockly, this, before);
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
    fitReturn_() {
      const kind = kindOf(this.returnType_());
      this.fitting_ = true;
      try {
        Blockly.Events.disable();
        try { this.setFieldValue(kind, 'RET'); } finally { Blockly.Events.enable(); }
      } finally {
        this.fitting_ = false;
      }
      setCheckAndBump(this.getInput('RETURN').connection, KIND_CHECK[kind]);
      for (const b of this.getDescendants(false)) if (b.fitReturn_ && b !== this) b.fitReturn_();
      const ws = this.workspace;
      if (!ws.isFlyout) for (const call of Blockly.Procedures.getCallers(this.getFieldValue('NAME'), ws)) if (call.fitReturn_) call.fitReturn_();
      if (this.rendered) this.queueRender();
    },
  });

  // a call's shape follows its function's
  const call = Blockly.Blocks.procedures_callreturn, callLoad = call.loadExtraState;
  if (!call.fitReturn_) Object.assign(call, {
    loadExtraState(state) {
      callLoad.call(this, state);
      this.fitReturn_();
    },
    fitReturn_() {
      const ws = this.workspace.isFlyout ? this.workspace.targetWorkspace : this.workspace;
      const fn = ws && Blockly.Procedures.getDefinition(this.getProcedureCall(), ws);
      if (!fn || fn.type !== 'procedures_defreturn') return;
      setCheckAndBump(this.outputConnection, KIND_CHECK[kindOf(returnTypeOf(fn))]);
      if (this.rendered) this.queueRender();
    },
  });

  // a return block takes the shape of the function it's in, as it's moved in and out of one
  const ret = Blockly.Blocks.bk_return_value, retInit = ret.init;
  if (ret.fitReturn_) return;
  ret.init = function () {
    retInit.call(this);
    const warn = this.onchange;
    this.setOnChange(function (e) {
      if (warn) warn.call(this, e);
      if (this.isInFlyout) return;
      const E = Blockly.Events;
      if ((e.type === E.BLOCK_MOVE && e.blockId === this.id) || (e.type === E.BLOCK_CREATE && e.ids && e.ids.includes(this.id))) this.fitReturn_();
    });
  };
  ret.fitReturn_ = function () {
    const root = this.getRootBlock();
    const check = root.type === 'procedures_defreturn' ? KIND_CHECK[kindOf(returnTypeOf(root))] : null;
    const input = this.getInput('VALUE');
    if (input.connection.getCheck() === check || JSON.stringify(input.connection.getCheck()) === JSON.stringify(check && [check])) return;
    setCheckAndBump(input.connection, check);
    if (this.rendered) this.queueRender();
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
          if (n == null || n < 0) return x == null ? 'any' : (x >> bit) & 1 ? 'on' : 'off';
          const from = left ? bit - n : bit + n;
          if (from < 0 || from > 7) return 'fill';   // a byte: 0s move in at the ends
          return x == null ? 'any' : (x >> from) & 1 ? 'on' : 'off';
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
        // the bits taken: their values if the number is a plain one, as a shift shows them
        const lo = Number(b.getFieldValue('LO')), hi = Number(b.getFieldValue('HI')), x = known(b, 'A');
        return Array.from({ length: 8 }, (_, k) => {
          const bit = 7 - k;
          if (bit < Math.min(lo, hi) || bit > Math.max(lo, hi)) return 'skip';
          return x == null ? 'any' : (x >> bit) & 1 ? 'on' : 'off';
        });
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
      // the number it makes shows when hovered
      this.setTooltip(() => `${this.getFieldValue('BITS')} in binary\n\nClick to toggle a bit on or off`);
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
// the blocks that set up a list or grid; the first one for each list counts
const LIST_SETUPS = ['bk_list_decl', 'bk_list_init', 'bk_grid_decl', 'bk_grid_init'];
// A list or grid is local when it's set up inside an event or function: its setup block sits in a
// stack there, not at the top of the sketch (see generateProgram). Variables say so in their type.
function isLocalList(ws, id) {
  ws = ws && ws.isFlyout ? ws.targetWorkspace : ws;
  if (!ws) return false;
  let inside = false;
  for (const type of LIST_SETUPS) for (const b of ws.getBlocksByType(type, false)) {
    if (b.getFieldValue('LIST') !== id) continue;
    if (LIST_SETUPS.includes(b.getRootBlock().type)) return false;
    inside = true;
  }
  return inside;
}
const isLocalVar = (v, ws) => isLocalType(v.type) || (isList(v.type) && isLocalList(ws, v.getId()));

function defineListBlocks(Blockly) {
  const kindOfId = (block, id) => {
    const v = id && block.workspace && block.workspace.getVariableMap().getVariableById(id);
    return v && isList(v.type) ? listKind(v.type) : 'num';
  };
  const warnDuplicate = function () {
    this.setOnChange(function () {
      if (!this.workspace || this.isInFlyout || !this.rendered) return;
      const id = this.getFieldValue('LIST');
      const first = this.workspace.getTopBlocks(true).find(b => LIST_SETUPS.includes(b.type) && b.isEnabled() && b.getFieldValue('LIST') === id);
      this.setWarningText(first && first !== this ? 'Another block already sets up this list, so this one is ignored.' : null);
    });
  };

  Blockly.Blocks.bk_list_decl = {
    init() {
      this.appendDummyInput()
        .appendField('list')
        .appendField(new Blockly.FieldVariable(null, undefined, [...ALL_LIST_TYPES, TIMER_LIST], 'int[]'), 'LIST')
        .appendField('with')
        .appendField(new Blockly.FieldNumber(LIST_SIZE, 1, LIST_MAX, 1), 'COUNT')
        .appendField('items');
      this.setStyle('bk_lists');
      // stackable, so it can also set up a local list inside a function
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setTooltip('Sets up a list with this many items. Numbers start at 0, colors off, true/false at false, and timers already finished.');
      warnDuplicate.call(this);
    },
  };

  Blockly.Blocks.bk_grid_decl = {
    init() {
      this.appendDummyInput()
        .appendField('grid')
        .appendField(new Blockly.FieldVariable(null, undefined, ALL_GRID_TYPES, 'int[][]'), 'LIST')
        .appendField('with')
        .appendField(new Blockly.FieldNumber(3, 1, GRID_MAX, 1), 'ROWS')
        .appendField('rows of')
        .appendField(new Blockly.FieldNumber(3, 1, GRID_MAX, 1), 'COLS')
        .appendField('items');
      this.setStyle('bk_lists');
      // stackable, so it can also set up a local list inside a function
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setTooltip('Sets up a grid: rows that each hold the same number of items (a 2D array). Numbers start at 0, colors off and true/false at false.');
      warnDuplicate.call(this);
    },
  };

  // A grid with its starting items, one line per row. The buttons add or remove a row or a column.
  Blockly.Blocks.bk_grid_init = {
    init() {
      this.rows_ = 2;
      this.cols_ = 3;
      this.kind_ = 'num';
      this.appendEndRowInput('HEAD')
        .appendField('grid')
        .appendField(new Blockly.FieldVariable(null, id => { this.updateShape_(kindOfId(this, id)); return id; }, ALL_GRID_TYPES, 'int[][]'), 'LIST')
        .appendField('starts as');
      const btn = (sign, what, d) => new Blockly.FieldImage(PLUS_MINUS(sign), 18, 18, `${sign === '+' ? 'one more' : 'one less'} ${what}`, () => this.resize_(d));
      this.appendDummyInput('TAIL')
        .appendField('rows').appendField(btn('-', 'row', [-1, 0])).appendField(btn('+', 'row', [1, 0]))
        .appendField('  items').appendField(btn('-', 'item in each row', [0, -1])).appendField(btn('+', 'item in each row', [0, 1]));
      this.setInputsInline(true);
      this.setStyle('bk_lists');
      // stackable, so it can also set up a local list inside a function
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setTooltip('Sets up a grid (a 2D array) with these starting items: each line is a row. The buttons add or take away a row, or an item in every row.');
      this.updateShape_();
      warnDuplicate.call(this);
    },
    saveExtraState() { return { rows: this.rows_, cols: this.cols_, kind: this.kind_ }; },
    loadExtraState(state) {
      this.rows_ = Math.max(1, Math.min(GRID_MAX, Number(state && state.rows) || 1));
      this.cols_ = Math.max(1, Math.min(GRID_MAX, Number(state && state.cols) || 1));
      this.updateShape_(KIND_CHECK[state && state.kind] ? state.kind : 'num');
    },
    resize_([dr, dc]) {
      if (this.isInFlyout) return;
      const rows = Math.max(1, Math.min(GRID_MAX, this.rows_ + dr)), cols = Math.max(1, Math.min(GRID_MAX, this.cols_ + dc));
      if ((rows === this.rows_ && cols === this.cols_) || rows * cols > GRID_SLOTS) return;
      const before = JSON.stringify(this.saveExtraState());
      Blockly.Events.setGroup(true);
      try {
        // items in the row or column that goes away are deleted (undo brings them back)
        for (let r = 0; r < this.rows_; r++) {
          for (let c = 0; c < this.cols_; c++) {
            const gone = (r >= rows || c >= cols) && this.getInputTargetBlock(`ITEM${r}_${c}`);
            if (gone && !gone.isShadow()) gone.dispose(false);
          }
        }
        const [oldRows, oldCols] = [this.rows_, this.cols_];
        this.rows_ = rows;
        this.cols_ = cols;
        this.updateShape_();
        Blockly.Events.fire(new (Blockly.Events.get(Blockly.Events.BLOCK_CHANGE))(this, 'mutation', null, before, JSON.stringify(this.saveExtraState())));
        // new items are blocks too, like the rest, so taking them away can be undone
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (r < oldRows && c < oldCols) continue;
            const b = Blockly.serialization.blocks.append(itemShadow(this.kind_), this.workspace, { recordUndo: true });
            this.getInput(`ITEM${r}_${c}`).connection.connect(b.outputConnection);
          }
        }
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
    // add or remove rows and items at the ends, keeping the rest in place
    updateShape_(kind = kindOfId(this, this.getFieldValue('LIST'))) {
      this.kind_ = kind;
      const shadow = itemShadow(kind);
      for (let r = 0; this.getInput('END' + r); r++) {
        for (let c = 0; this.getInput(`ITEM${r}_${c}`); c++) {
          if (r >= this.rows_ || c >= this.cols_) this.removeInput(`ITEM${r}_${c}`);
        }
        if (r >= this.rows_) this.removeInput('END' + r);
      }
      for (let r = 0; r < this.rows_; r++) {
        if (!this.getInput('END' + r)) { this.appendEndRowInput('END' + r); this.moveInputBefore('END' + r, 'TAIL'); }
        for (let c = 0; c < this.cols_; c++) {
          const name = `ITEM${r}_${c}`;
          let input = this.getInput(name);
          if (!input) { input = this.appendValueInput(name); this.moveInputBefore(name, 'END' + r); }
          const conn = input.connection;
          const now = conn.getShadowState();
          if (now && now.type !== shadow.type) conn.setShadowState(null);
          input.setCheck(KIND_CHECK[kind]);
          if (!now || now.type !== shadow.type) conn.setShadowState(shadow);
        }
      }
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
      // stackable, so it can also set up a local list inside a function
      this.setPreviousStatement(true);
      this.setNextStatement(true);
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
  // A slot that appears after a variable field when the variable chosen needs an index: an item of a
  // list of timers in the timer blocks, a row of a grid in "send … as a datagram"
  const indexSlot = (mutator, field, slot, label, key, wants) => {
    if (Blockly.Extensions.isRegistered(mutator)) return;
    Blockly.Extensions.registerMutator(mutator, {
      saveExtraState() { return this.getInput(slot) ? { [key]: true } : null; },
      loadExtraState(state) { this.setIndexSlot_(!!(state && state[key])); },
      setIndexSlot_(on) {
        if (!!this.getInput(slot) === on) return;
        if (!on) { this.removeInput(slot); return; }
        const input = this.appendValueInput(slot).setCheck(N).appendField(label);
        const at = this.inputList.indexOf(this.getInput('T')) + 1;
        if (at < this.inputList.length - 1) this.moveNumberedInputBefore(this.inputList.length - 1, at);
        input.connection.setShadowState(numBlock(0));
      },
    }, function () {
      this.getField(field).setValidator(id => {
        const v = id && this.workspace && this.workspace.getVariableMap().getVariableById(id);
        if (v) this.setIndexSlot_(wants(v.type));
        return id;
      });
    });
  };
  indexSlot('bk_timer_item', 'TIMER', 'INDEX', 'item', 'item', type => type === TIMER_LIST);
  indexSlot('bk_dg_row', 'LIST', 'ROW', 'row', 'row', isGrid);
  const LOOPS = new Set(['controls_repeat_ext', 'controls_whileUntil', 'bk_for_each_face', 'bk_for', 'bk_c_wrap', 'bk_switch']);
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
  // C hands a function a list without its length: COUNT_OF can't count it there (a grid's rows
  // either, but its row size is part of its type)
  const givenToFunction = b => {
    const id = b.getFieldValue('LIST'), root = b.getRootBlock();
    return root.type.startsWith('procedures_def') && root.getVarModels().some(m => m.getId() === id);
  };
  reg('bk_given_list_warning', warn(b => !givenToFunction(b) || b.getFieldValue('WHAT') === 'COLS',
    'In C, a list given to a function doesn\'t bring its length with it, so this gives the wrong number here. Give the function the length as a number input too.'));
  // (Blockly doesn't validate a variable field's value as a block is loaded, so it also fits itself
  // when it's made, and once a whole sketch is loaded)
  reg('bk_list_pass', function () {
    this.fit_ = (id = this.getFieldValue('LIST')) => {
      const v = id && this.workspace && this.workspace.getVariableMap().getVariableById(id);
      if (v) setCheckAndBump(this.outputConnection, listCheck(v.type));
    };
    this.getField('LIST').setValidator(id => { this.fit_(id); return id; });
    this.setOnChange(function (e) {
      if (e.type === Blockly.Events.BLOCK_CREATE && e.ids && e.ids.includes(this.id)) this.fit_();
    });
  });
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
  // a timer, or one item of a list of timers
  const timer = block => fieldVar(block, 'TIMER') + (block.getInput('INDEX') ? `[${v(block, 'INDEX', ORDER.NONE, '0')}]` : '');
  G.timer_ = timer;
  F.bk_timer_set = block => `${timer(block)}.set(${v(block, 'MS', ORDER.COMMA, '0')});\n`;
  F.bk_timer_add = block => `${timer(block)}.add(${v(block, 'MS', ORDER.COMMA, '0')});\n`;
  F.bk_timer_never = block => `${timer(block)}.never();\n`;
  F.bk_timer_done = block => [`${timer(block)}.isExpired()`, ORDER.POSTFIX];
  F.bk_timer_left = block => [`${timer(block)}.getRemaining()`, ORDER.POSTFIX];

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
  F.bk_return_value = block => {
    const root = block.getRootBlock();
    const ret = root.type === 'procedures_defreturn' ? returnTypeOf(root) : 'int';
    return `return ${v(block, 'VALUE', ORDER.NONE, { bool: 'false', Color: 'OFF' }[ret] || '0')};\n`;
  };

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
    return `${isConstType(m.type) ? 'const ' : ''}${cType(m.type)} ${code}`;
  };
  F.bk_const = block => {
    const m = block.getField('VAR').getVariable();
    const kind = m ? kindOf(m.type) : 'num';
    return `const ${m ? cType(m.type) : 'int'} ${fieldVar(block, 'VAR')} = ${v(block, 'VALUE', ORDER.COMMA, def[KIND_CHECK[kind]] || '0')};\n`;
  };
  // for (int i = 0; i < 6; i++): a local counter is declared in the loop, and counts as declared inside it
  F.bk_for = block => {
    const m = block.getField('VAR').getVariable();
    const name = fieldVar(block, 'VAR');
    const [, op, up] = FOR_DIRECTIONS.find(d => d[1] === block.getFieldValue('DIR')) || FOR_DIRECTIONS[0];
    const declare = m && isLocalType(m.type) && !G.scopes_.some(sc => sc.has(m.getId()));
    const by = block.getInputTargetBlock('BY');
    const one = by && by.type === 'math_number' && by.isEnabled() && Number(by.getFieldValue('NUM')) === 1;
    const step = one ? `${name}${up ? '++' : '--'}` : `${name} ${up ? '+=' : '-='} ${v(block, 'BY', ORDER.ASSIGN, '1')}`;
    G.scopes_.push(new Set(declare ? [m.getId()] : []));
    let inside;
    try { inside = body(block, 'DO'); } finally { G.scopes_.pop(); }
    return `for (${declare ? cType(m.type) + ' ' : ''}${name} = ${v(block, 'FROM', ORDER.ASSIGN, '0')}; ${name} ${op} ${v(block, 'TO', ORDER.REL, '0')}; ${step}) {\n${inside}}\n`;
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
  F.bk_list_pass = block => [G.varName(block.getFieldValue('LIST')), ORDER.ATOMIC];

  // Grids: name[row][item]
  const cell = block => `${listVar(block).name}[${v(block, 'ROW', ORDER.NONE, '0')}][${v(block, 'INDEX', ORDER.NONE, '0')}]`;
  const gridSize = (n, max) => Math.max(1, Math.min(max, Math.floor(Number(n)) || 1));
  F.bk_grid_decl = block => {
    const l = listVar(block);
    return `${l.item} ${l.name}[${gridSize(block.getFieldValue('ROWS'), GRID_MAX)}][${gridSize(block.getFieldValue('COLS'), GRID_MAX)}];\n`;
  };
  F.bk_grid_init = block => {
    const l = listVar(block);
    const rows = [];
    for (let r = 0; block.getInput('END' + r); r++) {
      const items = [];
      for (let c = 0; block.getInput(`ITEM${r}_${c}`); c++) items.push(v(block, `ITEM${r}_${c}`, ORDER.COMMA, '0'));
      rows.push(`${G.INDENT}{ ${items.join(', ')} },\n`);
    }
    return `${l.item} ${l.name}[${rows.length}][${block.cols_}] = {\n${rows.join('')}};\n`;
  };
  for (const kind of ['num', 'bool', 'color']) {
    F['bk_grid_get_' + kind] = block => [cell(block), ORDER.POSTFIX];
    F['bk_grid_set_' + kind] = block => `${cell(block)} = ${v(block, 'VALUE', ORDER.COMMA, def[KIND_CHECK[kind]])};\n`;
  }
  F.bk_grid_change = block => {
    const it = cell(block);
    const by = block.getInputTargetBlock('DELTA');
    if (by && by.type === 'math_number' && by.isEnabled()) {
      const n = Number(by.getFieldValue('NUM'));
      if (n === 1) return `${it}++;\n`;
      if (n === -1) return `${it}--;\n`;
      if (n < 0) return `${it} -= ${-n};\n`;
    }
    return `${it} += ${v(block, 'DELTA', ORDER.COMMA, '1')};\n`;
  };
  F.bk_grid_size = block => [`COUNT_OF(${listVar(block).name}${block.getFieldValue('WHAT') === 'COLS' ? '[0]' : ''})`, ORDER.POSTFIX];

  // Datagrams
  F.bk_dg_send = block => {
    const name = listVar(block).name + (block.getInput('ROW') ? `[${v(block, 'ROW', ORDER.NONE, '0')}]` : '');
    return `sendDatagramOnFace(${name}, sizeof(${name}), ${v(block, 'FACE', ORDER.COMMA, '0')});\n`;
  };
  F.bk_trashed_comment = () => '';
  F.bk_dg_item = block => [`getDatagramOnFace(${v(block, 'FACE', ORDER.NONE, '0')})[${v(block, 'INDEX', ORDER.NONE, '0')}]`, ORDER.POSTFIX];

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
      code += labels.map(l => `${I}case ${l}:`).join('\n') + caseBody('DO' + i);
    }
    if (block.getInputTargetBlock('DEFAULT')) code += `${I}default:` + caseBody('DEFAULT');
    return code + '}\n';
    // a case that makes a local (or has C code, which might) gets braces, so the local stays in
    // that case: C++ won't let a jump to a later case skip past it
    function caseBody(name) {
      const made = new Set();
      G.scopes_.push(made);
      let code;
      try { code = statementToCode(block, name); } finally { G.scopes_.pop(); }
      let braced = made.size > 0;
      for (let b = block.getInputTargetBlock(name); b && !braced; b = b.getNextBlock()) braced = b.type === 'bk_c_stmt' || b.type === 'bk_c_wrap';
      return braced ? ` {\n${G.prefixLines(code, I)}${I}${I}break;\n${I}}\n` : `\n${G.prefixLines(code, I)}${I}${I}break;\n`;
    }
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

// The whole sketch: header, globals, top-level C, setup(), loop(), then functions
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
  const listSetups = new Set(of(...LIST_SETUPS).filter(b => {
    const id = b.getFieldValue('LIST');
    if (setUp.has(id)) return false;
    setUp.add(id);
    return true;
  }));
  // a global const is declared by its const block (the first one); one without gets its default value
  const consts = new Set();
  const constSetups = new Set(of('bk_const').filter(b => {
    const id = b.getFieldValue('VAR');
    if (consts.has(id)) return false;
    consts.add(id);
    return true;
  }));
  for (const m of sortedVars(ws)) {
    if (!isConstType(m.type) || isLocalType(m.type) || consts.has(m.getId())) continue;
    const kind = kindOf(m.type);
    globals.push(`const ${cType(m.type)} ${G.varName(m.getId())} = ${kind === 'bool' ? 'false' : kind === 'color' ? 'OFF' : '0'};`);
  }
  // a list set up inside a function is a local there
  for (const b of ws.getAllBlocks(false)) if (LIST_SETUPS.includes(b.type) && b.isEnabled()) setUp.add(b.getFieldValue('LIST'));
  for (const m of sortedVars(ws)) {
    // (a list given to a function is that function's input, unless something outside uses it)
    if (paramOf.has(m.getId()) && !useGlobal.has(m.getId())) continue;
    if (isList(m.type) && !setUp.has(m.getId())) globals.push(`${cType(itemType(m.type))} ${G.varName(m.getId())}[${LIST_SIZE}]${isGrid(m.type) ? `[${LIST_SIZE}]` : ''};`);
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
  for (const b of of('bk_c_top', ...LIST_SETUPS, 'bk_const', 'bk_define', 'bk_enum')) {
    if (b.type === 'bk_c_top') {
      flush();
      const text = String(b.getFieldValue('CODE') ?? '').trimEnd();
      if (text) parts.push(hatComment(b) + text);
      continue;
    }
    if (LIST_SETUPS.includes(b.type) && !listSetups.has(b)) continue;
    if (b.type === 'bk_const' && !constSetups.has(b)) continue;
    const kind = LIST_SETUPS.includes(b.type) ? 'list' : b.type;
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

  if (loops.length || !DEFINES_LOOP.test(rawText)) {
    fresh();
    parts.push(loops.map(hatComment).join('') + 'void loop() {\n' + loops.map(hatBody).join('') + '}');
  }

  // A function input in C. A list is `byte name[]` and a grid `byte name[][6]` (C needs a grid's
  // row size): their item type and row size are those of the lists its calls give it, when they
  // agree, so any list of the right kind can be given to it.
  const gridCols = id => {
    const setup = ws.getAllBlocks(false).find(b => (b.type === 'bk_grid_init' || b.type === 'bk_grid_decl') && b.getFieldValue('LIST') === id);
    if (!setup) return LIST_SIZE;
    return setup.type === 'bk_grid_init' ? setup.cols_ : Math.max(1, Math.min(GRID_MAX, Math.floor(Number(setup.getFieldValue('COLS'))) || 1));
  };
  const paramDecl = (d, m, i, info) => {
    const name = G.varName(m.getId());
    if (!isList(m.type)) return `${(m.type === '' && info.params[m.name]) || cType(m.type)} ${name}`;
    const given = ws.getAllBlocks(false)
      .filter(b => b.type.startsWith('procedures_call') && b.isEnabled() && b.getFieldValue('NAME') === d.getFieldValue('NAME'))
      .map(b => b.getInputTargetBlock('ARG' + i))
      .filter(b => b && b.type === 'bk_list_pass')
      .map(b => ws.getVariableMap().getVariableById(b.getFieldValue('LIST')))
      .filter(v => v && isGrid(v.type) === isGrid(m.type) && !paramOf.has(v.getId()));
    const one = list => (new Set(list).size === 1 ? list[0] : null);
    const type = one(given.map(v => baseType(v.type))) || baseType(m.type);
    if (!isGrid(m.type)) return `${cType(itemType(type))} ${name}[]`;
    const cols = one(given.map(v => gridCols(v.getId()))) || (info.cols && info.cols[m.name]) || LIST_SIZE;
    return `${cType(itemType(type))} ${name}[][${cols}]`;
  };
  for (const d of defs) {
    fresh();
    const name = G.procName(d.getFieldValue('NAME'));
    const info = procInfo(d);
    const params = d.getVarModels().map((m, i) => paramDecl(d, m, i, info)).join(', ');
    const stack = G.statementToCode(d, 'STACK');
    if (d.type === 'procedures_defreturn') {
      const ret = returnTypeOf(d);
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
// A function input that's a list (`byte values[]`) or a grid (`byte cells[][6]`): { type, cols }
function listParamOf(t) {
  if (!t || t.k !== 'arr' || t.n != null || t.nExpr) return null;
  if (t.of.k === 'arr') {
    const item = varTypeOf(t.of.of), cols = t.of.nExpr ? constInt(t.of.nExpr) : null;
    if (!item || item === 'char' || !ALL_GRID_TYPES.includes(item + '[][]') || !cols || cols < 1 || cols > GRID_MAX) return null;
    return { type: item + '[][]', cols };
  }
  const item = varTypeOf(t.of);
  return item && item !== 'char' && ALL_LIST_TYPES.includes(item + '[]') ? { type: item + '[]' } : null;
}

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
// Are two expressions written the same (ignoring where they are)?
const sameExpr = (a, b) => {
  const plain = e => JSON.stringify(stripParens(e) ?? null, (k, v) => (k === 'line' || k === 'endLine' || k === 'type' ? undefined : v));
  return plain(a) === plain(b);
};

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
    if (t.of.k === 'arr') return this.gridDecl(d);
    const item = varTypeOf(t.of);
    if (!item || item === 'char' || !(ALL_LIST_TYPES.includes(item + '[]') || item + '[]' === TIMER_LIST)) return null;
    const init = d.init ? stripParens(d.init) : null;
    if (init && (init.kind !== 'InitList' || item === 'Timer')) return null;
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

  // A global 2D array that can be a grid: a number/true-false/color item type, constant sizes,
  // and starting rows (if any) that fit
  gridDecl(d) {
    const t = d.type;
    const item = varTypeOf(t.of.of);
    if (!item || item === 'char' || !ALL_GRID_TYPES.includes(item + '[][]')) return null;
    const init = d.init ? stripParens(d.init) : null;
    if (init && init.kind !== 'InitList') return null;
    const rowsGiven = init ? init.items.map(stripParens) : [];
    if (rowsGiven.some(r => r.kind !== 'InitList')) return null;
    const cols = t.of.nExpr ? constInt(t.of.nExpr) : null;
    let rows = t.nExpr ? constInt(t.nExpr) : rowsGiven.length;
    if (cols == null || rows == null) return null;
    if (rows < 1 || cols < 1 || rows > GRID_MAX || cols > GRID_MAX || rowsGiven.length > rows || rowsGiven.some(r => r.items.length > cols)) return null;
    if (init && rows * cols > GRID_SLOTS) return null;
    return { type: item + '[][]', rows, cols, items: init ? rowsGiven.map(r => r.items) : null };
  }

  listSetup(v, list, d, decl) {
    const kind = listKind(v.type);
    let json;
    if (isGrid(v.type)) {
      if (!list.items) json = { type: 'bk_grid_decl', fields: { LIST: { id: v.id }, ROWS: list.rows, COLS: list.cols } };
      else {
        json = { type: 'bk_grid_init', extraState: { rows: list.rows, cols: list.cols, kind }, fields: { LIST: { id: v.id } }, inputs: {} };
        const ctx = { scopes: [], fn: { name: null } };
        for (let r = 0; r < list.rows; r++) {
          for (let c = 0; c < list.cols; c++) {
            const it = list.items[r] && list.items[r][c];
            if (!it) { json.inputs[`ITEM${r}_${c}`] = itemInput(kind); continue; }
            const slot = this.slot(it, KIND_CHECK[kind], ctx, null);
            json.inputs[`ITEM${r}_${c}`] = itemInput(kind, slot.block || slot.shadow);
          }
        }
      }
    } else if (!list.items) {
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

  // `list[i]` where list is a list variable: { v, index }, or `grid[r][c]`: { v, row, index }
  listItem(e, ctx) {
    e = stripParens(e);
    if (!e || e.kind !== 'Index') return null;
    let obj = stripParens(e.obj), row = null;
    if (obj.kind === 'Index') { row = obj.index; obj = stripParens(obj.obj); }
    const entry = obj.kind === 'Ident' ? this.lookup(obj.name, ctx) : null;
    if (!entry || entry.kind !== 'var' || !isList(entry.v.type) || entry.v.type === TIMER_LIST || isGrid(entry.v.type) !== !!row) return null;
    return row ? { v: entry.v, row, index: e.index } : { v: entry.v, index: e.index };
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
        const list = listParamOf(p.type);
        if (list) return { name: p.name, ctype: list.type, type: list.type, cols: list.cols, def: p.def };
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
        // a long enum lists its names in a column
        const json = { type: 'bk_enum', extraState: { items: names.length, ...(names.length > 5 ? { column: true } : {}) }, fields: { NAME: it.type.def.tag || '' } };
        names.forEach((n, k) => { json.fields['ITEM' + k] = n; });
        // the comments on its names, inside its braces, are its own, each labeled with its name
        const named = it.type.def.items.map(x => ({ name: x.name, line: this.realLine(x.line) }));
        this.anchors.push({ line: this.realLine(it.line), end: this.realLine(ends[i]), named, target: json });
        pieces.push({ lo: it.line, hi: ends[i], blocks: [json] });
        return;
      }
      if (it.kind === 'VarDecl' && hasWord(i, 'enum')) return rawPiece();
      // const byte MAX = 5; (numbers, true/false or colors, each with its value): const variables, each
      // with its const block
      if (it.kind === 'VarDecl' && it.isConst && !it.isExtern) {
        const types = it.decls.map(d => varTypeOf(d.type));
        const ok = it.decls.every((d, k) => d.init && !d.ctorArgs && d.init.kind !== 'InitList' && types[k]
          && ['num', 'bool', 'color'].includes(kindOf(types[k])) && !this.globals.has(d.name) && !this.procs.has(d.name)
          && !funcs.has(d.name) && this.canName(d.name, constType(types[k])));
        if (!ok) return rawPiece();
        const ctx = { scopes: [], fn: { name: null } };
        const blocks = it.decls.map((d, k) => {
          const v = this.newVar(d.name, constType(types[k]));
          this.globals.set(d.name, v);
          const kind = kindOf(types[k]);
          const json = { type: 'bk_const', fields: { VAR: { id: v.id } }, inputs: {} };
          json.inputs.VALUE = this.slot(d.init, KIND_CHECK[kind], ctx, kind === 'color' ? 'RED' : kind === 'num' ? 0 : null);
          this.anchors.push({ line: this.realLine(d.line || it.line), target: json });
          return json;
        });
        pieces.push({ lo: it.line, hi: ends[i], blocks });
        return;
      }
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
        else if (fn.name === 'loop') { loopHat = this.convertLoop(fn); piece.blocks = [loopHat]; }
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
      }
    }
    flush();

    if (!setupHat && !loopHat && !tops.some(b => b.type !== 'bk_c_top')) {
      tops.push({ type: 'bk_setup' }, { type: 'bk_loop' });
    }
    this.attachComments(tops);
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
      // inside a block that spans lines (an enum's names): a comment after a name, or on its own
      // line just before one, is about that name
      if (!best) {
        best = this.anchors.find(a => a.end != null && c.line > a.line && c.line <= a.end);
        const about = best && best.named && (c.bol ? best.named.find(x => x.line > c.endLine) : best.named.findLast(x => x.line === c.line));
        if (about) { add(best.target, `${about.name}: ${c.text}`); continue; }
      }
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
    return { scopes: [scope], fn: { kind, ret, name: fn.name, node: fn } };
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
    const forever = this.anchor(fn, { type: 'bk_loop' });
    const first = chain(this.convertGroups(this.groups(fn.body.body, fn.body.endLine), ctx));
    this.anchors.push({ line: this.realLine(fn.body.endLine), target: forever });
    if (first) forever.next = { block: first };
    return forever;
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
    if (isValue) json.extraState = { ...(json.extraState || {}), ret: p.ret };
    if (!json.extraState) delete json.extraState;
    const info = {};
    const typed = p.params.filter(q => q.type === '' && q.ctype !== 'int');
    if (typed.length) info.params = Object.fromEntries(typed.map(q => [q.name, q.ctype]));
    // a grid input's row size, for when no call gives it a grid to take it from
    const grids = p.params.filter(q => isGrid(q.type));
    if (grids.length) info.cols = Object.fromEntries(grids.map(q => [q.name, q.cols]));
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
      const slot = this.slot(ret.arg, KIND_CHECK[kindOf(p.ret)], ctx);
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
        json.inputs.VALUE = this.slot(node.arg, KIND_CHECK[kindOf(ctx.fn.ret)], ctx);
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
    // a case body in braces, case A: { … break; } or case A: { … } break;, keeps its locals to
    // itself, as each case of the block does anyway: what's inside the braces is the body
    for (const g of groups) {
      const [inner, after] = g.stmts;
      if (inner && inner.kind === 'Block' && (g.stmts.length === 1 || (g.stmts.length === 2 && after.kind === 'Break'))) {
        g.stmts = inner.body.filter(x => x.kind !== 'Empty');
        g.braceEnd = inner.endLine;
        g.broke = !!after;
      }
    }
    groups.forEach((g, i) => {
      const last = g.stmts[g.stmts.length - 1];
      g.end = g.braceEnd ?? (i + 1 < groups.length ? groups[i + 1].labels[0].line : node.body.endLine);
      if (last && last.kind === 'Break') { g.end = last.line; g.stmts.pop(); }
      else if (!g.broke && i + 1 < groups.length && !(last && (last.kind === 'Return' || last.kind === 'Continue'))) throw new Unsupported('falls through');
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
      const out = [];
      for (const d of node.decls) {
        // a local array: its setup block, there in the function
        if (d.type && d.type.k === 'arr') {
          if (node.isConst) throw new Unsupported('const local array');
          const list = this.listDecl(d);
          if (!list || d.ctorArgs || this.procs.has(d.name) || this.globals.has(d.name)) throw new Unsupported('local array');
          const v = this.findVar(d.name, list.type) || (this.canName(d.name, list.type) ? this.newVar(d.name, list.type) : null);
          if (!v) throw new Unsupported('local name');
          ctx.scopes[ctx.scopes.length - 1].set(d.name, { kind: 'var', v });
          out.push(this.listSetup(v, list, d, node));
          continue;
        }
        // a pointer to the datagram on a face, only ever read as data[i]: those reads become
        // "item i of datagram on face …", and the pointer itself goes away
        const face = this.datagramPointer(d, ctx);
        if (face) {
          ctx.scopes[ctx.scopes.length - 1].set(d.name, { kind: 'datagram', face });
          continue;
        }
        const type = varTypeOf(d.type);
        if (!type || type === 'Timer' || d.ctorArgs || (d.init && d.init.kind === 'InitList') || this.procs.has(d.name)) throw new Unsupported('local');
        // a local const is made, with its value, by its first set block
        if (node.isConst && !d.init) throw new Unsupported('const local');
        const lt = node.isConst ? constType(type, true) : localType(type);
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
    const count = this.countLoop(node, end, ctx);
    if (count) return count;
    if (node.body.kind !== 'Block') throw new Unsupported('for');
    const head = this.slice(node.line, node.body.line - 1, { expr: true });
    const scope = new Map();
    if (node.init && node.init.kind === 'VarDecl') for (const d of node.init.decls) scope.set(d.name, { kind: 'raw' });
    ctx.scopes.push(scope);
    try { return this.wrap(node, head, node.body, '', ctx); } finally { ctx.scopes.pop(); }
  }

  // for (T i = a; i < b; i++), with <, <=, > or >= and ++, --, += or -= going the same way, as a
  // count block: i is a local declared in the loop (or a number variable that already exists)
  countLoop(node, end, ctx) {
    const cond = stripParens(node.cond), stepE = stripParens(node.step);
    if (!cond || cond.kind !== 'Binary' || !stepE) return null;
    const dir = FOR_DIRECTIONS.find(d => d[1] === cond.op);
    if (!dir) return null;
    let name, from, v = null, local = false;
    const decl = node.init && node.init.kind === 'VarDecl' && node.init.decls.length === 1 ? node.init.decls[0] : null;
    if (decl) {
      const t = varTypeOf(decl.type);
      if (!decl.init || node.init.isStatic || node.init.isConst || !NUM_TYPES.includes(t) || this.procs.has(decl.name)) return null;
      name = decl.name; from = decl.init; local = true;
    } else {
      const init = node.init && stripParens(node.init.kind === 'ExprStmt' ? node.init.expr : node.init);
      if (!init || init.kind !== 'Assign' || init.op !== '=' || stripParens(init.target).kind !== 'Ident') return null;
      name = stripParens(init.target).name; from = init.value;
      const entry = this.lookup(name, ctx);
      if (!entry || entry.kind !== 'var' || kindOf(entry.v.type) !== 'num') return null;
      v = entry.v;
    }
    const isVar = e => { e = stripParens(e); return e && e.kind === 'Ident' && e.name === name; };
    if (!isVar(cond.l)) return null;
    // the step goes the way the comparison expects
    let by = null;
    if ((stepE.kind === 'Postfix' || stepE.kind === 'Unary') && isVar(stepE.arg) && stepE.op === (dir[2] ? '++' : '--')) by = { shadow: numBlock(1) };
    else if (stepE.kind === 'Assign' && isVar(stepE.target) && stepE.op === (dir[2] ? '+=' : '-=')) by = 'value';
    if (!by) return null;
    if (local) {
      const lt = localType(varTypeOf(decl.type));
      v = this.findVar(name, lt) || (this.canName(name, lt) ? this.newVar(name, lt) : null);
      if (!v) return null;
    }
    const json = this.anchor(node, { type: 'bk_for', fields: { VAR: { id: v.id }, DIR: dir[1] }, inputs: {} });
    ctx.scopes.push(new Map([[name, { kind: 'var', v }]]));
    try {
      json.inputs.FROM = this.slot(from, N, ctx, 0);
      json.inputs.TO = this.slot(cond.r, N, ctx, 6);
      json.inputs.BY = by === 'value' ? this.slot(stepE.value, N, ctx, 1) : by;
      const b = this.body(node.body, end, ctx, json);
      if (b) json.inputs.DO = { block: b };
    } finally { ctx.scopes.pop(); }
    return json;
  }

  exprStmt(node, ctx) {
    const e = node.expr;
    const [lo, hi] = this.exprRange(e);
    if (this.isExactRun(lo, hi) && !COLOR_NAMES.has(this.macroName(lo))) throw new Unsupported('macro statement');
    if (e.kind === 'Call' && e.callee.kind === 'Ident' && !this.lookup(e.callee.name, ctx)) {
      const name = e.callee.name;
      if (BUTTON_FNS.has(name) && name !== 'buttonDown' && !e.args.length) return this.anchor(node, { type: 'bk_button_clear', fields: { EVENT: name } });
      if (name === 'sendDatagramOnFace') {
        const list = this.datagramList(e.args, ctx);
        if (!list) throw new Unsupported('datagram');
        const json = this.anchor(node, { type: 'bk_dg_send', fields: { LIST: { id: list.v.id } }, inputs: { FACE: this.slot(e.args[2], N, ctx, 0) } });
        if (list.row) { json.extraState = { row: true }; json.inputs.ROW = this.slot(list.row, N, ctx, 0); }
        return json;
      }
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
        if (e.args.length !== (method === 'never' ? 0 : 1)) throw new Unsupported('timer');
        const json = this.anchor(node, this.timerBlock(type, t, ctx));
        if (method !== 'never') json.inputs = { ...json.inputs, MS: this.slot(e.args[0], N, ctx, 1000) };
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

  listStmt(node, e, { v, row, index }, ctx) {
    const kind = listKind(v.type);
    const at = { LIST: { id: v.id } };
    const pre = row ? 'bk_grid_' : 'bk_list_';
    // the item's place: its index, and in a grid its row
    const place = () => ({ ...(row ? { ROW: this.slot(row, N, ctx, 0) } : {}), INDEX: this.slot(index, N, ctx, 0) });
    if ((e.kind === 'Postfix' || e.kind === 'Unary') && (e.op === '++' || e.op === '--')) {
      if (kind !== 'num') throw new Unsupported('list ++');
      return this.anchor(node, { type: pre + 'change', fields: at, inputs: { ...place(), DELTA: { shadow: numBlock(e.op === '++' ? 1 : -1) } } });
    }
    if (e.kind !== 'Assign') throw new Unsupported('list');
    if (e.op === '=') {
      const json = this.anchor(node, { type: pre + 'set_' + kind, fields: at, inputs: place() });
      json.inputs.VALUE = this.slot(e.value, KIND_CHECK[kind], ctx, kind === 'color' ? 'RED' : kind === 'num' ? 0 : null);
      return json;
    }
    const val = stripParens(e.value);
    if (kind === 'num' && (e.op === '+=' || (e.op === '-=' && val.kind === 'Num' && !val.isFloat && !val.unsigned && !val.long))) {
      const json = this.anchor(node, { type: pre + 'change', fields: at, inputs: place() });
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

  // sendDatagramOnFace(list, sizeof(list), face) sends a whole list of bytes, and
  // sendDatagramOnFace(grid[r], sizeof(grid[r]), face) a row of a grid; either may have an &: { v, row }
  datagramList(args, ctx) {
    if (args.length !== 3) return null;
    const what = e => {
      e = stripParens(e);
      if (e.kind === 'Unary' && e.op === '&') e = stripParens(e.arg);
      if (e.kind === 'Ident') return { name: e.name, row: null };
      const obj = e.kind === 'Index' ? stripParens(e.obj) : null;
      return obj && obj.kind === 'Ident' ? { name: obj.name, row: stripParens(e.index) } : null;
    };
    const data = what(args[0]), size = stripParens(args[1]);
    const sized = size.kind === 'SizeofExpr' ? what(size.arg) : null;
    if (!data || !sized || sized.name !== data.name || !sameExpr(sized.row, data.row)) return null;
    const entry = this.lookup(data.name, ctx);
    if (!entry || entry.kind !== 'var') return null;
    const ok = data.row ? BYTE_GRID_TYPES.includes(entry.v.type) : BYTE_LIST_TYPES.includes(entry.v.type);
    return ok ? { v: entry.v, row: data.row } : null;
  }

  // `byte *data = (byte *) getDatagramOnFace(face);` where face is a name or a number that the
  // function never changes, and data is only read as data[i]: the face, or null
  datagramPointer(d, ctx) {
    if (!d.type || d.type.k !== 'ptr' || !d.init || !ctx.fn.node) return null;
    let init = stripParens(d.init);
    while (init && init.kind === 'Cast') init = stripParens(init.arg);
    if (!init || init.kind !== 'Call' || init.callee.kind !== 'Ident' || init.callee.name !== 'getDatagramOnFace' || init.args.length !== 1) return null;
    const face = stripParens(init.args[0]);
    if (face.kind !== 'Num' && face.kind !== 'Ident') return null;
    let ok = true, declared = 0;
    const changes = e => {
      e = stripParens(e);
      return e && e.kind === 'Ident' && (e.name === d.name || (face.kind === 'Ident' && e.name === face.name));
    };
    const walk = (n, parent) => {
      if (!ok || !n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(x => walk(x, parent)); return; }
      if (n.kind === 'VarDecl') declared += n.decls.filter(x => x.name === d.name).length;
      if ((n.kind === 'Assign' && changes(n.target)) || ((n.kind === 'Postfix' || n.kind === 'Unary') && /^(\+\+|--|&)$/.test(n.op) && changes(n.arg))) ok = false;
      if (n.kind === 'Ident' && n.name === d.name && !(parent && parent.kind === 'Index' && stripParens(parent.obj) === n)) ok = false;
      // writing through it (data[i] = …) changes the datagram, which blocks can't do
      if (n.kind === 'Assign' && stripParens(n.target).kind === 'Index' && changes(stripParens(n.target).obj)) ok = false;
      for (const k of Object.keys(n)) if (k !== 'type' && n[k] && typeof n[k] === 'object') walk(n[k], n);
    };
    walk(ctx.fn.node.body, null);
    return ok && declared === 1 ? face : null;
  }

  // A Timer variable, or an item of a list of timers, used as `t.method(...)` or `t[i].method(...)`: { v, index }
  timerOf(callee, method, ctx) {
    if (!callee || callee.kind !== 'Member' || callee.arrow || callee.prop !== method) return null;
    let obj = stripParens(callee.obj), index = null;
    if (obj.kind === 'Index') { index = obj.index; obj = stripParens(obj.obj); }
    if (obj.kind !== 'Ident') return null;
    const entry = this.lookup(obj.name, ctx);
    if (!entry || entry.kind !== 'var' || entry.v.type !== (index ? TIMER_LIST : 'Timer')) return null;
    return { v: entry.v, index };
  }

  // A timer block for a timer, or for an item of a list of timers (with its "item" slot)
  timerBlock(type, t, ctx) {
    const json = { type, fields: { TIMER: { id: t.v.id } } };
    if (t.index) { json.extraState = { item: true }; json.inputs = { INDEX: this.slot(t.index, N, ctx, 0) }; }
    return json;
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
    args.forEach((a, i) => { json.inputs['ARG' + i] = this.slot(a, inputCheck(p.params[i].type), ctx); });
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
        // an item of the datagram waiting on a face: getDatagramOnFace(f)[i], or data[i] where data
        // points at it (see datagramPointer)
        const pointer = stripParens(e.obj).kind === 'Ident' ? this.lookup(stripParens(e.obj).name, ctx) : null;
        if (pointer && pointer.kind === 'datagram') {
          return { json: { type: 'bk_dg_item', inputs: { INDEX: this.slot(e.index, N, ctx, 0), FACE: this.slot(pointer.face, N, ctx, 0) } }, out: N };
        }
        const call = stripParens(e.obj);
        if (call.kind === 'Call' && call.callee.kind === 'Ident' && call.callee.name === 'getDatagramOnFace' && call.args.length === 1 && !this.lookup('getDatagramOnFace', ctx)) {
          return { json: { type: 'bk_dg_item', inputs: { INDEX: this.slot(e.index, N, ctx, 0), FACE: this.slot(call.args[0], N, ctx, 0) } }, out: N };
        }
        const li = this.listItem(e, ctx);
        if (!li) throw new Unsupported('index');
        const kind = listKind(li.v.type);
        const inputs = { ...(li.row ? { ROW: this.slot(li.row, N, ctx, 0) } : {}), INDEX: this.slot(li.index, N, ctx, 0) };
        return { json: { type: (li.row ? 'bk_grid_get_' : 'bk_list_get_') + kind, fields: { LIST: { id: li.v.id } }, inputs }, out: KIND_CHECK[kind] };
      }
      case 'Ident': {
        const entry = this.lookup(e.name, ctx);
        if (!entry && this.enumNames.has(e.name)) return { json: { type: 'bk_enum_value', fields: { NAME: e.name } }, out: N };
        if (!entry || entry.kind === 'raw' || entry.kind === 'datagram') throw new Unsupported('name');
        if (entry.kind === 'face') return { json: { type: 'bk_face_var', fields: { VAR: { id: entry.v.id } } }, out: N };
        const kind = kindOf(entry.v.type);
        // a whole list or grid, given to a function
        if (isList(entry.v.type) && entry.v.type !== TIMER_LIST) return { json: { type: 'bk_list_pass', fields: { LIST: { id: entry.v.id } } }, out: listCheck(entry.v.type) };
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
          if ((done || left) && !e.args.length) return { json: this.timerBlock(done ? 'bk_timer_done' : 'bk_timer_left', done || left, ctx), out: done ? B : N };
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
        if (p && p.ret !== 'void' && e.args.length === p.params.length) return { json: this.procCall(null, 'procedures_callreturn', p, e.args, ctx), out: KIND_CHECK[kindOf(p.ret)] };
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
      let arg = div && div.kind === 'Binary' && div.op === '/' && div.l.kind === 'SizeofExpr' ? stripParens(div.l.arg) : null;
      // COUNT_OF(grid) is its number of rows, COUNT_OF(grid[0]) the items in each row
      const row = arg && arg.kind === 'Index' && stripParens(arg.index).kind === 'Num' && stripParens(arg.index).value === 0;
      if (row) arg = stripParens(arg.obj);
      const entry = arg && arg.kind === 'Ident' ? this.lookup(arg.name, ctx) : null;
      if (entry && entry.kind === 'var' && isGrid(entry.v.type)) return { json: { type: 'bk_grid_size', fields: { WHAT: row ? 'COLS' : 'ROWS', LIST: { id: entry.v.id } } }, out: N };
      if (entry && entry.kind === 'var' && isList(entry.v.type) && !row) return { json: { type: 'bk_list_length', fields: { LIST: { id: entry.v.id } } }, out: N };
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
      { type: 'bk_loop', x: 0, y: 100, next: { block: {
        type: 'controls_if', inputs: {
          IF0: { block: { type: 'bk_button', fields: { EVENT: 'buttonSingleClicked' } } },
          DO0: { block: { type: 'bk_set_color', inputs: { COLOR: { shadow: colorBlock('RED'), block: { type: 'bk_random_color' } } } } },
        },
      } } },
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
        block('bk_setup'), block('bk_loop'),
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
        { kind: 'sep', gap: 24 },
        block('bk_dg_send', { inputs: { FACE: num(0) } }), call('bk_dg_ready'), call('bk_dg_length'),
        block('bk_dg_item', { inputs: { INDEX: num(0), FACE: num(0) } }), call('bk_dg_done'),
      ]),
      cat('Time', 'time', [
        block('bk_timer_set', { inputs: { MS: num(1000) } }), block('bk_timer_done'), block('bk_timer_left'),
        block('bk_timer_add', { inputs: { MS: num(1000) } }), block('bk_timer_never'), call('bk_millis'), call('bk_woken'),
      ]),
      cat('Control', 'control', [
        block('controls_if', { inputs: { IF0: bool } }),
        block('controls_if', { extraState: { hasElse: true } }),
        block('controls_repeat_ext', { inputs: { TIMES: num(6) } }),
        block('controls_whileUntil'),
        block('bk_for', { fields: { VAR: { name: 'i', type: localType('int') }, DIR: '<' }, inputs: { FROM: num(0), TO: num(6), BY: num(1) } }),
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
// pill), change, and below a rule each variable, global ones and then local ones, ready to drag
function variablesFlyout(ws) {
  const vm = ws.getVariableMap();
  const of = types => vm.getAllVariables().filter(v => types.includes(v.type)).sort((a, b) => a.name.localeCompare(b.name));
  const items = [heading('Variables'), { kind: 'button', text: 'Make a variable…', callbackkey: 'BK_MAKE_VAR' }, { kind: 'sep', gap: 24 }];
  const ref = v => ({ VAR: { id: v.getId() } });
  const value = { num: numBlock(0), bool: null, color: colorBlock('RED') };
  // (const variables are listed with the others; a global const's own block, from its C code, sets it)
  const kinds = ['num', 'bool', 'color'].map(kind => ({ kind, globals: of([...KIND_TYPES[kind], ...CONST_TYPES[kind]]), locals: of([...LOCAL_TYPES[kind], ...LOCAL_CONST_TYPES[kind]]) }));
  const globals = kinds.flatMap(k => k.globals.map(v => [k.kind, v])), locals = kinds.flatMap(k => k.locals.map(v => [k.kind, v]));
  const setOf = (fields, kind) => ({ kind: 'block', type: SETTER[kind], fields, inputs: value[kind] ? { VALUE: { shadow: value[kind] } } : {} });
  const global = globals.find(([, v]) => !isConstType(v.type));
  if (global) items.push(setOf(ref(global[1]), global[0]));
  // an example local variable to drag out (it makes a local x if there isn't one)
  const local = locals.find(([, v]) => !isConstType(v.type));
  items.push(local ? setOf(ref(local[1]), local[0]) : setOf({ VAR: { name: 'x', type: localType('int') } }, 'num'));
  const nums = [...kinds[0].globals, ...kinds[0].locals].filter(v => !isConstType(v.type));
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

// "Make a variable…": a name, what it holds, and whether it's global or local to its event or function.
// (Const variables come from C code: const byte MAX = 5; they aren't made here.)
// With a variable, the same window edits it: its name, number type and scope (what it holds stays,
// since blocks use it as that), and it can delete it.
function makeVariable(Blockly, ws, editing = null) {
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
  if (editing) {
    const holds = kindOf(editing.type) === 'num' ? 'num' : baseType(editing.type);
    wrap.querySelector('.bk-dialog-title').textContent = `Edit ${editing.name}`;
    form.setAttribute('aria-label', `Edit ${editing.name}`);
    name.value = editing.name;
    for (const r of form.elements.kind) { r.checked = r.value === holds; r.disabled = r.value !== holds; }
    if (holds === 'num') for (const r of form.elements.numtype) r.checked = r.value === baseType(editing.type);
    form.elements.scope.value = isLocalType(editing.type) ? 'local' : 'global';
    // a const (from C code: there's no box for it here) keeps its scope: a global one has its block,
    // a local one is set where it's used
    if (isConstType(editing.type)) for (const r of form.elements.scope) r.disabled = !r.checked;
    form.querySelector('button[type="submit"]').textContent = 'Save';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'bk-btn bk-btn-danger';
    del.dataset.act = 'delete';
    del.textContent = 'Delete';
    form.querySelector('.bk-dialog-actions').prepend(del);
  }
  const sync = () => {
    const kind = form.elements.kind.value, timer = kind === 'Timer';
    form.querySelector('input[value="local"]').disabled = timer;
    if (timer) form.elements.scope.value = 'global';
    form.querySelector('.bk-number-types').hidden = kind !== 'num';
    const type = kind === 'num' ? form.elements.numtype.value : kind;
    const holds = `${aType(type)}${type === 'bool' ? ' (boolean)' : ''} holds ${typeInfo(type)}. `;
    const fixed = !!editing && isConstType(editing.type);
    hint.textContent = holds + (form.elements.scope.value === 'local'
      ? (fixed ? 'Local const: made, with its value, where it\'s set in its event or function, and never changed after.'
        : 'Local: belongs to the event or function where it\'s set, and starts fresh each time it runs.')
      : (fixed ? 'Global const: every event and function can use it; its value is set once, in its own const block.'
        : 'Global: every event and function shares it, and it keeps its value.'));
  };
  sync();
  form.addEventListener('change', sync);
  const stop = typeExamples(form, () => (form.elements.kind.value === 'num' ? form.elements.numtype.value : form.elements.kind.value));
  const close = () => { stop(); wrap.remove(); };
  wrap.addEventListener('click', e => {
    if (e.target === wrap || e.target.dataset.act === 'cancel') close();
    // (Blockly asks first when blocks use it, and deletes those blocks too)
    if (e.target.dataset.act === 'delete') { close(); ws.deleteVariableById(editing.getId()); }
  });
  wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = name.value.trim();
    const kind = form.elements.kind.value === 'num' ? form.elements.numtype.value : form.elements.kind.value;
    const local = form.elements.scope.value === 'local';
    const type = editing && isConstType(editing.type) ? constType(kind, local) : local ? localType(kind) : kind;
    if (!text) { err.textContent = 'Give it a name.'; return; }
    if (!/^[A-Za-z_]\w*$/.test(text)) { err.textContent = 'Use letters, numbers and _ (not starting with a number).'; return; }
    // names are unique among the global variables and among the local ones (a local may share a global's name)
    const taken = ws.getVariableMap().getAllVariables().some(v => v !== editing && v.type !== 'face' && isLocalType(v.type) === isLocalType(type) && v.name.toLowerCase() === text.toLowerCase());
    if (taken) { err.textContent = `There's already a ${isLocalType(type) ? 'local' : 'global'} variable called ${text}.`; return; }
    Blockly.Events.setGroup(true);
    try {
      if (!editing) ws.getVariableMap().createVariable(text, type);
      else {
        if (text !== editing.name) ws.renameVariableById(editing.getId(), text);
        if (type !== editing.type) ws.getVariableMap().changeVariableType(editing, type);
      }
    } finally { Blockly.Events.setGroup(false); }
    // redraw the blocks that show it (their "local" pills, tooltips and menus)
    if (editing) for (const b of ws.getAllBlocks(false)) for (const input of b.inputList) for (const f of input.fieldRow) if (f.getValue && f.getValue() === editing.getId() && f.forceRerender) f.forceRerender();
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
  if (defines.length) items.push(subheading('Defines'), ...defines.map(name => ({ kind: 'block', type: 'bk_define_value', fields: { NAME: name }, gap: 8 })));
  if (defines.length && enumNames.length) items.push({ kind: 'sep', gap: 16 });
  if (enumNames.length) items.push(subheading('Enums'), ...enumNames.map(name => ({ kind: 'block', type: 'bk_enum_value', fields: { NAME: name }, gap: 8 })));
  return items;
}

// Lists, like variables: the make buttons and the blocks that set up and change lists, timer lists
// and grids, then below a rule an item of each list on the page, ready to drag
function listsFlyout(ws) {
  const all = ws.getVariableMap().getAllVariables().filter(v => isList(v.type)).sort((a, b) => a.name.localeCompare(b.name));
  const lists = all.filter(v => !isGrid(v.type) && v.type !== TIMER_LIST);
  const timerLists = all.filter(v => v.type === TIMER_LIST), grids = all.filter(v => isGrid(v.type));
  const items = [
    heading('Lists'),
    { kind: 'button', text: 'Make a number list', callbackkey: 'BK_LIST_int[]' },
    { kind: 'button', text: 'Make a true/false list', callbackkey: 'BK_LIST_bool[]' },
    { kind: 'button', text: 'Make a color list', callbackkey: 'BK_LIST_Color[]' },
    { kind: 'button', text: 'Make a timer list', callbackkey: 'BK_LIST_Timer[]' },
    { kind: 'button', text: 'Make a grid (rows of numbers)', callbackkey: 'BK_LIST_int[][]' },
  ];
  if (!all.length) return items;
  const ref = v => ({ LIST: { id: v.getId() } });
  const index = { INDEX: { shadow: numBlock(0) } }, place = { ROW: { shadow: numBlock(0) }, ...index };
  const value = kind => (kind === 'num' ? { VALUE: { shadow: numBlock(0) } } : kind === 'color' ? { VALUE: { shadow: colorBlock('RED') } } : {});
  const samples = kind => ({ num: [1, 2, 3].map(numBlock), color: ['RED', 'GREEN', 'BLUE'].map(colorBlock), bool: [true, false, true].map(b => ({ type: 'bk_bool', fields: { BOOL: b ? 'TRUE' : 'FALSE' } })) }[kind]);
  const firstOf = (of, kind) => of.find(v => listKind(v.type) === kind);
  const timerItem = v => ({ fields: { TIMER: { id: v.getId() } }, extraState: { item: true } });
  items.push({ kind: 'sep', gap: 24 });

  // lists: set one up (with a size, or with its items), set or change an item, the length
  if (lists.length || timerLists.length) items.push({ kind: 'block', type: 'bk_list_decl', fields: { ...ref(lists[0] || timerLists[0]), COUNT: LIST_SIZE } });
  if (lists.length) {
    const kind0 = listKind(lists[0].type);
    items.push({ kind: 'block', type: 'bk_list_init', fields: ref(lists[0]), extraState: { items: 3, kind: kind0 },
      inputs: Object.fromEntries(samples(kind0).map((b, i) => ['ITEM' + i, itemInput(kind0, b)])) });
    for (const kind of ['num', 'bool', 'color']) {
      const v = firstOf(lists, kind);
      if (v) items.push({ kind: 'block', type: 'bk_list_set_' + kind, fields: ref(v), inputs: { ...index, ...value(kind) } });
    }
    const nums = firstOf(lists, 'num');
    if (nums) items.push({ kind: 'block', type: 'bk_list_change', fields: ref(nums), inputs: { ...index, DELTA: { shadow: numBlock(1) } } });
  }
  // a list of timers is used with the timer blocks, with an item slot
  if (timerLists.length) items.push({ kind: 'block', type: 'bk_timer_set', ...timerItem(timerLists[0]), inputs: { ...index, MS: { shadow: numBlock(1000) } } });
  if (lists.length || timerLists.length) items.push({ kind: 'block', type: 'bk_list_length', fields: ref(lists[0] || timerLists[0]) });
  // grids
  if (grids.length) {
    const kind0 = listKind(grids[0].type), sample = samples(kind0);
    items.push({ kind: 'sep', gap: 24 },
      { kind: 'block', type: 'bk_grid_decl', fields: { ...ref(grids[0]), ROWS: 3, COLS: 3 } },
      { kind: 'block', type: 'bk_grid_init', fields: ref(grids[0]), extraState: { rows: 2, cols: 3, kind: kind0 },
        inputs: Object.fromEntries([0, 1].flatMap(r => sample.map((b, c) => [`ITEM${r}_${c}`, itemInput(kind0, r ? null : b)]))) });
    for (const kind of ['num', 'bool', 'color']) {
      const v = firstOf(grids, kind);
      if (v) items.push({ kind: 'block', type: 'bk_grid_set_' + kind, fields: ref(v), inputs: { ...place, ...value(kind) } });
    }
    const nums = firstOf(grids, 'num');
    if (nums) items.push({ kind: 'block', type: 'bk_grid_change', fields: ref(nums), inputs: { ...place, DELTA: { shadow: numBlock(1) } } });
    items.push({ kind: 'block', type: 'bk_grid_size', fields: ref(grids[0]) });
  }
  // a whole list or grid, to give to a function that takes one
  if (lists.length || grids.length) items.push({ kind: 'sep', gap: 24 }, { kind: 'block', type: 'bk_list_pass', fields: ref(lists[0] || grids[0]) });

  // below a rule, an item of each list on the page
  items.push(...rule());
  // (local ones, set up inside an event or function, under their own heading, like local variables)
  const scoped = (name, of, block) => {
    const local = of.filter(v => isLocalList(ws, v.getId()));
    return [[name, of.filter(v => !local.includes(v)).map(block)], ['Local ' + name.toLowerCase(), local.map(block)]];
  };
  const groups = [
    ...scoped('Lists', lists, v => ({ kind: 'block', type: 'bk_list_get_' + listKind(v.type), fields: ref(v), inputs: index, gap: 8 })),
    ...scoped('Timer lists', timerLists, v => ({ kind: 'block', type: 'bk_timer_done', ...timerItem(v), inputs: index, gap: 8 })),
    ...scoped('Grids', grids, v => ({ kind: 'block', type: 'bk_grid_get_' + listKind(v.type), fields: ref(v), inputs: place, gap: 8 })),
  ].filter(([, blocks]) => blocks.length);
  groups.forEach(([name, blocks], i) => items.push(...(i ? [{ kind: 'sep', gap: 16 }] : []), subheading(name), ...blocks));
  return items;
}

// "Make a … list": name it, then put a block that sets it up on the workspace
function makeList(Blockly, ws, type) {
  const title = Blockly.Msg.NEW_VARIABLE_TITLE;
  Blockly.Msg.NEW_VARIABLE_TITLE = isGrid(type) ? 'New grid name:' : 'New list name:';
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
    placeBlock(Blockly, ws, isGrid(v.type) ? { type: 'bk_grid_decl', fields: { LIST: { id: v.getId() }, ROWS: 3, COLS: 3 } }
      : { type: 'bk_list_decl', fields: { LIST: { id: v.getId() }, COUNT: LIST_SIZE } });
  } finally {
    Blockly.Events.setGroup(false);
  }
}
// Put a new block near the top left of what's on screen, clear of an open drawer
function placeBlock(Blockly, ws, json) {
  const b = Blockly.serialization.blocks.append(json, ws, { recordUndo: true });
  const view = ws.getMetricsManager().getViewMetrics(true);
  const flyout = ws.getFlyout && ws.getFlyout();
  const left = flyout && flyout.isVisible() ? flyout.getWidth() / ws.scale : 0;
  b.moveBy(view.left + left + 32, view.top + 32);
  return b;
}

// Functions: the blocks that make a function; below a rule the blocks that leave one; and below
// another rule a call to each function on the page, ready to drag
function functionsFlyout(Blockly, ws) {
  const made = Blockly.Procedures.flyoutCategory(ws, false);
  const defs = made.filter(it => it.type === 'procedures_defnoreturn' || it.type === 'procedures_defreturn');
  const calls = made.filter(it => it.type === 'procedures_callnoreturn' || it.type === 'procedures_callreturn').map(it => ({ ...it, gap: 8 }));
  const items = [heading('Functions'), ...defs, ...rule(), subheading('Inside a function'), { kind: 'block', type: 'bk_return' }, { kind: 'block', type: 'bk_return_value' }];
  if (calls.length) items.push(...rule(), subheading('Your functions'), ...calls);
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
// own prompt() and confirm() are blocked in some embedded browsers. `ok` names the OK button, and
// `danger` marks it as one that takes something away.
function openAsk(message, value, done, { ok = 'OK', danger = false } = {}) {
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
      <button type="button" class="bk-btn ${danger ? 'bk-btn-danger' : 'bk-btn-primary'}" data-act="ok"></button></div></div>`;
  wrap.querySelector('.bk-dialog-message').textContent = message;
  wrap.querySelector('[data-act="ok"]').textContent = ok;
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
  setTimeout(() => { (input || wrap.querySelector('[data-act="ok"]')).focus(); if (input) input.select(); }, 0);
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
      // wheel: a trackpad pinch (or ⌘/Ctrl + scroll) zooms; plain scrolling still moves around
      zoom: { controls: false, wheel: true, pinch: true, startScale: small ? 0.8 : 0.9, maxScale: 2, minScale: 0.4, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: true },
      oneBasedIndex: false,
    });
    animateFlyout(ws.getToolbox()?.getFlyout());
    decorateRules(ws.getToolbox()?.getFlyout());
    variablePencils(Blockly, ws, ws.getToolbox()?.getFlyout());
    safariPinch(Blockly, ws, host);
    addNavigation(ws, host);
    trashDrawer(Blockly, ws);
    trashCanArt(Blockly, ws);
    if (!small) addMinimap(Blockly, ws, host);
    ws.registerToolboxCategoryCallback('BK_VARIABLES', variablesFlyout);
    ws.registerToolboxCategoryCallback('BK_FUNCTIONS', w => functionsFlyout(Blockly, w));
    ws.registerToolboxCategoryCallback('BK_LISTS', listsFlyout);
    ws.registerToolboxCategoryCallback('BK_CONSTANTS', constantsFlyout);
    for (const type of ['int[]', 'bool[]', 'Color[]', TIMER_LIST, 'int[][]']) {
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
  // comments made on the workspace get their size and grip once they're drawn
  if (ws.rendered) {
    ws.addChangeListener(e => {
      if (e.type === Blockly.Events.COMMENT_CREATE) setTimeout(() => decorateWorkspaceComment(Blockly, ws.getCommentById(e.commentId)), 0);
    });
  }
  const spacing = ws.rendered ? keepSpacing(Blockly, ws, () => loading) : { measure() {} };
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
      // calls loaded before their function take its shape now
      for (const d of ws.getBlocksByType('procedures_defreturn', false)) d.fitReturn_();
      for (const b of ws.getBlocksByType('bk_list_pass', false)) b.fit_();
      for (const b of ws.getAllBlocks(false)) if (b.fitInputs_) b.fitInputs_();
      if (ws.rendered) {
        pendingLayout = !host.clientWidth;
        if (!pendingLayout) layout(ws);
      }
    } finally {
      Blockly.Events.enable();
      ws.clearUndo();
      loading = false;
    }
    spacing.measure();
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
        spacing.measure();
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

// In a drawer, pointing at one of the things you've made shows a pencil beside it to edit it:
// - a variable: its "Make a variable" window
// - a list, timer list or grid: a small window to rename or delete it (its size and starting items
//   are on its setup block)
// - a constant (a define or an enum name) or a function: the block that makes it, with its name ready
//   to edit
function variablePencils(Blockly, ws, flyout) {
  if (!flyout) return;
  const svg = Blockly.utils.dom.createSvgElement, S = Blockly.utils.Svg;
  const variableOf = (block, field) => block.getField(field) && block.getField(field).getVariable();
  // what the pencil next to a drawer block edits: { name, edit() }, or null
  const target = block => {
    if (Object.values(GETTER).includes(block.type)) {
      const v = variableOf(block, 'VAR');
      return v && { name: v.name, edit: () => makeVariable(Blockly, ws, v) };
    }
    if (/^bk_(list|grid)_get_/.test(block.type) || (block.type === 'bk_timer_done' && block.getInput('INDEX'))) {
      const v = variableOf(block, block.getField('LIST') ? 'LIST' : 'TIMER');
      return v && { name: v.name, edit: () => editList(Blockly, ws, v) };
    }
    if (block.type === 'bk_define_value' || block.type === 'bk_enum_value') {
      const name = block.getFieldValue('NAME');
      return { name, edit: () => {
        for (const b of ws.getAllBlocks(false)) {
          if (b.type === 'bk_define' && block.type === 'bk_define_value' && b.getFieldValue('NAME') === name) return goToName(Blockly, ws, b, 'NAME');
          if (b.type === 'bk_enum' && block.type === 'bk_enum_value') {
            for (let i = 0; b.getField('ITEM' + i); i++) if (b.getFieldValue('ITEM' + i) === name) return goToName(Blockly, ws, b, 'ITEM' + i);
          }
        }
      } };
    }
    if (block.type === 'procedures_callnoreturn' || block.type === 'procedures_callreturn') {
      const name = block.getFieldValue('NAME');
      return { name, edit: () => { const def = Blockly.Procedures.getDefinition(name, ws); if (def) goToName(Blockly, ws, def, 'NAME'); } };
    }
    return null;
  };
  const show = flyout.show.bind(flyout);
  flyout.show = (...args) => {
    const result = show(...args);
    for (const block of flyout.getWorkspace().getTopBlocks(false)) {
      const t = target(block);
      if (!t) continue;
      const pencil = svg(S.G, { class: 'bkVarPencil', role: 'button', transform: `translate(${block.width + 6}, ${block.height / 2 - 11})` }, block.getSvgRoot());
      svg(S.RECT, { class: 'bkPencilBridge', x: -8, width: 30, height: 22 }, pencil);   // keeps the hover across the gap
      svg(S.RECT, { class: 'bkPencilDot', width: 22, height: 22, rx: 11, ry: 11 }, pencil);
      svg(S.PATH, { d: 'M7 15l.6-2.6 6-6 2 2-6 6zM12.6 7.4l2 2' }, pencil);
      svg('title', {}, pencil).textContent = `Edit ${t.name}`;
      // its own click, not the start of dragging the block out
      pencil.addEventListener('pointerdown', e => e.stopPropagation());
      pencil.addEventListener('click', e => { e.stopPropagation(); t.edit(); });
    }
    return result;
  };
}

// Show a block on the workspace (the drawer closes) and open its name for editing
function goToName(Blockly, ws, block, field) {
  const tb = ws.getToolbox && ws.getToolbox();
  if (tb) tb.clearSelection();
  ws.centerOnBlock(block.id);
  block.select();
  setTimeout(() => { const f = block.getField(field); if (f && f.showEditor) f.showEditor(); }, 250);
}

// "Edit list": rename or delete a list, timer list or grid
function editList(Blockly, ws, v) {
  const host = ws.getInjectionDiv().parentElement;
  const wrap = document.createElement('div');
  wrap.className = 'bk-dialog';
  const what = isGrid(v.type) ? 'grid' : 'list';
  wrap.innerHTML = `<form class="bk-dialog-card bk-dialog-small" role="dialog" autocomplete="off">
    <div class="bk-dialog-title bk-dialog-message"></div>
    <input class="bk-dialog-input" name="name" spellcheck="false" autocapitalize="off">
    <div class="bk-dialog-hint"></div>
    <div class="bk-dialog-actions">
      <button type="button" class="bk-btn bk-btn-danger" data-act="delete">Delete</button>
      <span class="bk-dialog-hint bk-make-err"></span>
      <button type="button" class="bk-btn" data-act="cancel">Cancel</button>
      <button type="submit" class="bk-btn bk-btn-primary">Save</button></div></form>`;
  const form = wrap.querySelector('form'), name = form.elements.name, err = wrap.querySelector('.bk-make-err');
  wrap.querySelector('.bk-dialog-title').textContent = `Edit ${v.name}`;
  form.setAttribute('aria-label', `Edit ${v.name}`);
  form.querySelector('.bk-dialog-hint').textContent = `Its size and starting items are on the block that sets the ${what} up.`;
  name.value = v.name;
  const close = () => wrap.remove();
  wrap.addEventListener('click', e => {
    if (e.target === wrap || e.target.dataset.act === 'cancel') close();
    // (Blockly asks first when blocks use it, and deletes those blocks too)
    if (e.target.dataset.act === 'delete') { close(); ws.deleteVariableById(v.getId()); }
  });
  wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = name.value.trim();
    if (!text) { err.textContent = 'Give it a name.'; return; }
    if (!/^[A-Za-z_]\w*$/.test(text)) { err.textContent = 'Use letters, numbers and _.'; return; }
    const taken = ws.getVariableMap().getAllVariables().some(o => o !== v && o.type !== 'face' && !isLocalType(o.type) && o.name.toLowerCase() === text.toLowerCase());
    if (taken) { err.textContent = `${text} is already taken.`; return; }
    if (text !== v.name) {
      Blockly.Events.setGroup(true);
      try { ws.renameVariableById(v.getId(), text); } finally { Blockly.Events.setGroup(false); }
    }
    close();
    const tb = ws.getToolbox && ws.getToolbox();
    if (tb && tb.refreshSelection) tb.refreshSelection();
  });
  host.appendChild(wrap);
  setTimeout(() => { name.focus(); name.select(); }, 0);
}

// Slide the block drawer in and out instead of popping it. Blockly shows and hides the
// flyout (and its scrollbar) in updateDisplay(), so closing waits for the slide to finish.
// A flyout slides in from `from` (the toolbox's from the left, the trash drawer's from below)
function animateFlyout(flyout, from = '-16px 0') {
  if (!flyout || !Element.prototype.animate) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const update = flyout.updateDisplay.bind(flyout);
  const parts = () => [flyout.svgGroup_, flyout.workspace_?.scrollbar?.vScroll?.outerSvg, flyout.workspace_?.scrollbar?.hScroll?.outerSvg].filter(Boolean);
  const OUT = { opacity: 0, translate: from }, IN = { opacity: 1, translate: '0 0' };
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

// The trash can opens a drawer that slides up along the bottom, holding what was thrown away. The
// blocks in it are ghostly (see blocks.css), so they read as out of use; drag one out to use it again.
// It's a vertical flyout (so it scrolls up and down) laid out along the bottom: its items wrap into
// rows, the heading on a row of its own, stopping short of the close button, and the drawer is as
// tall as its rows, up to most of the editor.
const CLOSE_ROOM = 52;   // the close button, the scrollbar and a margin, in screen pixels
const DRAWER_MIN = 160;  // the drawer opens at least this tall
const TRASH_GAP = 16;    // between the items in the drawer, across and down
function trashDrawer(Blockly, ws) {
  const trash = ws.trashcan;
  if (!trash || !trash.flyout) return;
  trash.flyout.dispose();
  const options = ws.copyOptionsForFlyout();
  options.toolboxPosition = Blockly.utils.toolbox.Position.RIGHT;
  const Flyout = Blockly.registry.getClassFromOptions(Blockly.registry.Type.FLYOUTS_VERTICAL_TOOLBOX, ws.options, true);
  const flyout = trash.flyout = new Flyout(options);
  const dom = flyout.createDom(Blockly.utils.Svg.SVG);
  dom.classList.add('blocklyTrashcanFlyout', 'bkTrashDrawer');
  Blockly.utils.dom.insertAfter(dom, ws.getParentSvg());
  flyout.init(ws);

  const metrics = () => ws.getMetricsManager();
  const isGap = el => el instanceof Blockly.FlyoutSeparator;
  let height = 0;
  flyout.layout_ = function (contents) {
    this.workspace_.scale = this.targetWorkspace.scale;
    const M = this.MARGIN, scale = this.workspace_.scale;
    const room = metrics().getViewMetrics().width / scale - M - CLOSE_ROOM / scale;
    let x = M, y = M, rowHeight = 0, gap = 0, newRow = false;
    for (const item of contents) {
      const el = item.getElement(), r = el.getBoundingRectangle();
      if (isGap(el)) { gap = r.getWidth(); continue; }
      const w = r.getWidth(), h = r.getHeight();
      // (a little more room under the heading, for the buttons beside it)
      if (newRow || (x > M && x + (gap || TRASH_GAP) + w > room)) { x = M; y += rowHeight + TRASH_GAP + (newRow ? 4 : 0); rowHeight = 0; gap = 0; }
      if (x > M) x += gap || TRASH_GAP;
      el.moveBy(x - r.left, y - r.top);
      x += w;
      rowHeight = Math.max(rowHeight, h);
      gap = 0;
      newRow = item.getType() === 'label';
    }
  };
  flyout.reflowInternal_ = function () {
    this.workspace_.scale = this.getFlyoutScale();
    const bottom = this.getContents().reduce((b, c) => Math.max(b, c.getElement().getBoundingRectangle().bottom), 0);
    height = Math.min((bottom + this.MARGIN) * this.workspace_.scale, metrics().getViewMetrics().height * 0.7);
    this.position();
    this.targetWorkspace.resizeContents();
    this.targetWorkspace.recordDragTargets();
  };
  // along the bottom, from where the block categories end to the right edge, with rounded top corners
  flyout.position = function () {
    if (!this.isVisible() || !this.targetWorkspace.isVisible()) return;
    const view = metrics().getViewMetrics(), abs = metrics().getAbsoluteMetrics();
    const w = this.width_ = view.width, h = this.height_ = Math.max(height, Math.min(DRAWER_MIN, view.height * 0.7)), r = 12;
    this.svgBackground_.setAttribute('d', `M0,${r}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}h${-w}z`);
    this.positionAt_(w, h, abs.left, abs.top + view.height - h);
    placeClose();
  };
  // any drag on a block takes it out (the drawer scrolls with the wheel or its scrollbar)
  flyout.isDragTowardWorkspace = () => true;
  animateFlyout(flyout, '0 24px');

  // which entry in the trash each block in the drawer came from, so taking one out removes it
  const from = new WeakMap();
  const show = flyout.show.bind(flyout);
  flyout.show = contents => {
    const entries = trash.contents.slice();
    show([{ kind: 'label', text: 'Trash  ·  drag a block out to use it again', 'web-class': 'bkTrashLabel' }, ...contents]);
    flyout.getWorkspace().getTopBlocks(false).forEach((b, i) => from.set(b, entries[i]));
  };
  const createBlock = flyout.createBlock.bind(flyout);
  flyout.createBlock = original => {
    const block = createBlock(original);
    const i = trash.contents.indexOf(from.get(original));
    if (i >= 0) trash.contents.splice(i, 1);
    if (!trash.hasContents()) trash.setMinOpenness(0);
    return block;
  };
  // a close button in the drawer's top right corner
  const svg = Blockly.utils.dom.createSvgElement, S = Blockly.utils.Svg;
  const close = svg(S.G, { class: 'bkTrashClose', role: 'button', 'aria-label': 'Close the trash' }, dom);
  svg(S.CIRCLE, { cx: 12, cy: 12, r: 12 }, close);
  svg(S.PATH, { d: 'M8 8l8 8M16 8l-8 8' }, close);
  svg('title', {}, close).textContent = 'Close';
  close.addEventListener('pointerdown', e => e.stopPropagation());
  close.addEventListener('click', e => { e.stopPropagation(); trash.closeFlyout(); });
  // and an "Empty trash" button beside it
  const empty = svg(S.G, { class: 'bkTrashEmpty', role: 'button' }, dom);
  const emptyBox = svg(S.RECT, { height: 24, rx: 12, ry: 12 }, empty);
  // a trash can on fire
  const fire = svg(S.G, { class: 'bkTrashFire', transform: 'translate(8, 3.5) scale(.3)' }, empty);
  for (const [cls, d] of [['bkFireFlames', CAN.FLAMES], ['bkFireCan', CAN.FULL], ['bkFireCan', CAN.LID]]) svg(S.PATH, { class: cls, d }, fire);
  fire.lastChild.setAttribute('transform', 'translate(-2, -9) rotate(-12, 5, 17)');   // the lid blown up off the flames
  const emptyText = svg(S.TEXT, { x: 26, y: 16.5 }, empty);
  emptyText.textContent = 'Empty trash';
  empty.addEventListener('pointerdown', e => e.stopPropagation());
  empty.addEventListener('click', e => { e.stopPropagation(); trash.emptyContents(); });
  // a comment deleted from the workspace goes in the trash too (Blockly's trash only keeps blocks)
  const converted = new Set();   // trashed-comment blocks turned back into comments
  ws.addChangeListener(e => {
    // the block that stood in for a comment went away when the comment came back: Blockly's trash
    // (which hears about it first) shouldn't keep it
    if (e.type === Blockly.Events.BLOCK_DELETE && converted.delete(e.blockId) && e.oldJson) {
      const i = trash.contents.indexOf(JSON.stringify(trash.cleanBlockJson(e.oldJson)));
      if (i >= 0) trash.contents.splice(i, 1);
      return;
    }
    if (e.type === Blockly.Events.COMMENT_DELETE && e.json && e.recordUndo && ws.options.maxTrashcanContents > 0) {
      const { x, y, ...comment } = e.json;
      const entry = JSON.stringify({ kind: 'BLOCK', type: 'bk_trashed_comment', extraState: { comment } });
      if (!trash.contents.includes(entry)) {
        trash.contents.unshift(entry);
        trash.contents.length = Math.min(trash.contents.length, ws.options.maxTrashcanContents);
      }
    }
    // a trashed comment dragged back out and let go becomes the comment again, where it was dropped
    if (e.type === Blockly.Events.BLOCK_DRAG && !e.isStart) {
      const block = ws.getBlockById(e.blockId);
      if (!block || block.type !== 'bk_trashed_comment') return;
      const at = block.getRelativeToSurfaceXY();
      Blockly.Events.setGroup(e.group || true);
      try {
        Blockly.serialization.workspaceComments.append({ ...block.comment_, x: at.x, y: at.y }, ws);
        converted.add(block.id);
        block.dispose(false);
      } finally {
        Blockly.Events.setGroup(false);
      }
    }
  });
  const placeClose = () => {
    close.setAttribute('transform', `translate(${flyout.getWidth() - 44}, 8)`);
    let w = 0;
    try { w = emptyText.getComputedTextLength(); } catch (err) { /* not laid out yet */ }
    emptyBox.setAttribute('width', w + 38);
    empty.setAttribute('transform', `translate(${flyout.getWidth() - 44 - 8 - (w + 38)}, 8)`);
  };
}

// The trash can's shapes (in a 47 × 60 box, Blockly's trash can size)
const CAN = {
  EMPTY: 'M8 20H39L36.5 54.5Q36.2 58 33 58H14Q10.8 58 10.5 54.5Z',
  FULL: 'M8 20H39C44 30 42 47 37 54.5Q35.8 58 33 58H14Q11.2 58 10 54.5C5 47 3 30 8 20Z',
  RIBS: 'M17 25V52M23.5 25V53M30 25V52',
  LID: 'M5 14.5Q5 12.5 7 12.5H40Q42 12.5 42 14.5V17.5H5ZM19 12.5V9.5Q19 8 20.5 8H26.5Q28 8 28 9.5V12.5',
  FLAMES: 'M11 20l2.5-6 3.5 2.5 2.5-5 4 3.5 3-4.5 3 4 3.5-3 2 5 3 3.5z',
};

// Our own trash can, drawn over Blockly's (which keeps the behavior: drop blocks on it, click to open
// the drawer, a lid that opens as a block is dragged over). It's see-through at rest and outlined when
// you point at it or drag a block over it, and it bulges once something's in it.
function trashCanArt(Blockly, ws) {
  const trash = ws.trashcan;
  const group = trash && trash.svgGroup;
  if (!group) return;
  const svg = Blockly.utils.dom.createSvgElement, S = Blockly.utils.Svg;
  group.classList.add('bkCan');
  let full = false;
  const art = svg(S.G, { class: 'bkCanArt' }, group);
  const body = svg(S.G, { class: 'bkCanBody' }, art);
  const shell = svg(S.PATH, { class: 'bkCanShell', d: CAN.EMPTY }, body);
  svg(S.PATH, { class: 'bkCanRibs', d: CAN.RIBS }, body);
  const lid = svg(S.G, { class: 'bkCanLid' }, art);
  const pop = svg(S.G, { class: 'bkCanLidPop' }, lid);   // (the lid tips by its transform, and pops by this one's)
  svg(S.PATH, { class: 'bkCanLidShape', d: CAN.LID }, pop);
  // the lid tips open about its right end, as Blockly's does (but stays shut when the can's full:
  // the bulge says so)
  trash.setLidAngle = angle => { lid.setAttribute('transform', `rotate(${angle}, 40, 17)`); };
  trash.setMinOpenness = () => {};
  // drag over or point at it: outlined; Blockly's own fading is replaced by ours
  const setLidOpen = trash.setLidOpen.bind(trash);
  trash.setLidOpen = open => { group.classList.toggle('bkCanOpen', open); setLidOpen(open); };
  const update = () => {
    const now = trash.hasContents();
    if (now === full) return;
    full = now;
    group.classList.toggle('bkCanFull', full);
    shell.setAttribute('d', full ? CAN.FULL : CAN.EMPTY);
    // a little bounce as it fills
    if (full && art.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      body.animate([{ transform: 'scale(1, 1)' }, { transform: 'scale(1.12, .94)' }, { transform: 'scale(.97, 1.03)' }, { transform: 'scale(1, 1)' }],
        { duration: 420, easing: 'ease-out' });
    }
  };
  ws.addChangeListener(() => requestAnimationFrame(update));
  // emptied: once the drawer has slid away, a little fire flares up out of the can and the lid pops
  const flames = svg(S.PATH, { class: 'bkCanFlames', d: CAN.FLAMES }, art);
  art.insertBefore(flames, lid);
  const burn = () => {
    if (!art.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    flames.animate([
      { opacity: 0, transform: 'scale(.4, 0)' }, { opacity: 1, transform: 'scale(1, 1.3)', offset: 0.12 },
      { transform: 'scale(1.1, .85)', offset: 0.24 }, { transform: 'scale(.9, 1.25)', offset: 0.36 },
      { transform: 'scale(1.08, .9)', offset: 0.5 }, { transform: 'scale(.95, 1.15)', offset: 0.64 },
      { opacity: 1, transform: 'scale(1, 1)', offset: 0.78 }, { opacity: 0, transform: 'scale(.6, .2)' },
    ], { duration: 1500, easing: 'ease-in-out' });
    pop.animate([
      { transform: 'translate(0, 0)' }, { transform: 'translate(-2px, -9px) rotate(-14deg)', offset: 0.15 },
      { transform: 'translate(-1px, -6px) rotate(-8deg)', offset: 0.6 }, { transform: 'translate(0, 0)', offset: 0.85 },
      { transform: 'translate(0, -1.5px)', offset: 0.92 }, { transform: 'translate(0, 0)' },
    ], { duration: 1500, easing: 'ease-out' });
  };
  const emptyContents = trash.emptyContents.bind(trash);
  trash.emptyContents = () => {
    const had = trash.hasContents();
    emptyContents();
    update();
    if (had) setTimeout(burn, 220);
  };
  update();
}

// Zoom in, zoom out and home (back to "when Blink starts") in a row under the minimap, styled like
// the controls under the table
function addNavigation(ws, host) {
  const nav = document.createElement('div');
  nav.className = 'bk-nav';
  const button = (title, path, act) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = `<svg viewBox="0 0 20 20"><path d="${path}"/></svg>`;
    b.addEventListener('click', act);
    nav.append(b);
  };
  // a smooth move, like Blockly's own zoom buttons
  const smoothly = f => {
    ws.beginCanvasTransition();
    f();
    setTimeout(() => ws.endCanvasTransition(), 500);
  };
  button('Zoom in', 'M10 4.5v11M4.5 10h11', () => smoothly(() => ws.zoomCenter(1)));
  button('Zoom out', 'M4.5 10h11', () => smoothly(() => ws.zoomCenter(-1)));
  button('Go to "when Blink starts"', 'M3.5 9.5 10 4l6.5 5.5M5.5 8v8h3.5v-4.5h2V16h3.5V8', () => smoothly(() => goHome(ws)));
  host.append(nav);
}

// Back to the usual zoom with "when Blink starts" at the top left (or the first block, if there's none)
function goHome(ws) {
  const tops = ws.getTopBlocks(true);
  const home = tops.find(b => b.type === 'bk_setup') || tops[0];
  ws.setScale(ws.options.zoomOptions.startScale);
  if (!home) { ws.scrollCenter(); return; }
  const at = home.getRelativeToSurfaceXY(), s = ws.scale, margin = 28;
  ws.scroll(-at.x * s + margin, -at.y * s + margin);
}

// Safari sends a trackpad pinch as gesture events, not Ctrl + wheel: zoom around the pinch
function safariPinch(Blockly, ws, host) {
  let last = 1;
  host.addEventListener('gesturestart', e => { e.preventDefault(); last = 1; });
  host.addEventListener('gesturechange', e => {
    e.preventDefault();
    const at = Blockly.browserEvents.mouseToSvg(e, ws.getParentSvg(), ws.getInverseScreenCTM());
    ws.zoom(at.x, at.y, Math.log(e.scale / last) / Math.log(ws.options.zoomOptions.scaleSpeed));
    last = e.scale;
  });
  host.addEventListener('gestureend', e => e.preventDefault());
}

// A small map of the sketch in the corner: the blocks in their colors and the part on screen as a
// frame. Click somewhere to go there, or drag the frame around. A sketch that would be too small to
// see at the map's size shows a part of it, which scrolls along as you move around (like a code
// editor's minimap).
function addMinimap(Blockly, ws, host) {
  const W = 128, H = 168, PAD = 8;   // portrait, like a sketch's column of blocks
  const box = document.createElement('div');
  box.className = 'bk-minimap';
  box.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  box.append(canvas);
  host.append(box);
  host.classList.add('bk-has-minimap');
  const dpr = Math.max(1, Math.min(3, devicePixelRatio || 1));
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const c = canvas.getContext('2d');
  let map = null;      // workspace → map: { x, y, s } (map = (ws - x) * s + PAD)
  let frozen = null;   // the map while the frame is dragged, so it stays under the pointer

  const rect = r => [r.left, r.top, r.right - r.left, r.bottom - r.top];
  const draw = () => {
    frame = 0;
    if (!ws.rendered || !box.isConnected) return;
    const view = ws.getMetricsManager().getViewMetrics(true);
    const items = [...ws.getTopBlocks(false), ...ws.getTopComments(false)];
    let l = view.left, t = view.top, r = view.left + view.width, b = view.top + view.height;
    for (const it of items) {
      const bb = it.getBoundingRectangle();
      l = Math.min(l, bb.left); t = Math.min(t, bb.top); r = Math.max(r, bb.right); b = Math.max(b, bb.bottom);
    }
    const MW = W - 2 * PAD, MH = H - 2 * PAD;
    // everything, unless that makes the frame small: then the frame fills at least 40% of the map
    const s = Math.max(Math.min(MW / Math.max(1, r - l), MH / Math.max(1, b - t)), Math.min(MW / view.width, MH / view.height) * 0.4);
    // along each side: centered if it fits, or else the part around the view, in proportion
    const along = (lo, hi, at, size, span) => (hi - lo <= span ? lo - (span - (hi - lo)) / 2
      : lo + (at - lo) / Math.max(1, hi - lo - size) * (hi - lo - span));
    if (!frozen) map = { x: along(l, r, view.left, view.width, MW / s), y: along(t, b, view.top, view.height, MH / s), s };
    const { x, y } = map;
    const sc = map.s;
    const at = (px, py) => [(px - x) * sc + PAD, (py - y) * sc + PAD];
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    // every block in its color, so nested ones show up over their parents
    for (const top of ws.getTopBlocks(true)) {
      for (const block of top.getDescendants(true)) {
        if (block.isShadow() || !block.rendered) continue;
        const [bx, by, bw, bh] = rect(block.getBoundingRectangle());
        const [mx, my] = at(bx, by);
        c.fillStyle = block.getColour();
        c.globalAlpha = block === top ? 0.9 : 0.55;
        c.fillRect(mx, my, Math.max(1, bw * sc), Math.max(1, bh * sc));
      }
    }
    c.globalAlpha = 1;
    c.fillStyle = '#4a4060';
    for (const com of ws.getTopComments(false)) {
      const [cx, cy, cw, ch] = rect(com.getBoundingRectangle());
      const [mx, my] = at(cx, cy);
      c.fillRect(mx, my, Math.max(1, cw * sc), Math.max(1, ch * sc));
    }
    // the part on screen
    const [vx, vy] = at(view.left, view.top);
    c.fillStyle = 'rgba(255, 255, 255, .07)';
    c.fillRect(vx, vy, view.width * sc, view.height * sc);
    c.strokeStyle = '#FA4616';
    c.lineWidth = 1.5;
    c.strokeRect(vx + 0.75, vy + 0.75, Math.max(2, view.width * sc - 1.5), Math.max(2, view.height * sc - 1.5));
  };
  let frame = 0;
  const redraw = () => { if (!frame) frame = requestAnimationFrame(draw); };
  ws.addChangeListener(redraw);
  new ResizeObserver(redraw).observe(host);
  redraw();

  // put the top left of the view at a workspace point
  const scrollTo = (left, top) => ws.scroll(-left * ws.scale, -top * ws.scale);
  canvas.addEventListener('pointerdown', e => {
    if (!map) return;
    e.preventDefault();
    e.stopPropagation();
    canvas.setPointerCapture(e.pointerId);
    box.classList.add('dragging');
    const view = ws.getMetricsManager().getViewMetrics(true);
    const toWs = ev => {
      const r = canvas.getBoundingClientRect();
      return [(ev.clientX - r.left - PAD) / map.s + map.x, (ev.clientY - r.top - PAD) / map.s + map.y];
    };
    const [px, py] = toWs(e);
    // grabbed inside the frame: keep the same hold on it; anywhere else: center the view there
    const inside = px >= view.left && px <= view.left + view.width && py >= view.top && py <= view.top + view.height;
    const dx = inside ? px - view.left : view.width / 2, dy = inside ? py - view.top : view.height / 2;
    const lock = frozen = { ...map };
    const move = ev => {
      const r = canvas.getBoundingClientRect();
      const wx = (ev.clientX - r.left - PAD) / lock.s + lock.x, wy = (ev.clientY - r.top - PAD) / lock.s + lock.y;
      scrollTo(wx - dx, wy - dy);
    };
    move(e);
    const up = () => {
      frozen = null;
      box.classList.remove('dragging');
      canvas.removeEventListener('pointermove', move);
      redraw();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up, { once: true });
    canvas.addEventListener('pointercancel', up, { once: true });
  });
}

// When a block changes shape (a function's inputs, an if's parts, a return type, and the calls that
// follow along, or collapsing and expanding), the blocks and comments below it on the canvas move
// with its bottom edge, so they keep their spacing instead of being covered or left far below. Only
// the ones in its column move, and the moves are part of the change, to undo with it.
function keepSpacing(Blockly, ws, isLoading) {
  let boxes = new Map();
  const items = () => [...ws.getTopBlocks(false), ...ws.getTopComments(false)];
  const idOf = item => item.id;
  const measure = () => { boxes = new Map(items().map(item => [idOf(item), item.getBoundingRectangle()])); };
  const respace = group => {
    const now = new Map(items().map(item => [idOf(item), item]));
    const grown = [];
    for (const [id, item] of now) {
      const was = boxes.get(id), box = item.getBoundingRectangle();
      if (was && Math.abs(box.top - was.top) < 1 && Math.abs(box.bottom - was.bottom) >= 1) grown.push({ id, was, by: box.bottom - was.bottom });
    }
    if (!grown.length) return;
    const across = (a, b) => a.left < b.right && a.right > b.left;
    Blockly.Events.setGroup(group || true);
    try {
      for (const [id, item] of now) {
        const was = boxes.get(id);
        if (!was) continue;   // (a block just set aside stays where it was put)
        const dy = grown.filter(g => g.id !== id && was.top >= g.was.bottom - 1 && across(was, g.was)).reduce((sum, g) => sum + g.by, 0);
        if (dy) item.moveBy(0, dy);
      }
    } finally {
      Blockly.Events.setGroup(false);
    }
  };
  let due = false, group = null, timer = null;
  ws.addChangeListener(e => {
    if (isLoading() || e.isUiEvent) return;
    // a change of shape the person made (an undo puts the blocks back itself)
    if (e.recordUndo && ((e.type === Blockly.Events.BLOCK_CHANGE && (e.element === 'mutation' || e.element === 'collapsed')) || e.type === 'bk_call_numbers')) {
      due = true;
      group = group || e.group || null;
    }
    // once the change is drawn: respace if it's due, and measure for next time
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (Blockly.renderManagement && Blockly.renderManagement.finishQueuedRenders) await Blockly.renderManagement.finishQueuedRenders();
      if (due) respace(group);
      due = false;
      group = null;
      measure();
    }, 0);
  });
  return { measure };
}

function layout(ws) {
  const C = globalThis.Blockly.utils.Coordinate;
  for (const c of ws.getTopComments(true)) decorateWorkspaceComment(globalThis.Blockly, c);
  let y = 36;
  for (const item of [...ws.getTopComments(true), ...ws.getTopBlocks(true)]) {
    item.moveTo(new C(36, y));
    const size = item.getHeightWidth ? item.getHeightWidth() : item.getSize();
    y += size.height + 36;
  }
  ws.scroll(0, 0);
}
