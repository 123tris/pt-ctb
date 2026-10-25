// The map search index (data/maps-search.json) and its decoder. It holds one row per map with Portuguese plays,
//   [id, setId, artist, title, version, stars, category, players, topPlayerId]
// stored by column, which compresses far better: artist and title once per set, ids and set numbers as differences
// from the previous row, stars as hundredths and the #1 player as a number into a short list of player ids.
// tools/lib/build.mjs writes it with encodeMapsSearch; the site reads it with decodeMapsSearch.

export const MAPS_SEARCH_VERSION = 1;

/** Rows → the column form. Rows come out ordered by set, then id. */
export function encodeMapsSearch(rows) {
  const sorted = [...rows].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const file = { v: MAPS_SEARCH_VERSION, sets: [], tops: [], id: [], set: [], ver: [], stars: [], cat: '', n: [], top: [] };
  const setNumber = new Map(), topNumber = new Map();
  let lastId = 0, lastSet = 0;
  for (const [id, setId, artist, title, version, stars, cat, players, top] of sorted) {
    const setKey = `${setId}\u0000${artist}\u0000${title}`;
    if (!setNumber.has(setKey)) {
      setNumber.set(setKey, file.sets.length);
      file.sets.push([setId, artist, title]);
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

/** The column form → rows (in set order; callers sort). */
export function decodeMapsSearch(file) {
  const rows = new Array(file.id.length);
  let id = 0, set = 0;
  for (let i = 0; i < rows.length; i++) {
    id += file.id[i];
    set += file.set[i];
    const [setId, artist, title] = file.sets[set];
    rows[i] = [id, setId, artist, title, file.ver[i], file.stars[i] / 100, file.cat[i], file.n[i], file.tops[file.top[i]]];
  }
  return rows;
}
