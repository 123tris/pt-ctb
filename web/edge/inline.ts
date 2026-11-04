// The edge's "inline" mode: a page the new client draws goes out with the part of packs.json and meta.json it needs, and
// a preload of each of those files, so the browser starts fetching its data while it reads the page, instead of after
// its code has loaded and asked for the manifests (the old pages wait for meta.json first). One round trip fewer before
// anything shows, and on a repeat visit none at all: the files' addresses carry their hashes, so they come straight
// from the browser's cache.
//
// Used by functions/[[path]].js on Cloudflare and by tools/serve.mjs locally. Pure, and plain enough TypeScript for
// Node to run as it is.

import { hashedName } from '../../assets/js/core/data-name.js';
import { firstData } from '../src/routes.ts';

export interface Manifest {
  generatedAt: number;
  files: Record<string, string>;
}

/** The manifests the edge could get (null for one it couldn't, or doesn't need). */
export interface Manifests {
  packs: Manifest | null;
  meta: Manifest | null;
}

/** Which manifests a page address needs fetched: none for a page the old app draws. */
export function manifestsFor(pathname: string, search = ''): { packs: boolean; meta: boolean } {
  const first = firstData(pathname, search);
  return { packs: Boolean(first?.packs.length), meta: Boolean(first?.json.length) };
}

const pick = (manifest: Manifest | null, names: string[]): Manifest | undefined => {
  if (!manifest?.files) return undefined;
  const files: Record<string, string> = {};
  for (const name of names) if (manifest.files[name]) files[name] = manifest.files[name];
  return { generatedAt: manifest.generatedAt, files };
};

/** The page with its data slice and preloads at the end of its <head>; as it is for a page the old app draws. */
export function inlineData(page: string, pathname: string, manifests: Manifests, base: string, search = ''): string {
  const first = firstData(pathname, search);
  if (!first || !page.includes('</head>')) return page;
  const slice = { packs: pick(manifests.packs, first.packs), meta: pick(manifests.meta, first.json) };
  if (!slice.packs && !slice.meta) return page;
  const preloads = [slice.packs, slice.meta].flatMap(m => Object.entries(m?.files ?? {}))
    .map(([name, hash]) => `<link rel="preload" href="${base}${hashedName(name, hash)}" as="fetch" crossorigin>`);
  // In a <script type="application/json">, which the CSP doesn't apply to; "<" escaped so no text can close the tag.
  const json = JSON.stringify(slice).replace(/</g, '\\u003c');
  return page.replace('</head>', `${[...preloads, `<script type="application/json" id="ptc-data">${json}</script>`].join('\n')}\n</head>`);
}
