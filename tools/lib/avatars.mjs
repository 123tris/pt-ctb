// Small copies of the tracked players' osu! avatars, published with the data: avatars/{id}-64.webp and -128.webp. The
// site shows avatars at 22-88 px, and osu!'s originals (https://a.ppy.sh/{id}) are 256 px JPEGs, PNGs or GIFs of
// 17-75 KB each, most of a leaderboard page's bytes; these are 1-5 KB. Used by tools/export.mjs.
//
// a.ppy.sh is osu!'s image CDN, not the API, so this doesn't count against the bot's API rate limit. The bot's data has
// no avatar URL, so a player's avatar is re-checked once a day with a conditional request (its ETag and Last-Modified,
// kept in the state): unchanged answers 304 and nothing is redrawn. A new player, or one whose thumbnails are missing
// from the output folder, is fetched straight away. When a fetch fails the previous thumbnails stay; a player with
// none is simply left out, and the site falls back to a.ppy.sh for them (core/ui.js).
//
// Animated (GIF) avatars become their first frame.

import fs from 'node:fs';
import path from 'node:path';

export const SIZES = [64, 128];
export const RECHECK_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const PARALLEL = 4;

/** The output names of a player's thumbnails, smallest first. */
export const thumbNames = id => SIZES.map(px => `avatars/${id}-${px}.webp`);

/** sharp's resize to `px`×`px` WebP, cropped to a centred square like the site's `object-fit: cover`. */
export async function sharpResizer() {
  const { default: sharp } = await import('sharp');
  return (input, px) => sharp(input).resize(px, px, { fit: 'cover' }).webp({ quality: 82, effort: 6 }).toBuffer();
}

/**
 * Brings the thumbnails for `ids` up to date in `outDir`. `state` is the previous run's { [id]: { etag, modified,
 * checked } }. Returns { files: { name: Buffer } for every player with thumbnails, state, stats }. Never throws for a
 * single avatar: the export goes on without it. `resize` is null when sharp isn't installed; then only thumbnails that
 * are already there are kept.
 */
export async function updateAvatars({ ids, outDir, state = {}, now = Date.now(), resize, fetchImpl = fetch, log = () => {} }) {
  const files = {};
  const next = {};
  const stats = { fetched: 0, unchanged: 0, failed: 0, kept: 0, missing: 0 };
  const onDisk = id => {
    const names = thumbNames(id);
    return names.every(n => fs.existsSync(path.join(outDir, n))) ? names : null;
  };
  const keep = id => {
    const names = onDisk(id);
    if (!names) return false;
    for (const n of names) files[n] = fs.readFileSync(path.join(outDir, n));
    return true;
  };

  const due = [];
  for (const id of ids) {
    const saved = state[id];
    const fresh = saved && now - saved.checked < RECHECK_MS;
    if (fresh && keep(id)) {
      next[id] = saved;
      stats.kept++;
    } else due.push(id);
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < due.length) {
      const id = due[cursor++];
      const saved = state[id];
      const names = onDisk(id);
      if (!resize) {
        // No sharp: keep what's there (rechecked once it's back), skip the rest.
        if (keep(id)) { next[id] = saved ?? { checked: 0 }; stats.kept++; } else stats.missing++;
        continue;
      }
      const headers = {};
      if (names && saved?.etag) headers['If-None-Match'] = saved.etag;
      if (names && saved?.modified) headers['If-Modified-Since'] = saved.modified;
      try {
        const res = await fetchImpl(`https://a.ppy.sh/${id}`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (res.status === 304 && names) {
          keep(id);
          next[id] = { ...saved, checked: now };
          stats.unchanged++;
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const input = Buffer.from(await res.arrayBuffer());
        const outputs = await Promise.all(SIZES.map(px => resize(input, px)));
        thumbNames(id).forEach((n, i) => {
          writeIfChanged(path.join(outDir, n), outputs[i]);
          files[n] = outputs[i];
        });
        next[id] = { etag: res.headers.get('etag') ?? null, modified: res.headers.get('last-modified') ?? null, checked: now };
        stats.fetched++;
      } catch (e) {
        log(`  avatar ${id}: ${e.message}${names ? ' (keeping the previous one)' : ' (the site uses a.ppy.sh)'}`);
        stats.failed++;
        // Keep the old ones; try again next run (checked unchanged, so it's still due).
        if (keep(id) && saved) next[id] = saved;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, due.length) }, worker));
  // In the order of `ids`, not the order fetches finished, so an unchanged run lists them the same way in meta.json.
  const ordered = {};
  for (const n of ids.flatMap(thumbNames)) if (files[n]) ordered[n] = files[n];
  return { files: ordered, state: next, stats };
}

function writeIfChanged(file, buf) {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buf)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, buf);
  fs.renameSync(`${file}.tmp`, file);
}
