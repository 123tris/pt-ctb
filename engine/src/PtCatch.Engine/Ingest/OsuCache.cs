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

    // What this run added from the osu! API, kept as osu-api.mjs toRaw made them so the file stays the Node exporter's.
    private readonly SortedDictionary<int, JsNode> addedMaps = new();
    private readonly Dictionary<int, JsNode> addedCatch = new();

    public bool IsGone(int id) => Gone.Contains(id);

    /// <summary>A map from the osu! API, in the cache's raw shape (osu-api.mjs toRaw); <see cref="Rebuild"/> adds it to <see cref="Maps"/>.</summary>
    public void AddMap(JsNode raw)
    {
        addedMaps[(int)raw["beatmap_id"].ToNumber()] = raw;
    }

    public void AddGone(int id) => Gone.Add(id);

    /// <summary>A convert's catch star rating and combo from the attributes endpoint (stars null when osu! has none).</summary>
    public void AddCatch(int id, JsNode value)
    {
        addedCatch[id] = value;
        double? Num(JsNode n) => n.IsNullish ? null : n.ToNumber();
        Catch[id] = (Num(value["stars"]), Num(value["combo"]));
    }

    public bool HasCatch(int id) => Catch.ContainsKey(id);

    public bool HasMap(int id) => Maps.RowOf(id) >= 0 || addedMaps.ContainsKey(id);

    /// <summary>Puts the maps added from the API into <see cref="Maps"/>, keeping it in ascending id order.</summary>
    public void Rebuild()
    {
        if (addedMaps.Count == 0)
        {
            return;
        }
        var added = new Beatmaps(addedMaps.Count);
        foreach (var (id, raw) in addedMaps)
        {
            var row = new BeatmapReader.RowFields();
            row.Reset();
            var reader = new Utf8JsonReader(Encoding.UTF8.GetBytes(raw.Stringify()));
            reader.Read();
            BeatmapReader.ReadObject(ref reader, ref row);
            row.Id ??= id;
            row.Store(added, added.Upsert(id));
        }
        var all = new List<(int Id, Beatmaps Table, int Row)>(Maps.Count + added.Count);
        for (var r = 0; r < Maps.Count; r++)
        {
            if (added.RowOf(Maps.Id[r]) < 0)
            {
                all.Add((Maps.Id[r], Maps, r));
            }
        }
        for (var r = 0; r < added.Count; r++)
        {
            all.Add((added.Id[r], added, r));
        }
        all.Sort((a, b) => a.Id.CompareTo(b.Id));
        var rebuilt = new Beatmaps(all.Count);
        foreach (var (_, table, row) in all)
        {
            rebuilt.CopyFrom(table, row);
        }
        Maps = rebuilt;
    }

    private static bool HasCatchDifficulty(JsNode raw) => raw["playmode"].ToNumber() == 2 || (raw["catch_difficulty"].IsBool && raw["catch_difficulty"].BoolValue);

    /// <summary>
    /// Writes the cache back exactly as osu-api.mjs saveCache does: the file as it was, with loadCache's migration and
    /// this run's additions, every list sorted by id.
    /// </summary>
    public void Save(string file)
    {
        var root = File.Exists(file) ? JsNode.Parse(File.ReadAllBytes(file)) : JsNode.Object();
        var maps = root["maps"].IsObject ? root["maps"] : JsNode.Object();
        foreach (var (_, raw) in maps.Props)
        {
            if (raw.IsObject && !HasCatchDifficulty(raw) && (!raw["difficultyrating"].IsNullish || !raw["max_combo"].IsNullish))
            {
                raw.Set("difficultyrating", JsNode.NullValue).Set("max_combo", JsNode.NullValue);
            }
        }
        foreach (var (id, raw) in addedMaps)
        {
            maps.Set(id.ToString(), raw);
        }
        var catchNode = root["catch"].IsObject ? root["catch"] : JsNode.Object();
        foreach (var (id, value) in addedCatch)
        {
            catchNode.Set(id.ToString(), value);
        }
        var dates = root["dates"].IsObject ? root["dates"] : JsNode.Object();
        var sorted = JsNode.Object()
            .Set("maps", ById(maps))
            .Set("gone", Numbers(Gone.Distinct().OrderBy(x => x)))
            .Set("catch", ById(catchNode))
            .Set("dates", JsNode.Object().Set("sets", ById(dates["sets"])).Set("maps", ById(dates["maps"])));
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file)));
        File.WriteAllText(file + ".tmp", sorted.Stringify(), new UTF8Encoding(false));
        File.Move(file + ".tmp", file, true);
    }

    /// <summary><c>Object.fromEntries(Object.entries(o).sort((a, b) => a[0] - b[0]))</c>.</summary>
    private static JsNode ById(JsNode o)
    {
        var entries = JsNode.OrderedProps(o).ToList();
        JsSort.Stable(entries, (a, b) => JsSort.Sign(JsNode.StringToNumber(a.Key) - JsNode.StringToNumber(b.Key)));
        var result = JsNode.Object();
        foreach (var (k, v) in entries)
        {
            result.Set(k, v);
        }
        return result;
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
