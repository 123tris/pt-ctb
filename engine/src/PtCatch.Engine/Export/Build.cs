using System;
using System.Collections.Generic;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;
using PtCatch.Engine.World;

namespace PtCatch.Engine.Export;

/// <summary>A home-country player: their lists of plays (rows of <see cref="Tuples"/>) and what's worked out from them.</summary>
public sealed class Person
{
    public int Id;
    public string Name;
    public UserRecord Raw;
    public DumpRecord Dump;
    /// <summary>Board plays by category (index by <see cref="Cat"/>), one per map, best pp first.</summary>
    public readonly List<int>[] Lists = [null, new(), new(), new()];
    /// <summary>What pp is counted from, by category.</summary>
    public readonly List<int>[] PpLists = [null, null, null, null];
    public List<int> PpOnly = new();
    /// <summary>
    /// Every ranked catch-specific play before the board picks one per map by score (the yearly ranked pp count each
    /// map's best pp from it).
    /// </summary>
    public List<int> RankedPool = new();
    public List<int> DumpTop = new();
    public List<int> DumpMods = new();
    public List<int> LiveRanked = new();
    public readonly List<int>[] ModPlays = [null, new(), new(), new()];
    /// <summary>Raw score rows from before their map was ranked.</summary>
    public readonly List<int> Early = new();
    public List<int> Pre = new();
    public double Cv, Ul, Pp;
    public double? Global, Country;
    public OfficialStats Official;
    public bool Inactive;
    public JsNode PpSeen = JsNode.Undefined;
    public string PpSource;
    public readonly int[] Firsts = new int[4];
    /// <summary>Dan passes: (stage index, tuple).</summary>
    public readonly List<(int Stage, int Tuple)> Dan = new();
    public double DanScore;
    /// <summary>The newest play's time, NaN for none (null in the file).</summary>
    public double Last;
}

/// <summary>The official osu! stats build.mjs officialStats() picks for a player.</summary>
public sealed class OfficialStats
{
    public double? Pp, Global, Country, Acc, Level, Plays;
    public double?[] Grades = [];
}

/// <summary>A map's board: every player's best play there, in the map's order, one per player.</summary>
public sealed class Board
{
    public int MapId;
    public Cat Cat;
    public readonly List<(int Uid, int Tuple)> Entries = new();
}

/// <summary>
/// The site's public data from the bot's (build.mjs, ported). Pure, like the original: it takes the loaded data, the
/// previous exporter state and the time, and returns the files and the next state; nothing here touches the disk.
/// Every list is a list of tuple rows; every order and tie-break is the original's, because the published files (and
/// their content-hashed names) must not change when the engine replaces the Node exporter.
/// </summary>
public sealed partial class Build
{
    private const double Day = 86400;
    private const int Buckets = 128;
    private const int MapsTop = 500;
    private const int HeadRows = 50;
    private const int TopPlaysCap = 50;
    private const double HardStars = 6;
    private const double PpMilestones = 1000;
    private const double ActivityDays = 120;
    private const int MaxEvents = 400;
    private const double QualifiedAllowance = 14 * Day;

    private readonly BotData bot;
    private readonly RawScores raw;
    private readonly Beatmaps maps;
    private readonly string home;
    private readonly double now;
    private readonly JsNode previous;
    private readonly Dictionary<int, PastOfficial> pastOfficial;
    private readonly Beatmaps extraTitles;
    private readonly Tuples T = new();
    private readonly HashSet<int> hidden = new();
    private readonly List<Person> people = new();
    private readonly Dictionary<int, Person> personOf = new();
    private readonly List<Board> boards = new();
    private readonly Dictionary<int, Board> boardOf = new();
    private readonly Dictionary<long, int> position = new();
    /// <summary>Each raw score's map row, -1 when the map isn't cached.</summary>
    private readonly int[] rawRow;

    /// <summary>The files, in the order the exporter listed them (meta.json's file list keeps it).</summary>
    public readonly List<(string Name, byte[] Bytes)> Files = new();

    /// <summary>meta.json, without its <c>files</c> list (the export adds the hashes).</summary>
    public JsNode Meta;

    /// <summary>The exporter's next state (state/state.json).</summary>
    public JsNode State;

    /// <summary>players.json's ids, for the avatars.</summary>
    public readonly List<int> PlayerIds = new();

    public Build(BotData bot, Beatmaps maps, string homeCountry, double now, JsNode previousState,
        Dictionary<int, PastOfficial> pastOfficial, Beatmaps extraTitles, JsNode previousHistory)
    {
        this.previousHistory = previousHistory;
        this.bot = bot;
        raw = bot.Scores;
        this.maps = maps;
        home = homeCountry;
        this.now = now;
        previous = previousState ?? JsNode.Object();
        this.pastOfficial = pastOfficial ?? new Dictionary<int, PastOfficial>();
        this.extraTitles = extraTitles;
        maps.Freeze();
        rawRow = new int[raw.Count];
        for (var r = 0; r < raw.Count; r++)
        {
            rawRow[r] = maps.RowOf(raw.Map[r]);
        }
        foreach (var p in bot.Players)
        {
            if (p.Restricted)
            {
                hidden.Add(p.UserId);
            }
        }
    }

    /// <summary>The players osu! has restricted (build.mjs restrictedIds).</summary>
    public static HashSet<int> RestrictedIds(BotData bot)
    {
        var ids = new HashSet<int>();
        foreach (var p in bot.Players)
        {
            if (p.Restricted)
            {
                ids.Add(p.UserId);
            }
        }
        return ids;
    }

    /// <summary>
    /// Which beatmap ids the export needs metadata for, so the cache can be filtered while loading; in the order they're
    /// first met (a JavaScript Set's), which decides where maps the exporter adds go in its beatmap list.
    /// </summary>
    public static List<int> NeededMapIds(BotData bot, string homeCountry)
    {
        var seen = new HashSet<int>();
        var ids = new List<int>();
        void One(int id)
        {
            if (seen.Add(id))
            {
                ids.Add(id);
            }
        }
        foreach (var id in Rules.DanMaps)
        {
            One(id);
        }
        var hidden = RestrictedIds(bot);
        var s = bot.Scores;
        void Add(ScoreList list)
        {
            for (var r = list.Start; r < list.End; r++)
            {
                One(s.Map[r]);
            }
        }
        foreach (var p in bot.Players)
        {
            if (p.Country != homeCountry || hidden.Contains(p.UserId))
            {
                continue;
            }
            Add(p.TopConverted);
            Add(p.TopUnranked);
            Add(p.RankedSpecific);
            Add(p.PreRank);
            Add(p.ConvertMod);
            Add(p.UnrankedMod);
            Add(p.RankedMod);
            foreach (var r in p.DanPasses)
            {
                if (r >= 0)
                {
                    One(s.Map[r]);
                }
            }
        }
        foreach (var p in bot.PtCatch)
        {
            if (p.Country != homeCountry || hidden.Contains(p.UserId))
            {
                continue;
            }
            Add(p.TopScores);
            Add(p.CommunityScores);
            Add(p.ModScores);
        }
        if (bot.Hill != null)
        {
            foreach (var m in Prepend(bot.Hill.Current, bot.Hill.Months))
            {
                foreach (var slot in m["slots"].Items)
                {
                    var id = slot["beatmapId"];
                    if (id.Truthy)
                    {
                        One((int)id.ToNumber());
                    }
                }
            }
        }
        foreach (var id in DuelMapIds(bot.Duels))
        {
            // A map id past int's range is on no cached map (osu!'s ids are far below it).
            if (id <= int.MaxValue)
            {
                One((int)id);
            }
        }
        foreach (var b in bot.Bounties.Items)
        {
            var map = b["map"];
            if (map.IsSafeInteger)
            {
                One((int)map.Number);
            }
        }
        return ids;
    }

    private static IEnumerable<JsNode> Prepend(JsNode first, List<JsNode> rest)
    {
        yield return first;
        foreach (var x in rest)
        {
            yield return x;
        }
    }

    /// <summary>
    /// Runs every system, in the original's order (later ones read what earlier ones left). <paramref name="timing"/> hears
    /// each one's name and milliseconds.
    /// </summary>
    public void Run(Action<string, double> timing = null)
    {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        void Step(string name, Action system)
        {
            var started = clock.Elapsed.TotalMilliseconds;
            system();
            timing?.Invoke(name, clock.Elapsed.TotalMilliseconds - started);
        }
        Step("people", BuildPeople);
        Step("boards", BuildBoards);
        Step("summaries", BuildSummaries);
        Step("players", BuildPlayersFile);
        Step("player files", BuildPlayerFiles);
        Step("hill", BuildHill);
        Step("duels", BuildDuels);
        Step("map buckets", BuildMapBuckets);
        Step("mod rankings", BuildModRankings);
        Step("top plays", BuildTopPlays);
        Step("bounties", BuildBounties);
        Step("activity", BuildActivity);
        Step("records", BuildRecords);
        Step("challenges", BuildChallenges);
        Step("sets", BuildSets);
        Step("completion", BuildCompletion);
        Step("quiz", BuildQuiz);
        Step("history", BuildHistory);
        Step("heads", BuildHeads);
        Step("meta and state", BuildMetaAndState);
        Step("emit", EmitFiles);
    }

    // ---- Shared helpers ----------------------------------------------------------------------------------------

    private int Row(int mapId) => maps.RowOf(mapId);

    private bool IsBanned(int mapId) => bot.Banned.Contains(mapId);

    /// <summary>The category a map's plays go under; <paramref name="fallback"/> when the map isn't cached.</summary>
    private Cat CatOf(int mapId, Cat fallback)
    {
        var row = Row(mapId);
        return row >= 0 ? maps.Classify(row) : fallback;
    }

    /// <summary>Whether a stored play can be shown at all: not failed, and not on a map known to be taiko or mania.</summary>
    private bool Playable(int r) => raw.Rank[r] != "F" && !maps.IsOtherMode(rawRow[r]);

    /// <summary>build.mjs setBeforeRanking: a play from before its map was ranked.</summary>
    private bool SetBeforeRanking(int r, int mapRow, bool onRankedBoard)
    {
        if (mapRow < 0 || !maps.IsRankedOrApproved(mapRow))
        {
            return false;
        }
        var ranked = maps.RankedAt(mapRow);
        var time = raw.HasDate[r] ? raw.Time[r] : double.NaN;
        if (double.IsNaN(ranked) || !(time > 0))
        {
            return false;
        }
        return time < ranked - (onRankedBoard ? QualifiedAllowance : 0);
    }

    /// <summary>A tuple from a bot score, at 0pp on a banned map.</summary>
    private int Tuple(int r) => T.FromRaw(raw, r, IsBanned(raw.Map[r]), rawRow[r]);

    private static long Key(int uid, int mapId) => ((long)uid << 32) | (uint)mapId;

    private int PositionOf(int uid, int mapId) => position.TryGetValue(Key(uid, mapId), out var pos) ? pos : 0;

    /// <summary>
    /// The best play per map by the order of the map's board (build.mjs bestOnBoard), sorted best pp first.
    /// </summary>
    private List<int> BestOnBoard(List<int> tuples, Cat cat)
    {
        var byMap = new Dictionary<int, int>(tuples.Count);
        var order = new List<int>(tuples.Count);
        foreach (var t in tuples)
        {
            if (!byMap.TryGetValue(T.Map[t], out var old))
            {
                byMap[T.Map[t]] = t;
                order.Add(T.Map[t]);
            }
            else if (BoardBeats(t, old, cat))
            {
                byMap[T.Map[t]] = t;
            }
        }
        var result = new List<int>(order.Count);
        foreach (var m in order)
        {
            result.Add(byMap[m]);
        }
        SortByPpThenMap(result);
        return result;
    }

    private bool ByPp(int a, int b) => T.Pp[a] > T.Pp[b] || (T.Pp[a] == T.Pp[b] && T.Score[a] > T.Score[b]);

    private bool BoardBeats(int a, int b, Cat cat)
    {
        if (cat == Cat.Loved)
        {
            return ByPp(a, b);
        }
        var aHas = T.Score[a] != 0 && !double.IsNaN(T.Score[a]);
        var bHas = T.Score[b] != 0 && !double.IsNaN(T.Score[b]);
        if (aHas != bHas)
        {
            return ByPp(a, b);
        }
        return T.Score[a] > T.Score[b] || (T.Score[a] == T.Score[b] && T.Pp[a] > T.Pp[b]);
    }

    /// <summary>The best play per map by pp, then score (what totals count), sorted best pp first.</summary>
    private List<int> BestPerMap(IEnumerable<int> tuples)
    {
        var byMap = new Dictionary<int, int>();
        var order = new List<int>();
        foreach (var t in tuples)
        {
            if (!byMap.TryGetValue(T.Map[t], out var old))
            {
                byMap[T.Map[t]] = t;
                order.Add(T.Map[t]);
            }
            else if (T.Pp[t] > T.Pp[old] || (T.Pp[t] == T.Pp[old] && T.Score[t] > T.Score[old]))
            {
                byMap[T.Map[t]] = t;
            }
        }
        var result = new List<int>(order.Count);
        foreach (var m in order)
        {
            result.Add(byMap[m]);
        }
        SortByPpThenMap(result);
        return result;
    }

    /// <summary><c>sort((a, b) => b[S.PP] - a[S.PP] || a[S.MAP] - b[S.MAP])</c>.</summary>
    private void SortByPpThenMap(List<int> list) =>
        JsSort.Stable(list, (a, b) => JsSort.Sign(T.Pp[b] - T.Pp[a]) is var c && c != 0 ? c : T.Map[a].CompareTo(T.Map[b]));

    /// <summary><c>sort((a, b) => b[S.PP] - a[S.PP])</c>, ties kept in order.</summary>
    private void SortByPp(List<int> list) => JsSort.Stable(list, (a, b) => JsSort.Sign(T.Pp[b] - T.Pp[a]));

    private double WeightedTotalOf(List<int> tuples)
    {
        double total = 0, weight = 1;
        foreach (var t in tuples)
        {
            var pp = T.Pp[t];
            total += (pp == 0 || double.IsNaN(pp) ? 0 : pp) * weight;
            weight *= 0.95;
        }
        return total;
    }

    /// <summary>osu!'s total for per-map best values: weighted, plus the bonus for up to 1000 ranked plays.</summary>
    private static double OfficialTotal(List<double> pps)
    {
        var counted = new List<double>(pps.Count);
        foreach (var pp in pps)
        {
            if (pp > 0)
            {
                counted.Add(pp);
            }
        }
        JsSort.Stable(counted, (a, b) => JsSort.Sign(b - a));
        return Rules.WeightedTotal(System.Runtime.InteropServices.CollectionsMarshal.AsSpan(counted)) +
            416.6667 * (1 - Math.Pow(0.995, Math.Min(counted.Count, 1000)));
    }

    private static double Round(double n) => JsMath.Round(n, 2);
}

/// <summary>An inactive player's last official pp from the data folder's git history (source.mjs loadPastOfficial).</summary>
public sealed record PastOfficial(double Pp, double? Global, double? Country, double Seen);
