// node --test web/test/duel.test.mjs
// A duel's own page (/duel/:id), drawn in Node over the core pack (skipped without, as the other view tests are) with
// made-up duels in the exporter's shapes (duel-data.mjs), and the export's own duels when it has some: the scoreboard,
// the facts line, the notices, every round with its reasons, players the site doesn't list, Portuguese; and a duel's
// result in the Activity feed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { duelFile } from '../src/kernel/model.ts';
import { firstData } from '../src/routes.ts';
import { render, title } from '../src/views/duel.ts';
import { eventItem } from '../src/ui/events.ts';
import { voidText } from '../src/ui/duels.ts';
import { PT } from '../../assets/js/core/pt.js';
import { duelData, OFF, MAP } from './duel-data.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

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
let made = null;
const data = () => (made ??= duelData(Array.from({ length: 60 }, (_, i) => coreOf().players.id[i]), coreOf().info.generatedAt[0]));
const nameOf = id => coreOf().players.name.at([...coreOf().players.id].indexOf(id));
/** A duel's page from its file, as entries/duel.ts loads it. */
const pageOf = id => data().block.pages[duelFile(id)];
const draw = (id, { lang = 'en', me = null } = {}) => {
  const file = pageOf(id);
  const view = { core: coreOf(), duel: file.duels[id], maps: file.maps };
  const ctx = ctxFor(lang, { me });
  return { page: String(render(ctx, view)), title: title(ctx, view), ctx };
};
const between = (page, from, to) => {
  const at = page.indexOf(from);
  return at < 0 ? '' : page.slice(at, to ? page.indexOf(to, at + from.length) : undefined);
};
const esc = s => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

test('a duel is drawn by the new client, with the players and its file first', () => {
  assert.deepEqual(firstData('/duel/1234'), { packs: ['packs/core.ptcb'], json: ['duels/12.json'] });
  assert.deepEqual(firstData('/duel/7/'), { packs: ['packs/core.ptcb'], json: ['duels/0.json'] });
  assert.equal(firstData('/duel/abc'), null);
  assert.equal(firstData('/duel'), null);
  assert.equal(firstData('/duel/1/2'), null);
});

test('a ranked duel: the scoreboard, ratings before and after, the facts and the lobby', { skip }, () => {
  const { a } = data();
  const { page, title: name, ctx } = draw(128, { me: a });
  assert.equal(name, `${nameOf(a)} vs Ghost <Duelist>`);
  assert.match(page, /<span class="eyebrow"><a href="\/challenges\/duels">Duels<\/a> · Duel GH128<\/span>/);
  assert.ok(page.includes(`<h1>${esc(nameOf(a))} vs Ghost &lt;Duelist&gt; <span class="legend-tag exp-tag">Experimental</span></h1>`));
  assert.match(page, /<p class="notice exp-note">Duels are new and still being verified; ratings and results may be reset\.<\/p>/);
  // The winner (the visitor) and the player the site doesn't list, with osu!'s avatar and the duel's name.
  const board = between(page, '<section class="duel-board', '</section>');
  assert.match(board, new RegExp(`<div class="duel-board-side duel-winner me">\\s*<a class="duel-board-player" href="/player/${a}">`));
  assert.ok(board.includes('<span class="badge badge-gold">Winner</span>'));
  assert.ok(board.includes(`<a class="duel-board-player" href="/player/${OFF}"><img class="avatar avatar-md" src="https://a.ppy.sh/${OFF}"`));
  assert.ok(board.includes('<span class="">Ghost &lt;Duelist&gt;</span>'));
  assert.ok(board.includes('<span class="duel-board-rating">1,521 → <b>1,534</b> <span class="duel-delta">+13</span></span>'));
  assert.ok(board.includes('<span class="duel-board-rating">1,550 → <b>1,538</b> <span class="duel-delta">−12</span></span>'));
  assert.match(board, /<div class="duel-board-score"><span>4<\/span><span class="duel-dash" aria-label="to">–<\/span><span>2<\/span><\/div>/);
  const facts = between(page, '<p class="duel-facts">', '</p>');
  assert.ok(facts.includes('Ranked · Best of 7'));
  assert.ok(facts.includes('6.12–7.35★'));
  assert.ok(facts.includes('100 🍌 each on it'));
  assert.ok(facts.includes(`<span title="${ctx.fmt.dateTime(pageOf(128).duels[128].end)}">${ctx.fmt.date(pageOf(128).duels[128].end)}</span>`));
  assert.ok(page.includes('<a class="btn" href="https://osu.ppy.sh/community/matches/118000128" target="_blank" rel="noopener">Match on osu!</a>'));
  assert.ok(!page.includes('class="notice">'), 'a finished duel has no notice');
});

test('the rounds: each map and both scores, the round’s winner, and why a round didn’t count', { skip }, () => {
  const { a } = data();
  const { page, ctx } = draw(128);
  const duel = pageOf(128).duels[128];
  const rows = between(page, '<tbody>', '</tbody>').split('<tr class=').slice(1);
  assert.equal(rows.length, duel.rounds.length);
  assert.deepEqual(rows.map(r => Number(r.match(/<td class="col-n faint">(\d+)<\/td>/)[1])), duel.rounds.map(r => r.n));
  assert.deepEqual(rows.map(r => Number(r.match(/href="\/map\/(\d+)"/)[1])), duel.rounds.map(r => r.map));
  assert.match(between(page, '<thead>', '</thead>'), new RegExp(`<th class="num col-p">${esc(nameOf(a)).replace(/[[\]]/g, '\\$&')}</th><th class="num col-p">Ghost &lt;Duelist&gt;</th>`));
  // The map with details: its cover, title and stars; the others say they have none.
  assert.ok(rows[0].includes('<span class="map-title" title="Artist - A &lt;Title&gt;">Artist - A &lt;Title&gt;</span>'));
  assert.ok(rows[0].includes('★ 6.12'));
  assert.ok(rows[1].includes(`Map #${duel.rounds[1].map}`));
  // The winner's score has the tick; accuracy, misses.
  assert.ok(rows[0].includes('<span class="duel-check" aria-hidden="true">✓</span><span class="sr-only">won: </span>900,000'));
  assert.ok(rows[0].includes(`${ctx.fmt.acc(97.46)} · <span class="miss-n">✕2</span>`));
  // Void rounds: the bot's codes in words, anything else as it wrote it.
  const notes = rows.map(r => r.match(/<span class="duel-note">([^<]*)<\/span>/)?.[1] ?? null);
  assert.deepEqual(notes.slice(3, 10), [
    'Didn’t count: Wrong map', 'Didn’t count: Not played in osu!catch', 'Didn’t count: Not scored with ScoreV2',
    'Didn’t count: Mods other than NF', 'Didn’t count: A player didn’t play it', 'Didn’t count: Lobby &lt;crashed&gt;',
    'A tie: nobody scored, and a new map was rolled',
  ]);
  assert.ok(rows.slice(3, 9).every(r => r.startsWith('"duel-void"')));
  // A void round with no scores has none to show; a fail says so; a missing score says so.
  assert.equal((rows[4].match(/no score/g) ?? []).length, 2);
  assert.ok(rows[9].includes(' · <span class="miss-n">failed</span>'));
  assert.ok(rows[12].includes('<span class="faint">no score</span>'));
  assert.equal(voidText(ctx, 'WRONG_map'), 'Wrong map');
});

test('forfeits, an abandoned duel, an unranked one and one with no rounds', { skip }, () => {
  const { a, b, c, d } = data();
  const forfeit = draw(25).page;
  assert.ok(forfeit.includes('Duel #25'), 'no code: the id');
  assert.ok(forfeit.includes(`<p class="notice">${esc(nameOf(a))} forfeited, which counts as a loss.</p>`));
  assert.ok(!forfeit.includes('Match on osu!'), 'no lobby, no button');
  assert.ok(between(forfeit, '<p class="duel-facts">', '</p>').startsWith('<p class="duel-facts">Ranked · Best of 3<span class="sep-dot" aria-hidden="true"> · </span>Forfeit'));
  assert.ok(forfeit.includes(`href="/player/${b}">`));

  const abandoned = draw(26).page;
  assert.match(abandoned, /<section class="duel-board duel-muted" aria-label="Final score">/);
  assert.ok(abandoned.includes('<p class="notice">Abandoned: no round counted for 30 minutes, so it doesn’t count for anyone’s rating and any wager went back.</p>'));
  assert.ok(!abandoned.includes('badge-gold'), 'nobody won');
  assert.ok(!abandoned.includes('duel-board-rating'), 'no rating moved');

  const friendly = draw(27).page;
  assert.ok(friendly.includes(`<p class="notice">${esc(nameOf(d))} forfeited.</p>`));
  assert.ok(between(friendly, '<p class="duel-facts">', '</p>').startsWith('<p class="duel-facts">Unranked<span class="sep-dot"'));
  assert.ok(friendly.includes('<div class="empty">No rounds were played.</div>'));
  assert.ok(friendly.includes(`href="/player/${c}">`));
});

test('Portuguese: the same duel in the visitor’s language', { skip }, () => {
  const { page, title: name, ctx } = draw(128, { lang: 'pt' });
  assert.equal(name, ctx.t('{a} vs {b}', { a: nameOf(data().a), b: 'Ghost <Duelist>' }));
  for (const text of ['Experimental', 'Winner', 'Rounds', 'Match on osu!', 'All duels', 'Wrong map']) assert.ok(page.includes(esc(ctx.t(text))), text);
  assert.ok(page.includes(esc(ctx.t('Ranked|duel'))));
  assert.ok(!page.includes('Didn’t count'), 'no English left');
});

test('the export’s own duels, when it has some: every one in a file draws', { skip }, () => {
  const meta = json('meta.json');
  const files = Object.keys(meta.files).filter(n => /^duels\/\d+\.json$/.test(n));
  if (!files.length) return;
  for (const name of files) {
    const file = json(name);
    for (const [id, duel] of Object.entries(file.duels)) {
      assert.equal(duelFile(Number(id)), name);
      const page = String(render(ctxFor('en'), { core: coreOf(), duel, maps: file.maps }));
      assert.equal((page.match(/<td class="col-n faint">/g) ?? []).length, duel.rounds.length, `duel ${id}`);
    }
  }
});

test('a ranked duel’s result in the Activity feed: the winner, the score, the rating change, a link to it', { skip }, () => {
  const { a, b } = data();
  const ctx = ctxFor('en', { me: b });
  const events = data().block.events;
  assert.ok(events.length > 1);
  const won = events.find(e => e.d === 128);
  const item = String(eventItem(ctx, won, coreOf().players, {}, { tips: true }));
  assert.ok(item.includes('<span class="event-kind">Duel</span>'));
  assert.ok(item.includes(`<a href="/player/${a}"><b class="`) && item.includes(`beat <a href="/player/${OFF}"><b class="">#${OFF}</b></a> 4–2 in a ranked duel`));
  assert.ok(item.includes('<a class="dim-link" href="/duel/128">See the duel</a> · <span class="duel-delta">+13</span> rating'));
  assert.ok(item.includes(`<a class="event-tip small" href="/player/${a}?tip=1"`), 'a duel won is worth a tip');
  const forfeit = String(eventItem(ctx, events.find(e => e.d === 25), coreOf().players, {}));
  assert.ok(forfeit.includes(`won a ranked duel against <a href="/player/${a}">`) && forfeit.includes('who forfeited'));
  const pt = String(eventItem(ctxFor('pt'), won, coreOf().players, {}));
  assert.ok(pt.includes(ctxFor('pt').t('See the duel')));
  assert.equal(MAP, 4242);
});
