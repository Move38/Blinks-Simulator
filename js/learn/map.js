/*
 * The map: each world is a flower of seven hexes, like a Blink with six neighbors. Level 1 sits at
 * the top of the ring and the boss in the middle. Finished levels light up in the world's color.
 */

import { blink, rhex } from './blink-svg.js';
import { hexState, nextLevel } from './progress.js';

// all nine worlds of the path; the ones not written yet are shown locked
const PATH = [
  ['Light', '#facc15'], ['Input', '#fb923c'], ['Memory', '#e879f9'], ['Time', '#22d3ee'], ['Patterns', '#4ade80'],
  ['Neighbors', '#60a5fa'], ['Messages', '#a78bfa'], ['Chance & Rules', '#f87171'], ['Ship It', '#f1edf7'],
];
const POS = [[190, 110], [350, 110], [510, 110], [670, 110], [670, 290], [510, 290], [350, 290], [190, 290], [190, 450]];
const S = 19, R = S * Math.sqrt(3);
const petal = i => { const a = Math.PI / 180 * (-90 + 60 * i); return [Math.cos(a) * R, Math.sin(a) * R]; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// A five-point star of radius r, its inner corners not too deep (half the radius), rounded.
// grow: how much wider its rounded edge makes it (the gap cut around a twist's star uses more).
function star(cx, cy, r, fill, grow = r * 0.12) {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? r * 0.5 : r;
    p.push((cx + k * Math.cos(a)).toFixed(1) + ',' + (cy + k * Math.sin(a)).toFixed(1));
  }
  return `<polygon points="${p.join(' ')}" fill="${fill}" stroke="${fill}" stroke-width="${grow.toFixed(1)}" stroke-linejoin="round"/>`;
}

export function drawMap(svg, { state, worlds, selected, onLevel, onWorld }) {
  const current = nextLevel(state, worlds);
  const twists = [];   // where the stars of finished twists go
  let g = `<path d="M60,110 L${POS.map(p => p.join(',')).join(' L')}" fill="none" stroke="#30283f" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>`;
  g += blink(60, 110, S, ['W'], { glow: 'W' });
  g += `<text x="60" y="152" text-anchor="middle" class="m-sub">Start</text>`;
  const all = PATH.map(([name, color], k) => worlds.find(w => w.n === k + 1 && w.boss) || { n: k + 1, name, color });
  all.forEach((w, k) => {
    const [x, y] = POS[k], real = !!w.levels;
    g += `<g class="m-world${w === selected ? ' sel' : ''}" data-world="${k}">`;
    g += `<rect x="${x - 62}" y="${y - 58}" width="124" height="158" rx="16" class="m-hit"/>`;
    for (let i = 0; i < 7; i++) {
      const [dx, dy] = i === 6 ? [0, 0] : petal(i);
      const cx = x + dx, cy = y + dy;
      const st = real ? hexState(state, worlds, w, i) : 'locked';
      const level = real ? (i === 6 ? w.boss : w.levels[i]) : null;
      const cur = level && level === current;
      const attrs = level && st !== 'locked' ? ` data-level="${level.id}" tabindex="0" role="button" aria-label="${esc(level.id + ' ' + level.title)}"` : '';
      g += `<g class="m-hex ${st}${cur ? ' cur' : ''}"${attrs}><title>${level ? esc(`${level.id} ${level.title}`) : 'Coming later'}</title>`;
      if (st === 'done') g += blink(cx, cy, S * 0.94, [w.color], { glow: w.color });
      else if (cur) g += `<path d="${rhex(cx, cy, S * 0.94)}" fill="#2a2337" stroke="#fff" stroke-width="2.5" class="pulse"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="#fff"/>`;
      else if (st === 'open') g += `<path d="${rhex(cx, cy, S * 0.9)}" fill="#1d1827" stroke="${w.color}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
      else g += `<path d="${rhex(cx, cy, S * 0.9)}" fill="#221c2d" stroke="#3a3149" stroke-width="1.2"/>`;
      if (i === 6 && st !== 'done' && !cur) g += star(cx, cy, 6, real && st !== 'locked' ? w.color : '#4a405e');
      if (level && state.levels[level.id]?.star) twists.push([cx + S * 0.62, cy - S * 0.55]);
      g += '</g>';
    }
    g += `<text x="${x}" y="${y + 74}" text-anchor="middle" class="m-num" fill="${real ? w.color : '#5c5470'}">WORLD ${w.n}</text>`;
    g += `<text x="${x}" y="${y + 90}" text-anchor="middle" class="m-name${real ? '' : ' later'}">${esc(w.name)}</text>`;
    g += '</g>';
  });
  // a twist's star sits on its hex's corner, in a gap cut out of the hexes under it, so the
  // map's own background shows around it
  if (twists.length) {
    const cut = twists.map(([sx, sy]) => star(sx, sy, 5, '#000', 5 * 0.12 + 4)).join('');
    g = `<defs><mask id="twistCut" maskUnits="userSpaceOnUse" x="0" y="0" width="840" height="560"><rect width="840" height="560" fill="#fff"/>${cut}</mask></defs>`
      + `<g mask="url(#twistCut)">${g}</g><g pointer-events="none">${twists.map(([sx, sy]) => star(sx, sy, 5, '#facc15')).join('')}</g>`;
  }
  svg.innerHTML = g;

  svg.onclick = e => {
    const h = e.target.closest('[data-level]');
    if (h) { onLevel(h.dataset.level); return; }
    const wg = e.target.closest('[data-world]');
    if (wg && all[+wg.dataset.world].levels) onWorld(all[+wg.dataset.world]);
  };
  svg.onkeydown = e => {
    const h = e.target.closest('[data-level]');
    if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onLevel(h.dataset.level); }
  };
}
