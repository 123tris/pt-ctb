// node --test web/test/challenges.test.mjs
// The Challenges page, every tab, drawn in Node from an export (its core pack and JSON; skipped without, as the other
// view tests are) and checked against the JSON: the tab strip and its figures, the map of the week's boards, the snipe
// targets, the Dan course for each stage, King of the hill's pool and crown table for each season, the Duels' ladder and
// latest duels, the bounty board signed in and out, and Completion's year strip and list for each sort, year, star range
// and page. The export has no claimed bounties, closed hill months or duels, so those are added to its files here
// (duels in the exporter's own shapes, duel-data.mjs).

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
import { readState as duelsState, ladderTable, LADDER_PAGE, DUELS_PAGE } from '../src/views/duels.ts';
import { readState as hillState, tableRows, CROWNS_HREF } from '../src/views/hill.ts';
import { PT } from '../../assets/js/core/pt.js';
import { duelData, OFF } from './duel-data.mjs';

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
    duels: tab === 'duels' && site.files?.['duels.json'] ? ('duels' in edit ? edit.duels : json('duels.json')) : null,
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
  assert.deepEqual(firstData('/challenges/duels', '?duels=ranked'), { packs: ['packs/core.ptcb'], json: [...base, 'duels.json'] });
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
    assert.deepEqual(tabs, ['week', ...(meta.files['hill.json'] ? ['hill'] : []), ...(meta.files['duels.json'] ? ['duels'] : []), 'dan', 'targets', 'bounties', 'completion']);
    assert.match(strip, /<a href="\/challenges\/week" class="active" aria-current="page">/);
    const figure = slug => strip.match(new RegExp(`href="/challenges/${slug}"[^>]*>[^<]*(?:<span class="count"><span class="sr-only">, </span>([^<]*)</span>)?</a>`))?.[1];
    assert.equal(figure('targets'), ctx.fmt.num(challenges.beatable.length));
    if (has('bounties.json')) assert.equal(figure('bounties'), ctx.fmt.num(json('bounties.json').open.length));
    if (meta.completion?.total) assert.equal(figure('completion'), `${ctx.fmt.num(meta.completion.cleared / meta.completion.total * 100, 1)}%`);
    if (meta.files['duels.json']) {
      // Duels: their label with the Experimental tag, and how many are being played.
      assert.ok(strip.includes(`<a href="/challenges/duels" class="" >${ctx.t('Duels')} <span class="legend-tag exp-tag">${ctx.t('Experimental')}</span>`));
      const live = strip.match(/href="\/challenges\/duels"[^>]*>.*?<\/span>(?:<span class="count"><span class="sr-only">, <\/span>([^<]*)<\/span>)?<\/a>/)?.[1];
      assert.equal(live, meta.duels?.live ? ctx.t('{n} live', { n: ctx.fmt.num(meta.duels.live) }) : undefined);
    }
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
  // No hill.json: no King of the hill tab, and asking for it shows the week; the same for duels.json.
  const site = { ...meta, files: { ...meta.files } };
  delete site.files['hill.json'];
  delete site.files['duels.json'];
  const { page, state } = draw('hill', {}, { site });
  assert.equal(state.tab, 'week');
  assert.ok(!page.includes('href="/challenges/hill"'));
  assert.equal(draw('duels', {}, { site }).state.tab, 'week');
  assert.ok(!page.includes('href="/challenges/duels"'));
  // With duels.json, the tab, after King of the hill; two being played make its figure.
  const withDuels = { ...meta, files: { ...meta.files, 'duels.json': 'x' }, duels: { live: 2, players: 3, total: 9, leader: null } };
  const duelsTab = draw('duels', {}, { site: withDuels, duels: madeDuels().block.file });
  assert.equal(duelsTab.state.tab, 'duels');
  assert.match(duelsTab.page, /<a href="\/challenges\/duels" class="active" aria-current="page">Duels <span class="legend-tag exp-tag">Experimental<\/span><span class="count"><span class="sr-only">, <\/span>2 live<\/span><\/a>/);
  assert.equal(title(duelsTab.ctx, duelsTab.state), 'Duels · Challenges');
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
    const pool = between(page, '<div class="hill-pool"', '<section class="section" id="hill-crowns">');
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
  // ?at=crowns (Leaderboards' link, CROWNS_HREF) points at the crown table's section, which the mount scrolls to.
  assert.equal(CROWNS_HREF, '/challenges/hill?at=crowns');
  assert.equal(hillState(ctx, rich, { at: 'crowns' }).crowns, true);
  assert.equal(hillState(ctx, rich, {}).crowns, false);
  assert.match(draw('hill', { at: 'crowns' }, { hill: rich }).page, /<section class="section" id="hill-crowns">\s*<div class="section-head"><h2>Crown table<\/h2>/);
});

let made = null;
/** Made-up duels over the export's first players (duel-data.mjs), with meta.json listing duels.json. */
const madeDuels = () => (made ??= duelData(Array.from({ length: 60 }, (_, i) => coreOf().players.id[i]), coreOf().info.generatedAt[0]));
const duelSite = (file = madeDuels().block.file) => ({ ...json('meta.json'), files: { ...json('meta.json').files, 'duels.json': 'x' }, duels: { live: file.live.length } });
const drawDuels = (query = {}, { file = madeDuels().block.file, ...options } = {}) => draw('duels', query, { site: duelSite(file), duels: file, ...options });

test('duels: the duels being played, the ladder a page at a time, and the latest duels filtered and paged', { skip }, () => {
  const { block, a, b, c } = madeDuels();
  const file = block.file;
  const { page, ctx } = drawDuels({}, { me: a });
  assert.match(page, /<p class="muted tabs-intro">Rated 1v1s on random maps of the right difficulty, played in an osu! lobby\. Type <code>\/duel<\/code> on the Discord/);
  assert.match(page, /<div id="panel">\s*<p class="notice exp-note">Duels are new and still being verified; ratings and results may be reset\.<\/p>/);
  // Being played: both sides linked, the points, the format, when it started and the lobby; one off the site.
  const live = between(page, '<h2>Being played now</h2>', '</section>');
  assert.ok(live.includes(ctx.t('As of the last data update, {ago}', { ago: ctx.fmt.ago(json('meta.json').generatedAt) })));
  assert.equal(count(live, /<div class="row duel-row duel-live">/g), file.live.length);
  assert.deepEqual([...live.matchAll(/<a class="player duel-side" href="\/player\/(\d+)">/g)].map(m => Number(m[1])), file.live.flatMap(d => d.players.map(p => p.u)));
  assert.ok(live.includes('<a href="https://osu.ppy.sh/community/matches/120000001" target="_blank" rel="noopener">Lobby on osu!</a>'));
  assert.ok(live.includes(`<img class="avatar avatar-sm" src="https://a.ppy.sh/${OFF}"`) && live.includes('<span class="duel-name ">Ghost &lt;Duelist&gt;</span>'));
  assert.equal(count(live, /started /g), 1, 'a live duel with no start says nothing of it');
  // The ladder: its first page in the file's order, rated then provisional, the visitor's row marked.
  assert.ok(file.ladder.length > LADDER_PAGE);
  const ladder = between(page, '<div id="duel-ladder">', '</nav>');
  const rows = [...ladder.matchAll(/<tr class="([^"]*)">\s*<td class="rank[^"]*">(.*?)<\/td>\s*<td class="cell-player"><a class="player" href="\/player\/(\d+)">/g)];
  assert.deepEqual(rows.map(m => Number(m[3])), file.ladder.slice(0, LADDER_PAGE).map(r => r.u));
  assert.deepEqual(rows.map(m => m[1].trim()), file.ladder.slice(0, LADDER_PAGE).map(r => [r.u === a ? 'me' : '', r.prov ? 'duel-prov' : ''].join(' ').trim()));
  assert.ok(ladder.includes(`Page 1 of ${Math.ceil(file.ladder.length / LADDER_PAGE)}`));
  const top = file.ladder[0];
  assert.match(ladder, /<td class="rank king-rank">1<\/td>/);
  assert.ok(ladder.includes(`<td class="num duel-rating">${ctx.fmt.num(top.r)} <small class="faint" title="Rating deviation: how sure the rating is (lower is surer)">±${ctx.fmt.num(top.rd)}</small></td>`));
  // A provisional player: after every rated one, with no place and the tag that explains it.
  const prov = file.ladder.find(r => r.u === c);
  assert.ok(prov.prov && prov.rank === null && file.ladder.indexOf(prov) >= file.ladder.filter(r => !r.prov).length);
  const provRow = String(ladderTable(ctx, [prov], coreOf().players));
  assert.match(provRow, /<tr class=" duel-prov">\s*<td class="rank "><span aria-label="provisional">–<\/span><\/td>/);
  assert.ok(provRow.includes('data-tip="Fewer than about five ranked duels: the rating moves a lot until it settles."'));
  assert.ok(provRow.includes(`<span class="cell-sub">${ctx.t('{wins}, {losses}', { wins: ctx.fmt.plural(prov.w, 'win'), losses: ctx.fmt.plural(prov.l, 'loss', 'losses') })} · ${ctx.tn(prov.streak, '{n} win in a row', '{n} wins in a row')}</span>`));
  // The latest duels: chips, the count, the first page of rows, each linking to its page; the visitor's marked.
  const latest = between(page, '<h2>Latest duels</h2>', '</section>');
  assert.match(latest, /<div class="toolbar" id="duel-kinds"><div class="chips" role="group" aria-label="Show">/);
  assert.match(latest, /<button class="chip active" type="button" data-duels="all" aria-pressed="true">All<\/button>/);
  assert.match(latest, new RegExp(`<p class="result-count" id="duel-count">${ctx.fmt.plural(file.recent.length, 'duel')}</p>`));
  const ids = part => [...part.matchAll(/<a class="row card-link duel-row ([^"]*)" href="\/duel\/(\d+)">/g)].map(m => [Number(m[2]), m[1].trim()]);
  assert.deepEqual(ids(latest).map(([id]) => id), file.recent.slice(0, DUELS_PAGE).map(d => d.id));
  assert.deepEqual(ids(latest).map(([, cls]) => cls), file.recent.slice(0, DUELS_PAGE).map(d => [d.status === 'abandoned' ? 'duel-muted' : '', d.players.some(p => p.u === a) ? 'me' : ''].join(' ').trim()));
  assert.ok(!latest.includes('The latest'), 'every duel is in the list');
  // A row: the scoreline with the winner in bold and a hidden "won", the format, how it ended, the stars, when.
  const forfeit = between(latest, 'href="/duel/25">', '</a>');
  assert.ok(forfeit.includes(`<span class="duel-side duel-winner">`) && forfeit.includes('<span class="sr-only"> (won)</span>'));
  assert.match(forfeit, /<span>Ranked · Best of 3<\/span>\s*<span class="sep"><\/span><span>Forfeit<\/span>/);
  const stars = file.recent.find(d => d.id === 128).stars;
  assert.ok(between(latest, 'href="/duel/128">', '</a>').includes(`<span>${ctx.fmt.num(stars[0], 1)}–${ctx.fmt.num(stars[1], 1)}★</span>`));

  // Filtered and paged from the address; a page past the end is the last; an unknown filter is all of them.
  for (const [query, kind] of [[{ duels: 'ranked' }, 'ranked'], [{ duels: 'unranked', page: '2' }, 'unranked'], [{ page: '2' }, 'all'], [{ page: '99' }, 'all'], [{ duels: 'x' }, 'all']]) {
    const state = duelsState(query);
    assert.equal(state.kind, kind);
    const kept = file.recent.filter(d => kind === 'all' || d.ranked === (kind === 'ranked'));
    const pages = Math.max(1, Math.ceil(kept.length / DUELS_PAGE));
    const at = Math.min(Math.max(0, (Number(query.page) || 1) - 1), pages - 1);
    const out = between(drawDuels(query).page, '<h2>Latest duels</h2>', '</section>');
    assert.deepEqual(ids(out).map(([id]) => id), kept.slice(at * DUELS_PAGE, at * DUELS_PAGE + DUELS_PAGE).map(d => d.id), JSON.stringify(query));
    assert.match(out, new RegExp(`<button class="chip active" type="button" data-duels="${kind}" aria-pressed="true">`));
    assert.match(out, new RegExp(`id="duel-count">${kept.length === file.recent.length ? '' : `${kept.length} of `}${ctx.fmt.plural(file.recent.length, 'duel')}</p>`));
  }
  // More duels than the list keeps; none of a kind; nothing at all.
  assert.match(drawDuels({}, { file: { ...file, total: 250 } }).page, new RegExp(`<p class="small muted">The latest ${file.recent.length} of 250 duels\\.</p>`));
  const ranked = { ...file, recent: file.recent.filter(d => d.ranked) };
  assert.match(drawDuels({ duels: 'unranked' }, { file: ranked }).page, /<div class="empty"><p>No duels of this kind yet\.<\/p><button class="btn btn-small" type="button" data-clear>Clear filters<\/button><\/div>/);
  const none = drawDuels({}, { file: { ladder: [], live: [], recent: [], total: 0, maps: {} } }).page;
  assert.ok(!none.includes('Being played now'));
  assert.match(none, /<div class="empty">No ranked duels yet\. Type <code>\/duel<\/code> on the Discord to start one\.<\/div>/);
  assert.match(none, /<div class="empty">No duels played yet\.<\/div>/);
  assert.ok(!none.includes('Glicko-2'));
  // In Portuguese.
  const pt = drawDuels({}, { lang: 'pt' });
  for (const text of ['Being played now', 'Ladder', 'Latest duels', 'Lobby on osu!', 'Duel ladder']) assert.ok(pt.page.includes(pt.ctx.t(text)), text);
  assert.ok(pt.page.includes(pt.ctx.fmt.plural(file.recent.length, 'duel')));
  assert.equal(b > 0, true);
});

test('the export’s own duels, when it has some: the ladder and the latest duels in the file’s order', { skip }, () => {
  const meta = json('meta.json');
  if (!meta.files['duels.json']) return;
  const file = json('duels.json');
  const { page } = draw('duels');
  assert.deepEqual([...between(page, '<div id="duel-ladder">', '</table>').matchAll(/<td class="cell-player"><a class="player" href="\/player\/(\d+)">/g)].map(m => Number(m[1])),
    file.ladder.slice(0, LADDER_PAGE).map(r => r.u));
  assert.deepEqual([...page.matchAll(/<a class="row card-link duel-row [^"]*" href="\/duel\/(\d+)">/g)].map(m => Number(m[1])), file.recent.slice(0, DUELS_PAGE).map(d => d.id));
  assert.equal(count(page, /<div class="row duel-row duel-live">/g), file.live.length);
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

test('completion by year ranked: the strip, its line, and the maps left of one year', { skip }, () => {
  if (!has('completion.json')) return;
  const ctx = ctxFor();
  const real = json('completion.json');
  const yearOf = r => (r[4] == null ? null : new Date(r[4] * 86400000).getUTCFullYear());
  const leftYears = [...new Set(real.left.map(yearOf).filter(y => y !== null))].sort((x, y) => x - y);
  // The export's years, or ones made up from its maps left (an export from before `years`), with a gap and a year done.
  const goal = real.years ? real : {
    ...real, years: [[leftYears[0] - 3, 10, 10], [leftYears[0] - 1, 4, 4], ...leftYears.map(y => [y, real.left.filter(r => yearOf(r) === y).length + 50, 50])],
  };
  const years = goal.years;
  const span = years.at(-1)[0] - years[0][0] + 1;
  const { page } = draw('completion', {}, { completion: goal });
  const strip = between(page, '<div class="goal-years">', '<p class="goal-aside">');
  // A column a year, the empty years between too; gold for a year done, open for one with maps left.
  const cols = [...strip.matchAll(/<span class="goal-year([^"]*)" data-i="(\d+)" style="--done:([\d.]+)%"><\/span>/g)];
  assert.equal(cols.length, span);
  assert.match(strip, /<div class="goal-years-cols is-listable" role="img" aria-label="Share cleared by year ranked: /);
  const byYear = new Map(years.map(y => [y[0], y]));
  cols.forEach(([, cls, i, done]) => {
    const y = byYear.get(years[0][0] + Number(i));
    assert.equal(cls, !y || !y[1] ? ' is-none' : y[1] === y[2] ? ' is-full' : ' is-open');
    assert.equal(done, (y && y[1] ? (y[2] / y[1]) * 100 : 0).toFixed(1));
  });
  // The first and last years are labelled; the line names how many are done and the one furthest behind.
  const axis = [...between(strip, '<div class="goal-years-axis"', '</div>').matchAll(/>(\d{4})</g)].map(m => Number(m[1]));
  assert.equal(axis[0], years[0][0]);
  assert.equal(axis.at(-1), years.at(-1)[0]);
  const full = years.filter(y => y[1] && y[1] === y[2]).length;
  if (full) assert.ok(strip.includes(`<span class="goal-years-key"></span>${ctx.tn(full, '{n} year fully cleared', '{n} years fully cleared')}`));
  const open = years.filter(y => y[1] && y[2] < y[1]);
  const behind = open.reduce((x, y) => (!x || y[2] / y[1] < x[2] / x[1] || (y[2] / y[1] === x[2] / x[1] && y[1] - y[2] > x[1] - x[2]) ? y : x), null);
  assert.ok(strip.includes(`furthest behind is ${behind[0]}, with ${ctx.fmt.num(behind[2])} of ${ctx.fmt.num(behind[1])} cleared`));
  assert.match(strip, /<span id="year-pick" hidden><\/span>/);

  // The select: every year with maps left, oldest first, with how many.
  const select = between(page, '<select class="select" id="left-year"', '</select>');
  const options = [...select.matchAll(/<option value="(\d+)" >Ranked in (\d+) \(([\d,]+) left\)<\/option>/g)].map(m => [Number(m[1]), m[3]]);
  assert.deepEqual(options, leftYears.map(y => [y, ctx.fmt.num(goal.left.filter(r => yearOf(r) === y).length)]));
  // ?year= lists that year's maps left, the select and the strip mark it; a year with none left is every year.
  const year = leftYears.at(-1);
  for (const [query, expect] of [[{ year: String(year) }, year], [{ year: String(year), sort: 'hard', page: '2' }, year], [{ year: '1999' }, null], [{ year: 'x' }, null]]) {
    const state = completionState(ctx, goal, query);
    assert.equal(state.year, expect, JSON.stringify(query));
    const out = draw('completion', query, { completion: goal }).page;
    const listed = [...between(out, '<div id="left-list">').matchAll(/<a class="row card-link" href="\/map\/(\d+)">/g)].map(m => Number(m[1]));
    const kept = goal.left.filter(r => expect === null || yearOf(r) === expect);
    assert.ok(listed.every(id => kept.some(r => r[0] === id)), JSON.stringify(query));
    assert.match(out, new RegExp(`id="left-count">${kept.length === goal.left.length ? '' : `${ctx.fmt.num(kept.length)} of `}${ctx.fmt.num(goal.left.length)} maps</p>`));
    assert.equal(count(out, /is-chosen/g), expect === null ? 0 : 1);
    if (expect !== null) assert.ok(out.includes(`<option value="${expect}" selected>`));
  }
  // Nothing of that year in the range: says so with the year.
  assert.match(draw('completion', { year: String(year), stars: '0-0.1' }, { completion: goal }).page,
    new RegExp(`<p>No uncleared maps ranked in ${year} at [^<]*\\.</p>`));
  // Every map cleared: the strip, not listable; data from before `years`, or a single year: no strip.
  const done = draw('completion', {}, { completion: { ...goal, left: [] } }).page;
  assert.match(done, /<div class="goal-years-cols" role="img"/);
  assert.ok(!done.includes('id="left-year"'));
  assert.ok(!draw('completion', {}, { completion: { ...goal, years: undefined } }).page.includes('goal-years'));
  assert.ok(!draw('completion', {}, { completion: { ...goal, years: years.slice(-1) } }).page.includes('goal-years'));
  // In Portuguese.
  const pt = ctxFor('pt');
  const ptPage = draw('completion', {}, { completion: goal, lang: 'pt' }).page;
  for (const text of ['By year ranked:', 'Every year']) assert.ok(ptPage.includes(pt.t(text)), text);
  assert.ok(ptPage.includes(pt.t('Ranked in {year} ({n} left)', { year: leftYears[0], n: pt.fmt.num(goal.left.filter(r => yearOf(r) === leftYears[0]).length) })));
});
