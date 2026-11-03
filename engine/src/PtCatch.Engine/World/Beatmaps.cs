using System;
using System.Collections.Generic;
using PtCatch.Engine.Model;

namespace PtCatch.Engine.World;

/// <summary>
/// Beatmap metadata as columns, one row per map, in the order the bot's cache lists them (later additions last). A
/// column holds exactly what the exporter read from a field, with JavaScript's coercions done once here: a numeric
/// field that was null or missing is 0 where the exporter only ever read it through <c>?? 0</c> or <c>|| 0</c>, and
/// the one field where null means something else (no catch star rating) keeps a flag.
/// </summary>
public sealed class Beatmaps
{
    public int Count;
    public int[] Id;
    public int[] SetId;
    /// <summary><c>Number(raw.approved)</c>: NaN when missing.</summary>
    public double[] Approved;
    /// <summary><c>Number(raw.playmode)</c>: NaN when missing.</summary>
    public double[] Mode;
    public string[] ApprovedDate;
    public string[] LastUpdate;
    public string[] Artist;
    public string[] Title;
    public string[] Version;
    public string[] Creator;
    /// <summary>difficultyrating, 0 when null (see <see cref="StarsNull"/>).</summary>
    public double[] Stars;
    /// <summary>The star rating was null: a convert nobody has a catch rating for yet.</summary>
    public bool[] StarsNull;
    public double[] Ar;
    public double[] Cs;
    public double[] Od;
    public double[] Hp;
    public double[] Bpm;
    public double[] HitLength;
    public double[] MaxCombo;
    public bool[] CatchDifficulty;
    public double[] Playcount;
    public double[] Favourites;

    private Dictionary<int, int> rows;

    public Beatmaps(int capacity)
    {
        Id = new int[capacity];
        SetId = new int[capacity];
        Approved = new double[capacity];
        Mode = new double[capacity];
        ApprovedDate = new string[capacity];
        LastUpdate = new string[capacity];
        Artist = new string[capacity];
        Title = new string[capacity];
        Version = new string[capacity];
        Creator = new string[capacity];
        Stars = new double[capacity];
        StarsNull = new bool[capacity];
        Ar = new double[capacity];
        Cs = new double[capacity];
        Od = new double[capacity];
        Hp = new double[capacity];
        Bpm = new double[capacity];
        HitLength = new double[capacity];
        MaxCombo = new double[capacity];
        CatchDifficulty = new bool[capacity];
        Playcount = new double[capacity];
        Favourites = new double[capacity];
        rows = new Dictionary<int, int>(capacity);
    }

    /// <summary>The row of a beatmap id, or -1.</summary>
    public int RowOf(int id) => rows.TryGetValue(id, out var row) ? row : -1;

    public bool Has(int id) => rows.ContainsKey(id);

    /// <summary>A new row for <paramref name="id"/> at the end, or the existing row (which keeps its place).</summary>
    public int Upsert(int id)
    {
        if (rows.TryGetValue(id, out var row))
        {
            return row;
        }
        if (Count == Id.Length)
        {
            Grow(Math.Max(16, Count * 2));
        }
        row = Count++;
        Id[row] = id;
        rows[id] = row;
        return row;
    }

    /// <summary>Copies a row of another table into this one (as <c>map.set(id, raw)</c>).</summary>
    public int CopyFrom(Beatmaps source, int sourceRow)
    {
        var row = Upsert(source.Id[sourceRow]);
        SetId[row] = source.SetId[sourceRow];
        Approved[row] = source.Approved[sourceRow];
        Mode[row] = source.Mode[sourceRow];
        ApprovedDate[row] = source.ApprovedDate[sourceRow];
        LastUpdate[row] = source.LastUpdate[sourceRow];
        Artist[row] = source.Artist[sourceRow];
        Title[row] = source.Title[sourceRow];
        Version[row] = source.Version[sourceRow];
        Creator[row] = source.Creator[sourceRow];
        Stars[row] = source.Stars[sourceRow];
        StarsNull[row] = source.StarsNull[sourceRow];
        Ar[row] = source.Ar[sourceRow];
        Cs[row] = source.Cs[sourceRow];
        Od[row] = source.Od[sourceRow];
        Hp[row] = source.Hp[sourceRow];
        Bpm[row] = source.Bpm[sourceRow];
        HitLength[row] = source.HitLength[sourceRow];
        MaxCombo[row] = source.MaxCombo[sourceRow];
        CatchDifficulty[row] = source.CatchDifficulty[sourceRow];
        Playcount[row] = source.Playcount[sourceRow];
        Favourites[row] = source.Favourites[sourceRow];
        return row;
    }

    private void Grow(int capacity)
    {
        Array.Resize(ref Id, capacity);
        Array.Resize(ref SetId, capacity);
        Array.Resize(ref Approved, capacity);
        Array.Resize(ref Mode, capacity);
        Array.Resize(ref ApprovedDate, capacity);
        Array.Resize(ref LastUpdate, capacity);
        Array.Resize(ref Artist, capacity);
        Array.Resize(ref Title, capacity);
        Array.Resize(ref Version, capacity);
        Array.Resize(ref Creator, capacity);
        Array.Resize(ref Stars, capacity);
        Array.Resize(ref StarsNull, capacity);
        Array.Resize(ref Ar, capacity);
        Array.Resize(ref Cs, capacity);
        Array.Resize(ref Od, capacity);
        Array.Resize(ref Hp, capacity);
        Array.Resize(ref Bpm, capacity);
        Array.Resize(ref HitLength, capacity);
        Array.Resize(ref MaxCombo, capacity);
        Array.Resize(ref CatchDifficulty, capacity);
        Array.Resize(ref Playcount, capacity);
        Array.Resize(ref Favourites, capacity);
    }

    // ---- The exporter's predicates over a row ------------------------------------------------------------------

    public bool HasTitle(int row) => row >= 0 && !string.IsNullOrEmpty(Title[row]) && Title[row] != "Unknown";

    /// <summary>A map osu! knows to be taiko or mania.</summary>
    public bool IsOtherMode(int row) => row >= 0 && (Mode[row] == Rules.ModeTaiko || Mode[row] == Rules.ModeMania);

    /// <summary>A cached map osu!catch can play, as the catch dump vouches (build.mjs isCatchPlayable).</summary>
    public bool IsCatchPlayable(int row) => row >= 0 && CatchDifficulty[row] && !IsOtherMode(row);

    public bool IsRankedOrApproved(int row) => row >= 0 && (Approved[row] == Rules.Ranked || Approved[row] == Rules.Approved);

    /// <summary>Ranked/approved catch-specific maps with a title: the pool for "maps nobody here has played yet".</summary>
    public bool IsUnclaimedCandidate(int row) => HasTitle(row) && IsCatchPlayable(row) && Mode[row] == Rules.ModeCatch && IsRankedOrApproved(row);

    /// <summary>A ranked/approved catch-specific difficulty: the completion goal.</summary>
    public bool IsRankedSpecific(int row) => IsCatchPlayable(row) && Mode[row] == Rules.ModeCatch && IsRankedOrApproved(row);

    /// <summary>A ranked/approved osu!standard map osu!catch can play: the converts goal.</summary>
    public bool IsRankedConvert(int row) => IsCatchPlayable(row) && Mode[row] == Rules.ModeOsu && IsRankedOrApproved(row);

    /// <summary>Whether a row's star rating and combo are osu!catch's (osu-api.mjs hasCatchDifficulty).</summary>
    public bool HasCatchDifficulty(int row) => Mode[row] == Rules.ModeCatch || CatchDifficulty[row];

    public Cat Classify(int row) => Rules.Classify(Approved[row], Mode[row]);

    private double[] rankedAt;
    private double[] updatedAt;

    /// <summary>
    /// Works out every row's dates once. Called when the rows stop changing: the systems ask for a map's ranked date for
    /// each play on it, and parsing the string each time was a large part of the cost.
    /// </summary>
    public void Freeze()
    {
        rankedAt = new double[Count];
        updatedAt = new double[Count];
        for (var row = 0; row < Count; row++)
        {
            rankedAt[row] = RankedAtOf(Approved[row], ApprovedDate[row]);
            updatedAt[row] = UpdatedAtOf(LastUpdate[row]);
        }
    }

    /// <summary>When the map was ranked, approved, qualified or loved (unix seconds), or NaN (build.mjs rankedAt).</summary>
    public double RankedAt(int row) => rankedAt != null && row < rankedAt.Length ? rankedAt[row] : RankedAtOf(Approved[row], ApprovedDate[row]);

    /// <summary>rankedAt for a status and date: a graveyard map can carry the date of a status it lost, so only these count.</summary>
    public static double RankedAtOf(double status, string approvedDate)
    {
        if (string.IsNullOrEmpty(approvedDate) ||
            !(status == Rules.Ranked || status == Rules.Approved || status == Rules.Qualified || status == Rules.Loved))
        {
            return double.NaN;
        }
        return Js.JsDate.IsoTime(approvedDate);
    }

    /// <summary>When the map was last updated (unix seconds), or NaN; caches hold 0001-01-01 for "unknown".</summary>
    public double UpdatedAt(int row) => updatedAt != null && row < updatedAt.Length ? updatedAt[row] : UpdatedAtOf(LastUpdate[row]);

    private static double UpdatedAtOf(string lastUpdate)
    {
        var time = string.IsNullOrEmpty(lastUpdate) ? double.NaN : Js.JsDate.IsoTime(lastUpdate);
        return !double.IsNaN(time) && time > 0 ? time : double.NaN;
    }
}
