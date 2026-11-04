// node --test web/test/pages.test.mjs
// The players list, the bot's commands and the text pages (glossary, privacy, join, team), drawn in Node in both
// languages. The players list is checked against players.json and the commands against commands.json, from an export
// with packs (PTCATCH_DATA=<folder>, as web/test/packs.test.mjs finds it; skipped without).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { escape } from '../src/kernel/html.ts';
import { firstData } from '../src/routes.ts';
import { manifestsFor, inlineData } from '../edge/inline.ts';
import * as players from '../src/views/players.ts';
import * as commands from '../src/views/commands.ts';
import * as glossary from '../src/views/glossary.ts';
import * as privacy from '../src/views/privacy.ts';
import * as join from '../src/views/join.ts';
import * as team from '../src/views/team.ts';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const noPacks = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;
const noCommands = !fs.existsSync(path.join(dir, 'commands.json')) && `no commands.json in ${dir}`;

const INVITE = 'https://discord.gg/example';
const ctxFor = (lang, now = 1_800_000_000) => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me: null };
};
const en = ctxFor('en');
const pt = ctxFor('pt');
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const core = () => {
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  return readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};
const count = (page, pattern) => [...page.matchAll(pattern)].length;
const h1 = page => page.match(/<h1>([\s\S]*?)<\/h1>/)?.[1];

test('which of these pages the new client draws, and their first data', () => {
  assert.deepEqual(firstData('/players'), { packs: ['packs/core.ptcb'], json: [] });
  assert.deepEqual(firstData('/commands/'), { packs: [], json: ['commands.json'] });
  for (const name of ['glossary', 'privacy', 'join', 'team']) assert.deepEqual(firstData(`/${name}`), { packs: [], json: [] }, name);
  assert.equal(firstData('/players/2'), null);
  assert.equal(firstData('/teams'), null);
  // The edge fetches only what a page needs, and adds nothing to a text page.
  assert.deepEqual(manifestsFor('/players'), { packs: true, meta: false });
  assert.deepEqual(manifestsFor('/commands'), { packs: false, meta: true });
  assert.deepEqual(manifestsFor('/glossary'), { packs: false, meta: false });
  const page = '<html><head></head><body></body></html>';
  const meta = { generatedAt: 5, files: { 'commands.json': 'AbCdEfGh_-', 'players.json': 'x' } };
  assert.equal(inlineData(page, '/team', { packs: null, meta: null }, 'https://data.example/'), page);
  assert.match(inlineData(page, '/commands', { packs: null, meta }, 'https://data.example/'),
    /<link rel="preload" href="https:\/\/data\.example\/commands\.AbCdEfGh_-\.json" as="fetch" crossorigin>\n<script type="application\/json" id="ptc-data">\{"meta":\{"generatedAt":5,"files":\{"commands\.json":"AbCdEfGh_-"\}\}\}<\/script>/);
});

test('the glossary: five sections, the linked entries, and ?at= marking one', () => {
  for (const [ctx, heading] of [[en, 'Glossary'], [pt, PT.Glossary]]) {
    const page = String(glossary.render(ctx, glossary.readState({})));
    assert.equal(h1(page), heading);
    assert.equal(count(page, /<section class="section">/g), 5);
    assert.equal(count(page, /<dl class="glossary">/g), 5);
    assert.equal(count(page, /<div id="g-[a-z]+" class="">/g), 13);
    assert.ok(!page.includes('class="target"'));
    // Badges inside translated sentences stay markup.
    assert.match(page, /<span class="grade grade-X">SS<\/span>/);
    assert.match(page, /<span class="mods"><span class="mod mod-reduce">EZ<\/span><\/span>/);
    assert.match(page, /<a href="\/join">/);
  }
  assert.ok(String(glossary.render(pt, glossary.readState({}))).includes(PT['What the numbers and badges on this site mean, and the words the community uses for them.']));
  const at = String(glossary.render(en, glossary.readState({ at: 'bananas' })));
  assert.match(at, /<div id="g-bananas" class="target"><dt>Bananas<\/dt>/);
  assert.equal(count(at, /class="target"/g), 1);
  // An id nobody has marks nothing.
  assert.ok(!String(glossary.render(en, glossary.readState({ at: '"><script>' }))).includes('class="target"'));
});

test('the privacy page: the buttons for each state, and the Discord link', () => {
  for (const [ctx, heading] of [[en, 'Privacy'], [pt, PT.Privacy]]) {
    const page = String(privacy.render(ctx, { invite: INVITE, block: '' }));
    assert.equal(h1(page), heading);
    assert.equal(count(page, /<section class="section">/g), 4);
    assert.ok(page.includes('<p id="privacy-state">') && page.includes('<b>'), 'the state, with its own markup');
    assert.match(page, /data-act="off"[\s\S]*data-act="erase"/);
    assert.ok(page.includes(`<a href="${INVITE}" target="_blank" rel="noopener">`));
  }
  const acts = block => [...String(privacy.render(en, { invite: INVITE, block })).matchAll(/data-act="(\w+)">([^<]*)</g)].map(m => `${m[1]}:${m[2]}`);
  assert.deepEqual(acts(''), ['off:Stop counting', 'erase:Stop and delete my data']);
  assert.deepEqual(acts('optout'), ['on:Count again']);
  assert.deepEqual(acts('consent'), ['on:Allow counting']);
  for (const block of ['dnt', 'gpc', 'local']) assert.deepEqual(acts(block), [], block);
  assert.ok(String(privacy.render(en, { invite: INVITE, block: 'optout' })).includes('Usage counting is <b>off</b> in this browser'));
  // An unknown state reads as counting, as the old page has it.
  assert.ok(String(privacy.render(en, { invite: INVITE, block: 'new' })).includes('Usage counting is <b>on</b>'));
  const plain = String(privacy.render(en, { invite: '', block: '' }));
  assert.ok(!plain.includes('target="_blank"') && plain.includes('Ask in the Discord.'));
  // What the mount draws after a click: the section again, saying what was done.
  const said = String(privacy.browserSection(pt, 'optout', 'feito'));
  assert.match(said, /<h2>[^<]+<\/h2>[\s\S]*data-act="on"[\s\S]*<p class="muted" role="status">feito<\/p>/);
  assert.ok(said.includes(PT['Count again']));
});

test('how to join: three steps, the questions, and the Discord button only with an invite', () => {
  for (const [ctx, heading] of [[en, 'How to join'], [pt, PT['How to join']]]) {
    const page = String(join.render(ctx, { invite: INVITE }));
    assert.equal(h1(page), heading);
    assert.equal(count(page, /<div class="step">/g), 3);
    assert.equal(count(page, /<h3>/g), 4);
    assert.ok(page.includes(`<a class="btn btn-discord" href="${INVITE}" target="_blank" rel="noopener">`));
    assert.match(page, /<span class="kbd">\/verify<\/span>/);
    assert.match(page, /<a href="\/commands">[^<]+<\/a>[\s\S]*<a href="\/glossary">/);
  }
  assert.ok(!String(join.render(en, { invite: '' })).includes('btn-discord'));
});

test('Team Portugal: the timeline, the top 10 threads and the currency', () => {
  for (const [ctx, heading] of [[en, 'Team Portugal'], [pt, PT['Team Portugal']]]) {
    const page = String(team.render(ctx));
    assert.equal(h1(page), `${heading} <span class="faint" lang="pt-PT">· A Seleção</span>`);
    assert.equal(count(page, /<li>\s*<span class="timeline-year">\d{4}<\/span>/g), 11);
    assert.equal(count(page, /<a href="https:\/\/osu\.ppy\.sh\/community\/forums\/topics\/\d+" target="_blank" rel="noopener">/g), 3);
    assert.match(page, /<h2>Top 10 PT Catch Players<\/h2>/);
    assert.match(page, /<a class="btn btn-small" href="\/challenges">/);
  }
  assert.ok(String(team.render(pt)).includes(PT['A round of 16 against Finland.']));
});

/** The command names and groups the old page shows for commands.json (assets/js/pages/commands.js fromBot()). */
const botGroups = file => file.groups.map(group => ({
  name: group.name,
  moderators: group.commands.every(c => c.access !== 'everyone'),
  commands: group.commands.map(c => [c.slash ?? c.prefix?.[0], (c.options ?? []).map(o => `[${o.name}]`).join(' ')].filter(Boolean).join(' ')),
}));
const sectionsOf = page => [...page.matchAll(/<section class="section">\s*<h2>([^<]*)<\/h2>\s*(<p class="muted small">[^<]*<\/p>)?\s*<div class="cmd-list">([\s\S]*?)<\/div>\s*<\/section>/g)]
  .map(m => ({ name: m[1], note: Boolean(m[2]), commands: [...m[3].matchAll(/<div class="cmd"><code>([^<]*)<\/code>/g)].map(c => c[1]) }));

test('the bot’s commands without commands.json: the hand-written list', () => {
  for (const [ctx, heading] of [[en, 'Bot commands'], [pt, PT['Bot commands']]]) {
    const page = String(commands.render(ctx, { file: null }));
    assert.equal(h1(page), heading);
    const sections = sectionsOf(page);
    assert.equal(sections.length, 7);
    assert.deepEqual(sections.map(s => s.note), [false, false, false, false, false, false, true]);
    assert.equal(sections[0].commands[0], '/rs [player]');
    assert.equal(sections[0].commands[6], '/addscore &lt;link or map id&gt;');
    assert.match(page, /<span class="kbd">&lt;rc<\/span>/);
  }
  assert.equal(sectionsOf(String(commands.render(pt, { file: null })))[0].name, PT.Scores);
  // A file in a shape the page can't read shows the hand-written list too, as the old page did.
  assert.equal(sectionsOf(String(commands.render(en, { file: { groups: [{ name: 'x' }] } }))).length, 7);
});

test('the bot’s commands from commands.json: every group and command, in the bot’s order', { skip: noCommands }, () => {
  const file = json('commands.json');
  const expected = botGroups(file);
  for (const [ctx, tr] of [[en, s => s], [pt, s => (typeof PT[s] === 'string' ? PT[s] : s)]]) {
    const sections = sectionsOf(String(commands.render(ctx, { file })));
    assert.deepEqual(sections.map(s => s.name), expected.map(g => escape(tr(g.name))));
    assert.deepEqual(sections.map(s => s.note), expected.map(g => g.moderators));
    assert.deepEqual(sections.map(s => s.commands), expected.map(g => g.commands.map(escape)));
  }
  // `code` in a description is code; aliases and moderator-only commands are noted.
  const page = String(commands.render(en, { file }));
  const coded = file.groups.flatMap(g => g.commands).find(c => c.description.includes('`'));
  if (coded) assert.ok(page.includes(`<code>${escape(coded.description.split('`')[1])}</code>`));
  const aliased = file.groups.flatMap(g => g.commands).find(c => c.slash && c.prefix?.length);
  if (aliased) assert.ok(page.includes(`<span class="faint">Also ${escape(aliased.prefix.join(' · '))}.</span>`));
});

/** players.json sorted as the old page sorts it (assets/js/pages/players.js SORTS). */
const OLD_SORTS = {
  cv: (a, b) => b.cv - a.cv,
  ul: (a, b) => b.ul - a.ul,
  pp: (a, b) => b.pp - a.pp,
  firsts: (a, b) => (b.firsts.c + b.firsts.u + b.firsts.r) - (a.firsts.c + a.firsts.u + a.firsts.r),
  last: (a, b) => (b.last || 0) - (a.last || 0),
  name: (a, b) => a.name.localeCompare(b.name, 'en'),
};
const cardIds = page => [...page.matchAll(/<a class="card card-link" href="\/player\/(\d+)">/g)].map(m => Number(m[1]));

test('the players: every one, in each sort’s order, as the old page sorts players.json', { skip: noPacks }, () => {
  const pack = core();
  const list = json('players.json');
  assert.equal(pack.players.rows, list.length);
  for (const [sort, compare] of Object.entries(OLD_SORTS)) {
    const expected = [...list].sort(compare).map(p => p.id);
    assert.deepEqual(players.visibleRows(pack, '', sort).map(row => pack.players.id[row]), expected, sort);
    const page = String(players.render(en, pack, players.readState({ sort })));
    assert.deepEqual(cardIds(page), expected.slice(0, players.PAGE_SIZE), `${sort}: the first page`);
    assert.match(page, new RegExp(`<option value="${sort}" selected>`));
  }
  const page = String(players.render(en, pack, players.readState({})));
  assert.equal(h1(page), 'Players');
  assert.match(page, new RegExp(`<p class="result-count" id="count">${list.length} players</p>`));
  assert.ok(page.includes(`All ${list.length} Portuguese players the bot tracks.`));
  // A card's figures, as the old page shows players.json's.
  const top = [...list].sort(OLD_SORTS.cv)[0];
  const card = page.slice(page.indexOf(`href="/player/${top.id}"`)).split('</a>')[0];
  assert.ok(card.includes(`<span class="text-lg fw-600">${escape(top.name)}</span>`));
  assert.deepEqual([...card.matchAll(/<dd>([^<]*)<\/dd>/g)].map(m => m[1]), [top.cv, top.ul, top.pp].map(n => en.fmt.num(n)));
});

test('the players: pages, the search and its empty state', { skip: noPacks }, () => {
  const pack = core();
  const list = json('players.json');
  const byCv = [...list].sort(OLD_SORTS.cv).map(p => p.id);
  const pages = Math.ceil(list.length / players.PAGE_SIZE);
  const second = String(players.render(en, pack, players.readState({ page: '2' })));
  assert.deepEqual(cardIds(second), byCv.slice(players.PAGE_SIZE, 2 * players.PAGE_SIZE));
  if (pages > 1) {
    assert.ok(second.includes(`<span>Page 2 of ${pages}</span>`));
    assert.match(second, /data-page="prev" >/, 'previous enabled');
  }
  // A page past the end shows the last, as paginate() does.
  const past = String(players.render(en, pack, players.readState({ page: '999' })));
  assert.deepEqual(cardIds(past), byCv.slice((pages - 1) * players.PAGE_SIZE));
  assert.deepEqual(cardIds(String(players.render(en, pack, players.readState({ page: 'x', sort: 'nope' })))), byCv.slice(0, players.PAGE_SIZE));

  const needle = list[0].name.slice(1, 3);
  const matches = list.filter(p => p.name.toLowerCase().includes(needle.toLowerCase())).sort(OLD_SORTS.cv);
  const found = String(players.render(en, pack, players.readState({ q: ` ${needle.toUpperCase()} ` })));
  assert.deepEqual(cardIds(found), matches.slice(0, players.PAGE_SIZE).map(p => p.id));
  if (matches.length < list.length) assert.ok(found.includes(`<p class="result-count" id="count">${matches.length} of ${list.length} players</p>`));
  const none = String(players.render(en, pack, players.readState({ q: 'zz no such player zz' })));
  assert.deepEqual(cardIds(none), []);
  assert.ok(none.includes('No player’s name contains “zz no such player zz”.') && none.includes('data-clear'));
  assert.ok(!none.includes('class="pager"'));
});

test('the players in Portuguese', { skip: noPacks }, () => {
  const pack = core();
  const page = String(players.render(pt, pack, players.readState({})));
  assert.equal(h1(page), PT.Players);
  assert.ok(page.includes(`>${PT['Converts pp']}</option>`));
  assert.ok(!page.includes('All ') && !page.includes('Last played'));
});
