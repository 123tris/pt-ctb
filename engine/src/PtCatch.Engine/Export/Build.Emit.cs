using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    /// <summary>The previous history.json (read back from the output folder), or null.</summary>
    private readonly JsNode previousHistory;

    private void BuildMetaAndState()
    {
        var week = challenges["week"];
        Meta = JsNode.Object()
            .Set("generatedAt", now)
            .Set("homeCountry", home)
            .Set("dump", string.IsNullOrEmpty(bot.LastImportedDump) ? JsNode.NullValue : JsNode.Str(bot.LastImportedDump))
            .Set("totals", records["totals"])
            .Set("completion", HomeGoal())
            .Set("hill", HillNow())
            .Set("duels", duelsSummary)
            .Set("week", week.Truthy ? JsNode.Object().Set("map", week["map"]).Set("end", week["end"]) : JsNode.NullValue);

        var boardsNode = JsNode.Object();
        foreach (var cat in Rules.Cats)
        {
            boardsNode.Set(Rules.Letter(cat), Ids(order[cat].Select(p => p.Id)));
        }
        var totals = JsNode.Object();
        foreach (var p in people)
        {
            totals.Set(p.Id.ToString(), JsNode.ArrayOf(JsNode.Num(p.Cv), JsNode.Num(p.Ul), JsNode.Num(p.Pp)));
        }
        var official = JsNode.Object();
        foreach (var (k, v) in previous["official"].Props)
        {
            official.Set(k, v);
        }
        foreach (var p in people)
        {
            if (!p.Inactive && p.Pp > 0)
            {
                official.Set(p.Id.ToString(), JsNode.ArrayOf(JsNode.Num(p.Pp), JsNode.Num(now)));
            }
        }
        var known = new SortedSet<int>(people.Select(p => p.Id));
        foreach (var id in previous["known"].Items)
        {
            if (IsHidden(hidden, id))
            {
                known.Add((int)id.Number);
            }
        }
        State = JsNode.Object()
            .Set("boards", boardsNode)
            .Set("totals", totals)
            .Set("official", official)
            .Set("inactive", Ids(people.Where(p => p.Inactive).Select(p => p.Id).OrderBy(id => id)))
            .Set("officialLiveOnly", true)
            .Set("known", Ids(known))
            .Set("events", ArrayOf(keptStateEvents))
            .Set("weeks", weeks)
            .Set("cleared", completionFirsts)
            .Set("unlocks", unlocksSeen);
    }

    private static byte[] NodeBytes(JsNode node, JsJsonWriter w)
    {
        w.Reset();
        w.Node(node);
        return w.ToArray();
    }

    /// <summary>
    /// Every file but meta.json, in the exporter's order. The systems have run, so each file only reads what they left:
    /// they're written in parallel, each with its own writer, and listed in order.
    /// </summary>
    private void EmitFiles()
    {
        var jobs = new List<(string Name, Func<JsJsonWriter, byte[]> Write)>
        {
            ("players.json", w => NodeBytes(ArrayOf(players), w)),
            ("modrankings.json", ModRankingsBytes),
            ("topplays.json", TopPlaysBytes),
            ("dan.json", DanBytes),
            ("activity.json", ActivityBytes),
            ("records.json", w => NodeBytes(records, w)),
            ("challenges.json", w => NodeBytes(challenges, w)),
            ("bounties.json", w => NodeBytes(bountiesFile, w)),
            ("completion.json", w => NodeBytes(completionFile, w)),
            ("quiz.json", w => NodeBytes(quizFile, w)),
        };
        if (hillFile != null)
        {
            jobs.Add(("hill.json", w => NodeBytes(hillFile, w)));
        }
        if (duelsFile != null)
        {
            // duels.json, then a file per hundred duel ids (duels/<n>.json), newest duel's file first.
            jobs.Add(("duels.json", w => NodeBytes(duelsFile, w)));
            foreach (var (name, page) in JsNode.OrderedProps(duelPages))
            {
                jobs.Add((name, w => NodeBytes(page, w)));
            }
        }
        if (economyFile != null)
        {
            jobs.Add(("economy.json", w => NodeBytes(economyFile, w)));
        }
        if (adminFile != null)
        {
            jobs.Add(("admin.json", w => NodeBytes(adminFile, w)));
        }
        jobs.Add(("unlocks.json", w => NodeBytes(unlocksFile, w)));
        jobs.Add(("history.json", w => NodeBytes(historyFile, w)));
        jobs.Add(("maps-top.json", MapsTopBytes));
        jobs.Add(("maps-search.json", MapsSearchBytes));
        jobs.Add(("search-maps.json", SearchMapsBytes));
        foreach (var (id, file) in playerFiles)
        {
            jobs.Add(($"players/{id}.json", w => PlayerFileBytes(file, w)));
        }
        foreach (var (id, bytes) in headBytes)
        {
            jobs.Add(($"players/{id}-head.json", _ => bytes));
        }
        foreach (var bucket in BucketOrder().GroupBy(e => e.Key % Buckets))
        {
            var entries = bucket.ToList();
            jobs.Add(($"maps/{bucket.Key}.json", w => BucketBytes(entries, w)));
        }
        foreach (var bucket in setLists.GroupBy(e => e.Key % Buckets).OrderBy(g => g.Key))
        {
            var sets = bucket.OrderBy(e => e.Key).ToList();
            jobs.Add(($"sets/{bucket.Key}.json", w => SetBucketBytes(sets, w)));
        }
        var bytesOf = new byte[jobs.Count][];
        System.Threading.Tasks.Parallel.For(0, jobs.Count, () => new JsJsonWriter(1 << 20), (i, _, w) =>
        {
            bytesOf[i] = jobs[i].Write(w);
            return w;
        }, w => w.Dispose());
        for (var i = 0; i < jobs.Count; i++)
        {
            Files.Add((jobs[i].Name, bytesOf[i]));
        }
    }
}
