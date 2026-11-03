using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;

namespace PtCatch.Engine.Export;

public sealed partial class Build
{
    /// <summary>Ledger kinds that count towards the 1,000 earned (the gate).</summary>
    private static readonly HashSet<string> Earned =
    [
        "daily.play", "daily.game", "snipe", "hill.take", "fc.first", "pass.first", "hill.crown", "hill.title", "motw.play", "motw.top",
        "vote", "dan", "badge", "record", "bounty.claim",
    ];

    /// <summary>Ledger kinds whose bananas are gone for good: the posting fee and the shop.</summary>
    private static readonly HashSet<string> Burned = ["bounty.fee", "shop"];
    private static readonly string[] Palette = ["rosa", "gold", "mint", "sky", "lilac", "sand"];
    private const int RecentLedger = 8;
    private const int EconomyBoard = 10;

    private JsNode economyFile;
    private readonly List<JsNode> economyEvents = new();

    /// <summary>Unix seconds of a ledger or wallet time (economy.mjs time: Date.parse, no zone assumed), or null.</summary>
    private static double? EconomyTime(JsNode iso)
    {
        if (!iso.IsString)
        {
            return null;
        }
        var t = JsDate.Parse(iso.Text);
        return double.IsNaN(t) ? null : Math.Floor(t / 1000);
    }

    private static double IntOf(JsNode v) => v.IsSafeInteger ? v.Number : 0;

    /// <summary>
    /// economy.mjs note: <c>/[\p{C}]/gu</c> gone (by code point, so an emoji's two halves stay), trimmed, at most 80
    /// UTF-16 units.
    /// </summary>
    private static string Note(JsNode v)
    {
        if (!v.IsString || v.Text.Trim().Length == 0)
        {
            return null;
        }
        var text = v.Text;
        var sb = new StringBuilder(text.Length);
        for (var i = 0; i < text.Length;)
        {
            if (Rune.DecodeFromUtf16(text.AsSpan(i), out var rune, out var used) != System.Buffers.OperationStatus.Done)
            {
                i++; // a lone surrogate: category Cs
                continue;
            }
            var category = Rune.GetUnicodeCategory(rune);
            if (category is not (System.Globalization.UnicodeCategory.Control or System.Globalization.UnicodeCategory.Format or
                System.Globalization.UnicodeCategory.Surrogate or System.Globalization.UnicodeCategory.PrivateUse or
                System.Globalization.UnicodeCategory.OtherNotAssigned))
            {
                sb.Append(text, i, used);
            }
            i += used;
        }
        var s = sb.ToString().Trim();
        return s.Length > 80 ? s[..80] : s;
    }

    /// <summary>economy.json and the Activity feed's tips (tools/lib/economy.mjs economyBlock).</summary>
    private void BuildEconomy()
    {
        var economy = bot.Economy;
        if (economy == null)
        {
            return;
        }
        var month = JsDate.LisbonMonth(now);
        var wallets = JsNode.Object();
        var recent = new Dictionary<string, List<JsNode>>();
        foreach (var (key, w) in JsNode.OrderedProps(economy.Wallets))
        {
            var id = JsNode.StringToNumber(key);
            if (!(personOf.ContainsKey((int)id) && id == (int)id) || !w.IsObject)
            {
                continue;
            }
            var o = JsNode.Object();
            o.Set("b", IntOf(w["balance"])).Set("p", IntOf(w["pouch"])).Set("e", IntOf(w["earned"])).Set("x", IntOf(w["escrow"]))
                .Set("s", w["signedIn"].Truthy ? 1 : 0).Set("sh", w["shield"].Truthy ? 1 : 0).Set("t", JsNode.Str(Note(w["title"])))
                .Set("w", IntOf(w["weekRepeatable"]));
            var (c, cu) = Timed(w["colour"], w["colourUntil"]);
            var (ro, ru) = Timed(w["role"], w["roleUntil"]);
            o.Set("sg", w["signature"].IsSafeInteger && w["signature"].Number > 0 ? w["signature"] : JsNode.NullValue);
            o.Set("c", c).Set("cu", cu).Set("ro", ro).Set("ru", ru);
            o.Set("r", JsNode.Array());
            wallets.Set(JsMath.ToString(id), o);
            recent[JsMath.ToString(id)] = new List<JsNode>();
        }

        var earnedMonth = new List<(double Id, double N, double Count)>();
        var hunters = new List<(double Id, double N, double Count)>();
        var generous = new List<(double Id, double N, double Count)>();
        void Add(List<(double Id, double N, double Count)> map, double id, double n, double count = 0)
        {
            var i = map.FindIndex(x => x.Id == id);
            if (i < 0)
            {
                map.Add((id, n, count));
            }
            else
            {
                map[i] = (id, map[i].N + n, map[i].Count + count);
            }
        }
        double minted = 0, burned = 0;
        var tipsOut = new List<(string Ref, double T, double Id, double Amount, string Note)>();
        var tipsIn = new Dictionary<string, double>();
        foreach (var line in economy.Ledger)
        {
            var t = EconomyTime(line["t"]);
            var idNode = line["user"];
            var amount = IntOf(line["amount"]);
            if (t == null || !idNode.IsSafeInteger || !line["kind"].IsString)
            {
                continue;
            }
            var id = idNode.Number;
            var kind = line["kind"].Text;
            var thisMonth = JsDate.LisbonMonth(t.Value) == month;
            if (Earned.Contains(kind) && amount > 0 && thisMonth)
            {
                minted += amount;
            }
            if (Burned.Contains(kind) && thisMonth)
            {
                burned -= amount;
            }
            if (kind == "tip.out" && line["ref"].IsString)
            {
                var r = line["ref"].Text;
                var at = tipsOut.FindIndex(x => x.Ref == r);
                var entry = (r, t.Value, id, -amount, Note(line["note"]));
                if (at < 0)
                {
                    tipsOut.Add(entry);
                }
                else
                {
                    tipsOut[at] = entry;
                }
            }
            if (kind == "tip.in" && line["ref"].IsString)
            {
                tipsIn[line["ref"].Text] = id;
            }
            var key = JsMath.ToString(id);
            if (!wallets.Has(key))
            {
                continue;
            }
            if (Earned.Contains(kind) && amount > 0 && thisMonth)
            {
                Add(earnedMonth, id, amount);
            }
            if (kind == "bounty.claim" && amount > 0)
            {
                Add(hunters, id, amount, 1);
            }
            if ((kind == "tip.out" || kind == "bounty.fund") && amount < 0)
            {
                Add(generous, id, -amount);
            }
            var noted = kind is "adjust" or "reverse" or "tip.out" or "tip.in" ? Note(line["note"]) : null;
            recent[key].Add(JsNode.ArrayOf(JsNode.Num(t.Value), JsNode.Num(amount), JsNode.Str(kind), JsNode.Num(line["pouch"].Truthy ? 1 : 0), JsNode.Str(noted)));
        }
        foreach (var (key, w) in JsNode.OrderedProps(wallets))
        {
            var lines = recent[key];
            JsSort.Stable(lines, (a, b) => JsSort.Sign(b[0].Number - a[0].Number));
            w.Set("r", ArrayOf(lines.Take(RecentLedger)));
        }

        foreach (var (r, t, from, amount, note) in tipsOut)
        {
            if (tipsIn.TryGetValue(r, out var to) && wallets.Has(JsMath.ToString(from)) && wallets.Has(JsMath.ToString(to)) && amount > 0)
            {
                var e = JsNode.Object().Set("t", t).Set("k", "tip").Set("u", from).Set("v", to).Set("a", amount);
                if (note != null)
                {
                    e.Set("n", note);
                }
                economyEvents.Add(e);
            }
        }

        JsNode Top(List<(double Id, double N, double Count)> totals, bool withCount)
        {
            var rows = totals.Where(x => x.N > 0).ToList();
            JsSort.Stable(rows, (a, b) => JsSort.Sign(b.N - a.N) is var c && c != 0 ? c : JsSort.Sign(a.Id - b.Id));
            return ArrayOf(rows.Take(EconomyBoard).Select(x => withCount
                ? JsNode.ArrayOf(JsNode.Num(x.Id), JsNode.Num(x.N), JsNode.Num(x.Count))
                : JsNode.ArrayOf(JsNode.Num(x.Id), JsNode.Num(x.N))));
        }
        double Sum(string key) => JsNode.OrderedProps(wallets).Sum(kv => kv.Value[key].Number);
        var walletList = JsNode.OrderedProps(wallets).Select(kv => kv.Value).ToList();
        economyFile = JsNode.Object()
            .Set("updated", EconomyTime(economy.Updated) ?? now)
            .Set("players", wallets)
            .Set("month", month)
            .Set("boards", JsNode.Object().Set("earned", Top(earnedMonth, false)).Set("hunters", Top(hunters, true)).Set("generous", Top(generous, false)))
            .Set("totals", JsNode.Object()
                .Set("supply", Sum("b") + Sum("p") + Sum("x")).Set("wallets", Sum("b")).Set("pouches", Sum("p")).Set("escrow", Sum("x"))
                .Set("signedIn", walletList.Count(p => p["s"].Truthy)).Set("mintedMonth", minted).Set("burnedMonth", burned));
    }

    /// <summary>A bought colour or role while it lasts: [name, until] or [null, null].</summary>
    private (JsNode, JsNode) Timed(JsNode name, JsNode untilIso)
    {
        var until = EconomyTime(untilIso);
        return name.IsString && Palette.Contains(name.Text) && until > now ? (name, JsNode.Num(until.Value)) : (JsNode.NullValue, JsNode.NullValue);
    }

    /// <summary>
    /// What players bought for everyone to see: name colours on players.json, each wallet's latest lines and the pinned
    /// signature play on their profile file.
    /// </summary>
    private void ApplyEconomyToPlayers()
    {
        var wallets = economyFile?["players"];
        if (wallets == null)
        {
            return;
        }
        foreach (var (key, w) in JsNode.OrderedProps(wallets).ToList())
        {
            var id = (int)JsNode.StringToNumber(key);
            if (w["c"].Truthy && playerEntry.TryGetValue(id, out var entry))
            {
                entry.Set("nc", w["c"]).Set("ncu", w["cu"]);
            }
            playerFiles.TryGetValue(id, out var file);
            if (file != null && w["r"].Count > 0)
            {
                file.Ledger = w["r"];
            }
            w.Remove("r");
            if (!w["sg"].Truthy || file == null)
            {
                continue;
            }
            var sg = (int)w["sg"].Number;
            var best = new List<(Cat Cat, int Tuple)>();
            foreach (var cat in Rules.Cats)
            {
                foreach (var t in file.Person.Lists[(int)cat])
                {
                    if (T.Map[t] == sg)
                    {
                        best.Add((cat, t));
                    }
                }
            }
            JsSort.Stable(best, (a, b) => JsSort.Sign(T.Pp[b.Tuple] - T.Pp[a.Tuple]) is var c && c != 0 ? c : JsSort.Sign(T.Score[b.Tuple] - T.Score[a.Tuple]));
            if (best.Count == 0)
            {
                continue;
            }
            file.Pinned = (Rules.Letter(best[0].Cat), best[0].Tuple);
            file.MapIds.Add(sg);
        }
    }

    // ---- Unlocks ---------------------------------------------------------------------------------------------

    private JsNode unlocksFile;
    private JsNode unlocksSeen;

    /// <summary>unlocks.json: what every player on the site holds now (economy.mjs unlocks).</summary>
    private void BuildUnlocks(List<(int Id, List<string> Keys)> badges)
    {
        var previousSeen = previous["unlocks"];
        var first = previousSeen.IsNullish;
        var seen = JsNode.Object();
        foreach (var (k, v) in previousSeen.Props)
        {
            seen.Set(k, v);
        }
        var rows = new List<(string Date, double OsuId, string Kind, string Key)>();
        foreach (var (id, keys) in badges)
        {
            foreach (var key in keys.Where(k => k != null).Distinct())
            {
                var name = $"{key}:{id}";
                if (seen[name].IsNullish)
                {
                    seen.Set(name, first ? 0 : now);
                }
                rows.Add((JsDate.IsoSeconds(seen[name].ToNumber()), id, "badge", key));
            }
        }
        foreach (var (key, row) in RecordRows())
        {
            rows.Add((JsDate.IsoSeconds(row.Time), row.Uid, "record", key));
        }
        JsSort.Stable(rows, (a, b) =>
        {
            var c = JsSort.LocaleCompare(a.Date, b.Date);
            if (c != 0)
            {
                return c;
            }
            c = JsSort.Sign(a.OsuId - b.OsuId);
            if (c != 0)
            {
                return c;
            }
            c = JsSort.LocaleCompare(a.Kind, b.Kind);
            return c != 0 ? c : JsSort.LocaleCompare(a.Key, b.Key);
        });
        unlocksFile = ArrayOf(rows.Select(r => JsNode.Object().Set("osuId", r.OsuId).Set("kind", r.Kind).Set("key", r.Key).Set("date", r.Date)));
        unlocksSeen = seen;
    }

    // ---- The admin panel -------------------------------------------------------------------------------------

    private static readonly string[] AdminTypes = ["int", "double", "bool", "intList"];
    private static readonly string[] AdminEffects = ["now", "next_draft", "next_recap"];
    private static readonly string[] AdminVias = ["site", "discord"];
    private static readonly string[] AdminStatuses = ["accepted", "rejected"];
    private static readonly string[] ArgKeys = ["key", "value", "slot", "tier", "id", "refund", "osuId", "amount", "note", "beatmapId"];
    private static readonly Regex SettingKeyPattern = new(@"^[A-Za-z][A-Za-z0-9]{0,40}(\.[A-Za-z][A-Za-z0-9]{0,40}){1,2}$", RegexOptions.Compiled);
    private static readonly Regex AdminKind = new(@"^admin\.[a-z.]{1,40}$", RegexOptions.Compiled);
    private static readonly Regex RequestIdPattern = new(@"^([0-9a-f]{24}|discord:[0-9a-f-]{36})$", RegexOptions.Compiled);
    private static readonly Regex CodePattern = new(@"^[a-z_]{1,40}$", RegexOptions.Compiled);
    private static readonly Regex ControlChars = new(@"\p{Cc}", RegexOptions.Compiled);

    private static string AdminText(JsNode v, int max)
    {
        if (!v.IsString)
        {
            return null;
        }
        var s = ControlChars.Replace(v.Text, " ").Trim();
        return s.Length > max ? s[..max] : s;
    }

    private static JsNode AdminNum(JsNode v) => v.IsNumber && double.IsFinite(v.Number) ? v : JsNode.NullValue;

    private static JsNode AdminOsuId(JsNode v) => v.IsSafeInteger && v.Number > 0 && v.Number < 1e10 ? v : JsNode.NullValue;

    /// <summary>A setting's value for its type, or null when it doesn't fit.</summary>
    private static JsNode AdminValue(string type, JsNode v) => type switch
    {
        "bool" => v.IsBool ? v : null,
        "intList" => v.IsArray && v.Count <= 10 && v.Items.All(n => n.IsSafeInteger) ? v : null,
        "int" => v.IsSafeInteger ? v : null,
        _ => v.IsNumber && double.IsFinite(v.Number) ? v : null,
    };

    /// <summary>admin.json from the bot's panel.json (tools/lib/admin.mjs), or null.</summary>
    private static JsNode AdminFile(JsNode panel)
    {
        if (panel == null || !panel.IsObject || !panel["settings"].IsArray)
        {
            return null;
        }
        var admins = JsNode.Array();
        foreach (var a in panel["admins"].Items)
        {
            var id = AdminOsuId(a["osuId"]);
            if (id.Truthy)
            {
                admins.Add(JsNode.Object().Set("osuId", id).Set("name", AdminText(a["name"], 40) ?? ""));
            }
        }
        var settings = JsNode.Array();
        foreach (var s in panel["settings"].Items)
        {
            var key = s["key"].IsString && SettingKeyPattern.IsMatch(s["key"].Text) ? s["key"].Text : null;
            var type = s["type"].IsString && AdminTypes.Contains(s["type"].Text) ? s["type"].Text : null;
            var group = AdminText(s["group"], 40);
            if (key == null || type == null || string.IsNullOrEmpty(group))
            {
                continue;
            }
            var value = AdminValue(type, s["value"]);
            var fallback = AdminValue(type, s["default"]);
            if (value == null || fallback == null)
            {
                continue;
            }
            settings.Add(JsNode.Object().Set("key", key).Set("group", group).Set("type", type)
                .Set("min", AdminNum(s["min"])).Set("max", AdminNum(s["max"])).Set("step", AdminNum(s["step"]))
                .Set("length", s["length"].IsSafeInteger && s["length"].Number > 0 ? s["length"] : JsNode.NullValue)
                .Set("value", value).Set("default", fallback).Set("overridden", s["overridden"].IsBool && s["overridden"].BoolValue)
                .Set("effect", s["effect"].IsString && AdminEffects.Contains(s["effect"].Text) ? s["effect"].Text : "now")
                .Set("description", AdminText(s["description"], 200) ?? ""));
        }
        var actions = JsNode.Array();
        foreach (var a in panel["actions"].Items.Take(100))
        {
            var kind = a["kind"].IsString && AdminKind.IsMatch(a["kind"].Text) ? a["kind"].Text : null;
            var at = a["at"].IsString && !double.IsNaN(JsDate.Parse(a["at"].Text)) ? a["at"].Text : null;
            var status = a["status"].IsString && AdminStatuses.Contains(a["status"].Text) ? a["status"].Text : null;
            if (kind == null || at == null || status == null)
            {
                continue;
            }
            var requestId = a["requestId"].IsString && RequestIdPattern.IsMatch(a["requestId"].Text) ? a["requestId"].Text : null;
            var code = status == "rejected" && a["code"].IsString && CodePattern.IsMatch(a["code"].Text) ? a["code"].Text : null;
            var o = JsNode.Object().Set("at", at);
            if (requestId != null)
            {
                o.Set("requestId", requestId);
            }
            o.Set("osuId", AdminOsuId(a["osuId"])).Set("name", AdminText(a["name"], 40) ?? "")
                .Set("via", a["via"].IsString && AdminVias.Contains(a["via"].Text) ? a["via"].Text : "site")
                .Set("kind", kind).Set("args", AdminArgs(a["args"])).Set("status", status).Set("reason", AdminText(a["reason"], 300) ?? "");
            if (code != null)
            {
                o.Set("code", code);
            }
            actions.Add(o);
        }
        return JsNode.Object().Set("generatedAt", panel["generatedAt"].IsSafeInteger ? panel["generatedAt"] : JsNode.NullValue)
            .Set("admins", admins).Set("settings", settings).Set("actions", actions);
    }

    private static JsNode AdminArgs(JsNode a)
    {
        var o = JsNode.Object();
        if (!a.IsObject)
        {
            return o;
        }
        foreach (var k in ArgKeys)
        {
            var v = a[k];
            if (v.IsNumber && double.IsFinite(v.Number))
            {
                o.Set(k, v);
            }
            else if (v.IsBool)
            {
                o.Set(k, v);
            }
            else if (v.IsString)
            {
                o.Set(k, AdminText(v, 100));
            }
            else if (v.IsArray && v.Count <= 10 && v.Items.All(n => n.IsNumber && double.IsFinite(n.Number)))
            {
                o.Set(k, v);
            }
        }
        return o;
    }
}
