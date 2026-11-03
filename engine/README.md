# The data engine

`ptcatch-engine` builds the site's public data from the bot's data folder, in C#. It replaces `tools/export.mjs` and
writes the same files **byte for byte**: same JSON, same content-hashed names in `meta.json`, same exporter state. So
switching to it uploads nothing new to R2 and empties nobody's cache.

```powershell
dotnet build engine/src/PtCatch.Engine.Cli -c Release
engine/src/PtCatch.Engine.Cli/bin/Release/net10.0/ptcatch-engine.exe export                      # into data/, as npm run export
engine/src/PtCatch.Engine.Cli/bin/Release/net10.0/ptcatch-engine.exe export --out <folder> --timings
dotnet test engine/PtCatch.Engine.slnx                                                          # the engine's tests
npm run engine:parity                                                                           # both exporters, compared byte for byte
.\publish.ps1 -Engine                                                                           # publish with the engine
```

`export` takes the Node exporter's arguments: `--data` (default `../PT-CTB-Bot-Data`), `--country PT`, and `--out` (a
trial export, with its own state in that folder). It also takes `--now <unix seconds>`, to run as of a fixed time,
and `--timings`, to print each stage's and system's milliseconds and the GC's work. It doesn't call the osu! API for
missing titles or make new avatar thumbnails yet. Those it already has are kept, so `publish.ps1` keeps the Node
exporter by default until it does.

## How it's laid out

| Folder | What |
|---|---|
| `src/PtCatch.Engine/Js` | JavaScript's semantics where the bytes depend on them. `JsJsonWriter` writes what `JSON.stringify` writes: V8's number formatting and its string escaping. `JsMath` holds `Math.round` (halves up). `JsDate` holds `Date.parse` and Lisbon calendar fields. `JsSort` holds the stable sort and `localeCompare`. `JsNode` is a JSON tree that lists keys as JavaScript does |
| `src/PtCatch.Engine/World` | The data as columns: `Beatmaps`, `RawScores` (every score in the bot's files), `Tuples` (the site's score tuples), `BotData` |
| `src/PtCatch.Engine/Ingest` | Readers. Player files are read in parallel straight into columns. The 171 MB beatmap cache is kept as a binary column file, `state/beatmaps.ptcb`, reused while the source file is unchanged. Also the exporter's osu! API cache |
| `src/PtCatch.Engine/Export` | `Build.*.cs` ports `tools/lib/build.mjs` and its libraries, one partial file per system (people, boards, maps, rankings, records, activity, challenges, completion, history, heads…). `Exporter.cs` ports `tools/export.mjs` |
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

## Speed (2026-11-03, a busy desktop, warm file cache)

| | Node exporter | Engine |
|---|---|---|
| Export, wall time | 13.5–14.7 s | 3.6–3.8 s |
| Beatmap cache load | 2.1 s (gunzip + parse) | 0.03 s (binary columns) |
| Writing ~56 MB of JSON | about 1 s | 0.35 s (in parallel) |

`--timings` breaks a run down by stage and by system. The next steps are:
- incremental runs, reusing the previous run's columns for unchanged player files;
- fewer allocations (the GC still pauses for about 0.5 s).
