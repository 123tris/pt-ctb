using System.Linq;

namespace PtCatch.Engine.Packs;

/// <summary>
/// Every pack's layout. This is the one contract between the engine and the web client: <c>ptcatch-engine gen-ts</c>
/// turns it into web/src/gen/packs.ts, so the two can't drift apart (what assets/js/core/model.js did for the JSON).
///
/// Conventions:
/// - Players are referred to by osu! id and maps by beatmap id across packs, so one new score changes only the packs
///   that hold it; a table's row number is used only inside its own pack (the boards, a search map's set).
/// - pp, accuracy and stars are hundredths (they're rounded to two places anyway): 106298 is 1,062.98pp.
/// - 0 is "none" where a value can't be 0 (a rank, a time, a score id); u32 0xFFFFFFFF is "missing" for a count.
/// </summary>
public static class Schemas
{
    /// <summary>A grade's code in the <c>grade</c> columns: its index here (0 for none).</summary>
    public static readonly string[] Grades = ["", "XH", "X", "SH", "S", "A", "B", "C", "D", "F"];

    /// <summary>The bought name colours, by code (0 for none): core/ui.js nameClass's palette.</summary>
    public static readonly string[] Colours = ["", "rosa", "gold", "mint", "sky", "lilac", "sand"];

    private static Col[] ScoreCols(bool pos) =>
    [
        new("map", ColKind.U32, "Beatmap id"),
        new("pp", ColKind.I32, "pp in hundredths"),
        new("acc", ColKind.U16, "Accuracy in hundredths of a percent"),
        new("combo", ColKind.U32, "Max combo (0xFFFFFFFF missing)"),
        new("miss", ColKind.U32, "Misses (0xFFFFFFFF missing)"),
        new("mods", ColKind.U32, "osu! mods bitmask"),
        new("grade", ColKind.U8, "Grade code (Schemas.Grades)"),
        new("score", ColKind.F64, "Classic score"),
        new("time", ColKind.U32, "When it was set, unix seconds (0 unknown)"),
        new("hits", ColKind.U32, "Fruits caught (0xFFFFFFFF missing)"),
        new("sid", ColKind.F64, "osu! score id: positive solo id, negative legacy id, 0 unknown"),
        .. pos ? [new Col("pos", ColKind.U16, "Position among Portuguese players on the map (0 none)")] : new Col[0],
    ];

    private static readonly Col[] SetCols =
    [
        new("set", ColKind.U32, "Beatmapset id (0 unknown)"),
        new("artist", ColKind.Str, "Artist"),
        new("title", ColKind.Str, "Title"),
        new("creator", ColKind.Str, "Mapper"),
    ];

    private static readonly Col[] MapCols =
    [
        new("id", ColKind.D32, "Beatmap id"),
        new("set", ColKind.U32, "Row in sets"),
        new("version", ColKind.Str, "Difficulty name"),
        new("stars", ColKind.I32, "Star rating in hundredths (catch stars where known)"),
        new("ar", ColKind.F32, "Approach rate"),
        new("maxCombo", ColKind.U32, "Max combo (0 unknown)"),
        new("mode", ColKind.U8, "0 osu! (a convert), 2 catch"),
    ];

    public static readonly PackSchema Core = new("core", "What every page needs: the players and their boards.",
    [
        new("info", "One row about the data", [
            new("generatedAt", ColKind.U32, "When the export ran, unix seconds"),
            new("scores", ColKind.U32, "Scores across the boards"),
            new("maps", ColKind.U32, "Maps with Portuguese plays"),
            new("cleared", ColKind.U32, "Ranked catch maps cleared"),
            new("total", ColKind.U32, "Ranked catch maps"),
        ]),
        new("players", "players.json, by column, in name order", [
            new("id", ColKind.U32, "osu! id"),
            new("name", ColKind.Str, "Username"),
            new("cv", ColKind.I32, "Converts pp, hundredths"),
            new("ul", ColKind.I32, "Loved pp, hundredths"),
            new("pp", ColKind.I32, "Official pp, hundredths"),
            new("rankC", ColKind.U16, "Rank on the converts board (0 none)"),
            new("rankU", ColKind.U16, "Rank on the loved board (0 none)"),
            new("rankR", ColKind.U16, "Rank on the ranked board (0 none)"),
            new("global", ColKind.U32, "Global rank (0 none)"),
            new("country", ColKind.U32, "Country rank (0 none)"),
            new("ppSource", ColKind.U8, "0 active on osu!, 1 inactive with no pp to go on, 2 last known, 3 estimated"),
            new("ppSeen", ColKind.U32, "When the last-known pp was seen, unix seconds (0 unknown)"),
            new("acc", ColKind.I32, "Accuracy, hundredths of a percent"),
            new("level", ColKind.I32, "Level, hundredths"),
            new("plays", ColKind.U32, "Play count"),
            new("ss", ColKind.U32, "SS grades"),
            new("s", ColKind.U32, "S grades"),
            new("a", ColKind.U32, "A grades"),
            new("countC", ColKind.U32, "Converts on their board"),
            new("countU", ColKind.U32, "Loved maps on their board"),
            new("countR", ColKind.U32, "Ranked maps on their board"),
            new("firstsC", ColKind.U32, "Converts #1s"),
            new("firstsU", ColKind.U32, "Loved #1s"),
            new("firstsR", ColKind.U32, "Ranked #1s"),
            new("danScore", ColKind.U32, "Dan points"),
            new("dan", ColKind.U32, "Dan stages passed, bit i for stage i"),
            new("last", ColKind.U32, "Newest play, unix seconds (0 none)"),
            new("colour", ColKind.U8, "Bought name colour (Schemas.Colours, 0 none)"),
            new("colourUntil", ColKind.U32, "When it ends, unix seconds (0 open-ended)"),
        ]),
        new("boardC", "The converts board: rows of players, best first", [new("row", ColKind.U16, "Row in players")]),
        new("boardU", "The loved board", [new("row", ColKind.U16, "Row in players")]),
        new("boardR", "The ranked (official pp) board", [new("row", ColKind.U16, "Row in players")]),
    ]);

    public static readonly PackSchema Player = new("player", "One player's file: every list of plays and the maps they're on.",
    [
        new("c", "Converts on their boards, most pp first", ScoreCols(true)),
        new("u", "Loved maps on their boards", ScoreCols(true)),
        new("r", "Ranked maps on their boards", ScoreCols(true)),
        new("top", "The dump's best ranked plays (official pp)", ScoreCols(false)),
        new("ppc", "Convert plays that count for pp but aren't on their map's board", ScoreCols(false)),
        new("pre", "Plays from before their map was ranked", ScoreCols(false)),
        new("dan", "Dan passes", [new("stage", ColKind.U8, "Stage index"), .. ScoreCols(false)]),
        new("sets", "The mapsets of the maps below (a set's maps by one mapper share a row)", SetCols),
        new("maps", "The maps these plays are on, by id", MapCols),
    ]);

    /// <summary>
    /// Every map with plays here: maps-search.json and search-maps.json in one, with the mappers. Stored by set, which
    /// compresses best; the maps page's order (most players first) is one sort of the players column when it's needed.
    /// </summary>
    public static readonly PackSchema Search = new("search", "Every map with Portuguese plays, for the maps page and the header search.",
    [
        new("sets", "Mapsets, by id", [
            new("set", ColKind.D32, "Beatmapset id"),
            new("artist", ColKind.Str, "Artist"),
            new("title", ColKind.Str, "Title"),
            new("mapper", ColKind.Str, "Mapper"),
        ]),
        new("tops", "The players holding a #1", [new("id", ColKind.U32, "osu! id")]),
        new("maps", "Maps by set, then id (the order that compresses best)", [
            new("id", ColKind.D32, "Beatmap id"),
            new("set", ColKind.D32, "Row in sets"),
            new("version", ColKind.Str, "Difficulty name"),
            new("stars", ColKind.U16, "Stars in hundredths"),
            new("cat", ColKind.U8, "1 converts, 2 loved, 3 ranked"),
            new("players", ColKind.U16, "Portuguese players with a play"),
            new("top", ColKind.U16, "Row in tops: the #1"),
        ]),
    ]);

    public static readonly PackSchema[] All = [Core, Player, Search];

    public static PackSchema ByName(string name) => All.First(s => s.Name == name);
}
