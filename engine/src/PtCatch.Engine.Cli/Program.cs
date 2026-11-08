using System;
using System.IO;
using System.Linq;
using PtCatch.Engine.Export;

namespace PtCatch.Engine.Cli;

/// <summary>
/// ptcatch-engine: the site's data engine.
///
///   ptcatch-engine export [--data &lt;bot data folder&gt;] [--country PT] [--out &lt;folder&gt;] [--repo &lt;site repo&gt;]
///                         [--now &lt;unix seconds&gt;] [--fetch-titles] [--offline] [--packs] [--timings]
///   ptcatch-engine gen-ts [--out &lt;file&gt;] [--check]
///
/// export writes what tools/export.mjs writes, byte for byte: the site's JSON under data/ (or --out, a trial export
/// with its own state), meta.json listing every file's hash, and the exporter's state; --packs adds the binary packs.
/// gen-ts writes web/src/gen/packs.ts, the web client's types for the packs, from the engine's pack schemas.
/// </summary>
public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length == 0 || args[0] is "-h" or "--help")
        {
            Console.WriteLine("usage: ptcatch-engine export [--data <folder>] [--country PT] [--out <folder>] [--repo <folder>] [--now <unix>] [--fetch-titles] [--offline] [--packs] [--timings]");
            Console.WriteLine("       ptcatch-engine gen-ts [--out <file>] [--check]");
            return args.Length == 0 ? 2 : 0;
        }
        string Arg(string name, string fallback)
        {
            var i = Array.IndexOf(args, $"--{name}");
            return i > 0 && i + 1 < args.Length ? args[i + 1] : fallback;
        }
        switch (args[0])
        {
            case "export":
            {
                var repo = Path.GetFullPath(Arg("repo", FindRepo()));
                var options = new ExportOptions
                {
                    RepoRoot = repo,
                    DataRoot = Path.GetFullPath(Arg("data", Path.Combine(repo, "..", "PT-CTB-Bot-Data"))),
                    Country = Arg("country", "PT"),
                    OutDir = Path.GetFullPath(Arg("out", Path.Combine(repo, "data"))),
                    Now = Arg("now", null) is string now ? double.Parse(now) : null,
                    Timings = args.Contains("--timings"),
                    FetchTitles = args.Contains("--fetch-titles"),
                    Offline = args.Contains("--offline"),
                    Packs = args.Contains("--packs"),
                };
                var result = Exporter.Run(options, Console.WriteLine);
                if (options.Timings)
                {
                    foreach (var (stage, ms) in result.Timings)
                    {
                        Console.WriteLine($"  {stage,-28} {ms,9:F1} ms");
                    }
                    Console.WriteLine($"  GC: {GC.GetTotalAllocatedBytes() / 1e9:F2} GB allocated, gen0/1/2 {GC.CollectionCount(0)}/{GC.CollectionCount(1)}/{GC.CollectionCount(2)}, " +
                        $"paused {GC.GetTotalPauseDuration().TotalMilliseconds:F0} ms, peak working set {Environment.WorkingSet / 1e6:F0} MB, " +
                        $"CPU {System.Diagnostics.Process.GetCurrentProcess().TotalProcessorTime.TotalMilliseconds:F0} ms");
                }
                return 0;
            }
            case "gen-ts":
            {
                // web/src/gen/packs.ts from the pack schemas; --check only says whether it's current (for CI).
                var file = Path.GetFullPath(Arg("out", Path.Combine(Arg("repo", FindRepo()), "web", "src", "gen", "packs.ts")));
                var text = PtCatch.Engine.Packs.GenTs.Generate();
                var current = File.Exists(file) && File.ReadAllText(file).ReplaceLineEndings("\n") == text;
                if (args.Contains("--check"))
                {
                    Console.WriteLine(current ? $"{file} is current" : $"{file} is out of date: run ptcatch-engine gen-ts");
                    return current ? 0 : 1;
                }
                if (!current)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    File.WriteAllText(file, text);
                }
                Console.WriteLine(current ? $"{file} was already current" : $"wrote {file}");
                return 0;
            }
            default:
                Console.Error.WriteLine($"unknown command: {args[0]}");
                return 2;
        }
    }

    /// <summary>The site repo: the nearest folder up from here with publish.ps1 and assets/ in it.</summary>
    private static string FindRepo()
    {
        for (var dir = new DirectoryInfo(Directory.GetCurrentDirectory()); dir != null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "publish.ps1")) && Directory.Exists(Path.Combine(dir.FullName, "assets")))
            {
                return dir.FullName;
            }
        }
        return Directory.GetCurrentDirectory();
    }
}
