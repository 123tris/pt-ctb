using System;
using System.Collections.Generic;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;
using PtCatch.Engine.World;

namespace PtCatch.Engine.Export;

/// <summary>
/// Yearly ranked pp: one board per year, each player's pp from their plays on the maps ranked (or approved) that year
/// alone, catch-specific maps and converts alike, as osu!'s own ranked pp counts them. A map's year is its ranked date's
/// in UTC. Pure, so the tests can feed it plays directly.
/// </summary>
public static class RankedYears
{
    /// <summary>A play as the boards count it: its map, pp and score, and the map's status, mode and ranked date.</summary>
    public readonly record struct Play(int Map, double Pp, double Score, double Status, double Mode, string RankedDate);

    /// <summary>A player's line on a year's board: their weighted pp (rounded to 2 places) and how many plays it counts.</summary>
    public readonly record struct Row(int Uid, double Pp, int Plays);

    /// <summary>A year's board, best first, and how many maps ranked that year it counts plays on.</summary>
    public sealed record Year(int Value, int Maps, List<Row> Rows);

    /// <summary>What was left out, by play and by map: no cached map, or a ranked map with no ranked date.</summary>
    public sealed class Skipped
    {
        public int NoMapPlays, NoDatePlays;
        public readonly HashSet<int> NoMap = new(), NoDate = new();
    }

    /// <summary>Whether a map counts: ranked or approved, on osu!standard (a convert) or osu!catch.</summary>
    public static bool Counts(double status, double mode) =>
        (status == Rules.Ranked || status == Rules.Approved) && mode != Rules.ModeTaiko && mode != Rules.ModeMania;

    /// <summary>The UTC year of a map's ranked date, or null when it has none.</summary>
    public static int? YearOf(double status, string rankedDate)
    {
        var at = Beatmaps.RankedAtOf(status, rankedDate);
        return double.IsNaN(at) ? null : DateTimeOffset.FromUnixTimeSeconds((long)at).UtcDateTime.Year;
    }

    /// <summary>
    /// The boards, newest year first. A player counts each map once, with their best pp there (then score, as
    /// <c>BestPerMap</c> picks), and a year's total is osu!'s weighted sum of those (the n-th best counts 0.95^n, no
    /// bonus pp): the same weighting as the converts and loved boards. Plays without pp count for nothing and aren't
    /// counted; a player with none on a year's maps isn't on its board. Ties keep the lower osu! id first.
    /// </summary>
    /// <param name="players">Each player's plays, a map possibly more than once. Plays on uncached maps have a NaN status.</param>
    public static List<Year> Boards(IEnumerable<(int Uid, IEnumerable<Play> Plays)> players, Skipped skipped = null)
    {
        var byYear = new SortedDictionary<int, (List<Row> Rows, HashSet<int> Maps)>(Comparer<int>.Create((a, b) => b.CompareTo(a)));
        var best = new Dictionary<int, Play>();
        var perYear = new Dictionary<int, List<double>>();
        foreach (var (uid, plays) in players)
        {
            best.Clear();
            foreach (var play in plays)
            {
                if (!best.TryGetValue(play.Map, out var old) || play.Pp > old.Pp || (play.Pp == old.Pp && play.Score > old.Score))
                {
                    best[play.Map] = play;
                }
            }
            perYear.Clear();
            foreach (var play in best.Values)
            {
                if (double.IsNaN(play.Status))
                {
                    if (skipped != null)
                    {
                        skipped.NoMapPlays++;
                        skipped.NoMap.Add(play.Map);
                    }
                    continue;
                }
                if (!Counts(play.Status, play.Mode))
                {
                    continue;
                }
                if (YearOf(play.Status, play.RankedDate) is not int year)
                {
                    if (skipped != null)
                    {
                        skipped.NoDatePlays++;
                        skipped.NoDate.Add(play.Map);
                    }
                    continue;
                }
                if (!(play.Pp > 0))
                {
                    continue;
                }
                if (!perYear.TryGetValue(year, out var pps))
                {
                    perYear[year] = pps = new List<double>();
                }
                pps.Add(play.Pp);
                if (!byYear.TryGetValue(year, out var board))
                {
                    byYear[year] = board = (new List<Row>(), new HashSet<int>());
                }
                board.Maps.Add(play.Map);
            }
            foreach (var (year, pps) in perYear)
            {
                JsSort.Stable(pps, (a, b) => JsSort.Sign(b - a));
                var total = Rules.WeightedTotal(System.Runtime.InteropServices.CollectionsMarshal.AsSpan(pps));
                byYear[year].Rows.Add(new Row(uid, JsMath.Round(total, 2), pps.Count));
            }
        }
        var years = new List<Year>(byYear.Count);
        foreach (var (year, board) in byYear)
        {
            JsSort.Stable(board.Rows, (a, b) => JsSort.Sign(b.Pp - a.Pp) is var c && c != 0 ? c : a.Uid.CompareTo(b.Uid));
            years.Add(new Year(year, board.Maps.Count, board.Rows));
        }
        return years;
    }
}

public sealed partial class Build
{
    /// <summary>What the yearly ranked boards left out (filled by <see cref="RankedYearBoards"/>), for the export's log.</summary>
    public readonly RankedYears.Skipped YearsSkipped = new();

    /// <summary>
    /// The yearly ranked boards over the home-country players: each convert's best-pp play (the board play, or the
    /// <c>ConvertPpScores</c> play that beats it: what the converts total counts) and every ranked catch-specific play.
    /// </summary>
    private List<RankedYears.Year> RankedYearBoards()
    {
        IEnumerable<RankedYears.Play> PlaysOf(Person p)
        {
            foreach (var list in new[] { p.PpLists[(int)Cat.Convert], p.RankedPool })
            {
                foreach (var t in list)
                {
                    var row = T.MapRow[t];
                    yield return row < 0
                        ? new RankedYears.Play(T.Map[t], T.Pp[t], T.Score[t], double.NaN, double.NaN, null)
                        : new RankedYears.Play(T.Map[t], T.Pp[t], T.Score[t], maps.Approved[row], maps.Mode[row], maps.ApprovedDate[row]);
                }
            }
        }
        var players = new List<(int, IEnumerable<RankedYears.Play>)>(people.Count);
        foreach (var p in people)
        {
            players.Add((p.Id, PlaysOf(p)));
        }
        return RankedYears.Boards(players, YearsSkipped);
    }
}
