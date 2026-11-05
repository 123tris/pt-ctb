// node --test web/test/shop-recap.test.mjs
// The shop and the yearly recap, drawn in Node from an export (the core pack, the player packs and the JSON; the data
// tests skip without one, as web/test/packs.test.mjs finds it). The recap reads a player's pack where the old page
// read their whole file: each year it sums up is checked against the same sums over that file. The shop is checked
// against economy.json and the head files, and its repeat-buy rules on their own.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore, readPlayer } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { S, M, CATS, isSS, modString } from '../src/kernel/model.ts';
import { rowOf } from '../src/ui/players.ts';
import { mapDetails } from '../src/ui/playerpack.ts';
import { bananas } from '../src/ui/bananas.ts';
import { firstData } from '../src/routes.ts';
import * as recap from '../src/views/recap.ts';
import * as shop from '../src/views/shop.ts';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;

const buffer = file => { const b = fs.readFileSync(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
let core = null;
const coreOf = () => (core ??= readCore(buffer(path.join(dir, 'packs', 'core.ptcb'))));
const packOf = id => readPlayer(buffer(path.join(dir, 'packs', 'player', `${id}.ptcb`)));
const NOW = 1_793_800_000;
const ctxFor = (lang, { me = null, now = NOW } = {}) => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me };
};
const en = ctxFor('en');
const pt = ctxFor('pt');

/** Players whose recaps differ: the most plays, Dan passes, few plays, loved maps, maps without details. */
const IDS = [6205809, 3821475, 2600197, 10055003, 29380292, 13294871, 10816573, 11357800];

test('first data: the shop’s players and wallets, a recap’s players and pack', () => {
  assert.deepEqual(firstData('/shop'), { packs: ['packs/core.ptcb'], json: ['economy.json'] });
  assert.deepEqual(firstData('/recap/3821475'), { packs: ['packs/core.ptcb', 'packs/player/3821475.ptcb'], json: [] });
  assert.deepEqual(firstData('/recap/3821475/2021/'), { packs: ['packs/core.ptcb', 'packs/player/3821475.ptcb'], json: [] });
  assert.deepEqual(firstData('/recap/3821475/latest'), { packs: ['packs/core.ptcb', 'packs/player/3821475.ptcb'], json: [] });
  assert.equal(firstData('/recap'), null);
  assert.equal(firstData('/recap/abc'), null);
  assert.equal(firstData('/shop/colour'), null);
});

/** The old page's sums over a player's whole file (assets/js/pages/wrapped.js summarise()), to check the pack's by. */
function summariseFile(file, year) {
  const inYear = s => new Date(s[S.TIME] * 1000).getFullYear() === year;
  const plays = CATS.flatMap(cat => file.scores[cat].filter(inYear).map(s => ({ cat, s, meta: file.maps[s[S.MAP]] })));
  const mostCommon = values => {
    const counts = new Map();
    for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0] ?? null;
  };
  const months = Array(12).fill(0), weekdays = Array(7).fill(0);
  for (const { s } of plays) { const d = new Date(s[S.TIME] * 1000); months[d.getMonth()]++; weekdays[d.getDay()]++; }
  const titled = plays.filter(p => p.meta && p.meta[M.TITLE]);
  const best = cat => plays.filter(p => p.cat === cat).sort((a, b) => b.s[S.PP] - a.s[S.PP])[0] ?? null;
  return {
    plays,
    perCat: Object.fromEntries(CATS.map(cat => [cat, plays.filter(p => p.cat === cat).length])),
    fruits: plays.reduce((n, p) => n + p.s[S.HITS], 0),
    ss: plays.filter(p => isSS(p.s[S.GRADE])).length,
    fc: plays.filter(p => p.s[S.MISS] === 0).length,
    oneMiss: plays.filter(p => p.s[S.MISS] === 1).length,
    firsts: plays.filter(p => p.s[S.POS] === 1),
    best: Object.fromEntries(CATS.map(cat => [cat, best(cat)])),
    mods: mostCommon(plays.map(p => modString(p.s[S.MODS]))),
    mapper: mostCommon(titled.map(p => p.meta[M.CREATOR])),
    artist: mostCommon(titled.map(p => p.meta[M.ARTIST])),
    hardest: titled.filter(p => !(p.s[S.MODS] & (2 | 256))).sort((a, b) => b.meta[M.STARS] - a.meta[M.STARS])[0] ?? null,
    months,
    weekday: weekdays.indexOf(Math.max(...weekdays)),
    dan: file.dan.filter(([, s]) => inYear(s)).map(([stage]) => stage),
  };
}

/** A play with every field there: a file's leaves out a score id it doesn't know, the pack's has it as null. */
const tuple = s => (s ? Array.from({ length: S.ID + 1 }, (_, i) => s[i] ?? null) : null);

test('recap: each year summed up from the player’s pack, as from their whole file', { skip }, () => {
  let years = 0;
  for (const id of IDS) {
    const pack = packOf(id), file = json(`players/${id}.json`);
    const fileYears = [...new Set(CATS.flatMap(c => file.scores[c].map(s => new Date(s[S.TIME] * 1000).getFullYear())))].sort((a, b) => b - a);
    assert.deepEqual(recap.yearsOf(pack), fileYears, `${id} years`);
    for (const year of fileYears) {
      years++;
      const got = recap.summarise(pack, year), want = summariseFile(file, year);
      const label = `${id} ${year}`;
      assert.deepEqual(got.plays.map(p => [p.cat, ...tuple(p.s)]), want.plays.map(p => [p.cat, ...tuple(p.s)]), `${label} plays`);
      assert.deepEqual(got.plays.map(p => p.meta?.[M.TITLE] ?? null), want.plays.map(p => p.meta?.[M.TITLE] ?? null), `${label} maps`);
      for (const key of ['perCat', 'fruits', 'ss', 'fc', 'oneMiss', 'mods', 'mapper', 'artist', 'months', 'weekday', 'dan']) assert.deepEqual(got[key], want[key], `${label} ${key}`);
      assert.equal(got.firsts.length, want.firsts.length, `${label} #1s`);
      for (const cat of CATS) assert.deepEqual(tuple(got.best[cat]?.s), tuple(want.best[cat]?.s), `${label} best ${cat}`);
      assert.deepEqual(tuple(got.hardest?.s), tuple(want.hardest?.s), `${label} hardest`);
      assert.equal(got.hardest?.meta[M.STARS] ?? null, want.hardest?.meta[M.STARS] ?? null, `${label} hardest stars`);
    }
  }
  assert.ok(years > 30, `${years} years checked`);
});

test('recap: a map without details in the file has none from the pack either', { skip }, () => {
  let none = 0;
  for (const { id } of json('players.json')) {
    const pack = packOf(id), file = json(`players/${id}.json`);
    for (const [map, meta] of Object.entries(file.maps)) {
      if (!meta) none++;
      assert.equal(mapDetails(pack, Number(map)) === null, meta === null, `${id} map ${map}`);
    }
  }
  assert.ok(none > 0, 'the data has maps without details');
});

test('recap: the page, every year of a few players, in both languages', { skip }, () => {
  const players = coreOf().players;
  for (const id of IDS) {
    const row = rowOf(players, id);
    const pack = packOf(id);
    const name = players.name.at(row);
    const years = recap.yearsOf(pack);
    for (const asked of [undefined, ...years, 1999]) {
      const data = { id, core: coreOf(), row, ...recap.recapOf(pack, asked === undefined ? undefined : String(asked)) };
      const year = years.includes(asked) ? asked : years[0];
      assert.equal(data.year, year, `${id} ${asked}: the year shown`);
      const w = data.recap;
      for (const ctx of [en, pt]) {
        const page = String(recap.render(ctx, data));
        assert.equal(recap.title(ctx, data), ctx.t('{name} in {year}', { name, year }));
        assert.ok(page.includes(`<h1>${ctx.t('{name}’s {year}', { name, year }).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</h1>`), `${id} ${year} heading`);
        // A chip per year, the one shown marked.
        assert.deepEqual([...page.matchAll(/<a class="chip ([a-z]*)" href="\/recap\/(\d+)\/(\d+)">/g)].map(m => [m[1], Number(m[2]), Number(m[3])]),
          years.map(y => [y === year ? 'active' : '', id, y]), `${id} ${year} chips`);
        assert.ok(page.includes(`<div class="big">${ctx.fmt.plural(w.plays.length, 'score')}</div>`), `${id} ${year} scores`);
        assert.ok(page.includes(`<div class="big">${ctx.fmt.num(w.fruits)}</div>`), `${id} ${year} fruits`);
        const top = recap.playOfTheYear(w);
        assert.equal(page.includes(ctx.t('Play of the year')), Boolean(top));
        if (top) assert.ok(page.includes(`<div class="mt-2 mb-3 big">${ctx.fmt.pp(top.s[S.PP])} pp</div>`), `${id} ${year} play of the year`);
        if (w.hardest) assert.ok(page.includes(`★ ${ctx.fmt.num(w.hardest.meta[M.STARS], 2)}</div>`), `${id} ${year} hardest`);
        assert.equal(page.includes(ctx.t('Dan course')), w.dan.length > 0);
        assert.equal((page.match(/<rect class="bar"/g) ?? []).length, 12, 'a bar a month');
        // What "Copy recap" copies: four lines, or three without a play of the year.
        const copied = recap.shareText(ctx, w, year, `https://ptcatch.com/recap/${id}`).split('\n');
        assert.equal(copied.length, top ? 4 : 3);
        assert.equal(copied.at(-1), `https://ptcatch.com/recap/${id}`);
      }
    }
  }
});

test('recap: a player with no plays', { skip }, () => {
  const players = coreOf().players;
  const row = rowOf(players, IDS[0]);
  const empty = { rows: 0, map: new Uint32Array(0), time: new Uint32Array(0), stage: new Uint8Array(0) };
  const pack = { c: empty, u: empty, r: empty, dan: empty };
  const data = { id: IDS[0], core: coreOf(), row, ...recap.recapOf(pack, '2024') };
  assert.deepEqual([data.years, data.year, data.recap], [[], null, null]);
  assert.equal(String(recap.render(en, data)), `<div class="empty">${en.t('{name} has no recorded plays yet.', { name: players.name.at(row) })}</div>`);
  assert.equal(recap.title(pt, data), pt.t('{name} in {year}', { name: players.name.at(row), year: '' }));
});

/** The shop's view data for a visitor (`me`), with a wallet that can be set. */
const shopData = (me, wallet, { head = true, signInHere = false } = {}) => {
  const economy = json('economy.json');
  if (wallet === null) delete economy.players[me];
  else if (wallet) economy.players[me] = wallet;
  return { core: coreOf(), economy, head: me && head ? json(`players/${me}-head.json`) : null, signInHere };
};
const ITEMS = ['title', 'signature', 'colour', 'role', 'motw', 'wildcard'];
const wallet = w => ({ b: 0, p: 0, e: 0, x: 0, s: 1, sh: 0, t: null, w: 0, sg: null, c: null, cu: null, ro: null, ru: null, ...w });
const itemsOf = page => [...page.matchAll(/<div class="shop-item" data-item="(\w+)">/g)].map(m => m[1]);

test('shop: signed out, every item with its price, cheapest first in each group', { skip }, () => {
  for (const ctx of [en, pt]) {
    for (const signInHere of [false, true]) {
      const page = String(shop.render(ctx, shopData(null, undefined, { signInHere })));
      assert.deepEqual(itemsOf(page), ['role', 'signature', 'title', 'colour', 'motw', 'wildcard']);
      for (const s of shop.shopItems(ctx)) assert.ok(page.includes(`>${shop.priceText(ctx, s)}</span>`), s.item);
      assert.ok(page.includes(ctx.t('Sign in with osu! to buy. You can look around first.')));
      assert.equal(page.includes('data-signin'), signInHere);
      // No panel open, and the gate shows signed out too (the colour, the role and the wildcard).
      assert.equal((page.match(/ hidden>/g) ?? []).length, 6);
      assert.equal((page.match(/<span class="shop-tag">/g) ?? []).length, 3);
    }
  }
  assert.ok(String(shop.render(en, { ...shopData(null), economy: null })).includes(en.t('Bananas haven’t started yet. The shop opens with them.')));
});

test('shop: signed in, the wallet from economy.json and the picks from the head file', { skip }, () => {
  const economy = json('economy.json');
  for (const [id, w] of Object.entries(economy.players).filter(([, w]) => w.b > 0)) {
    const me = Number(id);
    const ctx = ctxFor('en', { me });
    const data = shopData(me);
    const page = String(shop.render(ctx, data));
    assert.ok(page.includes(`<p>Your wallet: <b>${bananas(ctx, w.b)}</b> <a class="small" href="/player/${me}">`), `${me} wallet`);
    const head = json(`players/${me}-head.json`);
    const you = shop.you(ctx, data, shop.START);
    assert.equal(you.free, w.b);
    assert.deepEqual(you.titles.map(([name]) => name), (head.extras?.badges ?? []).map(b => b.name));
    // The 30 best plays by pp, one per map.
    const best = CATS.flatMap(c => head.scores[c]).sort((a, b) => b[S.PP] - a[S.PP]);
    const maps = [...new Set(best.map(s => s[S.MAP]))].slice(0, 30);
    assert.deepEqual(you.plays.map(([map]) => map), maps, `${me} plays`);
    // Each item's panel: the choice to make when it can be bought, the reason when not.
    for (const item of ITEMS) {
      const open = String(shop.render(ctx, data, { ...shop.START, open: item }));
      const s = shop.shopItems(ctx).find(x => x.item === item);
      const st = shop.standing(ctx, s, you);
      assert.ok(open.includes(`aria-expanded="true" aria-controls="panel-${item}"`));
      assert.equal(open.includes(`<div class="shop-step" data-step="pick">`), st.why === null, `${me} ${item}`);
      if (st.why === null && item === 'title') assert.equal((open.match(/<option /g) ?? []).length, you.titles.length);
      if (st.why === null && item === 'signature') assert.equal((open.match(/<option /g) ?? []).length, you.plays.length);
    }
  }
});

test('shop: where each item stands', { skip }, () => {
  const me = 6205809;
  const ctx = ctxFor('en', { me });
  const items = Object.fromEntries(shop.shopItems(ctx).map(s => [s.item, s]));
  const stand = (w, requests = [], options) => {
    const data = shopData(me, w, options);
    const pending = requests.filter(r => r.status === 'pending' && r.type === 'shop.buy').reduce((n, r) => n + items[r.payload.item].price * (r.payload.periods ?? 1), 0);
    const you = shop.you(ctx, data, { ...shop.START, requests, pending });
    return Object.fromEntries(ITEMS.map(item => [item, shop.standing(ctx, items[item], you)]));
  };
  // No wallet: nothing can be bought, and it says why.
  for (const st of Object.values(stand(null))) assert.equal(st.why, ctx.t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.'));
  // Rich, but behind the gate for the colour, the role and the wildcard.
  let st = stand(wallet({ b: 5000, e: 999 }));
  assert.deepEqual(ITEMS.map(i => st[i].why === null), [true, true, false, false, true, false]);
  assert.equal(st.colour.tag, ctx.t('Needs {gate} earned', { gate: '1,000' }));
  // Short: what's waiting for the bot comes off the wallet.
  st = stand(wallet({ b: 900, e: 2000 }), [{ type: 'shop.buy', payload: { item: 'colour', arg: 'mint', periods: 1 }, status: 'pending', t: new Date((NOW - 60) * 1000).toISOString() }]);
  assert.equal(st.colour.tag, ctx.t('Waiting for the bot'));
  assert.equal(st.signature.why, null);
  assert.equal(st.title.tag, '100 🍌 short');
  assert.equal(st.title.why, 'You need 100 🍌 more: your wallet has 900 🍌, and 500 🍌 of it is waiting for the bot.');
  // Owned: a title, a pinned play, a colour with days left, a role from an accepted request.
  st = stand(wallet({ b: 5000, e: 2000, t: 'WYSI', sg: 3060860, c: 'mint', cu: NOW + 10 * 86400 - 60 }),
    [{ type: 'shop.buy', payload: { item: 'role', arg: 'lilac', periods: 1 }, status: 'accepted', t: new Date((NOW - 2 * 86400) * 1000).toISOString() }]);
  assert.deepEqual([st.title.tag, st.title.owned], [ctx.t('Yours'), ctx.t('Yours now: {title}.', { title: 'WYSI' })]);
  assert.deepEqual([st.signature.tag, st.signature.owned], [ctx.t('Yours'), ctx.t('You have a play pinned. A new one replaces it.')]);
  assert.deepEqual([st.colour.tag, st.colour.owned], [ctx.t('In use'), 'In use: Mint, 10 days left.']);
  assert.deepEqual([st.role.tag, st.role.owned, st.role.cur[0]], [ctx.t('In use'), 'In use: Lilac, 5 days left.', 'lilac']);
  // No head file: nothing to show or pin.
  st = stand(wallet({ b: 5000, e: 2000 }), [], { head: false });
  assert.equal(st.title.why, ctx.t('You have no titles or badges to show yet. Badges come from your plays; titles from King of the hill.'));
  assert.equal(st.signature.why, ctx.t('The site has no plays of yours to pin yet.'));
});

test('shop: the repeat-buy rule (bananas-contract.md §6)', () => {
  const ctx = en;
  const DAY = 86400;
  const items = Object.fromEntries(shop.shopItems(ctx).map(s => [s.item, s]));
  const w = wallet({ b: 5000, e: 2000, t: 'WYSI', sg: 123, c: 'mint', cu: NOW + 10 * DAY });
  const cur = shop.currentTimed(items.colour, w, [], NOW);
  assert.deepEqual(cur, ['mint', NOW + 10 * DAY]);
  // The same colour adds days from the current end; another switches and keeps the time left; none starts now.
  assert.equal(shop.effectOf(ctx, items.colour, 'mint', w, cur, NOW, 2).text, `Adds 60 days: in use until ${ctx.fmt.date(NOW + 70 * DAY)}.`);
  assert.equal(shop.effectOf(ctx, items.colour, 'sky', w, cur, NOW).text, `Switches from Mint to Sky, keeping the time left and adding 30 days: in use until ${ctx.fmt.date(NOW + 40 * DAY)}.`);
  assert.equal(shop.effectOf(ctx, items.role, 'gold', w, null, NOW, 4).text, `In use until ${ctx.fmt.date(NOW + 28 * DAY)}.`);
  // An expired role from the wallet isn't current; an accepted one without roleUntil runs from when it was decided.
  assert.equal(shop.currentTimed(items.role, { ...w, ro: 'sky', ru: NOW - 1 }, [], NOW), null);
  const accepted = [{ type: 'shop.buy', payload: { item: 'role', arg: 'sand' }, status: 'accepted', t: new Date((NOW - 9 * DAY) * 1000).toISOString(), decided: new Date((NOW - 3 * DAY) * 1000).toISOString() }];
  assert.deepEqual(shop.currentTimed(items.role, w, accepted, NOW), ['sand', NOW + 4 * DAY]);
  // The title or play you have can't be bought again (whatever the case); another replaces it.
  assert.deepEqual(shop.effectOf(ctx, items.title, 'wysi', w, null, NOW), { text: 'Already yours.', blocked: true });
  assert.deepEqual(shop.effectOf(ctx, items.title, 'TrisAcc', w, null, NOW), { text: 'Replaces WYSI.' });
  assert.deepEqual(shop.effectOf(ctx, items.signature, 123, w, null, NOW), { text: 'That play is already pinned.', blocked: true });
  assert.deepEqual(shop.effectOf(ctx, items.signature, 456, w, null, NOW), { text: 'Replaces the play you have pinned now.' });
  assert.deepEqual(shop.effectOf(ctx, items.motw, 1, w, null, NOW), { text: '' });
  // The confirmation: the price for the periods picked, and the wallet after.
  const colour = shop.shopItems(pt).find(s => s.item === 'colour');
  const confirm = String(shop.confirmStep(pt, colour, 'Menta', 'Adds…', 1000, 2, 1200));
  assert.ok(confirm.includes(`<b>${colour.name}, ${pt.tn(2, '{n} month', '{n} months')}</b> (Menta) `));
  assert.ok(confirm.includes(pt.t('Your wallet goes from {balance} to {after}. Bananas spent in the shop are burned: they don’t come back.', { balance: bananas(pt, 1200), after: bananas(pt, 200) })));
});
