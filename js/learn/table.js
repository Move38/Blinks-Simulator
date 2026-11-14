/*
 * A live table of Blinks on a canvas: a World, the playground's Board drawing it, and a frame loop.
 * The learn page keeps one for the learner's code and one for the Goal Blink, and swaps the World
 * under each Board when a level changes.
 */

import { World } from '../runtime/world.js';
import { Board } from '../ui/board.js';

export function makeTable(canvas, { events = {}, fixed = false, bin = null, margins, onLayout } = {}) {
  let world = new World(events);
  const board = new Board(canvas, world, { fixed, bin, margins, onLayout: refit => { onLayout?.(); if (refit) board.fit(); } });
  board.debug = 'tooltip';
  let last = performance.now(), paused = false;
  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    if (world.program && !paused) world.advance(dt);
    board.draw(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    get world() { return world; },
    board,
    // a fresh table with Blinks on these cells, running nothing yet
    reset(cells) {
      world = new World(events);
      for (const [q, r, rot] of cells) world.addBlink(q, r, rot || 0);
      board.world = world;
      board.lastTouched = null;
      board.fit(false);
    },
    // run a compiled sketch on every Blink, from power-up
    load(compiled) { world.load(compiled); },
    restart() { if (world.program) world.restart(); },
    unload() { world.program = null; for (const b of world.blinks) b.display.fill(0); },
    set paused(p) { paused = p; },
    cells: () => world.blinks.map(b => [b.q, b.r, b.rot]),
  };
}
