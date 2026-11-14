/*
 * The console under the table: Serial output, runtime errors and notes.
 * Repeated lines collapse into one with a ×count so a print in loop() stays readable.
 */

import { formatMessage } from './editor.js';

const MAX_LINES = 400;

export class Console {
  constructor(list, { onJump }) {
    this.list = list;
    this.onJump = onJump;
    this.last = null;
    this.clear();
  }

  clear() {
    this.list.innerHTML = '';
    this.last = null;
    this.count = 0;
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Serial.println() output and messages from your Blinks show up here.';
    this.list.append(li);
    this.emptyEl = li;
  }

  // kind: 'out' | 'err' | 'warn' | 'info'
  // `file`: in a sketch of several files, the file `line` is in
  add(kind, text, { who = null, line = 0, file = null } = {}) {
    if (this.emptyEl) { this.emptyEl.remove(); this.emptyEl = null; }
    const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 24;
    const key = kind + '|' + text + '|' + file + '|' + line;
    if (this.last && this.last.key === key) {
      // same message again (from any Blink): bump the counter
      this.last.n++;
      if (who != null) this.last.who.add(who);
      this.last.times.textContent = '×' + this.last.n;
      this.renderWho(this.last);
      if (atBottom) this.list.scrollTop = this.list.scrollHeight;
      return;
    }
    const li = document.createElement('li');
    li.className = kind;
    const whoEl = document.createElement('span');
    whoEl.className = 'who';
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.innerHTML = formatMessage(text);
    if (line) {
      const j = document.createElement('button');
      j.className = 'jump';
      j.textContent = file ? `${file} line ${line}` : `line ${line}`;
      j.addEventListener('click', () => this.onJump(line, file));
      msg.append(' (', j, ')');
    }
    const times = document.createElement('span');
    times.className = 'times';
    li.append(whoEl, msg, times);
    this.list.append(li);
    this.last = { key, n: 1, who: new Set(who != null ? [who] : []), whoEl, times };
    this.renderWho(this.last);
    if (++this.count > MAX_LINES) { this.list.firstElementChild.remove(); this.count--; }
    if (atBottom) this.list.scrollTop = this.list.scrollHeight;
  }

  renderWho(entry) {
    const ids = [...entry.who];
    if (!ids.length) { entry.whoEl.hidden = true; return; }
    entry.whoEl.hidden = false;
    entry.whoEl.textContent = ids.length === 1 ? `#${ids[0]}` : ids.length <= 3 ? ids.map(i => '#' + i).join(' ') : `${ids.length} Blinks`;
  }
}
