# The new web client

The site has been rebuilt for speed in TypeScript, next to the old client in `assets/js`, which stays as the fallback.
The new client draws every page, and the app around them: the router, the header's menus, search and You menu, sign-in,
the language switch, the usage counts and the footer (`src/app.ts`). A page reads **packs**: binary columns the C#
engine writes ([engine/README.md](../engine/README.md)).

Ported:
- the app itself (`src/app.ts`, with `src/client/`): a visit loads no old module but the settings (`config.js`) and,
  in Portuguese, the strings (`pt.js`). The app is 3 files and 27 KB brotli before the page's own code, where the old
  one was 24 files and 61 KB (measured below);
- the home page, from the core pack and the engine's `home.json`: 9 KB brotli instead of ~66 KB of JSON from six
  files;
- every Leaderboards tab (`/rankings/…`);
- a player's profile, every tab (`/player/:id/:tab?`). The player comes from the core pack, the rest from the JSON the
  old page reads, and `history.json` (every player's) only once the pp chart is opened;
- a map's page (`/map/:id`): the map and its board from its bucket (`maps/<id % 128>.json`), the players from the core
  pack, the rest from the JSON the old page reads;
- the calculator and compare (on player packs);
- a player's yearly recap (`/recap/:id/:year?`), from their pack where the old page read their whole file;
- the shop (`/shop`): the wallet from economy.json, the visitor's badges and best plays from their head file, and the
  buying itself through Bananas requests (`client/bananas.ts`);
- Activity and Records;
- the players list, commands, glossary, privacy, how to join and Team Portugal;
- the maps list (`/maps`), from the search pack: a search takes 1–5 ms instead of 20–60, with the same results in the
  same order (`test/maps.test.mjs` checks them against the old search's). A first visit draws its first page from
  maps-top.json (43 KB), as the old page did, while the pack (about 850 KB brotli) loads; a repeat visit draws from the
  pack in the browser's cache.
- Challenges, every tab (`/challenges/:tab?`: the week, King of the hill, duels, the Dan course, snipe targets, bounties
  with their Bananas, completion with its years): players from the core pack, the rest from the JSON the old page
  reads, the tab's own file only on that tab. Its figures and chips still read meta.json (King of the hill's month, the
  duels and the goal in brief).
- a duel's page (`/duel/:id`), from its file (`duels/<n>.json`) and the core pack.
- the admin panel (`/admin`): the players from the core pack (names, the player picker), the rest from the JSON the
  old page reads (admin.json, hill.json, bounties.json) and the admin's own requests from the site's endpoints. Signed
  out, it loads nothing.

Still the old client's: nothing a visit loads. The old app and pages (`assets/js`) are the fallback: index.html loads
the old app where the new one can't load (the github.io copy, served from the repo as it is, has no `assets/web`), and a
page whose data has no packs is drawn by its old page, inside the new app.

Each port is checked against the old page's output or logic on the same data (`test/`).

## How a page gets to the screen

1. **The edge.** `functions/[[path]].js` sends `index.html` as before. For a page the new client draws, it also writes
   in that page's slice of `packs.json` and `meta.json` and a preload of each file its first view needs
   (`src/routes.ts`, `edge/inline.ts`). The browser starts on the data while it reads the page. The old pages wait for
   `meta.json`, and only then fetch their data.
2. **The app** (`src/app.ts`, `assets/web/app.js`, which index.html loads) matches the address (`src/pages.ts`) and
   loads the page's entry, `assets/web/<page>.js`, which index.html has already started fetching
   (`tools/build-site.mjs`).
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
| `src/ui` | Shared markup, as `assets/js/core/ui.js` has it: `players.ts` (over the core pack), `maps.ts`, `scores.ts` (over the JSON's tuples), `page.ts` (headings, tabs, tables, chips, stats, a page of a list). And the pure parts of the other core modules, under their names, as pages need them: `badges.ts`, `bananas.ts`, `bounty.ts`, `charts.ts`, `events.ts`, `hill.ts`, `ladder.ts`, `star-range.ts`, `shop.ts` (the shop's catalogue), `requests.ts` (a player's requests to the bot). `map-search.ts` is the Maps search over the search pack, `header-search.ts` the header search's matching and list |
| `src/views` | One page each. `x.ts` holds `render(ctx, data, state)`, which is pure and so can run at the edge too. `x.mount.ts` holds the browser-only half |
| `src/app.ts` | The app: the router (pages, sub-views, focus, scroll, the loading state, error pages), the nav and its menus, the language, the footer. The bundle's first entry point |
| `src/pages.ts` | The router's page table (each address's entry and old page) and its pure rules: sub-views, and what the usage counts call a page |
| `src/entries` | Each page's module, which the app loads (and the old router, where the app can't load): with `app.ts`, the bundle's entry points (`tools/web-build.mjs`) |
| `src/client` | The browser's side. `boot.ts` builds the visitor's `Ctx` and the store, `page.ts` turns a view into a page for the router, and `shell.ts` gathers what the app runs: `search.ts` (the header search; its matching is `ui/header-search.ts`), `you.ts` (the You menu and sign-in), `track.ts` (usage counts), `consent.ts`, `reveal.ts`, `fun.ts` (toasts, easter eggs), `tips.ts` (badges and tags that explain themselves), `moved.ts`, `i18n.ts` (the visitor's language). `ui.ts`, `bananas.ts`, `chart-hover.ts`, `dom.ts` and `star-slider.ts` hold what pages use in the browser. `config.ts` is the site's settings (`assets/js/config.js`) |
| `src/routes.ts` | Which addresses the new client draws, and the packs and JSON each one's first view needs |
| `edge` | What the Cloudflare Function runs: the packs slice now, server rendering later |
| `test` | `node --test`: packs against the JSON, views drawn in Node |

**Data-oriented.** Over a pack, a view works with columns and row numbers. A player is a row in `core.players`
(`rowOf(players, id)` finds one by osu! id), and a board is a list of rows. Nothing builds an object per player.
Strings are decoded only when shown.

**The old site's modules.** Two stay imports of the very file under `assets/js` (`tools/web-build.mjs`): the settings
(`config.js`, which the build fills in per branch) and the Portuguese strings (`core/pt.js`, which only Portuguese
visitors load, and which `node tools/i18n-check.mjs` also checks against `src/`). The old modules with no browser code
(`model.js`, `routes.js`, `maps-search.js`, `data-name.js`, `legends.js`, `presets.js`) are bundled in like the
client's own. The build refuses anything else from there: it's the old app's browser code, which would run twice.

**Chunks.** Every page's entry reaches the app's shell (`src/client/page.ts` imports `shell.ts`), so esbuild puts the
shell and what the pages share with it in one chunk, which `app.js` loads with it, instead of one chunk per set of
pages that share a module. A page adds only its own chunks.

## Porting a page

1. Decide where the data comes from: the core pack for players, and for the rest, an existing pack or the JSON file
   the old page reads. If the page needs a new pack, add it to `engine/src/PtCatch.Engine/Packs/Schemas.cs` and
   `Export/Build.Packs.cs`. Then run `npm run gen`, and extend `test/packs.test.mjs` to compare it with the JSON.
2. Write `src/views/<page>.ts` (`render`) and `<page>.mount.ts` from the old `assets/js/pages/<page>.js`. Keep its
   markup and classes, so `site.css` styles it the same, and keep its strings, so `pt.js` already has them. Take
   `t`/`fmt`/`now` from `ctx`, never from a global, so `render` stays pure.
3. Add `src/entries/<page>.ts`, a `page({ … })`, and the page's route and first data to `src/routes.ts`.
4. A new address also goes in `assets/js/core/routes.js` and `src/pages.ts` (its entry and old page), and in the old
   router's `LOADERS` (`assets/js/app.js`), which stands in where the app can't load.
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

## Real visitors: the old app's baseline (ptcatch.com, 2026-10-30 to 2026-11-05)

From the /stats Health view, before the new app was released: the numbers to compare it with. They're median / 75th
percentile; the 30 days to 2026-11-05 say the same within a few percent.

| First page of a visit | Phone | Desktop | All |
|---|---|---|---|
| Server response (TTFB) | 307 / 641 ms | 209 / 364 ms | 233 / 441 ms |
| First paint | 1.0 / 1.3 s | 568 / 852 ms | 620 / 940 ms |
| Largest paint | 1.4 / 1.8 s | 1.1 / 1.8 s | 1.2 / 1.8 s |
| Page loaded | 636 ms / 1.0 s | 546 ms / 1.0 s | 561 ms / 1.0 s |

| Page drawn (address changed → drawn, data included) | Median | 75th % | 95th % | Over 1 s |
|---|---|---|---|---|
| All pages | – | 481 ms | – | – |
| Home (mostly the first page of a visit) | 365 ms | 902 ms | 3.1 s | 22% |
| Map | 362 ms | 703 ms | 1.4 s | 17% |
| Challenges, Completion | 342 ms | 525 ms | 1.0 s | 5% |
| Profile | 302 ms | 505 ms | 1.3 s | 9% |
| Maps | 268 ms | 479 ms | 844 ms | 0% |
| Activity | 232 ms | 474 ms | 987 ms | 2% |

| Data download (not from the browser's cache) | Median | 75th % | 95th % | Over 1 s |
|---|---|---|---|---|
| `meta.json`, before any page's data | 288 ms | 487 ms | 1.6 s | 7% |
| A player file | 438 ms | 674 ms | 1.4 s | 17% |
| A map bucket | 360 ms | 540 ms | 887 ms | 4% |
| `search-maps.json` | 1.0 s | 1.1 s | 2.9 s | 80% |

What to watch once the new app is out (the Health view's "Old app and new app" table):
- **Largest paint and page drawn**, home and profiles above all: the new app doesn't wait for `meta.json`, which was
  on the way to every page's data.
- **Server response for the front page**, which now goes through the page Function, as other pages already did.
- **The slowest answer to a tap or key (INP)**: the old app records none of it before this tracking is released, so
  its baseline is the lab's (maps search: 47–84 ms a query on this desktop, against 1–5 ms).
- Pages drawn by **"New app, old page"**: the old page standing in. They should be rare once packs are published.

## Measured: the app (2026-11-05, this desktop)

The built `dist/`, old shell (`assets/js/app.js`) against new (`src/app.ts`), served locally with every response held
back 80 ms, in headless Chrome; the median of five runs. Files and brotli KB (quality 11) of the JavaScript that had
arrived before the page's heading was drawn.

| | Old shell | New |
|---|---|---|
| The shell's code (its static imports, before it can run) | 24 files, 60.7 KB | 3 files, 26.8 KB |
| Home, first visit: code before it's drawn | 41 files, 86.3 KB | 11 files, 38.7 KB |
| Home, first visit: drawn after | 900 ms | 412 ms |
| Profile, first visit: code before it's drawn | 43 files, 95.4 KB | 14 files, 50.8 KB |
| Profile, first visit: drawn after | 992 ms | 533 ms |
| Home, repeat visit: drawn after (all code from the cache) | 139 ms | 129 ms |
| Profile, repeat visit: drawn after | 154 ms | 145 ms |

The three files are `app.js`, the shell's chunk and `config.js`; Portuguese adds `pt.js` (41 KB) to both. On a first
visit the page now draws with its first paint: the old app painted the header at about the same moment, and the page
half a second later.

## Measured: the leaderboards (2026-11-04, this desktop)

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
