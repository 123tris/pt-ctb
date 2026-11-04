using System.Collections.Generic;
using System.Text;
using PtCatch.Engine.Export;
using PtCatch.Engine.Js;
using Xunit;

namespace PtCatch.Engine.Tests;

/// <summary>
/// The JavaScript semantics the published files depend on. Every expected value here is what Node (V8) gave for the
/// same input, so a change that passes these and the parity script writes the same bytes as tools/export.mjs.
/// </summary>
public sealed class JsCompatibilityTests
{
    [Theory]
    [InlineData(0.0, "0")]
    [InlineData(1.0, "1")]
    [InlineData(-1.0, "-1")]
    [InlineData(0.1, "0.1")]
    [InlineData(1.5, "1.5")]
    [InlineData(2.675, "2.675")]
    [InlineData(12.34, "12.34")]
    [InlineData(98.9298, "98.9298")]
    [InlineData(1e21, "1e+21")]
    [InlineData(1e-7, "1e-7")]
    [InlineData(1.5e-7, "1.5e-7")]
    [InlineData(0.000001, "0.000001")]
    [InlineData(7.2e-5, "0.000072")]
    [InlineData(123456789012345680000.0, "123456789012345680000")]
    [InlineData(0.30000000000000004, "0.30000000000000004")]
    [InlineData(5e-324, "5e-324")]
    [InlineData(1.7976931348623157e308, "1.7976931348623157e+308")]
    [InlineData(9007199254740993.0, "9007199254740992")]
    [InlineData(1062.98, "1062.98")]
    [InlineData(416.6667, "416.6667")]
    [InlineData(33.333333333333336, "33.333333333333336")]
    [InlineData(99.99999999999999, "99.99999999999999")]
    [InlineData(1000000000000000.5, "1000000000000000.5")]
    [InlineData(123.456789, "123.456789")]
    [InlineData(-98.76, "-98.76")]
    [InlineData(3.0000000000000004, "3.0000000000000004")]
    public void Numbers_are_written_as_V8_writes_them(double value, string expected)
    {
        Assert.Equal(expected, JsMath.ToString(value));
    }

    [Fact]
    public void Negative_zero_is_written_as_zero()
    {
        // Its own test: xUnit counts 0.0 and -0.0 as the same theory case.
        Assert.Equal("0", JsMath.ToString(-0.0));
    }

    [Theory]
    [InlineData(0.5, 1)]
    [InlineData(1.5, 2)]
    [InlineData(2.5, 3)]
    [InlineData(-0.5, 0)]
    [InlineData(-1.5, -1)]
    [InlineData(0.49999999999999994, 0)]
    [InlineData(100.49999999999999, 100)]
    [InlineData(267.5, 268)]
    public void Math_round_rounds_halves_up(double value, double expected)
    {
        Assert.Equal(expected, JsMath.Round(value));
    }

    [Theory]
    [InlineData("plain", "\"plain\"")]
    [InlineData("quote\"back\\slash", "\"quote\\\"back\\\\slash\"")]
    [InlineData("\b\f\n\r\t", "\"\\b\\f\\n\\r\\t\"")]
    [InlineData("\u0000\u001f\u007f", "\"\\u0000\\u001f\u007f\"")]
    [InlineData("é ü 日本 🍌", "\"é ü 日本 🍌\"")]
    [InlineData("\u2028\u2029", "\"\u2028\u2029\"")]
    [InlineData("</script>&<>", "\"</script>&<>\"")]
    public void Strings_are_escaped_as_JSON_stringify_escapes_them(string value, string expected)
    {
        using var w = new JsJsonWriter();
        w.String(value);
        Assert.Equal(expected, Encoding.UTF8.GetString(w.Written));
    }

    [Fact]
    public void Lone_surrogates_are_escaped_and_pairs_are_not()
    {
        // Built in code: theory data goes through UTF-8, which can't carry a lone surrogate.
        foreach (var (value, expected) in new[]
        {
            ((char)0xD800 + " lone", "\"\\ud800 lone\""),
            ("lone " + (char)0xDFFF, "\"lone \\udfff\""),
            ("" + (char)0xD83C + (char)0xDF4C, "\"🍌\""),
        })
        {
            using var w = new JsJsonWriter();
            w.String(value);
            Assert.Equal(expected, Encoding.UTF8.GetString(w.Written));
        }
    }

    [Fact]
    public void Integer_like_keys_come_first_in_numeric_order()
    {
        var node = JsNode.Parse("{\"b\":1,\"10\":2,\"a\":3,\"2\":4,\"01\":5,\"4294967295\":6}");
        Assert.Equal("{\"2\":4,\"10\":2,\"b\":1,\"a\":3,\"01\":5,\"4294967295\":6}", node.Stringify());
    }

    [Fact]
    public void A_repeated_key_keeps_its_place_and_its_last_value()
    {
        Assert.Equal("{\"a\":3,\"b\":2}", JsNode.Parse("{\"a\":1,\"b\":2,\"a\":3}").Stringify());
    }

    [Fact]
    public void Undefined_is_left_out_of_objects_and_null_in_arrays()
    {
        var o = JsNode.Object().Set("a", JsNode.Undefined).Set("b", JsNode.ArrayOf(JsNode.Undefined, JsNode.Num(double.NaN)));
        Assert.Equal("{\"b\":[null,null]}", o.Stringify());
    }

    [Theory]
    [InlineData("2021-04-10T19:37:28Z", 1618083448000.0)]
    [InlineData("2026-10-25T03:44:55.5791041Z", 1792899895579.0)]
    [InlineData("2026-10-25T03:44:55+01:00", 1792896295000.0)]
    [InlineData("2026-10-25", 1792886400000.0)]
    [InlineData("2026-10-25T03:44Z", 1792899840000.0)]
    [InlineData("2026-10-25 03:44:55Z", 1792899895000.0)]
    [InlineData("2026-10-25T03:44:55.5Z", 1792899895500.0)]
    [InlineData("0001-01-01T00:00:00Z", -62135596800000.0)]
    public void Dates_parse_as_Date_parse_reads_them(string text, double expected)
    {
        Assert.Equal(expected, JsDate.Parse(text));
    }

    [Theory]
    [InlineData("nope")]
    [InlineData("2026-13-01")]
    public void Unreadable_dates_are_NaN(string text)
    {
        Assert.True(double.IsNaN(JsDate.Parse(text)));
    }

    [Theory]
    [InlineData("2021-04-10T19:37:28", 1618083448.0)]
    [InlineData("2021-04-10T19:37:28Z", 1618083448.0)]
    [InlineData("2021-04-10T19:37:28.123+02:00", 1618076248.0)]
    [InlineData("2026-10-25", 1792886400.0)]
    public void IsoTime_reads_a_date_with_no_zone_as_UTC(string text, double expected)
    {
        Assert.Equal(expected, JsDate.IsoTime(text));
        Assert.Equal(expected, JsDate.IsoTime(Encoding.UTF8.GetBytes(text)));
    }

    [Theory]
    [InlineData(1793750400.0, "2026-W45", 1793577600.0, 1794182400.0)]
    [InlineData(1792972800.0, "2026-W44", 1792972800.0, 1793577600.0)]
    [InlineData(1793577599.0, "2026-W44", 1792972800.0, 1793577600.0)]
    [InlineData(1774746000.0, "2026-W13", 1774224000.0, 1774825200.0)]
    [InlineData(1798761600.0, "2026-W53", 1798416000.0, 1799020800.0)]
    [InlineData(1767225600.0, "2026-W01", 1766966400.0, 1767571200.0)]
    public void Weeks_run_Monday_to_Monday_in_Lisbon(double time, string id, double start, double end)
    {
        Assert.Equal((id, start, end), Build.LisbonWeek(time));
    }

    [Fact]
    public void A_week_id_names_its_week()
    {
        Assert.Equal(("2026-W44", 1792972800.0, 1793577600.0), Build.WeekOf("2026-W44"));
        Assert.Equal(("2027-W01", 1799020800.0, 1799625600.0), Build.WeekOf("2027-W01"));
        Assert.Null(Build.WeekOf("2026-44"));
    }

    [Theory]
    [InlineData(1774746000.0, 2)] // the night clocks go forward
    [InlineData(1774749600.0, 3)]
    [InlineData(1792890000.0, 1)] // the night clocks go back
    [InlineData(1792893600.0, 2)]
    [InlineData(1600000000.0, 13)]
    public void Lisbon_hours_follow_daylight_saving(double time, int hour)
    {
        Assert.Equal(hour, JsDate.LisbonHour(time));
    }

    [Fact]
    public void Sorting_keeps_equal_items_in_order()
    {
        var items = new List<(int Key, int Order)>();
        for (var i = 0; i < 500; i++)
        {
            items.Add((i % 7, i));
        }
        JsSort.Stable(items, (a, b) => a.Key.CompareTo(b.Key));
        for (var i = 1; i < items.Count; i++)
        {
            Assert.True(items[i - 1].Key < items[i].Key || (items[i - 1].Key == items[i].Key && items[i - 1].Order < items[i].Order));
        }
    }

    [Fact]
    public void Content_names_are_sha256_base64url_cut_to_ten()
    {
        // node -e "console.log(require('crypto').createHash('sha256').update('[]').digest('base64url').slice(0,10))"
        Assert.Equal("T1PNoYwrqg", Exporter.Hash("[]"u8));
    }
}
