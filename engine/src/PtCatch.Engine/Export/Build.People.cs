using System;
using System.Collections.Generic;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;
using PtCatch.Engine.World;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    private Dictionary<Cat, List<Person>> order;
    private readonly Dictionary<int, JsNode> playerEntry = new();
    private readonly List<JsNode> players = new();

    private Person PersonFor(int id, string name)
    {
        if (!personOf.TryGetValue(id, out var p))
        {
            p = new Person { Id = id, Name = name };
            personOf[id] = p;
            people.Add(p);
        }
        return p;
    }

    /// <summary>
    /// A list's playable plays as tuples. A play from before its map was ranked goes with the player's pre-rank plays
    /// instead (p.Early), wherever the bot filed it.
    /// </summary>
    private List<int> Filed(Person p, ScoreList list, bool onRankedBoard)
    {
        var kept = new List<int>(list.Length);
        for (var r = list.Start; r < list.End; r++)
        {
            if (!Playable(r))
            {
                continue;
            }
            if (SetBeforeRanking(r, rawRow[r], onRankedBoard))
            {
                p.Early.Add(r);
            }
            else
            {
                kept.Add(r);
            }
        }
        var tuples = new List<int>(kept.Count);
        foreach (var r in kept)
        {
            tuples.Add(Tuple(r));
        }
        return tuples;
    }

    /// <summary>Extra plays only the mod rankings and top plays read; one from before ranking is dropped.</summary>
    private List<int> ModFiled(ScoreList list, bool onRankedBoard)
    {
        var tuples = new List<int>();
        for (var r = list.Start; r < list.End; r++)
        {
            if (Playable(r) && !SetBeforeRanking(r, rawRow[r], onRankedBoard))
            {
                tuples.Add(Tuple(r));
            }
        }
        return tuples;
    }

    // ---- People: the home-country tracked players, merged with their dump record ------------------------------

    private void BuildPeople()
    {
        foreach (var u in bot.Players)
        {
            if (u.Country != home || hidden.Contains(u.UserId))
            {
                continue;
            }
            var p = PersonFor(u.UserId, u.Username);
            p.Raw = u;
            p.Lists[(int)Cat.Convert].AddRange(Filed(p, u.TopConverted, true));
            p.Lists[(int)Cat.Convert].AddRange(Filed(p, u.ConvertPp, true));
            p.Lists[(int)Cat.Loved].AddRange(Filed(p, u.TopUnranked, false));
            p.LiveRanked = Filed(p, u.RankedSpecific, true);
            p.Lists[(int)Cat.Ranked].AddRange(p.LiveRanked);
            p.ModPlays[(int)Cat.Convert].AddRange(ModFiled(u.ConvertMod, true));
            p.ModPlays[(int)Cat.Loved].AddRange(ModFiled(u.UnrankedMod, false));
            p.ModPlays[(int)Cat.Ranked].AddRange(ModFiled(u.RankedMod, true));
            for (var r = u.PreRank.Start; r < u.PreRank.End; r++)
            {
                if (Playable(r))
                {
                    p.Early.Add(r);
                }
            }
        }
        foreach (var d in bot.PtCatch)
        {
            if (d.Country != home || hidden.Contains(d.UserId))
            {
                continue;
            }
            var p = PersonFor(d.UserId, d.Username);
            p.Dump = d;
            p.DumpTop = Filed(p, d.TopScores, true);
            SortByPp(p.DumpTop);
            p.DumpMods = ModFiled(d.ModScores, true);
            // Ranked specifics from the dump top the tracked list up; a player the bot never registered still gets
            // their dump plays filed by category.
            var list = p.Raw != null ? d.TopScores : d.CommunityScores;
            for (var r = list.Start; r < list.End; r++)
            {
                if (!Playable(r) || SetBeforeRanking(r, rawRow[r], true))
                {
                    continue;
                }
                var cat = CatOf(raw.Map[r], Cat.None);
                if (cat == Cat.Ranked || (p.Raw == null && cat != Cat.None))
                {
                    p.Lists[(int)cat].Add(Tuple(r));
                }
            }
        }
        foreach (var p in people)
        {
            // The lists hold the board plays, one per map. A convert map can also have a best-pp play that isn't
            // the board play (PpOnly); PpLists are what pp is counted from.
            var converts = p.Lists[(int)Cat.Convert];
            foreach (var cat in Rules.Cats)
            {
                p.Lists[(int)cat] = BestOnBoard(p.Lists[(int)cat], cat);
            }
            var onBoard = new Dictionary<int, int>();
            foreach (var t in p.Lists[(int)Cat.Convert])
            {
                onBoard[T.Map[t]] = t;
            }
            p.PpOnly = new List<int>();
            foreach (var t in BestPerMap(converts))
            {
                var board = onBoard[T.Map[t]];
                if (board != t && T.Pp[t] > T.Pp[board])
                {
                    p.PpOnly.Add(t);
                }
            }
            var counted = new List<int>(p.Lists[(int)Cat.Convert]);
            counted.AddRange(p.PpOnly);
            p.PpLists[(int)Cat.Convert] = BestPerMap(counted);
            p.PpLists[(int)Cat.Loved] = p.Lists[(int)Cat.Loved];
            p.PpLists[(int)Cat.Ranked] = p.Lists[(int)Cat.Ranked];

            // One pre-rank play per map, the best score, at 0pp.
            var pre = new Dictionary<int, int>();
            var preOrder = new List<int>();
            foreach (var r in p.Early)
            {
                var t = T.FromRaw(raw, r, true, rawRow[r]);
                if (!pre.TryGetValue(T.Map[t], out var old))
                {
                    pre[T.Map[t]] = t;
                    preOrder.Add(T.Map[t]);
                }
                else if (!(T.Score[old] >= T.Score[t]))
                {
                    pre[T.Map[t]] = t;
                }
            }
            p.Pre = new List<int>(preOrder.Count);
            foreach (var m in preOrder)
            {
                p.Pre.Add(pre[m]);
            }
            JsSort.Stable(p.Pre, (a, b) => JsSort.Sign(T.Score[b] - T.Score[a]) is var c && c != 0 ? c : T.Map[a].CompareTo(T.Map[b]));
        }
    }

    // ---- Per-map boards ----------------------------------------------------------------------------------------

    private void BuildBoards()
    {
        foreach (var p in people)
        {
            foreach (var cat in Rules.Cats)
            {
                foreach (var t in p.Lists[(int)cat])
                {
                    var id = T.Map[t];
                    if (!boardOf.TryGetValue(id, out var board))
                    {
                        var mapCat = CatOf(id, cat);
                        board = new Board { MapId = id, Cat = mapCat != Cat.None ? mapCat : cat };
                        boardOf[id] = board;
                        boards.Add(board);
                    }
                    board.Entries.Add((p.Id, t));
                }
            }
        }
        var seen = new HashSet<int>();
        foreach (var board in boards)
        {
            // A play the bot filed under two categories counts once, at its best.
            var loved = board.Cat == Cat.Loved;
            JsSort.Stable(board.Entries, (a, b) =>
            {
                var first = loved ? T.Pp[b.Tuple] - T.Pp[a.Tuple] : T.Score[b.Tuple] - T.Score[a.Tuple];
                var c = JsSort.Sign(first);
                return c != 0 ? c : JsSort.Sign(loved ? T.Score[b.Tuple] - T.Score[a.Tuple] : T.Pp[b.Tuple] - T.Pp[a.Tuple]);
            });
            seen.Clear();
            board.Entries.RemoveAll(e => !seen.Add(e.Uid));
            for (var i = 0; i < board.Entries.Count; i++)
            {
                position[Key(board.Entries[i].Uid, board.MapId)] = i + 1;
            }
        }
    }

    // ---- Player summaries --------------------------------------------------------------------------------------

    private static OfficialStats OfficialStatsOf(UserRecord raw, DumpRecord dump)
    {
        OfficialStats bot = null;
        if (raw != null)
        {
            bot = new OfficialStats
            {
                Pp = raw.PpRaw, Global = raw.PpRank, Country = raw.PpCountryRank, Acc = raw.Accuracy, Level = raw.Level,
                Plays = raw.Playcount, Grades = [raw.CountSS, raw.CountS, raw.CountA],
            };
            if (!string.IsNullOrEmpty(raw.ProfileUpdated))
            {
                return bot;
            }
        }
        if (dump != null)
        {
            return new OfficialStats
            {
                Pp = dump.Pp, Global = dump.GlobalRank, Country = dump.CountryRank, Acc = dump.Accuracy, Level = dump.Level,
                Plays = dump.Playcount, Grades = [dump.CountSS, dump.CountS, dump.CountA],
            };
        }
        return bot ?? new OfficialStats();
    }

    private static double? OrNull(double? v) => v is double d && d != 0 && !double.IsNaN(d) ? d : null;

    private void BuildSummaries()
    {
        var previousOfficial = previous["official"];
        foreach (var p in people)
        {
            p.Name = !string.IsNullOrEmpty(p.Raw?.Username) ? p.Raw.Username
                : !string.IsNullOrEmpty(p.Dump?.Username) ? p.Dump.Username : p.Name;
            p.Cv = Round(WeightedTotalOf(p.PpLists[(int)Cat.Convert]));
            p.Ul = Round(WeightedTotalOf(p.Lists[(int)Cat.Loved]));
            p.Official = OfficialStatsOf(p.Raw, p.Dump);
            p.Pp = Round(OrNull(p.Official.Pp) ?? 0);
            p.Global = OrNull(p.Official.Global);
            p.Country = OrNull(p.Official.Country);
            p.Inactive = !string.IsNullOrEmpty(p.Raw?.ProfileUpdated) && !(p.Pp > 0 && p.Global != null);
            if (p.Inactive)
            {
                var live = previousOfficial[p.Id.ToString()];
                var estimateFrom = new List<int>(p.Lists[(int)Cat.Ranked]);
                estimateFrom.AddRange(p.PpLists[(int)Cat.Convert]);
                estimateFrom.AddRange(p.DumpTop);
                var best = BestPerMap(estimateFrom);
                var pps = new List<double>(best.Count);
                foreach (var t in best)
                {
                    pps.Add(T.Pp[t]);
                }
                var estimate = Round(OfficialTotal(pps));
                if (live.Truthy)
                {
                    p.Pp = Round(live[0].ToNumber());
                    p.PpSeen = live[1];
                    p.PpSource = "last-known";
                }
                else if (estimate > 0)
                {
                    p.Pp = estimate;
                    p.PpSource = "estimated";
                }
                else if (pastOfficial.TryGetValue(p.Id, out var past))
                {
                    p.Pp = Round(past.Pp);
                    p.PpSource = "last-known";
                }
                else
                {
                    p.Pp = 0;
                    p.PpSource = null;
                }
                p.Global = null;
                p.Country = null;
            }
            foreach (var cat in Rules.Cats)
            {
                var n = 0;
                foreach (var t in p.Lists[(int)cat])
                {
                    if (PositionOf(p.Id, T.Map[t]) == 1)
                    {
                        n++;
                    }
                }
                p.Firsts[(int)cat] = n;
            }
            if (p.Raw != null)
            {
                for (var i = 0; i < p.Raw.DanPasses.Length; i++)
                {
                    var r = p.Raw.DanPasses[i];
                    if (r >= 0 && Playable(r))
                    {
                        p.Dan.Add((i, T.FromRaw(raw, r, false, rawRow[r])));
                    }
                }
                p.DanScore = p.Raw.DanScore;
            }
            double last = 0;
            foreach (var cat in Rules.Cats)
            {
                foreach (var t in p.Lists[(int)cat])
                {
                    last = double.IsNaN(last) || double.IsNaN(T.Time[t]) ? double.NaN : Math.Max(last, T.Time[t]);
                }
            }
            p.Last = last == 0 || double.IsNaN(last) ? double.NaN : last;
        }

        order = new Dictionary<Cat, List<Person>>
        {
            [Cat.Convert] = Ranking(p => p.Cv),
            [Cat.Loved] = Ranking(p => p.Ul),
            [Cat.Ranked] = Ranking(p => p.Pp),
        };
    }

    private List<Person> Ranking(Func<Person, double> key)
    {
        var list = people.FindAll(p => key(p) > 0);
        JsSort.Stable(list, (a, b) => JsSort.Sign(key(b) - key(a)) is var c && c != 0 ? c : a.Id.CompareTo(b.Id));
        return list;
    }

    private static double Percent(double acc) => acc > 0 && acc <= 1 ? acc * 100 : acc;

    /// <summary>players.json, in name order; its entries are nodes because Bananas adds the name colours later.</summary>
    private void BuildPlayersFile()
    {
        var rankOf = new Dictionary<Cat, Dictionary<int, int>>();
        foreach (var cat in Rules.Cats)
        {
            var ranks = new Dictionary<int, int>();
            var list = order[cat];
            for (var i = 0; i < list.Count; i++)
            {
                ranks[list[i].Id] = i + 1;
            }
            rankOf[cat] = ranks;
        }
        var byName = new List<Person>(people);
        JsSort.Stable(byName, (a, b) => JsSort.LocaleCompare(a.Name, b.Name));
        foreach (var p in byName)
        {
            var o = JsNode.Object();
            o.Set("id", p.Id).Set("name", p.Name).Set("cv", p.Cv).Set("ul", p.Ul).Set("pp", p.Pp);
            var rank = JsNode.Object();
            foreach (var cat in Rules.Cats)
            {
                rank.Set(Rules.Letter(cat), rankOf[cat].TryGetValue(p.Id, out var r) ? JsNode.Num(r) : JsNode.NullValue);
            }
            o.Set("rank", rank);
            o.Set("global", JsNode.NumOrNull(p.Global));
            o.Set("country", JsNode.NumOrNull(p.Country));
            if (p.Inactive)
            {
                o.Set("inactive", true);
                o.Set("ppSource", JsNode.Str(p.PpSource));
                if (p.PpSeen.Truthy)
                {
                    o.Set("ppSeen", p.PpSeen);
                }
            }
            o.Set("acc", Round(Percent(p.Official.Acc ?? 0)));
            o.Set("level", Round(p.Official.Level ?? 0));
            o.Set("plays", p.Official.Plays ?? 0);
            var grades = JsNode.Array(3);
            for (var i = 0; i < 3; i++)
            {
                grades.Add(i < p.Official.Grades.Length ? p.Official.Grades[i] ?? 0 : 0);
            }
            o.Set("grades", grades);
            var count = JsNode.Object();
            var firsts = JsNode.Object();
            foreach (var cat in Rules.Cats)
            {
                count.Set(Rules.Letter(cat), p.Lists[(int)cat].Count);
                firsts.Set(Rules.Letter(cat), p.Firsts[(int)cat]);
            }
            o.Set("count", count);
            o.Set("firsts", firsts);
            o.Set("danScore", p.DanScore);
            var dan = JsNode.Array(p.Dan.Count);
            foreach (var (stage, _) in p.Dan)
            {
                dan.Add(stage);
            }
            o.Set("dan", dan);
            o.Set("last", double.IsNaN(p.Last) ? JsNode.NullValue : JsNode.Num(p.Last));
            players.Add(o);
            playerEntry[p.Id] = o;
            PlayerIds.Add(p.Id);
        }
    }
}
