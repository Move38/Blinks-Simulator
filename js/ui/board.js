/*
 * Draws the Blinks table and turns pointer input into button presses, moves and rotations.
 *   press the center  -> the Blink's button (held for as long as you hold)
 *   drag the rim      -> move it; drop it on the bin to remove it
 *   right-click / R   -> rotate it 60°
 *   double-click table -> add a Blink there
 */

import { DIRS } from '../runtime/world.js';

const TAU = Math.PI * 2, SQ3 = Math.sqrt(3);
const OFF_RGB = [64, 62, 76];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hk = (q, r) => q + ',' + r;

export function colorToRGB(c) {
  return [((c >> 1) & 31) * 255 / 31, ((c >> 6) & 31) * 255 / 31, ((c >> 11) & 31) * 255 / 31];
}

export class Board {
  constructor(canvas, world, hooks = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.hooks = hooks;
    this.W = 1; this.H = 1; this.DPR = 1;
    this.view = { S: 48, OX: 0, OY: 0 };
    this.target = { S: 48, OX: 0, OY: 0 };
    this.showFaces = false;
    this.presses = new Map();
    this.hover = null;
    this.lastTouched = null;
    this.dragging = null;
    this.bin = hooks.bin;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.bindInput();
  }

  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.DPR = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(this.W * this.DPR);
    this.cv.height = Math.round(this.H * this.DPR);
    this.fit(false);
  }

  // ---------- geometry ----------
  h2p(q, r, v = this.view) { return [v.OX + 1.5 * v.S * q, v.OY + SQ3 * v.S * (r + q / 2)]; }
  p2h(x, y) {
    const v = this.view;
    x = (x - v.OX) / v.S; y = (y - v.OY) / v.S;
    const q = (2 / 3) * x, r = (-1 / 3) * x + (SQ3 / 3) * y;
    let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
    const dx = Math.abs(rx - q), dz = Math.abs(rz - r), dy = Math.abs(ry + q + r);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dz > dy) rz = -rx - ry;
    return [rx, rz];
  }
  pos(b) { return b.drag ? [b.drag.x, b.drag.y] : this.h2p(b.q, b.r); }

  // Fit all Blinks in view (leaving room for the dock at the bottom)
  fit(animate = true) {
    const bs = this.world.blinks;
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    if (bs.length) {
      minX = minY = Infinity; maxX = maxY = -Infinity;
      for (const b of bs) {
        const x = 1.5 * b.q, y = SQ3 * (b.r + b.q / 2);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const top = 44, bottom = 76, side = 28;
    const w = (maxX - minX) + 2.2, h = (maxY - minY) + 2.2;
    const S = clamp(Math.min((this.W - side * 2) / w, (this.H - top - bottom) / h), 18, 78);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.target = { S, OX: this.W / 2 - cx * S, OY: top + (this.H - top - bottom) / 2 - cy * S };
    if (!animate) this.view = { ...this.target };
  }

  // ---------- input ----------
  ptr(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  hit(x, y) {
    const S = this.view.S;
    for (let i = this.world.blinks.length - 1; i >= 0; i--) {
      const b = this.world.blinks[i];
      const [bx, by] = this.pos(b);
      const d = Math.hypot(x - bx, y - by);
      if (d < S * 0.93) return { b, rim: d > S * 0.56 };
    }
    return null;
  }

  bindInput() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', e => {
      if (e.button === 2) return;
      const [x, y] = this.ptr(e);
      const h = this.hit(x, y);
      if (!h) return;
      e.preventDefault();
      cv.focus({ preventScroll: true });
      this.lastTouched = h.b;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const pr = { b: h.b, x0: x, y0: y, drag: false };
      this.presses.set(e.pointerId, pr);
      if (h.rim) this.startDrag(pr, x, y);
      else { h.b.press(true); h.b.pressedBy = (h.b.pressedBy || 0) + 1; this.hooks.onInteract?.(); }
    });
    cv.addEventListener('pointermove', e => {
      const [x, y] = this.ptr(e);
      const pr = this.presses.get(e.pointerId);
      if (!pr) {
        const h = this.hit(x, y);
        this.hover = h ? h.b : null;
        this.hoverPt = [x, y];
        cv.style.cursor = h ? (h.rim ? 'grab' : 'pointer') : 'default';
        return;
      }
      if (pr.drag && pr.b.drag) {
        pr.b.drag.x = x - pr.b.drag.dx; pr.b.drag.y = y - pr.b.drag.dy;
        this.bin?.classList.toggle('hot', this.overBin(x, y));
      }
    });
    const end = e => {
      const pr = this.presses.get(e.pointerId);
      if (!pr) return;
      this.presses.delete(e.pointerId);
      if (pr.drag) {
        const [x, y] = this.ptr(e);
        this.drop(pr.b, this.overBin(x, y));
      } else {
        pr.b.pressedBy = Math.max(0, (pr.b.pressedBy || 1) - 1);
        if (!pr.b.pressedBy) pr.b.press(false);
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { this.hover = null; });
    cv.addEventListener('contextmenu', e => {
      e.preventDefault();
      const [x, y] = this.ptr(e);
      const h = this.hit(x, y);
      if (h) { this.rotate(h.b, e.shiftKey ? -1 : 1); }
    });
    cv.addEventListener('dblclick', e => {
      const [x, y] = this.ptr(e);
      if (this.hit(x, y)) return;
      const [q, r] = this.p2h(x, y);
      if (!this.world.at(q, r)) { const b = this.world.addBlink(q, r, 0); if (b) { this.lastTouched = b; this.hooks.onLayout?.(); } }
    });
    window.addEventListener('keydown', e => {
      if (!this.keyTarget(e)) return;
      const b = this.hover || this.lastTouched;
      if (e.code === 'Space' && !e.repeat) {
        const t = b && this.world.blinks.includes(b) ? b : this.world.blinks[0];
        if (!t) return;
        e.preventDefault();
        this.kbd = t; t.press(true); this.lastTouched = t;
        this.hooks.onInteract?.();
      } else if ((e.key === 'r' || e.key === 'R') && b && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        this.rotate(b, e.shiftKey ? -1 : 1);
      }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Space' && this.kbd) { e.preventDefault(); this.kbd.press(false); this.kbd = null; }
    });
  }

  keyTarget(e) {
    const ae = document.activeElement;
    return !ae || ae === document.body || ae === this.cv;
  }

  rotate(b, dir) {
    this.world.rotate(b, dir);
    this.hooks.onLayout?.();
  }

  startDrag(pr, x, y) {
    pr.drag = true;
    const b = pr.b;
    const [bx, by] = this.h2p(b.q, b.r);
    this.world.lift(b);
    b.drag = { x: bx, y: by, dx: x - bx, dy: y - by };
    this.dragging = b;
    this.cv.style.cursor = 'grabbing';
    if (this.bin) this.bin.hidden = this.world.blinks.length <= 1;
    // draw the dragged Blink on top
    this.world.blinks = this.world.blinks.filter(o => o !== b).concat(b);
  }

  overBin(x, y) {
    if (!this.bin || this.bin.hidden) return false;
    const r = this.bin.getBoundingClientRect(), c = this.cv.getBoundingClientRect();
    return Math.hypot(x - (r.left - c.left + r.width / 2), y - (r.top - c.top + r.height / 2)) < r.width * 0.75;
  }

  drop(b, toBin) {
    this.dragging = null;
    if (this.bin) { this.bin.hidden = true; this.bin.classList.remove('hot'); }
    this.cv.style.cursor = 'grab';
    if (toBin && this.world.blinks.length > 1) {
      this.world.removeBlink(b);
      if (this.lastTouched === b) this.lastTouched = null;
      b.drag = null;
      this.hooks.onLayout?.(true);
      return;
    }
    const { x, y } = b.drag;
    const [q0, r0] = this.p2h(x, y);
    let best = null, bd = Infinity;
    for (let q = q0 - 3; q <= q0 + 3; q++) for (let r = r0 - 3; r <= r0 + 3; r++) {
      if (this.world.at(q, r)) continue;
      const [px, py] = this.h2p(q, r);
      const d = Math.hypot(px - x, py - y);
      if (d < bd) { bd = d; best = [q, r]; }
    }
    if (!best) best = [b.q, b.r];
    b.drag = null;
    this.world.place(b, best[0], best[1]);
    const [px, py] = this.h2p(best[0], best[1]);
    const S = this.view.S;
    this.hooks.onLayout?.(px < S || px > this.W - S || py < S || py > this.H - S * 1.6);
  }

  // ---------- drawing ----------
  draw(now) {
    const v = this.view, t = this.target;
    const k = 0.2;
    v.S += (t.S - v.S) * k; v.OX += (t.OX - v.OX) * k; v.OY += (t.OY - v.OY) * k;
    const c = this.ctx;
    c.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    this.drawGrid(c);
    const bs = this.world.blinks;
    // glow underneath
    c.globalCompositeOperation = 'lighter';
    for (const b of bs) this.drawGlow(c, b);
    c.globalCompositeOperation = 'source-over';
    for (const b of bs) this.drawBlink(c, b, now);
    if (this.showFaces) for (const b of bs) this.drawFaces(c, b);
  }

  drawGrid(c) {
    const { S } = this.view;
    if (!this.dragging) return;
    // while dragging, show the free spots a Blink can snap into
    c.fillStyle = 'rgba(255,255,255,.07)';
    const [q0, r0] = this.p2h(this.W / 2, this.H / 2);
    const n = Math.ceil(Math.max(this.W, this.H) / (S * 1.5)) + 1;
    for (let q = q0 - n; q <= q0 + n; q++) for (let r = r0 - n; r <= r0 + n; r++) {
      const [x, y] = this.h2p(q, r);
      if (x < -S || y < -S || x > this.W + S || y > this.H + S || this.world.at(q, r)) continue;
      c.beginPath(); c.arc(x, y, 2, 0, TAU); c.fill();
    }
  }

  angle(b) {
    const goal = b.rot * Math.PI / 3;
    if (b.viewAngle === undefined) b.viewAngle = goal;
    let d = goal - b.viewAngle;
    d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
    b.viewAngle += d * 0.3;
    if (Math.abs(d) < 0.001) b.viewAngle = goal;
    return b.viewAngle;
  }

  drawGlow(c, b) {
    const [x, y] = this.pos(b), S = this.view.S;
    const a0 = this.angle(b);
    for (let f = 0; f < 6; f++) {
      const L = colorToRGB(b.display[f]);
      const m = Math.max(L[0], L[1], L[2]);
      if (m < 20) continue;
      const a = Math.min(1, m / 255), ang = -Math.PI / 2 + a0 + f * Math.PI / 3;
      const gx = x + Math.cos(ang) * S * 0.92, gy = y + Math.sin(ang) * S * 0.92, gr = S * 0.95;
      const col = L.map(v => Math.round(v / m * 255)).join(',');
      const g = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, `rgba(${col},${0.24 * a})`); g.addColorStop(0.55, `rgba(${col},${0.07 * a})`); g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g; c.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
  }

  drawBlink(c, b, now) {
    const [x, y] = this.pos(b), S = this.view.S;
    const lift = !!b.drag;
    const pressed = b.rawButton && !b.pendingRelease ? true : b.btn.down;
    const R = S * (pressed ? 0.925 : 0.95) * (lift ? 1.03 : 1);
    const a0 = this.angle(b);
    c.save();
    c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = lift ? 26 : 10; c.shadowOffsetY = lift ? 14 : 5;
    rhex(c, x, y, R, R * 0.16); c.fillStyle = '#cfd0d8'; c.fill();
    c.restore();
    const g = c.createLinearGradient(x, y - R, x, y + R);
    g.addColorStop(0, '#f3f3f7'); g.addColorStop(1, '#bdbec8');
    rhex(c, x, y, R, R * 0.16); c.fillStyle = g; c.fill();
    if (this.hover === b && !lift) { rhex(c, x, y, R * 0.985, R * 0.15); c.strokeStyle = 'rgba(250,70,22,.7)'; c.lineWidth = 1.5; c.stroke(); }

    // LED segments: face f is centred on angle a0 + f * 60°, measured from straight up
    const r2 = R * 0.8;
    const V = [];
    for (let i = 0; i < 6; i++) { const a = a0 + i * Math.PI / 3; V.push([x + r2 * Math.cos(a), y + r2 * Math.sin(a)]); }
    const sleeping = b.mode === 'sleep';
    for (let f = 0; f < 6; f++) {
      const A = V[(f + 4) % 6], B = V[(f + 5) % 6];
      const L = sleeping ? [0, 0, 0] : colorToRGB(b.display[f]);
      c.beginPath(); c.moveTo(x, y); c.lineTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.closePath();
      c.fillStyle = `rgb(${ledFill(L)})`; c.fill();
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, a = Math.min(1, Math.max(L[0], L[1], L[2]) / 255);
      const lg = c.createLinearGradient(mx, my, x, y);
      lg.addColorStop(0, `rgba(255,255,255,${0.3 * a * a})`); lg.addColorStop(0.45, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(20,20,30,.22)');
      c.fillStyle = lg; c.fill();
    }
    c.strokeStyle = 'rgba(30,30,45,.3)'; c.lineWidth = 1;
    c.beginPath(); for (const p of V) { c.moveTo(x, y); c.lineTo(p[0], p[1]); } c.stroke();
    c.beginPath(); V.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
    c.strokeStyle = 'rgba(60,60,75,.45)'; c.lineWidth = 1.5; c.stroke();
    if (pressed) { c.fillStyle = 'rgba(0,0,0,.12)'; c.fill(); }

    if (b.mode === 'crashed') {
      const p = 0.5 + 0.5 * Math.sin(now / 180);
      rhex(c, x, y, R * 1.02, R * 0.17); c.strokeStyle = `rgba(255,93,108,${0.5 + 0.5 * p})`; c.lineWidth = 2.5; c.stroke();
      badge(c, x, y - R * 0.05, S * 0.26, '#ff5d6c', '!');
    } else if (sleeping) {
      c.fillStyle = 'rgba(40,36,56,.55)'; c.font = `600 ${Math.round(S * 0.32)}px Figtree, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('z', x + S * 0.08, y - S * 0.06);
      c.font = `600 ${Math.round(S * 0.22)}px Figtree, sans-serif`; c.fillText('z', x - S * 0.14, y + S * 0.12);
    }
    if (b === this.lastTouched && document.activeElement === this.cv) {
      c.fillStyle = '#FA4616'; c.beginPath(); c.arc(x, y + R * 0.88, 2.4, 0, TAU); c.fill();
    }
  }

  drawFaces(c, b) {
    const [x, y] = this.pos(b), S = this.view.S;
    const a0 = this.angle(b);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let f = 0; f < 6; f++) {
      const ang = -Math.PI / 2 + a0 + f * Math.PI / 3;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      // face number inside the segment
      c.font = `600 ${Math.max(9, Math.round(S * 0.2))}px "JetBrains Mono", monospace`;
      const L = colorToRGB(b.display[f]);
      const lum = (L[0] * 0.3 + L[1] * 0.55 + L[2] * 0.15);
      c.fillStyle = lum > 150 ? 'rgba(20,18,30,.75)' : 'rgba(255,255,255,.8)';
      c.fillText(String(f), x + cs * S * 0.5, y + sn * S * 0.5);
      // value sent on this face, on the edge
      const face = b.faces[f];
      const linked = !b.lifted && this.world.neighbor(b, f);
      if (!linked && !face.outValue) continue;
      const px = x + cs * S * 0.87, py = y + sn * S * 0.87;
      const txt = String(face.outValue);
      c.font = `600 ${Math.max(9, Math.round(S * 0.19))}px "JetBrains Mono", monospace`;
      const w = Math.max(S * 0.3, c.measureText(txt).width + S * 0.14), h = S * 0.27;
      c.fillStyle = linked ? 'rgba(250,70,22,.95)' : 'rgba(30,26,40,.85)';
      rrect(c, px - w / 2, py - h / 2, w, h, h / 2); c.fill();
      c.fillStyle = '#fff'; c.fillText(txt, px, py + 0.5);
    }
  }
}

function ledFill(L) {
  const m = Math.max(L[0], L[1], L[2]);
  if (m < 2) return OFF_RGB.join(',');
  const a = Math.min(1, m / 255), sat = L.map(v => clamp(v, 0, m) / m * 255);
  return mix(OFF_RGB, sat, Math.pow(a, 0.6)).map(v => Math.round(clamp(v, 0, 255))).join(',');
}

// rounded hexagon, flat top
function rhex(c, x, y, R, rr) {
  const P = [];
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; P.push([x + R * Math.cos(a), y + R * Math.sin(a)]); }
  c.beginPath(); c.moveTo((P[5][0] + P[0][0]) / 2, (P[5][1] + P[0][1]) / 2);
  for (let i = 0; i < 6; i++) { const p = P[i], n = P[(i + 1) % 6]; c.arcTo(p[0], p[1], n[0], n[1], rr); }
  c.closePath();
}
function rrect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function badge(c, x, y, r, col, txt) {
  c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.fillStyle = '#fff'; c.font = `800 ${Math.round(r * 1.3)}px Figtree, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(txt, x, y + 1);
}

// Arrangements for the layout buttons (axial hex coordinates)
export const LAYOUTS = {
  solo: () => [[0, 0]],
  pair: () => [[0, 0], [1, 0]],
  trio: () => [[-1, 0], [0, -1], [0, 0]],
  line: () => [[-2, 1], [-1, 1], [0, 0], [1, 0]],
  flower: () => [[0, 0], ...DIRS],
  scatter: n => {
    const spots = [[0, 0], [2, -1], [-2, 1], [0, -2], [0, 2], [2, 1], [-2, -1], [4, -2], [-4, 2], [2, -3], [-2, 3], [4, 0], [-4, 0]];
    return spots.slice(0, Math.max(2, Math.min(n || 5, spots.length)));
  },
};

// Next free cell touching the group (for "+")
export function nextCell(world) {
  if (!world.blinks.length) return [0, 0];
  for (let ring = 1; ring < 12; ring++) {
    let best = null, bd = Infinity;
    for (const b of world.blinks) {
      for (const [dq, dr] of DIRS) {
        const q = b.q + dq, r = b.r + dr;
        if (world.at(q, r)) continue;
        const d = Math.abs(q) + Math.abs(r) + Math.abs(q + r);
        if (d < bd) { bd = d; best = [q, r]; }
      }
    }
    if (best) return best;
  }
  return [0, 0];
}

export { hk };
