// The edge's "inline" mode: a page the new client draws goes out with the part of packs.json it needs, so the browser
// starts fetching its first pack while it reads the page, instead of after its code has loaded and asked for packs.json
// (or, as the old pages do, meta.json). One round trip fewer before anything shows, and on a repeat visit none at all:
// the pack's address carries its hash, so it comes straight from the browser's cache.
//
// Used by functions/[[path]].js on Cloudflare and by tools/serve.mjs locally. Pure, and plain enough TypeScript for
// Node to run as it is.

import { hashedName } from '../../assets/js/core/data-name.js';
import { firstPacks } from '../src/routes.ts';

export interface Manifest {
  generatedAt: number;
  files: Record<string, string>;
}

/** The packs.json slice and preloads for `pathname`, put at the end of the page's <head>; the page as it is otherwise. */
export function inlinePacks(page: string, pathname: string, manifest: Manifest | null, base: string): string {
  const names = firstPacks(pathname);
  if (!names || !manifest?.files) return page;
  const files: Record<string, string> = {};
  for (const name of names) if (manifest.files[name]) files[name] = manifest.files[name];
  // In a <script type="application/json">, which the CSP doesn't apply to; "<" escaped so no text can close the tag.
  const slice = JSON.stringify({ generatedAt: manifest.generatedAt, files }).replace(/</g, '\\u003c');
  const preloads = Object.entries(files).map(([name, hash]) => `<link rel="preload" href="${base}${hashedName(name, hash)}" as="fetch" crossorigin>`);
  const tags = [...preloads, `<script type="application/json" id="ptc-packs">${slice}</script>`].join('\n');
  return page.includes('</head>') ? page.replace('</head>', `${tags}\n</head>`) : page;
}
