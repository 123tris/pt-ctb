// GET /<page>: every page address of the site (/rankings, /player/123, …) gets index.html, with that page's link
// preview written into its <head> (embed/embed.js), so a link posted on Discord shows what the page is. The router in
// assets/js/app.js does the rest. Addresses that are no page fall through to the static files (and 404.html).
// tools/build-site.mjs writes dist/_routes.json so the site's files (/assets/*) and the front page never come here.

import { describe, pageFor } from '../embed/embed.js';
import { CONFIG } from '../assets/js/config.js';

// The data the previews read is public and changes every 15 minutes at most; meta.json says which copy is current.
const fetchJson = url => fetch(url, { cf: { cacheTtl: url.endsWith('/meta.json') ? 60 : 3600, cacheEverything: true } })
  .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${url}`))));

export async function onRequestGet({ request, env, next }) {
  const url = new URL(request.url);
  if (!describe(url.pathname)) return next();
  const index = await env.ASSETS.fetch(new URL('/', url));
  if (!index.ok) return next();
  const page = await pageFor(await index.text(), url.href, { ua: request.headers.get('User-Agent'), base: CONFIG.data, fetchJson });
  if (page === null) return next();
  // index.html's own headers (_headers' security headers and caching), for the same document with another <head>.
  const headers = new Headers(index.headers);
  headers.delete('Content-Length');
  headers.delete('ETag');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Vary', 'User-Agent');
  return new Response(page, { status: 200, headers });
}
