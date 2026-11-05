using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;
using PtCatch.Engine.World;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    private const int CompletionRecent = 12;
    private const int CompletionSole = 10;
    private const int CompletionNext = 3;

    private JsNode completionFile;
    private JsNode completionFirsts;
    private JsNode quizFile;

    /// <summary>
    /// Who has cleared which ranked maps: map → (uid → the earliest clearing play's time, or 0 when undated), from every
    /// stored play the site counts as ranked (tools/lib/completion.mjs clearers).
    /// </summary>
    private Dictionary<int, List<(int Uid, double Time)>> Clearers()
    {
        var byMap = new Dictionary<int, List<(int Uid, double Time)>>();
        void Add(int uid, ScoreList list, bool onRankedBoard)
        {
            for (var r = list.Start; r < list.End; r++)
            {
                if (!raw.ClearsMap(r))
                {
                    continue;
                }
                var row = rawRow[r];
                if (row < 0 || IsBanned(raw.Map[r]) || !(maps.IsRankedSpecific(row) || maps.IsRankedConvert(row)))
                {
                    continue;
                }
                if (SetBeforeRanking(r, row, onRankedBoard))
                {
                    continue;
                }
                var time = raw.HasDate[r] ? raw.Time[r] : double.NaN;
                var t = double.IsFinite(time) && time > 0 ? time : 0;
                if (!byMap.TryGetValue(raw.Map[r], out var byUser))
                {
                    byMap[raw.Map[r]] = byUser = new List<(int, double)>();
                }
                var i = byUser.FindIndex(x => x.Uid == uid);
                if (i < 0)
                {
                    byUser.Add((uid, t));
                }
                else if (t > 0 && (byUser[i].Time == 0 || t < byUser[i].Time))
                {
                    byUser[i] = (uid, t);
                }
            }
        }
        foreach (var p in bot.Players)
        {
            if (p.Country != home || hidden.Contains(p.UserId))
            {
                continue;
            }
            Add(p.UserId, p.RankedSpecific, true);
            Add(p.UserId, p.TopConverted, true);
            Add(p.UserId, p.TopUnranked, false);
        }
        foreach (var p in bot.PtCatch)
        {
            if (p.Country != home || hidden.Contains(p.UserId))
            {
                continue;
            }
            Add(p.UserId, p.TopScores, true);
            Add(p.UserId, p.CommunityScores, true);
        }
        return byMap;
    }

    /// <summary>The first clear of a map: the earliest dated play (ties: the lower id).</summary>
    private static (double Uid, double Time) FirstOf(List<(int Uid, double Time)> byUser)
    {
        (double Uid, double Time)? first = null;
        foreach (var (uid, t) in byUser)
        {
            if (first == null)
            {
                first = (uid, t);
            }
            else if (t > 0 && (first.Value.Time == 0 || t < first.Value.Time || (t == first.Value.Time && uid < first.Value.Uid)))
            {
                first = (uid, t);
            }
            else if (t == 0 && first.Value.Time == 0 && uid < first.Value.Uid)
            {
                first = (uid, t);
            }
        }
        return first.Value;
    }

    /// <summary>
    /// completion.json's <c>years</c>: [year, total, cleared] by the UTC year each map was ranked (its ranked time in unix
    /// seconds, NaN for none), oldest first; a map without a ranked date is only in the totals.
    /// </summary>
    internal static JsNode CompletionYears(IEnumerable<(double RankedAt, bool Cleared)> specifics)
    {
        var years = new SortedDictionary<long, (int Total, int Cleared)>();
        foreach (var (ranked, isCleared) in specifics)
        {
            if (double.IsNaN(ranked))
            {
                continue;
            }
            var year = JsDate.CivilFromDays((long)Math.Floor(ranked / Day)).Year;
            var (total, cleared) = years.GetValueOrDefault(year);
            years[year] = (total + 1, cleared + (isCleared ? 1 : 0));
        }
        return ArrayOf(years.Select(y => JsNode.ArrayOf(JsNode.Num(y.Key), JsNode.Num(y.Value.Total), JsNode.Num(y.Value.Cleared))));
    }

    /// <summary>The completion goal (completion.mjs completion and homeGoal), and its maps' pages.</summary>
    private void BuildCompletion()
    {
        var byMap = Clearers();
        var known = new HashSet<int>();
        foreach (var p in bot.Players)
        {
            if (p.Country == home && !hidden.Contains(p.UserId))
            {
                known.Add(p.UserId);
            }
        }
        foreach (var p in bot.PtCatch)
        {
            if (p.Country == home && !hidden.Contains(p.UserId))
            {
                known.Add(p.UserId);
            }
        }
        var specifics = new List<int>();
        var converts = new List<int>();
        for (var row = 0; row < maps.Count; row++)
        {
            if (IsBanned(maps.Id[row]))
            {
                continue;
            }
            if (maps.IsRankedSpecific(row))
            {
                specifics.Add(row);
            }
            else if (maps.IsRankedConvert(row))
            {
                converts.Add(row);
            }
        }

        var previousCleared = previous["cleared"];
        var firsts = new SortedDictionary<int, (JsNode Uid, JsNode Time)>();
        var left = new List<int>();
        var sole = new List<(int Uid, int N)>();
        var contributors = new HashSet<int>();
        foreach (var row in specifics)
        {
            var id = maps.Id[row];
            if (!byMap.TryGetValue(id, out var byUser))
            {
                left.Add(row);
                continue;
            }
            var (fu, ft) = FirstOf(byUser);
            var first = (Uid: JsNode.Num(fu), Time: JsNode.Num(ft));
            var before = previousCleared[id.ToString()];
            if (before.Truthy && known.Contains((int)before[0].ToNumber()) && before[0].ToNumber() == (int)before[0].ToNumber() &&
                before[1].ToNumber() > 0 && (ft == 0 || before[1].ToNumber() < ft))
            {
                first = (before[0], before[1]);
            }
            firsts[id] = first;
            foreach (var (uid, _) in byUser)
            {
                contributors.Add(uid);
            }
            if (byUser.Count == 1)
            {
                var uid = byUser[0].Uid;
                var i = sole.FindIndex(x => x.Uid == uid);
                if (i < 0)
                {
                    sole.Add((uid, 1));
                }
                else
                {
                    sole[i] = (uid, sole[i].N + 1);
                }
            }
        }

        // The artist, title and creator of every set some cached map has them for (first one wins).
        var titles = new Dictionary<int, (string Artist, string Title, string Creator)>();
        void Titles(Beatmaps source)
        {
            if (source == null)
            {
                return;
            }
            for (var row = 0; row < source.Count; row++)
            {
                var set = source.SetId[row];
                if (set != 0 && !string.IsNullOrEmpty(source.Title[row]) && source.Title[row] != "Unknown" && !titles.ContainsKey(set))
                {
                    titles[set] = (OrEmpty(source.Artist[row]), source.Title[row], OrEmpty(source.Creator[row]));
                }
            }
        }
        Titles(maps);
        Titles(extraTitles);
        JsSort.Stable(left, (a, b) => JsSort.Sign(maps.Playcount[b] - maps.Playcount[a]) is var c && c != 0 ? c : maps.Id[a].CompareTo(maps.Id[b]));
        var sets = new SortedDictionary<int, (string Artist, string Title)>();
        foreach (var row in left)
        {
            if (titles.TryGetValue(maps.SetId[row], out var title))
            {
                sets[maps.SetId[row]] = (title.Artist, title.Title);
            }
        }
        var recent = firsts.Where(kv => kv.Value.Time.ToNumber() > 0)
            .Select(kv => (Id: kv.Key, Uid: kv.Value.Uid, Time: kv.Value.Time))
            .ToList();
        JsSort.Stable(recent, (a, b) => JsSort.Sign(b.Time.ToNumber() - a.Time.ToNumber()) is var c && c != 0 ? c : a.Id.CompareTo(b.Id));
        recent = recent.Take(CompletionRecent).ToList();
        JsSort.Stable(sole, (a, b) => b.N != a.N ? b.N.CompareTo(a.N) : a.Uid.CompareTo(b.Uid));

        JsNode TitledTuple(int id)
        {
            var row = Row(id);
            var o = default(MapOverride);
            if (!maps.HasTitle(row) && titles.TryGetValue(maps.SetId[row], out var t))
            {
                o = new MapOverride(t.Artist, t.Title, t.Creator, false, null);
            }
            return MapTupleNode(row, o);
        }

        var leftRows = ArrayOf(left.Select(row =>
        {
            var ranked = maps.RankedAt(row);
            return JsNode.ArrayOf(JsNode.Num(maps.Id[row]), JsNode.Num(maps.SetId[row]), JsNode.Str(OrEmpty(maps.Version[row])),
                JsNode.Num(JsMath.Round(maps.Stars[row] * 100) / 100), double.IsNaN(ranked) ? JsNode.NullValue : JsNode.Num(Math.Floor(ranked / Day)),
                JsNode.Num(maps.Playcount[row]), maps.HitLength[row] != 0 ? JsNode.Num(maps.HitLength[row]) : JsNode.NullValue);
        }));
        var setsNode = JsNode.Object();
        foreach (var (set, (artist, title)) in sets)
        {
            setsNode.Set(set.ToString(), JsNode.ArrayOf(JsNode.Str(artist), JsNode.Str(title)));
        }
        var yearsNode = CompletionYears(specifics.Select(row => (maps.RankedAt(row), firsts.ContainsKey(maps.Id[row]))));
        var mapsNode = JsNode.Object();
        foreach (var id in recent.Select(r => r.Id).OrderBy(id => id))
        {
            mapsNode.Set(id.ToString(), TitledTuple(id));
        }
        completionFile = JsNode.Object()
            .Set("total", specifics.Count)
            .Set("cleared", firsts.Count)
            .Set("converts", JsNode.Object().Set("total", converts.Count).Set("cleared", converts.Count(row => byMap.ContainsKey(maps.Id[row]))))
            .Set("players", contributors.Count)
            .Set("years", yearsNode)
            .Set("recent", ArrayOf(recent.Select(r => JsNode.ArrayOf(JsNode.Num(r.Id), r.Uid, r.Time))))
            .Set("sole", ArrayOf(sole.Take(CompletionSole).Select(s => JsNode.ArrayOf(JsNode.Num(s.Uid), JsNode.Num(s.N)))))
            .Set("maps", mapsNode)
            .Set("sets", setsNode)
            .Set("left", leftRows);
        completionFirsts = JsNode.Object();
        foreach (var (id, (uid, time)) in firsts)
        {
            completionFirsts.Set(id.ToString(), JsNode.ArrayOf(uid, time));
        }
        // Each map nobody has cleared gets a page too: its details over an empty board.
        foreach (var row in left)
        {
            var id = maps.Id[row];
            if (!mapBuckets.ContainsKey(id))
            {
                var o = default(MapOverride);
                if (!maps.HasTitle(row) && titles.TryGetValue(maps.SetId[row], out var t))
                {
                    o = new MapOverride(t.Artist, t.Title, t.Creator, false, null);
                }
                mapBuckets[id] = new BucketEntry { Row = row, Override = o, Cat = Cat.Ranked };
            }
        }
    }

    /// <summary>The home page's slice of the goal, for meta.json (completion.mjs homeGoal).</summary>
    private JsNode HomeGoal()
    {
        var file = completionFile;
        var rows = file["left"].Items.Where(r => r[3].Number > 0).ToList();
        JsSort.Stable(rows, (a, b) =>
        {
            var c = JsSort.Sign(a[3].Number - b[3].Number);
            if (c != 0)
            {
                return c;
            }
            c = JsSort.Sign(b[5].Number - a[5].Number);
            return c != 0 ? c : JsSort.Sign(a[0].Number - b[0].Number);
        });
        var seen = new HashSet<double>();
        var next = new List<JsNode>();
        foreach (var row in rows)
        {
            if (next.Count == CompletionNext)
            {
                break;
            }
            var set = row[1].Number;
            if (set != 0 && seen.Contains(set))
            {
                continue;
            }
            seen.Add(set);
            next.Add(row);
        }
        var latest = file["recent"].Count > 0 ? file["recent"][0] : JsNode.NullValue;
        var nextSets = JsNode.Object();
        foreach (var r in next)
        {
            var key = JsMath.ToString(r[1].Number);
            if (file["sets"][key].Truthy)
            {
                nextSets.Set(key, file["sets"][key]);
            }
        }
        var latestMaps = JsNode.Object();
        if (latest.Truthy && file["maps"][JsMath.ToString(latest[0].Number)].Truthy)
        {
            latestMaps.Set(JsMath.ToString(latest[0].Number), file["maps"][JsMath.ToString(latest[0].Number)]);
        }
        return JsNode.Object().Set("cleared", file["cleared"]).Set("total", file["total"]).Set("players", file["players"])
            .Set("next", ArrayOf(next)).Set("sets", nextSets).Set("latest", latest).Set("maps", latestMaps);
    }

    // ---- Quiz pool -------------------------------------------------------------------------------------------

    private void BuildQuiz()
    {
        var sets = new List<(int Id, string Artist, string Title, string Creator, int N)>();
        var at = new Dictionary<int, int>();
        foreach (var b in boards)
        {
            var row = Row(b.MapId);
            if (!maps.HasTitle(row) || maps.SetId[row] == 0)
            {
                continue;
            }
            var set = maps.SetId[row];
            if (!at.TryGetValue(set, out var i))
            {
                at[set] = i = sets.Count;
                sets.Add((set, maps.Artist[row], maps.Title[row], maps.Creator[row], 0));
            }
            if (b.Entries.Count > sets[i].N)
            {
                sets[i] = sets[i] with { N = b.Entries.Count };
            }
        }
        var pool = sets.Where(s => s.N >= 2).ToList();
        JsSort.Stable(pool, (a, b) => b.N != a.N ? b.N.CompareTo(a.N) : a.Id.CompareTo(b.Id));
        quizFile = JsNode.Object().Set("sets", ArrayOf(pool.Take(800).Select(s =>
            JsNode.ArrayOf(JsNode.Num(s.Id), JsNode.Str(s.Artist), JsNode.Str(s.Title), JsNode.Str(s.Creator), JsNode.Num(s.N)))));
    }
}
