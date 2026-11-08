using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    private JsNode challenges;
    private JsNode weeks;
    private readonly List<int> unclaimedIds = new();

    /// <summary>The community week a unix time falls in: Monday 00:00 Lisbon to the next (tools/lib/weekly.mjs).</summary>
    public static (string Id, double Start, double End) LisbonWeek(double time)
    {
        var (y, m, d) = JsDate.LisbonDate(time);
        var day = (JsDate.UtcWeekday(JsDate.Utc(y, m, d)) + 6) % 7;
        var monday = JsDate.Utc(y, m, d - day);
        var thursday = monday + 3 * Day;
        var thursdayYear = JsDate.CivilFromDays((long)Math.Floor(thursday / Day)).Year;
        var yearStart = JsDate.Utc(thursdayYear, 1, 1);
        var week = 1 + Math.Floor((monday + 3 * Day - yearStart) / (7 * Day));
        return ($"{thursdayYear}-W{week.ToString("00")}", LisbonMidnight(monday), LisbonMidnight(monday + 7 * Day));
    }

    private static double LisbonMidnight(double utcDate) => utcDate - JsDate.LisbonOffset(utcDate);

    private static bool IsWeekId(JsNode id) => id.IsString && id.Text.Length == 8 && id.Text[4] == '-' && id.Text[5] == 'W' &&
        id.Text.Where((c, i) => i is 0 or 1 or 2 or 3 or 6 or 7).All(char.IsAsciiDigit);

    /// <summary>The week an id like "2026-W44" names, or null.</summary>
    public static (string Id, double Start, double End)? WeekOf(string id)
    {
        if (id == null || !IsWeekId(JsNode.Str(id)))
        {
            return null;
        }
        var year = int.Parse(id[..4]);
        var n = int.Parse(id[6..]);
        var jan4 = JsDate.Utc(year, 1, 4);
        var monday = jan4 - (JsDate.UtcWeekday(jan4) + 6) % 7 * Day + (n - 1) * 7 * Day;
        return LisbonWeek(monday + 12 * 3600);
    }

    /// <summary>The maps the bot's votes chose, by the week they're the map of the week for.</summary>
    private static Dictionary<string, double> VotedMaps(IEnumerable<JsNode> weekList)
    {
        var voted = new Dictionary<string, double>();
        foreach (var w in weekList)
        {
            var vote = w["mapVote"];
            if (w["vote"].Truthy && IsWeekId(vote["week"]) && vote["map"].IsNumber && vote["map"].Number == Math.Floor(vote["map"].Number))
            {
                voted[vote["week"].Text] = vote["map"].Number;
            }
        }
        return voted;
    }

    /// <summary>A logged play as a row: [user, category, ...tuple] (weekly.mjs row).</summary>
    private static JsNode LogRow(JsNode l)
    {
        if (!l.Truthy)
        {
            return JsNode.NullValue;
        }
        static JsNode Or0(JsNode v) => v.IsNullish ? JsNode.Num(0) : v;
        var a = JsNode.ArrayOf(l["u"], l["c"], l["m"], Or0(l["pp"]), Or0(l["acc"]), Or0(l["combo"]), Or0(l["miss"]),
            JsNode.Num(Rules.ModMask(l["mods"].Text)), l["g"], Or0(l["sc"]), l["t"], JsNode.Num(0));
        var id = l["score_id"].IsNullish ? l["id"].IsNullish ? 0 : l["id"].ToNumber() : l["score_id"].ToNumber();
        var legacy = l["legacy_score_id"].IsNullish ? l["lid"].IsNullish ? 0 : l["lid"].ToNumber() : l["legacy_score_id"].ToNumber();
        var siteId = l["solo"].Truthy && id > 0 ? id : legacy > 0 ? -legacy : 0;
        if (siteId != 0)
        {
            a.Add(JsNode.NullValue);
            a.Add(siteId);
        }
        return a;
    }

    /// <summary>The weekly block of challenges.json and the maps it mentions (weekly.mjs weeklyBlock).</summary>
    private (JsNode Block, List<int> MapIds) WeeklyBlock()
    {
        var closed = bot.WeeklyWeeks.Items.Where(w => IsWeekId(w["week"])).ToList();
        JsSort.Stable(closed, (a, b) => JsSort.LocaleCompare(a["week"].Text, b["week"].Text));
        var current = bot.WeeklyCurrent;
        var live = IsWeekId(current["week"]) && current["week"].Text == LisbonWeek(now).Id ? current : null;
        if (closed.Count == 0 && live == null)
        {
            return (JsNode.NullValue, new List<int>());
        }
        var latest = closed.Count > 0 ? closed[^1] : JsNode.Undefined;
        JsNode Shown(JsNode play) => play.Truthy && !IsHidden(hidden, play["u"]) ? play : JsNode.NullValue;
        List<JsNode> Most(JsNode rows) => rows.Items.Where(r => !IsHidden(hidden, r[0])).ToList();
        var vote = latest["mapVote"];
        var winner = vote["winner"];
        var open = latest["vote"]["url"].Truthy && vote["candidates"].Count > 0 && vote["candidates"].IsArray &&
            !(winner.IsNumber && winner.Number == Math.Floor(winner.Number))
            ? WeekOf(vote["week"].Text) : null;
        var voted = VotedMaps(closed);

        var block = JsNode.Object();
        if (live != null)
        {
            block.Set("current", JsNode.Object().Set("week", live["week"]).Set("start", live["start"]).Set("end", live["end"])
                .Set("complete", live["complete"]).Set("passes", live["passes"]).Set("players", live["players"])
                .Set("top", LogRow(Shown(live["topPp"]))).Set("most", ArrayOf(Most(live["mostPlays"]).Take(3))));
        }
        else
        {
            block.Set("current", JsNode.NullValue);
        }
        if (open is var (openId, openStart, openEnd))
        {
            var candidates = ArrayOf(vote["candidates"].Items.Select(id =>
                JsNode.ArrayOf(id, JsNode.Num(boardOf.TryGetValue((int)id.ToNumber(), out var b) && id.ToNumber() == (int)id.ToNumber() ? b.Entries.Count : 0))));
            block.Set("mapVote", JsNode.Object().Set("week", openId).Set("start", openStart).Set("end", openEnd)
                .Set("url", latest["vote"]["url"]).Set("candidates", candidates));
        }
        else
        {
            block.Set("mapVote", JsNode.NullValue);
        }
        var past = JsNode.Array();
        for (var i = closed.Count - 1; i >= 0; i--)
        {
            var w = closed[i];
            var picked = weeks[w["week"].Text];
            var most = Most(w["mostPlays"]);
            past.Add(JsNode.Object().Set("week", w["week"]).Set("start", w["start"]).Set("end", w["end"]).Set("complete", w["complete"])
                .Set("map", picked.IsNullish ? JsNode.NullValue : picked)
                .Set("voted", picked.Truthy && voted.TryGetValue(w["week"].Text, out var v) && picked.IsNumber && v == picked.Number)
                .Set("top", LogRow(Shown(w["topPp"]))).Set("most", most.Count > 0 ? most[0] : JsNode.NullValue));
        }
        block.Set("past", past);

        var mapIds = new List<JsNode> { block["current"]["top"][2] };
        mapIds.AddRange(block["mapVote"]["candidates"].Items.Select(c => c[0]));
        foreach (var p in past.Items)
        {
            mapIds.Add(p["map"]);
            mapIds.Add(p["top"][2]);
        }
        return (block, mapIds.Where(x => x.Truthy).Select(x => (int)x.ToNumber()).ToList());
    }

    /// <summary>A small stable string hash (FNV-1a), so the weekly map pick doesn't depend on randomness.</summary>
    private static uint Fnv(string text)
    {
        var h = 0x811c9dc5u;
        foreach (var c in text)
        {
            h = unchecked((uint)((int)(h ^ c) * 0x01000193));
        }
        return h;
    }

    private void BuildChallenges()
    {
        var week = LisbonWeek(now);
        weeks = JsNode.Object();
        foreach (var (k, v) in previous["weeks"].Props)
        {
            weeks.Set(k, v);
        }
        var voted = VotedMaps(bot.WeeklyWeeks.Items);
        bool OnBoards(JsNode id) => id.IsNumber && boardOf.ContainsKey((int)id.Number) && id.Number == (int)id.Number;
        if (voted.TryGetValue(week.Id, out var votedMap) && votedMap != 0 && OnBoards(JsNode.Num(votedMap)))
        {
            weeks.Set(week.Id, votedMap);
        }
        else if (!weeks[week.Id].Truthy || !OnBoards(weeks[week.Id]))
        {
            var taken = new HashSet<double>(weeks.Props.Where(kv => kv.Value.IsNumber).Select(kv => kv.Value.Number));
            var pool = boards
                .Where(b =>
                {
                    var row = Row(b.MapId);
                    return b.Cat != Cat.Loved && !IsBanned(b.MapId) && b.Entries.Count >= 4 && maps.HasTitle(row) &&
                        maps.Stars[row] >= 3.5 && maps.Stars[row] <= 6.5 && !taken.Contains(b.MapId);
                })
                .Select(b => b.MapId)
                .OrderBy(id => id)
                .ToList();
            if (pool.Count > 0)
            {
                weeks.Set(week.Id, pool[(int)(Fnv(week.Id) % (uint)pool.Count)]);
            }
        }
        var weekMap = weeks[week.Id];
        var weekBoard = weekMap.Truthy && weekMap.IsNumber && boardOf.TryGetValue((int)weekMap.Number, out var wb) ? wb : null;
        var (weeklyNode, weeklyMapIds) = WeeklyBlock();

        var contested = boards.Where(b => b.Entries.Count >= 2).ToList();
        var beatable = contested.Where(b =>
        {
            var top = b.Entries[0].Tuple;
            return b.Entries.Count >= 3 && !IsBanned(b.MapId) && maps.HasTitle(Row(b.MapId)) && (T.Acc[top] < 97 || T.Miss[top] >= 3);
        }).ToList();
        JsSort.Stable(beatable, (a, b) =>
            b.Entries.Count != a.Entries.Count ? b.Entries.Count.CompareTo(a.Entries.Count) : JsSort.Sign(maps.Stars[Row(b.MapId)] - maps.Stars[Row(a.MapId)]));
        beatable = beatable.Take(30).ToList();
        var lonely = boards.Where(b =>
        {
            var row = Row(b.MapId);
            return b.Entries.Count == 1 && !IsBanned(b.MapId) && maps.HasTitle(row) && maps.Stars[row] >= 5 && !(b.Cat == Cat.Loved && maps.Stars[row] >= 10);
        }).ToList();
        JsSort.Stable(lonely, (a, b) => JsSort.Sign(maps.Stars[Row(b.MapId)] - maps.Stars[Row(a.MapId)]) is var c && c != 0 ? c : a.MapId.CompareTo(b.MapId));
        lonely = lonely.Take(30).ToList();
        var unclaimed = new List<int>();
        for (var row = 0; row < maps.Count; row++)
        {
            if (maps.IsUnclaimedCandidate(row) && !boardOf.ContainsKey(maps.Id[row]) && !IsBanned(maps.Id[row]))
            {
                unclaimed.Add(row);
            }
        }
        JsSort.Stable(unclaimed, (a, b) => JsSort.Sign(maps.Playcount[b] - maps.Playcount[a]) is var c && c != 0 ? c : maps.Id[a].CompareTo(maps.Id[b]));
        unclaimed = unclaimed.Take(40).ToList();
        unclaimedIds.AddRange(unclaimed.Select(r => maps.Id[r]));

        JsNode Entries(IEnumerable<(int Uid, int Tuple)> entries) => ArrayOf(entries.Select(e => T.Node(e.Tuple, JsNode.Num(e.Uid))));
        challenges = JsNode.Object();
        if (weekBoard != null)
        {
            challenges.Set("week", JsNode.Object().Set("id", week.Id).Set("start", week.Start).Set("end", week.End).Set("map", weekMap)
                .Set("cat", Rules.Letter(weekBoard.Cat)).Set("board", Entries(weekBoard.Entries))
                .Set("weekly", Entries(weekBoard.Entries.Where(e => T.Time[e.Tuple] >= week.Start))));
        }
        else
        {
            challenges.Set("week", JsNode.NullValue);
        }
        challenges.Set("beatable", ArrayOf(beatable.Select(b => JsNode.ArrayOf(JsNode.Num(b.MapId), JsNode.Str(Rules.Letter(b.Cat)),
            JsNode.Num(b.Entries.Count), T.Node(b.Entries[0].Tuple, JsNode.Num(b.Entries[0].Uid))))));
        challenges.Set("lonely", ArrayOf(lonely.Select(b => JsNode.ArrayOf(JsNode.Num(b.MapId), JsNode.Str(Rules.Letter(b.Cat)),
            T.Node(b.Entries[0].Tuple, JsNode.Num(b.Entries[0].Uid))))));
        challenges.Set("unclaimed", ArrayOf(unclaimed.Select(r => JsNode.ArrayOf(JsNode.Num(maps.Id[r]), JsNode.Num(maps.Playcount[r]), JsNode.Num(maps.Favourites[r])))));
        challenges.Set("weekly", weeklyNode);
        var ids = new List<int>();
        if (weekMap.Truthy)
        {
            ids.Add((int)weekMap.ToNumber());
        }
        ids.AddRange(beatable.Select(b => b.MapId));
        ids.AddRange(lonely.Select(b => b.MapId));
        ids.AddRange(unclaimed.Select(r => maps.Id[r]));
        ids.AddRange(weeklyMapIds);
        challenges.Set("maps", MapsForNode(ids.Where(id => id != 0)));
    }
}
