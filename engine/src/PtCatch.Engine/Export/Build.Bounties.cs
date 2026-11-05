using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    private JsNode bountiesFile;
    private readonly List<JsNode> bountyPosts = new();
    private readonly List<int> openBountyMapIds = new();
    private static readonly string[] Goals = ["fc", "pass", "snipe"];

    /// <summary>
    /// The bounty board (tools/lib/bounties.mjs): the bot's bounties, built field by field so its Discord ids never leave,
    /// and the "wanted" boss maps nobody here has full-combo'd.
    /// </summary>
    private void BuildBounties()
    {
        var wanted = boards
            .Where(b =>
            {
                var row = Row(b.MapId);
                return b.Entries.Count >= 3 && !IsBanned(b.MapId) && maps.HasTitle(row) && maps.Stars[row] >= 6.5 &&
                    !(b.Cat == Cat.Loved && maps.Stars[row] >= 10) && b.Entries.All(e => T.Miss[e.Tuple] > 0);
            })
            .ToList();
        JsSort.Stable(wanted, (a, b) =>
        {
            var c = b.Entries.Count.CompareTo(a.Entries.Count);
            if (c != 0)
            {
                return c;
            }
            c = JsSort.Sign(maps.Stars[Row(b.MapId)] - maps.Stars[Row(a.MapId)]);
            return c != 0 ? c : a.MapId.CompareTo(b.MapId);
        });
        var wantedRows = wanted.Take(20)
            .Select(b => JsNode.ArrayOf(JsNode.Num(b.MapId), JsNode.Str(Rules.Letter(b.Cat)), JsNode.Num(b.Entries.Count),
                JsNode.Num(b.Entries.Min(e => T.Miss[e.Tuple]))))
            .ToList();

        var open = new List<JsNode>();
        var hall = new List<JsNode>();
        bool Known(double? uid) => uid is double u && personOf.ContainsKey((int)u) && u == (int)u;
        foreach (var b in bot.Bounties.Items)
        {
            if (!b.Truthy || !b["goal"].IsString || !Goals.Contains(b["goal"].Text) || !b["map"].IsSafeInteger)
            {
                continue;
            }
            var map = (int)b["map"].Number;
            boardOf.TryGetValue(map, out var board);
            var cat = board?.Cat ?? CatOf(map, Cat.None);
            if (cat == Cat.None)
            {
                continue;
            }
            var status = b["status"].Text;
            var bananas = BountyBananas(b, Known);
            if (status == "open")
            {
                var misses = board != null ? JsNode.Num(board.Entries.Min(e => T.Miss[e.Tuple])) : JsNode.NullValue;
                var target = b["goal"].Text == "snipe" && Known(OsuId(b["target"])) ? b["target"] : JsNode.NullValue;
                var pledges = JsNode.Array();
                foreach (var p in b["pledges"].Items)
                {
                    var row = PledgeRow(p, now);
                    if (row[0].Truthy)
                    {
                        pledges.Add(row);
                    }
                }
                var r = JsNode.ArrayOf(JsNode.Num(map), JsNode.Str(Rules.Letter(cat)), b["goal"], JsNode.NumOrNull(TimeOf(b["posted"])),
                    JsNode.Num(board?.Entries.Count ?? 0), misses, target, pledges);
                foreach (var v in bananas.Items)
                {
                    r.Add(v);
                }
                open.Add(r);
            }
            else if ((status == "claimed" || status == "done") && b["claim"].Truthy && Known(OsuId(b["claim"]["user"])))
            {
                var c = b["claim"];
                var at = TimeOf(c["at"]);
                var prizes = JsNode.Array();
                foreach (var p in b["pledges"].Items)
                {
                    var row = PledgeRow(p, at ?? now);
                    if (row[0].Truthy && !row[4].Truthy)
                    {
                        prizes.Add(JsNode.ArrayOf(row[0], row[1], row[2]));
                    }
                }
                var mods = TextOf(c["mods"]);
                hall.Add(JsNode.ArrayOf(JsNode.Num(map), JsNode.Str(Rules.Letter(cat)), b["goal"], b["status"], c["user"], JsNode.NumOrNull(at),
                    JsNode.Str(mods == null ? "" : mods == "NM" ? "" : mods), RoundOrNull(c["acc"], 2),
                    c["combo"].IsSafeInteger ? c["combo"] : JsNode.NullValue, RoundOrNull(c["pp"], 1), prizes,
                    c["payout"].IsSafeInteger && c["payout"].Number > 0 ? c["payout"] : JsNode.NullValue));
            }
            var poster = bananas[3];
            var stake = bananas[6];
            if (poster.Truthy && stake.Truthy && (status == "open" || status == "claimed") && TimeOf(b["posted"]) is double postedAt)
            {
                bountyPosts.Add(JsNode.Object().Set("t", postedAt).Set("k", "post").Set("u", poster).Set("m", map)
                    .Set("c", Rules.Letter(cat)).Set("g", b["goal"]).Set("a", stake));
            }
        }
        JsSort.Stable(open, (a, b) => JsSort.Sign(OrZero(b[3]) - OrZero(a[3])) is var c && c != 0 ? c : JsSort.Sign(a[0].Number - b[0].Number));
        JsSort.Stable(hall, (a, b) => JsSort.Sign(OrZero(b[5]) - OrZero(a[5])) is var c && c != 0 ? c : JsSort.Sign(a[0].Number - b[0].Number));
        var posted = new HashSet<double>(open.Select(r => r[0].Number));

        bountiesFile = JsNode.Object();
        bountiesFile.Set("open", ArrayOf(open));
        bountiesFile.Set("hall", ArrayOf(hall));
        bountiesFile.Set("wanted", ArrayOf(wantedRows.Where(r => !posted.Contains(r[0].Number))));
        var ids = new List<int>();
        foreach (var key in new[] { "open", "hall", "wanted" })
        {
            foreach (var r in bountiesFile[key].Items)
            {
                ids.Add((int)r[0].Number);
            }
        }
        bountiesFile.Set("maps", MapsForNode(ids));
        foreach (var r in open)
        {
            openBountyMapIds.Add((int)r[0].Number);
        }
    }

    private static double OrZero(JsNode v) => v.IsNullish ? 0 : v.ToNumber();

    internal static JsNode ArrayOf(IEnumerable<JsNode> items)
    {
        var a = JsNode.Array();
        foreach (var i in items)
        {
            a.Add(i);
        }
        return a;
    }

    /// <summary>bounties.mjs time: unix seconds of an ISO string (isoTime), or null.</summary>
    private static double? TimeOf(JsNode iso)
    {
        if (!iso.IsString)
        {
            return null;
        }
        var t = JsDate.IsoTime(iso.Text);
        return double.IsNaN(t) ? null : t;
    }

    private static string TextOf(JsNode v) => v.IsString && v.Text.Trim().Length > 0 ? v.Text.Trim() : null;

    private static double? OsuId(JsNode v) => v.IsSafeInteger && v.Number > 0 ? v.Number : null;

    private static JsNode RoundOrNull(JsNode v, int places) =>
        v.IsNumber && double.IsFinite(v.Number) ? JsNode.Num(JsMath.Round(v.Number, places)) : JsNode.NullValue;

    /// <summary>A pledge as [prize, by, byOsu, until, lapsed].</summary>
    private static JsNode PledgeRow(JsNode p, double now)
    {
        var until = TimeOf(p["until"]);
        return JsNode.ArrayOf(JsNode.Str(TextOf(p["prize"])), JsNode.Str(TextOf(p["by"])), JsNode.NumOrNull(OsuId(p["byOsu"])),
            JsNode.NumOrNull(until), JsNode.Bool(until is double u && u < now));
    }

    /// <summary>A bounty's Bananas: [id, pot, funds, poster, expires, mods, stake] (bounties.mjs bananas).</summary>
    private static JsNode BountyBananas(JsNode b, Func<double?, bool> known)
    {
        var stake = b["stake"].IsSafeInteger && b["stake"].Number > 0 ? b["stake"].Number : 0;
        var funds = new List<JsNode>();
        if (b["funds"].IsArray)
        {
            foreach (var f in b["funds"].Items)
            {
                if (f["amount"].IsSafeInteger && f["amount"].Number > 0)
                {
                    funds.Add(JsNode.ArrayOf(known(OsuId(f["user"])) ? f["user"] : JsNode.NullValue, f["amount"]));
                }
            }
        }
        JsSort.Stable(funds, (x, y) => JsSort.Sign(y[1].Number - x[1].Number));
        var pot = stake + funds.Sum(f => f[1].Number);
        var modsText = TextOf(b["mods"]);
        var mods = modsText == null || modsText == "NM" ? null : modsText;
        var poster = known(OsuId(b["poster"])) ? b["poster"] : JsNode.NullValue;
        return JsNode.ArrayOf(b["id"].IsSafeInteger ? b["id"] : JsNode.NullValue, pot != 0 ? JsNode.Num(pot) : JsNode.NullValue,
            ArrayOf(funds), poster, JsNode.NumOrNull(TimeOf(b["expires"])), JsNode.Str(mods), stake != 0 ? JsNode.Num(stake) : JsNode.NullValue);
    }
}
