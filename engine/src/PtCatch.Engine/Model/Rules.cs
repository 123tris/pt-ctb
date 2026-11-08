using System;

namespace PtCatch.Engine.Model;

/// <summary>Score categories, as the bot files them: converts, loved/unranked and ranked catch-specific maps.</summary>
public enum Cat : byte
{
    None = 0,
    Convert = 1,
    Loved = 2,
    Ranked = 3,
}

/// <summary>
/// The rules the site's shared model (<c>assets/js/core/model.js</c>) defines and the exporter used, ported as they are.
/// </summary>
public static class Rules
{
    public const int Graveyard = -2;
    public const int Ranked = 1;
    public const int Approved = 2;
    public const int Qualified = 3;
    public const int Loved = 4;

    public const int ModeOsu = 0;
    public const int ModeTaiko = 1;
    public const int ModeCatch = 2;
    public const int ModeMania = 3;

    public const int NF = 1, EZ = 2, TD = 4, HD = 8, HR = 16, SD = 32, DT = 64, RX = 128, HT = 256, NC = 512, FL = 1024;
    public const int AU = 2048, SO = 4096, AP = 8192, PF = 16384;

    /// <summary>Mods a mod ranking filters on; NF/SD/PF/… never disqualify a play.</summary>
    public const int Filterable = EZ | HD | HR | DT | HT | FL;

    /// <summary>Tris: the player whose #1s the records page dares everyone to take.</summary>
    public const int ThronePlayer = 3821475;

    /// <summary>The categories in the order the site lists them.</summary>
    public static readonly Cat[] Cats = [Cat.Convert, Cat.Loved, Cat.Ranked];

    /// <summary>Dan stage beatmap ids, by stage index (the bot's DanProject.MapIds).</summary>
    public static readonly int[] DanMaps =
    [
        1668132, 1644298, 1644299, 1644300, 1644301, 1644302, 1850071, 1850072, 1850073, 3143922,
        1850070, 1850074, 1850075, 1848953, 1848957, 1848954, 1848955, 1848956, 1872971,
    ];

    /// <summary>Discord role titles by Dan score threshold, lowest first.</summary>
    public static readonly (int Min, string Name)[] DanRoles =
    [
        (30, "Dan Skrub"), (80, "Dan Intermed"), (120, "Dan Expert"), (250, "Dan Beast"), (1000, "PT Best Player"),
    ];

    /// <summary>Duels: a rating is provisional while its deviation is this or more (DUEL_PROVISIONAL_RD).</summary>
    public const double DuelProvisionalRd = 110;

    /// <summary>Duel ids per duels/&lt;n&gt;.json (DUELS_PER_FILE).</summary>
    public const double DuelsPerFile = 100;

    /// <summary>The file a duel's own page reads (duelFile): duel 1234 is in duels/12.json.</summary>
    public static string DuelFile(double id) => $"duels/{Js.JsMath.ToString(Math.Floor(id / DuelsPerFile))}.json";

    public static readonly string[] HillSlots = ["NM", "HD", "HR", "DT", "FM", "CV"];
    public static readonly string[] HillModStars = ["HR", "DT"];
    public static readonly string[] HillTiers = ["open", "challenger"];

    public static readonly string[] ModFilters = ["NM", "HD", "HR", "DT", "FL", "EZ", "HT", "HDHR", "HDDT", "HRDT"];

    public static string Letter(Cat cat) => cat switch
    {
        Cat.Convert => "c",
        Cat.Loved => "u",
        Cat.Ranked => "r",
        _ => null,
    };

    public static Cat FromLetter(string s) => s switch
    {
        "c" => Cat.Convert,
        "u" => Cat.Loved,
        "r" => Cat.Ranked,
        _ => Cat.None,
    };

    /// <summary>Which category a score on a map with this status and mode belongs to; None for qualified (untracked).</summary>
    public static Cat Classify(double status, double mode)
    {
        if (status == Ranked || status == Approved)
        {
            return mode == ModeOsu ? Cat.Convert : Cat.Ranked;
        }
        return status == Qualified ? Cat.None : Cat.Loved;
    }

    /// <summary>Whether a play's mods match a mod filter: every requested mod, or none for the nomod filter (0).</summary>
    public static bool MatchesModFilter(int mask, int filter)
    {
        var relevant = mask & Filterable;
        return filter == 0 ? relevant == 0 : (relevant & filter) == filter;
    }

    /// <summary>"HD", "HDDT", "NM" as a filter mask, or -1 for anything unknown.</summary>
    public static int ParseModFilter(string text)
    {
        var s = (text ?? "").ToUpperInvariant().Replace("+", "");
        if (s is "NM" or "")
        {
            return 0;
        }
        if (s.Length % 2 != 0)
        {
            return -1;
        }
        var mask = 0;
        for (var i = 0; i < s.Length; i += 2)
        {
            var name = s.Substring(i, 2);
            var bit = ModBit(name == "NC" ? "DT" : name);
            if ((bit & Filterable) == 0)
            {
                return -1;
            }
            mask |= bit;
        }
        return mask;
    }

    public static int ModBit(string name) => name switch
    {
        "NF" => NF, "EZ" => EZ, "TD" => TD, "HD" => HD, "HR" => HR, "SD" => SD, "DT" => DT, "RX" => RX,
        "HT" => HT, "NC" => NC, "FL" => FL, "AU" => AU, "SO" => SO, "AP" => AP, "PF" => PF,
        _ => 0,
    };

    /// <summary>The weekly files' "HDHR" → the mods bitmask the site's tuples carry (weekly.mjs modMask).</summary>
    public static int ModMask(string acronyms)
    {
        var mask = 0;
        if (string.IsNullOrEmpty(acronyms) || acronyms == "NM")
        {
            return 0;
        }
        for (var i = 0; i < acronyms.Length; i += 2)
        {
            mask |= ModBit(acronyms.Substring(i, Math.Min(2, acronyms.Length - i)));
        }
        return mask;
    }

    /// <summary>osu!'s weighted total: the n-th best counts 0.95^n. Expects values sorted best first.</summary>
    public static double WeightedTotal(ReadOnlySpan<double> sortedDesc)
    {
        double total = 0, weight = 1;
        foreach (var pp in sortedDesc)
        {
            total += (double.IsNaN(pp) ? 0 : pp) * weight;
            weight *= 0.95;
        }
        return total;
    }

    public static bool IsSS(string grade) => grade is "X" or "XH";

    /// <summary>Approach rate after EZ/HR and DT/HT, as osu! computes it.</summary>
    public static double AdjustedAr(double ar, int mods)
    {
        if ((mods & HR) != 0)
        {
            ar = Math.Min(10, ar * 1.4);
        }
        if ((mods & EZ) != 0)
        {
            ar /= 2;
        }
        var rate = (mods & (DT | NC)) != 0 ? 1.5 : (mods & HT) != 0 ? 0.75 : 1;
        if (rate == 1)
        {
            return ar;
        }
        var ms = ar < 5 ? 1800 - 120 * ar : 1200 - 150 * (ar - 5);
        var scaled = ms / rate;
        return scaled > 1200 ? (1800 - scaled) / 120 : 5 + (1200 - scaled) / 150;
    }

    /// <summary>The source categories of the top plays' "Plays from" choices (PLAY_SOURCES).</summary>
    public static bool InPlaySource(char source, Cat cat) => source switch
    {
        'r' => cat is Cat.Ranked or Cat.Convert,
        'c' => cat == Cat.Convert,
        'u' => cat == Cat.Loved,
        _ => false,
    };
}
