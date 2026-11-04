# The new web client

The site is being rebuilt for speed one page at a time, in TypeScript, next to the old client in `assets/js`. A page
the new client draws reads **packs**: binary columns the C# engine writes ([engine/README.md](../engine/README.md)).
Everything else stays with the old client, which also keeps the header, menus, search and sign-in for now.

Ported so far:
- the home page, from the core pack and the engine's `home.json`: 9 KB brotli instead of ~66 KB of JSON from six
  files;
- every Leaderboards tab (`/rankings/…`);
- a player's profile, every tab (`/player/:id/:tab?`). The player comes from the core pack, the rest from the JSON the
  old page reads, and `history.json` (every player's) only once the pp chart is opened;
- a map's page (`/map/:id`): the map and its board from its bucket (`maps/<id % 128>.json`), the players from the core
  pack, the rest from the JSON the old page reads;
- the calculator and compare (on player packs);
- Activity and Records;
- the players list, commands, glossary, privacy, how to join and Team Portugal;
- the maps list (`/maps`), from the search pack: a search takes 1–5 ms instead of 20–60, with the same results in the
  same order (`test/maps.test.mjs` checks them against the old search's). Its first visit waits for the whole pack
  (about 850 KB brotli) where the old page drew from maps-top.json (43 KB) and fetched the index on the first search.
  Drawing the first page from maps-top.json while the pack loads would bring that back.

Still the old client's: challenges (with the Dan course, King of the hill, bounties and completion), games, the
yearly recap, the shop and admin; then the header, menus, search and sign-in, and the endpoints.

Each port is checked against the old page's output or logic on the same data (`test/`).

## How a page gets to the screen

1. **The edge.** `functions/[[path]].js` sends `index.html` as before. For a page the new client draws, it also writes
   in that page's slice of `packs.json` and `meta.json` and a preload of each file its first view needs
   (`src/routes.ts`, `edge/inline.ts`). The browser starts on the data while it reads the page. The old pages wait for
   `meta.json`, and only then fetch their data.
2. **The old router** (`assets/js/app.js`) loads `assets/web/<page>.js`, the page's entry.
3. **The entry** (`src/entries/`, a `page({ old, load, title, render, mount })` from `src/client/page.ts`) loads the
   data from the store (`src/kernel/store.ts`), draws the page with the view's `render()`, then `mount()` wires it up.
   When the data has no packs, a pack has another layout than the code reads, or `load` returns null (a tab not
   ported yet), the old page draws it instead.

**Packs and JSON.** The store reads both: packs (`store.pack(name, readX)`) and the export's JSON files
(`store.json(name)`), each at its hashed address. Every page reads the core pack for players: names, avatars, colours
and boards. Big or busy data has packs, such as a profile's plays or the maps search. A page whose data is small and
only drawn once can read its JSON file as the old page did, and get a pack later. It still gains the inline slice:
no wait for `meta.json`.

## Layout

| Folder | What |
|---|---|
| `src/kernel` | The base every page uses. `ptcb.ts` reads packs. `store.ts` loads packs and JSON by name, by hash. `html.ts` is the escaping template tag. `i18n.ts` and `fmt.ts` handle text and numbers for one language. `ctx.ts` is what a view is drawn with. `model.ts` holds the data's shapes and rules (`assets/js/core/model.js`) |
| `src/gen` | `packs.ts`: each pack's types, generated from the engine's schemas (`npm run gen`). Don't edit it |
| `src/ui` | Shared markup, as `assets/js/core/ui.js` has it: `players.ts` (over the core pack), `maps.ts`, `scores.ts` (over the JSON's tuples), `page.ts` (headings, tabs, tables, chips, stats, a page of a list). And the pure parts of the other core modules, under their names, as pages need them: `badges.ts`, `bananas.ts`, `bounty.ts`, `charts.ts`, `events.ts`, `hill.ts`, `ladder.ts`, `star-range.ts`. `map-search.ts` is the Maps search over the search pack |
| `src/views` | One page each. `x.ts` holds `render(ctx, data, state)`, which is pure and so can run at the edge too. `x.mount.ts` holds the browser-only half |
| `src/entries` | Each page's module for the old router: the bundle's entry points, every file here (`tools/web-build.mjs`) |
| `src/client` | The browser's side. `boot.ts` builds the visitor's `Ctx` and the store. `page.ts` turns a view into a page for the old router. `dom.ts` holds small DOM helpers, and `star-slider.ts` the star slider's events. `legacy.ts` is everything still taken from `assets/js`, kept in one file |
| `src/routes.ts` | Which addresses the new client draws, and the packs and JSON each one's first view needs |
| `edge` | What the Cloudflare Function runs: the packs slice now, server rendering later |
| `test` | `node --test`: packs against the JSON, views drawn in Node |

**Data-oriented.** Over a pack, a view works with columns and row numbers. A player is a row in `core.players`
(`rowOf(players, id)` finds one by osu! id), and a board is a list of rows. Nothing builds an object per player.
Strings are decoded only when shown.

**Sharing the old site's modules.** An import of anything under `assets/js` stays an import of that same file:
`tools/web-build.mjs` keeps it out of the bundle. So the new code uses the very modules the old app has already
loaded: its settings, its language and strings (`assets/js/core/pt.js`, which `node tools/i18n-check.mjs` also checks
against `src/`), and its sign-in. Only `src/client/legacy.ts` imports browser code from there. Views take their
browser parts through it, so they stay pure.

## Porting a page

1. Decide where the data comes from: the core pack for players, and for the rest, an existing pack or the JSON file
   the old page reads. If the page needs a new pack, add it to `engine/src/PtCatch.Engine/Packs/Schemas.cs` and
   `Export/Build.Packs.cs`. Then run `npm run gen`, and extend `test/packs.test.mjs` to compare it with the JSON.
2. Write `src/views/<page>.ts` (`render`) and `<page>.mount.ts` from the old `assets/js/pages/<page>.js`. Keep its
   markup and classes, so `site.css` styles it the same, and keep its strings, so `pt.js` already has them. Take
   `t`/`fmt`/`now` from `ctx`, never from a global, so `render` stays pure.
3. Add `src/entries/<page>.ts`, a `page({ … })`, and the page's route and first data to `src/routes.ts`.
4. Point the page's line in `assets/js/app.js` at `../web/<page>.js`, with the old page as the fallback.
5. Test it: a view test in `test/`, `npm run typecheck`, `node tools/i18n-check.mjs`. Then check it in the browser
   with `npm run serve -- --local-data <export folder with packs>`, in both languages, at phone width and with the
   keyboard.

## Running it

```powershell
npm run serve -- --local-data <folder>   # the bundle is rebuilt in memory on each request; the edge's slice too
npm run typecheck                        # tsc -p web (checks only; esbuild builds)
npm run build                            # dist/, with the bundle in dist/assets/web/
node --test web/test/*.test.mjs          # with PTCATCH_DATA=<folder> for the tests that need packs
```

An export with packs: `ptcatch-engine export --out <folder> --packs` (copy `data/avatars` into the folder first to keep
the thumbnails).

## Measured (2026-11-04, this desktop)

Lab: the production build served locally, with every request held back 80 ms to stand in for a phone's round trip to
the edge. Same machine, same data.

| Converts leaderboard | Old page | New |
|---|---|---|
| Repeat visit, until the board shows | 266 ms | 156 ms |
| First visit (cold cache) | 821 ms | 650 ms |
| Round trips before the board can draw, repeat visit | HTML, then `meta.json` | HTML only |
| Data parsed | `players.json` (`JSON.parse`) | `core` pack (typed arrays, 7 KB brotli) |
| Redrawing the board, data in memory | 60 ms | 54 ms |

The repeat visit is the fair comparison: the code comes from the cache in both, so only the round trips differ. The
lab server speaks HTTP/1.1, which queues the old site's ~25 modules on 6 connections, so both first visits are slower
than over Cloudflare's HTTP/2.

Where the 54 ms of a redraw go:
- 7 ms is the view's JavaScript;
- 12 ms is parsing 94 KB of markup;
- 14 ms is style;
- 21 ms is layout, for 109 rows and 1,514 elements.

So the gains are in the DOM, not the JavaScript. The boards now draw their first 30 rows, and add the rest 30 at a
time, one batch per frame (`client/dom.ts` `addInFrames`):

| Converts board, data in memory | Before | Now |
|---|---|---|
| Drawn before the first paint | 59.5 ms (whole board) | 14 ms (30 rows) |
| Longest frame after it | none | about 13 ms (each batch of 30) |

**Data a page downloads.** Compare and the calculator's "What if" read player packs. The old pages read whole player
files: up to 457 KB brotli each, and about 13 ms of `JSON.parse`. A player pack is up to 347 KB, read in 0.5 ms. The
"What if" also works its totals out with prefix sums (`ui/playerpack.ts` `WeightedTotals`) instead of sorting the
player's whole list 41 times per change.

**Rendering at the edge**, measured by `node tools/edge-bench.mjs <export>`: the leaderboards cost 2–3 ms of CPU warm,
but 34–45 ms on a cold start (first-run compilation and setting up `Intl`), plus about 9 ms to load the code. Three
times that is far over the free plan's 10 ms a request, which can't be caught (error 1102). So pages go out in inline
mode (`edge/inline.ts`): their data slice and preloads, no markup. `edge/render.ts` is ready for the day it fits, or
for drawing first views ahead of time, at publish.
