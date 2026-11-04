// node --test web/test/admin.test.mjs
// The admin panel drawn in Node in both languages: who gets it (signed out, a member, an admin, the endpoint failing),
// every setting of tools/admin-sample.json as its row and field, the star bands as one row each, what's waiting for the
// bot, the pool and bounty cards, the log, and the checks behind Review (a setting's value, each action's form). The
// pure checks run on their own; the page itself needs an export's core pack (PTCATCH_DATA=<folder>, skipped without).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { firstData } from '../src/routes.ts';
import { manifestsFor } from '../edge/inline.ts';
import { actionText, describe, isAdmin, problemText, refusalText, starEdge, valueText } from '../src/ui/admin.ts';
import { actionOf, checkValue, render, viewOf } from '../src/views/admin.ts';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const sample = () => JSON.parse(fs.readFileSync(path.join(repo, 'tools', 'admin-sample.json'), 'utf8'));

const NOW = 1_793_500_000;
const ADMIN = 3821475;
const ctxFor = (lang = 'en', me = ADMIN) => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => NOW, timeZone: 'UTC' }), now: () => NOW, data: 'https://data.example/', me };
};
/** Two players, as the core pack's columns have them, for what doesn't need a whole pack. */
const few = { rows: 2, id: [111, 222], name: { at: row => ['Alice', 'bob'][row] } };

let core = null;
const coreOf = () => {
  if (core) return core;
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  return (core = readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
};
const mine = (requests = [], status = 200) => ({ ok: status === 200, status, requests });
/** The page's data as entries/admin.ts loads it; `loaded` overrides. */
const dataFor = (loaded = {}) => ({
  signInHere: false,
  loaded: { mine: mine(), panel: sample(), core: coreOf(), hill: { current: { month: '2026-11', status: 'live', end: NOW + 9e5, pool: [], leaders: null } }, board: null, ...loaded },
});
const draw = (data, { lang = 'en', me = ADMIN } = {}) => String(render(ctxFor(lang, me), data));
const count = (page, pattern) => (page.match(pattern) ?? []).length;
const between = (page, from, to) => {
  const at = page.indexOf(from);
  return at < 0 ? '' : page.slice(at, to ? page.indexOf(to, at + from.length) : undefined);
};

test('the new client draws /admin, with the players, admin.json, hill.json and bounties.json first', () => {
  assert.deepEqual(firstData('/admin'), { packs: ['packs/core.ptcb'], json: ['admin.json', 'hill.json', 'bounties.json'] });
  assert.deepEqual(firstData('/admin/'), firstData('/admin'));
  assert.equal(firstData('/admin/settings'), null);
  assert.deepEqual(manifestsFor('/admin'), { packs: true, meta: true });
});

test('who gets the panel: admins only, by the endpoint, or admin.json’s list when it can’t be asked', () => {
  const panel = sample();
  assert.ok(isAdmin(ADMIN, panel));
  assert.ok(!isAdmin(12345, panel));
  assert.ok(!isAdmin(null, panel));
  assert.ok(isAdmin(6205809, null), 'the bot’s default admins without admin.json');
  assert.ok(isAdmin(12345, { ...panel, admins: [{ osuId: 12345, name: 'X' }] }));
  const loaded = (status, p = panel) => ({ signInHere: false, loaded: { mine: mine([], status), panel: p } });
  const ctx = ctxFor();
  assert.equal(viewOf(ctxFor('en', null), { signInHere: true, loaded: null }), 'signed-out');
  assert.equal(viewOf(ctx, loaded(200)), 'panel');
  assert.equal(viewOf(ctx, loaded(403)), 'admins-only', 'the endpoint says who’s an admin');
  assert.equal(viewOf(ctx, loaded(503)), 'no-bananas');
  assert.equal(viewOf(ctx, loaded(500)), 'unreadable');
  assert.equal(viewOf(ctx, loaded(0, null)), 'unreadable', 'offline, and an admin by the default list');
  assert.equal(viewOf(ctxFor('en', 12345), loaded(500)), 'admins-only');

  for (const lang of ['en', 'pt']) {
    const c = ctxFor(lang, null);
    const out = String(render(c, { signInHere: true, loaded: null }));
    assert.match(out, new RegExp(`<h1>${c.t('Admin')}</h1>`));
    assert.match(out, new RegExp(`<div class="empty"><p>${c.t('Admins only.')}</p><button class="btn btn-small" type="button" data-signin>${c.t('Sign in with osu!')}</button></div>`));
    assert.match(String(render(c, { signInHere: false, loaded: null })), new RegExp(c.t('Signing in works on ptcatch.com.').replace('.', '\\.')));
    const member = String(render(ctxFor(lang, 12345), loaded(403)));
    assert.match(member, new RegExp(`<div class="empty"><p>${c.t('Admins only.')}</p></div>`));
    assert.ok(!member.includes('admin-group') && !member.includes('admin-log'), 'no data for anyone else');
    assert.ok(String(render(ctxFor(lang), loaded(503))).includes(c.t('Admin requests need Bananas set up on this copy of the site.')));
  }
});

test('a setting’s value is checked against its type, range, step and length before Review', () => {
  const ctx = ctxFor();
  const s = Object.fromEntries(sample().settings.map(x => [x.key, x]));
  const check = (key, typed) => checkValue(ctx, s[key], typed);
  assert.deepEqual(check('Hill.PinPool', false), { value: false });
  assert.deepEqual(check('Hill.NoRepeatMonths', '7'), { value: 7 });
  assert.deepEqual(check('Hill.NoRepeatMonths', '1e1'), { value: 10 });
  assert.deepEqual(check('Hill.NoRepeatMonths', ''), { error: 'Enter a number.' });
  assert.deepEqual(check('Hill.NoRepeatMonths', 'abc'), { error: 'Enter a number.' });
  assert.deepEqual(check('Hill.NoRepeatMonths', '2.5'), { error: 'Whole numbers only.' });
  assert.deepEqual(check('Hill.NoRepeatMonths', '25'), { error: 'It goes from 0 to 24.' });
  assert.deepEqual(check('Bananas.WeeklySoftCap', '-1'), { error: 'It goes from 0 to 10,000.' });
  assert.deepEqual(check('Hill.ComboWeight', '0.35'), { value: 0.35 });
  assert.deepEqual(check('Hill.ComboWeight', '0.33'), { error: 'Use steps of 0.05.' });
  assert.deepEqual(check('Hill.HiddenMultiplier', '1.07'), { value: 1.07 }, 'steps from the minimum, with room for rounding');
  assert.deepEqual(check('Bananas.DailyGame', ['6', '4', '2']), { value: [6, 4, 2] });
  assert.deepEqual(check('Bananas.DailyGame', ['6', '', '2']), { error: 'Whole numbers only.' });
  assert.deepEqual(check('Bananas.DailyGame', ['6', '400', '2']), { error: 'Each value goes from 0 to 100.' });
  assert.deepEqual(check('Bananas.BountyDays', ['15', '45']), { value: [15, 45] });
  assert.deepEqual(check('Bananas.BountyDays', []), { error: 'Give 1 to 10 values.' });
  assert.deepEqual(check('Bananas.BountyDays', Array(11).fill('5')), { error: 'Give 1 to 10 values.' });
  assert.deepEqual(check('Bananas.BountyDays', ['0']), { error: 'Each value goes from 1 to 365.' });
  const pt = ctxFor('pt');
  assert.equal(checkValue(pt, s['Hill.NoRepeatMonths'], '25').error, pt.t('It goes {range}.', { range: pt.t('from {min} to {max}', { min: '0', max: '24' }) }));
});

test('each action’s form: what it asks the bot for, or which field to fix', () => {
  const ctx = ctxFor();
  const act = (kind, fields, which = '') => actionOf(ctx, few, kind, which, fields);
  assert.deepEqual(act('approve', {}), { type: 'admin.hill.approve', payload: {} });
  assert.deepEqual(act('reroll', { slot: 'CV', tier: 'challenger' }), { type: 'admin.hill.reroll', payload: { slot: 'CV', tier: 'challenger' } });
  assert.match(act('redraft', {}).note, /throws the current draft away/);
  assert.deepEqual(act('cancel', { id: '', refund: true }), { error: 'Enter the bounty’s number.', focus: '.cancel-id' });
  assert.deepEqual(act('cancel', { id: '0', refund: true }).focus, '.cancel-id');
  assert.deepEqual(act('cancel', { id: '12', refund: true }), { type: 'admin.bounty.cancel', payload: { id: 12, refund: true }, note: '' });
  assert.equal(act('cancel', { id: '12', refund: false }).note, 'Without refunds, the bananas in it stay burned.');
  assert.deepEqual(act('adjust', { who: 'carol', amount: '5' }), { error: 'Pick a player from the list.', focus: '#adjust-who' });
  assert.equal(act('adjust', { who: ' BOB ', amount: '0' }).focus, '#adjust-amount');
  assert.equal(act('adjust', { who: 'bob', amount: '2.5' }).focus, '#adjust-amount');
  assert.deepEqual(act('adjust', { who: ' BOB ', amount: '-25', note: '' }), { type: 'admin.bananas.adjust', payload: { osuId: 222, amount: -25 }, note: '' });
  assert.deepEqual(act('adjust', { who: 'alice', amount: '40', note: ' sorry ' }), { type: 'admin.bananas.adjust', payload: { osuId: 111, amount: 40, note: 'sorry' }, note: 'Note: sorry' });
  assert.deepEqual(act('map', { map: 'nope' }), { error: 'Paste a beatmap id or an osu! beatmap link.', focus: '#map-id' });
  assert.deepEqual(act('map', { map: 'https://osu.ppy.sh/beatmapsets/1#fruits/456' }, 'ban'), { type: 'admin.map.ban', payload: { beatmapId: 456 }, note: '' });
  assert.match(act('map', { map: '456' }, 'unban').note, /recalculates pp/);
});

test('the log’s words: each action in a line, refusals as their code in words', () => {
  for (const lang of ['en', 'pt']) {
    const ctx = ctxFor(lang);
    const { t } = ctx;
    assert.equal(String(actionText(ctx, 'admin.set', { key: 'Hill.PinPool', value: false }, few)), t('Set {key} to {value}', { key: '<code>Hill.PinPool</code>', value: `<b>${t('off')}</b>` }));
    assert.equal(String(actionText(ctx, 'admin.hill.reroll', { slot: 'CV', tier: 'open' }, few)), t('Reroll the {slot} slot ({tier})', { slot: t('Convert'), tier: t('Open|tier') }));
    assert.match(String(actionText(ctx, 'admin.bananas.adjust', { osuId: 222, amount: -40 }, few)), /<a href="\/player\/222">bob<\/a>.*<b>−40 🍌<\/b>/);
    assert.match(String(actionText(ctx, 'admin.bananas.adjust', { osuId: 9, amount: 5 }, few)), /<a href="\/player\/9">#9<\/a>.*<b>\+5 🍌<\/b>/);
    assert.match(String(actionText(ctx, 'admin.map.unban', { beatmapId: 5 }, few)), /<a href="\/map\/5">/);
    assert.equal(actionText(ctx, 'admin.weird', {}, few), 'admin.weird');
    assert.equal(refusalText(ctx, 'not_overridden', 'x'), t('It was already at its default.'));
    assert.equal(refusalText(ctx, 'conflict', 'Clash.'), `${t('That clashes with another setting.')} Clash.`);
    assert.equal(refusalText(ctx, 'weird', 'The bot’s words.'), 'The bot’s words.');
    assert.equal(refusalText(ctx, 'weird', ''), t('refused'));
    assert.equal(valueText(ctx, [5, 3, 1]), '5, 3, 1');
    assert.equal(problemText(ctx, 429, null), t('Too many admin requests are waiting for the bot. It takes them every 15 minutes; try again after.'));
    assert.equal(problemText(ctx, 400, { error: 'That needs a beatmap id.' }), t('That needs a beatmap id.'));
  }
  assert.deepEqual(starEdge('Hill.HR.OpenMinStars'), { slot: 'HR', tier: 'open', edge: 'Min' });
  assert.equal(starEdge('Hill.HR.OpenStars'), null);
});

test('every setting has its words in both languages; an unknown key shows the bot’s English', () => {
  const settings = sample().settings;
  const pt = ctxFor('pt');
  for (const s of settings) assert.notEqual(describe(pt, s), s.description, s.key);
  assert.equal(describe(ctxFor(), settings.find(s => s.key === 'Bananas.ShopEarnedGate.wildcard')), 'King of the hill wildcard: bananas earned before buying it (0: no gate).');
  assert.equal(describe(ctxFor(), settings.find(s => s.key === 'Hill.CV.ChallengerMaxStars')), 'Convert, Challenger: maximum stars (not included).');
  assert.equal(describe(ctxFor(), { key: 'Bot.New', description: 'Something new.' }), 'Something new.');
});

test('the settings: one card per group, one row per setting or star band, each with its field', { skip }, () => {
  for (const lang of ['en', 'pt']) {
    const ctx = ctxFor(lang);
    const { t } = ctx;
    const panel = sample();
    const out = draw(dataFor(), { lang });
    const groups = [...out.matchAll(/<details class="admin-group" data-group="([^"]+)">/g)].map(m => m[1]);
    assert.deepEqual(groups, [...new Set(panel.settings.map(s => s.group))]);
    const bands = panel.settings.filter(s => starEdge(s.key));
    const rows = [...out.matchAll(/<div class="admin-setting[^"]*" data-key="([^"]+)"/g)].map(m => m[1]);
    assert.equal(rows.length, panel.settings.length - bands.length / 2);
    assert.deepEqual(rows, panel.settings.filter(s => starEdge(s.key)?.edge !== 'Max').map(s => s.key), 'each in admin.json’s order');
    assert.equal(count(out, /class="range admin-stars"/g), bands.length / 2);
    // Every changed setting says so, with Reset; a band once for both edges.
    const changed = panel.settings.filter(s => s.overridden);
    assert.equal(count(out, /data-reset aria-label/g), changed.length);
    assert.match(out, new RegExp(`aria-label="${t('Reset {key} to its default', { key: `HR · ${t('Open|tier')}` })}"`));
    // Fields by type: a checkbox, a box per value of a fixed list, a text box for an open one, numbers with their range.
    assert.match(out, /<input type="checkbox" id="set-Hill-ConvertFallbackToRanked" > <span>/);
    assert.match(out, /<input type="checkbox" id="set-Hill-PinPool" checked>/);
    assert.equal(count(between(out, 'data-key="Bananas.DailyGame"', 'admin-error'), /data-i="/g), 3);
    assert.match(out, /<input class="input admin-text" type="text" id="set-Bananas-BountyDays" inputmode="numeric" value="30, 60, 90"/);
    assert.match(out, /id="set-Hill-ComboWeight" inputmode="decimal"\s+min="0" max="1" step="0.05" value="0.3">/);
    assert.match(between(out, 'data-key="Hill.HR.OpenMinStars"', 'admin-error'), new RegExp(`${t('stars with {mod} on', { mod: 'HR' })}.*${t('default {value}', { value: '6★ – 9★' })}`));
    assert.match(out, new RegExp(t('as the bot last published them, {ago}', { ago: '' })));
  }
});

test('what’s waiting for the bot: on its setting, its band, its card’s summary, and first in the log', { skip }, () => {
  const ids = json('players.json').map(p => p.id);
  const at = new Date((NOW - 600) * 1000).toISOString();
  const req = (requestId, type, payload, state = 'pending', extra = {}) => ({ requestId, type, payload, t: at, status: state, reason: null, code: null, ...extra });
  const requests = [
    req('p1', 'admin.set', { key: 'Hill.NoRepeatMonths', value: 4 }),
    req('p2', 'admin.reset', { key: 'Bananas.ShopTitle' }),
    req('p3', 'admin.set', { key: 'Hill.NM.OpenMaxStars', value: 9.5 }),
    req('p4', 'admin.reset', { key: 'Hill.HR.OpenMinStars' }),
    req('p5', 'admin.hill.reroll', { slot: 'HD', tier: 'open' }),
    req('p6', 'admin.bounty.cancel', { id: 11, refund: true }),
    req('p7', 'admin.bounty.cancel', { id: 99, refund: false }),
    req('a1b2c3d4e5f6a7b8c9d0e1f2', 'admin.set', { key: 'Bananas.ShopTitle', value: 400 }, 'accepted'),
    req('q1', 'admin.set', { key: 'Hill.PinPool', value: false }, 'rejected', { code: 'conflict', reason: 'Clash.' }),
  ];
  const board = { open: [
    [1207082, 'r', 'snipe', NOW, 45, 0, ids[0], [], 11, 900, [], ids[5], NOW + 9e5, 'HD', 500],
    [553131, 'c', 'pass', NOW, 31, 0, null, [], 13, 600, [], null, null, null, 500],
    [884085, 'u', 'fc', null, 3, 2, null, [], null, null, [], null, null, null, null],
  ], maps: {} };
  const out = draw(dataFor({ mine: mine(requests), board }));
  assert.match(between(out, 'data-key="Hill.NoRepeatMonths"', 'admin-error'), /<span class="req-status">Waiting for the bot: 4<\/span>/);
  assert.match(between(out, 'data-key="Bananas.ShopTitle"', 'admin-error'), /Waiting for the bot: back to the default/);
  // A band says how it will be once the bot has both edges: NM open's top moving, HR open's bottom back to 6★.
  assert.match(between(out, 'data-key="Hill.NM.OpenMinStars"', 'admin-error'), /Waiting for the bot: 6★ – 9\.5★/);
  assert.match(between(out, 'data-key="Hill.HR.OpenMinStars"', 'admin-error'), /Waiting for the bot: 6★ – 9★/);
  assert.match(between(out, 'data-group="King of the hill: stars"', '</summary>'), /24 settings · 1 changed from the default · 2 waiting for the bot/);
  // The pool card lists its waiting request; a listed bounty's cancel shows in its row, an unlisted one at the top.
  assert.match(between(out, 'id="admin-pool"', '</section>'), /Reroll the HD slot \(Open\)<\/span> <span class="req-status">waiting for the bot/);
  const bounties = between(out, 'id="admin-bounties"', '</section>');
  assert.match(bounties, /Open bounties <span class="faint">2<\/span>/, 'only the ones with a number');
  assert.match(bounties, /<li class="admin-bounty"><span class="admin-bounty-what">.*#11/s);
  assert.match(bounties, /data-action="cancel" data-id="13"/);
  assert.match(bounties, /600 🍌 pot · house bounty/);
  assert.match(between(bounties, 'admin-waiting', '</ul>'), /Cancel bounty #99 without refunds/);
  assert.ok(!between(bounties, 'admin-waiting', '</ul>').includes('#11'));
  // The log: yours first (the bot's log has the accepted one already), then the bot's, refusals in words.
  const log = between(out, 'id="admin-log"');
  const lines = [...log.matchAll(/<li( class="admin-pending")?>/g)];
  assert.equal(lines.filter(m => m[1]).length, 7);
  assert.match(log, /refused: That clashes with another setting\. Clash\./);
  assert.match(log, /DemiGod Yoxide · via Discord/);
  assert.equal(count(log, /<li/g), 15);
  assert.match(log, new RegExp(`data-log-all>Show all ${7 + 1 + sample().actions.length}</button>`));
});

test('the pool card: a draft first and open, with Approve primary; a live pool’s tools folded', { skip }, () => {
  const current = status => ({ current: { month: '2026-11', status, end: NOW, pool: [], leaders: null } });
  const draft = draw(dataFor({ hill: current('draft') }));
  assert.match(draft, /<section class="section card admin-card admin-attention" id="admin-pool"/);
  assert.ok(draft.indexOf('id="admin-pool"') < draft.indexOf('id="admin-bounties"'));
  assert.match(draft, /King of the hill pool: waiting for approval/);
  assert.match(draft, /November 2026’s pool is drafted but not live/);
  assert.match(draft, /<button class="btn btn-small btn-primary" type="button" data-review="">Approve the pool…<\/button>/);
  assert.equal(count(draft, /btn-primary/g), 1, 'the page’s one primary action');
  const live = draw(dataFor());
  assert.match(live, /<p class="muted small">November 2026’s pool is live\.<\/p>\s*<details class="admin-fold"><summary>Pool tools/);
  assert.equal(count(live, /btn-primary/g), 0);
  assert.match(draw(dataFor({ hill: null })), /<h2 class="card-h" id="admin-pool-h">King of the hill pool<\/h2>\s*<div data-waiting="admin.hill."><\/div>\s*<details class="admin-fold">/);
  const pt = ctxFor('pt');
  const inPt = draw(dataFor({ hill: current('draft') }), { lang: 'pt' });
  assert.ok(inPt.includes(`<option value="CV">${pt.t('Convert')}</option>`));
  assert.ok(inPt.includes(`<option value="challenger">${pt.t('Challenger')}</option>`));
  assert.notEqual(pt.t('Challenger'), 'Challenger');
});

test('the players and maps card: every player to pick; without admin.json only the actions', { skip }, () => {
  const players = coreOf().players;
  const out = draw(dataFor());
  assert.equal(count(between(out, '<datalist id="adjust-who-names">', '</datalist>'), /<option value=/g), players.rows);
  const none = draw(dataFor({ panel: null }));
  assert.match(none, /<p class="notice">The bot hasn’t published its settings yet, so only the actions are here\.<\/p>/);
  assert.ok(!none.includes('admin-group'));
  assert.match(none, /<div class="empty">Nothing yet\.<\/div>/);
  assert.match(none, /data-action="adjust"/);
});
