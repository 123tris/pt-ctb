using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;
using PtCatch.Engine.World;

namespace PtCatch.Engine.Export;

/// <summary>A duel as duels.mjs duelCopy leaves it: what the later steps read, and the row the site gets.</summary>
internal sealed class Duel
{
    public double Id;
    public bool Ranked;
    public string Status;
    public double? Start, End, Winner;
    public DuelSide[] Players;
    /// <summary>Each kept round's map, in order.</summary>
    public readonly List<double> Maps = new();
    public JsNode Node;
}

/// <summary>One of a duel's two players.</summary>
internal sealed class DuelSide
{
    public double U, Pts;
    /// <summary>Whether the side carries its rating change (<c>before</c>/<c>after</c>): ranked, not abandoned, both known.</summary>
    public bool Rated;
    public double Before, After;
}

/// <summary>What duels.mjs duelsBlock returns.</summary>
internal sealed record DuelsResult(
    JsNode File, JsNode Pages, Dictionary<double, JsNode> Profiles, List<double> MapIds, List<JsNode> Events, JsNode Summary);

public sealed partial class Build
{
    /// <summary>Duels in duels.json's recent list. Older ones are on their own pages (duels/&lt;n&gt;.json).</summary>
    internal const int RecentDuels = 100;
    /// <summary>Duels on a profile.</summary>
    internal const int ProfileDuels = 20;
    /// <summary>Duel results in the Activity feed at most, newest first.</summary>
    private const int FeedDuels = 60;

    private static readonly string[] DuelStatuses = ["finished", "forfeit", "abandoned"];

    private JsNode duelsFile;
    private JsNode duelPages;
    private readonly List<JsNode> duelEvents = new();
    private JsNode duelsSummary = JsNode.NullValue;

    /// <summary>
    /// Rated 1v1s (tools/lib/duels.mjs duelsBlock): duels.json for Challenges' Duels tab, a file per hundred duels for their
    /// own pages, each duelist's slice on their profile and ranked results for the Activity feed, then the beatmap cache's
    /// tuples for the maps. Nothing until the bot writes a Duels folder.
    /// </summary>
    private void BuildDuels()
    {
        var block = DuelsBlock(bot.Duels, IsPerson);
        duelEvents.AddRange(block.Events);
        duelsSummary = block.Summary;
        if (block.File == null)
        {
            return;
        }
        duelsFile = block.File;
        duelPages = block.Pages;
        FillDuelMaps(duelsFile["maps"]);
        foreach (var (_, page) in JsNode.OrderedProps(duelPages))
        {
            FillDuelMaps(page["maps"]);
        }
        foreach (var (id, slice) in block.Profiles)
        {
            if (id <= int.MaxValue && playerFiles.TryGetValue((int)id, out var file))
            {
                file.Duels = slice;
            }
        }
    }

    /// <summary><c>people.has(id)</c>.</summary>
    private bool IsPerson(double id) => id is >= int.MinValue and <= int.MaxValue && id == Math.Floor(id) && personOf.ContainsKey((int)id);

    /// <summary><c>for (const id in maps) maps[id] = mapTuple(Number(id))</c>.</summary>
    private void FillDuelMaps(JsNode maps)
    {
        foreach (var key in maps.Props.Select(p => p.Key).ToList())
        {
            var id = JsNode.StringToNumber(key);
            maps.Set(key, MapTupleNode(id is >= 0 and <= int.MaxValue && id == Math.Floor(id) ? Row((int)id) : -1));
        }
    }

    // ---- duels.mjs, value by value -------------------------------------------------------------------------------

    private static double? DuelInt(JsNode v) => v.IsSafeInteger ? v.Number : null;

    private static double DuelCount(JsNode v) => v.IsSafeInteger && v.Number >= 0 ? v.Number : 0;

    /// <summary><c>round(n, places)</c>: null for anything but a finite number.</summary>
    private static double? DuelRound(JsNode n, int places = 0) => n.IsNumber && double.IsFinite(n.Number) ? JsMath.Round(n.Number, places) : null;

    /// <summary><c>text(v, max)</c>: a trimmed, non-empty string cut to <paramref name="max"/> UTF-16 units, else null.</summary>
    private static string DuelText(JsNode v, int max = 80)
    {
        if (!v.IsString)
        {
            return null;
        }
        var t = JsString.Trim(v.Text);
        return t.Length == 0 ? null : t.Length > max ? t[..max] : t;
    }

    private static string DuelName(JsNode name, double u) => DuelText(name, 40) ?? "#" + JsMath.ToString(u);

    /// <summary><c>ids.includes(v)</c> for a duel's two osu! ids.</summary>
    private static bool IsOneOf(JsNode v, double a, double b) => v.IsNumber && (v.Number == a || v.Number == b);

    /// <summary>A duel's two players as the site shows them, or null when it doesn't have exactly two the site can show.</summary>
    private static (DuelSide[] Sides, JsNode Node) DuelSides(JsNode players, Func<double, bool> known, bool ranked)
    {
        if (!players.IsArray || players.Count != 2)
        {
            return (null, null);
        }
        var sides = new DuelSide[2];
        var node = JsNode.Array(2);
        for (var i = 0; i < 2; i++)
        {
            var p = players[i];
            if (OsuId(p["osuId"]) is not double u || !known(u))
            {
                return (null, null);
            }
            var before = DuelRound(p["ratingBefore"]);
            var after = DuelRound(p["ratingAfter"]);
            var side = new DuelSide { U = u, Pts = DuelCount(p["points"]), Rated = ranked && before != null && after != null };
            var o = JsNode.Object().Set("u", u).Set("name", DuelName(p["name"], u)).Set("pts", side.Pts);
            if (side.Rated)
            {
                side.Before = before.Value;
                side.After = after.Value;
                o.Set("before", side.Before).Set("after", side.After).Set("rd", JsNode.NumOrNull(DuelRound(p["rdAfter"])));
            }
            sides[i] = side;
            node.Add(o);
        }
        return sides[0].U != sides[1].U ? (sides, node) : (null, null);
    }

    /// <summary>A round: its map and stars, the winner (null for a tie or a void round) and both players' scores.</summary>
    private static JsNode DuelRoundCopy(JsNode r, double a, double b)
    {
        if (OsuId(r["beatmapId"]) is not double map)
        {
            return null;
        }
        var scores = JsNode.Array();
        foreach (var s in r["scores"].Items)
        {
            if (!IsOneOf(s["osuId"], a, b))
            {
                continue;
            }
            var passed = s["passed"];
            scores.Add(JsNode.Object().Set("u", s["osuId"]).Set("score", DuelCount(s["score"]))
                .Set("acc", JsNode.NumOrNull(DuelRound(s["acc"], 2))).Set("combo", DuelCount(s["combo"]))
                .Set("miss", DuelCount(s["misses"])).Set("pass", !(passed.IsBool && !passed.BoolValue)));
        }
        var reason = DuelText(r["void"], 120);
        return JsNode.Object().Set("n", JsNode.NumOrNull(DuelInt(r["n"]))).Set("map", map)
            .Set("stars", JsNode.NumOrNull(DuelRound(r["stars"], 2)))
            .Set("winner", reason == null && IsOneOf(r["winner"], a, b) ? r["winner"] : JsNode.NullValue)
            .Set("void", reason).Set("scores", scores);
    }

    private static JsNode BestOf(JsNode v) => v.IsNumber && v.Number is 1 or 3 or 5 or 7 or 9 ? v : JsNode.NullValue;

    /// <summary>A finished, forfeited or abandoned duel as the site shows it (duels.mjs duelCopy), or null to leave it out.</summary>
    internal static Duel DuelCopy(JsNode d, Func<double, bool> known)
    {
        var status = d["status"];
        if (OsuId(d["id"]) is not double id || !status.IsString || !DuelStatuses.Contains(status.Text))
        {
            return null;
        }
        var ranked = d["ranked"].IsBool && d["ranked"].BoolValue;
        var abandoned = status.Text == "abandoned";
        // An abandoned duel counts for nobody's rating, ranked or not.
        var (sides, players) = DuelSides(d["players"], known, ranked && !abandoned);
        if (sides == null)
        {
            return null;
        }
        double a = sides[0].U, b = sides[1].U;
        var min = DuelRound(d["stars"]["min"], 2);
        var max = DuelRound(d["stars"]["max"], 2);
        var winner = !abandoned && IsOneOf(d["winner"], a, b) ? d["winner"] : JsNode.NullValue;
        var duel = new Duel
        {
            Id = id, Ranked = ranked, Status = status.Text, Start = TimeOf(d["startedAt"]), End = TimeOf(d["endedAt"]),
            Winner = winner.IsNumber ? winner.Number : null, Players = sides,
        };
        var rounds = JsNode.Array();
        foreach (var r in d["rounds"].Items)
        {
            if (DuelRoundCopy(r, a, b) is { } round)
            {
                rounds.Add(round);
                duel.Maps.Add(round["map"].Number);
            }
        }
        duel.Node = JsNode.Object().Set("id", id).Set("code", DuelText(d["code"], 24)).Set("ranked", ranked).Set("bestOf", BestOf(d["bestOf"]))
            .Set("status", status.Text).Set("start", JsNode.NumOrNull(duel.Start)).Set("end", JsNode.NumOrNull(duel.End))
            .Set("mp", JsNode.NumOrNull(OsuId(d["matchId"])))
            .Set("stars", min != null && max != null ? JsNode.ArrayOf(JsNode.Num(min.Value), JsNode.Num(max.Value)) : JsNode.NullValue)
            .Set("wager", JsNode.NumOrNull(OsuId(d["wager"]))).Set("winner", winner).Set("players", players).Set("rounds", rounds);
        return duel;
    }

    /// <summary>A duel being played now (state.json <c>active</c>), from its allow-listed fields only, or null to leave it out.</summary>
    internal static JsNode LiveCopy(JsNode d, Func<double, bool> known)
    {
        var list = d["players"];
        if (OsuId(d["id"]) is not double id || !list.IsArray || list.Count != 2)
        {
            return null;
        }
        var players = JsNode.Array(2);
        var ids = new double[2];
        for (var i = 0; i < 2; i++)
        {
            var p = list[i];
            if (OsuId(p["osuId"]) is not double u || !known(u))
            {
                return null;
            }
            ids[i] = u;
            players.Add(JsNode.Object().Set("u", u).Set("name", DuelName(p["name"], u)).Set("pts", DuelCount(p["points"])));
        }
        if (ids[0] == ids[1])
        {
            return null;
        }
        return JsNode.Object().Set("id", id).Set("code", DuelText(d["code"], 24)).Set("ranked", d["ranked"].IsBool && d["ranked"].BoolValue)
            .Set("bestOf", BestOf(d["bestOf"])).Set("start", JsNode.NumOrNull(TimeOf(d["startedAt"]))).Set("mp", JsNode.NumOrNull(OsuId(d["matchId"])))
            .Set("players", players);
    }

    private sealed class LadderRow
    {
        public double U, R, Rd, W, L, Streak, Peak;
        public bool Prov;
        public JsNode Name, Last;
        public JsNode Rank = JsNode.NullValue;
    }

    /// <summary>A ladder row from ratings.json, or null for a player the site doesn't show or who has no ranked duel yet.</summary>
    private static LadderRow DuelLadderRow(string key, JsNode r, Func<double, bool> known)
    {
        var u = JsNode.StringToNumber(key);
        if (!(JsMath.IsSafeInteger(u) && u > 0) || !known(u) || !r.Truthy || DuelRound(r["r"]) is not double rating)
        {
            return null;
        }
        var w = DuelCount(r["w"]);
        var l = DuelCount(r["l"]);
        if (w == 0 && l == 0)
        {
            return null;
        }
        var rd = DuelRound(r["rd"]) ?? 350;
        return new LadderRow
        {
            U = u, Name = JsNode.Str(DuelName(r["name"], u)), R = rating, Rd = rd, W = w, L = l, Streak = DuelInt(r["streak"]) ?? 0,
            Peak = Math.Max(DuelRound(r["peak"]) ?? 0, rating), Last = JsNode.NumOrNull(TimeOf(r["lastAt"])), Prov = rd >= Rules.DuelProvisionalRd,
        };
    }

    /// <summary><c>(b.end ?? b.start ?? 0) - (a.end ?? a.start ?? 0) || b.id - a.id</c>: newest first.</summary>
    private static int NewestFirst(Duel a, Duel b)
    {
        var c = JsSort.Sign((b.End ?? b.Start ?? 0) - (a.End ?? a.Start ?? 0));
        return c != 0 ? c : JsSort.Sign(b.Id - a.Id);
    }

    /// <summary><c>{ id: null }</c> for the duels' maps, ascending (build.mjs fills in the tuples).</summary>
    private static JsNode DuelMapsOf(IEnumerable<Duel> list)
    {
        var o = JsNode.Object();
        foreach (var id in list.SelectMany(d => d.Maps).Distinct().OrderBy(id => id))
        {
            o.Set(JsMath.ToString(id), JsNode.NullValue);
        }
        return o;
    }

    private sealed class DuelProfile
    {
        public JsNode Rating = JsNode.NullValue;
        public readonly JsNode Recent = JsNode.Array();
        public readonly List<double[]> H2h = new();
        public readonly Dictionary<double, double[]> H2hOf = new();
    }

    /// <summary>
    /// Everything the site shows of duels (duels.mjs duelsBlock), or a null file before the bot has a Duels folder.
    /// <paramref name="known"/> is whether a player is on the site (restricted players and players it doesn't track
    /// aren't).
    /// </summary>
    internal static DuelsResult DuelsBlock(DuelsData duels, Func<double, bool> known)
    {
        if (duels == null)
        {
            return new DuelsResult(null, JsNode.Object(), new Dictionary<double, JsNode>(), new List<double>(), new List<JsNode>(), JsNode.NullValue);
        }
        // The same duel twice (in two month files): the one read last, from the later month, wins.
        var byId = new Dictionary<double, Duel>();
        var order = new List<double>();
        foreach (var d in duels.Matches)
        {
            if (DuelCopy(d, known) is { } copy)
            {
                if (!byId.ContainsKey(copy.Id))
                {
                    order.Add(copy.Id);
                }
                byId[copy.Id] = copy;
            }
        }
        var all = order.Select(id => byId[id]).ToList();
        JsSort.Stable(all, NewestFirst);

        var rows = new List<LadderRow>();
        foreach (var (key, r) in JsNode.OrderedProps(duels.Ratings))
        {
            if (DuelLadderRow(key, r, known) is { } row)
            {
                rows.Add(row);
            }
        }
        int ByRating(LadderRow a, LadderRow b) => JsSort.Sign(b.R - a.R) is var c && c != 0 ? c : JsSort.Sign(a.U - b.U);
        var rated = rows.Where(r => !r.Prov).ToList();
        JsSort.Stable(rated, ByRating);
        var provisional = rows.Where(r => r.Prov).ToList();
        JsSort.Stable(provisional, ByRating);
        for (var i = 0; i < rated.Count; i++)
        {
            rated[i].Rank = JsNode.Num(i + 1);
        }
        var ladder = rated.Concat(provisional).ToList();
        var ladderNode = JsNode.Array(ladder.Count);
        foreach (var r in ladder)
        {
            ladderNode.Add(JsNode.Object().Set("u", r.U).Set("name", r.Name).Set("r", r.R).Set("rd", r.Rd).Set("w", r.W).Set("l", r.L)
                .Set("streak", r.Streak).Set("peak", r.Peak).Set("last", r.Last).Set("prov", r.Prov).Set("rank", r.Rank));
        }

        var live = new List<JsNode>();
        foreach (var d in duels.Active)
        {
            if (LiveCopy(d, known) is { } copy)
            {
                live.Add(copy);
            }
        }
        JsSort.Stable(live, (a, b) =>
        {
            var c = JsSort.Sign((b["start"].IsNullish ? 0 : b["start"].Number) - (a["start"].IsNullish ? 0 : a["start"].Number));
            return c != 0 ? c : JsSort.Sign(b["id"].Number - a["id"].Number);
        });

        var recent = all.Take(RecentDuels).ToList();
        var pages = JsNode.Object();
        var pageDuels = new Dictionary<string, List<Duel>>();
        foreach (var d in all)
        {
            var name = Rules.DuelFile(d.Id);
            var page = pages[name];
            if (page.IsUndefined)
            {
                pages.Set(name, page = JsNode.Object().Set("duels", JsNode.Object()).Set("maps", JsNode.Object()));
                pageDuels[name] = new List<Duel>();
            }
            page["duels"].Set(JsMath.ToString(d.Id), d.Node);
            pageDuels[name].Add(d);
        }
        foreach (var (name, page) in JsNode.OrderedProps(pages))
        {
            page.Set("maps", DuelMapsOf(pageDuels[name]));
        }

        // Each duelist's slice: their rating, their last duels and their record against each opponent (abandoned duels
        // show in the list but count for nobody).
        var profiles = new Dictionary<double, DuelProfile>();
        DuelProfile Profile(double u)
        {
            if (!profiles.TryGetValue(u, out var p))
            {
                profiles[u] = p = new DuelProfile();
            }
            return p;
        }
        foreach (var r in ladder)
        {
            Profile(r.U).Rating = JsNode.Object().Set("r", r.R).Set("rd", r.Rd).Set("prov", r.Prov).Set("rank", r.Rank).Set("w", r.W).Set("l", r.L)
                .Set("streak", r.Streak).Set("peak", r.Peak);
        }
        foreach (var d in all)
        {
            foreach (var (me, them) in new[] { (d.Players[0], d.Players[1]), (d.Players[1], d.Players[0]) })
            {
                var p = Profile(me.U);
                var res = d.Winner == me.U ? "w" : d.Winner == them.U ? "l" : "x";
                if (p.Recent.Count < ProfileDuels)
                {
                    var o = JsNode.Object().Set("id", d.Id).Set("t", JsNode.NumOrNull(d.End ?? d.Start)).Set("opp", them.U)
                        .Set("s", JsNode.ArrayOf(JsNode.Num(me.Pts), JsNode.Num(them.Pts))).Set("res", res).Set("ranked", d.Ranked);
                    if (d.Status == "forfeit")
                    {
                        o.Set("ff", 1);
                    }
                    if (me.Rated)
                    {
                        o.Set("d", JsMath.Round(me.After - me.Before));
                    }
                    p.Recent.Add(o);
                }
                if (res == "x")
                {
                    continue;
                }
                if (!p.H2hOf.TryGetValue(them.U, out var h))
                {
                    p.H2hOf[them.U] = h = [them.U, 0, 0];
                    p.H2h.Add(h);
                }
                h[res == "w" ? 1 : 2]++;
            }
        }
        var slices = new Dictionary<double, JsNode>();
        foreach (var (u, p) in profiles)
        {
            JsSort.Stable(p.H2h, (a, b) =>
            {
                var c = JsSort.Sign(b[1] + b[2] - a[1] - a[2]);
                if (c != 0)
                {
                    return c;
                }
                c = JsSort.Sign(b[1] - a[1]);
                return c != 0 ? c : JsSort.Sign(a[0] - b[0]);
            });
            var h2h = JsNode.Array(p.H2h.Count);
            foreach (var h in p.H2h)
            {
                h2h.Add(JsNode.ArrayOf(JsNode.Num(h[0]), JsNode.Num(h[1]), JsNode.Num(h[2])));
            }
            slices[u] = JsNode.Object().Set("rating", p.Rating).Set("recent", p.Recent).Set("h2h", h2h);
        }

        var events = new List<JsNode>();
        // Ranked duels with a winner and an end time (both truthy, as in JavaScript), newest first.
        foreach (var d in all.Where(d => d.Ranked && (d.Winner is > 0 or < 0) && (d.End is > 0 or < 0)).Take(FeedDuels))
        {
            var (won, lost) = d.Players[0].U == d.Winner ? (d.Players[0], d.Players[1]) : (d.Players[1], d.Players[0]);
            var e = JsNode.Object().Set("t", d.End.Value).Set("k", "duel").Set("u", won.U).Set("v", lost.U).Set("d", d.Id)
                .Set("sc", JsNode.ArrayOf(JsNode.Num(won.Pts), JsNode.Num(lost.Pts)));
            if (won.Rated)
            {
                e.Set("r", JsMath.Round(won.After - won.Before));
            }
            if (d.Status == "forfeit")
            {
                e.Set("ff", 1);
            }
            events.Add(e);
        }

        var mapIds = new List<double>();
        var seenMaps = new HashSet<double>();
        foreach (var id in all.SelectMany(d => d.Maps))
        {
            if (seenMaps.Add(id))
            {
                mapIds.Add(id);
            }
        }
        var file = JsNode.Object().Set("ladder", ladderNode).Set("live", ArrayOf(live)).Set("recent", ArrayOf(recent.Select(d => d.Node)))
            .Set("total", all.Count).Set("maps", DuelMapsOf(recent));
        var summary = JsNode.Object().Set("live", live.Count).Set("players", ladder.Count).Set("total", all.Count)
            .Set("leader", rated.Count > 0 ? JsNode.Num(rated[0].U) : JsNode.NullValue);
        return new DuelsResult(file, pages, slices, mapIds, events, summary);
    }

    /// <summary>The maps duels were played on, from the bot's files as they are (duels.mjs duelMapIds): for the needed maps.</summary>
    internal static List<double> DuelMapIds(DuelsData duels)
    {
        var ids = new List<double>();
        if (duels == null)
        {
            return ids;
        }
        foreach (var d in duels.Matches)
        {
            foreach (var r in d["rounds"].Items)
            {
                if (OsuId(r["beatmapId"]) is double id)
                {
                    ids.Add(id);
                }
            }
        }
        return ids;
    }
}
