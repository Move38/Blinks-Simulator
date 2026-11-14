/*
 * World 4 · Time: doing things later without stopping. Timer, millis(), and the loop that never waits.
 * Game design idea: rhythm and tension. A beat you can feel, and a clock that runs out.
 */

// ---------- measuring time ----------
// The checks below watch a Blink for a few seconds and time what it does. They never care when
// the learner's light happened to start, only how long things last, so any correct sketch passes.

const TOL = 0.25;                                     // how far a time may be from the goal's: 25%
const near = (got, want, tol = TOL) => Math.abs(got - want) <= want * tol;
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const isOn = names => names.some(n => n !== 'OFF');
const allAre = (names, c) => names.every(n => n === c);

// Is raw color c a shade of a named color, at any brightness? (colorName can't tell very dim
// colors apart: a CYAN at brightness 1 looks as much like RED as like CYAN to it.)
const SHAPE = { RED: [1, 0, 0], GREEN: [0, 1, 0], BLUE: [0, 0, 1], CYAN: [0, 1, 1], YELLOW: [1, 1, 0], MAGENTA: [1, 0, 1], WHITE: [1, 1, 1] };
function shadeOf(c, name) {
  const v = [(c >> 1) & 31, (c >> 6) & 31, (c >> 11) & 31], top = Math.max(...v);
  return top > 0 && SHAPE[name].every((on, i) => on ? Math.abs(v[i] - top) <= 1 : v[i] === 0);
}

// a time for people: "150 ms", "1 second", "2.5 seconds"
function dur(ms) {
  if (ms < 1000) return `${Math.round(ms / 10) * 10} ms`;
  const s = +(ms / 1000).toFixed(1);
  return `${s} second${s === 1 ? '' : 's'}`;
}

// Split a list of states into runs of the same state, each with how long it lasted.
// The first and last runs are cut off by the start and end of watching, so they're left out.
function runs(states, every) {
  const out = [];
  let cur = states[0], n = 0;
  for (const s of states) {
    if (s === cur) n++;
    else { out.push({ s: cur, ms: n * every }); cur = s; n = 1; }
  }
  out.push({ s: cur, ms: n * every });
  return out.slice(1, -1);
}

// Watch Blink 0 for `ms`, a look every `every` ms: [{ t, raw, names }]
function watch(tb, ms, every, t) {
  return tb.sample(every, Math.round(ms / every), x => {
    const raw = x.raw(0);
    return { t: x.time, raw, names: raw.map(t.colorName) };
  });
}
// Press the button, watch for `ms` (letting go after a quick tap), and return what was seen
function pressAndWatch(tb, ms, every, t) {
  tb.press(0);
  const a = watch(tb, 60, every, t);
  tb.release(0);
  return a.concat(watch(tb, ms - 60, every, t));
}

// ---------- a light that spins ----------
const SPIN_MS = 2400, SPIN_EVERY = 4;

// Where the light is at each look: the one face brighter than all the others, or -1
function spinTrack(t, ms = SPIN_MS) {
  const seen = watch(t.table().wait(300), ms, SPIN_EVERY, t);
  const pos = seen.map(({ raw }) => {
    const lv = raw.map(t.level), top = Math.max(...lv);
    const at = lv.map((l, f) => l === top ? f : -1).filter(f => f >= 0);
    return top > 0 && at.length === 1 ? at[0] : -1;
  });
  const moves = [];
  let last = -1;
  pos.forEach((p, k) => {
    if (p < 0) return;
    if (last >= 0 && p !== last) moves.push({ k, d: (p - last + 6) % 6 });
    last = p;
  });
  return { seen, pos, moves };
}

// The light moves: about every `ms` milliseconds, and/or one face at a time in direction `dir`
// (1 is clockwise, -1 counterclockwise)
const spins = ({ ms, dir, say }) => ({
  say,
  test(t) {
    const { pos, moves } = spinTrack(t);
    if (!pos.some(p => p >= 0)) return 'There was no single light to follow. Light one face at a time.';
    if (!moves.length) return `Your light stayed on face ${pos.find(p => p >= 0)} for ${dur(SPIN_MS)}.`;
    if (ms) {
      if (moves.length < 2) return `Your light moved only once in ${dur(SPIN_MS)}. The goal moves every ${dur(ms)}.`;
      const every = median(moves.slice(1).map((m, i) => (m.k - moves[i].k) * SPIN_EVERY));
      if (!near(every, ms, 0.2)) return `Your light moved every ${dur(every)}. The goal moves every ${dur(ms)}.`;
    }
    if (dir) {
      const want = dir > 0 ? 1 : 5;
      const d = median(moves.map(m => m.d));
      if (d !== want) {
        if (d === 6 - want) return `Your light moved ${dir > 0 ? 'counterclockwise' : 'clockwise'}. It should go ${dir > 0 ? 'clockwise' : 'counterclockwise'}.`;
        return `Your light jumped ${Math.min(d, 6 - d)} faces at a time. It should move to the very next face.`;
      }
    }
    return true;
  },
});

// While it spins, every lit face is `color`
const spinColor = (color, say) => ({
  say,
  test(t) {
    const { seen } = spinTrack(t);
    const lit = seen.flatMap(s => s.names.filter(n => n !== 'OFF'));
    if (!lit.length) return 'No face was lit.';
    const wrong = lit.find(n => n !== color);
    return !wrong || `Your light was ${wrong}.`;
  },
});

// Exactly one face is lit at every look
const oneLit = say => ({
  say,
  test(t) {
    const { seen } = spinTrack(t);
    const bad = seen.find(s => s.names.filter(n => n !== 'OFF').length !== 1);
    if (!bad) return true;
    const lit = t.litFaces(bad.names);
    return lit.length ? `Sometimes ${lit.length} faces were lit at once: ${t.faceList(lit)}.` : 'Sometimes no face was lit.';
  },
});

// The light waits about `long` ms on face `at`, and about `short` ms on every other face (4.2's twist)
const pausesAt = ({ at, long, short }, say) => ({
  say,
  test(t) {
    const { pos } = spinTrack(t, 5000);
    const rs = runs(pos, SPIN_EVERY).filter(r => r.s >= 0);
    const there = rs.filter(r => r.s === at), rest = rs.filter(r => r.s !== at);
    if (!there.length || !rest.length) return `Your light didn't go all the way around in ${dur(5000)}.`;
    const a = median(there.map(r => r.ms)), b = median(rest.map(r => r.ms));
    if (!near(a, long)) return `Your light waited ${dur(a)} on face ${at}. Make it wait there about ${dur(long)}.`;
    return near(b, short) || `On the other faces, yours waited ${dur(b)}. Keep those at ${dur(short)}.`;
  },
});

// The lit face takes turns between two colors, about every `ms` (4.3's twist: a second timer)
const colorSwaps = (colors, ms, say) => ({
  say,
  test(t) {
    const { seen } = spinTrack(t, 5000);
    const lit = seen.map(s => s.names.find(n => n !== 'OFF') || 'OFF');
    const odd = lit.find(n => !colors.includes(n));
    if (odd) return odd === 'OFF' ? 'Sometimes no face was lit.' : `Your light was ${odd}. Use ${colors.join(' and ')}.`;
    if (lit.every(n => n === lit[0])) return `Your light stayed ${lit[0]} the whole time.`;
    const rs = runs(lit, SPIN_EVERY);
    if (!rs.length) return `Your light changed color only once in ${dur(5000)}.`;
    const got = median(rs.map(r => r.ms));
    return near(got, ms) || `Your light changed color every ${dur(got)}. Make it change every ${ms === 1000 ? 'second' : dur(ms)}.`;
  },
});

// ---------- a light that blinks on and off ----------
const BLINK_MS = 4000, BLINK_EVERY = 4;
const blinkWatch = t => watch(t.table().wait(300), BLINK_MS, BLINK_EVERY, t);

// When it's lit, all six faces are `color`; and it does turn on and off
const flashes = (color, say) => ({
  say,
  test(t) {
    const seen = blinkWatch(t);
    const lit = seen.filter(s => isOn(s.names));
    if (!lit.length) return 'Yours stayed dark.';
    const wrong = lit.find(s => !allAre(s.names, color));
    if (wrong) return `When it was lit, yours showed ${t.describe(wrong.names)}.`;
    if (lit.length === seen.length) return `Yours stayed ${color} and never turned off.`;
    return true;
  },
});

// Each time it turns on (on: true) or off (on: false), it stays that way for about `want` ms
const lasts = (on, want, say) => ({
  say,
  test(t) {
    const st = blinkWatch(t).map(s => isOn(s.names));
    if (st.every(s => s === st[0])) return st[0] ? 'Yours never turned off.' : 'Yours never lit up.';
    const rs = runs(st, BLINK_EVERY).filter(r => r.s === on);
    if (!rs.length) return `Yours changed only once in ${dur(BLINK_MS)}.`;
    const got = median(rs.map(r => r.ms));
    if (near(got, want)) return true;
    return on ? `Yours stayed on for ${dur(got)} each time. The goal stays on for ${dur(want)}.`
      : `Yours was off for ${dur(got)} each time. The goal is off for ${dur(want)}.`;
  },
});

// A double beat: two flashes of about `on` ms with `gap` ms between them, then a rest of `rest` ms
const lubDub = ({ on, gap, rest }, say) => ({
  say,
  test(t) {
    const st = blinkWatch(t).map(s => isOn(s.names));
    if (st.every(s => s === st[0])) return st[0] ? 'Yours never turned off.' : 'Yours never lit up.';
    const rs = runs(st, BLINK_EVERY);
    const ons = rs.filter(r => r.s), offs = rs.filter(r => !r.s);
    const flash = median(ons.map(r => r.ms));
    if (!near(flash, on, 0.3)) return `Each flash of yours lasted ${dur(flash)}. Make each one about ${dur(on)}.`;
    const short = offs.filter(r => r.ms < (gap + rest) / 2), long = offs.filter(r => r.ms >= (gap + rest) / 2);
    if (!short.length) return `Yours rested ${dur(median(offs.map(r => r.ms)))} after every flash. The two beats should be close together.`;
    if (!long.length) return `Yours never rested. After two beats, stay off for about ${dur(rest)}.`;
    if (!near(median(short.map(r => r.ms)), gap, 0.3)) return `Between the two beats, yours was off for ${dur(median(short.map(r => r.ms)))}. Make it about ${dur(gap)}.`;
    if (!near(median(long.map(r => r.ms)), rest, 0.3)) return `Yours rested for ${dur(median(long.map(r => r.ms)))}. Make it about ${dur(rest)}.`;
    // between two rests there's exactly one short gap: two beats
    const offOrder = offs.map(r => r.ms >= (gap + rest) / 2);
    for (let i = 0, n = 0, seenRest = false; i < offOrder.length; i++) {
      if (offOrder[i]) {
        if (seenRest && n !== 1) return `Yours made ${n + 1} beats between rests. Make it two.`;
        seenRest = true; n = 0;
      } else n++;
    }
    return true;
  },
});

// ---------- breathing ----------
const BREATH_MS = 12000, BREATH_EVERY = 20;
const breathWatch = t => watch(t.table().wait(300), BREATH_MS, BREATH_EVERY, t);
// how bright face 0 is at each look
const brightness = (t, seen) => seen.map(s => t.level(s.raw[0]));

const breathColor = (color, say) => ({
  say,
  test(t) {
    const seen = breathWatch(t);
    const lit = seen.filter(s => isOn(s.names));
    if (!lit.length) return 'Yours stayed dark.';
    const odd = lit.find(s => !s.names.every(n => n === s.names[0]));
    if (odd) return `Its faces didn't match: ${odd.names.join(', ')}.`;
    const wrong = lit.find(s => !shadeOf(s.raw[0], color));
    if (wrong) return `Yours glowed ${wrong.names[0]}.`;
    return Math.max(...brightness(t, seen)) >= 28 || 'Yours never got bright. At the top of a breath it should be full brightness.';
  },
});

const fadesSmoothly = say => ({
  say,
  test(t) {
    const lv = brightness(t, breathWatch(t));
    const levels = new Set(lv).size;
    if (levels === 1) return 'Yours stayed at one brightness.';
    return levels >= 12 || `Yours jumped between ${levels} brightness levels. A breath fades through many.`;
  },
});

const breathTakes = (want, say) => ({
  say,
  test(t) {
    const lv = brightness(t, breathWatch(t));
    const top = Math.max(...lv), bottom = Math.min(...lv), mid = (top + bottom) / 2;
    if (top === bottom) return 'Yours stayed at one brightness, so it never took a breath.';
    // each time it brightens past halfway, a new breath has begun
    const ups = [];
    for (let k = 1; k < lv.length; k++) if (lv[k - 1] < mid && lv[k] >= mid) ups.push(k * BREATH_EVERY);
    if (ups.length < 2) return `Yours took longer than ${dur(BREATH_MS / 2)} for each breath. The goal takes about ${dur(want)}.`;
    const got = median(ups.slice(1).map((u, i) => u - ups[i]));
    return near(got, want, 0.2) || `Yours took ${dur(got)} for each breath. The goal takes about ${dur(want)}.`;
  },
});

// ---------- a click that starts a glow ----------
// The glow: from the first look after the press that's different from before it, to the first
// all-`idle` look after that
function glowAfterClick(t, idle) {
  const seen = pressAndWatch(t.table().wait(500), 8000, 10, t);
  const before = seen[0].names.join();
  const start = seen.findIndex(s => s.names.join() !== before);
  if (start < 0) return { seen, start: -1, end: -1 };
  const end = seen.findIndex((s, k) => k > start && allAre(s.names, idle));
  return { seen, start, end };
}

const idleIs = (color, say) => ({
  say,
  test(t) {
    const seen = watch(t.table().wait(500), 3000, 100, t);
    const k = seen.findIndex(s => !allAre(s.names, color));
    if (k < 0) return true;
    return k === 0 ? `Before any click, yours was ${t.describe(seen[0].names)}.`
      : `Before any click, yours changed to ${t.describe(seen[k].names)} after ${dur(500 + k * 100)}.`;
  },
});

const clickTurns = (color, say) => ({
  say,
  test(t) {
    const tb = t.table().wait(500).click(0);
    const got = tb.faces(0);
    return allAre(got, color) || `Right after a click, yours was ${t.describe(got)}.`;
  },
});

const glowLasts = (color, idle, want, say) => ({
  say,
  test(t) {
    const { seen, start, end } = glowAfterClick(t, idle);
    if (!allAre(seen[0].names, idle)) return `Before the click, yours was ${t.describe(seen[0].names)}. It should be ${idle}.`;
    if (start < 0) return `Yours stayed ${t.describe(seen[0].names)} after a click.`;
    // color null: any glow will do (the twist's fades through many)
    if (color && !allAre(seen[start].names, color)) return `After a click, yours was ${t.describe(seen[start].names)}.`;
    if (end < 0) {
      const last = seen[seen.length - 1].names;
      const glowing = color ? allAre(last, color) : last.some(n => n !== 'OFF');
      return glowing ? `Yours kept glowing and never went back to ${idle}.` : `After the glow, yours was ${t.describe(last)}. It should go back to ${idle}.`;
    }
    const got = seen[end].t - seen[start].t;
    return near(got, want, 0.2) || `Yours glowed for ${dur(got)}. The goal glows for ${dur(want)}.`;
  },
});

// 4.6's twist: the glow starts bright and dims as the time runs out
const glowFades = (color, idle, say) => ({
  say,
  test(t) {
    const { seen, start, end } = glowAfterClick(t, idle);
    if (start < 0) return `Yours stayed ${t.describe(seen[0].names)} after a click.`;
    const glow = seen.slice(start, end < 0 ? undefined : end);
    const odd = glow.find(s => s.raw.some((c, f) => s.names[f] !== 'OFF' && !shadeOf(c, color)));
    if (odd) return `While it glowed, yours showed ${t.describe(odd.names)}.`;
    const lv = glow.map(s => Math.max(...s.raw.map(t.level)));
    const q = f => lv[Math.floor(lv.length * f)];
    if (q(0) < 24) return `Your glow started dim. Start at full brightness.`;
    if (lv.some((l, k) => k && l > lv[k - 1] + 1)) return 'Your glow got brighter partway through. It should only get dimmer.';
    if (q(0.25) - q(0.75) < 6) return `Yours stayed about as bright from start to end.`;
    return q(0.95) <= 10 || 'Yours was still bright at the end. Fade almost all the way out.';
  },
});

// ---------- the countdown (the boss) ----------
const yellow = names => names.filter(n => n === 'YELLOW').length;

// Click, then follow the countdown: when it armed, and each time a YELLOW face went dark
function countdown(t) {
  const seen = pressAndWatch(t.table().wait(500), 12000, 10, t);
  const arm = seen.findIndex(s => yellow(s.names) === 6);
  const drops = [];
  if (arm >= 0) {
    let cur = 6;
    for (let k = arm + 1; k < seen.length && cur > 0; k++) {
      const c = yellow(seen[k].names);
      if (c < cur) drops.push({ k, from: cur, to: c });
      if (c > cur) { drops.push({ k, from: cur, to: c, up: true }); break; }
      cur = c;
    }
  }
  return { seen, arm, drops };
}

const countsDown = say => ({
  say,
  test(t) {
    const { seen, arm, drops } = countdown(t);
    if (arm < 0) return 'After a click, yours never showed six YELLOW faces.';
    const up = drops.find(d => d.up);
    if (up) return `Your countdown went back up, from ${up.from} YELLOW faces to ${up.to}.`;
    const jump = drops.find(d => d.from - d.to > 1);
    if (jump) return `Yours went from ${jump.from} YELLOW faces to ${jump.to} at once. Take away one at a time.`;
    let prev = seen[arm].t;
    for (let i = 0; i < drops.length; i++) {
      const gap = seen[drops[i].k].t - prev;
      if (!near(gap, 1000)) {
        return i === 0 ? `Your first face went dark ${dur(gap)} after the countdown began. Each face should last about a second.`
          : `Your faces went dark ${dur(gap)} apart. The goal loses one face each second.`;
      }
      prev = seen[drops[i].k].t;
    }
    if (!drops.length) return `Yours stayed at six YELLOW faces for ${dur(seen[seen.length - 1].t - seen[arm].t)}.`;
    if (drops.length < 6) return `Your countdown stopped at ${drops[drops.length - 1].to} YELLOW face${drops[drops.length - 1].to === 1 ? '' : 's'}.`;
    return true;
  },
});

const boomFlashes = say => ({
  say,
  test(t) {
    const { seen, arm, drops } = countdown(t);
    const zero = drops.find(d => d.to === 0);
    if (arm < 0 || !zero) return 'Your countdown never reached zero, so there was no flash to see.';
    // watch four seconds from zero
    const after = seen.filter(s => s.t >= seen[zero.k].t && s.t < seen[zero.k].t + 4000);
    const lit = after.filter(s => isOn(s.names));
    if (!lit.length) return 'At zero, yours went dark and stayed dark.';
    const wrong = lit.find(s => !allAre(s.names, 'RED'));
    if (wrong) return `At zero, yours showed ${t.describe(wrong.names)}. It should flash all six faces RED.`;
    if (lit.length === after.length) return 'At zero, yours stayed RED without flashing.';
    const rs = runs(after.map(s => isOn(s.names)), 10);
    if (rs.length < 2) return 'At zero, yours flashed only once or twice. Keep flashing until a click.';
    const each = median(rs.map(r => r.ms));
    return (each >= 150 && each <= 400) || `Yours flashed on and off every ${dur(each)}. The goal flashes every 250 ms.`;
  },
});

const defuses = say => ({
  say,
  test(t) {
    const tb = t.table().wait(500).click(0).wait(2000);
    const mid = tb.faces(0);
    if (!yellow(mid)) return `Two seconds after a click, yours showed ${t.describe(mid)}. It should be counting down in YELLOW.`;
    tb.click(0);
    const back = tb.faces(0);
    if (!allAre(back, 'GREEN')) return `After a click during the countdown, yours showed ${t.describe(back)}. It should go back to GREEN.`;
    const later = watch(tb, 7000, 100, t);
    const k = later.findIndex(s => !allAre(s.names, 'GREEN'));
    if (k >= 0) return `Yours went back to GREEN. Then ${dur(k * 100)} later it showed ${t.describe(later[k].names)}. It should stay GREEN.`;
    tb.click(0);
    const again = tb.faces(0);
    if (yellow(again) !== 6) return `A click after that showed ${t.describe(again)}. It should start a new countdown with six YELLOW faces.`;
    // follow the new countdown: it starts from six again, so one face is left after five seconds
    for (const [ms, want] of [[1000, 5], [4000, 1]]) {
      const got = yellow(tb.wait(ms).faces(0));
      if (got !== want) return `In the new countdown, yours had ${got} YELLOW face${got === 1 ? '' : 's'} after ${ms === 1000 ? 'one second' : 'five seconds'}. It should have ${want}.`;
    }
    return true;
  },
});

const resetsAfterBoom = say => ({
  say,
  test(t) {
    const tb = t.table().wait(500).click(0).wait(8500);
    tb.click(0);
    const back = tb.faces(0);
    if (!allAre(back, 'GREEN')) return `After the flashing, a click left yours at ${t.describe(back)}. It should go back to GREEN.`;
    const later = watch(tb, 2000, 100, t);
    const k = later.findIndex(s => !allAre(s.names, 'GREEN'));
    return k < 0 || `Yours went back to GREEN. Then it changed to ${t.describe(later[k].names)}.`;
  },
});

// The boss's twist: when two faces or one are left, they're RED
const lastTwoRed = say => ({
  say,
  test(t) {
    const seen = pressAndWatch(t.table().wait(500), 8000, 10, t);
    const arm = seen.findIndex(s => yellow(s.names) === 6);
    if (arm < 0) return 'After a click, yours never showed six YELLOW faces.';
    let reached = false;
    for (const s of seen.slice(arm)) {
      const lit = s.names.filter(n => n !== 'OFF');
      if (!lit.length || (lit.length === 6 && allAre(lit, 'RED'))) break;   // zero, or the flashing
      if (lit.length <= 2) {
        reached = true;
        const wrong = lit.find(n => n !== 'RED');
        if (wrong) return `With ${lit.length === 1 ? 'one face' : 'two faces'} left, yours showed ${wrong}.`;
      } else if (lit.some(n => n !== 'YELLOW')) return `With ${lit.length} faces left, yours showed ${lit.find(n => n !== 'YELLOW')}. Stay YELLOW until two are left.`;
    }
    return reached || 'Your countdown never got down to two faces.';
  },
});

// ---------- the bridge: a timer that rings once ----------
const ringsOnce = say => ({
  say,
  test(t) {
    const seen = watch(t.table(), 6000, 10, t);
    const k = seen.findIndex(s => allAre(s.names, 'GREEN'));
    if (k < 0) return `Yours never turned GREEN in ${dur(6000)}. It was ${t.describe(seen[seen.length - 1].names)}.`;
    if (k < 10) return 'Yours was GREEN right from the start.';
    if (!near(seen[k].t, 2000, 0.2)) return `Yours turned GREEN after ${dur(seen[k].t)}. The goal turns GREEN after 2 seconds.`;
    const back = seen.slice(k).find(s => !allAre(s.names, 'GREEN'));
    return !back || `Yours turned GREEN, then changed to ${t.describe(back.names)}.`;
  },
});
const startsAs = (color, say) => ({
  say,
  test(t) {
    const got = t.table().wait(300).faces(0);
    return allAre(got, color) || `At the start, yours was ${t.describe(got)}.`;
  },
});

// ---------- the levels ----------
const SPIN = ms => `Timer stepTimer;
byte face = 0;

void setup() {
}

void loop() {
  if (stepTimer.isExpired()) {
    face = (face + 1) % FACE_COUNT;   // the next face, and back to 0 after 5
    stepTimer.set(${ms});
  }

  setColor(OFF);
  setColorOnFace(WHITE, face);
}
`;

const BOSS_GOAL = `Timer tick;
byte mode = 0;   // 0 waiting, 1 counting down, 2 flashing
byte left = 6;   // YELLOW faces left

void setup() {
}

void loop() {
  if (buttonPressed()) {
    if (mode == 0) {
      mode = 1;
      left = 6;
      tick.set(1000);
      setColor(YELLOW);
    } else {
      mode = 0;
    }
  }

  if (mode == 1 && tick.isExpired()) {
    left = left - 1;
    setColorOnFace(OFF, left);
    tick.set(1000);
    if (left == 0) {
      mode = 2;
    }
  }

  if (mode == 0) {
    setColor(GREEN);
  }
  if (mode == 2) {
    if ((millis() / 250) % 2 == 0) {
      setColor(RED);
    } else {
      setColor(OFF);
    }
  }
}
`;

export default {
  n: 4, name: 'Time', color: '#22d3ee', view: 'split',
  blurb: 'Make things happen later without ever stopping. Timers, millis(), and a loop that never waits.',
  design: 'Rhythm and tension. A beat you can feel, and a clock that runs out.',
  levels: [
    {
      id: '4.1', type: 'discover', title: 'No delay()', skills: ['timers'],
      startFails: true,
      brief: 'This sketch tries to blink YELLOW. It uses delay(500) to stop for half a second. A Blink can never stop, so this won\'t run. Read the red message, and answer the question. Then make it blink with the Timer at the top: set() starts it, and isExpired() is true once the time is up.',
      start: `Timer blinkTimer;
bool on = false;

void setup() {
}

void loop() {
  on = !on;
  delay(500);

  if (on) {
    setColor(YELLOW);
  } else {
    setColor(OFF);
  }
}
`,
      goal: `Timer blinkTimer;
bool on = false;

void setup() {
}

void loop() {
  if (blinkTimer.isExpired()) {
    on = !on;
    blinkTimer.set(500);
  }

  if (on) {
    setColor(YELLOW);
  } else {
    setColor(OFF);
  }
}
`,
      checks: [
        flashes('YELLOW', 'All six faces blink YELLOW'),
        lasts(true, 500, 'It stays on for about half a second'),
        lasts(false, 500, 'Then it stays off for about half a second'),
      ],
      ask: {
        q: 'Why can\'t a Blink stop and wait with delay()?',
        options: [
          'While it waited, it couldn\'t notice clicks or talk to its neighbors',
          'delay() is too slow for a Blink',
          'A Blink has no clock, so it can\'t tell time',
        ],
        answer: 0,
        why: 'Right. loop() runs over and over, about 130 times a second. Each time around, the Blink also checks its button and its neighbors. A Timer lets it wait without stopping.',
      },
      hints: {
        nudge: 'Take out the delay(500) line. Then run on = !on only when the timer rings.',
        concept: 'A Timer is like a kitchen timer. blinkTimer.set(500) starts it for 500 milliseconds. blinkTimer.isExpired() is true once the time is up. loop() keeps checking it, over and over.',
        point: { line: 9, text: 'This is the line a Blink can\'t run. Wrap the line above it in an if instead.' },
        fill: 'if (blinkTimer.isExpired()) {\n  on = !on;\n  blinkTimer.set(___);\n}',
      },
    },
    {
      id: '4.2', type: 'tweak', title: 'Spin speed', skills: ['timers'],
      brief: 'This Blink spins a WHITE light with a Timer. Each time the timer rings, the light moves to the next face and the timer starts again. Times are in milliseconds: 1000 make one second. Change one number so yours spins as slowly as the Goal Blink.',
      start: SPIN(150),
      goal: SPIN(400),
      checks: [
        spinColor('WHITE', 'One WHITE light'),
        spins({ dir: 1, say: 'It moves clockwise, one face at a time' }),
        spins({ ms: 400, say: 'It moves about every 400 ms' }),
      ],
      hints: {
        nudge: 'Yours is too fast. Which number says how long to wait?',
        concept: 'stepTimer.set(150) means "ring in 150 milliseconds". A bigger number means a longer wait, so a slower spin.',
        point: { line: 10, text: 'This number is how long the light waits on each face.' },
        fill: 'stepTimer.set(4__);',
      },
      twist: {
        brief: 'Give the spin a rhythm: the light waits a whole second on face 0, and still 400 ms on every other face.',
        checks: [
          pausesAt({ at: 0, long: 1000, short: 400 }, 'It waits about 1 second on face 0 and 400 ms on the others'),
          spins({ dir: 1, say: 'It still moves clockwise, one face at a time' }),
        ],
        solution: SPIN(400).replace('    stepTimer.set(400);\n', `    if (face == 0) {
      stepTimer.set(1000);
    } else {
      stepTimer.set(400);
    }
`),
      },
      reflect: {
        q: 'What would stepTimer.set(1000) do?',
        options: ['The light moves once every second', 'The light moves 1000 times a second', 'The light jumps 1000 faces'], answer: 0,
        why: '1000 milliseconds is one second. The timer rings once a second, so the light moves once a second.',
      },
    },
    {
      id: '4.3', type: 'fix', title: 'The timer that never rings', skills: ['timers'],
      brief: 'This should spin a WHITE light clockwise, one face every 150 ms. Instead the light just sits on face 0. Find out why the timer never rings, and fix it.',
      start: `Timer stepTimer;
byte face = 0;

void setup() {
}

void loop() {
  stepTimer.set(150);

  if (stepTimer.isExpired()) {
    face = (face + 1) % FACE_COUNT;   // the next face, and back to 0 after 5
  }

  setColor(OFF);
  setColorOnFace(WHITE, face);
}
`,
      goal: SPIN(150),
      checks: [
        spinColor('WHITE', 'One face is lit WHITE'),
        spins({ ms: 150, dir: 1, say: 'The light moves to the next face about every 150 ms' }),
        oneLit('The other five faces are off'),
      ],
      hints: {
        nudge: 'loop() runs about 130 times a second. What happens to the timer each time it runs?',
        concept: 'set() starts the timer over from the beginning. If you set it every time around the loop, it never gets to the end, so isExpired() is never true. Set it again only after it rings.',
        point: { line: 8, text: 'This line restarts the timer every time loop() runs. Move it inside the if.' },
        fill: 'if (stepTimer.isExpired()) {\n  face = (face + 1) % FACE_COUNT;\n  stepTimer.___(150);\n}',
      },
      bridge: {
        id: '4.3a', type: 'build', title: 'Ring once', skills: ['timers'],
        brief: 'A small step first. This Blink should be RED for 2 seconds, then turn GREEN and stay GREEN. Right now it\'s GREEN at once, because nobody started the timer. Start it once, in setup().',
        start: `Timer alarm;

void setup() {
}

void loop() {
  if (alarm.isExpired()) {
    setColor(GREEN);
  } else {
    setColor(RED);
  }
}
`,
        goal: `Timer alarm;

void setup() {
  alarm.set(2000);
}

void loop() {
  if (alarm.isExpired()) {
    setColor(GREEN);
  } else {
    setColor(RED);
  }
}
`,
        checks: [
          startsAs('RED', 'At first, it\'s RED'),
          ringsOnce('After 2 seconds it turns GREEN, and stays GREEN'),
        ],
        hints: {
          nudge: 'A timer that was never set is already done. Where does code go that should run only once?',
          concept: 'setup() runs once, when the Blink wakes up. alarm.set(2000) there starts a 2 second timer, one time.',
          point: { line: 3, text: 'Put one line in setup(), between the { and the }.' },
          fill: 'alarm.set(____);',
        },
        reflect: {
          q: 'What would happen if alarm.set(2000) were the first line of loop() instead?',
          options: ['It would stay RED forever', 'It would turn GREEN after 2 seconds', 'It would blink'], answer: 0,
          why: 'loop() runs over and over, so the timer would start over every time. It would never reach the end.',
        },
      },
      twist: {
        brief: 'A Blink can run two timers at once. Add a second Timer that switches the light between WHITE and RED every second, while it keeps spinning every 150 ms.',
        checks: [
          colorSwaps(['WHITE', 'RED'], 1000, 'The light switches between WHITE and RED every second'),
          spins({ ms: 150, dir: 1, say: 'It still moves clockwise, about every 150 ms' }),
        ],
        solution: `Timer stepTimer;
Timer colorTimer;
byte face = 0;
bool red = false;

void setup() {
}

void loop() {
  if (stepTimer.isExpired()) {
    face = (face + 1) % FACE_COUNT;
    stepTimer.set(150);
  }

  if (colorTimer.isExpired()) {
    red = !red;
    colorTimer.set(1000);
  }

  setColor(OFF);
  if (red) {
    setColorOnFace(RED, face);
  } else {
    setColorOnFace(WHITE, face);
  }
}
`,
      },
      reflect: {
        q: 'Why did the light stay on face 0?',
        options: ['The timer started over every time loop() ran, so it never rang', 'The timer was too short', 'face can\'t be bigger than 0'], answer: 0,
        why: 'set() starts the timer from the beginning. Set it only when it rings, and it gets the chance to finish.',
      },
    },
    {
      id: '4.4', type: 'build', title: 'Heartbeat', skills: ['timers', 'conditions'],
      brief: 'Give your Blink a heartbeat. All six faces flash RED for 200 ms, then go OFF for 800 ms, over and over. That makes one beat every second. One timer can do it if you set it to a different time after each change.',
      start: `Timer beatTimer;
bool on = false;

void setup() {
}

void loop() {
}
`,
      goal: `Timer beatTimer;
bool on = false;

void setup() {
}

void loop() {
  if (beatTimer.isExpired()) {
    on = !on;
    if (on) {
      beatTimer.set(200);
    } else {
      beatTimer.set(800);
    }
  }

  if (on) {
    setColor(RED);
  } else {
    setColor(OFF);
  }
}
`,
      checks: [
        flashes('RED', 'All six faces flash RED'),
        lasts(true, 200, 'Each beat is on for about 200 ms'),
        lasts(false, 800, 'Then it\'s off for about 800 ms'),
      ],
      hints: {
        nudge: 'Start from your blink in 4.1. This time the on part and the off part last different times.',
        concept: 'When the timer rings, flip on. If the light just turned on, set the timer to 200. If it just turned off, set it to 800.',
        point: { line: 7, text: 'Everything goes inside loop(): first the timer, then the color.' },
        fill: 'if (beatTimer.isExpired()) {\n  on = !on;\n  if (on) {\n    beatTimer.set(___);\n  } else {\n    beatTimer.set(___);\n  }\n}\n\nif (on) {\n  setColor(___);\n} else {\n  setColor(OFF);\n}',
      },
      twist: {
        brief: 'Real hearts go lub-dub. Make two quick beats, then a rest: RED 150 ms, OFF 150 ms, RED 150 ms, then OFF 700 ms, over and over.',
        checks: [lubDub({ on: 150, gap: 150, rest: 700 }, 'Two quick beats, then a rest')],
        solution: `Timer beatTimer;
byte step = 0;

void setup() {
}

void loop() {
  if (beatTimer.isExpired()) {
    step = (step + 1) % 4;
    if (step == 3) {
      beatTimer.set(700);
    } else {
      beatTimer.set(150);
    }
  }

  if (step == 0 || step == 2) {
    setColor(RED);
  } else {
    setColor(OFF);
  }
}
`,
      },
      reflect: {
        q: 'Your heartbeat has a short flash and a long rest. How does one timer do both?',
        options: ['Each time it rings, it gets set to the next wait', 'It counts to 1000 by itself', 'It needs two loop() functions'], answer: 0,
        why: 'A timer doesn\'t have to wait the same time every time. You choose a new wait each time you call set().',
      },
    },
    {
      id: '4.5', type: 'tweak', title: 'Breathe', skills: ['timers', 'light'],
      brief: 'millis() is how many milliseconds the Blink has been awake. It grows all the time. sin8_C() turns a growing number into a wave that rises and falls, and dim() uses the wave to fade CYAN in and out. The Goal Blink breathes slower: about one breath every 4 seconds. Change one number to match it.',
      start: `void setup() {
}

void loop() {
  byte wave = sin8_C(millis() / 8);
  setColor(dim(CYAN, wave));
}
`,
      goal: `void setup() {
}

void loop() {
  byte wave = sin8_C(millis() / 16);
  setColor(dim(CYAN, wave));
}
`,
      checks: [
        breathColor('CYAN', 'It glows CYAN'),
        fadesSmoothly('It fades in and out smoothly'),
        breathTakes(4000, 'One breath takes about 4 seconds'),
      ],
      hints: {
        nudge: 'Yours breathes twice as fast as the goal. Only one number changes how fast the wave moves.',
        concept: 'millis() / 8 grows 8 times slower than millis(). Dividing by a bigger number makes it grow even slower, so the wave rises and falls more slowly.',
        point: { line: 5, text: 'Try a different number after the /.' },
        fill: 'byte wave = sin8_C(millis() / __);',
      },
      reflect: {
        q: 'What happens if you divide millis() by a bigger number?',
        options: ['The wave rises and falls more slowly, so the breath is slower', 'The light gets dimmer', 'The breath gets faster'], answer: 0,
        why: 'A bigger number makes millis() / k grow more slowly. The wave takes longer to go up and down.',
      },
    },
    {
      id: '4.6', type: 'build', title: 'Afterglow', skills: ['timers', 'events'],
      brief: 'Your Blink waits, all six faces BLUE. Click it, and it glows GREEN for 3 seconds. Then it goes back to BLUE on its own. Use the Timer to know when the glow is over.',
      start: `Timer glowTimer;

void setup() {
}

void loop() {
  setColor(BLUE);
}
`,
      goal: `Timer glowTimer;

void setup() {
}

void loop() {
  if (buttonPressed()) {
    glowTimer.set(3000);
  }

  if (glowTimer.isExpired()) {
    setColor(BLUE);
  } else {
    setColor(GREEN);
  }
}
`,
      checks: [
        idleIs('BLUE', 'Before a click, it stays BLUE'),
        clickTurns('GREEN', 'A click turns it GREEN'),
        glowLasts('GREEN', 'BLUE', 3000, 'The glow lasts about 3 seconds, then it\'s BLUE again'),
      ],
      hints: {
        nudge: 'A click should start the timer. While the timer is running, show GREEN.',
        concept: 'A timer that isn\'t running yet is already expired. So isExpired() means "no glow right now", and not expired means "still glowing".',
        point: { line: 7, text: 'Before this line, start the timer when the button is pressed. Then choose BLUE or GREEN with isExpired().' },
        fill: 'if (buttonPressed()) {\n  glowTimer.set(____);\n}\n\nif (glowTimer.isExpired()) {\n  setColor(____);\n} else {\n  setColor(_____);\n}',
      },
      twist: {
        brief: 'Make it a real afterglow: bright GREEN right after the click, fading dimmer until the 3 seconds are up. glowTimer.getRemaining() tells you how many milliseconds are left.',
        checks: [
          glowFades('GREEN', 'BLUE', 'The glow starts bright and fades out'),
          glowLasts(null, 'BLUE', 3000, 'After about 3 seconds, it\'s BLUE again'),
        ],
        solution: `Timer glowTimer;

void setup() {
}

void loop() {
  if (buttonPressed()) {
    glowTimer.set(3000);
  }

  if (glowTimer.isExpired()) {
    setColor(BLUE);
  } else {
    byte bright = glowTimer.getRemaining() * 255 / 3000;
    setColor(dim(GREEN, bright));
  }
}
`,
      },
      reflect: {
        q: 'What happens if you click again while it\'s still glowing?',
        options: ['The timer starts over, so the glow lasts 3 more seconds', 'It turns BLUE right away', 'Nothing, the click is lost'], answer: 0,
        why: 'Each click calls set(3000) again, and set() always starts the timer from the beginning.',
      },
    },
  ],
  boss: {
    id: '4.★', type: 'boss', title: 'Countdown', skills: ['timers', 'events', 'variables'],
    brief: 'Build a countdown you have to stop in time. It waits with all six faces GREEN. Click to start it: all six faces turn YELLOW, and one face goes dark every second. When the last face goes dark, after 6 seconds, it flashes all six faces RED, a quarter second on and a quarter second off, until you click. A click during the countdown stops it in time and goes back to GREEN. A click while it flashes goes back to GREEN too.',
    start: `void setup() {
}

void loop() {
}
`,
    goal: BOSS_GOAL,
    checks: [
      idleIs('GREEN', 'Before a click, all six faces are GREEN'),
      clickTurns('YELLOW', 'A click starts it: all six faces turn YELLOW'),
      countsDown('One YELLOW face goes dark each second'),
      boomFlashes('At zero, all six faces flash RED'),
      defuses('A click during the countdown stops it: back to GREEN'),
      resetsAfterBoom('A click while it flashes goes back to GREEN'),
    ],
    hints: {
      nudge: 'Your Blink is in one of three moods: waiting, counting down, or flashing. Keep a variable that says which.',
      concept: 'A variable like mode remembers what the Blink is doing. A click changes the mode. A Timer set to 1000 rings once a second; each time it rings, turn off one face and set it again.',
      point: { line: 4, text: 'Start in loop(): if the button is pressed, change the mode. Add your variables and a Timer above setup().' },
      fill: 'Timer tick;\nbyte mode = 0;\nbyte left = 6;\n...\nif (mode == 1 && tick.isExpired()) {\n  left = left - 1;\n  setColorOnFace(___, left);\n  tick.set(____);\n  if (left == 0) {\n    mode = _;\n  }\n}',
    },
    twist: {
      brief: 'Add tension: when only two faces are left, they turn RED.',
      checks: [lastTwoRed('The last two faces turn RED')],
      solution: BOSS_GOAL.replace(`    setColorOnFace(OFF, left);
`, `    setColorOnFace(OFF, left);
    if (left == 2) {
      setColorOnFace(RED, 0);
      setColorOnFace(RED, 1);
    }
`),
    },
    reflect: {
      q: 'Even if Blinks had delay(), why couldn\'t delay(1000) run this countdown?',
      options: ['While it waited, it couldn\'t notice your click', 'delay(1000) waits too long', 'delay() can\'t count to 6'], answer: 0,
      why: 'A stopped Blink can\'t check its button. A Timer lets it count and listen at the same time.',
    },
  },
};
