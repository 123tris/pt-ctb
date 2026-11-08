// Link previews: what Discord (and any other site that unfurls links) shows for a page of the site. Crawlers don't run
// the site's code, so functions/[[path]].js writes each page's title, description and picture into index.html's <head>
// before sending it. Every page gets its own text; a player, map, recap or comparison names who or what it's about,
// read from the public data (fetched only for crawlers, so visitors' page loads never wait on it).
//
// No DOM and no Node APIs: used by the Function (Workers runtime), tools/serve.mjs and embed/embed.test.mjs.

import { matchPage, unmoved } from '../assets/js/core/routes.js';
import { hashedName } from '../assets/js/core/data-name.js';
import { duelFile } from '../assets/js/core/model.js';

export const SITE = 'PT Catch';
export const HOME_DESCRIPTION = 'Portugal’s osu!catch community: leaderboards, player profiles, the Dan course, weekly challenges and games.';

const BOARDS = {
  converts: ['Converts leaderboard', 'Portugal’s osu!catch leaderboard for converts: osu!standard maps played in catch mode, weighted the way osu! does it.'],
  loved: ['Loved & Unranked leaderboard', 'Portugal’s osu!catch leaderboard for loved, pending and graveyarded maps, with pp from the current formula.'],
  ranked: ['Ranked (official) leaderboard', 'Portugal’s official osu!catch leaderboard, from each player’s osu! profile.'],
  mods: ['By mods leaderboard', 'Portugal’s osu!catch players ranked by the pp of their plays with one mod: HD, HR, DT and more.'],
  plays: ['Top plays', 'Portugal’s best single osu!catch plays, most pp first, with mod filters.'],
  kings: ['Star kings leaderboard', 'The Portuguese osu!catch players holding the most #1s in each star range.'],
};

const CHALLENGES = {
  week: ['Challenges', 'Map of the week, king of the hill, the Dan course, snipe targets, bounties and the completion goal for Portugal’s osu!catch players.'],
  hill: ['King of the hill · Challenges', 'A pool of osu!catch maps each month, one per mod slot, in an Open and a Challenger tier. Hold a map’s best play when the month ends to keep its crown.'],
  duels: ['Duels · Challenges', 'Rated 1v1 osu!catch duels between Portuguese players, played in osu! lobbies: the ladder, the duels being played and the latest results.'],
  dan: ['Dan course · Challenges', 'Portugal’s osu!catch Dan course: stages of maps to pass in order, each harder than the last.'],
  targets: ['Snipe targets · Challenges', '#1s that are begging to be sniped, maps with a single Portuguese player, and maps nobody in Portugal has played yet.'],
  bounties: ['Bounties · Challenges', 'Prizes Portugal’s osu!catch community puts up for hard maps: full combo one, pass it first or take its #1.'],
  completion: ['Completion · Challenges', 'Every ranked osu!catch-specific difficulty, and how many of them Portuguese players have passed so far.'],
};

const GAMES = {
  '': ['Games', 'osu!catch games: name the map from its blurred cover, higher or lower, and a quiz.'],
  guess: ['Guess the map', 'Name the osu!catch map from its blurred cover: one map a day with three tries, or ten rounds of practice.'],
  daily: ['Guess the map', 'Name the osu!catch map from its blurred cover: one map a day with three tries, or ten rounds of practice.'],
  'higher-lower': ['Higher or lower?', 'Which osu!catch map has more stars, more plays or a longer drain? Keep the streak going.'],
  quiz: ['Quiz', 'An osu!catch quiz: name the difficulty from the cover and the stars.'],
};

// Pages with one text each: [title, description]. Titles match the page's own (setTitle in its module).
const PAGES = {
  '': [`${SITE} · osu!catch in Portugal`, HOME_DESCRIPTION],
  players: ['Players', 'Every Portuguese osu!catch player the site tracks, with their ranks, pp and accuracy.'],
  maps: ['Maps', 'Every osu!catch map Portuguese players have scores on, with stars, plays and who holds the #1.'],
  activity: ['Activity', 'The latest plays, new #1s and snipes from Portugal’s osu!catch players.'],
  calculator: ['Calculator', 'Pick a player and a leaderboard and see how far a new osu!catch play would take them.'],
  compare: ['Compare', 'Put two Portuguese osu!catch players side by side: pp, ranks, shared maps and who wins them.'],
  records: ['Records', 'Portugal’s osu!catch records: the longest-held #1s, the most 1-miss plays, the bananas going around and more.'],
  shop: ['Shop', 'What bananas buy on PT Catch: earned by playing osu!catch, spent on bounties, tips and the shop.'],
  admin: ['Admin', 'The PT Catch bot’s settings and tools, for its admins.'],
  commands: ['Bot commands', 'Everything the PT Catch Discord bot can do, command by command.'],
  join: ['How to join', 'How to join Portugal’s osu!catch community on Discord and verify your osu! account.'],
  team: ['Team Portugal', 'Portugal’s osu!catch team: the yearly top 10 lists, the Catch World Cup and the history behind them.'],
  glossary: ['Glossary', 'What the words on PT Catch mean: pp, converts, crowns, snipes, bananas and the rest.'],
  privacy: ['Privacy', 'What PT Catch counts about visits, what it never records, and how to see or delete it.'],
  recap: ['Recap', 'A Portuguese osu!catch player’s year in plays, #1s and milestones.'],
  duel: ['Duel', 'A rated 1v1 osu!catch duel between two Portuguese players, round by round.'],
};

// The Top 10 of the year (/top10, /top10/<view>, /top10/<year>, the new web client's pages): the bot's announcement
// links /top10, so it gets its own preview rather than the home page's.
const TOP10 = {
  '': ['Top 10 of the year', 'Portugal’s osu!catch community ranks the year’s 10 best players: lists and write-ups all December, the reveal on 2 January.'],
  vote: ['Your ballot · Top 10 of the year', 'Rank your top 10 Portuguese osu!catch players of the year, and say why each one made your list.'],
  ballots: ['Ballots · Top 10 of the year', 'Every Top 10 list sent in so far, with what each voter wrote about the players on it.'],
  plays: ['Plays of the year · Top 10', 'The year’s standout osu!catch plays by Portuguese players, picked by the community, with replays and clips.'],
  dossier: ['Dossier · Top 10 of the year', 'A Portuguese osu!catch player’s year in numbers, for the Top 10 vote: plays, #1s, Dan passes and more.'],
};
/** An edition's name from its year key: 2024 is the one "2023–24" edition (§13.10). */
const top10Label = year => (year === 2024 ? '2023–24' : String(year));

/** The Top 10's preview, or null when the address isn't one of its pages. */
function top10Page(path, pair) {
  const [section, view = '', ...rest] = path.split('/');
  if (section !== 'top10' || rest.length > 2) return null;
  if (/^\d{4}$/.test(view)) {
    const label = top10Label(Number(view));
    return pair([`Top 10 of ${label}`, `Portugal’s osu!catch Top 10 of ${label}: who the community ranked, the scores, and what the voters wrote.`]);
  }
  return TOP10[view] ? pair(TOP10[view]) : null;
}

/**
 * A page's preview from its address alone: { title, description, kind?, id?, a?, b?, year? } or null for an address
 * that is no page. `kind` asks for data to name what the page is about (see withData).
 */
export function describe(pathname) {
  let path = String(pathname).replace(/^\/+/, '').replace(/\/+$/, '');
  path = unmoved(path);
  const pair = ([title, description]) => ({ title: title.includes(SITE) ? title : `${title} · ${SITE}`, description });
  // Before the route table: the Top 10's pages are the new client's, and assets/js/core/routes.js may not list them yet.
  if (path === 'top10' || path.startsWith('top10/')) return top10Page(path, pair);
  const found = matchPage(path);
  if (!found) return null;
  const { pattern, params } = found;
  const section = pattern.split('/')[0];
  const isId = v => /^\d{1,10}$/.test(v ?? '');

  if (section === 'rankings') return pair(BOARDS[params.board] ?? BOARDS.converts);
  if (section === 'challenges') return pair(CHALLENGES[params.tab] ?? CHALLENGES.week);
  if (section === 'games') return pair(GAMES[params.game ?? ''] ?? GAMES['']);
  if (section === 'player') {
    return { ...pair(['Player', 'A Portuguese osu!catch player’s profile: ranks, pp, best plays and #1s.']), ...(isId(params.id) && { kind: 'player', id: Number(params.id) }) };
  }
  if (section === 'map') {
    return { ...pair(['Map', 'An osu!catch map’s Portuguese leaderboard.']), ...(isId(params.id) && { kind: 'map', id: Number(params.id) }) };
  }
  if (section === 'recap') {
    return { ...pair(PAGES.recap), ...(isId(params.id) && { kind: 'recap', id: Number(params.id), year: isId(params.year) ? Number(params.year) : null }) };
  }
  if (section === 'duel') {
    return { ...pair(PAGES.duel), ...(isId(params.id) && Number(params.id) > 0 && { kind: 'duel', id: Number(params.id) }) };
  }
  if (section === 'compare') {
    return { ...pair(PAGES.compare), ...(isId(params.a) && { kind: 'compare', a: Number(params.a), b: isId(params.b) ? Number(params.b) : null }) };
  }
  return pair(PAGES[section] ?? PAGES['']);
}

const num = (n, digits = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const avatarUrl = id => `https://a.ppy.sh/${id}`;

/** A player's line: "#4 in Portugal and #976 in the world · 9,116 pp · 99.43% accuracy · 31,926 plays". */
function playerLine(p) {
  const rank = p.country ? `#${num(p.country)} in Portugal${p.global ? ` and #${num(p.global)} in the world` : ''}` : '';
  return [rank, p.pp ? `${num(p.pp)} pp` : '', p.acc ? `${num(p.acc, 2)}% accuracy` : '', p.plays ? `${num(p.plays)} plays` : '']
    .filter(Boolean).join(' · ');
}

/**
 * The preview with what the data says about its subject. `data` has what was fetched for `embed.kind`:
 * `players` (players.json's list), for a map `map` (its entry in maps/<id % 128>.json) and for a duel `duel` (its
 * entry in duels/<n>.json). Missing data leaves the address-only text.
 */
export function withData(embed, { players = null, map = null, duel = null } = {}) {
  if (!embed?.kind) return embed;
  const byId = new Map((Array.isArray(players) ? players : []).map(p => [p.id, p]));
  const out = { ...embed };
  if (embed.kind === 'player' || embed.kind === 'recap') {
    const p = byId.get(embed.id);
    if (!p) return out;
    out.image = avatarUrl(p.id);
    if (embed.kind === 'player') {
      out.title = `${p.name} · ${SITE}`;
      out.description = `${p.name}’s osu!catch profile: ${playerLine(p)}.`.replace(': .', '.');
    } else {
      const year = embed.year ?? '';
      out.title = `${p.name}${year ? ` in ${year}` : '’s recap'} · ${SITE}`;
      out.description = `${p.name}’s ${year || 'year'} in osu!catch: plays, #1s and milestones.`;
    }
  }
  if (embed.kind === 'compare') {
    const a = byId.get(embed.a);
    const b = embed.b ? byId.get(embed.b) : null;
    if (a && b) {
      out.title = `${a.name} vs ${b.name} · ${SITE}`;
      out.description = `${a.name} and ${b.name} side by side: ${num(a.pp)} pp against ${num(b.pp)} pp, their ranks, shared maps and who wins them.`;
    } else if (a) {
      out.title = `Compare ${a.name} · ${SITE}`;
      out.description = `${a.name} against another Portuguese osu!catch player: pp, ranks, shared maps and who wins them.`;
      out.image = avatarUrl(a.id);
    }
  }
  if (embed.kind === 'duel' && Array.isArray(duel?.players) && duel.players.length === 2) {
    const [a, b] = duel.players.map(s => byId.get(s.u)?.name ?? s.name);
    const [pa, pb] = duel.players.map(s => s.pts);
    out.title = `${a} vs ${b} · ${SITE}`;
    const format = [duel.ranked ? 'ranked' : 'unranked', duel.bestOf ? `best of ${duel.bestOf}` : ''].filter(Boolean).join(' ');
    const stars = Array.isArray(duel.stars) ? ` at ${num(duel.stars[0], 1)}–${num(duel.stars[1], 1)}★` : '';
    const winner = duel.players.find(s => s.u === duel.winner);
    const result = duel.status === 'abandoned' ? `${a} and ${b}’s ${format} osu!catch duel${stars} was abandoned at ${pa}–${pb}.`
      : winner ? `${winner === duel.players[0] ? a : b} beat ${winner === duel.players[0] ? b : a} ${Math.max(pa, pb)}–${Math.min(pa, pb)}${duel.status === 'forfeit' ? ' by forfeit' : ''} in a ${format} osu!catch duel${stars}.`
        : `${a} against ${b}, ${pa}–${pb}, in a ${format} osu!catch duel${stars}.`;
    out.description = `${result} Every round, map by map.`;
    if (winner) out.image = avatarUrl(winner.u);
  }
  if (embed.kind === 'map' && map?.m) {
    const [artist, title, version, set, stars, , , , , , , , , , creator] = map.m;
    const scores = Array.isArray(map.s) ? map.s : [];
    const first = scores[0] ? byId.get(scores[0][0]) : null;
    const name = `${artist} - ${title}${version ? ` [${version}]` : ''}`;
    out.title = `${name} · ${SITE}`;
    const who = scores.length === 1 ? '1 Portuguese player has a score on it' : `${num(scores.length)} Portuguese players have scores on it`;
    out.description = [
      `${num(stars, 2)}★ osu!catch map${creator ? ` by ${creator}` : ''}.`,
      scores.length ? `${who}${first ? `; ${first.name} holds the #1` : ''}.` : 'Nobody in Portugal has a score on it yet.',
    ].join(' ');
    if (set) { out.image = `https://assets.ppy.sh/beatmaps/${set}/covers/cover.jpg`; out.large = true; }
  }
  return out;
}

/**
 * What `embed` needs from the data at `base` (CONFIG.data: meta.json names each file's current copy), fetched with
 * `fetchJson(url)`. Anything that fails is left out: the preview then keeps its address-only text.
 */
export async function dataFor(embed, base, fetchJson) {
  if (!embed?.kind) return {};
  try {
    const meta = await fetchJson(new URL('meta.json', base).href);
    const file = path => (meta?.files?.[path] ? new URL(hashedName(path, meta.files[path]), base).href : null);
    const get = path => (file(path) ? fetchJson(file(path)).catch(() => null) : null);
    const [players, bucket] = await Promise.all([get('players.json'), embed.kind === 'map' ? get(`maps/${embed.id % 128}.json`)
      : embed.kind === 'duel' ? get(duelFile(embed.id)) : null]);
    return { players, map: embed.kind === 'map' ? bucket?.[embed.id] ?? null : null, duel: embed.kind === 'duel' ? bucket?.duels?.[embed.id] ?? null : null };
  } catch {
    return {};
  }
}

/**
 * index.html as the page at `url` sends it, or null for an address that is no page. Crawlers (`ua`) get the subject
 * named from the data at `base`; everyone else the address-only text, without waiting on any fetch.
 */
export async function pageFor(page, url, { ua = '', base, fetchJson } = {}) {
  const embed = describe(new URL(url).pathname);
  if (!embed) return null;
  const full = embed.kind && isPreviewBot(ua) && base && fetchJson ? withData(embed, await dataFor(embed, base, fetchJson)) : embed;
  return withHead(page, full, url);
}

/** Link-preview crawlers: Discord's, and the other chat apps and social sites that unfurl links the same way. */
export const isPreviewBot = ua => /discordbot|twitterbot|facebookexternalhit|slackbot|telegrambot|whatsapp|linkedinbot|skypeuripreview|embedly|redditbot|mastodon|bluesky|cardyb|applebot|googlebot|bingbot/i.test(ua ?? '');

const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * index.html with the preview in its <head>: the <title>, the description and the Open Graph and Twitter tags, plus
 * <base href="/"> so the page's relative addresses (assets/…) work at /player/123 too. `url` is the page's address.
 */
export function withHead(page, embed, url) {
  const tags = [
    '<base href="/">',
    `<meta property="og:site_name" content="${SITE}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${escape(embed.title.replace(` · ${SITE}`, ''))}">`,
    `<meta property="og:description" content="${escape(embed.description)}">`,
    url ? `<meta property="og:url" content="${escape(url)}">` : '',
    embed.image ? `<meta property="og:image" content="${escape(embed.image)}">` : '',
    `<meta name="twitter:card" content="${embed.image && embed.large ? 'summary_large_image' : 'summary'}">`,
  ].filter(Boolean).join('\n');
  return page
    .replace(/<base href="[^"]*">\r?\n?|<!-- The front page's link preview[^>]*-->\r?\n?|<meta (?:property="og:|name="twitter:)[^>]*>\r?\n?/g, '')
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(embed.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escape(embed.description)}">\n${tags}`);
}
