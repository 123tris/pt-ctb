using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;
using PtCatch.Engine.Packs;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    private static int Hundredths(double v) => double.IsNaN(v) ? 0 : (int)JsMath.Round(v * 100);

    private static uint U32(double v) => double.IsNaN(v) || v < 0 ? uint.MaxValue : (uint)v;

    private static uint TimeOrZero(double v) => double.IsNaN(v) || v <= 0 ? 0 : (uint)v;

    private static byte GradeCode(string grade)
    {
        var i = Array.IndexOf(Schemas.Grades, grade ?? "");
        return (byte)(i < 0 ? 0 : i);
    }

    /// <summary>
    /// The PTCB packs (Packs/Schemas.cs) from what the systems worked out: the same data as the JSON files, by column.
    /// Runs after <see cref="Run"/>. <paramref name="fileHash"/> gives a published file's hash (the avatar thumbnails'),
    /// or null when there's no such file.
    /// </summary>
    public List<(string Name, byte[] Bytes)> Packs(Func<string, string> fileHash)
    {
        var packs = new List<(string, byte[])>
        {
            ("packs/core.ptcb", CorePack(fileHash)), ("packs/search.ptcb", SearchPack()), ("packs/home.json", HomeFile()),
            ("packs/years.ptcb", YearsPack()),
        };
        var files = playerFiles.Values.ToList();
        var bytes = new byte[files.Count][];
        System.Threading.Tasks.Parallel.For(0, files.Count, i => bytes[i] = PlayerPack(files[i]));
        for (var i = 0; i < files.Count; i++)
        {
            packs.Add(($"packs/player/{files[i].Person.Id}.ptcb", bytes[i]));
        }
        return packs;
    }

    /// <summary>
    /// packs/home.json: just what the home page shows, which the old one gathers from five files (activity, challenges,
    /// records, bounties and meta.json, about 59 KB brotli): the five newest events and the maps they name, the map of
    /// the week with how many plays and players it has, the week so far, the throne's #1s, the open bounties, and
    /// meta.json's totals, completion goal and hill. JSON: a handful of mixed records, too few for columns to pay.
    /// </summary>
    private byte[] HomeFile()
    {
        var mapIds = new List<int>();
        var events = JsNode.Array();
        foreach (var e in activityEvents.Take(5))
        {
            events.Add(e);
            var map = e["s"].Truthy ? e["s"][0] : e["m"];
            if (map.Truthy)
            {
                mapIds.Add((int)map.ToNumber());
            }
        }
        var week = challenges["week"];
        var weekNode = JsNode.NullValue;
        if (week.Truthy)
        {
            weekNode = JsNode.Object().Set("map", week["map"]).Set("end", week["end"])
                .Set("plays", week["weekly"].Count).Set("players", week["board"].Count);
            mapIds.Add((int)week["map"].ToNumber());
        }
        var top = challenges["weekly"]["current"]["top"];
        if (top.Truthy)
        {
            mapIds.Add((int)top[2].ToNumber());
        }
        var open = bountiesFile["open"];
        var bountyMaps = JsNode.Object();
        foreach (var b in open.Items)
        {
            var key = JsMath.ToString(b[0].Number);
            if (bountiesFile["maps"][key].Kind != JsKind.Undefined)
            {
                bountyMaps.Set(key, bountiesFile["maps"][key]);
            }
        }
        var home = JsNode.Object()
            .Set("totals", Meta["totals"])
            .Set("completion", Meta["completion"].Kind == JsKind.Undefined ? JsNode.NullValue : Meta["completion"])
            .Set("hill", Meta["hill"].Kind == JsKind.Undefined ? JsNode.NullValue : Meta["hill"])
            .Set("events", events)
            .Set("week", weekNode)
            .Set("weekly", challenges["weekly"].Kind == JsKind.Undefined ? JsNode.NullValue : challenges["weekly"])
            .Set("maps", MapsForNode(mapIds))
            .Set("throne", records["throne"]["held"].Kind == JsKind.Undefined ? JsNode.NullValue : records["throne"]["held"])
            .Set("bounties", JsNode.Object().Set("open", open.Kind == JsKind.Undefined ? JsNode.Array() : open).Set("maps", bountyMaps));
        return Encoding.UTF8.GetBytes(home.Stringify());
    }

    private byte[] CorePack(Func<string, string> fileHash)
    {
        var n = players.Count;
        var id = new uint[n];
        var name = new string[n];
        var cv = new int[n];
        var ul = new int[n];
        var pp = new int[n];
        var rankC = new ushort[n];
        var rankU = new ushort[n];
        var rankR = new ushort[n];
        var global = new uint[n];
        var country = new uint[n];
        var ppSource = new byte[n];
        var ppSeen = new uint[n];
        var acc = new int[n];
        var level = new int[n];
        var plays = new uint[n];
        var ss = new uint[n];
        var s = new uint[n];
        var a = new uint[n];
        var countC = new uint[n];
        var countU = new uint[n];
        var countR = new uint[n];
        var firstsC = new uint[n];
        var firstsU = new uint[n];
        var firstsR = new uint[n];
        var danScore = new uint[n];
        var dan = new uint[n];
        var last = new uint[n];
        var colour = new byte[n];
        var colourUntil = new uint[n];
        var avatar64 = new string[n];
        var avatar128 = new string[n];
        var rowOf = new Dictionary<int, ushort>();
        for (var i = 0; i < n; i++)
        {
            var p = players[i];
            id[i] = (uint)p["id"].Number;
            rowOf[(int)id[i]] = (ushort)i;
            name[i] = p["name"].Text;
            cv[i] = Hundredths(p["cv"].Number);
            ul[i] = Hundredths(p["ul"].Number);
            pp[i] = Hundredths(p["pp"].Number);
            rankC[i] = (ushort)p["rank"]["c"].ToNumber();
            rankU[i] = (ushort)p["rank"]["u"].ToNumber();
            rankR[i] = (ushort)p["rank"]["r"].ToNumber();
            global[i] = (uint)p["global"].ToNumber();
            country[i] = (uint)p["country"].ToNumber();
            ppSource[i] = (byte)(!p["inactive"].Truthy ? 0 : p["ppSource"].Text switch { "last-known" => 2, "estimated" => 3, _ => 1 });
            ppSeen[i] = TimeOrZero(p["ppSeen"].ToNumber());
            acc[i] = Hundredths(p["acc"].Number);
            level[i] = Hundredths(p["level"].Number);
            plays[i] = (uint)p["plays"].ToNumber();
            ss[i] = (uint)p["grades"][0].ToNumber();
            s[i] = (uint)p["grades"][1].ToNumber();
            a[i] = (uint)p["grades"][2].ToNumber();
            countC[i] = (uint)p["count"]["c"].Number;
            countU[i] = (uint)p["count"]["u"].Number;
            countR[i] = (uint)p["count"]["r"].Number;
            firstsC[i] = (uint)p["firsts"]["c"].Number;
            firstsU[i] = (uint)p["firsts"]["u"].Number;
            firstsR[i] = (uint)p["firsts"]["r"].Number;
            danScore[i] = (uint)p["danScore"].ToNumber();
            foreach (var stage in p["dan"].Items)
            {
                dan[i] |= 1u << (int)stage.Number;
            }
            last[i] = TimeOrZero(p["last"].ToNumber());
            if (p["nc"].IsString)
            {
                colour[i] = (byte)Math.Max(0, Array.IndexOf(Schemas.Colours, p["nc"].Text));
                colourUntil[i] = TimeOrZero(p["ncu"].ToNumber());
            }
            avatar64[i] = fileHash($"avatars/{id[i]}-64.webp") ?? "";
            avatar128[i] = fileHash($"avatars/{id[i]}-128.webp") ?? "";
        }
        var w = new PackWriter(Schemas.Core);
        w.Table("info", 1)
            .Column("info", "generatedAt", new[] { (uint)now })
            .Column("info", "scores", new[] { (uint)records["totals"]["scores"].Number })
            .Column("info", "maps", new[] { (uint)boards.Count })
            .Column("info", "cleared", new[] { (uint)completionFile["cleared"].Number })
            .Column("info", "total", new[] { (uint)completionFile["total"].Number })
            .Column("info", "dump", new[] { bot.LastImportedDump ?? "" });
        w.Table("players", n);
        foreach (var (col, values) in new (string, Array)[]
        {
            ("id", id), ("name", name), ("cv", cv), ("ul", ul), ("pp", pp), ("rankC", rankC), ("rankU", rankU), ("rankR", rankR),
            ("global", global), ("country", country), ("ppSource", ppSource), ("ppSeen", ppSeen), ("acc", acc), ("level", level),
            ("plays", plays), ("ss", ss), ("s", s), ("a", a), ("countC", countC), ("countU", countU), ("countR", countR),
            ("firstsC", firstsC), ("firstsU", firstsU), ("firstsR", firstsR), ("danScore", danScore), ("dan", dan), ("last", last),
            ("colour", colour), ("colourUntil", colourUntil), ("avatar64", avatar64), ("avatar128", avatar128),
        })
        {
            w.Column("players", col, values);
        }
        foreach (var (table, cat) in new[] { ("boardC", Cat.Convert), ("boardU", Cat.Loved) })
        {
            var rows = order[cat].Select(p => rowOf[p.Id]).ToArray();
            w.Table(table, rows.Length).Column(table, "row", rows);
        }
        var shown = OfficialBoard(rankR, ppSource, pp);
        w.Table("boardR", shown.Length).Column("boardR", "row", shown);
        return w.ToArray();
    }

    /// <summary>
    /// The ranked page's board (assets/js/pages/rankings.js): everyone with an osu! rank, and players inactive on osu!
    /// (who keep their official pp) with pp above 0, by pp, then osu! rank, else in players.json order.
    /// </summary>
    private static ushort[] OfficialBoard(ushort[] rank, byte[] ppSource, int[] pp)
    {
        var rows = new List<ushort>();
        for (var i = 0; i < rank.Length; i++)
        {
            if (rank[i] > 0 || (ppSource[i] > 0 && pp[i] > 0))
            {
                rows.Add((ushort)i);
            }
        }
        var noRank = int.MaxValue;
        JsSort.Stable(rows, (a, b) =>
        {
            var byPp = pp[b].CompareTo(pp[a]);
            return byPp != 0 ? byPp : (rank[a] > 0 ? rank[a] : noRank).CompareTo(rank[b] > 0 ? rank[b] : noRank);
        });
        return rows.ToArray();
    }

    /// <summary>A list of plays as a table of score columns (with each play's position on its map when asked).</summary>
    private void ScoreTable(PackWriter w, string table, IReadOnlyList<int> tuples, int uid, bool pos, byte[] stages = null)
    {
        var n = tuples.Count;
        var map = new uint[n];
        var pp = new int[n];
        var acc = new ushort[n];
        var combo = new uint[n];
        var miss = new uint[n];
        var mods = new uint[n];
        var grade = new byte[n];
        var score = new double[n];
        var time = new uint[n];
        var hits = new uint[n];
        var sid = new double[n];
        var position = new ushort[n];
        for (var i = 0; i < n; i++)
        {
            var t = tuples[i];
            map[i] = (uint)T.Map[t];
            pp[i] = Hundredths(T.Pp[t]);
            acc[i] = (ushort)Hundredths(T.Acc[t]);
            combo[i] = U32(T.Combo[t]);
            miss[i] = U32(T.Miss[t]);
            mods[i] = (uint)T.Mods[t];
            grade[i] = GradeCode(T.Grade[t]);
            score[i] = T.Score[t];
            time[i] = TimeOrZero(T.Time[t]);
            hits[i] = U32(T.Hits[t]);
            sid[i] = T.Id[t];
            position[i] = (ushort)PositionOf(uid, T.Map[t]);
        }
        w.Table(table, n).Column(table, "map", map).Column(table, "pp", pp).Column(table, "acc", acc).Column(table, "combo", combo)
            .Column(table, "miss", miss).Column(table, "mods", mods).Column(table, "grade", grade).Column(table, "score", score)
            .Column(table, "time", time).Column(table, "hits", hits).Column(table, "sid", sid);
        if (pos)
        {
            w.Column(table, "pos", position);
        }
        if (stages != null)
        {
            w.Column(table, "stage", stages);
        }
    }

    private byte[] PlayerPack(PlayerFile file)
    {
        var p = file.Person;
        var w = new PackWriter(Schemas.Player);
        ScoreTable(w, "c", p.Lists[(int)Cat.Convert], p.Id, true);
        ScoreTable(w, "u", p.Lists[(int)Cat.Loved], p.Id, true);
        ScoreTable(w, "r", p.Lists[(int)Cat.Ranked], p.Id, true);
        ScoreTable(w, "top", p.DumpTop, p.Id, false);
        ScoreTable(w, "ppc", p.PpOnly, p.Id, false);
        ScoreTable(w, "pre", p.Pre, p.Id, false);
        ScoreTable(w, "dan", p.Dan.Select(d => d.Tuple).ToList(), p.Id, false, p.Dan.Select(d => (byte)d.Stage).ToArray());
        // The maps, with each set's artist, title and mapper once (a profile's maps are mostly whole sets).
        var ids = file.MapIds.ToArray();
        var n = ids.Length;
        var setRows = new Dictionary<(int, string, string, string), int>();
        var setId = new List<uint>();
        var artist = new List<string>();
        var title = new List<string>();
        var creator = new List<string>();
        var set = new uint[n];
        var version = new string[n];
        var stars = new int[n];
        var ar = new float[n];
        var maxCombo = new uint[n];
        var mode = new byte[n];
        for (var i = 0; i < n; i++)
        {
            var row = Row(ids[i]);
            var key = row < 0 ? (0, "", "", "") : (maps.SetId[row], OrEmpty(maps.Artist[row]), OrEmpty(maps.Title[row]), OrEmpty(maps.Creator[row]));
            if (!setRows.TryGetValue(key, out var setRow))
            {
                setRows[key] = setRow = setId.Count;
                setId.Add((uint)key.Item1);
                artist.Add(key.Item2);
                title.Add(key.Item3);
                creator.Add(key.Item4);
            }
            set[i] = (uint)setRow;
            if (row < 0)
            {
                version[i] = "";
                continue;
            }
            version[i] = OrEmpty(maps.Version[row]);
            stars[i] = Hundredths(Round(maps.Stars[row]));
            ar[i] = (float)maps.Ar[row];
            maxCombo[i] = (uint)maps.MaxCombo[row];
            mode[i] = (byte)maps.Mode[row];
        }
        w.Table("sets", setId.Count).Column("sets", "set", setId.ToArray()).Column("sets", "artist", artist.ToArray())
            .Column("sets", "title", title.ToArray()).Column("sets", "creator", creator.ToArray());
        w.Table("maps", n).Column("maps", "id", ids.Select(x => (uint)x).ToArray()).Column("maps", "set", set)
            .Column("maps", "version", version).Column("maps", "stars", stars).Column("maps", "ar", ar)
            .Column("maps", "maxCombo", maxCombo).Column("maps", "mode", mode);
        return w.ToArray();
    }

    /// <summary>The yearly ranked boards (<see cref="RankedYears"/>), one run of rows per year.</summary>
    private byte[] YearsPack()
    {
        var years = RankedYearBoards();
        var year = new ushort[years.Count];
        var from = new uint[years.Count];
        var count = new ushort[years.Count];
        var mapCount = new uint[years.Count];
        var id = new List<uint>();
        var pp = new List<int>();
        var plays = new List<ushort>();
        for (var i = 0; i < years.Count; i++)
        {
            year[i] = (ushort)years[i].Value;
            from[i] = (uint)id.Count;
            count[i] = (ushort)years[i].Rows.Count;
            mapCount[i] = (uint)years[i].Maps;
            foreach (var row in years[i].Rows)
            {
                id.Add((uint)row.Uid);
                pp.Add(Hundredths(row.Pp));
                plays.Add((ushort)Math.Min(row.Plays, ushort.MaxValue));
            }
        }
        var w = new PackWriter(Schemas.Years);
        w.Table("years", years.Count).Column("years", "year", year).Column("years", "from", from).Column("years", "players", count)
            .Column("years", "maps", mapCount);
        w.Table("rows", id.Count).Column("rows", "id", id.ToArray()).Column("rows", "pp", pp.ToArray()).Column("rows", "plays", plays.ToArray());
        return w.ToArray();
    }

    private byte[] SearchPack()
    {
        // Stored by set, then id, like maps-search.json: the order that compresses.
        var rows = new List<MapIndexRow>(mapsIndex);
        rows.Sort((a, b) => a.Set != b.Set ? a.Set.CompareTo(b.Set) : a.Id.CompareTo(b.Id));
        var setRow = new Dictionary<string, int>(StringComparer.Ordinal);
        var sets = new List<MapIndexRow>();
        var setOf = new uint[rows.Count];
        var topRow = new Dictionary<int, int>();
        var tops = new List<uint>();
        var topOf = new ushort[rows.Count];
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var key = $"{JsMath.ToString(r.Set)}\0{r.Artist}\0{r.Title}\0{r.Mapper}";
            if (!setRow.TryGetValue(key, out var row))
            {
                setRow[key] = row = sets.Count;
                sets.Add(r);
            }
            setOf[i] = (uint)row;
            if (!topRow.TryGetValue(r.Top, out var top))
            {
                topRow[r.Top] = top = tops.Count;
                tops.Add((uint)r.Top);
            }
            topOf[i] = (ushort)top;
        }
        var w = new PackWriter(Schemas.Search);
        w.Table("sets", sets.Count)
            .Column("sets", "set", sets.Select(r => (uint)r.Set).ToArray())
            .Column("sets", "artist", sets.Select(r => r.Artist).ToArray())
            .Column("sets", "title", sets.Select(r => r.Title).ToArray())
            .Column("sets", "mapper", sets.Select(r => r.Mapper).ToArray());
        w.Table("tops", tops.Count).Column("tops", "id", tops.ToArray());
        w.Table("maps", rows.Count)
            .Column("maps", "id", rows.Select(r => (uint)r.Id).ToArray())
            .Column("maps", "set", setOf)
            .Column("maps", "version", rows.Select(r => r.Version).ToArray())
            .Column("maps", "stars", rows.Select(r => (ushort)Hundredths(r.Stars)).ToArray())
            .Column("maps", "cat", rows.Select(r => (byte)Rules.FromLetter(r.Cat)).ToArray())
            .Column("maps", "players", rows.Select(r => (ushort)r.Players).ToArray())
            .Column("maps", "top", topOf);
        return w.ToArray();
    }
}
