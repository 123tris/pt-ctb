// The map search index (data/maps-search.json) and its decoder. It holds one row per map with Portuguese plays,
//   [id, setId, artist, title, version, stars, category, players, topPlayerId, mapper]
// stored by column, which compresses far better: artist, title and mapper (the set's host, as a number into a list of
// names) once per set, ids and set numbers as differences
// from the previous row, stars as hundredths and the #1 player as a number into a short list of player ids.
// tools/lib/build.mjs writes it with encodeMapsSearch; the site reads it with decodeMapsSearch.

export const MAPS_SEARCH_VERSION = 1;

/** Rows → the column form. Rows come out ordered by set, then id. */
export function encodeMapsSearch(rows) {
  const sorted = [...rows].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const file = { v: MAPS_SEARCH_VERSION, sets: [], tops: [], mappers: [], id: [], set: [], ver: [], stars: [], cat: '', n: [], top: [] };
  const setNumber = new Map(), topNumber = new Map(), mapperNumber = new Map();
  let lastId = 0, lastSet = 0;
  for (const [id, setId, artist, title, version, stars, cat, players, top, mapper = ''] of sorted) {
    const setKey = `${setId}\u0000${artist}\u0000${title}\u0000${mapper}`;
    if (!mapperNumber.has(mapper)) {
      mapperNumber.set(mapper, file.mappers.length);
      file.mappers.push(mapper);
    }
    if (!setNumber.has(setKey)) {
      setNumber.set(setKey, file.sets.length);
      file.sets.push([setId, artist, title, mapperNumber.get(mapper)]);
    }
    if (!topNumber.has(top)) {
      topNumber.set(top, file.tops.length);
      file.tops.push(top);
    }
    const set = setNumber.get(setKey);
    file.id.push(id - lastId);
    file.set.push(set - lastSet);
    lastId = id;
    lastSet = set;
    file.ver.push(version);
    file.stars.push(Math.round(stars * 100));
    file.cat += cat;
    file.n.push(players);
    file.top.push(topNumber.get(top));
  }
  return file;
}

/** The column form → rows (in set order; callers sort). A file from before mappers gives '' for each. */
export function decodeMapsSearch(file) {
  const rows = new Array(file.id.length);
  let id = 0, set = 0;
  for (let i = 0; i < rows.length; i++) {
    id += file.id[i];
    set += file.set[i];
    const [setId, artist, title, mapper] = file.sets[set];
    rows[i] = [id, setId, artist, title, file.ver[i], file.stars[i] / 100, file.cat[i], file.n[i], file.tops[file.top[i]], file.mappers?.[mapper] ?? ''];
  }
  return rows;
}

// ---- Matching, for the header search (core/search.js) --------------------------------------------------------------

const MAP_LIMIT = 4;

/** Where `q` sits in `text`: 0 at the start, 1 at the start of a word, 2 anywhere else, -1 not at all. */
export function tierOf(text, q) {
  const at = text.indexOf(q);
  return at < 0 ? -1 : at === 0 ? 0 : /[\s_\-[\].(]/.test(text[at - 1]) ? 1 : 2;
}

/** An osu! beatmap id typed or pasted: "123", ".../beatmaps/123", "...#fruits/123", ".../b/123". */
export function beatmapIdOf(text) {
  const s = text.trim();
  const m = /^(\d{1,10})$/.exec(s) ?? /\/beatmaps\/(\d{1,10})(?:[/?#]|$)/.exec(s) ?? /#(?:osu|taiko|fruits|mania)\/(\d{1,10})/.exec(s)
    ?? /\/b\/(\d{1,10})(?:[/?#]|$)/.exec(s);
  return m ? Number(m[1]) : null;
}

/**
 * Maps (rows [id, setId, artist, title, version, stars, category, players, topPlayerId, mapper]) whose artist, title,
 * difficulty or mapper hold every word of the text, best first: a title that starts with it, then a word that does,
 * then the rest; ties go to the maps more Portuguese players have played. An exact beatmap id or link finds that map.
 * `hay` is each row's lowercased "title artist version mapper".
 */
export function rankMaps(rows, hay, text) {
  const id = beatmapIdOf(text);
  if (id !== null) {
    const row = rows.find(r => r[0] === id);
    return [{ tier: 0, row: row ?? [id, 0, '', '', '', 0, '', 0, 0, ''] }];
  }
  const q = text.toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  if (q.length < 2) return [];
  const scored = [];
  for (let i = 0; i < rows.length; i++) {
    const h = hay[i];
    if (!words.every(w => h.includes(w))) continue;
    const title = tierOf(rows[i][3].toLowerCase(), q);
    scored.push([title === 0 ? 0 : title === 1 || tierOf(h, q) === 0 || tierOf(h, q) === 1 ? 1 : 2, rows[i][7], rows[i]]);
  }
  scored.sort((a, b) => a[0] - b[0] || b[1] - a[1] || a[2][0] - b[2][0]);
  return scored.slice(0, MAP_LIMIT).map(s => ({ tier: s[0], row: s[2] }));
}


// ---- The header search's own index (search-maps.json) --------------------------------------------------------------
// Only what the search shows and matches: id, set, artist, title, difficulty, stars (hundredths), mapper and players (for
// ranking), plus the category, which lets the map quizzes (pages/games.js) use this instead of the whole index; stored
// by column like maps-search.json, for the maps SEARCH_MIN_PLAYERS or more players here have played.
// About 45% of the full index; a map outside it is still found by its id, and "Search all maps" searches every one.

export const SEARCH_MIN_PLAYERS = 2;

/** Rows [id, setId, artist, title, version, stars, category, players, topPlayerId, mapper] → search-maps.json. */
export function encodeSearchMaps(rows) {
  const sorted = [...rows].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const file = { v: 1, sets: [], mappers: [], id: [], set: [], ver: [], stars: [], cat: '', n: [] };
  const setNumber = new Map(), mapperNumber = new Map();
  let lastId = 0, lastSet = 0, lastSetId = 0;
  for (const [id, setId, artist, title, version, stars, cat, players, , mapper = ''] of sorted) {
    if (!mapperNumber.has(mapper)) { mapperNumber.set(mapper, file.mappers.length); file.mappers.push(mapper); }
    const key = `${setId}\u0000${artist}\u0000${title}\u0000${mapper}`;
    if (!setNumber.has(key)) {
      setNumber.set(key, file.sets.length);
      file.sets.push([setId - lastSetId, artist, title, mapperNumber.get(mapper)]);
      lastSetId = setId;
    }
    const set = setNumber.get(key);
    file.id.push(id - lastId);
    file.set.push(set - lastSet);
    lastId = id;
    lastSet = set;
    file.ver.push(version);
    file.stars.push(Math.round(stars * 100));
    file.cat += cat;
    file.n.push(players);
  }
  return file;
}

/** search-maps.json → rows in the full index's shape ([…, players, null, mapper]; no #1, and '' for the category in a file from before it). */
export function decodeSearchMaps(file) {
  const sets = [];
  let setId = 0;
  for (const [delta, artist, title, mapper] of file.sets) {
    setId += delta;
    sets.push([setId, artist, title, file.mappers[mapper] ?? '']);
  }
  const rows = new Array(file.id.length);
  let id = 0, set = 0;
  for (let i = 0; i < rows.length; i++) {
    id += file.id[i];
    set += file.set[i];
    const [sid, artist, title, mapper] = sets[set];
    rows[i] = [id, sid, artist, title, file.ver[i], file.stars[i] / 100, file.cat?.[i] ?? '', file.n[i], null, mapper];
  }
  return rows;
}
