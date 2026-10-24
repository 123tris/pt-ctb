# PT-CTB

*The site of Portugal's osu!catch community:* leaderboards, profiles, the Dan course, challenges, games and records,
built from the data the [PT-CTB Discord bot](https://github.com/123tris/PT-CTB-Discord-Bot) collects.

It is a static site (plain HTML/CSS/ES modules, no build step) served by GitHub Pages. All pages are in English.

## How it works

```
PT-CTB-Bot-Data (private)  ──tools/export.mjs──►  data/*.json (public)  ──GitHub Pages──►  the site
```

- `tools/export.mjs` reads the bot's private data folder (`../PT-CTB-Bot-Data` by default) and writes the public JSON
  under `data/`. Only home-country players' public osu! data is exported: usernames, scores and profile stats.
  Discord ids, the verification log and per-user settings are never read.
- `--fetch-titles` looks up maps the bot's cache only knows by id on the osu! API, using the bot's own osu! app
  (`OSU_CLIENT_ID`/`OSU_CLIENT_SECRET`, or the bot's user-secrets). Results are cached in `state/beatmaps.json`, so
  each map is fetched once.
- `state/state.json` remembers the previous export, which is how the activity feed spots overtakes and pp milestones,
  and which map was picked for each week's challenge. `data/history.json` keeps one pp point per player per day.
- Files are only rewritten when their content changes, so an export with nothing new leaves git clean.

`assets/js/core/model.js` defines the data shapes (score and beatmap tuples, categories, mods, the catch pp formula)
and is imported by both the exporter and the pages, so the two can't drift apart.

## Pages

| Route | What |
|---|---|
| `#/` | Home: top 5s, map of the week, latest activity, how to join |
| `#/rankings/{converts,loved,ranked,mods}` | Leaderboards, plus osupepe-style mod rankings |
| `#/players`, `#/player/{id}/{tab}` | Player list and profiles (scores, Dan, pp history) |
| `#/maps`, `#/map/{id}` | Map search and per-map Portuguese leaderboards |
| `#/dan?stage={n}` | The Dan course ladder, passers and roles |
| `#/activity`, `#/activity?view=plays` | Snipes, top plays, Dan passes, overtakes; recent plays |
| `#/challenges` | Map of the week, vulnerable #1s, one-player maps, unclaimed ranked maps |
| `#/games/{guess,higher-lower}` | Guess the map from its cover; higher or lower |
| `#/calculator` | Catch pp calculator and "what if" pp gain |
| `#/compare/{a}/{b}` | Head to head |
| `#/records` | Records and community stats |
| `#/recap/{id}/{year}` | A player's year in review |
| `#/commands`, `#/verify` | Bot commands and how `/verify` works |

## Running it

```powershell
npm run export            # node --max-old-space-size=4096 tools/export.mjs
npm run serve             # http://localhost:8080/
.\publish.ps1             # export (with --fetch-titles), commit data/ + state/, push
.\install-publish-task.ps1   # optional: run publish.ps1 every 4 hours
```

Needs Node 18+. Settings that aren't data (the Discord invite link) live in `assets/js/config.js`.
