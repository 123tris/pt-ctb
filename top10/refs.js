// Score refs: how a showcase entry and a write-up's cites name a play (TOP10-DESIGN.md §13.9, settled 2026-11-08 with
// the UI). One grammar, as text:
//
//   osu:<id>                 a lazer score id: https://osu.ppy.sh/scores/<id>
//   legacy:<id>              a legacy (stable) score id: https://osu.ppy.sh/scores/fruits/<id>
//   map:<beatmap>:<player>   that player's play on that map in the site's exported data: their best one (the most pp,
//                            then the latest) set in the season's year. For the plays the export has no score id for,
//                            which is most of them.
//   play:<id>                a showcase entry (cites only): a clip or a replay file, or any entry
//
// What's also read, and turned into the above: an osu! score link (/scores/<id>, /scores/fruits/<id>); a bare number
// (a lazer id; where the exported data is searched, either kind); a number as the site's score tuples keep it (S.ID:
// positive lazer, negative legacy); "map:<beatmap>" with the player given apart (the write-up's subject for a cite, the
// `player` field for a showcase entry); "p<id>" for play:<id>.

/** The canonical ref of an S.ID (the site's tuples: positive is a lazer id, negative a legacy one), or null. */
export const sidRef = sid => (Number.isSafeInteger(sid) && sid > 0 ? `osu:${sid}` : Number.isSafeInteger(sid) && sid < 0 ? `legacy:${-sid}` : null);

/** The S.ID of an osu: or legacy: ref, or null. */
export const refSid = ref => {
  const m = /^(osu|legacy):(\d{1,15})$/.exec(ref ?? '');
  return m ? (m[1] === 'osu' ? Number(m[2]) : -Number(m[2])) : null;
};

/** The score's page on osu! for an osu: or legacy: ref, or null. */
export function scoreUrl(ref) {
  const sid = refSid(ref);
  return sid === null ? null : sid > 0 ? `https://osu.ppy.sh/scores/${sid}` : `https://osu.ppy.sh/scores/fruits/${-sid}`;
}

const positive = n => Number.isSafeInteger(n) && n > 0 && n < 1e15;

/**
 * A ref, link or id as { kind, ref, … }: kind 'osu' or 'legacy' with `id` (and `bare: true` for a bare number, which
 * could be either), 'map' with `beatmap` and `player`, 'play' with `id`; { error: 'mode' } for a score link of another
 * ruleset; null for anything else. `player` fills in a map ref that doesn't name one.
 */
export function parseRef(input, { player = null } = {}) {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input === 0) return null;
    return input > 0 ? { kind: 'osu', id: input, ref: `osu:${input}` } : { kind: 'legacy', id: -input, ref: `legacy:${-input}` };
  }
  const text = String(input ?? '').trim();
  let m;
  if ((m = /^(-?)(\d{1,15})$/.exec(text))) {
    const n = Number(m[2]);
    if (!positive(n)) return null;
    return m[1] ? { kind: 'legacy', id: n, ref: `legacy:${n}` } : { kind: 'osu', id: n, ref: `osu:${n}`, bare: true };
  }
  if ((m = /^(osu|legacy):(\d{1,15})$/i.exec(text))) {
    const n = Number(m[2]);
    return positive(n) ? { kind: m[1].toLowerCase(), id: n, ref: `${m[1].toLowerCase()}:${n}` } : null;
  }
  if ((m = /^map:(\d{1,10})(?::(\d{1,10}))?$/i.exec(text))) {
    const beatmap = Number(m[1]);
    const who = m[2] ? Number(m[2]) : player;
    return positive(beatmap) && positive(who) ? { kind: 'map', beatmap, player: who, ref: `map:${beatmap}:${who}` } : null;
  }
  if ((m = /^(?:play:|p)(\d{1,10})$/i.exec(text))) {
    const n = Number(m[1]);
    return positive(n) ? { kind: 'play', id: n, ref: `play:${n}` } : null;
  }
  let url;
  try { url = new URL(text); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || !/(^|\.)ppy\.sh$/i.test(url.hostname)) return null;
  // As the bot's /addscore reads links (OsuFormat.TryParseScoreId): a path with /scores/ that ends in a number.
  m = /\/scores\/(?:([a-z]+)\/)?(\d{1,15})\/?$/i.exec(url.pathname);
  if (!m || !positive(Number(m[2]))) return null;
  const n = Number(m[2]);
  if (!m[1]) return { kind: 'osu', id: n, ref: `osu:${n}` };
  return m[1].toLowerCase() === 'fruits' ? { kind: 'legacy', id: n, ref: `legacy:${n}` } : { error: 'mode' };
}

/** The S.IDs a parsed osu:/legacy: ref could be in the exported data (both kinds for a bare number). */
export const sidsOf = parsed => (parsed.kind === 'osu' ? (parsed.bare ? [parsed.id, -parsed.id] : [parsed.id]) : parsed.kind === 'legacy' ? [-parsed.id] : []);
