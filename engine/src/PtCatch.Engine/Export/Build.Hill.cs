using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    private const int AllRounder = 3;

    private JsNode hillFile;
    private readonly List<JsNode> hillEvents = new();

    /// <summary>King of the hill (tools/lib/hill.mjs hillBlock), then the beatmap cache's tuples for its maps.</summary>
    private void BuildHill()
    {
        if (bot.Hill == null)
        {
            return;
        }
        var (file, profiles, mapIds, events) = HillBlock(bot.Hill, hidden);
        hillFile = file;
        hillEvents.AddRange(events);
        var fileMaps = file["maps"];
        foreach (var id in mapIds)
        {
            var row = Row(id);
            if (row >= 0)
            {
                fileMaps.Set(id.ToString(), MapTupleNode(row));
            }
        }
        foreach (var (id, crowns) in profiles)
        {
            if (playerFiles.TryGetValue(id, out var pf))
            {
                pf.Crowns = crowns;
            }
        }
    }

    private static bool IsMonthId(JsNode id) => id.IsString && id.Text.Length == 7 && char.IsAsciiDigit(id.Text[0]) &&
        char.IsAsciiDigit(id.Text[1]) && char.IsAsciiDigit(id.Text[2]) && char.IsAsciiDigit(id.Text[3]) && id.Text[4] == '-' &&
        char.IsAsciiDigit(id.Text[5]) && char.IsAsciiDigit(id.Text[6]);

    public static string SeasonOf(string month) =>
        $"{month[..4]}-Q{Math.Ceiling(JsNode.StringToNumber(month.Substring(5, 2)) / 3)}";

    public static string[] SeasonMonths(string season)
    {
        var first = (JsNode.StringToNumber(season[6..]) - 1) * 3 + 1;
        return new[] { 0, 1, 2 }.Select(i => $"{season[..4]}-{(first + i).ToString().PadLeft(2, '0')}").ToArray();
    }

    private static int SlotIndex(JsNode slot) => slot.IsString ? Array.IndexOf(Rules.HillSlots, slot.Text) : -1;

    private static bool KnownSlot(JsNode s) => SlotIndex(s["slot"]) >= 0 && s["tier"].IsString && Rules.HillTiers.Contains(s["tier"].Text);

    private static int BySlot(JsNode a, JsNode b) =>
        SlotIndex(a["slot"]) - SlotIndex(b["slot"]) is var c && c != 0 ? c
            : Array.IndexOf(Rules.HillTiers, a["tier"].Text) - Array.IndexOf(Rules.HillTiers, b["tier"].Text);

    private static double UnixOf(JsNode iso) => iso.IsString ? JsDate.Unix(iso.Text) : double.NaN;

    private static int[] Most(Dictionary<int, int> counts)
    {
        var top = counts.Count == 0 ? 0 : Math.Max(0, counts.Values.Max());
        return top > 0 ? counts.Where(kv => kv.Value == top).Select(kv => kv.Key).OrderBy(id => id).ToArray() : [];
    }

    private static JsNode Ids(IEnumerable<int> ids)
    {
        var a = JsNode.Array();
        foreach (var id in ids)
        {
            a.Add(id);
        }
        return a;
    }

    /// <summary>A board entry as the site reads it (hill.mjs entry).</summary>
    private static JsNode HillEntry(JsNode e)
    {
        var o = JsNode.Object();
        o.Set("u", e["userId"]).Set("name", e["username"]).Set("score", e["hillScore"]).Set("acc", e["acc"])
            .Set("combo", e["combo"]).Set("miss", e["miss"]);
        var mods = e["mods"];
        var joined = mods.IsNullish ? "" : string.Concat(mods.Items.Select(m => m.IsNullish ? "" : m.IsString ? m.Text : JsMath.ToString(m.ToNumber())));
        o.Set("mods", Rules.ModMask(joined));
        o.Set("time", UnixOf(e["time"]));
        var url = e["url"];
        if (url.IsString && url.Text.StartsWith("https://osu.ppy.sh/", StringComparison.Ordinal))
        {
            o.Set("url", url);
        }
        return o;
    }

    private static bool IsHidden(HashSet<int> hidden, JsNode id) => id.IsNumber && hidden.Contains((int)id.Number);

    /// <summary>A month's pool as the site shows it (hill.mjs pool).</summary>
    private static List<JsNode> HillPool(JsNode month, HashSet<int> hidden)
    {
        var slots = month["slots"].Items.Where(KnownSlot).ToList();
        JsSort.Stable(slots, BySlot);
        var result = new List<JsNode>();
        foreach (var s in slots)
        {
            var board = s["board"].Items.Where(e => !IsHidden(hidden, e["userId"])).ToList();
            var h = s["holder"];
            var holder = h.Truthy && !IsHidden(hidden, h["userId"]) ? h
                : month["status"].Text == "closed" ? null : board.Count > 0 ? board[0] : null;
            var o = JsNode.Object();
            o.Set("slot", s["slot"]).Set("tier", s["tier"]).Set("map", s["beatmapId"]).Set("convert", s["convert"].Truthy);
            if (Rules.HillModStars.Contains(s["slot"].Text) && s["stars"].ToNumber() > 0 && !s["stars"].IsNullish)
            {
                o.Set("stars", s["stars"]);
            }
            o.Set("holder", holder != null && holder.Truthy ? HillEntry(holder) : JsNode.NullValue);
            o.Set("players", board.Count);
            o.Set("snipes", s["snipes"].Items.Count(x => !x["fromUserId"].IsNullish && !IsHidden(hidden, x["toUserId"]) && !IsHidden(hidden, x["fromUserId"])));
            result.Add(o);
        }
        return result;
    }

    private sealed class HillPerson
    {
        public int Id;
        public JsNode Name = JsNode.Undefined;
        public int Total;
        public readonly int[] Slots = new int[Rules.HillSlots.Length];
        public readonly JsNode Seasons = JsNode.Object();
        public readonly List<JsNode> Titles = new();
        public readonly JsNode Holding = JsNode.Array();
    }

    internal static (JsNode File, List<(int Id, JsNode Crowns)> Profiles, List<int> MapIds, List<JsNode> Events) HillBlock(
        World.HillData hill, HashSet<int> hidden)
    {
        var byMonth = new Dictionary<string, JsNode>();
        var monthOrder = new List<string>();
        void Put(JsNode m)
        {
            var id = m["month"].Text;
            if (!byMonth.ContainsKey(id))
            {
                monthOrder.Add(id);
            }
            byMonth[id] = m;
        }
        foreach (var m in hill.Months)
        {
            if (IsMonthId(m["month"]))
            {
                Put(m);
            }
        }
        if (IsMonthId(hill.Current["month"]))
        {
            Put(hill.Current);
        }
        var months = monthOrder.Select(id => byMonth[id]).ToList();
        JsSort.Stable(months, (a, b) => JsSort.LocaleCompare(b["month"].Text, a["month"].Text));
        var closed = months.Where(m => m["status"].Text == "closed").ToList();
        var running = months.FirstOrDefault(m => m["status"].Text is "live" or "draft");
        var open = running != null && (closed.Count == 0 || JsSort.CodeUnits(running["month"].Text, closed[0]["month"].Text) > 0) ? running : null;

        var maps = JsNode.Object();
        void Remember(JsNode m)
        {
            foreach (var s in m["slots"].Items.Where(KnownSlot))
            {
                var t = JsNode.Array(15);
                t.Add(Or(s["artist"], ""));
                t.Add(Or(s["title"], ""));
                t.Add(Or(s["version"], ""));
                t.Add(Or(s["beatmapsetId"], 0));
                t.Add(Or(s["stars"], 0));
                for (var i = 0; i < 6; i++)
                {
                    t.Add(JsNode.NullValue);
                }
                t.Add(s["maxCombo"].IsNullish ? JsNode.NullValue : s["maxCombo"]);
                t.Add(JsNode.NullValue);
                t.Add(s["convert"].Truthy ? 0 : 2);
                t.Add(Or(s["creator"], ""));
                maps.Set(KeyOf(s["beatmapId"]), t);
            }
        }

        // The crowns: crowns.json when the bot wrote it, otherwise who held each slot when its month closed.
        var crownMonths = new List<(string Month, List<JsNode> Crowns)>();
        var crownList = hill.Crowns["months"];
        if (crownList.IsArray)
        {
            foreach (var m in crownList.Items)
            {
                if (IsMonthId(m["month"]))
                {
                    crownMonths.Add((m["month"].Text, m["crowns"].Items.Where(KnownSlot).ToList()));
                }
            }
        }
        else
        {
            foreach (var m in closed)
            {
                var crowns = new List<JsNode>();
                foreach (var s in m["slots"].Items)
                {
                    if (!KnownSlot(s) || !s["holder"].Truthy)
                    {
                        continue;
                    }
                    var c = Copy(s);
                    c.Set("userId", s["holder"]["userId"]).Set("username", s["holder"]["username"]);
                    crowns.Add(c);
                }
                crownMonths.Add((m["month"].Text, crowns));
            }
        }
        var allCrowns = new List<(JsNode C, string Month, string Season)>();
        foreach (var (month, list) in crownMonths)
        {
            foreach (var c in list)
            {
                if (!IsHidden(hidden, c["userId"]))
                {
                    allCrowns.Add((c, month, SeasonOf(month)));
                }
            }
        }

        var people = new Dictionary<int, HillPerson>();
        var peopleOrder = new List<HillPerson>();
        HillPerson PersonOf(int id, JsNode name)
        {
            if (!people.TryGetValue(id, out var p))
            {
                p = new HillPerson { Id = id, Name = name };
                people[id] = p;
                peopleOrder.Add(p);
            }
            return p;
        }
        foreach (var (c, _, season) in allCrowns)
        {
            var p = PersonOf((int)c["userId"].ToNumber(), c["username"]);
            if (c["username"].Truthy)
            {
                p.Name = c["username"];
            }
            p.Total++;
            var slot = SlotIndex(c["slot"]);
            p.Slots[slot]++;
            var bySeason = p.Seasons[season];
            if (bySeason.IsUndefined)
            {
                bySeason = JsNode.Array(6);
                for (var i = 0; i < 6; i++)
                {
                    bySeason.Add(0);
                }
                p.Seasons.Set(season, bySeason);
            }
            var counts = new double[6];
            for (var i = 0; i < 6; i++)
            {
                counts[i] = bySeason[i].Number;
            }
            counts[slot]++;
            var updated = JsNode.Array(6);
            foreach (var n in counts)
            {
                updated.Add(n);
            }
            p.Seasons.Set(season, updated);
        }

        var latest = open?["month"].Text ?? (closed.Count > 0 ? closed[0]["month"].Text : "");
        bool Finished(string season)
        {
            var last = SeasonMonths(season)[2];
            return JsSort.CodeUnits(last, latest) < 0 || closed.Any(m => m["month"].Text == last);
        }
        var monthKings = new Dictionary<string, (int[] Kings, int Count)>();
        var monthKingOrder = new List<string>();
        foreach (var (month, _) in crownMonths)
        {
            var counts = new Dictionary<int, int>();
            foreach (var (c, m, _) in allCrowns)
            {
                if (m == month)
                {
                    var id = (int)c["userId"].ToNumber();
                    counts[id] = counts.GetValueOrDefault(id) + 1;
                }
            }
            if (!monthKings.ContainsKey(month))
            {
                monthKingOrder.Add(month);
            }
            monthKings[month] = (Most(counts), counts.Count == 0 ? 0 : Math.Max(0, counts.Values.Max()));
        }
        foreach (var month in monthKingOrder)
        {
            foreach (var id in monthKings[month].Kings)
            {
                PersonOf(id, JsNode.Undefined).Titles.Add(JsNode.Object().Set("kind", "king").Set("month", month).Set("final", true));
            }
        }

        var seasonIds = allCrowns.Select(c => c.Season).Distinct().ToList();
        seasonIds.Sort(JsSort.CodeUnits);
        seasonIds.Reverse();
        var seasons = JsNode.Array();
        foreach (var id in seasonIds)
        {
            var inSeason = allCrowns.Where(c => c.Season == id).ToList();
            var final = Finished(id);
            var kings = JsNode.Object();
            foreach (var slot in Rules.HillSlots)
            {
                var counts = new Dictionary<int, int>();
                foreach (var (c, _, _) in inSeason)
                {
                    if (c["slot"].Text == slot)
                    {
                        var uid = (int)c["userId"].ToNumber();
                        counts[uid] = counts.GetValueOrDefault(uid) + 1;
                    }
                }
                if (counts.Count > 0)
                {
                    var holders = Most(counts);
                    kings.Set(slot, Ids(holders));
                    foreach (var p in holders)
                    {
                        PersonOf(p, JsNode.Undefined).Titles.Add(JsNode.Object().Set("kind", "slot").Set("season", id).Set("slot", slot).Set("final", final));
                    }
                }
            }
            var slotsOf = new Dictionary<int, HashSet<string>>();
            var slotsOrder = new List<int>();
            foreach (var (c, _, _) in inSeason)
            {
                var uid = (int)c["userId"].ToNumber();
                if (!slotsOf.TryGetValue(uid, out var set))
                {
                    slotsOf[uid] = set = new HashSet<string>();
                    slotsOrder.Add(uid);
                }
                set.Add(c["slot"].Text);
            }
            var allRounders = slotsOrder.Where(u => slotsOf[u].Count >= AllRounder).OrderBy(u => u).ToList();
            foreach (var u in allRounders)
            {
                PersonOf(u, JsNode.Undefined).Titles.Add(JsNode.Object().Set("kind", "allrounder").Set("season", id).Set("final", true));
            }
            seasons.Add(JsNode.Object().Set("id", id).Set("final", final).Set("kings", kings).Set("allRounders", Ids(allRounders)));
        }

        var current = JsNode.NullValue;
        if (open != null)
        {
            var draft = open["status"].Text == "draft";
            var shown = draft ? new List<JsNode>() : HillPool(open, hidden);
            if (!draft)
            {
                Remember(open);
            }
            var held = new Dictionary<int, int>();
            foreach (var s in shown)
            {
                var h = s["holder"];
                if (!h.Truthy)
                {
                    continue;
                }
                var uid = (int)h["u"].ToNumber();
                held[uid] = held.GetValueOrDefault(uid) + 1;
                PersonOf(uid, h["name"]).Holding.Add(JsNode.ArrayOf(s["slot"], s["tier"], s["map"]));
            }
            var leaders = Most(held);
            var pool = JsNode.Array();
            foreach (var s in shown)
            {
                pool.Add(s);
            }
            current = JsNode.Object().Set("month", open["month"]).Set("start", UnixOf(open["start"])).Set("end", UnixOf(open["end"]))
                .Set("status", draft ? "draft" : "live").Set("pool", pool)
                .Set("leaders", leaders.Length > 0 ? JsNode.Object().Set("players", Ids(leaders)).Set("held", held[leaders[0]]) : JsNode.NullValue);
        }

        var archive = new List<JsNode>();
        foreach (var m in closed)
        {
            Remember(m);
            var (kings, count) = monthKings.TryGetValue(m["month"].Text, out var k) ? k : ([], 0);
            var given = new Dictionary<string, JsNode>();
            foreach (var (c, month, _) in allCrowns)
            {
                if (month == m["month"].Text)
                {
                    given[$"{c["slot"].Text}/{c["tier"].Text}"] = c;
                }
            }
            var listed = crownMonths.Any(x => x.Month == m["month"].Text);
            var pool = JsNode.Array();
            foreach (var s in HillPool(m, hidden))
            {
                var crown = given.GetValueOrDefault($"{s["slot"].Text}/{s["tier"].Text}");
                var holderU = s["holder"]["u"];
                var crownU = crown?["userId"] ?? JsNode.Undefined;
                if (!listed || JsEquals(holderU, crownU))
                {
                    pool.Add(s);
                    continue;
                }
                var copy = Copy(s);
                copy.Set("holder", crown != null ? JsNode.Object().Set("u", crown["userId"]).Set("name", crown["username"]) : JsNode.NullValue);
                pool.Add(copy);
            }
            archive.Add(JsNode.Object().Set("month", m["month"]).Set("start", UnixOf(m["start"])).Set("end", UnixOf(m["end"]))
                .Set("kings", Ids(kings)).Set("most", count).Set("pool", pool));
        }

        // Crowns taken from someone, in the running month and the closed ones (a draft has no plays yet).
        var events = new List<JsNode>();
        foreach (var m in months.Where(x => x == open || x["status"].Text == "closed"))
        {
            if (m["status"].Text == "draft")
            {
                continue;
            }
            foreach (var s in m["slots"].Items.Where(KnownSlot))
            {
                foreach (var x in s["snipes"].Items)
                {
                    var t = UnixOf(x["time"]);
                    if (x["fromUserId"].IsNullish || IsHidden(hidden, x["toUserId"]) || IsHidden(hidden, x["fromUserId"]) || !double.IsFinite(t))
                    {
                        continue;
                    }
                    events.Add(JsNode.Object().Set("t", t).Set("k", "crown").Set("u", x["toUserId"]).Set("v", x["fromUserId"])
                        .Set("m", s["beatmapId"]).Set("h", JsNode.ArrayOf(s["slot"], s["tier"])));
                }
            }
        }
        foreach (var m in archive)
        {
            foreach (var u in m["kings"].Items)
            {
                events.Add(JsNode.Object().Set("t", m["end"]).Set("k", "crown").Set("u", u).Set("n", m["most"]).Set("mo", m["month"]));
            }
        }

        var ranked = peopleOrder.Where(p => p.Total > 0).ToList();
        JsSort.Stable(ranked, (a, b) => b.Total != a.Total ? b.Total.CompareTo(a.Total) : a.Id.CompareTo(b.Id));
        var playersNode = JsNode.Array();
        foreach (var p in ranked)
        {
            playersNode.Add(JsNode.ArrayOf(JsNode.Num(p.Id), p.Name, JsNode.Num(p.Total), Counts(p.Slots), p.Seasons));
        }
        var archiveNode = JsNode.Array();
        foreach (var m in archive)
        {
            archiveNode.Add(m);
        }
        var file = JsNode.Object().Set("current", current).Set("months", archiveNode).Set("seasons", seasons).Set("players", playersNode).Set("maps", maps);

        var profiles = new List<(int, JsNode)>();
        foreach (var p in peopleOrder)
        {
            if (p.Total == 0 && p.Holding.Count == 0)
            {
                continue;
            }
            var titles = new List<JsNode>(p.Titles);
            JsSort.Stable(titles, (a, b) =>
            {
                var c = JsSort.LocaleCompare(TitleTime(b), TitleTime(a));
                return c != 0 ? c : (b.Has("season") ? 1 : 0) - (a.Has("season") ? 1 : 0);
            });
            var titlesNode = JsNode.Array();
            foreach (var t in titles)
            {
                titlesNode.Add(t);
            }
            profiles.Add((p.Id, JsNode.Object().Set("total", p.Total).Set("slots", Counts(p.Slots)).Set("titles", titlesNode).Set("holding", p.Holding)));
        }
        var mapIds = JsNode.OrderedProps(maps).Select(kv => (int)JsNode.StringToNumber(kv.Key)).ToList();
        return (file, profiles, mapIds, events);
    }

    private static string TitleTime(JsNode title) => title["month"].IsString ? title["month"].Text : SeasonMonths(title["season"].Text)[2];

    private static JsNode Counts(int[] counts)
    {
        var a = JsNode.Array(counts.Length);
        foreach (var n in counts)
        {
            a.Add(n);
        }
        return a;
    }

    private static JsNode Or(JsNode v, string fallback) => v.IsNullish ? JsNode.Str(fallback) : v;

    private static JsNode Or(JsNode v, double fallback) => v.IsNullish ? JsNode.Num(fallback) : v;

    private static string KeyOf(JsNode v) => v.IsString ? v.Text : JsMath.ToString(v.ToNumber());

    /// <summary>A shallow copy of an object node (the spread <c>{ ...s }</c>).</summary>
    private static JsNode Copy(JsNode o)
    {
        var c = JsNode.Object();
        foreach (var (k, v) in o.Props)
        {
            c.Set(k, v);
        }
        return c;
    }

    /// <summary><c>a === b</c> for two JSON values (numbers, strings, null/undefined).</summary>
    private static bool JsEquals(JsNode a, JsNode b) =>
        a.Kind == b.Kind && a.Kind switch
        {
            JsKind.Number => a.Number == b.Number,
            JsKind.String => a.Text == b.Text,
            JsKind.Bool => a.BoolValue == b.BoolValue,
            JsKind.Undefined or JsKind.Null => true,
            _ => ReferenceEquals(a, b),
        };

    /// <summary>hill.mjs hillNow: the running month in brief, for meta.json.</summary>
    private JsNode HillNow()
    {
        var current = hillFile?["current"] ?? JsNode.NullValue;
        if (!current.Truthy)
        {
            return JsNode.NullValue;
        }
        var pool = JsNode.Array();
        var poolMaps = JsNode.Object();
        foreach (var s in current["pool"].Items)
        {
            var holderU = s["holder"]["u"];
            pool.Add(JsNode.ArrayOf(s["slot"], s["tier"], s["map"], holderU.IsNullish ? JsNode.NullValue : holderU));
            poolMaps.Set(KeyOf(s["map"]), hillFile["maps"][KeyOf(s["map"])]);
        }
        return JsNode.Object().Set("month", current["month"]).Set("end", current["end"]).Set("status", current["status"])
            .Set("pool", pool).Set("maps", poolMaps);
    }
}
