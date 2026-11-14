/*
 * The worlds of the learning path, in order. Each has six levels on its ring and a boss.
 */

import light from './1-light.js';
import input from './2-input.js';
import memory from './3-memory.js';
import time from './4-time.js';
import patterns from './5-patterns.js';
import neighbors from './6-neighbors.js';

// a world counts once it has its boss; until then the map shows it locked
export const WORLDS = [light, input, memory, time, patterns, neighbors].filter(w => w.boss);

// The skills levels are tagged with, as the map names them, in the order they're met
export const SKILLS = {
  light: 'Light & color', faces: 'Faces', order: 'Order of lines',
  conditions: 'Conditions', events: 'Clicks & presses',
  variables: 'Variables', timers: 'Timers', loops: 'Loops', functions: 'Functions',
  neighbors: 'Neighbors',
};

// Every level, bridges included, by id
export const LEVELS = new Map();
for (const w of WORLDS) {
  for (const l of [...w.levels, w.boss]) {
    l.world = w;
    LEVELS.set(l.id, l);
    if (l.bridge) { l.bridge.world = w; l.bridge.parent = l; LEVELS.set(l.bridge.id, l.bridge); }
  }
}
