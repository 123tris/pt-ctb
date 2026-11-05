using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    /// <summary>A mod ranking's row: [uid, weighted pp, maps, best play].</summary>
    private readonly record struct ModRow(int Uid, double Pp, int Maps, int Best);

    /// <summary>A top plays row: [uid, category, ...tuple].</summary>
    private readonly record struct PlayRow(int Uid, Cat Cat, int Tuple);

    private readonly Dictionary<char, Dictionary<string, List<ModRow>>> modRankings = new();
    private readonly List<int> modMaps = new();
    private List<PlayRow> topPlays;
    private readonly Dictionary<long, int> ppPlayOf = new();

    /// <summary>
    /// The mod rankings: the same plays the bot's /modranking ranks, a player counting each map once with their best play
    /// that includes the mods. Each pool is gathered once per player and filtered per mod filter.
    /// </summary>
    private void BuildModRankings()
    {
        var sources = new (char Source, Func<Person, List<int>> Pool)[]
        {
            ('r', p =>
            {
                var list = new List<int>(p.DumpTop);
                list.AddRange(p.DumpMods);
                if (p.Raw != null)
                {
                    list.AddRange(ConvertPlays(p));
                    list.AddRange(p.LiveRanked);
                    list.AddRange(p.ModPlays[(int)Cat.Ranked]);
                }
                return list;
            }),
            ('c', ConvertPlays),
            ('u', p =>
            {
                var list = new List<int>(p.Lists[(int)Cat.Loved]);
                list.AddRange(p.ModPlays[(int)Cat.Loved]);
                return list;
            }),
        };
        var filters = Rules.ModFilters.Select(Rules.ParseModFilter).ToArray();
        var matching = new List<int>();
        foreach (var (source, poolOf) in sources)
        {
            var byFilter = new Dictionary<string, List<ModRow>>();
            var rows = new List<ModRow>[filters.Length];
            for (var f = 0; f < filters.Length; f++)
            {
                rows[f] = new List<ModRow>();
            }
            foreach (var p in people)
            {
                var pool = poolOf(p);
                for (var f = 0; f < filters.Length; f++)
                {
                    matching.Clear();
                    foreach (var t in pool)
                    {
                        if (Rules.MatchesModFilter(T.Mods[t], filters[f]))
                        {
                            matching.Add(t);
                        }
                    }
                    var best = BestPerMap(matching);
                    if (best.Count == 0)
                    {
                        continue;
                    }
                    rows[f].Add(new ModRow(p.Id, Round(WeightedTotalOf(best)), best.Count, best[0]));
                    // The order the maps are listed in doesn't matter (mapsFor sorts them); the per-filter order is kept
                    // only so the work stays one pass.
                    modMaps.Add(T.Map[best[0]]);
                }
            }
            for (var f = 0; f < filters.Length; f++)
            {
                JsSort.Stable(rows[f], (a, b) => JsSort.Sign(b.Pp - a.Pp) is var c && c != 0 ? c : a.Uid.CompareTo(b.Uid));
                byFilter[Rules.ModFilters[f]] = rows[f];
            }
            modRankings[source] = byFilter;
        }
    }

    private List<int> ConvertPlays(Person p)
    {
        var list = new List<int>(p.Lists[(int)Cat.Convert]);
        list.AddRange(p.PpOnly);
        list.AddRange(p.ModPlays[(int)Cat.Convert]);
        return list;
    }

    private byte[] ModRankingsBytes(JsJsonWriter w)
    {
        w.Reset();
        w.BeginObject();
        w.Key("filters");
        WriteStrings(w, Rules.ModFilters);
        w.Key("sources");
        w.BeginObject();
        foreach (var source in new[] { 'r', 'c', 'u' })
        {
            w.Key(source.ToString());
            w.BeginObject();
            foreach (var name in Rules.ModFilters)
            {
                w.Key(name);
                w.BeginArray();
                foreach (var row in modRankings[source][name])
                {
                    w.BeginArray();
                    w.Number(row.Uid);
                    w.Number(row.Pp);
                    w.Number(row.Maps);
                    T.Write(w, row.Best);
                    w.EndArray();
                }
                w.EndArray();
            }
            w.EndObject();
        }
        w.EndObject();
        w.Key("maps");
        WriteMapsFor(w, modMaps);
        w.EndObject();
        return w.ToArray();
    }

    private static void WriteStrings(JsJsonWriter w, IEnumerable<string> values)
    {
        w.BeginArray();
        foreach (var v in values)
        {
            w.String(v);
        }
        w.EndArray();
    }

    // ---- Top plays -------------------------------------------------------------------------------------------

    /// <summary>
    /// The country's best single plays: each map's board plays (a convert's best-pp play standing in for its board play),
    /// then the other plays a mod filter can take, most pp first; the file keeps the union of every view's top 50.
    /// </summary>
    private void BuildTopPlays()
    {
        foreach (var p in people)
        {
            foreach (var t in p.PpOnly)
            {
                ppPlayOf[Key(p.Id, T.Map[t])] = t;
            }
        }
        var all = new List<PlayRow>();
        foreach (var b in boards)
        {
            foreach (var (uid, t) in b.Entries)
            {
                all.Add(new PlayRow(uid, b.Cat, ppPlayOf.TryGetValue(Key(uid, b.MapId), out var pp) ? pp : t));
            }
        }
        foreach (var p in people)
        {
            var others = new List<int>();
            foreach (var t in p.Lists[(int)Cat.Convert])
            {
                if (ppPlayOf.ContainsKey(Key(p.Id, T.Map[t])))
                {
                    others.Add(t);
                }
            }
            foreach (var cat in Rules.Cats)
            {
                others.AddRange(p.ModPlays[(int)cat]);
            }
            others.AddRange(p.DumpMods);
            foreach (var t in others)
            {
                if (boardOf.TryGetValue(T.Map[t], out var board))
                {
                    all.Add(new PlayRow(p.Id, board.Cat, t));
                }
            }
        }
        all.RemoveAll(r => !(T.Pp[r.Tuple] > 0));
        JsSort.Stable(all, (a, b) =>
        {
            var c = JsSort.Sign(T.Pp[b.Tuple] - T.Pp[a.Tuple]);
            if (c != 0)
            {
                return c;
            }
            c = JsSort.Sign(T.Time[a.Tuple] - T.Time[b.Tuple]);
            return c != 0 ? c : a.Uid.CompareTo(b.Uid);
        });
        var shown = new bool[all.Count];
        var taken = new HashSet<long>();
        foreach (var source in new[] { 'r', 'c', 'u' })
        {
            foreach (var filter in new[] { -1 }.Concat(Rules.ModFilters.Select(Rules.ParseModFilter)))
            {
                taken.Clear();
                var n = 0;
                for (var i = 0; i < all.Count && n < TopPlaysCap; i++)
                {
                    var row = all[i];
                    if (!Rules.InPlaySource(source, row.Cat) || (filter >= 0 && !Rules.MatchesModFilter(T.Mods[row.Tuple], filter)))
                    {
                        continue;
                    }
                    if (!taken.Add(Key(row.Uid, T.Map[row.Tuple])))
                    {
                        continue;
                    }
                    shown[i] = true;
                    n++;
                }
            }
        }
        topPlays = new List<PlayRow>();
        for (var i = 0; i < all.Count; i++)
        {
            if (shown[i])
            {
                topPlays.Add(all[i]);
            }
        }
    }

    private byte[] TopPlaysBytes(JsJsonWriter w)
    {
        w.Reset();
        w.BeginObject();
        w.Key("cap");
        w.Number(TopPlaysCap);
        w.Key("filters");
        WriteStrings(w, Rules.ModFilters);
        w.Key("plays");
        w.BeginArray();
        foreach (var row in topPlays)
        {
            T.WriteRow(w, row.Uid, Rules.Letter(row.Cat), row.Tuple);
        }
        w.EndArray();
        w.Key("maps");
        WriteMapsFor(w, topPlays.Select(r => T.Map[r.Tuple]), player: true);
        w.EndObject();
        return w.ToArray();
    }

    // ---- Dan course ------------------------------------------------------------------------------------------

    private byte[] DanBytes(JsJsonWriter w)
    {
        w.Reset();
        w.BeginObject();
        w.Key("stages");
        w.BeginArray();
        for (var index = 0; index < Rules.DanMaps.Length; index++)
        {
            var mapId = Rules.DanMaps[index];
            w.BeginObject();
            w.Key("index");
            w.Number(index);
            w.Key("map");
            w.Number(mapId);
            w.Key("meta");
            WriteMapTuple(w, Row(mapId));
            w.Key("passers");
            var passers = new List<(int Uid, int Tuple)>();
            foreach (var p in people)
            {
                foreach (var (stage, t) in p.Dan)
                {
                    if (stage == index)
                    {
                        passers.Add((p.Id, t));
                    }
                }
            }
            JsSort.Stable(passers, (a, b) => JsSort.Sign(T.Score[b.Tuple] - T.Score[a.Tuple]));
            w.BeginArray();
            foreach (var (uid, t) in passers)
            {
                T.WriteEntry(w, uid, t);
            }
            w.EndArray();
            w.EndObject();
        }
        w.EndArray();
        w.Key("ladder");
        var ladder = people.Where(p => p.DanScore > 0 || p.Dan.Count > 0)
            .Select(p => (p.Id, p.DanScore, Passes: p.Dan.Count, Max: p.Dan.Count == 0 ? -1 : Math.Max(-1, p.Dan.Max(d => d.Stage))))
            .ToList();
        JsSort.Stable(ladder, (a, b) =>
        {
            var c = JsSort.Sign(b.DanScore - a.DanScore);
            if (c != 0)
            {
                return c;
            }
            c = b.Passes.CompareTo(a.Passes);
            return c != 0 ? c : a.Id.CompareTo(b.Id);
        });
        w.BeginArray();
        foreach (var (id, score, passes, max) in ladder)
        {
            w.BeginArray();
            w.Number(id);
            w.Number(score);
            w.Number(passes);
            w.Number(max);
            w.EndArray();
        }
        w.EndArray();
        w.EndObject();
        return w.ToArray();
    }
}
