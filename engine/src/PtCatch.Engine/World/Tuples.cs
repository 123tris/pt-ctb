using System;
using PtCatch.Engine.Js;

namespace PtCatch.Engine.World;

/// <summary>
/// Score tuples (model.js <c>S</c>: map, pp, acc, combo, miss, mods, grade, score, time, hits, and the play's id) as
/// columns. A list of plays anywhere in the engine is a list of rows here, so sorting, filtering and copying a list never
/// touches the plays themselves, and two lists share a play the way the exporter's lists shared one array.
/// </summary>
public sealed class Tuples
{
    public int Count;
    public int[] Map = new int[4096];
    public double[] Pp = new double[4096];
    public double[] Acc = new double[4096];
    public double[] Combo = new double[4096];
    public double[] Miss = new double[4096];
    public int[] Mods = new int[4096];
    public string[] Grade = new string[4096];
    public double[] Score = new double[4096];
    public double[] Time = new double[4096];
    public double[] Hits = new double[4096];
    /// <summary>The play's osu! score id for the site (S.ID), 0 when the tuple has none.</summary>
    public double[] Id = new double[4096];
    /// <summary>The map's row in the build's beatmaps, -1 when it isn't cached: resolved once, not looked up per use.</summary>
    public int[] MapRow = new int[4096];

    private int Add()
    {
        if (Count == Map.Length)
        {
            var n = Count * 2;
            Array.Resize(ref Map, n);
            Array.Resize(ref Pp, n);
            Array.Resize(ref Acc, n);
            Array.Resize(ref Combo, n);
            Array.Resize(ref Miss, n);
            Array.Resize(ref Mods, n);
            Array.Resize(ref Grade, n);
            Array.Resize(ref Score, n);
            Array.Resize(ref Time, n);
            Array.Resize(ref Hits, n);
            Array.Resize(ref Id, n);
            Array.Resize(ref MapRow, n);
        }
        return Count++;
    }

    /// <summary>build.mjs toTuple: a bot score as the site's tuple. <paramref name="zeroPp"/> is the banned-map rule.</summary>
    public int FromRaw(RawScores s, int r, bool zeroPp, int mapRow)
    {
        var t = Add();
        MapRow[t] = mapRow;
        var hits = s.C300[r] + s.C100[r] + s.C50[r];
        var max = hits + s.Miss[r] + s.Katu[r];
        Map[t] = s.Map[r];
        Pp[t] = zeroPp ? 0 : JsMath.Round(double.IsNaN(s.Pp[r]) ? 0 : s.Pp[r], 2);
        // `max ? … : 0`: NaN and 0 are falsy.
        Acc[t] = JsMath.Round(max != 0 && !double.IsNaN(max) ? hits * 100 / max : 0, 2);
        Combo[t] = s.MaxCombo[r];
        Miss[t] = s.Miss[r];
        Mods[t] = s.Mods[r];
        Grade[t] = s.Rank[r];
        Score[t] = s.Score[r];
        Time[t] = s.Time[r];
        Hits[t] = hits;
        Id[t] = s.SiteId[r];
        return t;
    }

    /// <summary>A copy of a tuple (the exporter's spread copies), so it can take another pp.</summary>
    public int Copy(int from)
    {
        var t = Add();
        Map[t] = Map[from];
        Pp[t] = Pp[from];
        Acc[t] = Acc[from];
        Combo[t] = Combo[from];
        Miss[t] = Miss[from];
        Mods[t] = Mods[from];
        Grade[t] = Grade[from];
        Score[t] = Score[from];
        Time[t] = Time[from];
        Hits[t] = Hits[from];
        Id[t] = Id[from];
        MapRow[t] = MapRow[from];
        return t;
    }

    /// <summary>The ten fields, then the play id after a null position when it has one.</summary>
    public void Write(JsJsonWriter w, int t)
    {
        w.BeginArray();
        Fields(w, t);
        if (Id[t] != 0)
        {
            w.Null();
            w.Number(Id[t]);
        }
        w.EndArray();
    }

    /// <summary>A player file's tuple: the position on its map (or null) always, then the id when there is one.</summary>
    public void WriteWithPos(JsJsonWriter w, int t, int pos)
    {
        w.BeginArray();
        Fields(w, t);
        if (pos > 0)
        {
            w.Number(pos);
        }
        else
        {
            w.Null();
        }
        if (Id[t] != 0)
        {
            w.Number(Id[t]);
        }
        w.EndArray();
    }

    /// <summary>[uid, ...tuple]: a map board's entry.</summary>
    public void WriteEntry(JsJsonWriter w, int uid, int t)
    {
        w.BeginArray();
        w.Number(uid);
        Fields(w, t);
        if (Id[t] != 0)
        {
            w.Null();
            w.Number(Id[t]);
        }
        w.EndArray();
    }

    /// <summary>[uid, category, ...tuple]: a top play or recent play row.</summary>
    public void WriteRow(JsJsonWriter w, int uid, string cat, int t)
    {
        w.BeginArray();
        w.Number(uid);
        w.String(cat);
        Fields(w, t);
        if (Id[t] != 0)
        {
            w.Null();
            w.Number(Id[t]);
        }
        w.EndArray();
    }

    /// <summary>The ten fields inside an array the caller opened.</summary>
    public void Fields(JsJsonWriter w, int t)
    {
        w.Number(Map[t]);
        w.Number(Pp[t]);
        w.Number(Acc[t]);
        w.Number(Combo[t]);
        w.Number(Miss[t]);
        w.Number(Mods[t]);
        w.String(Grade[t]);
        w.Number(Score[t]);
        w.Number(Time[t]);
        w.Number(Hits[t]);
    }

    /// <summary>The tuple as a <see cref="JsNode"/> array, after any leading values (a uid, a category…).</summary>
    public JsNode Node(int t, params JsNode[] prefix)
    {
        var a = JsNode.Array(12 + prefix.Length);
        foreach (var p in prefix)
        {
            a.Add(p);
        }
        a.Add(JsNode.Num(Map[t]));
        a.Add(JsNode.Num(Pp[t]));
        a.Add(JsNode.Num(Acc[t]));
        a.Add(JsNode.Num(Combo[t]));
        a.Add(JsNode.Num(Miss[t]));
        a.Add(JsNode.Num(Mods[t]));
        a.Add(JsNode.Str(Grade[t]));
        a.Add(JsNode.Num(Score[t]));
        a.Add(JsNode.Num(Time[t]));
        a.Add(JsNode.Num(Hits[t]));
        if (Id[t] != 0)
        {
            a.Add(JsNode.NullValue);
            a.Add(JsNode.Num(Id[t]));
        }
        return a;
    }

    /// <summary>A player file's tuple as a node: with its position slot always there.</summary>
    public JsNode NodeWithPos(int t, int pos, params JsNode[] prefix)
    {
        var a = JsNode.Array(12 + prefix.Length);
        foreach (var p in prefix)
        {
            a.Add(p);
        }
        a.Add(JsNode.Num(Map[t]));
        a.Add(JsNode.Num(Pp[t]));
        a.Add(JsNode.Num(Acc[t]));
        a.Add(JsNode.Num(Combo[t]));
        a.Add(JsNode.Num(Miss[t]));
        a.Add(JsNode.Num(Mods[t]));
        a.Add(JsNode.Str(Grade[t]));
        a.Add(JsNode.Num(Score[t]));
        a.Add(JsNode.Num(Time[t]));
        a.Add(JsNode.Num(Hits[t]));
        a.Add(pos > 0 ? JsNode.Num(pos) : JsNode.NullValue);
        if (Id[t] != 0)
        {
            a.Add(JsNode.Num(Id[t]));
        }
        return a;
    }
}
