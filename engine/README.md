# The data engine

`ptcatch-engine` builds the site's public data from the bot's data folder, in C#. It replaces `tools/export.mjs` and
writes the same files **byte for byte**: same JSON, same content-hashed names in `meta.json`, same exporter state. So
switching to it uploads nothing new to R2 and empties nobody's cache.

```powershell
dotnet build engine/src/PtCatch.Engine.Cli -c Release
engine/src/PtCatch.Engine.Cli/bin/Release/net10.0/ptcatch-engine.exe export                      # into data/, as npm run export
engine/src/PtCatch.Engine.Cli/bin/Release/net10.0/ptcatch-engine.exe export --out <folder> --timings
dotnet test engine/PtCatch.Engine.slnx                                                          # the engine's tests
npm run engine:parity                                                                           # both exporters byte for byte, and the packs against the JSON
npm run gen                                                                                     # web/src/gen/packs.ts from the pack schemas
.\publish.ps1                                                                                   # publish (with the engine; -Node for the Node exporter)
```

`export` takes the Node exporter's arguments:
- `--data` (default `../PT-CTB-Bot-Data`) and `--country PT`;
- `--out`, a trial export with its own state in that folder;
- `--fetch-titles`, to ask the osu! API for maps the bot only knows by id and for converts' catch star ratings, with
  the bot's osu! app and the same caps (`src/PtCatch.Engine/Osu/OsuApi.cs`);
- `--offline`, to leave the avatar thumbnails as they are instead of re-checking them on osu!'s CDN once a day
  (`Osu/Avatars.cs`, WebP through SkiaSharp);
- `--packs`, to also write the binary packs under `packs/` (below);
- `--now <unix seconds>`, to run as of a fixed time;
- `--timings`, to print each stage's and system's milliseconds and the GC's work.

`publish.ps1` exports with the engine. `-Node` uses `tools/export.mjs` instead. The two share `state/` (the osu! cache
is written exactly as the Node exporter writes it), so switching back and forth is safe.

## How it's laid out

| Folder | What |
|---|---|
| `src/PtCatch.Engine/Js` | JavaScript's semantics where the bytes depend on them. `JsJsonWriter` writes what `JSON.stringify` writes: V8's number formatting and its string escaping. `JsMath` holds `Math.round` (halves up). `JsDate` holds `Date.parse` and Lisbon calendar fields. `JsSort` holds the stable sort and `localeCompare`. `JsString` holds `trim`. `JsNode` is a JSON tree that lists keys as JavaScript does |
| `src/PtCatch.Engine/World` | The data as columns: `Beatmaps`, `RawScores` (every score in the bot's files), `Tuples` (the site's score tuples), `BotData` |
| `src/PtCatch.Engine/Ingest` | Readers. Player files are read in parallel straight into columns. The 171 MB beatmap cache is kept as a binary column file, `state/beatmaps.ptcb`, reused while the source file is unchanged. Also the exporter's osu! API cache |
| `src/PtCatch.Engine/Osu` | The osu! API lookups and the avatar thumbnails (`tools/lib/osu-api.mjs`, `tools/lib/avatars.mjs`). A new avatar's WebP bytes differ from sharp's; an unchanged one keeps its file, and so its name |
| `src/PtCatch.Engine/Export` | `Build.*.cs` ports `tools/lib/build.mjs` and its libraries, one partial file per system (people, boards, maps, rankings, records, activity, challenges, completion, hill, duels, history, heads…). `Exporter.cs` ports `tools/export.mjs` |
| `src/PtCatch.Engine/Packs` | The PTCB pack format (`Ptcb.cs`), every pack's layout (`Schemas.cs`) and the TypeScript it generates (`GenTs.cs`). `Export/Build.Packs.cs` fills the packs from the systems' results |
| `src/PtCatch.Engine.Cli` | The `ptcatch-engine` command |
| `tests/PtCatch.Engine.Tests` | xUnit. The expected values are what Node gave for the same inputs |

**Data-oriented.**
- A list of plays is a list of row numbers into `Tuples`. Sorting, filtering or sharing a list never copies a play.
- A play's map row is resolved once into a column (`Tuples.MapRow`), not looked up per use. Map dates are parsed once
  per map (`Beatmaps.Freeze`).
- Each system is a method over these columns, run in the original's order. The files are written in parallel at the
  end.

## Keeping it the same as the Node exporter

- **One order.** Every order and tie-break follows the original:
  - insertion order of JavaScript `Map`s and objects;
  - integer-like keys first;
  - stable sorts;
  - `localeCompare` with the machine's locale.
- **One `JsJsonWriter`.** All output goes through it.
- **Check after every change.** Changing the exporter's logic means changing both (`tools/lib/*.mjs` and
  `Export/Build.*.cs`) until Node is retired. `npm run engine:parity` runs both exporters on the bot's data, two days
  in a row, and fails on any byte that differs. Run it before merging.

## Packs: the data the new web client reads

The JSON files are what the old pages read. The rebuilt client (`web/`) reads **packs** instead.
- **Format.** A pack is a short JSON header and then columns. The browser wraps each column in a typed array over the
  bytes it downloaded: no `JSON.parse`, no object per row. Strings are decoded only when shown.
- **Layout.** `Packs/Schemas.cs` defines every pack. `ptcatch-engine gen-ts` (`npm run gen`) turns it into
  `web/src/gen/packs.ts`, whose types and layout hash the client reads them with, through `web/src/kernel/ptcb.ts`. CI
  fails while the two disagree, and a pack of another layout is refused, not misread.
- **Identity.** Players are referred to by osu! id and maps by beatmap id across packs. pp, accuracy and stars are
  hundredths. Ids that rise (d32) and strings (lengths, then bytes) are added up once on reading, because small numbers
  compress several times better than the values themselves.
- **Checked.** `web/test/packs.test.mjs` reads every pack with the client's own reader and compares it, value by value,
  with the JSON of the same export. `npm run engine:parity` runs it.
- **Published with the JSON.** `--packs` (which `publish.ps1` passes) writes `packs/*.ptcb` and their manifest,
  `packs.json`: each pack's content hash, in the shape of `meta.json`, which stays the JSON's alone (so it's still the
  same as the Node exporter's). `tools/r2-sync.mjs` uploads the packs under hashed names (`packs/core.<hash>.ptcb`),
  then `packs.json` after `meta.json`, and keeps them a day after the manifest stops naming them, as it does the JSON.
  An export without packs (`publish.ps1 -Node`) leaves R2's `packs.json`, and its packs, as they were.

| | JSON, brotli | Pack, brotli | Read: JSON.parse vs pack |
|---|---|---|---|
| Players (`core`) | 9 KB | 7 KB | |
| Largest player (`player/6205809`) | 457 KB | 374 KB | 12.8 ms vs 0.5 ms |
| All 110 player files | 6,960 KB | 5,800 KB | |
| Maps index and header search (`search`) | 1,153 KB (two files) | 850 KB | about 20 ms vs 1.4 ms |

## Speed (2026-11-03, a busy desktop, warm file cache)

| | Node exporter | Engine |
|---|---|---|
| Export, wall time | 13.5–14.7 s | 3.6–3.8 s |
| Beatmap cache load | 2.1 s (gunzip + parse) | 0.03 s (binary columns) |
| Writing ~56 MB of JSON | about 1 s | 0.35 s (in parallel) |

`--timings` breaks a run down by stage and by system. The next steps are:
- incremental runs, reusing the previous run's columns for unchanged player files;
- fewer allocations (the GC still pauses for about 0.5 s).
