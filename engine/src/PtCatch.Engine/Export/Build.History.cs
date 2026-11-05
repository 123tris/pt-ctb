using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    private JsNode historyFile;

    /// <summary>
    /// pp history: one point per player per day when something changed, carried over from the previous history.json, and
    /// the reconstruction from score dates for the time before the first recorded day.
    /// </summary>
    private void BuildHistory()
    {
        var prior = previousHistory ?? JsNode.NullValue;
        var today = JsDate.UtcDay(now);
        var days = JsNode.Array();
        foreach (var d in prior["days"].Items)
        {
            days.Add(d);
        }
        var series = JsNode.Object();
        foreach (var (k, v) in prior["series"].Props)
        {
            series.Set(k, v);
        }
        foreach (var id in hidden)
        {
            series.Remove(id.ToString());
        }
        if (days.Count == 0 || days[days.Count - 1].Text != today)
        {
            days.Add(today);
        }
        var dayIndex = days.Count - 1;
        var wasInactive = new HashSet<double>(previous["inactive"].Items.Select(x => x.ToNumber()));
        var legacy = !previous["officialLiveOnly"].Truthy;
        foreach (var p in people)
        {
            var official = p.Inactive ? JsNode.NullValue : JsNode.Num(p.Pp);
            var scrub = legacy && (p.Inactive || wasInactive.Contains(p.Id));
            var points = JsNode.Array();
            foreach (var point in series[p.Id.ToString()].Items)
            {
                points.Add(scrub && point[3].Kind != JsKind.Null
                    ? JsNode.ArrayOf(point[0], point[1], point[2], JsNode.NullValue)
                    : point);
            }
            var next = JsNode.ArrayOf(JsNode.Num(dayIndex), JsNode.Num(p.Cv), JsNode.Num(p.Ul), official);
            var last = points.Count > 0 ? points[points.Count - 1] : null;
            if (last != null && last[0].ToNumber() == dayIndex)
            {
                var items = (List<JsNode>)points.Items;
                items[^1] = next;
            }
            else if (last == null || last[1].ToNumber() != p.Cv || last[2].ToNumber() != p.Ul || !SameOfficial(last[3], official))
            {
                points.Add(next);
            }
            series.Set(p.Id.ToString(), points);
        }
        historyFile = JsNode.Object().Set("days", days).Set("series", series).Set("reconstructed", Reconstruct(days[0].Text));
    }

    /// <summary><c>last[3] !== official</c>, where official is a number or null.</summary>
    private static bool SameOfficial(JsNode a, JsNode b) =>
        a.Kind == b.Kind && (a.Kind != JsKind.Number || a.Number == b.Number);

    /// <summary>
    /// Each board's total on the 1st of every month (and the first recorded day) over the plays set before then, built
    /// from score dates (build.mjs reconstructHistory). Each player's best values are kept sorted as they change, so a
    /// total is one pass instead of a sort: the same sum in the same order, so the same number.
    /// </summary>
    private JsNode Reconstruct(string firstRecordedDay)
    {
        var empty = JsNode.Object().Set("days", JsNode.Array()).Set("series", JsNode.Object());
        var endMs = firstRecordedDay == null ? double.NaN : JsDate.Parse($"{firstRecordedDay}T00:00:00Z");
        if (double.IsNaN(endMs))
        {
            return empty;
        }
        var end = endMs / 1000;

        List<int> Dated(IEnumerable<int> list)
        {
            var dated = list.Where(t => T.Time[t] > 0 && T.Time[t] < end).ToList();
            JsSort.Stable(dated, (a, b) => JsSort.Sign(T.Time[a] - T.Time[b]));
            return dated;
        }
        var timelines = new List<(Person P, List<int>[] Lines)>();
        var earliest = double.PositiveInfinity;
        foreach (var p in people)
        {
            var ranked = new List<int>(p.Lists[(int)Cat.Ranked]);
            ranked.AddRange(p.PpLists[(int)Cat.Convert]);
            ranked.AddRange(p.DumpTop);
            var lines = new[] { Dated(p.PpLists[(int)Cat.Convert]), Dated(p.Lists[(int)Cat.Loved]), Dated(ranked) };
            timelines.Add((p, lines));
            foreach (var line in lines)
            {
                if (line.Count > 0)
                {
                    earliest = Math.Min(earliest, T.Time[line[0]]);
                }
            }
        }
        if (!double.IsFinite(earliest))
        {
            return empty;
        }

        // The 1st of each month after the earliest play, then the first recorded day.
        var dayList = new List<string>();
        var (y, m, _) = JsDate.CivilFromDays((long)Math.Floor(earliest / Day));
        var month = (int)m + 1;
        var year = y;
        while (true)
        {
            if (month > 12)
            {
                month = 1;
                year++;
            }
            var at = JsDate.DaysFromCivil(year, month, 1) * Day;
            if (!(at < end))
            {
                break;
            }
            dayList.Add($"{year:D4}-{month:D2}-01");
            month++;
        }
        dayList.Add(firstRecordedDay);
        var bounds = dayList.Select(d => JsDate.Parse($"{d}T00:00:00Z") / 1000).ToArray();

        var series = JsNode.Object();
        var sorted = new List<double>[3];
        var best = new Dictionary<int, double>[3];
        foreach (var (p, lines) in timelines)
        {
            for (var c = 0; c < 3; c++)
            {
                sorted[c] = new List<double>();
                best[c] = new Dictionary<int, double>();
            }
            var next = new int[3];
            var totals = new double[3];
            var points = new List<double[]>();
            for (var i = 0; i < bounds.Length; i++)
            {
                var bound = bounds[i];
                for (var c = 0; c < 3; c++)
                {
                    var changed = false;
                    var line = lines[c];
                    for (; next[c] < line.Count && T.Time[line[next[c]]] < bound; next[c]++)
                    {
                        var t = line[next[c]];
                        var pp = T.Pp[t];
                        var had = best[c].TryGetValue(T.Map[t], out var old);
                        if (pp > (had ? old : 0))
                        {
                            if (had)
                            {
                                RemoveDescending(sorted[c], old);
                            }
                            InsertDescending(sorted[c], pp);
                            best[c][T.Map[t]] = pp;
                            changed = true;
                        }
                    }
                    if (changed)
                    {
                        totals[c] = Round(c == 2 ? OfficialTotalSorted(sorted[c]) : WeightedSorted(sorted[c]));
                    }
                }
                var point = new[] { i, totals[0], totals[1], totals[2] };
                var last = points.Count > 0 ? points[^1] : null;
                if (last != null ? last[1] != point[1] || last[2] != point[2] || last[3] != point[3] : point[1] > 0 || point[2] > 0 || point[3] > 0)
                {
                    points.Add(point);
                }
            }
            var lastPoint = points.Count > 0 ? points[^1] : null;
            if (lastPoint != null && lastPoint[0] != bounds.Length - 1)
            {
                points.Add([bounds.Length - 1, lastPoint[1], lastPoint[2], lastPoint[3]]);
            }
            var official = p.Pp;
            var nullOfficial = lastPoint != null && !(official > 0 && Math.Abs(lastPoint[3] / official - 1) <= 0.1);
            if (points.Count > 0)
            {
                series.Set(p.Id.ToString(), ArrayOf(points.Select(pt => JsNode.ArrayOf(JsNode.Num(pt[0]), JsNode.Num(pt[1]), JsNode.Num(pt[2]),
                    nullOfficial ? JsNode.NullValue : JsNode.Num(pt[3])))));
            }
        }
        return JsNode.Object().Set("days", ArrayOf(dayList.Select(JsNode.Str))).Set("series", series);
    }

    private static void InsertDescending(List<double> sorted, double v)
    {
        // After the last value >= v, as a stable sort of the same values would leave them (equal values are
        // interchangeable in the sum).
        int lo = 0, hi = sorted.Count;
        while (lo < hi)
        {
            var mid = (lo + hi) >> 1;
            if (sorted[mid] >= v)
            {
                lo = mid + 1;
            }
            else
            {
                hi = mid;
            }
        }
        sorted.Insert(lo, v);
    }

    private static void RemoveDescending(List<double> sorted, double v)
    {
        int lo = 0, hi = sorted.Count;
        while (lo < hi)
        {
            var mid = (lo + hi) >> 1;
            if (sorted[mid] > v)
            {
                lo = mid + 1;
            }
            else
            {
                hi = mid;
            }
        }
        sorted.RemoveAt(lo);
    }

    private static double WeightedSorted(List<double> sortedDesc) =>
        Rules.WeightedTotal(System.Runtime.InteropServices.CollectionsMarshal.AsSpan(sortedDesc));

    private static double OfficialTotalSorted(List<double> sortedDesc)
    {
        // Every kept value is > 0 (only a higher pp replaces a map's best), so nothing is filtered out.
        return Rules.WeightedTotal(System.Runtime.InteropServices.CollectionsMarshal.AsSpan(sortedDesc)) +
            416.6667 * (1 - Math.Pow(0.995, Math.Min(sortedDesc.Count, 1000)));
    }
}
