using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    private readonly record struct Play(Person P, Cat Cat, int T);

    private JsNode records;
    private readonly List<(string Key, (int Uid, double Time) Row)> recordRows = new();
    private List<(int Id, double Value)> oneMissLeaders;
    private List<(int Id, double Value)> wallLeaders;

    private IEnumerable<(string Key, (int Uid, double Time) Row)> RecordRows() => recordRows;

    private void BuildRecords()
    {
        var allScores = new List<Play>();
        foreach (var p in people)
        {
            foreach (var cat in Rules.Cats)
            {
                foreach (var t in p.Lists[(int)cat])
                {
                    allScores.Add(new Play(p, cat, t));
                }
            }
        }
        // The first of the items with the highest value (later ties never replace it).
        static Play? Best(IEnumerable<Play> items, Func<Play, double> value)
        {
            Play? top = null;
            var topValue = 0.0;
            foreach (var x in items)
            {
                var v = value(x);
                if (top == null || v > topValue)
                {
                    top = x;
                    topValue = v;
                }
            }
            return top;
        }
        JsNode AsRow(Play? x) => x is Play play ? T.Node(play.T, JsNode.Num(play.P.Id), JsNode.Str(Rules.Letter(play.Cat))) : JsNode.NullValue;
        List<(int Id, double Value)> Leaders(Func<Person, double> value, int n = 5)
        {
            var rows = people.Select(p => (p.Id, Value: value(p))).Where(r => r.Value > 0).ToList();
            JsSort.Stable(rows, (a, b) => JsSort.Sign(b.Value - a.Value) is var c && c != 0 ? c : a.Id.CompareTo(b.Id));
            return rows.Take(n).ToList();
        }
        static JsNode LeadersNode(List<(int Id, double Value)> rows) => ArrayOf(rows.Select(r => JsNode.ArrayOf(JsNode.Num(r.Id), JsNode.Num(r.Value))));
        static bool FairMods(int mods) => (mods & (Rules.EZ | Rules.HT)) == 0;
        bool OnHardMap(int t)
        {
            var row = T.MapRow[t];
            return FairMods(T.Mods[t]) && !IsBanned(T.Map[t]) && row >= 0 && maps.Stars[row] >= HardStars &&
                (maps.Mode[row] == Rules.ModeCatch || maps.CatchDifficulty[row]);
        }
        double Stars(Play x) => maps.Stars[T.MapRow[x.T]];
        bool Known(Play x) => T.MapRow[x.T] >= 0;

        var byHour = new double[24];
        foreach (var x in allScores)
        {
            byHour[JsDate.LisbonHour(T.Time[x.T])]++;
        }
        Board oldest = null;
        foreach (var b in boards)
        {
            if (b.Entries.Count >= 2 && (oldest == null || T.Time[b.Entries[0].Tuple] < T.Time[oldest.Entries[0].Tuple]))
            {
                oldest = b;
            }
        }

        var topPlay = JsNode.Object();
        var hardest = JsNode.Object();
        foreach (var cat in Rules.Cats)
        {
            var counted = new List<Play>();
            foreach (var p in people)
            {
                foreach (var t in p.PpLists[(int)cat])
                {
                    counted.Add(new Play(p, cat, t));
                }
            }
            var top = Best(counted, x => T.Pp[x.T]);
            topPlay.Set(Rules.Letter(cat), AsRow(top));
            AddRecordRow($"topPlay.{Rules.Letter(cat)}", top);
        }
        var topCombo = Best(allScores, x => T.Combo[x.T]);
        foreach (var cat in Rules.Cats)
        {
            var h = Best(allScores.Where(x => x.Cat == cat && FairMods(T.Mods[x.T]) && Known(x)), Stars);
            hardest.Set(Rules.Letter(cat), AsRow(h));
            AddRecordRow($"hardest.{Rules.Letter(cat)}", h);
        }
        AddRecordRow("topCombo", topCombo);
        var longest = Best(allScores.Where(x => FairMods(T.Mods[x.T]) && Known(x)), x => maps.HitLength[T.MapRow[x.T]]);
        AddRecordRow("longest", longest);
        var mostFirsts = JsNode.Object();
        foreach (var cat in Rules.Cats)
        {
            mostFirsts.Set(Rules.Letter(cat), LeadersNode(Leaders(p => p.Firsts[(int)cat])));
        }
        var hardFc = Best(allScores.Where(x => T.Miss[x.T] == 0 && OnHardMap(x.T)), Stars);
        AddRecordRow("hardFc", hardFc);
        double Count(Person p, Func<int, bool> test)
        {
            var n = 0;
            foreach (var cat in Rules.Cats)
            {
                foreach (var t in p.Lists[(int)cat])
                {
                    if (test(t))
                    {
                        n++;
                    }
                }
            }
            return n;
        }
        var highestChoke = Best(allScores.Where(x => T.Miss[x.T] == 1), x => T.Pp[x.T]);
        AddRecordRow("highestChoke", highestChoke);
        var wysi = allScores.Where(x => T.Combo[x.T] == 727).ToList();
        JsSort.Stable(wysi, (a, b) => JsSort.Sign(T.Time[b.T] - T.Time[a.T]));
        oneMissLeaders = Leaders(p => Count(p, t => T.Miss[t] == 1));
        wallLeaders = Leaders(p => Count(p, t => PositionOf(p.Id, T.Map[t]) == 1 && T.Time[t] < now - 2 * 365 * Day), 3);

        records = JsNode.Object()
            .Set("kings", StarKings())
            .Set("topPlay", topPlay)
            .Set("topCombo", AsRow(topCombo))
            .Set("hardest", hardest)
            .Set("longest", AsRow(longest))
            .Set("oldestFirst", oldest == null ? JsNode.NullValue
                : T.Node(oldest.Entries[0].Tuple, JsNode.Num(oldest.Entries[0].Uid), JsNode.Str(Rules.Letter(oldest.Cat))))
            .Set("mostFirsts", mostFirsts)
            .Set("hard", JsNode.Object()
                .Set("stars", HardStars)
                .Set("firsts", LeadersNode(Leaders(p =>
                {
                    var hard = new HashSet<int>();
                    foreach (var cat in Rules.Cats)
                    {
                        foreach (var t in p.Lists[(int)cat])
                        {
                            if (PositionOf(p.Id, T.Map[t]) == 1 && OnHardMap(t))
                            {
                                hard.Add(T.Map[t]);
                            }
                        }
                    }
                    return hard.Count;
                })))
                .Set("fc", AsRow(hardFc)))
            .Set("mostSS", LeadersNode(Leaders(p => Count(p, t => Rules.IsSS(T.Grade[t])))))
            .Set("mostFC", LeadersNode(Leaders(p => Count(p, t => T.Miss[t] == 0))))
            .Set("wall", LeadersNode(wallLeaders))
            .Set("byHour", ArrayOf(byHour.Select(JsNode.Num)))
            .Set("totals", JsNode.Object()
                .Set("players", people.Count).Set("scores", allScores.Count).Set("maps", boards.Count)
                .Set("fruits", allScores.Aggregate(0.0, (n, x) => n + T.Hits[x.T]))
                .Set("ss", allScores.Count(x => Rules.IsSS(T.Grade[x.T]))))
            .Set("oneMiss", LeadersNode(oneMissLeaders))
            .Set("highestChoke", AsRow(highestChoke))
            .Set("wysi", ArrayOf(wysi.Select(x => AsRow(x))));

        // The throne: Tris's #1s that still stand, oldest first, and who sits right behind them most often.
        var throneOldest = new List<JsNode>();
        if (personOf.ContainsKey(Rules.ThronePlayer))
        {
            var held = boards.Where(b => b.Entries[0].Uid == Rules.ThronePlayer).ToList();
            var contested = held.Where(b => b.Entries.Count >= 2).ToList();
            var behind = new List<(int Id, int N)>();
            foreach (var b in contested)
            {
                var runner = b.Entries[1].Uid;
                var i = behind.FindIndex(x => x.Id == runner);
                if (i < 0)
                {
                    behind.Add((runner, 1));
                }
                else
                {
                    behind[i] = (runner, behind[i].N + 1);
                }
            }
            JsSort.Stable(contested, (a, b) =>
                JsSort.Sign(T.Time[a.Entries[0].Tuple] - T.Time[b.Entries[0].Tuple]) is var c && c != 0 ? c : a.MapId.CompareTo(b.MapId));
            throneOldest = contested.Take(12)
                .Select(b => T.Node(b.Entries[0].Tuple, JsNode.Str(Rules.Letter(b.Cat)), JsNode.Num(b.Entries[1].Uid)))
                .ToList();
            JsSort.Stable(behind, (a, b) => b.N != a.N ? b.N.CompareTo(a.N) : a.Id.CompareTo(b.Id));
            records.Set("throne", JsNode.Object()
                .Set("u", Rules.ThronePlayer)
                .Set("held", held.Count)
                .Set("contested", contested.Count)
                .Set("oldest", ArrayOf(throneOldest))
                .Set("challengers", ArrayOf(behind.Take(5).Select(x => JsNode.ArrayOf(JsNode.Num(x.Id), JsNode.Num(x.N))))));
        }

        var ids = new List<int>();
        foreach (var r in new[] { topPlay["c"], topPlay["u"], topPlay["r"], records["topCombo"], hardest["c"], hardest["u"], hardest["r"],
            records["longest"], records["oldestFirst"], records["highestChoke"] }.Concat(records["wysi"].Items).Append(records["hard"]["fc"]))
        {
            if (r.Truthy)
            {
                ids.Add((int)r[2].Number);
            }
        }
        foreach (var r in throneOldest)
        {
            ids.Add((int)r[2].Number);
        }
        records.Set("maps", MapsForNode(ids));
    }

    private void AddRecordRow(string key, Play? x)
    {
        if (x is Play play)
        {
            recordRows.Add((key, (play.P.Id, T.Time[play.T])));
        }
    }

    /// <summary>The PT #1 count per whole-star range, catch and converts apart (tools/lib/star-kings.mjs).</summary>
    private JsNode StarKings()
    {
        var counts = new Dictionary<string, SortedDictionary<int, List<(int Id, int N)>>>
        {
            ["catch"] = new(),
            ["converts"] = new(),
        };
        foreach (var board in boards)
        {
            var row = Row(board.MapId);
            var mode = row >= 0 ? maps.Mode[row] : double.NaN;
            var source = mode == Rules.ModeCatch ? "catch" : mode == Rules.ModeOsu ? "converts" : null;
            if (source == null || board.Entries.Count == 0 || maps.StarsNull[row] || !double.IsFinite(maps.Stars[row]) || maps.Stars[row] < 0 ||
                (source == "converts" && !maps.CatchDifficulty[row]))
            {
                continue;
            }
            var band = (int)Math.Min(10, Math.Floor(maps.Stars[row]));
            if (!counts[source].TryGetValue(band, out var players))
            {
                counts[source][band] = players = new List<(int, int)>();
            }
            var winner = board.Entries[0].Uid;
            var i = players.FindIndex(x => x.Id == winner);
            if (i < 0)
            {
                players.Add((winner, 1));
            }
            else
            {
                players[i] = (winner, players[i].N + 1);
            }
        }
        var result = JsNode.Object();
        foreach (var (source, bands) in counts)
        {
            var list = JsNode.Array();
            foreach (var (stars, players) in bands)
            {
                var board = new List<(int Id, int N)>(players);
                JsSort.Stable(board, (a, b) => b.N != a.N ? b.N.CompareTo(a.N) : a.Id.CompareTo(b.Id));
                var count = board[0].N;
                list.Add(JsNode.Object().Set("stars", stars).Set("count", count)
                    .Set("players", Ids(board.Where(x => x.N == count).Select(x => x.Id)))
                    .Set("board", ArrayOf(board.Select(x => JsNode.ArrayOf(JsNode.Num(x.Id), JsNode.Num(x.N))))));
            }
            result.Set(source, list);
        }
        return result;
    }
}
