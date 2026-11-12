/*
 * Game sharing: the BlinkBIOS bootloader's seed and download mode (download_and_seed_mode() in
 * bootloader.cpp), with links and blocks in place of SEED/PULL/PUSH packets.
 *
 * A Blink held alone for 3 s and let go becomes the root. Every Blink in the share seeds one face
 * at a time, going clockwise: the root from face 0, the others from the face after the one they
 * download from. A Blink there that isn't sharing yet starts downloading, block by block, and
 * starts seeding its own neighbors right away, passing each block on as it gets it, so the game
 * travels down a line of Blinks like a game of telephone. A face where nobody answers is given up
 * after three tries (the root keeps trying for its first 5 s, so it can be put down into a group).
 * Once a neighbor has the whole game, the seeder moves on to its next face and comes back to check
 * on it until that neighbor, and everything past it, is done. When all of the root's faces are
 * done it starts the game and passes a LETSGO back out along the links, so every Blink starts.
 *
 * What the faces show, as on hardware: full blue on the face being seeded, blue stepping up with
 * each block on both ends of a link (block × 4, so it wraps every 8 blocks), half green on a link
 * that is done but still seeding further on, full green when everything past it is done. A press
 * stops sharing on that Blink; one without the whole game shows half red until pressed again.
 */

import * as H from '../compiler/rt.js';

export const SEED = {
  BLOCKS: 32,             // blocks in a game (hardware: 176 blocks of 32 bytes)
  BLOCK_MS: 62,           // one block across a link, so a game takes about 2 s (hardware: ~100 ms a block, ~17 s)
  LINK_MS: 50,            // a SEED and the answer to it, and a LETSGO from one Blink to the next
  TRY_MS: 67,             // wait this long for an answer (TIMEOUT_COLD_SEND_MS, 50 ms, plus sending the SEED)
  TRIES: 3,               // SEND_TRY_COUNT: tries per face, so the search takes ~200 ms a face
  STALL_MS: 360,          // a link that gets no block for this long is given up (3 × TIMEOUT_WARM_SEND_MS)
  ROOT_STARTUP_MS: 5000,  // TIMEOUT_ROOT_STARTUP_MS: the root doesn't give up on a face before this
};

const FULL = 31, HALF = 15;   // PIXELCOLOR_PRIMARY_FULL / _HALF
const ALL = 0x3f;
const PRESSED = 1;
const blue = n => (n << 2) & 31;

export class Seeding {
  constructor(world) {
    this.world = world;
    this.members = new Map();   // Blink -> its seed state
  }

  get active() { return this.members.size > 0; }
  clear() { this.members.clear(); }

  // The Blink was let go after the blue spin: it seeds its game (blinklib's BLINKBIOS_BOOTLOADER_SEED_VECTOR)
  start(root) {
    const m = this.join(root, -1);
    m.have = SEED.BLOCKS;
    m.sendFace = 0;
    m.startupUntil = this.world.time + SEED.ROOT_STARTUP_MS;
    m.shared = 0;
    m.root = m;
  }

  join(b, source, parent = null) {
    b.mode = 'seeding';
    b.btn.bitflags = 0;
    b.display.fill(0);
    const m = {
      blink: b, source, parent, root: parent && parent.root, have: 0,
      notdone: source < 0 ? ALL : ALL & ~(1 << source),
      sendFace: source < 0 ? 0 : (source + 1) % 6,
      tries: SEED.TRIES, startupUntil: 0,
      action: 'idle',        // idle | seed (waiting for an answer) | push (sending blocks to a neighbor)
      waitUntil: 0, sentAt: 0, answered: false, skip: false,
      child: null, blockEnd: 0, lastBlockAt: 0,
      g: new Uint8Array(6), b: new Uint8Array(6),
      exitAt: -1, failed: false,
    };
    this.members.set(b, m);
    return m;
  }

  // once per simulated millisecond
  tick() {
    const t = this.world.time;
    for (const [b, m] of this.members) {
      if (!this.world.blinks.includes(b)) { this.members.delete(b); continue; }
      if (m.failed) {
        if (b.btn.bitflags & PRESSED) { this.members.delete(b); b.powerUp(0, this.world.program); }
        continue;
      }
      if (m.exitAt >= 0) { if (t >= m.exitAt) this.exit(m); continue; }   // a LETSGO arrived
      if (b.btn.bitflags & PRESSED) { b.btn.bitflags = 0; this.exit(m); continue; }
      if (m.source < 0 && !m.notdone) { this.exit(m); continue; }
      this.step(m, t);
      for (let f = 0; f < 6; f++) b.display[f] = H.color5(0, m.g[f], m.b[f], 1);
    }
  }

  // The neighbor face f of m touches, if it's the seed state that downloads from m
  childAt(m, f) {
    const n = this.world.neighbor(m.blink, f);
    const c = n && this.members.get(n.blink);
    return c && c.source === n.face && c.exitAt < 0 && !c.failed ? c : null;
  }

  step(m, t) {
    const f = m.sendFace;
    if (m.action === 'push') return this.push(m, t);
    if (m.action === 'seed') {
      if (t < m.sentAt + SEED.LINK_MS) return;
      if (!m.answered) {
        m.answered = true;
        if (this.answer(m)) return;
      }
      if (t < m.sentAt + SEED.TRY_MS) return;
      // no answer
      if (m.tries === 0) {
        if (t >= m.startupUntil) m.notdone &= ~(1 << f);
        m.skip = true;
      }
    }
    if (m.skip) m.b[f] = 0;
    if (!m.notdone) { m.action = 'idle'; return; }
    if (m.skip || m.action === 'idle' && !(m.notdone & (1 << f))) {
      do m.sendFace = (m.sendFace + 1) % 6; while (!(m.notdone & (1 << m.sendFace)));
      m.tries = SEED.TRIES;
    }
    m.skip = false;
    // send a SEED
    m.b[m.sendFace] = FULL;
    m.action = 'seed';
    m.sentAt = t;
    m.answered = false;
    m.tries--;
  }

  // The SEED on m's send face has had time to reach a neighbor: does one answer?
  answer(m) {
    const f = m.sendFace;
    let c = this.childAt(m, f);
    if (!c) {
      const n = this.world.neighbor(m.blink, f);
      if (!n || this.members.has(n.blink)) return false;   // nobody there, or busy sharing with someone else
      c = this.join(n.blink, n.face, m);
      if (m.root) m.root.shared++;
    }
    this.reply(m, c);
    return true;
  }

  // The neighbor's PULL: the next block it needs, or that it (and everything past it) is done
  reply(m, c) {
    const f = m.sendFace;
    if (c.have < SEED.BLOCKS) {
      m.action = 'push';
      m.child = c;
      m.tries = SEED.TRIES;
      m.lastBlockAt = this.world.time;
      m.blockEnd = 0;
      m.b[f] = blue(c.have);
      return;
    }
    if (c.notdone) m.g[f] = HALF;
    else { m.g[f] = FULL; m.notdone &= ~(1 << f); }
    m.action = 'idle';
    m.skip = true;
  }

  // Sending blocks: one every BLOCK_MS, but only ones m has itself, so a line of Blinks downloads together
  push(m, t) {
    const f = m.sendFace, c = m.child;
    const linked = this.childAt(m, f) === c;
    if (m.blockEnd && t >= m.blockEnd) {
      m.blockEnd = 0;
      if (linked) {
        c.have++;
        m.lastBlockAt = t;
        m.b[f] = c.b[c.source] = blue(c.have);
        if (c.have === SEED.BLOCKS) {
          c.b[c.source] = 0;
          c.g[c.source] = HALF;
          m.child = null;
          return this.reply(m, c);
        }
      }
    }
    if (t - m.lastBlockAt > SEED.STALL_MS) {
      if (t >= m.startupUntil) m.notdone &= ~(1 << f);
      m.child = null;
      m.action = 'idle';
      m.skip = true;
      return;
    }
    if (!m.blockEnd && linked && m.have > c.have) m.blockEnd = t + SEED.BLOCK_MS;
  }

  // Done, stopped by a press, or told to go: send LETSGO to the neighbors downloading from it, and start
  exit(m) {
    const t = this.world.time;
    m.exitAt = t;
    for (let f = 0; f < 6; f++) {
      const c = this.childAt(m, f);
      if (c) c.exitAt = t + SEED.LINK_MS;
    }
    this.finish(m);
  }

  finish(m) {
    const b = m.blink;
    if (m.have < SEED.BLOCKS) {
      // the download didn't finish: half red until pressed, then the game it already had
      m.failed = true;
      b.btn.bitflags = 0;
      b.display.fill(H.color5(HALF, 0, 0, 1));
      return;
    }
    this.members.delete(b);
    b.powerUp(m.source < 0 ? 1 : 2, this.world.program);
    if (m.source < 0) this.world.events.onSeedDone?.(b, m.shared);
  }
}
