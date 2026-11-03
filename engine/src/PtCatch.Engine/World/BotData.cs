using System;
using System.Collections.Generic;
using PtCatch.Engine.Js;

namespace PtCatch.Engine.World;

/// <summary>
/// Every score object the bot's data holds (player files and the dump), as columns. A player's lists are ranges of
/// rows. Values keep JavaScript's reading of them: a count that was null or missing is NaN, which writes as null.
/// </summary>
public sealed class RawScores
{
    public int Count;
    public int[] Map = new int[1024];
    public double[] Score = new double[1024];
    public double[] MaxCombo = new double[1024];
    public double[] C300 = new double[1024];
    public double[] C100 = new double[1024];
    public double[] C50 = new double[1024];
    public double[] Miss = new double[1024];
    public double[] Katu = new double[1024];
    public int[] Mods = new int[1024];
    /// <summary>Whether the play has a date (a non-empty <c>date</c>); its value is in <see cref="Time"/>.</summary>
    public bool[] HasDate = new bool[1024];
    public string[] Rank = new string[1024];
    /// <summary>pp, NaN when null or missing (the exporter reads it as <c>s.pp ?? 0</c> or <c>s.pp > 0</c>).</summary>
    public double[] Pp = new double[1024];
    /// <summary>0 when the field is missing, 1 true, 2 false.</summary>
    public byte[] Passed = new byte[1024];
    /// <summary>The play's score id for the site (weekly.mjs scoreId): positive solo id, negative legacy id, or 0.</summary>
    public double[] SiteId = new double[1024];
    /// <summary><c>isoTime(s.date)</c>, worked out once.</summary>
    public double[] Time = new double[1024];

    public int Add()
    {
        if (Count == Map.Length)
        {
            var n = Count * 2;
            Array.Resize(ref Map, n);
            Array.Resize(ref Score, n);
            Array.Resize(ref MaxCombo, n);
            Array.Resize(ref C300, n);
            Array.Resize(ref C100, n);
            Array.Resize(ref C50, n);
            Array.Resize(ref Miss, n);
            Array.Resize(ref Katu, n);
            Array.Resize(ref Mods, n);
            Array.Resize(ref HasDate, n);
            Array.Resize(ref Rank, n);
            Array.Resize(ref Pp, n);
            Array.Resize(ref Passed, n);
            Array.Resize(ref SiteId, n);
            Array.Resize(ref Time, n);
        }
        return Count++;
    }

    /// <summary>Appends another table's rows; returns the offset its row numbers move by.</summary>
    public int Append(RawScores other)
    {
        var offset = Count;
        for (var i = 0; i < other.Count; i++)
        {
            var r = Add();
            Map[r] = other.Map[i];
            Score[r] = other.Score[i];
            MaxCombo[r] = other.MaxCombo[i];
            C300[r] = other.C300[i];
            C100[r] = other.C100[i];
            C50[r] = other.C50[i];
            Miss[r] = other.Miss[i];
            Katu[r] = other.Katu[i];
            Mods[r] = other.Mods[i];
            HasDate[r] = other.HasDate[i];
            Rank[r] = other.Rank[i];
            Pp[r] = other.Pp[i];
            Passed[r] = other.Passed[i];
            SiteId[r] = other.SiteId[i];
            Time[r] = other.Time[i];
        }
        return offset;
    }

    /// <summary>A pass, as completion.mjs counts one: a passing grade, not marked failed.</summary>
    public bool IsPass(int r) => Rank[r] is "XH" or "X" or "SH" or "S" or "A" or "B" or "C" or "D" && Passed[r] != 2;

    public bool UsesNoFail(int r) => (Mods[r] & 1) != 0;

    public bool ClearsMap(int r) => IsPass(r) && !UsesNoFail(r);
}

/// <summary>A run of rows in <see cref="RawScores"/>: one of a player's lists, in the file's order.</summary>
public readonly record struct ScoreList(int Start, int Length)
{
    public int End => Start + Length;

    public ScoreList Shift(int by) => new(Start + by, Length);
}

/// <summary>A tracked player's file (Users/&lt;id&gt;.json): the profile fields the exporter reads and the score lists.</summary>
public sealed class UserRecord
{
    public int UserId;
    public string Username;
    public string Country;
    public double? Playcount;
    public double? PpRaw;
    public double? PpRank;
    public double? PpCountryRank;
    public double? Accuracy;
    public double? Level;
    public double? CountSS;
    public double? CountS;
    public double? CountA;
    public string ProfileUpdated;
    public double DanScore;
    public bool Restricted;
    public ScoreList TopConverted;
    public ScoreList ConvertPp;
    public ScoreList TopUnranked;
    public ScoreList RankedSpecific;
    public ScoreList PreRank;
    public ScoreList ConvertMod;
    public ScoreList UnrankedMod;
    public ScoreList RankedMod;
    /// <summary>The Dan passes by stage index: a row, or -1 for a stage not passed (null in the file).</summary>
    public int[] DanPasses = [];

    public void Shift(int by)
    {
        TopConverted = TopConverted.Shift(by);
        ConvertPp = ConvertPp.Shift(by);
        TopUnranked = TopUnranked.Shift(by);
        RankedSpecific = RankedSpecific.Shift(by);
        PreRank = PreRank.Shift(by);
        ConvertMod = ConvertMod.Shift(by);
        UnrankedMod = UnrankedMod.Shift(by);
        RankedMod = RankedMod.Shift(by);
        for (var i = 0; i < DanPasses.Length; i++)
        {
            if (DanPasses[i] >= 0)
            {
                DanPasses[i] += by;
            }
        }
    }
}

/// <summary>A player from the monthly dump import (PtCatch/players.json).</summary>
public sealed class DumpRecord
{
    public int UserId;
    public string Username;
    public string Country;
    public double? Pp;
    public double? GlobalRank;
    public double? CountryRank;
    public double? Level;
    public double? Accuracy;
    public double? Playcount;
    public double? CountSS;
    public double? CountS;
    public double? CountA;
    public ScoreList TopScores;
    public ScoreList CommunityScores;
    public ScoreList ModScores;
}

/// <summary>The bot's play log (Plays/&lt;week&gt;.jsonl): one row per play it took in.</summary>
public sealed class PlayLog
{
    /// <summary>When the lines start to speak for snipes (unix seconds), or NaN.</summary>
    public double From = double.NaN;
    public readonly List<double> User = new();
    public readonly List<double> Map = new();
    public readonly List<double> Time = new();
    public readonly List<string> Cat = new();
    /// <summary>pp, NaN when the line has none.</summary>
    public readonly List<double> Pp = new();
    public readonly List<bool> HasPp = new();
    /// <summary>The first player the play passed (sniped[0]) when it passed any, else NaN.</summary>
    public readonly List<double> FirstSniped = new();
    public int Count => User.Count;
}

/// <summary>Everything the exporter reads from the bot's data folder.</summary>
public sealed class BotData
{
    public readonly RawScores Scores = new();
    public readonly List<UserRecord> Players = new();
    public readonly List<DumpRecord> PtCatch = new();
    public string LastImportedDump;
    public readonly HashSet<int> Banned = new();
    public JsNode WeeklyWeeks = JsNode.Array();
    public JsNode WeeklyCurrent = JsNode.NullValue;
    /// <summary>King of the hill (Hill/), or null when the bot has no Hill folder.</summary>
    public HillData Hill;
    public readonly PlayLog Plays = new();
    /// <summary>Bounties.json's <c>bounties</c> (an array; empty when there's none).</summary>
    public JsNode Bounties = JsNode.Array();
    /// <summary>Bananas, or null before the bot has an Economy/wallets.json.</summary>
    public EconomyData Economy;
    /// <summary>Admin/panel.json, or null.</summary>
    public JsNode AdminPanel;
}

public sealed class HillData
{
    public readonly List<JsNode> Months = new();
    public JsNode Current = JsNode.NullValue;
    public JsNode Crowns = JsNode.NullValue;
}

public sealed class EconomyData
{
    public JsNode Updated = JsNode.NullValue;
    /// <summary>wallets.json's <c>players</c>, by osu! id.</summary>
    public JsNode Wallets;
    public readonly List<JsNode> Ledger = new();
}
