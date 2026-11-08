using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using PtCatch.Engine.Js;
using PtCatch.Engine.World;

namespace PtCatch.Engine.Ingest;

/// <summary>
/// Reads the bot's private data folder (tools/lib/source.mjs). Read-only: the bot writes every file atomically
/// (temporary file, then rename), so reading while it runs is safe. The player files are read in parallel straight
/// into score columns; the small, loosely shaped files become <see cref="JsNode"/> trees.
/// </summary>
public static class BotDataReader
{
    public static BotData Load(string root, Action<string> warn)
    {
        var usersDir = Path.Combine(root, "Users");
        if (!Directory.Exists(usersDir))
        {
            throw new DirectoryNotFoundException($"No Users folder in {root} - is this the bot's data folder?");
        }
        var bot = new BotData();

        // Node lists a folder in NTFS order (case-insensitive by code unit); the order decides who's first among equals.
        var files = Directory.GetFiles(usersDir).Select(Path.GetFileName).Where(f => f.EndsWith(".json", StringComparison.Ordinal))
            .OrderBy(f => f, StringComparer.OrdinalIgnoreCase).ToArray();
        var parsed = new (UserRecord User, RawScores Scores, string Error)[files.Length];
        // The dump is one big file: it's read beside the players' files, then appended after them.
        var dumpFile = Path.Combine(root, "PtCatch", "players.json");
        var dumpScores = new RawScores();
        var dumpPlayers = new List<DumpRecord>();
        var dumpTask = File.Exists(dumpFile) ? Task.Run(() => ReadDump(File.ReadAllBytes(dumpFile), dumpScores, dumpPlayers)) : Task.CompletedTask;
        Parallel.For(0, files.Length, i =>
        {
            try
            {
                var scores = new RawScores();
                var user = ReadUser(File.ReadAllBytes(Path.Combine(usersDir, files[i])), scores);
                parsed[i] = (user, scores, null);
            }
            catch (Exception e) when (e is JsonException or InvalidOperationException or IOException)
            {
                parsed[i] = (null, null, e.Message);
            }
        });
        for (var i = 0; i < files.Length; i++)
        {
            var (user, scores, error) = parsed[i];
            if (user == null)
            {
                warn?.Invoke($"  skipped {files[i]}: {error}");
                continue;
            }
            user.Shift(bot.Scores.Append(scores));
            bot.Players.Add(user);
        }

        dumpTask.Wait();
        var shift = bot.Scores.Append(dumpScores);
        foreach (var d in dumpPlayers)
        {
            d.TopScores = d.TopScores.Shift(shift);
            d.CommunityScores = d.CommunityScores.Shift(shift);
            d.ModScores = d.ModScores.Shift(shift);
            bot.PtCatch.Add(d);
        }
        var dumpState = ReadJsonOr(Path.Combine(root, "PtCatch", "state.json"), null);
        bot.LastImportedDump = dumpState?["last_imported_dump"].Text;
        var bannedFile = Path.Combine(root, "BannedMaps.json");
        if (File.Exists(bannedFile))
        {
            foreach (var id in ReadJson(bannedFile).Items)
            {
                bot.Banned.Add((int)id.ToNumber());
            }
        }
        LoadWeekly(root, bot, warn);
        LoadHill(root, bot, warn);
        bot.Duels = LoadDuels(root, warn);
        LoadPlays(root, bot, warn);
        LoadBounties(root, bot, warn);
        LoadEconomy(root, bot, warn);
        LoadAdminPanel(root, bot, warn);
        return bot;
    }

    public static JsNode ReadJson(string file) => JsNode.Parse(File.ReadAllBytes(file));

    public static JsNode ReadJsonOr(string file, JsNode fallback) => File.Exists(file) ? ReadJson(file) : fallback;

    // ---- Player files ------------------------------------------------------------------------------------------

    internal static UserRecord ReadUser(ReadOnlySpan<byte> json, RawScores scores)
    {
        json = SkipBom(json);
        var reader = new Utf8JsonReader(json, new JsonReaderOptions { MaxDepth = 64 });
        reader.Read();
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException("not an object");
        }
        var u = new UserRecord();
        while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
        {
            var name = reader.GetString();
            reader.Read();
            switch (name)
            {
                case "user_id": u.UserId = (int)Number(ref reader); break;
                case "username": u.Username = Text(ref reader); break;
                case "country": u.Country = Text(ref reader); break;
                case "playcount": u.Playcount = Nullable(ref reader); break;
                case "pp_raw": u.PpRaw = Nullable(ref reader); break;
                case "pp_rank": u.PpRank = Nullable(ref reader); break;
                case "pp_country_rank": u.PpCountryRank = Nullable(ref reader); break;
                case "accuracy": u.Accuracy = Nullable(ref reader); break;
                case "level": u.Level = Nullable(ref reader); break;
                case "count_rank_ss": u.CountSS = Nullable(ref reader); break;
                case "count_rank_s": u.CountS = Nullable(ref reader); break;
                case "count_rank_a": u.CountA = Nullable(ref reader); break;
                case "profile_updated": u.ProfileUpdated = Text(ref reader); break;
                case "DanScore": u.DanScore = reader.TokenType == JsonTokenType.Number ? reader.GetDouble() : 0; break;
                case "restricted_since": u.Restricted = Truthy(ref reader); break;
                case "TopConvertedScores": u.TopConverted = ReadList(ref reader, scores); break;
                case "ConvertPpScores": u.ConvertPp = ReadList(ref reader, scores); break;
                case "TopUnrankedScores": u.TopUnranked = ReadList(ref reader, scores); break;
                case "RankedSpecificScores": u.RankedSpecific = ReadList(ref reader, scores); break;
                case "PreRankScores": u.PreRank = ReadList(ref reader, scores); break;
                case "ConvertModScores": u.ConvertMod = ReadList(ref reader, scores); break;
                case "UnrankedModScores": u.UnrankedMod = ReadList(ref reader, scores); break;
                case "RankedModScores": u.RankedMod = ReadList(ref reader, scores); break;
                case "DanPasses":
                    if (reader.TokenType == JsonTokenType.StartArray)
                    {
                        var passes = new List<int>();
                        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                        {
                            passes.Add(reader.TokenType == JsonTokenType.StartObject ? ReadScore(ref reader, scores) : SkipValue(ref reader));
                        }
                        u.DanPasses = passes.ToArray();
                    }
                    else
                    {
                        reader.Skip();
                    }
                    break;
                default:
                    reader.Skip();
                    break;
            }
        }
        return u;
    }

    private static int SkipValue(ref Utf8JsonReader reader)
    {
        reader.Skip();
        return -1;
    }

    private static ScoreList ReadList(ref Utf8JsonReader reader, RawScores scores)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return default;
        }
        var start = scores.Count;
        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            if (reader.TokenType == JsonTokenType.StartObject)
            {
                ReadScore(ref reader, scores);
            }
            else
            {
                // A null in a list: the exporter's filters drop it (playable(null) is false).
                reader.Skip();
            }
        }
        return new ScoreList(start, scores.Count - start);
    }

    /// <summary>Reads one score object into a new row; returns the row.</summary>
    private static int ReadScore(ref Utf8JsonReader reader, RawScores s)
    {
        var r = s.Add();
        s.Map[r] = 0;
        s.Score[r] = double.NaN;
        s.MaxCombo[r] = double.NaN;
        s.C300[r] = s.C100[r] = s.C50[r] = s.Katu[r] = double.NaN;
        s.Miss[r] = double.NaN;
        s.Mods[r] = 0;
        s.HasDate[r] = false;
        s.Time[r] = double.NaN;
        s.Rank[r] = null;
        s.Pp[r] = double.NaN;
        s.Passed[r] = 0;
        double? scoreId = null, id = null, legacy = null, lid = null;
        var solo = false;
        while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
        {
            var name = reader.ValueSpan;
            reader.Read();
            switch (name.Length)
            {
                case 2 when name.SequenceEqual("id"u8): id = Nullable(ref reader); break;
                case 2 when name.SequenceEqual("pp"u8): s.Pp[r] = reader.TokenType == JsonTokenType.Number ? reader.GetDouble() : double.NaN; break;
                case 3 when name.SequenceEqual("lid"u8): lid = Nullable(ref reader); break;
                case 4 when name.SequenceEqual("date"u8):
                    if (reader.TokenType == JsonTokenType.String)
                    {
                        s.HasDate[r] = reader.ValueSpan.Length > 0;
                        s.Time[r] = reader.ValueIsEscaped ? JsDate.IsoTime(reader.GetString()) : JsDate.IsoTime(reader.ValueSpan);
                    }
                    break;
                case 4 when name.SequenceEqual("rank"u8): s.Rank[r] = Grade(ref reader); break;
                case 4 when name.SequenceEqual("solo"u8): solo = Truthy(ref reader); break;
                case 5 when name.SequenceEqual("score"u8): s.Score[r] = NumberOrNaN(ref reader); break;
                case 6 when name.SequenceEqual("passed"u8): s.Passed[r] = reader.TokenType == JsonTokenType.False ? (byte)2 : (byte)1; break;
                case 8 when name.SequenceEqual("count300"u8): s.C300[r] = Count(ref reader); break;
                case 8 when name.SequenceEqual("count100"u8): s.C100[r] = Count(ref reader); break;
                case 8 when name.SequenceEqual("maxcombo"u8): s.MaxCombo[r] = NumberOrNaN(ref reader); break;
                case 8 when name.SequenceEqual("score_id"u8): scoreId = Nullable(ref reader); break;
                case 7 when name.SequenceEqual("count50"u8): s.C50[r] = Count(ref reader); break;
                case 9 when name.SequenceEqual("countmiss"u8): s.Miss[r] = NumberOrNaN(ref reader); break;
                case 9 when name.SequenceEqual("countkatu"u8): s.Katu[r] = Count(ref reader); break;
                case 10 when name.SequenceEqual("beatmap_id"u8): s.Map[r] = (int)Number(ref reader); break;
                case 12 when name.SequenceEqual("enabled_mods"u8): s.Mods[r] = (int)Number(ref reader); break;
                case 15 when name.SequenceEqual("legacy_score_id"u8): legacy = Nullable(ref reader); break;
                default:
                    reader.Skip();
                    break;
            }
        }
        // weekly.mjs scoreId: the current ("solo") id as a positive number, a legacy id as a negative one, else 0.
        var current = scoreId ?? id ?? 0;
        var old = legacy ?? lid ?? 0;
        s.SiteId[r] = solo && current > 0 ? current : old > 0 ? -old : 0;
        return r;
    }

    private static void ReadDump(ReadOnlySpan<byte> json, RawScores scores, List<DumpRecord> players)
    {
        json = SkipBom(json);
        var reader = new Utf8JsonReader(json, new JsonReaderOptions { MaxDepth = 64 });
        reader.Read();
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            return;
        }
        while (reader.Read() && reader.TokenType == JsonTokenType.StartObject)
        {
            var d = new DumpRecord();
            while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
            {
                var name = reader.GetString();
                reader.Read();
                switch (name)
                {
                    case "user_id": d.UserId = (int)Number(ref reader); break;
                    case "username": d.Username = Text(ref reader); break;
                    case "country": d.Country = Text(ref reader); break;
                    case "pp": d.Pp = Nullable(ref reader); break;
                    case "global_rank": d.GlobalRank = Nullable(ref reader); break;
                    case "country_rank": d.CountryRank = Nullable(ref reader); break;
                    case "level": d.Level = Nullable(ref reader); break;
                    case "accuracy": d.Accuracy = Nullable(ref reader); break;
                    case "playcount": d.Playcount = Nullable(ref reader); break;
                    case "count_rank_ss": d.CountSS = Nullable(ref reader); break;
                    case "count_rank_s": d.CountS = Nullable(ref reader); break;
                    case "count_rank_a": d.CountA = Nullable(ref reader); break;
                    case "top_scores": d.TopScores = ReadList(ref reader, scores); break;
                    case "community_scores": d.CommunityScores = ReadList(ref reader, scores); break;
                    case "mod_scores": d.ModScores = ReadList(ref reader, scores); break;
                    default:
                        reader.Skip();
                        break;
                }
            }
            players.Add(d);
        }
    }

    // ---- The small files ---------------------------------------------------------------------------------------

    private static void LoadWeekly(string root, BotData bot, Action<string> warn)
    {
        var dir = Path.Combine(root, "Weekly");
        if (!Directory.Exists(dir))
        {
            return;
        }
        foreach (var file in ListFiles(dir))
        {
            if (!IsWeekFile(file, ".json"))
            {
                continue;
            }
            try
            {
                bot.WeeklyWeeks.Add(ReadJson(Path.Combine(dir, file)));
            }
            catch (Exception e) when (e is JsonException or IOException or InvalidOperationException)
            {
                warn?.Invoke($"  skipped Weekly/{file}: {e.Message}");
            }
        }
        try
        {
            bot.WeeklyCurrent = ReadJsonOr(Path.Combine(dir, "current.json"), JsNode.NullValue);
        }
        catch (Exception e) when (e is JsonException or IOException or InvalidOperationException)
        {
            warn?.Invoke($"  skipped Weekly/current.json: {e.Message}");
        }
    }

    private static void LoadHill(string root, BotData bot, Action<string> warn)
    {
        var dir = Path.Combine(root, "Hill");
        if (!Directory.Exists(dir))
        {
            return;
        }
        JsNode Read(string file)
        {
            try
            {
                return ReadJsonOr(Path.Combine(dir, file), JsNode.NullValue);
            }
            catch (Exception e) when (e is JsonException or IOException or InvalidOperationException)
            {
                warn?.Invoke($"  skipped Hill/{file}: {e.Message}");
                return JsNode.NullValue;
            }
        }
        var hill = new HillData();
        foreach (var file in ListFiles(dir))
        {
            if (file.Length == 12 && file.EndsWith(".json", StringComparison.Ordinal) && char.IsAsciiDigit(file[0]) && char.IsAsciiDigit(file[3]) &&
                file[4] == '-' && char.IsAsciiDigit(file[5]) && char.IsAsciiDigit(file[6]))
            {
                var month = Read(file);
                if (month.Truthy)
                {
                    hill.Months.Add(month);
                }
            }
        }
        hill.Current = Read("current.json");
        hill.Crowns = Read("crowns.json");
        bot.Hill = hill;
    }

    /// <summary>
    /// Duels (source.mjs loadDuels): ratings.json's <c>players</c>, every month file's <c>duels</c> (matches/2026-11.json…,
    /// oldest first) and state.json's <c>active</c> list, nothing else from that file (the rest is the bot's own, Discord
    /// ids included). Null when there's no Duels folder; a file that won't parse is skipped.
    /// </summary>
    internal static DuelsData LoadDuels(string root, Action<string> warn)
    {
        var dir = Path.Combine(root, "Duels");
        if (!Directory.Exists(dir) && !File.Exists(dir))
        {
            return null;
        }
        JsNode Read(string file)
        {
            var path = Path.Combine(dir, file);
            try
            {
                return File.Exists(path) ? ParseWhole(File.ReadAllBytes(path)) : JsNode.NullValue;
            }
            catch (Exception e) when (e is JsonException or IOException or InvalidOperationException or FormatException or UnauthorizedAccessException)
            {
                warn?.Invoke($"  skipped Duels/{file}: {e.Message}");
                return JsNode.NullValue;
            }
        }
        var duels = new DuelsData();
        var players = Read("ratings.json")["players"];
        if (players.IsObject)
        {
            duels.Ratings = players;
        }
        var matchesDir = Path.Combine(dir, "matches");
        // The month files ("2026-11.json"), in JavaScript's default sort (by code unit).
        var months = Directory.Exists(matchesDir)
            ? Directory.GetFiles(matchesDir).Select(Path.GetFileName).Where(IsMonthFile).OrderBy(f => f, StringComparer.Ordinal).ToList()
            : new List<string>();
        foreach (var file in months)
        {
            var list = Read($"matches/{file}")["duels"];
            if (list.IsArray)
            {
                duels.Matches.AddRange(list.Items);
            }
        }
        var active = Read("state.json")["active"];
        if (active.IsArray)
        {
            duels.Active.AddRange(active.Items);
        }
        return duels;
    }

    /// <summary>"2026-11.json" (<c>/^\d{4}-\d\d\.json$/</c>).</summary>
    private static bool IsMonthFile(string file) =>
        file.Length == 12 && file.EndsWith(".json", StringComparison.Ordinal) && char.IsAsciiDigit(file[0]) && char.IsAsciiDigit(file[1]) &&
        char.IsAsciiDigit(file[2]) && char.IsAsciiDigit(file[3]) && file[4] == '-' && char.IsAsciiDigit(file[5]) && char.IsAsciiDigit(file[6]);

    /// <summary>JSON.parse of a whole file: as <see cref="JsNode.Parse(ReadOnlySpan{byte})"/>, but anything after the value fails.</summary>
    internal static JsNode ParseWhole(ReadOnlySpan<byte> utf8)
    {
        utf8 = SkipBom(utf8);
        var reader = new Utf8JsonReader(utf8, new JsonReaderOptions { MaxDepth = 256 });
        reader.Read();
        var node = JsNode.Read(ref reader);
        if (reader.Read())
        {
            throw new JsonException("Unexpected data after the JSON value");
        }
        return node;
    }

    private static void LoadPlays(string root, BotData bot, Action<string> warn)
    {
        var weeklyState = ReadJsonOr(Path.Combine(root, "Weekly", "state.json"), JsNode.Object());
        var covered = weeklyState["coveredFrom"];
        if (covered.Truthy)
        {
            var from = Math.Floor(JsDate.Parse(covered.IsString ? covered.Text : null) / 1000) + 86400;
            bot.Plays.From = double.IsFinite(from) ? from : double.NaN;
        }
        var dir = Path.Combine(root, "Plays");
        if (!Directory.Exists(dir))
        {
            bot.Plays.From = double.NaN;
            return;
        }
        foreach (var file in ListFiles(dir))
        {
            var gz = file.EndsWith(".jsonl.gz", StringComparison.Ordinal);
            if (!IsWeekFile(file, gz ? ".jsonl.gz" : ".jsonl"))
            {
                continue;
            }
            string text;
            try
            {
                var bytes = File.ReadAllBytes(Path.Combine(dir, file));
                if (gz)
                {
                    using var input = new MemoryStream(bytes);
                    using var unzip = new GZipStream(input, CompressionMode.Decompress);
                    using var output = new MemoryStream();
                    unzip.CopyTo(output);
                    bytes = output.ToArray();
                }
                text = Encoding.UTF8.GetString(bytes);
            }
            catch (Exception e) when (e is IOException or InvalidDataException)
            {
                warn?.Invoke($"  skipped Plays/{file}: {e.Message}");
                continue;
            }
            foreach (var raw in text.Split('\n'))
            {
                var line = raw;
                if (line.Trim().Length == 0)
                {
                    continue;
                }
                if (line.Length > 0 && line[0] == '﻿')
                {
                    line = line[1..];
                }
                JsNode o;
                try
                {
                    o = JsNode.Parse(line);
                }
                catch (Exception e) when (e is JsonException or InvalidOperationException)
                {
                    continue; // a line cut short mid-write
                }
                var u = o["u"];
                if (!u.Truthy)
                {
                    continue;
                }
                var p = bot.Plays;
                p.User.Add(u.ToNumber());
                p.Map.Add(o["m"].ToNumber());
                p.Time.Add(o["t"].ToNumber());
                p.Cat.Add(o["c"].Text);
                var pp = o["pp"];
                p.HasPp.Add(!pp.IsNullish);
                p.Pp.Add(pp.IsNullish ? double.NaN : pp.ToNumber());
                var sniped = o["sniped"];
                p.FirstSniped.Add(sniped.Truthy && sniped.IsArray && sniped.Count > 0 ? sniped[0].ToNumber() : double.NaN);
            }
        }
    }

    private static void LoadBounties(string root, BotData bot, Action<string> warn)
    {
        var file = Path.Combine(root, "Bounties.json");
        if (!File.Exists(file))
        {
            return;
        }
        try
        {
            var list = ReadJson(file)["bounties"];
            bot.Bounties = list.IsArray ? list : JsNode.Array();
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException)
        {
            warn?.Invoke("  Bounties.json in the data folder won’t parse; skipped");
        }
    }

    private static void LoadEconomy(string root, BotData bot, Action<string> warn)
    {
        var dir = Path.Combine(root, "Economy");
        var file = Path.Combine(dir, "wallets.json");
        if (!File.Exists(file))
        {
            return;
        }
        JsNode wallets;
        try
        {
            wallets = ReadJson(file);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException)
        {
            warn?.Invoke("  Economy/wallets.json in the data folder won’t parse; Bananas skipped");
            return;
        }
        var players = wallets["players"];
        if (!players.Truthy || !(players.IsObject || players.IsArray))
        {
            return;
        }
        var economy = new EconomyData { Updated = wallets["updated"], Wallets = players };
        var ledgerFile = Path.Combine(dir, "ledger.jsonl");
        if (File.Exists(ledgerFile))
        {
            foreach (var text in File.ReadAllText(ledgerFile, Encoding.UTF8).Split('\n'))
            {
                var line = text.TrimEnd('\r');
                if (line.Trim().Length == 0)
                {
                    continue;
                }
                try
                {
                    economy.Ledger.Add(JsNode.Parse(line));
                }
                catch (Exception e) when (e is JsonException or InvalidOperationException)
                {
                    // a half-written last line: the next export reads it
                }
            }
        }
        bot.Economy = economy;
    }

    private static void LoadAdminPanel(string root, BotData bot, Action<string> warn)
    {
        var file = Path.Combine(root, "Admin", "panel.json");
        if (!File.Exists(file))
        {
            return;
        }
        try
        {
            bot.AdminPanel = ReadJson(file);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException)
        {
            warn?.Invoke("  Admin/panel.json in the data folder won’t parse; admin.json skipped");
        }
    }

    /// <summary>The bot's commands.json, or null when it's missing or not the expected shape (source.mjs loadCommands).</summary>
    public static JsNode LoadCommands(string root)
    {
        var file = Path.Combine(root, "commands.json");
        if (!File.Exists(file))
        {
            return null;
        }
        try
        {
            var commands = ReadJson(file);
            var groups = commands["groups"];
            return groups.IsArray && groups.Items.All(g => g["commands"].IsArray) ? commands : null;
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException)
        {
            return null;
        }
    }

    // ---- Helpers -----------------------------------------------------------------------------------------------

    /// <summary>A folder's file names in the order Node lists them on Windows.</summary>
    private static IEnumerable<string> ListFiles(string dir) =>
        Directory.GetFiles(dir).Select(Path.GetFileName).OrderBy(f => f, StringComparer.OrdinalIgnoreCase);

    /// <summary>"2026-W44" + suffix.</summary>
    private static bool IsWeekFile(string file, string suffix) =>
        file.Length == 8 + suffix.Length && file.EndsWith(suffix, StringComparison.Ordinal) && char.IsAsciiDigit(file[0]) &&
        char.IsAsciiDigit(file[1]) && char.IsAsciiDigit(file[2]) && char.IsAsciiDigit(file[3]) && file[4] == '-' && file[5] == 'W' &&
        char.IsAsciiDigit(file[6]) && char.IsAsciiDigit(file[7]);

    private static ReadOnlySpan<byte> SkipBom(ReadOnlySpan<byte> json) => json.StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF]) ? json[3..] : json;

    /// <summary>A grade, as one shared string per grade rather than one per play.</summary>
    private static string Grade(ref Utf8JsonReader reader)
    {
        if (reader.TokenType != JsonTokenType.String || reader.ValueIsEscaped)
        {
            return Text(ref reader);
        }
        var v = reader.ValueSpan;
        return v.Length switch
        {
            1 when v[0] == (byte)'S' => "S",
            1 when v[0] == (byte)'A' => "A",
            1 when v[0] == (byte)'B' => "B",
            1 when v[0] == (byte)'C' => "C",
            1 when v[0] == (byte)'D' => "D",
            1 when v[0] == (byte)'X' => "X",
            1 when v[0] == (byte)'F' => "F",
            2 when v.SequenceEqual("SH"u8) => "SH",
            2 when v.SequenceEqual("XH"u8) => "XH",
            _ => reader.GetString(),
        };
    }

    private static string Text(ref Utf8JsonReader reader)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            return reader.GetString();
        }
        reader.Skip();
        return null;
    }

    private static double Number(ref Utf8JsonReader reader)
    {
        if (reader.TokenType == JsonTokenType.Number)
        {
            return reader.GetDouble();
        }
        reader.Skip();
        return 0;
    }

    private static double NumberOrNaN(ref Utf8JsonReader reader)
    {
        if (reader.TokenType == JsonTokenType.Number)
        {
            return reader.GetDouble();
        }
        reader.Skip();
        return double.NaN;
    }

    /// <summary>A count the exporter adds up: null counts as 0 there (null + 1 is 1).</summary>
    private static double Count(ref Utf8JsonReader reader)
    {
        if (reader.TokenType == JsonTokenType.Number)
        {
            return reader.GetDouble();
        }
        var isNull = reader.TokenType == JsonTokenType.Null;
        reader.Skip();
        return isNull ? 0 : double.NaN;
    }

    private static double? Nullable(ref Utf8JsonReader reader)
    {
        if (reader.TokenType == JsonTokenType.Number)
        {
            return reader.GetDouble();
        }
        reader.Skip();
        return null;
    }

    private static bool Truthy(ref Utf8JsonReader reader)
    {
        var node = JsNode.Read(ref reader);
        return node.Truthy;
    }
}
