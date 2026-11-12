// node --test web/test/packs.test.mjs
// The binary packs the engine writes (ptcatch-engine export --packs) hold the same data as its JSON files: each pack is
// read with the web client's own reader (src/kernel/ptcb.ts, through the generated src/gen/packs.ts) and compared with
// the JSON in the same export folder, value by value. Needs an export with packs: PTCATCH_DATA=<folder>, or data/ when
// it has packs/ (npm run engine:parity makes one); skipped otherwise.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore, readPlayer, readSearch, readYears, GRADES, COLOURS } from '../src/gen/packs.ts';
import { decodeMapsSearch, decodeSearchMaps } from '../../assets/js/core/maps-search.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;
const pack = name => {
  const bytes = fs.readFileSync(path.join(dir, 'packs', name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const hundredths = v => Math.round((v ?? 0) * 100);

test('core: players.json by column, and the three boards', { skip }, () => {
  const core = readCore(pack('core.ptcb'));
  const players = json('players.json');
  const meta = json('meta.json');
  assert.equal(core.info.dump.at(0), meta.dump ?? '');
  assert.equal(core.players.rows, players.length);
  players.forEach((p, i) => {
    const t = core.players;
    assert.equal(t.id[i], p.id);
    assert.equal(t.name.at(i), p.name);
    assert.deepEqual([t.cv[i], t.ul[i], t.pp[i]], [hundredths(p.cv), hundredths(p.ul), hundredths(p.pp)]);
    assert.deepEqual([t.rankC[i], t.rankU[i], t.rankR[i]], [p.rank.c ?? 0, p.rank.u ?? 0, p.rank.r ?? 0]);
    assert.deepEqual([t.global[i], t.country[i]], [p.global ?? 0, p.country ?? 0]);
    assert.equal(t.ppSource[i], !p.inactive ? 0 : { 'last-known': 2, estimated: 3 }[p.ppSource] ?? 1);
    assert.deepEqual([t.acc[i], t.level[i], t.plays[i]], [hundredths(p.acc), hundredths(p.level), p.plays]);
    assert.deepEqual([t.ss[i], t.s[i], t.a[i]], p.grades);
    assert.deepEqual([t.countC[i], t.countU[i], t.countR[i], t.firstsC[i], t.firstsU[i], t.firstsR[i]],
      [p.count.c, p.count.u, p.count.r, p.firsts.c, p.firsts.u, p.firsts.r]);
    assert.equal(t.danScore[i], p.danScore);
    assert.equal(t.dan[i], p.dan.reduce((mask, stage) => mask | (1 << stage), 0) >>> 0);
    assert.equal(t.last[i], p.last ?? 0);
    assert.equal(COLOURS[t.colour[i]], p.nc ?? '');
    assert.deepEqual([t.avatar64.at(i), t.avatar128.at(i)], [meta.files[`avatars/${p.id}-64.webp`] ?? '', meta.files[`avatars/${p.id}-128.webp`] ?? '']);
  });
  for (const [table, key, value] of [['boardC', 'c', 'cv'], ['boardU', 'u', 'ul']]) {
    const order = [...core[table].row].map(row => players[row]);
    assert.deepEqual(order.map(p => p.rank[key]), order.map((_, i) => i + 1), `${table} is the ${value} board in rank order`);
  }
  // The ranked page's board as assets/js/pages/rankings.js draws it from players.json.
  const official = players.filter(p => p.rank.r || (p.inactive && p.pp > 0)).sort((a, b) => b.pp - a.pp || (a.rank.r ?? Infinity) - (b.rank.r ?? Infinity));
  assert.deepEqual([...core.boardR.row].map(row => players[row].id), official.map(p => p.id), 'boardR is the ranked page’s board');
});

test('packs.json: every pack’s hash', { skip }, async () => {
  const { createHash } = await import('node:crypto');
  const manifest = json('packs.json');
  const files = Object.keys(manifest.files);
  assert.ok(files.includes('packs/core.ptcb') && files.includes('packs/search.ptcb'));
  for (const name of files) {
    const digest = createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('base64url').slice(0, 10);
    assert.equal(manifest.files[name], digest, name);
  }
});

/** A pack's score table, row by row, as the JSON tuples it came from. */
function sameScores(table, tuples, { pos = false, label }) {
  assert.equal(table.rows, tuples.length, `${label}: rows`);
  tuples.forEach((t, i) => {
    const at = `${label}[${i}]`;
    assert.equal(table.map[i], t[0], `${at} map`);
    assert.equal(table.pp[i], hundredths(t[1]), `${at} pp`);
    assert.equal(table.acc[i], hundredths(t[2]), `${at} acc`);
    assert.equal(table.combo[i], t[3] ?? 0xffffffff, `${at} combo`);
    assert.equal(table.miss[i], t[4] ?? 0xffffffff, `${at} miss`);
    assert.equal(table.mods[i], t[5], `${at} mods`);
    assert.equal(GRADES[table.grade[i]], t[6] ?? '', `${at} grade`);
    assert.equal(table.score[i], t[7], `${at} score`);
    assert.equal(table.time[i], t[8] ?? 0, `${at} time`);
    assert.equal(table.hits[i], t[9] ?? 0xffffffff, `${at} hits`);
    if (pos) assert.equal(table.pos[i], t[10] ?? 0, `${at} pos`);
    assert.equal(table.sid[i], t[11] ?? 0, `${at} score id`);
  });
}

test('player packs: every list of every player file, and its maps', { skip }, () => {
  const ids = json('players.json').map(p => p.id);
  for (const id of ids) {
    const p = readPlayer(pack(`player/${id}.ptcb`));
    const file = json(`players/${id}.json`);
    for (const cat of ['c', 'u', 'r']) sameScores(p[cat], file.scores[cat], { pos: true, label: `${id} ${cat}` });
    sameScores(p.top, file.top, { label: `${id} top` });
    sameScores(p.ppc, file.pp?.c ?? [], { label: `${id} ppc` });
    sameScores(p.pre, file.pre ?? [], { label: `${id} pre` });
    sameScores(p.dan, file.dan.map(([, t]) => t), { label: `${id} dan` });
    assert.deepEqual([...p.dan.stage], file.dan.map(([stage]) => stage));
    const mapIds = Object.keys(file.maps).map(Number);
    assert.deepEqual([...p.maps.id], mapIds, `${id} maps`);
    mapIds.forEach((mapId, i) => {
      const m = file.maps[mapId];
      if (!m) return;
      const set = p.maps.set[i];
      assert.deepEqual(
        [p.sets.artist.at(set), p.sets.title.at(set), p.maps.version.at(i), p.sets.set[set], p.maps.stars[i], p.maps.maxCombo[i], p.maps.mode[i], p.sets.creator.at(set)],
        [m[0], m[1], m[2], m[3], hundredths(m[4]), m[11], m[13], m[14]], `${id} map ${mapId}`);
      assert.equal(p.maps.ar[i], Math.fround(m[5]), `${id} map ${mapId} ar`);
    });
  }
});

test('search pack: every map of maps-search.json, by set, with search-maps.json’s mappers', { skip }, () => {
  const search = readSearch(pack('search.ptcb'));
  const rows = new Map(decodeMapsSearch(json('maps-search.json')).map(r => [r[0], r]));
  const mappers = new Map(decodeSearchMaps(json('search-maps.json')).map(r => [r[0], r[9]]));
  const { maps, sets, tops } = search;
  assert.equal(maps.rows, rows.size);
  for (let i = 0; i < maps.rows; i++) {
    const r = rows.get(maps.id[i]);
    const set = maps.set[i];
    assert.deepEqual([sets.set[set], sets.artist.at(set), sets.title.at(set), maps.version.at(i), maps.stars[i], ' cur'[maps.cat[i]], maps.players[i], tops.id[maps.top[i]]],
      [r[1], r[2], r[3], r[4], hundredths(r[5]), r[6], r[7], r[8]], `map ${maps.id[i]}`);
    if (mappers.has(maps.id[i])) assert.equal(sets.mapper.at(set), mappers.get(maps.id[i]), `map ${maps.id[i]} mapper`);
    if (i) assert.ok(sets.set[maps.set[i - 1]] < sets.set[set] || (sets.set[maps.set[i - 1]] === sets.set[set] && maps.id[i - 1] < maps.id[i]), 'by set, then id');
  }
});

test('home.json: what the home page shows, as the files it comes from have it', { skip: skip || (!fs.existsSync(path.join(dir, 'packs', 'home.json')) && 'no home.json') }, () => {
  const home = json('packs/home.json');
  const meta = json('meta.json'), activity = json('activity.json'), challenges = json('challenges.json');
  const records = json('records.json'), bounties = json('bounties.json');
  assert.deepEqual(home.totals, meta.totals);
  assert.deepEqual(home.completion, meta.completion ?? null);
  assert.deepEqual(home.hill, meta.hill ?? null);
  assert.deepEqual(home.events, activity.events.slice(0, 5));
  for (const e of home.events) {
    const map = e.s ? e.s[0] : e.m;
    if (map) assert.deepEqual(home.maps[map], activity.maps[map], `event map ${map}`);
  }
  const week = challenges.week;
  assert.deepEqual(home.week, week ? { map: week.map, end: week.end, plays: week.weekly.length, players: week.board.length } : null);
  if (week) assert.deepEqual(home.maps[week.map], challenges.maps[week.map]);
  assert.deepEqual(home.weekly, challenges.weekly ?? null);
  assert.equal(home.throne, records.throne?.held ?? null);
  assert.deepEqual(home.bounties.open, bounties.open ?? []);
  for (const b of home.bounties.open) assert.deepEqual(home.bounties.maps[b[0]], bounties.maps[b[0]]);
});

test('years pack: a board per year ranked, as the players’ files and the map buckets give them', { skip: skip || (!fs.existsSync(path.join(dir, 'packs', 'years.ptcb')) && 'no years pack') }, () => {
  const { years, rows } = readYears(pack('years.ptcb'));
  const players = new Set(json('players.json').map(p => p.id));
  // Each map's status and ranked date, from its bucket (the player files leave the dates out).
  const buckets = new Map();
  const mapMeta = id => {
    const b = id % 128;
    if (!buckets.has(b)) buckets.set(b, json(`maps/${b}.json`));
    return buckets.get(b)[id]?.m;
  };
  const expected = new Map();
  for (const id of players) {
    const file = json(`players/${id}.json`);
    // The converts' best-pp play per map (board play or pp.c) and the ranked board plays.
    const best = new Map();
    for (const t of [...file.scores.c, ...(file.pp?.c ?? []), ...file.scores.r]) {
      const old = best.get(t[0]);
      if (!old || t[1] > old[1] || (t[1] === old[1] && t[7] > old[7])) best.set(t[0], t);
    }
    for (const t of best.values()) {
      const m = mapMeta(t[0]);
      if (!m || !(m[12] === 1 || m[12] === 2) || !m[15] || !(t[1] > 0)) continue;
      const key = `${new Date(m[15] * 1000).getUTCFullYear()}:${id}`;
      (expected.get(key) ?? expected.set(key, []).get(key)).push(t[1]);
    }
  }
  let from = 0;
  const seen = new Set();
  for (let y = 0; y < years.rows; y++) {
    if (y) assert.ok(years.year[y] < years.year[y - 1], 'newest year first');
    assert.equal(years.from[y], from, `${years.year[y]} rows follow on`);
    for (let r = from; r < from + years.players[y]; r++) {
      const id = rows.id[r];
      const at = `${years.year[y]} #${r - from + 1} (${id})`;
      assert.ok(players.has(id), `${at} is a home-country player`);
      if (r > from) assert.ok(rows.pp[r] < rows.pp[r - 1] || (rows.pp[r] === rows.pp[r - 1] && rows.id[r] > rows.id[r - 1]), `${at} best first`);
      const pps = (expected.get(`${years.year[y]}:${id}`) ?? []).sort((a, b) => b - a);
      assert.equal(rows.plays[r], pps.length, `${at} plays`);
      // A ranked catch map counts its best-pp play, which can beat the board's (best score) play the files list.
      const total = pps.reduce((sum, pp, i) => sum + pp * 0.95 ** i, 0);
      assert.ok(rows.pp[r] >= Math.round(total * 100) - 1, `${at} pp ${rows.pp[r]} ≥ ${total}`);
      seen.add(`${years.year[y]}:${id}`);
    }
    from += years.players[y];
  }
  assert.equal(rows.rows, from);
  assert.deepEqual([...expected.keys()].filter(k => !seen.has(k)), [], 'everyone with a counted play is on that year’s board');
});
