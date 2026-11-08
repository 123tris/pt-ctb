// Past editions, 2020–2025 (TOP10-DESIGN.md §13.10): the forum threads' lists, imported as top10/history/<edition>.json
// by hand, counted with the same score.js as a season, and kept in top10_results like a finalized year, so
// GET /api/top10/results?year= serves them like any other (top10/import-past.mjs writes the SQL that puts them there).
//
// An edition file is { edition, label, thread, ballots: [{ voter, post, picks: [{ id, spot }], mentions: [id],
// watch: [id], notes? }] }, with osu! user ids. "2023-24" is one edition; its year key is 2024 and its label "2023–24".
//
// What's different from a season (the live limits stay as they are):
// - a past edition is published whatever its turnout (2020 had one list, 2023–24 four);
// - a list may have more than 10 picks (tartaruga57's 2023–24 list has 11: spots 8, 8, 10, 11), and positions past 10
//   score 0, as §13.5 says;
// - a list keeps its numbering as written, even where it skips oddly (checkEdition only warns);
// - the forum was the electorate, so voters from outside PT count too;
// - the results carry `names` (id → name), since some of these players aren't in the site's player index (anomi,
//   24642612, whose profile is gone), and `lists`, the forum posts themselves.

import { computeResults, spotsValid } from './score.js';

/** An edition's year key: "2025" → 2025, "2023-24" → 2024; null for anything else. */
export function editionYear(edition) {
  const m = /^(\d{4})(?:[-–](\d{2}))?$/.exec(String(edition ?? '').trim());
  if (!m) return null;
  return m[2] ? Number(m[1].slice(0, 2) + m[2]) : Number(m[1]);
}

const isId = v => Number.isSafeInteger(v) && v > 0;

/**
 * What's wrong with an edition file: { errors, warnings } (lists of text). An error stops its import (an unknown year,
 * a list without a voter, an id that isn't an osu! id, a player twice on one list, a voter on their own list); a
 * warning doesn't (numbering that skips oddly, a voter with two lists).
 */
export function checkEdition(file) {
  const errors = [];
  const warnings = [];
  if (!editionYear(file?.edition)) errors.push(`edition "${file?.edition}" isn't a year like 2025 or 2023-24`);
  if (!Array.isArray(file?.ballots) || !file.ballots.length) errors.push('no ballots');
  const seen = new Set();
  for (const [i, b] of (file?.ballots ?? []).entries()) {
    const who = `ballot ${i + 1}${b?.post ? ` (${b.post})` : ''}`;
    if (!isId(b?.voter)) errors.push(`${who}: voter isn't an osu! id`);
    if (seen.has(b?.voter)) warnings.push(`${who}: voter ${b.voter} has another list in this edition`);
    seen.add(b?.voter);
    const picks = Array.isArray(b?.picks) ? b.picks : [];
    if (!picks.length) errors.push(`${who}: no picks`);
    if (picks.some(p => !isId(p?.id) || !Number.isSafeInteger(p?.spot) || p.spot < 1)) errors.push(`${who}: a pick without an osu! id or a spot`);
    const ids = picks.map(p => p?.id);
    if (new Set(ids).size !== ids.length) errors.push(`${who}: a player is on the list twice`);
    if (ids.includes(b?.voter)) errors.push(`${who}: the voter is on their own list`);
    if (picks.length && !spotsValid(picks)) warnings.push(`${who}: the spots (${picks.map(p => p.spot).join(', ')}) don't follow 1, 2, 3, 3, 5; counted as written`);
    for (const key of ['mentions', 'watch']) {
      if (b?.[key] !== undefined && (!Array.isArray(b[key]) || !b[key].every(isId))) errors.push(`${who}: ${key} isn't a list of osu! ids`);
    }
  }
  return { errors, warnings };
}

/** Every osu! id an edition file names: voters, picks, mentions and ones to watch. */
export const editionIds = file => [...new Set((file?.ballots ?? []).flatMap(b => [b.voter, ...(b.picks ?? []).map(p => p.id), ...(b.mentions ?? []), ...(b.watch ?? [])]))];

/**
 * Current names from top10/history/ALIASES.md's tables: Map id → name. A table with an "osu! id" column gives the
 * "Today" column's name, or the first column's where there's no "Today" (the voters from outside Portugal). An id
 * keeps the first name found; "—" and empty cells are skipped.
 */
export function namesFromAliases(markdown) {
  const names = new Map();
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.replace(/\*\*|`/g, '').trim());
  let header = null;
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) { header = null; continue; }
    const row = cells(line);
    if (row.every(c => /^:?-+:?$/.test(c))) continue;
    if (!header) { header = row.map(c => c.toLowerCase()); continue; }
    const idAt = header.indexOf('osu! id');
    if (idAt === -1) continue;
    const id = Number(row[idAt]);
    const today = header.indexOf('today');
    const name = row[today === -1 ? 0 : today];
    if (Number.isSafeInteger(id) && id > 0 && name && name !== '—' && !names.has(id)) names.set(id, name);
  }
  return names;
}

/**
 * An edition's results: score.js's JSON (§13.5) for its year key, plus edition, label, thread, past: true, names
 * ({ [id]: name } for every id the edition names, from `names`: a Map, the live player index first; an id with none
 * gets its number) and lists (the forum posts: [{ voter, post, picks, mentions, watch, notes? }]). Throws when
 * checkEdition finds an error.
 */
export function pastResults(file, { importedAt = new Date().toISOString(), names = new Map() } = {}) {
  const { errors } = checkEdition(file);
  if (errors.length) throw new Error(`${file?.edition}: ${errors.join('; ')}`);
  const year = editionYear(file.edition);
  const ballots = file.ballots.map(b => ({ voter: b.voter, picks: b.picks.map(p => ({ id: p.id, spot: p.spot })), mentions: b.mentions ?? [], watch: b.watch ?? [] }));
  const { results } = computeResults({ year, ballots, finalizedAt: importedAt, minBallots: 1 });
  const lists = file.ballots.map((b, i) => ({ voter: b.voter, post: b.post ?? null, ...ballots[i], ...(b.notes ? { notes: String(b.notes) } : {}) }));
  return {
    ...results, edition: String(file.edition), label: file.label ? String(file.label) : String(file.edition), thread: file.thread ?? null, past: true,
    names: Object.fromEntries(editionIds(file).sort((a, b) => a - b).map(id => [id, names.get(id) ?? String(id)])),
    lists,
  };
}

const sqlText = s => `'${String(s).replace(/'/g, "''")}'`;

/**
 * SQL that saves past editions' results in top10_results (made if missing), replacing what an earlier import saved
 * for those years. `by` is 0: no admin finalized them. For `wrangler d1 execute … --file`.
 */
export function pastSql(editions, { importedAt = Math.floor(Date.now() / 1000) } = {}) {
  return [
    '-- Past Top 10 editions (top10/import-past.mjs). Safe to run again: it replaces those years.',
    'CREATE TABLE IF NOT EXISTS top10_results (year INTEGER PRIMARY KEY, json TEXT NOT NULL, finalized_at INTEGER NOT NULL, "by" INTEGER NOT NULL);',
    ...editions.map(r => `INSERT OR REPLACE INTO top10_results (year, json, finalized_at, "by") VALUES (${r.year}, ${sqlText(JSON.stringify(r))}, ${importedAt}, 0);`),
    '',
  ].join('\n');
}
