using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using PtCatch.Engine.Js;
using PtCatch.Engine.World;

namespace PtCatch.Engine.Ingest;

/// <summary>
/// The exporter's own osu! API cache (state/beatmaps.json, tools/lib/osu-api.mjs): maps the bot only knows by id, maps
/// osu! no longer has, the catch star rating of converts, and ranked/updated dates.
/// </summary>
public sealed class OsuCache
{
    /// <summary>The cached maps, in ascending id order (how JavaScript lists an object's integer keys).</summary>
    public Beatmaps Maps = new(16);
    public readonly List<double> Gone = new();
    public readonly Dictionary<int, (double? Stars, double? Combo)> Catch = new();
    public readonly Dictionary<int, string> SetDates = new();
    public readonly Dictionary<int, string> MapDates = new();
    /// <summary>Converts whose osu!standard star rating was dropped on load.</summary>
    public int Migrated;

    public string SetDate(int set) => SetDates.TryGetValue(set, out var d) ? d : null;

    public string MapDate(int id) => MapDates.TryGetValue(id, out var d) ? d : null;

    public static OsuCache Load(string file)
    {
        var cache = new OsuCache();
        if (!File.Exists(file))
        {
            return cache;
        }
        var json = File.ReadAllBytes(file).AsSpan();
        if (json.StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF]))
        {
            json = json[3..];
        }
        var reader = new Utf8JsonReader(json, new JsonReaderOptions { MaxDepth = 64 });
        reader.Read();
        var rows = new List<(uint Key, BeatmapReader.RowFields Row)>();
        while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
        {
            var name = reader.GetString();
            reader.Read();
            switch (name)
            {
                case "maps" when reader.TokenType == JsonTokenType.StartObject:
                    while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
                    {
                        var key = reader.GetString();
                        reader.Read();
                        if (reader.TokenType != JsonTokenType.StartObject)
                        {
                            reader.Skip();
                            continue;
                        }
                        var row = new BeatmapReader.RowFields();
                        row.Reset();
                        BeatmapReader.ReadObject(ref reader, ref row);
                        JsNode.IsIndexKey(key, out var index);
                        row.Id ??= (int)index;
                        rows.Add((index, row));
                    }
                    break;
                case "gone" when reader.TokenType == JsonTokenType.StartArray:
                    foreach (var id in JsNode.Read(ref reader).Items)
                    {
                        cache.Gone.Add(id.ToNumber());
                    }
                    break;
                case "catch" when reader.TokenType == JsonTokenType.StartObject:
                    foreach (var (k, v) in JsNode.Read(ref reader).Props)
                    {
                        double? Num(JsNode n) => n.IsNullish ? null : n.ToNumber();
                        cache.Catch[(int)JsNode.StringToNumber(k)] = (Num(v["stars"]), Num(v["combo"]));
                    }
                    break;
                case "dates" when reader.TokenType == JsonTokenType.StartObject:
                    var dates = JsNode.Read(ref reader);
                    foreach (var (k, v) in dates["sets"].Props)
                    {
                        cache.SetDates[(int)JsNode.StringToNumber(k)] = v.Text;
                    }
                    foreach (var (k, v) in dates["maps"].Props)
                    {
                        cache.MapDates[(int)JsNode.StringToNumber(k)] = v.Text;
                    }
                    break;
                default:
                    reader.Skip();
                    break;
            }
        }
        rows.Sort((a, b) => a.Key.CompareTo(b.Key));
        cache.Maps = new Beatmaps(Math.Max(16, rows.Count));
        foreach (var (_, row) in rows)
        {
            var r = cache.Maps.Upsert(row.Id.Value);
            row.Store(cache.Maps, r);
            // A convert's osu!standard star rating and combo are never kept (osu-api.mjs loadCache).
            if (!cache.Maps.HasCatchDifficulty(r) && (!cache.Maps.StarsNull[r] || cache.Maps.MaxCombo[r] != 0))
            {
                cache.Maps.Stars[r] = 0;
                cache.Maps.StarsNull[r] = true;
                cache.Maps.MaxCombo[r] = 0;
                cache.Migrated++;
            }
        }
        return cache;
    }

    /// <summary>Writes the cache back in osu-api.mjs saveCache's form (only needed after a migration or a fetch).</summary>
    public void Save(string file)
    {
        var maps = JsNode.Object();
        for (var r = 0; r < Maps.Count; r++)
        {
            var m = JsNode.Object()
                .Set("beatmap_id", Maps.Id[r]).Set("beatmapset_id", Maps.SetId[r]).Set("artist", Maps.Artist[r]).Set("title", Maps.Title[r])
                .Set("creator", Maps.Creator[r]).Set("version", Maps.Version[r])
                .Set("difficultyrating", Maps.StarsNull[r] ? JsNode.NullValue : JsNode.Num(Maps.Stars[r]))
                .Set("diff_approach", Maps.Ar[r]).Set("diff_size", Maps.Cs[r]).Set("diff_overall", Maps.Od[r]).Set("diff_drain", Maps.Hp[r])
                .Set("bpm", Maps.Bpm[r]).Set("hit_length", Maps.HitLength[r])
                .Set("max_combo", Maps.StarsNull[r] && Maps.MaxCombo[r] == 0 ? JsNode.NullValue : JsNode.Num(Maps.MaxCombo[r]))
                .Set("approved", Maps.Approved[r]).Set("approved_date", Maps.ApprovedDate[r]).Set("last_update", Maps.LastUpdate[r])
                .Set("playmode", Maps.Mode[r]).Set("playcount", Maps.Playcount[r]).Set("favourite_count", Maps.Favourites[r]);
            maps.Set(Maps.Id[r].ToString(), m);
        }
        var catchNode = JsNode.Object();
        foreach (var (id, (stars, combo)) in Catch.OrderBy(kv => kv.Key))
        {
            catchNode.Set(id.ToString(), JsNode.Object().Set("stars", JsNode.NumOrNull(stars)).Set("combo", JsNode.NumOrNull(combo)));
        }
        var sets = JsNode.Object();
        foreach (var (id, d) in SetDates.OrderBy(kv => kv.Key))
        {
            sets.Set(id.ToString(), d);
        }
        var mapDates = JsNode.Object();
        foreach (var (id, d) in MapDates.OrderBy(kv => kv.Key))
        {
            mapDates.Set(id.ToString(), d);
        }
        var root = JsNode.Object().Set("maps", maps).Set("gone", Numbers(Gone.Distinct().OrderBy(x => x)))
            .Set("catch", catchNode).Set("dates", JsNode.Object().Set("sets", sets).Set("maps", mapDates));
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file)));
        File.WriteAllText(file + ".tmp", root.Stringify(), new UTF8Encoding(false));
        File.Move(file + ".tmp", file, true);
    }

    private static JsNode Numbers(IEnumerable<double> ids)
    {
        var a = JsNode.Array();
        foreach (var id in ids)
        {
            a.Add(id);
        }
        return a;
    }
}

/// <summary>The players' avatar thumbnails in the output folder (tools/lib/avatars.mjs, without making new ones).</summary>
public static class Avatars
{
    public sealed class Result
    {
        public readonly List<(string Name, byte[] Bytes)> Files = new();
        public JsNode State = JsNode.Object();
        public int Kept;
        public int Missing;
    }

    public static string[] ThumbNames(int id) => [$"avatars/{id}-64.webp", $"avatars/{id}-128.webp"];

    /// <summary>The thumbnails already there, in the order of <paramref name="ids"/>; a player with none is left out.</summary>
    public static Result Keep(List<int> ids, string outDir, JsNode state)
    {
        var result = new Result();
        foreach (var id in ids)
        {
            var names = ThumbNames(id);
            if (!names.All(n => File.Exists(Path.Combine(outDir, n))))
            {
                result.Missing++;
                continue;
            }
            foreach (var n in names)
            {
                result.Files.Add((n, File.ReadAllBytes(Path.Combine(outDir, n))));
            }
            var saved = state[id.ToString()];
            result.State.Set(id.ToString(), saved.Truthy ? saved : JsNode.Object().Set("checked", 0));
            result.Kept++;
        }
        return result;
    }
}
