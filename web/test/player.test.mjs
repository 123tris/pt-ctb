// node --test web/test/player.test.mjs
// The profile, drawn in Node from an export (its core pack and JSON; skipped without, as web/test/rankings.test.mjs
// is): the lists against the player files, every tab, the parts around them, and the pieces ported from the old
// modules (badges, the chart) against those modules themselves.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { S } from '../src/kernel/model.ts';
import { rowOf } from '../src/ui/players.ts';
import { playerBadges, era, signatureMap } from '../src/ui/badges.ts';
import { lineChart } from '../src/ui/charts.ts';
import { render, readState, countsOf, TAB_LIST, historyPoints, historyRanges, historyLines } from '../src/views/player.ts';
import { firstData } from '../src/routes.ts';
import { PT } from '../../assets/js/core/pt.js';
import * as oldBadges from '../../assets/js/core/badges.js';
import * as oldCharts from '../../assets/js/core/charts.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;

/** The player with the most plays in the test data, and others whose tabs, trophies or wallets differ. */
const MANY = 6205809;
const IDS = [MANY, 16829812, 10055003, 29380292, 13294871, 10816573];

const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
let core = null;
const coreOf = () => {
  if (core) return core;
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  return (core = readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
};
const ctxFor = (lang, { me = null } = {}) => {
  const now = coreOf().info.generatedAt[0];
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me };
};
const fileOf = (id, { full = false } = {}) => json(`players/${id}${full ? '' : '-head'}.json`);
const dataFor = (id, { full = false, history = null } = {}) => {
  const c = coreOf();
  return {
    id, core: c, row: rowOf(c.players, id), file: fileOf(id, { full }), records: full ? json('records.json') : null,
    bounties: json('bounties.json'), economy: json('economy.json'), history,
  };
};
const draw = (id, { tab, query = {}, full = false, history = null, chartOpen = false, lang = 'en', me = null, signInHere = true } = {}) =>
  String(render(ctxFor(lang, { me }), dataFor(id, { full, history }), readState({ id: String(id), tab }, query, { chartOpen, signInHere })));

/** The plays on the page's list: [map id, category chip or ''] per row. */
const rowsOf = page => {
  const scores = page.slice(page.indexOf('<div id="scores">'));
  return scores.split('<div class="row">').slice(1).map(row => [Number(row.match(/href="\/map\/(\d+)"/)[1]), row.match(/<span class="cat cat-(\w)">/)?.[1] ?? '']);
};
const tabsOf = page => [...page.matchAll(/<a href="\/player\/\d+\/(\w+)" class="(active)?" [^>]*>[^<]*<span class="count"><span class="sr-only">, <\/span>([^<]*)<\/span>/g)]
  .map(m => ({ slug: m[1], active: Boolean(m[2]), count: m[3] }));
const countOf = page => page.match(/<p class="result-count" id="count">([^<]*)<\/p>/)?.[1];
const num = n => n.toLocaleString('en-GB');

/** A list as the old page orders it: the categories' plays one after another, then a stable sort. */
const mixed = (file, cats) => cats.flatMap(cat => file.scores[cat].map(s => [s, cat]));
const byPp = (a, b) => b[0][S.PP] - a[0][S.PP];

test('a profile is drawn by the new client, with the core pack and its head file first', () => {
  assert.deepEqual(firstData('/player/6205809'), { packs: ['packs/core.ptcb'], json: ['players/6205809-head.json'] });
  assert.deepEqual(firstData('/player/6205809/loved/'), { packs: ['packs/core.ptcb'], json: ['players/6205809-head.json'] });
  assert.equal(firstData('/player/abc'), null);
  assert.equal(firstData('/player/1/2/3'), null);
});

test('many plays: the first page from the head file is the whole file’s first page, with the right tabs and count', { skip }, () => {
  const head = fileOf(MANY);
  const full = fileOf(MANY, { full: true });
  const page = draw(MANY);
  const counts = head.counts;
  const all = counts.c + counts.u + counts.r;
  assert.match(page, new RegExp(`<h1><a class="title-link[^"]*" href="https://osu.ppy.sh/users/${MANY}/fruits"[^>]*>${head.name}</a>`));
  assert.deepEqual(tabsOf(page), [
    { slug: 'all', active: true, count: num(all) }, { slug: 'converts', active: false, count: num(counts.c) },
    { slug: 'loved', active: false, count: num(counts.u) }, { slug: 'ranked', active: false, count: num(counts.c + counts.r) },
    { slug: 'dan', active: false, count: num(counts.dan) }, { slug: 'pre', active: false, count: num(counts.pre) },
  ]);
  assert.equal(countOf(page), `${num(all)} plays`);
  assert.match(page, new RegExp(`<span>Page 1 of ${num(Math.ceil(all / 50))}</span>`));
  // The head's 50: the most pp across its three first pages.
  const expected = mixed(head, ['c', 'u', 'r']).sort(byPp).slice(0, 50).map(([s, cat]) => [s[S.MAP], cat]);
  assert.equal(expected.length, 50);
  assert.deepEqual(rowsOf(page), expected);
  // The same page from the whole file.
  const whole = draw(MANY, { full: true });
  assert.deepEqual(rowsOf(whole), expected);
  assert.equal(countOf(whole), `${num(full.scores.c.length + full.scores.u.length + full.scores.r.length)} plays`);
  // A later page from the head alone is placeholder rows, the pager already right.
  const later = draw(MANY, { query: { page: '3' } });
  assert.match(later, /<div class="rows rows-placeholder" aria-hidden="true">/);
  assert.match(later, new RegExp(`<span>Page 3 of ${num(Math.ceil(all / 50))}</span>`));
});

test('the whole file: the address’s sort, “Only #1s”, search and page', { skip }, () => {
  const full = fileOf(MANY, { full: true });
  const total = full.scores.c.length + full.scores.u.length + full.scores.r.length;
  // Sorted by accuracy, the third page.
  const byAcc = mixed(full, ['c', 'u', 'r']).sort((a, b) => b[0][S.ACC] - a[0][S.ACC]);
  const acc = draw(MANY, { full: true, query: { sort: 'acc', page: '3' } });
  assert.deepEqual(rowsOf(acc), byAcc.slice(100, 150).map(([s, cat]) => [s[S.MAP], cat]));
  assert.match(acc, /<option value="acc" selected>/);
  assert.match(acc, /<button class="btn btn-small" type="button" data-page="prev" >/);
  // Converts, only #1s: a single-category list has no category chips.
  const firsts = full.scores.c.filter(s => s[S.POS] === 1);
  assert.ok(firsts.length > 50 && firsts.length < full.scores.c.length);
  const onlyFirsts = draw(MANY, { full: true, tab: 'converts', query: { firsts: '1' } });
  assert.equal(countOf(onlyFirsts), `${num(firsts.length)} of ${num(full.scores.c.length)} plays`);
  assert.deepEqual(rowsOf(onlyFirsts), firsts.slice(0, 50).map(s => [s[S.MAP], '']));
  assert.match(onlyFirsts, /<input type="checkbox" id="firsts" checked>/);
  // A search, over title, difficulty and mapper.
  const word = 'freedom';
  const meta = full.maps;
  const hits = mixed(full, ['c', 'u', 'r']).filter(([s]) => {
    const m = meta[s[S.MAP]];
    return m && `${m[0]} - ${m[1]} [${m[2]}] · ${m[14]}`.toLowerCase().includes(word);
  }).sort(byPp);
  assert.ok(hits.length > 0 && hits.length < total, 'the search finds some plays, not all');
  const found = draw(MANY, { full: true, query: { q: word } });
  assert.equal(countOf(found), `${num(hits.length)} of ${num(total)} plays`);
  assert.deepEqual(rowsOf(found), hits.slice(0, 50).map(([s, cat]) => [s[S.MAP], cat]));
  // Nothing found says so, with the way back.
  const none = draw(MANY, { full: true, query: { q: 'zz nothing like this zz' } });
  assert.equal(countOf(none), `0 of ${num(total)} plays`);
  assert.match(none, /<p>No play matches “zz nothing like this zz”\.<\/p><button class="btn btn-small" type="button" data-clear>Clear filters<\/button>/);
  // A page past the end is the last one.
  const last = Math.ceil(total / 50);
  assert.match(draw(MANY, { full: true, query: { page: String(last + 10) } }), new RegExp(`<span>Page ${num(last)} of ${num(last)}</span>`));
});

test('every tab of several players: only lists with plays get one, and each draws its list from the file', { skip }, () => {
  for (const id of IDS) {
    const head = fileOf(id);
    const counts = countsOf(head);
    const shown = TAB_LIST.filter(item => counts[item.slug]).map(item => item.slug);
    for (const slug of shown) {
      const page = draw(id, { tab: slug });
      const tabs = tabsOf(page);
      assert.deepEqual(tabs.map(tab => tab.slug), shown, `${id}: tabs`);
      assert.deepEqual(tabs.filter(tab => tab.active).map(tab => tab.slug), [slug], `${id} ${slug}: the open tab`);
      if (slug === 'dan') {
        assert.equal((page.match(/<a class="dan-stage /g) ?? []).length, 19, `${id}: the Dan grid`);
        assert.equal((page.match(/<div class="small dan-pass">/g) ?? []).length, head.dan.length, `${id}: Dan passes`);
        continue;
      }
      const rows = rowsOf(page);
      assert.equal(rows.length, Math.min(50, counts[slug]), `${id} ${slug}: the first page`);
      assert.equal(countOf(page), `${num(counts[slug])} ${counts[slug] === 1 ? 'play' : 'plays'}`, `${id} ${slug}: the count`);
      const single = { converts: head.scores.c, loved: head.scores.u, pre: head.pre }[slug];
      if (single) assert.deepEqual(rows, single.slice(0, 50).map(s => [s[S.MAP], '']), `${id} ${slug}: the order`);
      if (slug === 'ranked') assert.deepEqual(rows, mixed(head, ['r', 'c']).sort(byPp).slice(0, 50).map(([s, cat]) => [s[S.MAP], cat]), `${id}: ranked`);
      if (slug === 'pre') {
        assert.match(page, /Plays set before their map was ranked\./);
        assert.doesNotMatch(page, /id="firsts"/);
        assert.doesNotMatch(page.slice(page.indexOf('id="scores"')), /class="pos /);
      }
    }
  }
  // An empty list asked for by its address: its tab, open, and what to say instead.
  const page = draw(16829812, { tab: 'converts' });
  assert.deepEqual(tabsOf(page).find(tab => tab.slug === 'converts'), { slug: 'converts', active: true, count: '0' });
  assert.match(page, /<div class="empty">RadoV2 has no plays in Converts yet\.<\/div>/);
  assert.equal(countOf(page), '');
  // An unknown list is the first with plays in it.
  assert.deepEqual(tabsOf(draw(16829812, { tab: 'nope' })).filter(tab => tab.active).map(tab => tab.slug), ['all']);
});

test('around the lists: the head’s stats, badges, signature map and trophies', { skip }, () => {
  const players = json('players.json');
  for (const id of IDS) {
    const head = fileOf(id);
    const p = players.find(x => x.id === id);
    const page = draw(id);
    assert.ok(page.includes(`${num(p.plays)}</span></div>`), `${id}: play count`);
    assert.ok(page.includes(`${num(p.dan.length)} of 19 stages`), `${id}: Dan stages`);
    const badges = head.extras.badges.length;
    if (badges) assert.ok(page.includes(`${badges} ${badges === 1 ? 'badge' : 'badges'}`), `${id}: badges`);
    else assert.doesNotMatch(page, /class="peek"/);
    if (head.extras.signature) assert.ok(page.includes(`href="/map/${head.extras.signature.s[S.MAP]}"`), `${id}: signature map`);
    if (p.rank.c) assert.ok(page.includes(`href="/rankings/converts?at=${id}" aria-label="Converts leaderboard, #${p.rank.c} PT"`), `${id}: converts rank`);
  }
  assert.match(draw(29380292), /<section class="section card trophies">[\s\S]*Holding this month: Convert \(Open\), Convert \(Challenger\)\./);
  assert.doesNotMatch(draw(16829812), /card trophies/);
});

test('badges, era and signature map worked out here, as the old modules work them out', { skip }, () => {
  const players = json('players.json');
  const records = json('records.json');
  const ctx = ctxFor('en');
  const c = coreOf();
  for (const id of IDS) {
    const full = fileOf(id, { full: true });
    const p = players.find(x => x.id === id);
    const now = ctx.now();
    if (id === MANY) assert.ok(oldBadges.playerBadges(p, full, records, now).length >= 5);
    assert.deepEqual(playerBadges(ctx, c.players, rowOf(c.players, id), full, records), oldBadges.playerBadges(p, full, records, now), `${id}: badges`);
    assert.equal(era(ctx, full), oldBadges.era(p, full, now), `${id}: era`);
    assert.deepEqual(signatureMap(full), oldBadges.signatureMap(full), `${id}: signature`);
  }
  // The whole file without a head draws them from records.json.
  assert.match(draw(MANY, { full: true }), /The Wall/);
});

test('the pp chart: drawn from history.json only when it’s open, as the old charts module draws it', { skip }, () => {
  const history = json('history.json');
  // Shut, without history.json: the section alone, for the chart and its ranges to come when it opens.
  const shut = draw(MANY);
  assert.match(shut, /<details class="section card history" id="history" >/);
  assert.match(shut, /<div class="chart-wrap" id="history-chart"><\/div>/);
  assert.doesNotMatch(shut, /data-range=|<svg class="chart"/);
  // Open, with it: the ranges and the chart.
  const open = draw(MANY, { history, chartOpen: true });
  assert.match(open, /<details class="section card history" id="history" open>/);
  assert.match(open, /data-range="all" aria-pressed="true">All<\/button>/);
  assert.match(open, /<div class="chart-wrap" id="history-chart"><svg class="chart" viewBox="0 0 600 240" role="img"/);
  // The same SVG as charts.js draws for the same lines.
  const ctx = ctxFor('en');
  const { recorded, rebuilt } = historyPoints(history, MANY);
  for (const [, , from] of historyRanges(ctx, recorded, rebuilt)) {
    const series = historyLines(ctx, recorded, rebuilt, from).flatMap(l => [
      { label: `${l.label} (reconstructed)`, color: l.color, points: l.dashed, dashed: true, step: true },
      { label: l.label, color: l.color, points: l.solid },
    ]);
    assert.equal(String(lineChart(ctx, series, { label: 'x' })), String(oldCharts.lineChart(series, { label: 'x' })));
    assert.equal(String(lineChart(ctx, series)), String(oldCharts.lineChart(series)));
  }
});

test('Bananas, as each visitor sees them', { skip }, () => {
  const economy = json('economy.json');
  const signed = Object.entries(economy.players).find(([id, w]) => w.s && fs.existsSync(path.join(dir, `players/${id}-head.json`)));
  const pouch = Object.entries(economy.players).find(([id, w]) => !w.s && w.p > 0 && fs.existsSync(path.join(dir, `players/${id}-head.json`)));
  if (signed) {
    const id = Number(signed[0]);
    const other = Number(pouch?.[0] ?? MANY);
    assert.match(draw(id), /<dt>Wallet<\/dt>/);
    assert.doesNotMatch(draw(id), /id="tip-box"|id="shield"/);
    assert.match(draw(id, { me: id }), /id="shield" aria-pressed="(true|false)"/);
    assert.match(draw(id, { me: other }), /<div class="tip-box" id="tip-box">/);
  }
  if (pouch) {
    const id = Number(pouch[0]);
    const page = draw(id);
    assert.match(page, /waiting in .*’s pouch/);
    assert.match(page, /<button class="link-button" type="button" data-signin>Is this you\? Sign in to collect/);
    assert.doesNotMatch(draw(id, { signInHere: false }), /data-signin/);
  }
});

test('Portuguese: the same profile in the visitor’s language', { skip }, () => {
  const page = draw(MANY, { lang: 'pt' });
  assert.ok(page.includes(PT['Score lists']));
  assert.ok(page.includes(PT['Signature map']));
  assert.ok(!page.includes('>Signature map<'));
  assert.match(page, /<b>4\.º Dan<\/b>|4\.º Dan/);
});
