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
import { duelData, OFF } from './duel-data.mjs';
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
/** The page's data, as entries/player.ts loads it; `duels` puts a duels slice in the player's file (null: none). */
const dataFor = (id, { full = false, history = null, duels } = {}) => {
  const c = coreOf();
  const file = fileOf(id, { full });
  if (duels !== undefined) file.duels = duels ?? undefined;
  return {
    id, core: c, row: rowOf(c.players, id), file, records: full ? json('records.json') : null,
    bounties: json('bounties.json'), economy: json('economy.json'), history,
  };
};
const draw = (id, { tab, query = {}, full = false, history = null, duels, chartOpen = false, lang = 'en', me = null, signInHere = true } = {}) =>
  String(render(ctxFor(lang, { me }), dataFor(id, { full, history, duels }), readState({ id: String(id), tab }, query, { chartOpen, signInHere })));

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
  assert.deepEqual(firstData('/player/6205809'), { packs: ['packs/core.ptcb'], json: ['players/6205809-head.json', 'bounties.json', 'economy.json'] });
  assert.deepEqual(firstData('/player/6205809/loved/'), { packs: ['packs/core.ptcb'], json: ['players/6205809-head.json', 'bounties.json', 'economy.json'] });
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

test('duels: the rating, the place and the record, the latest duels, and who they’ve played most', { skip }, () => {
  const c = coreOf();
  const ids = Array.from({ length: c.players.rows }, (_, i) => c.players.id[i]).filter(id => fs.existsSync(path.join(dir, `players/${id}-head.json`)));
  const { block, a, b, c: newcomer, d } = duelData(ids.slice(0, 60), c.info.generatedAt[0]);
  const ctx = ctxFor('en');
  const sectionOf = page => page.match(/<section class="section card duels-card">[\s\S]*?\n {2}<\/section>/)?.[0] ?? '';
  const nameOf = id => c.players.name.at(rowOf(c.players, id));
  const esc = s => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  // A rated player with many duels: the standing in one line, five duels and the rest folded, the three most played.
  const mine = block.profiles.get(a);
  const page = draw(a, { duels: mine });
  const card = sectionOf(page);
  assert.ok(page.indexOf('duels-card') > page.indexOf('<header class="profile-head">'));
  assert.ok(page.indexOf('duels-card') < page.indexOf('id="history"'));
  assert.match(card, /<h2 class="card-h">Duels <span class="legend-tag exp-tag">Experimental<\/span><\/h2>/);
  const r = mine.rating;
  const standing = [
    `<span><b class="duel-big">${ctx.fmt.num(r.r)}</b> rating</span>`, `<a href="/challenges/duels">#${r.rank} on the ladder</a>`,
    `${ctx.fmt.plural(r.w, 'win')}, ${ctx.fmt.plural(r.l, 'loss', 'losses')}`, `peak ${ctx.fmt.num(r.peak)}`, ctx.tn(r.streak, '{n} win in a row', '{n} wins in a row'),
  ];
  assert.ok(card.includes(`<p class="duel-standing">${standing.join('<span class="sep-dot" aria-hidden="true"> · </span>')}</p>`));
  const rows = [...card.matchAll(/<a class="row card-link duel-mine ([^"]*)" href="\/duel\/(\d+)">([\s\S]*?)<\/a>/g)];
  assert.deepEqual(rows.map(m => Number(m[2])), mine.recent.map(x => x.id));
  assert.ok(mine.recent.length > 5);
  assert.ok(card.includes(`<details class="duel-more"><summary>Show ${mine.recent.length - 5} more</summary>`));
  assert.equal(card.indexOf(`href="/duel/${mine.recent[5].id}"`) > card.indexOf('<details'), true);
  rows.forEach(([, cls, , row], i) => {
    const x = mine.recent[i];
    assert.equal(cls.trim(), x.res === 'x' ? 'duel-muted' : '');
    assert.ok(row.includes(`<span class="duel-result duel-result-${x.res}">${{ w: 'Won', l: 'Lost', x: 'Abandoned' }[x.res]}</span>`));
    assert.ok(row.includes(`<b>${x.s[0]}–${x.s[1]}</b>`));
    assert.equal(row.includes('· Forfeit'), Boolean(x.ff));
    if (x.d !== undefined) assert.ok(row.includes(`<span title="Rating change"><span class="duel-delta">${x.d > 0 ? '+' : x.d < 0 ? '−' : '±'}${Math.abs(x.d)}</span></span>`));
    else assert.equal(row.includes('<span>Unranked</span>'), !x.ranked);
  });
  // Against someone the site doesn't list: their id.
  assert.ok(card.includes(`vs <span class="">#${OFF}</span>`));
  const most = card.match(/<p class="small muted mt-2">Most played: ([\s\S]*?)<\/p>/)[1];
  assert.deepEqual([...most.matchAll(/<a href="\/player\/(\d+)">/g)].map(m => Number(m[1])), mine.h2h.slice(0, 3).map(h => h[0]));
  assert.ok(most.includes(`${esc(nameOf(b))}</span></a> ${mine.h2h.find(h => h[0] === b)[1]}–${mine.h2h.find(h => h[0] === b)[2]}`));

  // A provisional rating: the tag instead of a place; no peak above it, no streak words for none.
  const prov = sectionOf(draw(newcomer, { duels: block.profiles.get(newcomer) }));
  assert.match(prov, /<p class="duel-standing"><span><b class="duel-big">1,700<\/b> rating<\/span><span class="sep-dot" aria-hidden="true"> · <\/span><button type="button" class="legend-tag" data-tip="Fewer than about five ranked duels/);
  assert.ok(!prov.includes('on the ladder') && !prov.includes('peak'));
  assert.ok(!prov.includes('<details'), 'five or fewer: nothing folded');
  // No ranked duel yet: no rating, the duels still listed.
  const friendly = sectionOf(draw(d, { duels: block.profiles.get(d) }));
  assert.ok(friendly.includes('<p class="small muted">No ranked duels yet, so no rating.</p>'));
  assert.equal(block.profiles.get(d).rating, null);
  assert.ok(friendly.includes('href="/duel/27"'));
  // None at all, or a rating with no duel listed: no section.
  assert.doesNotMatch(draw(a, { duels: null }), /duels-card/);
  assert.doesNotMatch(draw(a, { duels: { rating: r, recent: [], h2h: [] } }), /duels-card/);
  // In Portuguese.
  const pt = ctxFor('pt');
  const ptCard = sectionOf(draw(a, { duels: mine, lang: 'pt' }));
  for (const text of ['Duels', 'Experimental', 'rating']) assert.ok(ptCard.includes(esc(pt.t(text))), text);
  assert.ok(ptCard.includes(esc(pt.t('Show {n} more', { n: pt.fmt.num(mine.recent.length - 5) }))));
  assert.ok(!ptCard.includes('Most played'));
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
