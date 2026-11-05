using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using PtCatch.Engine.Js;
using SkiaSharp;

namespace PtCatch.Engine.Osu;

/// <summary>
/// Small copies of the tracked players' osu! avatars, published with the data: avatars/{id}-64.webp and -128.webp
/// (tools/lib/avatars.mjs). osu!'s originals (https://a.ppy.sh/{id}) are 256 px images of 17-75 KB, most of a
/// leaderboard page's bytes; these are 1-5 KB. a.ppy.sh is osu!'s image CDN, not the API, so this doesn't count against
/// the bot's rate limit. Each avatar is re-checked once a day with a conditional request (its ETag and Last-Modified, in
/// the state), so an unchanged one answers 304 and keeps its file, bytes and name. A fetch that fails keeps the
/// previous thumbnails; a player with none is left out, and the site falls back to a.ppy.sh for them.
/// </summary>
public static class Avatars
{
    public static readonly int[] Sizes = [64, 128];
    private const double RecheckMs = 24 * 60 * 60 * 1000;
    private const int Parallel = 4;

    public sealed class Result
    {
        public readonly List<(string Name, byte[] Bytes)> Files = new();
        public JsNode State = JsNode.Object();
        public int Fetched;
        public int Unchanged;
        public int Failed;
        public int Kept;
        public int Missing;
    }

    public static string[] ThumbNames(int id) => Sizes.Select(px => $"avatars/{id}-{px}.webp").ToArray();

    /// <summary>The thumbnails already there, in the order of <paramref name="ids"/>; nothing is fetched or made.</summary>
    public static Result Keep(List<int> ids, string outDir, JsNode state)
    {
        var result = new Result();
        foreach (var id in ids)
        {
            var files = OnDisk(id, outDir);
            if (files == null)
            {
                result.Missing++;
                continue;
            }
            result.Files.AddRange(files);
            var saved = state[id.ToString()];
            result.State.Set(id.ToString(), saved.Truthy ? saved : JsNode.Object().Set("checked", 0));
            result.Kept++;
        }
        return result;
    }

    private static List<(string, byte[])> OnDisk(int id, string outDir)
    {
        var names = ThumbNames(id);
        if (!names.All(n => File.Exists(Path.Combine(outDir, n))))
        {
            return null;
        }
        return names.Select(n => (n, File.ReadAllBytes(Path.Combine(outDir, n)))).ToList();
    }

    /// <summary>
    /// Brings the thumbnails for <paramref name="ids"/> up to date in <paramref name="outDir"/> (avatars.mjs
    /// updateAvatars). <paramref name="state"/> is the previous run's { id: { etag, modified, checked } }; the result
    /// lists every player's thumbnails in the order of <paramref name="ids"/>. Never throws for a single avatar.
    /// </summary>
    public static async Task<Result> Update(List<int> ids, string outDir, JsNode state, HttpClient http, Action<string> log,
        double? nowMs = null, CancellationToken cancel = default)
    {
        var now = nowMs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var result = new Result();
        var files = new Dictionary<int, List<(string, byte[])>>();
        var next = new Dictionary<int, JsNode>();
        var gate = new object();
        var due = new List<int>();
        foreach (var id in ids)
        {
            var saved = state[id.ToString()];
            var fresh = saved.Truthy && now - saved["checked"].ToNumber() < RecheckMs;
            var kept = fresh ? OnDisk(id, outDir) : null;
            if (kept != null)
            {
                files[id] = kept;
                next[id] = saved;
                result.Kept++;
            }
            else
            {
                due.Add(id);
            }
        }

        var cursor = -1;
        async Task Worker()
        {
            while (true)
            {
                var at = Interlocked.Increment(ref cursor);
                if (at >= due.Count)
                {
                    return;
                }
                var id = due[at];
                var saved = state[id.ToString()];
                var onDisk = OnDisk(id, outDir);
                try
                {
                    using var request = new HttpRequestMessage(HttpMethod.Get, $"https://a.ppy.sh/{id}");
                    if (onDisk != null && saved["etag"].IsString)
                    {
                        request.Headers.TryAddWithoutValidation("If-None-Match", saved["etag"].Text);
                    }
                    if (onDisk != null && saved["modified"].IsString)
                    {
                        request.Headers.TryAddWithoutValidation("If-Modified-Since", saved["modified"].Text);
                    }
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
                    timeout.CancelAfter(TimeSpan.FromSeconds(15));
                    using var response = await http.SendAsync(request, timeout.Token);
                    if (response.StatusCode == HttpStatusCode.NotModified && onDisk != null)
                    {
                        var checkedNow = JsNode.Object();
                        foreach (var (k, v) in saved.Props)
                        {
                            checkedNow.Set(k, v);
                        }
                        checkedNow.Set("checked", now);
                        lock (gate)
                        {
                            files[id] = onDisk;
                            next[id] = checkedNow;
                            result.Unchanged++;
                        }
                        continue;
                    }
                    if (!response.IsSuccessStatusCode)
                    {
                        throw new HttpRequestException($"HTTP {(int)response.StatusCode}");
                    }
                    var input = await response.Content.ReadAsByteArrayAsync(timeout.Token);
                    var made = new List<(string, byte[])>();
                    var names = ThumbNames(id);
                    for (var i = 0; i < Sizes.Length; i++)
                    {
                        var bytes = Thumbnail(input, Sizes[i]);
                        WriteIfChanged(Path.Combine(outDir, names[i]), bytes);
                        made.Add((names[i], bytes));
                    }
                    // The headers as osu! sent them, as fetch's headers.get() gives them.
                    var etag = response.Headers.TryGetValues("ETag", out var etags) ? string.Join(", ", etags) : null;
                    var modified = response.Content.Headers.TryGetValues("Last-Modified", out var dates) ? string.Join(", ", dates) : null;
                    lock (gate)
                    {
                        files[id] = made;
                        next[id] = JsNode.Object().Set("etag", JsNode.Str(etag)).Set("modified", JsNode.Str(modified)).Set("checked", now);
                        result.Fetched++;
                    }
                }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException or InvalidDataException)
                {
                    log?.Invoke($"  avatar {id}: {e.Message}{(onDisk != null ? " (keeping the previous one)" : " (the site uses a.ppy.sh)")}");
                    lock (gate)
                    {
                        result.Failed++;
                        // Keep the old ones; try again next run (checked unchanged, so it's still due).
                        if (onDisk != null)
                        {
                            files[id] = onDisk;
                            if (saved.Truthy)
                            {
                                next[id] = saved;
                            }
                        }
                    }
                }
            }
        }
        await Task.WhenAll(Enumerable.Range(0, Math.Min(Parallel, due.Count)).Select(_ => Worker()));

        // In the order of ids, not the order fetches finished, so an unchanged run lists them the same way in meta.json.
        foreach (var id in ids)
        {
            if (files.TryGetValue(id, out var list))
            {
                result.Files.AddRange(list);
            }
        }
        foreach (var id in next.Keys.OrderBy(id => id))
        {
            result.State.Set(id.ToString(), next[id]);
        }
        return result;
    }

    /// <summary>
    /// A <paramref name="px"/>×<paramref name="px"/> WebP thumbnail, cropped to a centred square as the site's
    /// <c>object-fit: cover</c> does; an animated avatar gives its first frame.
    /// </summary>
    public static byte[] Thumbnail(byte[] input, int px)
    {
        using var bitmap = SKBitmap.Decode(input) ?? throw new InvalidDataException("not an image osu! sent");
        var scale = Math.Max((float)px / bitmap.Width, (float)px / bitmap.Height);
        var w = bitmap.Width * scale;
        var h = bitmap.Height * scale;
        using var surface = SKSurface.Create(new SKImageInfo(px, px, SKColorType.Rgba8888, SKAlphaType.Premul));
        var canvas = surface.Canvas;
        canvas.Clear(SKColors.Transparent);
        using var image = SKImage.FromBitmap(bitmap);
        canvas.DrawImage(image, new SKRect((px - w) / 2, (px - h) / 2, (px + w) / 2, (px + h) / 2), new SKSamplingOptions(SKCubicResampler.Mitchell));
        using var snapshot = surface.Snapshot();
        using var data = snapshot.Encode(SKEncodedImageFormat.Webp, 82) ?? throw new InvalidDataException("WebP encoding failed");
        return data.ToArray();
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
}
