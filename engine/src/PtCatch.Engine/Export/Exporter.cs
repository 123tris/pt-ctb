using System;
using System.Buffers.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using PtCatch.Engine.Ingest;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;
using PtCatch.Engine.World;

namespace PtCatch.Engine.Export;

public sealed class ExportOptions
{
    /// <summary>The bot's data folder (PT-CTB-Bot-Data).</summary>
    public string DataRoot;
    public string Country = "PT";
    /// <summary>The site repo, whose state/ holds the exporter's memory.</summary>
    public string RepoRoot;
    /// <summary>Where the files go; anything but &lt;repo&gt;/data is a trial export with its own state.</summary>
    public string OutDir;
    /// <summary>The export's time (unix seconds); now when null. Fixed for comparisons with the Node exporter.</summary>
    public double? Now;
    /// <summary>Print each stage's and system's milliseconds.</summary>
    public bool Timings;
}

/// <summary>The files an export made, with their hashes, and what it changed.</summary>
public sealed class ExportResult
{
    public int Files;
    public int Changed;
    public int Removed;
    public long Bytes;
    public readonly List<(string Stage, double Ms)> Timings = new();
}

/// <summary>
/// tools/export.mjs, ported: reads the bot's data, tops up beatmap metadata from the exporter's osu! API cache, runs
/// <see cref="Build"/>, and writes the files that changed under content-hashed names listed in meta.json. A file is
/// unchanged when its hash is the one the previous meta.json lists, so nothing is read back to compare.
/// </summary>
public static class Exporter
{
    /// <summary>Files earlier exports wrote and this one doesn't.</summary>
    private static readonly string[] Retired = ["maps-index.json"];

    public static ExportResult Run(ExportOptions o, Action<string> log)
    {
        var result = new ExportResult();
        var clock = Stopwatch.StartNew();
        var last = 0.0;
        void Stage(string name)
        {
            var at = clock.Elapsed.TotalMilliseconds;
            result.Timings.Add((name, at - last));
            last = at;
        }

        var repo = Path.GetFullPath(o.RepoRoot);
        var outDir = Path.GetFullPath(o.OutDir ?? Path.Combine(repo, "data"));
        var trial = !string.Equals(outDir, Path.Combine(repo, "data"), StringComparison.OrdinalIgnoreCase);
        var stateDir = Path.Combine(repo, "state");
        var stateFile = Path.Combine(stateDir, "state.json");
        var stateOut = trial ? Path.Combine(outDir, ".state.json") : stateFile;
        var avatarStateFile = Path.Combine(stateDir, "avatars.json");
        var avatarStateOut = trial ? Path.Combine(outDir, ".avatars.json") : avatarStateFile;

        log($"Reading bot data from {o.DataRoot}");
        // The bot's files, its beatmap cache and our osu! cache don't depend on each other: they're read at once.
        var allTask = Task.Run(() => BeatmapReader.ReadAll(o.DataRoot, Path.Combine(stateDir, "beatmaps.ptcb"), log));
        var cacheTask = Task.Run(() => OsuCache.Load(Path.Combine(stateDir, "beatmaps.json")));
        var bot = BotDataReader.Load(o.DataRoot, log);
        Stage("load bot data");
        var neededList = Build.NeededMapIds(bot, o.Country);
        var needed = new HashSet<int>(neededList);
        var all = allTask.Result;
        Stage("load beatmaps");
        var beatmaps = new Beatmaps(Math.Max(16, all.Count * 3 / 4));
        for (var row = 0; row < all.Count; row++)
        {
            if (needed.Contains(all.Id[row]) || all.IsUnclaimedCandidate(row) || all.IsCatchPlayable(row))
            {
                beatmaps.CopyFrom(all, row);
            }
        }
        log($"  {bot.Players.Count} tracked players, {bot.PtCatch.Count} dump players, {bot.Bounties.Count} bounties, {beatmaps.Count} beatmaps kept" +
            (bot.Economy != null ? $"; Bananas: {bot.Economy.Wallets.Count} wallets, {bot.Economy.Ledger.Count} ledger lines" : "; no Bananas yet"));

        var cache = cacheTask.Result;
        if (cache.Migrated > 0)
        {
            log($"  dropped the osu!standard star rating of {cache.Migrated} converts in state/beatmaps.json");
            cache.Save(Path.Combine(stateDir, "beatmaps.json"));
        }
        TopUp(beatmaps, cache, neededList, log);
        Stage("top up beatmaps");

        var previous = File.Exists(stateOut) ? BotDataReader.ReadJson(stateOut) : File.Exists(stateFile) ? BotDataReader.ReadJson(stateFile) : JsNode.Object();
        var historyFile = Path.Combine(outDir, "history.json");
        var previousHistory = File.Exists(historyFile) ? BotDataReader.ReadJson(historyFile) : JsNode.NullValue;
        var now = o.Now ?? Math.Floor(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0);

        // Players osu! reports as inactive whose official pp we never saw live and who have no plays to estimate it
        // from: the last value in the data folder's git history is all there is.
        var unknownInactive = bot.Players.Where(r => r.Country == o.Country && !string.IsNullOrEmpty(r.ProfileUpdated) &&
                !(r.PpRaw > 0 && r.PpRank is double rank && rank != 0) && !previous["official"][r.UserId.ToString()].Truthy &&
                !HasOfficialPlays(bot.Scores, r))
            .Select(r => r.UserId).ToList();
        var pastOfficial = unknownInactive.Count > 0 ? LoadPastOfficial(o.DataRoot, unknownInactive) : new Dictionary<int, PastOfficial>();
        if (unknownInactive.Count > 0)
        {
            log($"  {unknownInactive.Count} inactive players with no plays to estimate from; {pastOfficial.Count} found in the data folder's history");
        }
        Stage("past official pp");

        var build = new Build(bot, beatmaps, o.Country, now, previous, pastOfficial, cache.Maps, previousHistory);
        build.Run(o.Timings ? (name, ms) => result.Timings.Add(("  " + name, ms)) : null);
        Stage("build");

        var files = new List<(string Name, byte[] Bytes)>(build.Files);
        var commands = BotDataReader.LoadCommands(o.DataRoot);
        if (commands != null)
        {
            files.Add(("commands.json", Encoding.UTF8.GetBytes(commands.Stringify())));
        }
        else if (File.Exists(Path.Combine(o.DataRoot, "commands.json")))
        {
            log("  commands.json in the data folder is not the expected shape; skipped");
        }

        // Avatar thumbnails: kept as they are on disk (making new ones is the publisher's job).
        var avatarState = File.Exists(avatarStateOut) ? BotDataReader.ReadJson(avatarStateOut) : File.Exists(avatarStateFile) ? BotDataReader.ReadJson(avatarStateFile) : JsNode.Object();
        var avatars = Avatars.Keep(build.PlayerIds.OrderBy(id => id).ToList(), outDir, avatarState);
        log($"  avatars: {avatars.Kept} kept{(avatars.Missing > 0 ? $", {avatars.Missing} without a thumbnail" : "")}");

        // meta.json lists a hash of every other file's content, which the site puts on that file's URL.
        var previousMeta = File.Exists(Path.Combine(outDir, "meta.json")) ? BotDataReader.ReadJson(Path.Combine(outDir, "meta.json")) : JsNode.Object();
        var previousFiles = previousMeta["files"];
        var hashes = new string[files.Count];
        var changed = new bool[files.Count];
        Parallel.For(0, files.Count, i =>
        {
            var (name, bytes) = files[i];
            hashes[i] = Hash(bytes);
            var path = Path.Combine(outDir, name);
            if (previousFiles[name].Text == hashes[i] && File.Exists(path))
            {
                return;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path + ".tmp", bytes);
            File.Move(path + ".tmp", path, true);
            changed[i] = true;
        });
        var versions = JsNode.Object();
        for (var i = 0; i < files.Count; i++)
        {
            versions.Set(files[i].Name, hashes[i]);
            result.Bytes += files[i].Bytes.Length;
        }
        foreach (var (name, bytes) in avatars.Files)
        {
            versions.Set(name, Hash(bytes));
            result.Bytes += bytes.Length;
        }
        result.Changed = changed.Count(c => c);
        Stage("hash and write");

        var keep = new HashSet<string>(files.Select(f => f.Name).Concat(avatars.Files.Select(f => f.Name)), StringComparer.Ordinal);
        foreach (var folder in new[] { "players", "maps", "sets", "avatars" })
        {
            var dir = Path.Combine(outDir, folder);
            if (!Directory.Exists(dir))
            {
                continue;
            }
            foreach (var file in Directory.GetFiles(dir))
            {
                if (!keep.Contains($"{folder}/{Path.GetFileName(file)}"))
                {
                    File.Delete(file);
                    result.Removed++;
                }
            }
        }
        foreach (var name in Retired)
        {
            var file = Path.Combine(outDir, name);
            if (File.Exists(file))
            {
                File.Delete(file);
                result.Removed++;
            }
        }

        var meta = build.Meta;
        meta.Set("files", versions);
        var metaFile = Path.Combine(outDir, "meta.json");
        if (result.Changed > 0 || result.Removed > 0 || !File.Exists(metaFile) || previousFiles.Stringify() != versions.Stringify())
        {
            WriteIfChanged(metaFile, Encoding.UTF8.GetBytes(meta.Stringify()));
            result.Changed++;
        }
        WriteIfChanged(stateOut, Encoding.UTF8.GetBytes(build.State.Stringify()));
        WriteIfChanged(avatarStateOut, Encoding.UTF8.GetBytes(avatars.State.Stringify()));
        result.Files = files.Count;
        Stage("meta and state");
        log($"  {files.Count + 1} files ({result.Bytes / 1e6:F1} MB), {result.Changed} changed, {result.Removed} removed in {clock.Elapsed.TotalSeconds:F1}s");
        return result;
    }

    /// <summary>sha256 of the bytes, base64url, first 10 characters (assets/js/core/data-name.js).</summary>
    public static string Hash(ReadOnlySpan<byte> bytes)
    {
        Span<byte> digest = stackalloc byte[32];
        SHA256.HashData(bytes, digest);
        return Base64Url.EncodeToString(digest)[..10];
    }

    private static void WriteIfChanged(string file, byte[] bytes)
    {
        if (File.Exists(file) && File.ReadAllBytes(file).AsSpan().SequenceEqual(bytes))
        {
            return;
        }
        Directory.CreateDirectory(Path.GetDirectoryName(file));
        File.WriteAllBytes(file + ".tmp", bytes);
        File.Move(file + ".tmp", file, true);
    }

    private static bool HasOfficialPlays(RawScores s, UserRecord r)
    {
        foreach (var list in new[] { r.TopConverted, r.RankedSpecific })
        {
            for (var i = list.Start; i < list.End; i++)
            {
                if (s.Pp[i] > 0)
                {
                    return true;
                }
            }
        }
        return false;
    }

    /// <summary>
    /// What the exporter's osu! API cache adds to the bot's beatmaps (export.mjs): titles for maps the bot only knows by
    /// id, ranked and updated dates, and the catch star rating of converts.
    /// </summary>
    private static void TopUp(Beatmaps beatmaps, OsuCache cache, List<int> needed, Action<string> log)
    {
        var untitled = needed.Where(id => beatmaps.RowOf(id) is var row && (row < 0 || string.IsNullOrEmpty(beatmaps.Title[row]) || beatmaps.Title[row] == "Unknown")).ToList();
        foreach (var id in untitled)
        {
            var titled = cache.Maps.RowOf(id);
            if (titled < 0)
            {
                continue;
            }
            var own = beatmaps.RowOf(id);
            var useOwn = own >= 0 && (beatmaps.HasCatchDifficulty(own) || !cache.Maps.HasCatchDifficulty(titled));
            double ownStars = 0, ownCombo = 0;
            bool ownStarsNull = false, ownCatch = false;
            string ownApproved = null, ownUpdate = null;
            if (own >= 0)
            {
                ownStars = beatmaps.Stars[own];
                ownStarsNull = beatmaps.StarsNull[own];
                ownCombo = beatmaps.MaxCombo[own];
                ownCatch = beatmaps.HasCatchDifficulty(own);
                ownApproved = beatmaps.ApprovedDate[own];
                ownUpdate = beatmaps.LastUpdate[own];
            }
            var row = beatmaps.CopyFrom(cache.Maps, titled);
            if (useOwn)
            {
                beatmaps.Stars[row] = ownStars;
                beatmaps.StarsNull[row] = ownStarsNull;
                beatmaps.MaxCombo[row] = ownCombo;
                beatmaps.CatchDifficulty[row] = ownCatch;
            }
            beatmaps.ApprovedDate[row] = ownApproved ?? cache.Maps.ApprovedDate[titled];
            beatmaps.LastUpdate[row] = ownUpdate ?? cache.Maps.LastUpdate[titled];
        }

        // Ranked/loved dates (a set's) and last-updated times the bot's cache doesn't have.
        foreach (var id in needed)
        {
            var row = beatmaps.RowOf(id);
            if (row < 0)
            {
                continue;
            }
            var status = beatmaps.Approved[row];
            var undated = (status == Rules.Ranked || status == Rules.Approved || status == Rules.Qualified || status == Rules.Loved) &&
                string.IsNullOrEmpty(beatmaps.ApprovedDate[row]);
            var setDate = undated ? cache.SetDate(beatmaps.SetId[row]) : null;
            var updated = string.IsNullOrEmpty(beatmaps.LastUpdate[row]) ? cache.MapDate(id) : null;
            if (!string.IsNullOrEmpty(setDate))
            {
                beatmaps.ApprovedDate[row] = setDate;
            }
            if (!string.IsNullOrEmpty(updated))
            {
                beatmaps.LastUpdate[row] = updated;
            }
        }

        // Converts neither cache has a catch star rating for show the bot's value until one is fetched.
        var withoutCatch = 0;
        foreach (var id in needed)
        {
            var row = beatmaps.RowOf(id);
            if (row < 0 || beatmaps.HasCatchDifficulty(row))
            {
                continue;
            }
            if (cache.Catch.TryGetValue(id, out var c) && c.Stars is double stars && stars != 0)
            {
                beatmaps.Stars[row] = stars;
                beatmaps.StarsNull[row] = false;
                if (c.Combo is double combo)
                {
                    beatmaps.MaxCombo[row] = combo;
                }
                beatmaps.CatchDifficulty[row] = true;
            }
            else
            {
                withoutCatch++;
            }
        }
        if (withoutCatch > 0)
        {
            log($"  {withoutCatch} converts have no catch star rating yet (the bot's cache or --fetch-titles fills them in)");
        }
    }

    /// <summary>
    /// The last official pp each player had before osu! stopped reporting it, from their file's git history (source.mjs
    /// loadPastOfficial): the newest version with pp > 0 and that commit's time.
    /// </summary>
    private static Dictionary<int, PastOfficial> LoadPastOfficial(string root, List<int> ids)
    {
        var found = new Dictionary<int, PastOfficial>();
        foreach (var id in ids)
        {
            string log;
            try
            {
                log = Git(root, "log", "--format=%H %ct", "--", $"Users/{id}.json");
            }
            catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                return found;
            }
            foreach (var line in log.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var parts = line.Split(' ');
                JsNode raw;
                try
                {
                    raw = JsNode.Parse(Git(root, "show", $"{parts[0]}:Users/{id}.json"));
                }
                catch (Exception e) when (e is InvalidOperationException or System.Text.Json.JsonException)
                {
                    continue;
                }
                if (raw["pp_raw"].ToNumber() > 0)
                {
                    double? Nullable(JsNode v) => v.IsNullish ? null : v.ToNumber();
                    found[id] = new PastOfficial(raw["pp_raw"].Number, Nullable(raw["pp_rank"]), Nullable(raw["pp_country_rank"]), double.Parse(parts[1]));
                    break;
                }
            }
        }
        return found;
    }

    private static string Git(string root, params string[] args)
    {
        var info = new ProcessStartInfo("git") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, StandardOutputEncoding = Encoding.UTF8 };
        info.ArgumentList.Add("-C");
        info.ArgumentList.Add(root);
        foreach (var a in args)
        {
            info.ArgumentList.Add(a);
        }
        using var p = Process.Start(info) ?? throw new InvalidOperationException("git didn't start");
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        if (p.ExitCode != 0)
        {
            throw new InvalidOperationException($"git {args[0]} failed");
        }
        return output;
    }
}
