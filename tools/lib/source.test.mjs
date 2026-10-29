// node --test tools/lib/source.test.mjs
// The bot's commands.json is passed through when it's there and the right shape, and skipped otherwise; the play log
// is read from its weekly files, gzipped or not.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { loadCommands, loadPlays } from './source.mjs';

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

test('reads the play log from this week\'s file and the gzipped older ones, keeping the snipe fields', t => {
  const dir = folder(t);
  fs.mkdirSync(path.join(dir, 'Plays'));
  const line = { id: 1, u: 6205809, m: 3561625, c: 'c', t: 1793200000, pp: 115.4, mods: 'HDHR', sniped: [11491079], held: 0 };
  fs.writeFileSync(path.join(dir, 'Plays', '2026-W43.jsonl.gz'), zlib.gzipSync(`${JSON.stringify({ u: 1, m: 2, t: 3 })}\n`));
  fs.writeFileSync(path.join(dir, 'Plays', '2026-W44.jsonl'), `${JSON.stringify(line)}\n{"u":7,"m":`); // the last line cut short
  fs.appendFileSync(path.join(dir, 'Plays', '2026-W43.jsonl.gz'), zlib.gzipSync('{"gap":[1,2]}\n')); // a gap line, no play
  fs.writeFileSync(path.join(dir, 'Plays', 'notes.txt'), 'not a week');
  const { lines } = loadPlays(dir);
  assert.deepEqual(lines.sort((a, b) => a.u - b.u), [{ u: 1, m: 2, t: 3, c: undefined }, { u: 6205809, m: 3561625, t: 1793200000, c: 'c', pp: 115.4, sniped: [11491079], held: 0 }]);
});

test('the log speaks for snipes from a day after its coverage starts', t => {
  const dir = folder(t);
  fs.mkdirSync(path.join(dir, 'Plays'));
  fs.writeFileSync(path.join(dir, 'Plays', '2026-W44.jsonl'), '');
  assert.equal(loadPlays(dir).from, null); // no coverage recorded: never
  fs.mkdirSync(path.join(dir, 'Weekly'));
  fs.writeFileSync(path.join(dir, 'Weekly', 'state.json'), JSON.stringify({ coveredFrom: '2026-10-24T09:17:28.9161759Z' }));
  assert.equal(loadPlays(dir).from, Date.UTC(2026, 9, 25, 9, 17, 28) / 1000);
});

test('no play log gives none', t => {
  assert.deepEqual(loadPlays(folder(t)), { from: null, lines: [] });
});
