using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using PtCatch.Engine.Ingest;
using PtCatch.Engine.Js;

namespace PtCatch.Engine.Osu;

/// <summary>
/// The osu! API lookups the exporter makes with the bot's own osu! app (tools/lib/osu-api.mjs): titles for maps the bot
/// only knows by id, and the catch star rating of converts. Results go into the exporter's cache (state/beatmaps.json),
/// so each map is asked for once and later runs work offline. One request a second, well under osu!'s 60 a minute,
/// and the bot shares this app's rate limit.
/// </summary>
public sealed class OsuApi
{
    private const string Api = "https://osu.ppy.sh";
    private const int Batch = 50; // GET /api/v2/beatmaps takes at most 50 ids
    private static readonly Dictionary<string, int> Modes = new() { ["osu"] = 0, ["taiko"] = 1, ["fruits"] = 2, ["mania"] = 3 };

    private readonly HttpClient http;
    private readonly (string Id, string Secret) credentials;
    private readonly Action<string> log;
    private readonly TimeSpan pause;
    private string bearer;

    public OsuApi(HttpClient http, (string Id, string Secret) credentials, Action<string> log, TimeSpan? pause = null)
    {
        this.http = http;
        this.credentials = credentials;
        this.log = log ?? (_ => { });
        this.pause = pause ?? TimeSpan.FromSeconds(1);
    }

    /// <summary>
    /// osu! credentials: OSU_CLIENT_ID/OSU_CLIENT_SECRET, else the bot's user-secrets ("Osu:ClientId" or an "Osu"
    /// section), or null.
    /// </summary>
    public static (string Id, string Secret)? FindCredentials()
    {
        var id = Environment.GetEnvironmentVariable("OSU_CLIENT_ID");
        var secret = Environment.GetEnvironmentVariable("OSU_CLIENT_SECRET");
        if (!string.IsNullOrEmpty(id) && !string.IsNullOrEmpty(secret))
        {
            return (id, secret);
        }
        var appData = Environment.GetEnvironmentVariable("APPDATA");
        var file = appData != null
            ? Path.Combine(appData, "Microsoft", "UserSecrets", "pt-ctb-discord-bot", "secrets.json")
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".microsoft", "usersecrets", "pt-ctb-discord-bot", "secrets.json");
        if (!File.Exists(file))
        {
            return null;
        }
        var secrets = JsNode.Parse(File.ReadAllBytes(file));
        var idNode = secrets["Osu:ClientId"].IsNullish ? secrets["Osu"]["ClientId"] : secrets["Osu:ClientId"];
        var secretNode = secrets["Osu:ClientSecret"].IsNullish ? secrets["Osu"]["ClientSecret"] : secrets["Osu:ClientSecret"];
        string Text(JsNode n) => n.IsString ? n.Text : n.IsNumber ? JsMath.ToString(n.Number) : null;
        var (foundId, foundSecret) = (Text(idNode), Text(secretNode));
        return !string.IsNullOrEmpty(foundId) && !string.IsNullOrEmpty(foundSecret) ? (foundId, foundSecret) : null;
    }

    private async Task<string> Token(CancellationToken cancel)
    {
        var body = JsNode.Object().Set("client_id", JsNode.StringToNumber(credentials.Id)).Set("client_secret", credentials.Secret)
            .Set("grant_type", "client_credentials").Set("scope", "public");
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{Api}/oauth/token")
        {
            Content = new StringContent(body.Stringify(), Encoding.UTF8, "application/json"),
        };
        request.Headers.Accept.ParseAdd("application/json");
        using var response = await http.SendAsync(request, cancel);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"osu! token request failed: {(int)response.StatusCode}");
        }
        return JsNode.Parse(await response.Content.ReadAsByteArrayAsync(cancel))["access_token"].Text;
    }

    private async Task<HttpResponseMessage> Send(Func<HttpRequestMessage> make, CancellationToken cancel)
    {
        bearer ??= await Token(cancel);
        var response = await http.SendAsync(Authorised(make()), cancel);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            response.Dispose();
            bearer = await Token(cancel);
            response = await http.SendAsync(Authorised(make()), cancel);
        }
        return response;
    }

    private HttpRequestMessage Authorised(HttpRequestMessage request)
    {
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearer);
        request.Headers.Accept.ParseAdd("application/json");
        return request;
    }

    /// <summary>An API v2 beatmap in the bot's cache shape (osu-api.mjs toRaw); a convert's stars and combo left out.</summary>
    public static JsNode ToRaw(JsNode b)
    {
        var set = b["beatmapset"].IsObject ? b["beatmapset"] : JsNode.Object();
        var mode = b["mode"].IsString && Modes.TryGetValue(b["mode"].Text, out var m) ? (int?)m : null;
        var native = mode == Modes["fruits"];
        JsNode OrNull(JsNode v) => v.IsNullish ? JsNode.NullValue : v;
        return JsNode.Object()
            .Set("beatmap_id", b["id"]).Set("beatmapset_id", b["beatmapset_id"]).Set("artist", set["artist"]).Set("title", set["title"])
            .Set("creator", set["creator"]).Set("version", b["version"])
            .Set("difficultyrating", native ? b["difficulty_rating"] : JsNode.NullValue)
            .Set("diff_approach", b["ar"]).Set("diff_size", b["cs"]).Set("diff_overall", b["accuracy"]).Set("diff_drain", b["drain"])
            .Set("bpm", b["bpm"]).Set("hit_length", b["hit_length"])
            .Set("max_combo", native ? OrNull(b["max_combo"]) : JsNode.NullValue)
            .Set("approved", b["ranked"]).Set("approved_date", OrNull(set["ranked_date"])).Set("last_update", OrNull(b["last_updated"]))
            .Set("playmode", mode ?? 0).Set("playcount", b["playcount"]).Set("favourite_count", set["favourite_count"]);
    }

    /// <summary>
    /// Fetches every id not already cached or known to be gone (osu-api.mjs fetchMissing), saving as it goes. Returns
    /// how many maps it found.
    /// </summary>
    public async Task<int> FetchMissing(IEnumerable<int> ids, OsuCache cache, string cacheFile, CancellationToken cancel = default)
    {
        var todo = ids.Distinct().Where(id => !cache.HasMap(id) && !cache.IsGone(id)).OrderBy(id => id).ToList();
        if (todo.Count == 0)
        {
            return 0;
        }
        log($"  fetching {todo.Count} beatmaps from the osu! API ({(todo.Count + Batch - 1) / Batch} requests)…");
        var fetched = 0;
        for (var i = 0; i < todo.Count; i += Batch)
        {
            var batch = todo.Skip(i).Take(Batch).ToList();
            var url = $"{Api}/api/v2/beatmaps?{string.Join("&", batch.Select(id => $"ids[]={id}"))}";
            using var response = await Send(() => new HttpRequestMessage(HttpMethod.Get, url), cancel);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                log("  rate limited, waiting a minute");
                await Task.Delay(TimeSpan.FromMinutes(1), cancel);
                i -= Batch;
                continue;
            }
            if (!response.IsSuccessStatusCode)
            {
                throw new HttpRequestException($"osu! beatmaps request failed: {(int)response.StatusCode}");
            }
            var found = new HashSet<int>();
            foreach (var b in JsNode.Parse(await response.Content.ReadAsByteArrayAsync(cancel))["beatmaps"].Items)
            {
                cache.AddMap(ToRaw(b));
                found.Add((int)b["id"].ToNumber());
                fetched++;
            }
            foreach (var id in batch.Where(id => !found.Contains(id)))
            {
                cache.AddGone(id);
            }
            if (i / Batch % 20 == 19)
            {
                cache.Save(cacheFile);
                log($"  …{Math.Min(i + Batch, todo.Count)}/{todo.Count}");
            }
            await Task.Delay(pause, cancel);
        }
        cache.Save(cacheFile);
        return fetched;
    }

    /// <summary>
    /// Fetches the nomod catch star rating and max combo of every id not already in the cache's catch list, one
    /// attributes request each (osu-api.mjs fetchCatchDifficulty). Stops at a rate limit; the rest wait for the next run.
    /// </summary>
    public async Task<int> FetchCatchDifficulty(IEnumerable<int> ids, OsuCache cache, string cacheFile, CancellationToken cancel = default)
    {
        var todo = ids.Distinct().Where(id => !cache.HasCatch(id)).OrderBy(id => id).ToList();
        if (todo.Count == 0)
        {
            return 0;
        }
        log($"  fetching the catch star rating of {todo.Count} converts from the osu! API…");
        var fetched = 0;
        for (var i = 0; i < todo.Count; i++)
        {
            var id = todo[i];
            using var response = await Send(() => new HttpRequestMessage(HttpMethod.Post, $"{Api}/api/v2/beatmaps/{id}/attributes")
            {
                Content = new StringContent("{\"ruleset_id\":2,\"mods\":0}", Encoding.UTF8, "application/json"),
            }, cancel);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                log($"  rate limited after {i} requests; the rest wait for the next export");
                break;
            }
            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.UnprocessableEntity)
            {
                cache.AddCatch(id, JsNode.Object().Set("stars", JsNode.NullValue));
            }
            else if (!response.IsSuccessStatusCode)
            {
                throw new HttpRequestException($"osu! attributes request failed: {(int)response.StatusCode}");
            }
            else
            {
                var attributes = JsNode.Parse(await response.Content.ReadAsByteArrayAsync(cancel))["attributes"];
                // max_combo is 0 for maps osu! hasn't processed for a leaderboard (graveyard): "unknown", not 0.
                var combo = attributes["max_combo"];
                cache.AddCatch(id, JsNode.Object()
                    .Set("stars", attributes["star_rating"].IsNullish ? JsNode.NullValue : attributes["star_rating"])
                    .Set("combo", combo.Truthy ? combo : JsNode.NullValue));
                fetched++;
            }
            if (i % 50 == 49)
            {
                cache.Save(cacheFile);
                log($"  …{i + 1}/{todo.Count}");
            }
            await Task.Delay(pause, cancel);
        }
        cache.Save(cacheFile);
        return fetched;
    }
}
