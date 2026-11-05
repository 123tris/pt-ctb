using System.IO;
using PtCatch.Engine.Ingest;
using PtCatch.Engine.Js;
using PtCatch.Engine.Osu;
using SkiaSharp;
using Xunit;

namespace PtCatch.Engine.Tests;

/// <summary>The osu! API cache and the avatar thumbnails, without the network.</summary>
public sealed class OsuTests
{
    [Fact]
    public void An_API_beatmap_takes_the_cache_shape_and_a_convert_keeps_no_stars()
    {
        var b = JsNode.Parse("""
            {"id":1,"beatmapset_id":2,"mode":"osu","version":"Insane","difficulty_rating":5.5,"ar":9,"cs":4,"accuracy":8,
             "drain":6,"bpm":200,"hit_length":143,"max_combo":900,"ranked":1,"last_updated":"2014-05-18T17:22:09Z","playcount":10,
             "beatmapset":{"artist":"A","title":"T","creator":"C","ranked_date":"2014-05-20T00:00:00Z","favourite_count":3}}
            """);
        // The key order and values of osu-api.mjs toRaw: the Node exporter reads this cache too.
        Assert.Equal(
            "{\"beatmap_id\":1,\"beatmapset_id\":2,\"artist\":\"A\",\"title\":\"T\",\"creator\":\"C\",\"version\":\"Insane\"," +
            "\"difficultyrating\":null,\"diff_approach\":9,\"diff_size\":4,\"diff_overall\":8,\"diff_drain\":6,\"bpm\":200," +
            "\"hit_length\":143,\"max_combo\":null,\"approved\":1,\"approved_date\":\"2014-05-20T00:00:00Z\"," +
            "\"last_update\":\"2014-05-18T17:22:09Z\",\"playmode\":0,\"playcount\":10,\"favourite_count\":3}",
            OsuApi.ToRaw(b).Stringify());
        b.Set("mode", "fruits");
        var native = OsuApi.ToRaw(b);
        Assert.Equal(5.5, native["difficultyrating"].Number);
        Assert.Equal(900, native["max_combo"].Number);
        Assert.Equal(2, native["playmode"].Number);
    }

    [Fact]
    public void Added_maps_join_the_cache_in_id_order_and_save_sorted()
    {
        var dir = Directory.CreateTempSubdirectory();
        try
        {
            var file = Path.Combine(dir.FullName, "beatmaps.json");
            File.WriteAllText(file, "{\"maps\":{\"30\":{\"beatmap_id\":30,\"title\":\"Old\",\"playmode\":0,\"difficultyrating\":4.2}},\"gone\":[9,9]}");
            var cache = OsuCache.Load(file);
            Assert.Equal(1, cache.Migrated); // a convert's osu!standard stars are dropped
            cache.AddMap(JsNode.Parse("{\"beatmap_id\":40,\"title\":\"New\",\"playmode\":2}"));
            cache.AddMap(JsNode.Parse("{\"beatmap_id\":20,\"title\":\"First\",\"playmode\":2}"));
            cache.AddGone(5);
            cache.AddCatch(30, JsNode.Object().Set("stars", 3.1).Set("combo", JsNode.NullValue));
            cache.Rebuild();
            Assert.Equal([20, 30, 40], cache.Maps.Id[..cache.Maps.Count]);
            cache.Save(file);
            Assert.Equal(
                "{\"maps\":{\"20\":{\"beatmap_id\":20,\"title\":\"First\",\"playmode\":2},\"30\":{\"beatmap_id\":30,\"title\":\"Old\"," +
                "\"playmode\":0,\"difficultyrating\":null,\"max_combo\":null},\"40\":{\"beatmap_id\":40,\"title\":\"New\",\"playmode\":2}}," +
                "\"gone\":[5,9],\"catch\":{\"30\":{\"stars\":3.1,\"combo\":null}},\"dates\":{\"sets\":{},\"maps\":{}}}",
                File.ReadAllText(file));
        }
        finally
        {
            dir.Delete(true);
        }
    }

    [Fact]
    public void A_thumbnail_is_a_square_webp_cropped_from_the_middle()
    {
        using var source = new SKBitmap(300, 200);
        using (var canvas = new SKCanvas(source))
        {
            canvas.Clear(SKColors.Red);
        }
        using var png = SKImage.FromBitmap(source).Encode(SKEncodedImageFormat.Png, 100);
        foreach (var px in Avatars.Sizes)
        {
            var webp = Avatars.Thumbnail(png.ToArray(), px);
            Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(webp, 0, 4));
            using var decoded = SKBitmap.Decode(webp);
            Assert.Equal(px, decoded.Width);
            Assert.Equal(px, decoded.Height);
        }
    }
}
