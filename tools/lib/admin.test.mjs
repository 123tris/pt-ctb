// node --test tools/lib/admin.test.mjs
// admin.json from the bot's Admin/panel.json (contract §8): rebuilt field by field, since it's public.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { adminFile } from './admin.mjs';

const SAMPLE = JSON.parse(fs.readFileSync(new URL('../admin-sample.json', import.meta.url), 'utf8'));

test('no panel, no admin.json', () => {
  assert.equal(adminFile(null), null);
  assert.equal(adminFile({ admins: [] }), null);
});

test('the sample panel (tools/admin-sample.json) comes through whole', () => {
  const file = adminFile(SAMPLE);
  assert.equal(file.settings.length, 106);
  assert.deepEqual(file.settings, SAMPLE.settings);
  assert.deepEqual(file.actions, SAMPLE.actions);
  assert.deepEqual(file.admins, SAMPLE.admins);
});

test('anything unexpected is dropped: extra fields, Discord ids, settings that don’t fit their type', () => {
  const file = adminFile({
    generatedAt: 5, secret: 'x',
    admins: [{ osuId: 1, name: 'A', discordId: '123456789012345678' }, { osuId: 'nope', name: 'B' }],
    settings: [
      { key: 'Hill.BoardSize', group: 'King of the hill', type: 'int', min: 10, max: 200, step: 1, value: 50, default: 50, overridden: false, effect: 'now', description: 'x', channelId: '1' },
      { key: 'Hill.BoardSize', group: 'King of the hill', type: 'int', value: 5.5, default: 50 },
      { key: 'Discord.Token', group: 'x', type: 'secret', value: 'abc', default: 'abc' },
      { key: 'nodot', group: 'x', type: 'int', value: 1, default: 1 },
    ],
    actions: [
      { at: '2026-11-01T12:00:00Z', requestId: '0123456789abcdef01234567', osuId: 1, name: 'A', via: 'site', kind: 'admin.set', args: { key: 'Hill.BoardSize', value: 60, discordId: '1234' }, status: 'accepted', reason: 'ok', code: 'ignored', userId: '1234' },
      { at: 'yesterday', kind: 'admin.set', status: 'accepted' },
      { at: '2026-11-01T12:00:00Z', kind: 'drop table', status: 'accepted' },
    ],
  });
  assert.deepEqual(file.admins, [{ osuId: 1, name: 'A' }]);
  assert.deepEqual(file.settings.map(s => Object.keys(s)), [['key', 'group', 'type', 'min', 'max', 'step', 'length', 'value', 'default', 'overridden', 'effect', 'description']]);
  assert.deepEqual(file.actions, [{
    at: '2026-11-01T12:00:00Z', requestId: '0123456789abcdef01234567', osuId: 1, name: 'A', via: 'site', kind: 'admin.set',
    args: { key: 'Hill.BoardSize', value: 60 }, status: 'accepted', reason: 'ok',
  }]);
  assert.ok(!/123456789012345678|discordId|userId|channelId/.test(JSON.stringify(file)), 'no ids beyond osu! ones');
});

test('at most 100 actions', () => {
  const one = SAMPLE.actions[0];
  assert.equal(adminFile({ settings: [], actions: Array(150).fill(one) }).actions.length, 100);
});
