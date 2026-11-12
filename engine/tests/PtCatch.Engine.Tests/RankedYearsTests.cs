using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Export;
using PtCatch.Engine.Model;
using Xunit;

namespace PtCatch.Engine.Tests;

/// <summary>Yearly ranked pp (Export/Build.Years.cs): which year a map counts in, which maps count, and the weighting.</summary>
public sealed class RankedYearsTests
{
    private const int Osu = Rules.ModeOsu, Catch = Rules.ModeCatch;

    private static RankedYears.Play Play(int map, double pp, string date, double status = Rules.Ranked, double mode = Catch, double score = 0) =>
        new(map, pp, score, status, mode, date);

    private static List<RankedYears.Year> Boards(params (int Uid, RankedYears.Play[] Plays)[] players) =>
        RankedYears.Boards(players.Select(p => (p.Uid, (IEnumerable<RankedYears.Play>)p.Plays)));

    private static double Weighted(params double[] pps) => pps.Select((pp, i) => pp * System.Math.Pow(0.95, i)).Sum();

    [Fact]
    public void A_map_counts_in_the_UTC_year_of_its_ranked_date()
    {
        var years = Boards((1, [
            Play(10, 100, "2023-12-31T23:59:59Z"),
            Play(11, 200, "2024-01-01T00:00:00Z"),
            // No zone: read as UTC, as the exporter reads the bot's dates.
            Play(12, 50, "2024-12-31 23:30:00"),
            // A date with an offset is read in UTC: 23:30 on 31 December 2022 at UTC-1 is 2023 there.
            Play(13, 25, "2022-12-31T23:30:00-01:00"),
        ]));
        Assert.Equal([2024, 2023], years.Select(y => y.Value));
        Assert.Equal(new RankedYears.Row(1, JsRound(Weighted(200, 50)), 2), years[0].Rows.Single());
        Assert.Equal(new RankedYears.Row(1, JsRound(Weighted(100, 25)), 2), years[1].Rows.Single());
        Assert.Equal(2, years[0].Maps);
    }

    [Fact]
    public void Converts_and_approved_maps_count_and_loved_qualified_and_undated_maps_do_not()
    {
        var skipped = new RankedYears.Skipped();
        var years = RankedYears.Boards([(1, [
            Play(1, 300, "2020-05-01T00:00:00Z", mode: Osu),
            Play(2, 200, "2020-06-01T00:00:00Z", status: Rules.Approved),
            Play(3, 900, "2020-07-01T00:00:00Z", status: Rules.Loved),
            Play(4, 800, "2020-07-01T00:00:00Z", status: Rules.Loved, mode: Osu),
            Play(5, 700, "2020-07-01T00:00:00Z", status: Rules.Qualified),
            Play(6, 600, "2020-07-01T00:00:00Z", status: Rules.Graveyard),
            Play(7, 500, null),
            new RankedYears.Play(8, 400, 0, double.NaN, double.NaN, null),
            Play(9, 0, "2020-08-01T00:00:00Z"),
        ])], skipped);
        var year = Assert.Single(years);
        Assert.Equal(2020, year.Value);
        Assert.Equal(new RankedYears.Row(1, JsRound(Weighted(300, 200)), 2), year.Rows.Single());
        Assert.Equal((1, 1, 1, 1), (skipped.NoDatePlays, skipped.NoDate.Count, skipped.NoMapPlays, skipped.NoMap.Count));
    }

    [Fact]
    public void A_player_counts_each_map_once_with_its_best_pp_then_score()
    {
        var years = Boards((1, [
            // The board play (more score) and a better-pp play on the same convert: the pp one counts.
            Play(1, 120, "2021-03-01T00:00:00Z", mode: Osu, score: 900),
            Play(1, 150, "2021-03-01T00:00:00Z", mode: Osu, score: 800),
            Play(2, 100, "2021-04-01T00:00:00Z", score: 1),
            Play(2, 100, "2021-04-01T00:00:00Z", score: 2),
            Play(3, 80, "2021-05-01T00:00:00Z"),
        ]));
        var row = Assert.Single(Assert.Single(years).Rows);
        Assert.Equal(3, row.Plays);
        Assert.Equal(JsRound(150 + 100 * 0.95 + 80 * 0.95 * 0.95), row.Pp);
    }

    [Fact]
    public void Each_year_ranks_its_own_players_by_weighted_pp_and_leaves_out_who_has_no_play_there()
    {
        var years = Boards(
            (5, [Play(1, 100, "2019-01-01T00:00:00Z"), Play(2, 100, "2019-02-01T00:00:00Z")]),
            (3, [Play(1, 150, "2019-01-01T00:00:00Z"), Play(3, 400, "2018-01-01T00:00:00Z")]),
            (4, [Play(1, 195, "2019-01-01T00:00:00Z")]),
            (2, [Play(9, 999, "2019-01-01T00:00:00Z", status: Rules.Loved)]));
        Assert.Equal([2019, 2018], years.Select(y => y.Value));
        // 100 + 95 = 195 ties with a single 195: the lower osu! id first.
        Assert.Equal([(4, 195.0, 1), (5, 195.0, 2), (3, 150.0, 1)], years[0].Rows.Select(r => (r.Uid, r.Pp, r.Plays)));
        Assert.Equal([3], years[1].Rows.Select(r => r.Uid));
        Assert.Equal(2, years[0].Maps);
    }

    [Fact]
    public void The_weighting_is_the_converts_boards()
    {
        var pps = new[] { 500.0, 400, 300, 200, 100, 50, 25 };
        var years = Boards((1, pps.Select((pp, i) => Play(i + 1, pp, "2015-06-01T00:00:00Z", mode: Osu)).Reverse().ToArray()));
        Assert.Equal(JsRound(Rules.WeightedTotal(pps)), Assert.Single(Assert.Single(years).Rows).Pp);
        Assert.Equal(JsRound(Weighted(pps)), years[0].Rows[0].Pp);
    }

    private static double JsRound(double n) => Js.JsMath.Round(n, 2);
}
