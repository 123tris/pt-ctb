// The bot's map links. Instead of osu!'s address the bot posts https://ptcatch.com/b/<map id> (functions/b/[id].js),
// and whoever clicks it decides where it takes them, since Discord can't tell anyone who clicked: the map's page here
// (the default), or osu!'s page for it. The choice is this browser's `maplinks` cookie, which /maplinks/<osu|ptcatch>
// sets (functions/maplinks/[choice].js): from the Bot commands page's card, from a map page the first time a bot link
// lands there (?via=bot), or from the link the bot's !maplinks gives, opened from Discord so it lands in the browser
// Discord opens links in. A cookie, so the /b/ Function can read it and answer with a redirect at once; set by the
// server rather than by script, so Safari keeps it longer than 7 days.
//
// A map the site has nothing on (no plays here, no challenge running on it) goes to osu! whatever the choice: the page
// here would be empty, a detour on the way to osu!.

import { hashedName } from '../assets/js/core/data-name.js';

export const COOKIE = 'maplinks';

/** Where map links can go: the map's page here, or osu!'s. */
export const CHOICES = Object.freeze(['ptcatch', 'osu']);

/** 400 days, the longest a browser keeps a cookie. Each click on a bot link starts it again. */
export const MAX_AGE = 400 * 86400;

/** osu!'s page for a map (a difficulty), in the catch ruleset, so a convert shows its catch leaderboard. */
export const osuMap = id => `https://osu.ppy.sh/beatmaps/${id}?mode=fruits`;

/** A map id from an address's text: 1 to 10 digits, above 0 and within osu!'s ids (32-bit); else null. */
export function mapId(text) {
  const s = String(text ?? '');
  if (!/^\d{1,10}$/.test(s)) return null;
  const id = Number(s);
  return id > 0 && id <= 2147483647 ? id : null;
}

/** The visitor's choice from a Cookie header (or document.cookie): 'osu', 'ptcatch', or null for none. */
export function choiceOf(cookies) {
  for (const part of String(cookies ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === COOKIE) {
      const value = part.slice(at + 1).trim();
      return CHOICES.includes(value) ? value : null;
    }
  }
  return null;
}

/** The Set-Cookie header that keeps `choice` in this browser for MAX_AGE; `secure` is off only for plain http (localhost). */
export const choiceCookie = (choice, secure = true) =>
  `${COOKIE}=${choice}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;

/**
 * Whether the site has a page worth opening for map `id`, from the published data at `base` (CONFIG.data) read with
 * `fetchJson(url)`: plays on it (its bucket, maps/<id % 128>.json), or a challenge running on it (the map of the week,
 * King of the hill's pool, an open bounty). Rejects when meta.json or the bucket can't be read.
 */
export async function siteHasMap(id, base, fetchJson) {
  const meta = await fetchJson(new URL('meta.json', base).href);
  if (meta?.week?.map === id || (meta?.hill?.pool ?? []).some(slot => Array.isArray(slot) && slot[2] === id)) return true;
  const read = name => (meta?.files?.[name] ? fetchJson(new URL(hashedName(name, meta.files[name]), base).href) : Promise.resolve(null));
  if ((await read(`maps/${id % 128}.json`))?.[id]) return true;
  return Boolean((await read('bounties.json').catch(() => null))?.maps?.[id]);
}

/**
 * Where /b/<id> sends a visitor whose choice is `choice` ('osu', 'ptcatch' or null): osu!'s page for 'osu'; otherwise the
 * map's page here, unless `has()` (siteHasMap) says the site has nothing on the map, or can't say: then osu!'s too. A
 * visitor who hasn't chosen gets ?via=bot, so the map page offers them the choice (web/src/views/map.ts).
 */
export async function destination(id, choice, has) {
  if (choice === 'osu') return osuMap(id);
  const known = await Promise.resolve().then(has).catch(() => false);
  if (!known) return osuMap(id);
  return choice === 'ptcatch' ? `/map/${id}` : `/map/${id}?via=bot`;
}

/** A redirect to `to` (a path here or another site's address), never cached, setting `cookie` when there is one. */
function redirect(to, base, cookie) {
  const headers = new Headers({ Location: new URL(to, base).href, 'Cache-Control': 'private, no-store' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

/**
 * GET /b/<id> (functions/b/[id].js, and tools/serve.mjs locally): a redirect to the map's page here or osu!'s, with
 * `data` the data's address and `fetchJson` how to read it. Never cached, since it depends on the visitor's cookie; their
 * choice is set again with it, so it lasts 400 days from their last click. Null for an id that's no map id.
 */
export async function mapLink(request, id, { data, fetchJson }) {
  const map = mapId(id);
  if (map === null) return null;
  const url = new URL(request.url);
  const choice = choiceOf(request.headers.get('Cookie'));
  const to = await destination(map, choice, () => siteHasMap(map, data, fetchJson));
  return redirect(to, url, choice && choiceCookie(choice, url.protocol === 'https:'));
}

/**
 * GET /maplinks/<choice>[?map=<id>] (functions/maplinks/[choice].js, and tools/serve.mjs locally): keeps the choice in
 * this browser, then shows it at work: the map by the new choice (/b/<id>) when ?map= names one, else the Bot commands
 * page, whose card shows the choice. An unknown choice changes nothing.
 */
export function chooseLinks(request, choice) {
  const url = new URL(request.url);
  const map = mapId(url.searchParams.get('map'));
  const cookie = CHOICES.includes(choice) ? choiceCookie(choice, url.protocol === 'https:') : null;
  return redirect(map ? `/b/${map}` : '/commands', url, cookie);
}
