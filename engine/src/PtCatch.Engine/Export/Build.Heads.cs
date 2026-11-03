using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    private readonly SortedDictionary<int, byte[]> headBytes = new();

    /// <summary>Each badge's [name, tips] in English, {x} filled in per player (assets/js/core/badges.js BADGES).</summary>
    private static readonly Dictionary<string, string[]> BadgeText = new()
    {
        ["chokeDor"] = ["Choke d’Or", "More plays with exactly one miss than anyone in Portugal ({n})."],
        ["wall"] = ["The Wall", "{n} #1s that have stood for more than two years: one of the three biggest walls in Portugal."],
        ["digits"] = ["{digits}-digit club", "Global rank {rank}. \"{less} digits when?\""],
        ["blessed"] = ["Blessed by the 1-miss gods", "{n} play with exactly one miss on 6★ and up.", "{n} plays with exactly one miss on 6★ and up."],
        ["reverse"] = ["Almost a reverse choke", "{n} plays with one miss and 97%+ of the combo: so close to the end (or the start)."],
        ["trisAcc"] = ["TrisAcc", "{n} full combos with an A rank. An FC is an FC."],
        ["lowAr"] = ["Low AR HD army", "{n} S ranks with HD at AR 8 or below. Reading that is a skill of its own."],
        ["derusting"] = ["Derusting", "Back after six months or more away. Welcome back."],
        ["ezKing"] = ["EZ king", "{n} #1s with EZ. Easy? Never."],
        ["wysi"] = ["WYSI", "A 727 somewhere on this profile. When you see it…"],
        ["genius"] = ["Only for genius", "{n} passes on 7★ and up with 20 or more misses."],
        ["soup"] = ["Ainda há muita sopa", "Still plenty of soup to eat: {n} Dan points from {role}."],
    };

    private readonly record struct ProfilePlay(Cat Cat, int T, int Pos, int Row);

    /// <summary>players/{id}-head.json: what a profile needs for its first page, with the badges worked out here.</summary>
    private void BuildHeads()
    {
        var files = new List<(int Id, PlayerFile File)>();
        foreach (var (id, file) in playerFiles)
        {
            files.Add((id, file));
        }
        var results = new (byte[] Bytes, List<string> Keys)[files.Count];
        System.Threading.Tasks.Parallel.For(0, files.Count, () => new JsJsonWriter(1 << 16), (i, _, w) =>
        {
            results[i] = HeadFile(files[i].Id, files[i].File, w);
            return w;
        }, w => w.Dispose());
        var badgesHeld = new List<(int Id, List<string> Keys)>();
        for (var i = 0; i < files.Count; i++)
        {
            headBytes[files[i].Id] = results[i].Bytes;
            badgesHeld.Add((files[i].Id, results[i].Keys));
        }
        BuildUnlocks(badgesHeld);
    }

    /// <summary>One player's head file and the keys of their badges.</summary>
    private (byte[] Bytes, List<string> Keys) HeadFile(int id, PlayerFile file, JsJsonWriter w)
    {
        {
            var p = file.Person;
            List<int> First(List<int> list)
            {
                var sorted = new List<int>(list);
                SortByPp(sorted);
                return sorted.Take(HeadRows).ToList();
            }
            var scores = Rules.Cats.ToDictionary(cat => cat, cat => First(p.Lists[(int)cat]));
            var top = First(p.DumpTop);
            var pre = p.Pre.Count > 0 ? First(p.Pre) : null;
            var shownMaps = new SortedSet<int>();
            foreach (var cat in Rules.Cats)
            {
                foreach (var t in scores[cat])
                {
                    shownMaps.Add(T.Map[t]);
                }
            }
            foreach (var t in top.Concat(pre ?? []))
            {
                shownMaps.Add(T.Map[t]);
            }
            foreach (var (_, t) in p.Dan)
            {
                shownMaps.Add(T.Map[t]);
            }
            if (file.Pinned is var (_, pinned))
            {
                shownMaps.Add(T.Map[pinned]);
            }

            var plays = new List<ProfilePlay>();
            foreach (var cat in Rules.Cats)
            {
                foreach (var t in p.Lists[(int)cat])
                {
                    plays.Add(new ProfilePlay(cat, t, PositionOf(p.Id, T.Map[t]), T.MapRow[t]));
                }
            }
            var entry = playerEntry[id];
            var (badges, keys) = Badges(entry, plays);

            w.Reset();
            w.BeginObject();
            w.Key("id");
            w.Number(p.Id);
            w.Key("name");
            w.String(p.Name);
            w.Key("head");
            w.Bool(true);
            w.Key("counts");
            w.BeginObject();
            w.Key("c");
            w.Number(p.Lists[(int)Cat.Convert].Count);
            w.Key("u");
            w.Number(p.Lists[(int)Cat.Loved].Count);
            w.Key("r");
            w.Number(p.Lists[(int)Cat.Ranked].Count);
            w.Key("top");
            w.Number(p.DumpTop.Count);
            w.Key("dan");
            w.Number(p.Dan.Count);
            w.Key("pre");
            w.Number(p.Pre.Count);
            w.EndObject();
            w.Key("scores");
            w.BeginObject();
            foreach (var cat in Rules.Cats)
            {
                w.Key(Rules.Letter(cat));
                w.BeginArray();
                foreach (var t in scores[cat])
                {
                    T.WriteWithPos(w, t, PositionOf(p.Id, T.Map[t]));
                }
                w.EndArray();
            }
            w.EndObject();
            w.Key("top");
            WriteTuples(w, top);
            w.Key("dan");
            WriteDan(w, p);
            if (pre != null)
            {
                w.Key("pre");
                WriteTuples(w, pre);
            }
            if (file.Crowns != null)
            {
                w.Key("crowns");
                w.Node(file.Crowns);
            }
            if (file.Pinned is var (pinCat, pinTuple))
            {
                w.Key("pinned");
                w.BeginArray();
                w.String(pinCat);
                T.Fields(w, pinTuple);
                w.Number(PositionOf(p.Id, T.Map[pinTuple]) is var pos && pos > 0 ? pos : double.NaN);
                if (T.Id[pinTuple] != 0)
                {
                    w.Number(T.Id[pinTuple]);
                }
                w.EndArray();
            }
            if (file.Ledger != null)
            {
                w.Key("ledger");
                w.Node(file.Ledger);
            }
            w.Key("maps");
            w.BeginObject();
            foreach (var m in shownMaps)
            {
                w.Key(m);
                WriteMapTuple(w, Row(m), default, player: true);
            }
            w.EndObject();
            w.Key("extras");
            w.BeginObject();
            w.Key("badges");
            w.Node(badges);
            w.Key("era");
            w.String(Era(plays));
            w.Key("signature");
            WriteSignature(w, plays);
            w.Key("years");
            w.BeginArray();
            var years = new SortedSet<int>(plays.Select(x => JsDate.LocalYear(T.Time[x.T])));
            foreach (var y in years.Reverse())
            {
                w.Number(y);
            }
            w.EndArray();
            w.EndObject();
            w.EndObject();
            return (w.ToArray(), keys);
        }
    }

    private static string Fill(string text, IReadOnlyDictionary<string, string> vars)
    {
        var sb = new System.Text.StringBuilder();
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] == '{')
            {
                var close = text.IndexOf('}', i);
                if (close > i)
                {
                    var name = text[(i + 1)..close];
                    if (name.Length > 0 && name.All(c => char.IsAsciiLetterOrDigit(c) || c == '_'))
                    {
                        sb.Append(vars.TryGetValue(name, out var v) ? v : "undefined");
                        i = close;
                        continue;
                    }
                }
            }
            sb.Append(text[i]);
        }
        return sb.ToString();
    }

    private static bool IsS(string g) => g is "S" or "SH" or "X" or "XH";

    /// <summary>The player's badges (badges.js playerBadges) and their keys (badgeKey).</summary>
    private (JsNode Badges, List<string> Keys) Badges(JsNode entry, List<ProfilePlay> plays)
    {
        var list = JsNode.Array();
        var keys = new List<string>();
        void Add(string key, Dictionary<string, string> vars = null)
        {
            vars ??= new Dictionary<string, string>();
            var text = BadgeText[key];
            var useMany = text.Length > 2 && !(vars.TryGetValue("n", out var n) && n == "1");
            list.Add(JsNode.Object().Set("name", Fill(text[0], vars)).Set("tip", Fill(text[useMany ? 2 : 1], vars)));
            keys.Add(key == "digits" ? $"digits{vars["digits"]}" : key);
        }
        string N(double v) => JsMath.ToString(v);
        int Count(Func<ProfilePlay, bool> test) => plays.Count(test);
        double MetaStars(ProfilePlay x) => x.Row >= 0 ? Round(maps.Stars[x.Row]) : double.NaN;

        var id = entry["id"].Number;
        if (oneMissLeaders.Count > 0 && oneMissLeaders[0].Id == id)
        {
            Add("chokeDor", new() { ["n"] = N(oneMissLeaders[0].Value) });
        }
        var wall = wallLeaders.FindIndex(x => x.Id == id);
        if (wall >= 0)
        {
            Add("wall", new() { ["n"] = N(wallLeaders[wall].Value) });
        }
        var global = entry["global"];
        if (global.Truthy && global.Number < 1000)
        {
            var digits = N(global.Number).Length;
            Add("digits", new() { ["digits"] = digits.ToString(), ["rank"] = N(global.Number), ["less"] = (digits - 1).ToString() });
        }
        var blessed = Count(x => T.Miss[x.T] == 1 && MetaStars(x) >= 6);
        if (blessed > 0)
        {
            Add("blessed", new() { ["n"] = N(blessed) });
        }
        var reverse = Count(x => T.Miss[x.T] == 1 && x.Row >= 0 && maps.Mode[x.Row] == Rules.ModeCatch && maps.MaxCombo[x.Row] != 0 &&
            T.Combo[x.T] >= 0.97 * maps.MaxCombo[x.Row]);
        if (reverse >= 5)
        {
            Add("reverse", new() { ["n"] = N(reverse) });
        }
        var trisAcc = Count(x => T.Miss[x.T] == 0 && T.Grade[x.T] == "A");
        if (trisAcc >= 3)
        {
            Add("trisAcc", new() { ["n"] = N(trisAcc) });
        }
        var lowAr = Count(x => (T.Mods[x.T] & Rules.HD) != 0 && IsS(T.Grade[x.T]) && x.Row >= 0 && Rules.AdjustedAr(maps.Ar[x.Row], T.Mods[x.T]) <= 8);
        if (lowAr >= 20)
        {
            Add("lowAr", new() { ["n"] = N(lowAr) });
        }
        var times = plays.Select(x => T.Time[x.T]).ToList();
        JsSort.Stable(times, (a, b) => JsSort.Sign(a - b));
        var last = times.Count > 0 ? times[^1] : 0;
        if (last > now - 120 * Day)
        {
            var gap = false;
            for (var i = 1; i < times.Count && !gap; i++)
            {
                gap = times[i] > now - 365 * Day && times[i] - times[i - 1] >= 180 * Day;
            }
            if (gap)
            {
                Add("derusting");
            }
        }
        var ezFirsts = Count(x => x.Pos == 1 && (T.Mods[x.T] & Rules.EZ) != 0);
        if (ezFirsts >= 5)
        {
            Add("ezKing", new() { ["n"] = N(ezFirsts) });
        }
        var country = entry["country"];
        if (plays.Any(x => T.Combo[x.T] == 727) || (global.IsNumber && global.Number == 727) || (country.IsNumber && country.Number == 727))
        {
            Add("wysi");
        }
        var genius = Count(x => T.Miss[x.T] >= 20 && MetaStars(x) >= 7);
        if (genius >= 10)
        {
            Add("genius", new() { ["n"] = N(genius) });
        }
        var danScore = entry["danScore"].Number;
        var next = Rules.DanRoles.FirstOrDefault(r => r.Min > danScore);
        if (danScore > 0 && next.Name != null && danScore >= 0.8 * next.Min)
        {
            Add("soup", new() { ["n"] = N(next.Min - danScore), ["role"] = next.Name });
        }
        return (list, keys);
    }

    /// <summary>"farming converts", "HD everything"… from the player's last year of plays (badges.js era).</summary>
    private string Era(List<ProfilePlay> plays)
    {
        if (plays.Count == 0)
        {
            return null;
        }
        var last = plays.Max(x => T.Time[x.T]);
        if (plays.Any(x => double.IsNaN(T.Time[x.T])))
        {
            last = double.NaN;
        }
        if (last < now - 365 * Day)
        {
            return "retired (for now)";
        }
        var recent = plays.Where(x => T.Time[x.T] > last - 365 * Day).ToList();
        double Share(Func<ProfilePlay, bool> test) => recent.Count > 0 ? (double)recent.Count(test) / recent.Count : 0;
        if (Share(x => (T.Mods[x.T] & (Rules.DT | Rules.NC)) != 0) >= 0.5)
        {
            return "DT farming";
        }
        if (Share(x => (T.Mods[x.T] & Rules.HD) != 0) >= 0.6)
        {
            return "HD everything";
        }
        if (Share(x => (T.Mods[x.T] & Rules.HR) != 0) >= 0.5)
        {
            return "HR enjoyer";
        }
        if (Share(x => x.Cat == Cat.Convert) >= 0.6)
        {
            return "farming converts";
        }
        if (Share(x => x.Cat == Cat.Loved) >= 0.5)
        {
            return "hunting loved maps";
        }
        if (Share(x => x.Cat == Cat.Ranked) >= 0.5)
        {
            return "playing specifics";
        }
        return "a bit of everything";
    }

    /// <summary>The player's best #1 by pp, or else their best play (badges.js signatureMap).</summary>
    private void WriteSignature(JsJsonWriter w, List<ProfilePlay> plays)
    {
        var sorted = new List<ProfilePlay>(plays);
        JsSort.Stable(sorted, (a, b) => JsSort.Sign(T.Pp[b.T] - T.Pp[a.T]));
        var first = sorted.FindIndex(x => x.Pos == 1);
        var kind = first >= 0 ? "Best #1" : "Best play";
        if (first < 0 && sorted.Count == 0)
        {
            w.Null();
            return;
        }
        var x = sorted[first >= 0 ? first : 0];
        w.BeginObject();
        w.Key("kind");
        w.String(kind);
        w.Key("cat");
        w.String(Rules.Letter(x.Cat));
        w.Key("s");
        T.WriteWithPos(w, x.T, x.Pos);
        w.Key("meta");
        WriteMapTuple(w, x.Row, default, player: true);
        w.EndObject();
    }
}
