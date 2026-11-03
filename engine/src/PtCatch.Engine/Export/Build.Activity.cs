using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    private JsNode adminFile;
    private List<JsNode> activityEvents;
    private List<(int Uid, Cat Cat, int Tuple)> recentPlays;
    private List<JsNode> keptStateEvents;

    private void BuildActivity()
    {
        var since = now - ActivityDays * Day;
        var derived = new List<JsNode>();

        // A #1 is a snipe only if someone else held the spot before it; the bot's play log says who the play passed. A
        // play the log can't speak for falls back to the board: a #1 set after the runner-up's score took it from them.
        var log = bot.Plays;
        var logged = new Dictionary<long, List<int>>();
        for (var i = 0; i < log.Count; i++)
        {
            if (double.IsNaN(log.From) || log.Time[i] < log.From || (log.Cat[i] == "u" && !log.HasPp[i]))
            {
                continue;
            }
            var key = Key((int)log.User[i], (int)log.Map[i]);
            if (!logged.TryGetValue(key, out var lines))
            {
                logged[key] = lines = new List<int>();
            }
            lines.Add(i);
        }
        foreach (var board in boards)
        {
            if (board.Entries.Count < 2)
            {
                continue;
            }
            var (topUid, top) = board.Entries[0];
            var (secondUid, second) = board.Entries[1];
            var time = T.Time[top];
            if (time < since)
            {
                continue;
            }
            var lines = logged.TryGetValue(Key(topUid, board.MapId), out var forPlayer)
                ? forPlayer.Where(l => Math.Abs(log.Time[l] - time) <= 1).ToList()
                : new List<int>();
            double victim;
            if (lines.Count > 0)
            {
                var passing = lines.FirstOrDefault(l => !double.IsNaN(log.FirstSniped[l]), -1);
                victim = passing >= 0 ? log.FirstSniped[passing] : double.NaN;
            }
            else
            {
                victim = time > T.Time[second] ? secondUid : double.NaN;
            }
            if (double.IsNaN(victim) || victim == topUid || victim != (int)victim || !personOf.ContainsKey((int)victim))
            {
                continue;
            }
            derived.Add(JsNode.Object().Set("t", time).Set("k", "snipe").Set("u", topUid).Set("v", victim)
                .Set("c", Rules.Letter(board.Cat)).Set("s", T.Node(top)));
        }
        foreach (var p in people)
        {
            foreach (var (stage, t) in p.Dan)
            {
                if (T.Time[t] >= since)
                {
                    derived.Add(JsNode.Object().Set("t", T.Time[t]).Set("k", "dan").Set("u", p.Id).Set("d", stage).Set("s", T.Node(t)));
                }
            }
            foreach (var cat in new[] { Cat.Convert, Cat.Loved })
            {
                var list = p.PpLists[(int)cat];
                for (var i = 0; i < Math.Min(5, list.Count); i++)
                {
                    var t = list[i];
                    if (T.Time[t] >= since)
                    {
                        derived.Add(JsNode.Object().Set("t", T.Time[t]).Set("k", "top").Set("u", p.Id).Set("c", Rules.Letter(cat)).Set("i", i + 1).Set("s", T.Node(t)));
                    }
                }
            }
        }

        // King of the hill's crowns, and bounties claimed after they were posted.
        foreach (var e in hillEvents)
        {
            if (e["t"].ToNumber() >= since)
            {
                derived.Add(e);
            }
        }
        foreach (var r in bountiesFile["hall"].Items)
        {
            if (r[3].Text == "claimed" && !r[5].IsNullish && r[5].Number >= since)
            {
                var e = JsNode.Object().Set("t", r[5]).Set("k", "bounty").Set("u", r[4]).Set("m", r[0]).Set("c", r[1]).Set("g", r[2]);
                if (r[11].Truthy)
                {
                    e.Set("a", r[11]);
                }
                derived.Add(e);
            }
        }
        adminFile = AdminFile(bot.AdminPanel);
        BuildEconomy();
        foreach (var e in bountyPosts.Concat(economyEvents))
        {
            if (e["t"].ToNumber() >= since)
            {
                derived.Add(e);
            }
        }
        ApplyEconomyToPlayers();

        // State-based events: overtakes on the pp boards, pp milestones and new players, found by comparing with the
        // previous export.
        var stateEvents = new List<JsNode>();
        foreach (var e in previous["events"].Items)
        {
            if (!InvolvesHidden(e))
            {
                stateEvents.Add(e);
            }
        }
        var previousBoards = previous["boards"];
        if (previousBoards.Truthy)
        {
            var wasInactive = new HashSet<double>(previous["inactive"].Items.Select(x => x.ToNumber()));
            foreach (var cat in new[] { Cat.Convert, Cat.Loved, Cat.Ranked })
            {
                var before = new Dictionary<double, int>();
                var list = previousBoards[Rules.Letter(cat)].Items;
                for (var i = 0; i < list.Count; i++)
                {
                    before[list[i].ToNumber()] = i;
                }
                var ranking = order[cat];
                for (var i = 0; i < ranking.Count; i++)
                {
                    var p = ranking[i];
                    if (!before.TryGetValue(p.Id, out var was) || was <= i)
                    {
                        continue;
                    }
                    if (cat == Cat.Ranked && (p.Inactive || wasInactive.Contains(p.Id)))
                    {
                        continue;
                    }
                    var passed = new List<int>();
                    for (var j = i + 1; j < ranking.Count; j++)
                    {
                        if (before.TryGetValue(ranking[j].Id, out var w) && w < was)
                        {
                            passed.Add(ranking[j].Id);
                        }
                    }
                    if (passed.Count > 0)
                    {
                        var pp = cat == Cat.Convert ? p.Cv : cat == Cat.Loved ? p.Ul : p.Pp;
                        stateEvents.Add(JsNode.Object().Set("t", now).Set("k", "pass").Set("u", p.Id).Set("c", Rules.Letter(cat))
                            .Set("v", Ids(passed)).Set("r", i + 1).Set("pp", pp));
                    }
                }
            }
            var known = previous["known"];
            var knownIds = new HashSet<double>(known.Items.Select(x => x.ToNumber()));
            foreach (var p in people)
            {
                var old = previous["totals"][p.Id.ToString()];
                if (!old.Truthy)
                {
                    if (known.Truthy && !knownIds.Contains(p.Id))
                    {
                        stateEvents.Add(JsNode.Object().Set("t", now).Set("k", "join").Set("u", p.Id));
                    }
                    continue;
                }
                foreach (var (cat, pp, was) in new[] { ("c", p.Cv, old[0]), ("u", p.Ul, old[1]) })
                {
                    var reached = Math.Floor(pp / PpMilestones) * PpMilestones;
                    if (reached > 0 && was.ToNumber() < reached)
                    {
                        stateEvents.Add(JsNode.Object().Set("t", now).Set("k", "mile").Set("u", p.Id).Set("c", cat).Set("pp", reached));
                    }
                }
            }
        }
        keptStateEvents = stateEvents.Where(e => e["t"].ToNumber() >= since).ToList();
        JsSort.Stable(keptStateEvents, (a, b) => JsSort.Sign(b["t"].ToNumber() - a["t"].ToNumber()));
        if (keptStateEvents.Count > MaxEvents)
        {
            keptStateEvents.RemoveRange(MaxEvents, keptStateEvents.Count - MaxEvents);
        }
        var events = new List<JsNode>(derived);
        events.AddRange(keptStateEvents);
        JsSort.Stable(events, (a, b) =>
        {
            var c = JsSort.Sign(b["t"].ToNumber() - a["t"].ToNumber());
            return c != 0 ? c : JsSort.LocaleCompare(a["k"].Text, b["k"].Text);
        });
        if (events.Count > MaxEvents)
        {
            events.RemoveRange(MaxEvents, events.Count - MaxEvents);
        }
        activityEvents = events;

        // The newest 80 plays: a stable sort by time over every board play is the same as taking the first 80 of
        // (time, original order), which needs no full sort.
        var all = new List<(int Uid, Cat Cat, int Tuple)>();
        foreach (var p in people)
        {
            foreach (var cat in Rules.Cats)
            {
                foreach (var t in p.Lists[(int)cat])
                {
                    all.Add((p.Id, cat, t));
                }
            }
        }
        var index = Enumerable.Range(0, all.Count).ToArray();
        JsSort.Stable(index, (a, b) => JsSort.Sign(T.Time[all[b].Tuple] - T.Time[all[a].Tuple]));
        recentPlays = index.Take(80).Select(i => all[i]).ToList();
    }

    private bool InvolvesHidden(JsNode e)
    {
        if (IsHidden(hidden, e["u"]))
        {
            return true;
        }
        var v = e["v"];
        if (v.IsArray)
        {
            return v.Items.Any(id => IsHidden(hidden, id));
        }
        return !v.IsNullish && IsHidden(hidden, v);
    }

    private byte[] ActivityBytes(JsJsonWriter w)
    {
        var mapIds = new List<int>();
        foreach (var e in activityEvents)
        {
            var s = e["s"];
            if (s.Truthy)
            {
                mapIds.Add((int)s[0].ToNumber());
            }
            else if (e["m"].Truthy)
            {
                mapIds.Add((int)e["m"].ToNumber());
            }
        }
        foreach (var (_, _, t) in recentPlays)
        {
            mapIds.Add(T.Map[t]);
        }
        w.Reset();
        w.BeginObject();
        w.Key("events");
        w.BeginArray();
        foreach (var e in activityEvents)
        {
            w.Node(e);
        }
        w.EndArray();
        w.Key("recent");
        w.BeginArray();
        foreach (var (uid, cat, t) in recentPlays)
        {
            T.WriteRow(w, uid, Rules.Letter(cat), t);
        }
        w.EndArray();
        w.Key("maps");
        WriteMapsFor(w, mapIds);
        w.EndObject();
        return w.ToArray();
    }
}
