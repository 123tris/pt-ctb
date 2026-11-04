// node --test web/test/challenges.test.mjs
// The Challenges page, every tab, drawn in Node from an export (its core pack and JSON; skipped without, as the other
// view tests are) and checked against the JSON: the tab strip and its figures, the map of the week's boards, the snipe
// targets, the Dan course for each stage, King of the hill's pool and crown table for each season, the bounty board
// signed in and out, and Completion's list for each sort, star range and page. The export has no claimed bounties or
// closed hill months, so those are added to its files here.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { DAN_STAGES } from '../src/kernel/model.ts';
import { firstData } from '../src/routes.ts';
import { inStars, parseStars } from '../src/ui/star-range.ts';
import { render, readState, title } from '../src/views/challenges.ts';
import { readState as completionState } from '../src/views/completion.ts';
import { readState as hillState, tableRows } from '../src/views/hill.ts';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const has = name => fs.existsSync(path.join(dir, name));

let core = null;
const coreOf = () => {
  if (core) return core;
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  return (core = readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
};
const ctxFor = (lang = 'en', { me = null } = {}) => {
  const now = coreOf().info.generatedAt[0];
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me };
};

/** The page's data for a tab, as entries/challenges.ts loads it; `edit` changes the files first. */
function dataFor(tab, edit = {}) {
  const site = edit.site ?? json('meta.json');
  return {
    core: coreOf(), challenges: json('challenges.json'), board: edit.board !== undefined ? edit.board : has('bounties.json') ? json('bounties.json') : null, site,
    dan: tab === 'dan' ? json('dan.json') : null,
    completion: tab === 'completion' && has('completion.json') ? ('completion' in edit ? edit.completion : json('completion.json')) : null,
    hill: tab === 'hill' && site.files?.['hill.json'] ? ('hill' in edit ? edit.hill : json('hill.json')) : null,
    economy: tab === 'bounties' && has('economy.json') ? ('economy' in edit ? edit.economy : json('economy.json')) : null,
    signInHere: Boolean(edit.signInHere),
  };
}
const draw = (tab, query = {}, { lang = 'en', me = null, ...edit } = {}) => {
  const data = dataFor(tab, edit);
  const ctx = ctxFor(lang, { me });
  const state = readState(data, tab ? { tab } : {}, query);
  return { page: String(render(ctx, data, state)), state, ctx, data };
};
const count = (page, pattern) => (page.match(pattern) ?? []).length;
const between = (page, from, to) => {
  const at = page.indexOf(from);
  return at < 0 ? '' : page.slice(at, to ? page.indexOf(to, at + from.length) : undefined);
};
const playersIn = part => [...part.matchAll(/<a class="player" href="\/player\/(\d+)">/g)].map(m => Number(m[1]));
const mapsIn = part => [...part.matchAll(/<a class="map" href="\/map\/(\d+)">/g)].map(m => Number(m[1]));

test('every tab is drawn by the new client, with challenges.json, bounties.json and the tab’s own file first', () => {
  const base = ['challenges.json', 'bounties.json'];
  assert.deepEqual(firstData('/challenges'), { packs: ['packs/core.ptcb'], json: base });
  assert.deepEqual(firstData('/challenges/week'), { packs: ['packs/core.ptcb'], json: base });
  assert.deepEqual(firstData('/challenges/targets/'), { packs: ['packs/core.ptcb'], json: base });
  assert.deepEqual(firstData('/challenges/dan', '?stage=3'), { packs: ['packs/core.ptcb'], json: [...base, 'dan.json'] });
  assert.deepEqual(firstData('/challenges/hill'), { packs: ['packs/core.ptcb'], json: [...base, 'hill.json'] });
  assert.deepEqual(firstData('/challenges/bounties'), { packs: ['packs/core.ptcb'], json: [...base, 'economy.json'] });
  assert.deepEqual(firstData('/challenges/completion', '?sort=hard'), { packs: ['packs/core.ptcb'], json: [...base, 'completion.json'] });
  assert.deepEqual(firstData('/challenges/constructor'), { packs: ['packs/core.ptcb'], json: base }, 'an unknown tab shows the week');
  assert.deepEqual(firstData('/dan'), { packs: ['packs/core.ptcb'], json: [...base, 'dan.json'] }, 'the Dan tab’s old address');
  assert.equal(firstData('/challenges/dan/3'), null);
});

test('the tab strip: each tab and its figure, King of the hill only with hill.json, and the title', { skip }, () => {
  const meta = json('meta.json');
  const challenges = json('challenges.json');
  for (const lang of ['en', 'pt']) {
    const { page, ctx, state } = draw('week', {}, { lang });
    const strip = between(page, '<nav class="tabs"', '</nav>');
    const tabs = [...strip.matchAll(/<a href="\/challenges\/(\w+)"/g)].map(m => m[1]);
    assert.deepEqual(tabs, ['week', ...(meta.files['hill.json'] ? ['hill'] : []), 'dan', 'targets', 'bounties', 'completion']);
    assert.match(strip, /<a href="\/challenges\/week" class="active" aria-current="page">/);
    const figure = slug => strip.match(new RegExp(`href="/challenges/${slug}"[^>]*>[^<]*(?:<span class="count"><span class="sr-only">, </span>([^<]*)</span>)?</a>`))?.[1];
    assert.equal(figure('targets'), ctx.fmt.num(challenges.beatable.length));
    if (has('bounties.json')) assert.equal(figure('bounties'), ctx.fmt.num(json('bounties.json').open.length));
    if (meta.completion?.total) assert.equal(figure('completion'), `${ctx.fmt.num(meta.completion.cleared / meta.completion.total * 100, 1)}%`);
    // Portugal's highest Dan, as players.json's passes have it.
    const top = Math.max(...json('players.json').flatMap(p => p.dan ?? []));
    assert.equal(figure('dan'), top < 0 ? undefined : top === 0 ? ctx.t('Zeroth Dan') : top <= 10 ? ctx.t('{nth} Dan', { nth: ctx.fmt.ordinal(top) }) : DAN_STAGES[top].key);
    if (challenges.week) {
      const left = Math.max(0, challenges.week.end - ctx.now());
      assert.equal(figure('week'), left >= 86400 ? ctx.t('{n}d left', { n: Math.floor(left / 86400) }) : ctx.t('{n}h left', { n: Math.floor(left / 3600) }));
    }
    assert.equal(title(ctx, state), ctx.t('Challenges'));
    assert.equal(title(ctx, draw('targets', {}, { lang }).state), `${ctx.t('Snipe targets')} · ${ctx.t('Challenges')}`);
  }
  // No hill.json: no King of the hill tab, and asking for it shows the week.
  const site = { ...meta, files: { ...meta.files } };
  delete site.files['hill.json'];
  const { page, state } = draw('hill', {}, { site });
  assert.equal(state.tab, 'week');
  assert.ok(!page.includes('href="/challenges/hill"'));
  assert.equal(draw('nowhere').state.tab, 'week');
  assert.equal(draw(undefined).state.tab, 'week');
});

test('the map of the week: its banner, this week’s plays and the all-time top 10, in the file’s order', { skip }, () => {
  const { week } = json('challenges.json');
  if (!week) return;
  const me = week.board[0][0];
  const { page } = draw('week', {}, { me });
  assert.match(page, new RegExp(`<h3 class="banner-title"><a href="/map/${week.map}">`));
  assert.match(page, /<span class="countdown" id="countdown">\d+d \d\dh \d\dm \d\ds<\/span>/);
  const [thisWeek, allTime] = page.split('<div class="mt-6 section-head">');
  assert.deepEqual(playersIn(between(thisWeek, '<tbody>')), week.weekly.map(r => r[0]));
  assert.deepEqual(playersIn(allTime), week.board.slice(0, 10).map(r => r[0]));
  assert.equal(count(allTime, /<tr class="me">/g), 1, 'the visitor’s row');
});

test('snipe targets: the vulnerable #1s, one-player maps and unclaimed maps, in the file’s order', { skip }, () => {
  const { beatable, lonely, unclaimed } = json('challenges.json');
  const { page } = draw('targets');
  const [vulnerable, rest] = page.split('<section class="section grid grid-2">');
  const [one, unplayed] = rest.split(`<h2>${'Unclaimed'}</h2>`);
  assert.deepEqual(mapsIn(vulnerable), beatable.map(r => r[0]));
  assert.deepEqual(playersIn(vulnerable), beatable.map(r => r[3][0]));
  assert.deepEqual(mapsIn(one), lonely.map(r => r[0]));
  assert.deepEqual(playersIn(one), lonely.map(r => r[2][0]));
  assert.deepEqual(mapsIn(unplayed), unclaimed.map(r => r[0]));
});

test('the Dan course: 19 stages, the chosen one’s passers in order, the leaderboard and the roles', { skip }, () => {
  const dan = json('dan.json');
  const fallback = Math.max(0, dan.stages.findLastIndex(s => s.passers.length));
  for (const [query, stage] of [[{}, fallback], [{ stage: '0' }, 0], [{ stage: '3' }, 3], [{ stage: '18' }, 18], [{ stage: '19' }, 0], [{ stage: 'x' }, 0]]) {
    const { page } = draw('dan', query);
    const ladder = between(page, '<div class="dan-ladder"', '<section class="section" id="detail">');
    assert.equal(count(ladder, /<button class="dan-stage/g), 19);
    assert.deepEqual([...ladder.matchAll(/data-stage="(\d+)" type="button" aria-pressed="true"/g)].map(m => Number(m[1])), [stage], JSON.stringify(query));
    const detail = between(page, '<section class="section" id="detail">', '</section>');
    assert.deepEqual(mapsIn(detail), [dan.stages[stage].map]);
    assert.deepEqual(playersIn(detail), dan.stages[stage].passers.map(r => r[0]));
    // Each stage's pass count, and its first five faces.
    for (const s of dan.stages) {
      const card = between(ladder, `data-stage="${s.index}"`, '</button>');
      assert.equal(count(card, /<img /g), Math.min(5, s.passers.length));
      if (s.passers.length > 5) assert.match(card, new RegExp(`<span class="more">\\+${s.passers.length - 5}</span>`));
    }
  }
  const { page } = draw('dan');
  const board = between(page, '<h2>Dan leaderboard</h2>', '</table>');
  assert.deepEqual(playersIn(board), dan.ladder.map(r => r[0]));
  const roles = between(page, '<h2>Roles</h2>', '</table>');
  assert.deepEqual([...roles.matchAll(/<span class="badge badge-gold">([^<]+)<\/span>/g)].map(m => m[1]), ['PT Best Player', 'Dan Beast', 'Dan Expert', 'Dan Intermed', 'Dan Skrub']);
});

/** hill.json with closed months, seasons and crowns added (the export has none yet), one crown held by a stranger. */
function richHill(seasons = 2) {
  const hill = json('hill.json');
  const ids = json('players.json').map(p => p.id);
  const per = (...n) => [...n, 0, 0, 0, 0, 0, 0].slice(0, 6);
  const ghost = 999000111;
  const slot = (s, tier, map, u) => ({ slot: s, tier, map, holder: u ? { u, name: u === ghost ? 'Ghost' : 'X', time: 1 } : null, snipes: 0 });
  hill.months = [
    { month: '2026-10', end: 2, kings: [ids[0], ids[1]], most: 2, pool: [slot('NM', 'open', 1, ids[0]), slot('HD', 'challenger', 2, ghost), slot('HR', 'open', 3, null)] },
    { month: '2026-09', end: 1, kings: [], most: 0, pool: [slot('NM', 'open', 1, null)] },
  ];
  hill.seasons = Array.from({ length: seasons }, (_, i) => ({ id: `${2026 - Math.floor(i / 4)}-Q${4 - (i % 4)}`, final: i > 0, kings: { NM: [ids[0]] }, allRounders: [] }));
  hill.players = [
    [ids[0], 'X', 4, per(2, 1, 1), { '2026-Q4': per(1), '2026-Q3': per(1, 1, 1) }],
    [ghost, 'Ghost', 3, per(0, 3), { '2026-Q3': per(0, 3) }],
    [ids[1], 'Y', 3, per(0, 2, 0, 0, 0, 1), { '2026-Q4': per(0, 1, 0, 0, 0, 1) }],
    [ids[2], 'Z', 1, per(0, 0, 0, 0, 1), { '2026-Q4': per(0, 0, 0, 0, 1) }],
  ];
  return hill;
}

test('King of the hill: the pool, the crown table for each season, and the past months', { skip }, () => {
  const meta = json('meta.json');
  if (!meta.files['hill.json']) return;
  const hill = json('hill.json');
  const { page } = draw('hill');
  if (hill.current?.status === 'live') {
    const pool = between(page, '<div class="hill-pool"', '<section class="section">');
    assert.deepEqual(mapsIn(pool), ['NM', 'HD', 'HR', 'DT', 'FM', 'CV'].flatMap(s => ['open', 'challenger'].map(t => hill.current.pool.find(p => p.slot === s && p.tier === t)?.map)).filter(Boolean));
    assert.deepEqual(playersIn(pool), ['NM', 'HD', 'HR', 'DT', 'FM', 'CV'].flatMap(s => ['open', 'challenger'].map(t => hill.current.pool.find(p => p.slot === s && p.tier === t)?.holder?.u)).filter(Boolean));
    assert.equal(count(pool, /<span class="hill-free">/g), hill.current.pool.filter(p => !p.holder).length);
  }

  const rich = richHill();
  const ctx = ctxFor();
  for (const [query, scope] of [[{}, 'all'], [{ season: '2026-Q4' }, '2026-Q4'], [{ season: '2026-Q3' }, '2026-Q3'], [{ season: 'nope' }, 'all']]) {
    assert.equal(hillState(ctx, rich, query).scope, scope);
    const out = draw('hill', query, { hill: rich }).page;
    const table = between(out, '<div id="hill-table">', '</table>');
    const rows = tableRows(rich, scope);
    assert.deepEqual(playersIn(table), rows.map(r => r[0]), scope);
    assert.deepEqual([...table.matchAll(/<td class="num king-count">([^<]+)</g)].map(m => m[1]), rows.map(r => ctx.fmt.num(r[2])));
    // Tied counts share a rank; gold only for a sole #1.
    assert.deepEqual([...table.matchAll(/<td class="rank[^"]*">(\d+)</g)].map(m => Number(m[1])), rows.map(r => rows.findIndex(x => x[2] === r[2]) + 1));
    assert.match(out, new RegExp(`<p class="result-count" id="hill-count">${ctx.fmt.plural(rows.length, 'player')} with a crown</p>`));
    assert.match(out, /<div class="toolbar" id="hill-scopes"><div class="chips"/, 'chips for three choices');
    assert.equal(count(out, /<li><b>NM king<\/b>/g), scope === 'all' ? 0 : 1);
  }
  // The stranger shows by the name the bot gave, with osu!'s avatar.
  assert.match(draw('hill', {}, { hill: rich }).page, /<a class="player" href="\/player\/999000111"><img class="avatar " src="https:\/\/a\.ppy\.sh\/999000111"[^>]*><span>Ghost<\/span><\/a>/);
  // Past five seasons, a select; tier chips from the address.
  const many = draw('hill', { season: '2025-Q2', tier: 'challenger' }, { hill: richHill(7) }).page;
  assert.match(many, /<select class="select" id="hill-scope"><option value="all" >All time<\/option>/);
  assert.match(many, /<option value="2025-Q2" selected>Q2 2025<\/option>/);
  assert.match(many, /<div class="hill-pool" data-show="challenger">/);
  // The past months: kings in a sentence, a column only for a tier someone kept a crown in.
  const past = between(draw('hill', {}, { hill: rich }).page, '<h2>Past months</h2>');
  assert.equal(count(past, /<div class="hill-month">/g), 2);
  assert.match(past, /No crowns given/);
  assert.match(past, /<th>Open<\/th><th>Challenger<\/th>/);
});

test('bounties: the open ones in order with their pots, posting first when signed in, the hall and the wanted list', { skip }, () => {
  if (!has('bounties.json') || !has('economy.json')) return;
  const ids = json('players.json').map(p => p.id);
  const board = json('bounties.json');
  board.open = [
    [1207082, 'r', 'snipe', 100, 45, 0, ids[0], [['A cookie', 'Tris', 123, 9e9, false]], 11, 900, [[ids[1], 300], [null, 100]], ids[5], 9e9, 'HD', 500],
    [553131, 'c', 'fc', 99, 31, 2, null, [], 12, null, [], null, null, null, null],
    [884085, 'u', 'pass', null, 0, null, null, [], null, null, [], null, null, null, null],
  ];
  board.hall = [[1207082, 'r', 'fc', 'claimed', ids[2], 50, 'HDHR', 99.1, 1234, 456.7, [['Prize', 'Tris', 1]], 750], [553131, 'c', 'pass', 'done', ids[3], null, '', null, null, null, [], null]];
  const economy = json('economy.json');
  economy.players[ids[0]] = { b: 900, p: 0, e: 1200, x: 0, s: 1, sh: 0, t: null };

  const out = draw('bounties', {}, { board, economy }).page;
  const open = between(out, '<h2>Open bounties</h2>', '</section>');
  assert.deepEqual(mapsIn(open), board.open.map(r => r[0]));
  assert.equal(count(open, /data-fund="/g), 2, 'Fund on each bounty with Bananas');
  assert.match(open, /<div class="bounty-pot">/);
  assert.match(open, /<span class="mods"><span class="mod mod-increase">HD<\/span><\/span>/);
  assert.ok(out.indexOf('<h2>Open bounties</h2>') < out.indexOf('<h2>Post a bounty</h2>'), 'signed out, what’s on offer first');
  assert.match(out, /Signing in works on ptcatch\.com\./);
  assert.match(draw('bounties', {}, { board, economy, signInHere: true }).page, /<button class="btn btn-small" type="button" data-signin>Sign in to post or fund<\/button>/);
  assert.equal(count(out, /data-post-map=/g), 0);

  const signedIn = draw('bounties', {}, { board, economy, me: ids[0] }).page;
  assert.ok(signedIn.indexOf('<h2>Post a bounty</h2>') < signedIn.indexOf('<h2>Open bounties</h2>'), 'signed in, posting first');
  assert.match(signedIn, /<span class="small muted" id="post-wallet">Your wallet: <b>900 🍌<\/b><\/span>/);
  // The line by "Post a bounty…": empty while every rule holds at the minimum stake, else the first that fails.
  assert.match(signedIn, /<p class="small post-hint" id="post-hint"><\/p>/);
  economy.players[ids[0]] = { ...economy.players[ids[0]], e: 300 };
  assert.match(draw('bounties', {}, { board, economy, me: ids[0] }).page, /<p class="small post-hint" id="post-hint">700 more earned needed to post\.<\/p>/);
  economy.players[ids[0]] = { ...economy.players[ids[0]], e: 1200, b: 550 };
  assert.match(draw('bounties', {}, { board, economy, me: ids[0] }).page, /<p class="small post-hint" id="post-hint">Short by 50 🍌 for a stake of 500\.<\/p>/);
  assert.equal(count(signedIn, /data-post-map=/g), board.wanted.length);
  const stranger = draw('bounties', {}, { board, economy, me: 12345 }).page;
  assert.match(stranger, /The bot has no wallet for you yet\./);

  const hall = between(out, '<h2>Hall of fame</h2>', '</section>');
  assert.deepEqual(mapsIn(hall), board.hall.map(r => r[0]));
  assert.deepEqual(playersIn(hall), board.hall.map(r => r[4]));
  assert.match(hall, /took <b>750 🍌<\/b>/);
  assert.match(hall, /already done before it was posted/);
  const wanted = between(out, '<h2>Wanted</h2>', '</section>');
  assert.deepEqual(mapsIn(wanted), board.wanted.map(r => r[0]));

  // Without Bananas: no pots to fund, no posting; data from before bounties.json: the wanted list only.
  const plain = draw('bounties', {}, { board, economy: null }).page;
  assert.equal(count(plain, /data-fund="/g), 0);
  assert.ok(!plain.includes('<h2>Post a bounty</h2>'));
  assert.match(plain, /A moderator can post any of these with <code>!bounty add<\/code>\./);
  const old = draw('bounties', {}, { board: null, economy: null }).page;
  assert.match(old, /No open bounties right now\./);
  assert.match(old, /Nobody has claimed a bounty yet\./);
});

test('completion: the share cleared, and the maps left for each sort, star range and page', { skip }, () => {
  if (!has('completion.json')) return;
  const goal = json('completion.json');
  const ctx = ctxFor();
  const { page } = draw('completion');
  assert.match(page, new RegExp(`<p class="goal-figure">${ctx.fmt.num(goal.cleared / goal.total * 100, 1)}%</p>`));
  assert.deepEqual(playersIn(between(page, '<h2>Only they have cleared</h2>', '</section>')), goal.sole.map(r => r[0]));

  const byPlays = (a, b) => b[5] - a[5] || a[0] - b[0];
  const byLength = dir => (a, b) => !a[6] - !b[6] || dir * ((a[6] ?? 0) - (b[6] ?? 0)) || byPlays(a, b);
  const sorts = {
    popular: byPlays, easy: (a, b) => a[3] - b[3] || a[0] - b[0], hard: (a, b) => b[3] - a[3] || a[0] - b[0],
    new: (a, b) => (b[4] ?? 0) - (a[4] ?? 0) || b[0] - a[0], short: byLength(1), long: byLength(-1),
  };
  const listOf = out => [...between(out, '<div id="left-list">').matchAll(/<a class="row card-link" href="\/map\/(\d+)">/g)].map(m => Number(m[1]));
  for (const query of [{}, { sort: 'hard' }, { sort: 'short', page: '3' }, { sort: 'long' }, { sort: 'new', page: '2' }, { stars: '4-6' },
    { stars: '7-', sort: 'easy' }, { stars: '0-1.5' }, { page: '9999' }, { sort: 'nope' }, { diff: 'platter' }]) {
    const state = completionState(ctx, goal, query);
    const expected = goal.left.filter(r => inStars(r[3], parseStars(query))).sort(sorts[query.sort in sorts ? query.sort : 'popular']);
    const pages = Math.max(1, Math.ceil(expected.length / 50));
    const at = Math.min(Math.max(0, (Number(query.page) || 1) - 1), pages - 1);
    const out = draw('completion', query).page;
    assert.equal(state.sort, query.sort in sorts ? query.sort : 'popular');
    assert.deepEqual(listOf(out), expected.slice(at * 50, at * 50 + 50).map(r => r[0]), JSON.stringify(query));
    assert.match(out, new RegExp(`<p class="result-count" id="left-count">${expected.length === goal.left.length ? '' : `${ctx.fmt.num(expected.length)} of `}${ctx.fmt.num(goal.left.length)} maps</p>`));
    if (pages > 1) assert.match(out, new RegExp(`Page ${ctx.fmt.num(at + 1)} of ${ctx.fmt.num(pages)}`));
    if (!expected.length) assert.match(out, /<button class="btn btn-small" type="button" data-clear>Clear filters<\/button>/);
  }
  // Data from before lengths: no length sorts; from before completion.json: a note.
  const short = { ...goal, left: goal.left.map(r => r.slice(0, 6)) };
  const out = draw('completion', { sort: 'short' }, { completion: short }).page;
  assert.ok(!out.includes('value="short"'));
  assert.match(out, /<option value="popular" selected>/);
  const none = { ...dataFor('completion'), completion: null };
  assert.match(String(render(ctx, none, readState(none, { tab: 'completion' }, {}))), /The completion goal arrives with the next data update\./);
});
