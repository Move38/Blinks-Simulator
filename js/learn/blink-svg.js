/*
 * Small Blinks as SVG, drawn the way js/ui/board.js draws them on the table: flat top, a rounded
 * rim, six faces in a window with slightly rounded corners, face 0 on the top edge going clockwise,
 * and dividers that take on the color of the light under them.
 */

// letters the levels use for colors in pictures: R O Y G C B M W, and 0 for off
export const COLORS = { R: '#ff4040', O: '#ff8a1f', Y: '#ffd23f', G: '#3ee06a', C: '#22d3ee', B: '#3b6bff', M: '#e040fb', W: '#ffffff', 0: '#3b3448' };
const col = k => COLORS[k] || k;

const hexPts = (cx, cy, r) => [0, 1, 2, 3, 4, 5].map(i => [cx + r * Math.cos(Math.PI / 3 * i), cy + r * Math.sin(Math.PI / 3 * i)]);
const f1 = n => n.toFixed(1);
const pts = p => p.map(q => f1(q[0]) + ',' + f1(q[1])).join(' ');

// a rounded hexagon, flat top, as path data
export function rhex(cx, cy, R, rr = R * 0.16) {
  const V = hexPts(cx, cy, R), t = rr * Math.tan(Math.PI / 6) / R;
  let d = '';
  for (let i = 0; i < 6; i++) {
    const P = V[i], A = V[(i + 5) % 6], B = V[(i + 1) % 6];
    d += `${i ? 'L' : 'M'}${f1(P[0] + (A[0] - P[0]) * t)} ${f1(P[1] + (A[1] - P[1]) * t)}A${f1(rr)} ${f1(rr)} 0 0 1 ${f1(P[0] + (B[0] - P[0]) * t)} ${f1(P[1] + (B[1] - P[1]) * t)}`;
  }
  return d + 'Z';
}

let clipId = 0;
// One Blink centered at (cx, cy), radius s. faces: one color for all, or six. glow: a color, or none.
export function blink(cx, cy, s, faces, { glow = null } = {}) {
  if (faces.length === 1) faces = Array(6).fill(faces[0]);
  const inner = hexPts(cx, cy, s * 0.8), win = rhex(cx, cy, s * 0.8, s * 0.08), clip = 'lb' + (++clipId);
  const lw = Math.max(0.8, s * 0.03);
  let g = `<g><clipPath id="${clip}"><path d="${win}"/></clipPath>`;
  if (glow) g += `<path d="${rhex(cx, cy, s)}" fill="${col(glow)}" opacity=".45" filter="url(#lglow)"/>`;
  g += `<path d="${rhex(cx, cy, s)}" fill="url(#lrim)" stroke="#9d9eab" stroke-width="${Math.max(0.5, s * 0.02)}"/>`;
  g += `<g clip-path="url(#${clip})">`;
  for (let i = 0; i < 6; i++) g += `<polygon data-face="${i}" points="${f1(cx)},${f1(cy)} ${pts([inner[(i + 4) % 6], inner[(i + 5) % 6]])}" fill="${col(faces[i])}"/>`;
  g += `<path d="${inner.map(p => `M${f1(cx)} ${f1(cy)}L${f1(p[0])} ${f1(p[1])}`).join('')}" stroke="rgb(187,187,192)" stroke-width="${lw}" fill="none" style="mix-blend-mode:multiply"/></g>`;
  g += `<path d="${win}" fill="none" stroke="rgb(167,167,174)" stroke-width="${lw * 1.4}" style="mix-blend-mode:multiply"/>`;
  return g + '</g>';
}

// A Blink as its own small <svg>, s its radius
export function blinkSvg(faces, s = 16, opts = {}) {
  const pad = opts.glow ? s * 0.45 : 2, w = Math.ceil(s * 2 + pad * 2), h = Math.ceil(s * 1.75 + pad * 2);
  return `<svg class="blink-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${blink(w / 2, h / 2, s, faces, opts)}</svg>`;
}

// The gradient and glow the Blinks refer to; put once in the page
export const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<linearGradient id="lrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3f3f7"/><stop offset="1" stop-color="#bdbec8"/></linearGradient>
<filter id="lglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4"/></filter>
</defs></svg>`;
