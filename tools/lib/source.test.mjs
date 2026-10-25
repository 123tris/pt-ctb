// node --test tools/lib/source.test.mjs
// The bot's commands.json is passed through when it's there and the right shape, and skipped otherwise.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCommands } from './source.mjs';

const folder = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptctb-source-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('reads the commands list the bot wrote', t => {
  const dir = folder(t);
  const commands = {
    generatedAt: '2026-10-25T12:00:00Z',
    groups: [{ name: 'Scores', commands: [{ slash: 'recent', prefix: ['!r'], description: 'Your last play', options: [{ name: 'user', description: 'Whose' }], access: 'everyone' }] }],
  };
  fs.writeFileSync(path.join(dir, 'commands.json'), `﻿${JSON.stringify(commands)}`); // .NET may write a BOM
  assert.deepEqual(loadCommands(dir), commands);
});

test('no file, a broken file or another shape gives null', t => {
  const dir = folder(t);
  assert.equal(loadCommands(dir), null);
  fs.writeFileSync(path.join(dir, 'commands.json'), '{ not json');
  assert.equal(loadCommands(dir), null);
  fs.writeFileSync(path.join(dir, 'commands.json'), JSON.stringify({ groups: 'nope' }));
  assert.equal(loadCommands(dir), null);
});
