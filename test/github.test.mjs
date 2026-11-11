import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHub, sketchesIn, loadSketch } from '../js/github.js';
import { compile } from '../js/compiler/index.js';

test('GitHub links: repos, folders, files and raw links', () => {
  assert.deepEqual(parseGitHub('owner/repo'), { owner: 'owner', repo: 'repo', ref: null, path: '' });
  assert.deepEqual(parseGitHub('https://github.com/owner/repo.git'), { owner: 'owner', repo: 'repo', ref: null, path: '' });
  assert.deepEqual(parseGitHub('https://github.com/owner/repo/tree/main/games/Spill'), { owner: 'owner', repo: 'repo', ref: 'main', path: 'games/Spill', file: false });
  assert.deepEqual(parseGitHub('github.com/owner/repo/blob/dev/Game/Game.ino'), { owner: 'owner', repo: 'repo', ref: 'dev', path: 'Game/Game.ino', file: true });
  assert.deepEqual(parseGitHub('https://raw.githubusercontent.com/owner/repo/main/A/A.ino'), { owner: 'owner', repo: 'repo', ref: 'main', path: 'A/A.ino', file: true });
  assert.equal(parseGitHub('https://github.com/owner/repo/issues/3'), null);
  assert.equal(parseGitHub('https://example.com/owner/repo'), null);
});

test('a sketch folder lists only its main .ino', () => {
  const paths = ['Game/Game.ino', 'Game/Tab.ino', 'Game/util.h', 'Loose/a.ino', 'Loose/b.ino', 'repo.ino', 'other.ino', 'README.md'];
  assert.deepEqual(sketchesIn(paths, '', 'repo'), ['Game/Game.ino', 'Loose/a.ino', 'Loose/b.ino', 'repo.ino']);
  assert.deepEqual(sketchesIn(paths, 'Game', 'repo'), ['Game/Game.ino']);
});

test('a sketch folder is combined like Arduino builds it: main, other tabs, local headers inlined once', async () => {
  const files = {
    'Game/Game.ino': '#include "util.h"\n#include "util.h"\nvoid setup() { setColor(pick()); }\nvoid loop() { tick(); }\n',
    'Game/Tick.ino': '#include "util.h"\nvoid tick() { if (buttonPressed()) setColor(BLUE); }\n',
    'Game/util.h': '#pragma once\n#include "more.h"\nColor pick() { return COLORS_GREEN; }\n',
    'Game/more.h': '#define COLORS_GREEN GREEN\n',
    'Other/Other.ino': 'void setup() {}\nvoid loop() {}\n',
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const path = decodeURIComponent(String(url).split('/main/')[1] || '');
    return path in files ? new Response(files[path]) : new Response('', { status: 404 });
  };
  try {
    const s = await loadSketch({ owner: 'o', repo: 'r', ref: 'main' }, 'Game/Game.ino', Object.keys(files));
    assert.equal(s.name, 'Game');
    assert.deepEqual(s.combined, ['Tick.ino', 'util.h', 'more.h']);
    assert.equal(s.code.match(/Color pick\(\)/g).length, 1);
    assert.ok(s.code.indexOf('void setup()') < s.code.indexOf('void tick()'));
    const c = compile(s.code);
    assert.ok(c.ok, c.errors && c.errors.map(e => e.message).join('; '));
  } finally {
    globalThis.fetch = realFetch;
  }
});
