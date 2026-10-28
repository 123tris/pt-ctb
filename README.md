# PT-CTB

*The site of Portugal's osu!catch community:* leaderboards, profiles, the Dan course, challenges, games and records,
built from the data the [PT-CTB Discord bot](https://github.com/123tris/PT-CTB-Discord-Bot) collects.

It is a static site (plain HTML/CSS/ES modules, no bundler) served by Cloudflare Pages at <https://ptcatch.com>, which
builds it from this repo on every push. The old GitHub Pages address forwards there. All pages are in English.

## How it works

```
PT-CTB-Bot-Data (private)  ──tools/export.mjs──►  data/*.json  ──publish.ps1 (R2)──►  https://data.ptcatch.com
                                                      site code  ──Cloudflare Pages──►  https://ptcatch.com (reads the data)
```

- `tools/export.mjs` reads the bot's private data folder (`../PT-CTB-Bot-Data` by default) and writes the public JSON
  under `data/`. Only home-country players' public osu! data is exported: usernames, scores and profile stats.
  Discord ids, the verification log and per-user settings are never read.
- `--fetch-titles` looks up maps the bot's cache only knows by id on the osu! API, using the bot's own osu! app
  (`OSU_CLIENT_ID`/`OSU_CLIENT_SECRET`, or the bot's user-secrets). Results are cached in `state/beatmaps.json`, so
  each map is fetched once.
- `state/state.json` remembers the previous export, which is how the activity feed spots overtakes and pp milestones,
  and which map was picked for each week's challenge. `data/history.json` keeps one pp point per player per day.
- Files are only rewritten when their content changes, and `publish.ps1` uploads only new files to R2 (under
  content-hashed names, `meta.json` last), so an export with nothing new sends nothing. `data/` and `state/` aren't in
  git; R2 keeps them (state in a private bucket), and `publish.ps1` restores them into a fresh checkout.

`assets/js/core/model.js` defines the data shapes (score and beatmap tuples, categories, mods, the catch pp formula)
and is imported by both the exporter and the pages, so the two can't drift apart.

## Pages

| Route | What |
|---|---|
| `#/` | Home: top 5s, map of the week, latest activity, how to join |
| `#/rankings/{converts,loved,ranked,mods,plays}` | Leaderboards, osupepe-style mod rankings, and the country's top plays (by source and mod) |
| `#/players`, `#/player/{id}/{tab}` | Player list (the header search's "all results", not in the nav) and profiles (scores, Dan, pp history) |
| `#/maps`, `#/map/{id}` | Map search and per-map Portuguese leaderboards |
| `#/activity`, `#/activity?view=plays` | Snipes, top plays, Dan passes, overtakes; recent plays |
| `#/challenges/{week,dan,targets}` | This week (map of the week); the Dan course (`?stage={n}`; old `#/dan` links redirect here); snipe targets (vulnerable #1s, bounties, one-player maps, unclaimed) |
| `#/glossary` | pp, converts, grades, mods and the community's words, for newcomers |
| `#/games/{guess,higher-lower}` | Guess the map from its cover; higher or lower |
| `#/calculator` | Catch pp calculator and "what if" pp gain |
| `#/compare/{a}/{b}` | Head to head |
| `#/records` | Records and community stats |
| `#/rankings/kings` | King of each whole-star range (10★ and above combined), with separate catch and convert boards; tied totals share the title |
| `#/recap/{id}/{year}` | A player's year in review |
| `#/commands`, `#/verify`, `#/team` | Bot commands, how `/verify` works, Team Portugal |

Filters, sort and page are kept in the hash's query (e.g. `#/maps?q=freedom&cat=r&page=2`), so Back and shared links
restore them.

## Running it

```powershell
npm run export            # node --max-old-space-size=4096 tools/export.mjs
npm run serve             # http://localhost:8080/ (live data; add -- --local-data for data/)
npm run build             # dist/: what Cloudflare Pages publishes (tools/build-site.mjs)
npm test                  # all tests
.\publish.ps1             # on main only: export (with --fetch-titles), upload what changed to R2
.\install-publish-task.ps1   # run publish.ps1 every 15 minutes
node tools/r2-sync.mjs status   # R2 usage against the free-tier caps
```

Needs Node 18+. Settings that aren't data (the Discord invite link, the site's addresses) live in
`assets/js/config.js`; the per-branch ones are filled in by the build.

## Branches, hosting and "Sign in with osu!"

`main` is the release site, <https://ptcatch.com>, and `dev` is the development site, <https://dev.ptcatch.com>.
Cloudflare Pages builds both on every push. Work happens on `dev` and is released by merging `dev` into `main`. Both
read the same data from <https://data.ptcatch.com> (Cloudflare R2), which publish.ps1 updates from `main` only, with
hard caps that keep it inside R2's free tier.

Cloudflare Pages publishes only what `tools/build-site.mjs` copies to `dist/` (the pages, `assets/` and `_headers`),
so `tools/` and the scripts stay private. The same script applies each branch's settings:
address, DEV marker and noindex on dev, sign-in from the `SIGN_IN` build variable. `_headers` sets the security and
cache headers.
`functions/auth/` (code in `signin/oauth.js`) runs osu!'s OAuth on the site's own address, because the exchange
needs a client secret a static page can't hold. Visitors get back only their osu! id and name, which fill the same
"This is me" preference. The setup steps (Pages project, domains, branches, R2 data, osu! apps, secrets) are in
[SETUP-HOSTING.md](SETUP-HOSTING.md).
