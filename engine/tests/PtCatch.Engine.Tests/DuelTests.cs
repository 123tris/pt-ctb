using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using PtCatch.Engine.Export;
using PtCatch.Engine.Ingest;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;
using PtCatch.Engine.World;
using Xunit;

namespace PtCatch.Engine.Tests;

/// <summary>
/// Duels (Export/Build.Duels.cs, the port of tools/lib/duels.mjs): the cases and expected values of duels.test.mjs, and
/// edge values whose expected JSON is what the Node module gave for the same inputs.
/// </summary>
public sealed class DuelTests
{
    private const string Discord = "209017408016318464";
    private static readonly HashSet<double> OnSite = [1, 2, 3, 4];

    private static bool Known(double id) => OnSite.Contains(id);

    private static long Utc(int year, int month, int day, int hour, int minute = 0) =>
        new DateTimeOffset(year, month, day, hour, minute, 0, TimeSpan.Zero).ToUnixTimeSeconds();

    // ---- duels.test.mjs's fixtures --------------------------------------------------------------------------------

    private static JsNode Value(object v) => v switch
    {
        null => JsNode.NullValue,
        JsNode n => n,
        string s => JsNode.Str(s),
        bool b => JsNode.Bool(b),
        int i => JsNode.Num(i),
        long l => JsNode.Num(l),
        double d => JsNode.Num(d),
        JsNode[] a => JsNode.ArrayOf(a),
        _ => throw new ArgumentException($"no JSON for {v.GetType()}"),
    };

    private static JsNode Obj(params (string Key, object Value)[] props)
    {
        var o = JsNode.Object();
        foreach (var (key, value) in props)
        {
            o.Set(key, Value(value));
        }
        return o;
    }

    /// <summary><c>{ ...o, ...extra }</c>.</summary>
    private static JsNode With(JsNode o, params (string Key, object Value)[] extra)
    {
        var copy = JsNode.Object();
        foreach (var (key, value) in o.Props)
        {
            copy.Set(key, value);
        }
        foreach (var (key, value) in extra)
        {
            copy.Set(key, Value(value));
        }
        return copy;
    }

    private static JsNode Side(int osuId, int points, double before = 1500, double? after = null) => Obj(
        ("osuId", osuId), ("name", $"p{osuId}"), ("points", points), ("ratingBefore", before),
        ("ratingAfter", after ?? before + (points >= 3 ? 12 : -12)), ("rdAfter", 180), ("discordId", Discord));

    private static JsNode Score(int osuId, int s) =>
        Obj(("osuId", osuId), ("score", s), ("acc", 98.123), ("combo", 500), ("misses", 1), ("passed", true), ("discordId", Discord));

    private static JsNode Round(int n, int? winner, params (string Key, object Value)[] extra) => With(Obj(
        ("n", n), ("beatmapId", 1000 + n), ("stars", 6.123), ("winner", winner), ("void", null),
        ("scores", new[] { Score(1, winner == 1 ? 900000 : 800000), Score(2, winner == 2 ? 900000 : 800000) })), extra);

    private static JsNode Duel(object id, params (string Key, object Value)[] extra) => With(Obj(
        ("id", id), ("code", $"AB{id}"), ("ranked", true), ("bestOf", 5), ("status", "finished"),
        ("startedAt", $"2026-11-0{id}T20:00:00Z"), ("endedAt", $"2026-11-0{id}T20:30:00Z"), ("matchId", 118000000 + (id is int i ? i : 0)),
        ("stars", Obj(("min", 5.9), ("max", 6.9))), ("wager", 50), ("winner", 1), ("threadId", Discord), ("channelId", Discord),
        ("players", new[] { Side(1, 3), Side(2, 1) }),
        ("rounds", new[] { Round(1, 1), Round(2, 2), Round(3, null, ("void", "Wrong map")), Round(4, 1), Round(5, 1) })), extra);

    private static DuelsData Data(JsNode ratings, IEnumerable<JsNode> matches, IEnumerable<JsNode> active)
    {
        var data = new DuelsData { Ratings = ratings };
        data.Matches.AddRange(matches);
        data.Active.AddRange(active);
        return data;
    }

    /// <summary>JSON written with single quotes, for readability.</summary>
    private static string Q(string json) => json.Replace("'", "\"");

    private static string[] Keys(JsNode o) => JsNode.OrderedProps(o).Select(p => p.Key).ToArray();

    // ---- The cases of duels.test.mjs ------------------------------------------------------------------------------

    [Fact]
    public void No_Duels_folder_nothing()
    {
        var block = Build.DuelsBlock(null, Known);
        Assert.Null(block.File);
        Assert.Equal(0, block.Pages.Count);
        Assert.Empty(block.Profiles);
        Assert.Empty(block.MapIds);
        Assert.Empty(block.Events);
        Assert.Equal(JsKind.Null, block.Summary.Kind);
    }

    [Fact]
    public void A_duel_is_copied_field_by_field_osu_ids_never_Discord_ids_or_anything_the_bot_adds()
    {
        var copy = Build.DuelCopy(With(Duel(1), ("secret", "x")), Known).Node;
        Assert.Equal(["bestOf", "code", "end", "id", "mp", "players", "ranked", "rounds", "stars", "start", "status", "wager", "winner"],
            Keys(copy).OrderBy(k => k, StringComparer.Ordinal));
        Assert.Equal("""{"u":1,"name":"p1","pts":3,"before":1500,"after":1512,"rd":180}""", copy["players"][0].Stringify());
        Assert.Equal("""{"u":1,"score":900000,"acc":98.12,"combo":500,"miss":1,"pass":true}""", copy["rounds"][0]["scores"][0].Stringify());
        Assert.Equal(Utc(2026, 11, 1, 20), copy["start"].Number);
        Assert.Equal("[5.9,6.9]", copy["stars"].Stringify());
        // A void round has its reason and no winner, even if the bot named one.
        Assert.Equal(JsKind.Null, copy["rounds"][2]["winner"].Kind);
        Assert.Equal("Wrong map", copy["rounds"][2]["void"].Text);
        Assert.DoesNotContain(Discord, copy.Stringify());
    }

    [Fact]
    public void Cancelled_duels_unknown_statuses_restricted_or_untracked_players_and_odd_shapes_are_left_out()
    {
        Assert.Null(Build.DuelCopy(Duel(1, ("status", "cancelled")), Known));
        Assert.Null(Build.DuelCopy(Duel(1, ("status", "weird")), Known));
        Assert.Null(Build.DuelCopy(Duel(1, ("players", new[] { Side(1, 3), Side(9, 1) })), Known)); // 9: not on the site
        Assert.Null(Build.DuelCopy(Duel(1, ("players", new[] { Side(1, 3) })), Known));
        Assert.Null(Build.DuelCopy(Duel(1, ("players", new[] { Side(1, 3), Side(1, 1) })), Known));
        Assert.Null(Build.DuelCopy(Duel(1, ("id", "7")), Known));
        // A score by someone else in the lobby isn't the duel's.
        var crowded = Build.DuelCopy(Duel(1, ("rounds", new[] { With(Round(1, 1), ("scores", new[] { Score(1, 5), Score(3, 9), Score(2, 4) })) })), Known);
        Assert.Equal([1.0, 2.0], crowded.Node["rounds"][0]["scores"].Items.Select(s => s["u"].Number));
    }

    [Fact]
    public void Unranked_and_abandoned_duels_carry_no_rating_change_an_abandoned_one_has_no_winner_ranked_or_not()
    {
        var unranked = Build.DuelCopy(Duel(1, ("ranked", false)), Known).Node;
        Assert.True(unranked["players"][0]["after"].IsUndefined);
        var abandoned = Build.DuelCopy(Duel(1, ("status", "abandoned"), ("winner", 1)), Known).Node;
        Assert.True(abandoned["ranked"].BoolValue);
        Assert.Equal(JsKind.Null, abandoned["winner"].Kind);
        Assert.True(abandoned["players"][0]["before"].IsUndefined);
    }

    [Fact]
    public void A_live_duel_keeps_only_its_allow_listed_fields()
    {
        var live = Build.LiveCopy(Obj(
            ("id", 9), ("code", "ZZ"), ("ranked", true), ("bestOf", 5), ("startedAt", "2026-11-03T21:00:00Z"), ("matchId", 1), ("threadId", Discord),
            ("challengerDiscordId", Discord), ("lastEventId", 55),
            ("players", new[] { Obj(("osuId", 3), ("name", "p3"), ("points", 2), ("discordId", Discord)), Obj(("osuId", 4), ("name", "p4"), ("points", 1)) })), Known);
        Assert.Equal(
            $$"""{"id":9,"code":"ZZ","ranked":true,"bestOf":5,"start":{{Utc(2026, 11, 3, 21)}},"mp":1,"players":[{"u":3,"name":"p3","pts":2},{"u":4,"name":"p4","pts":1}]}""",
            live.Stringify());
        Assert.Null(Build.LiveCopy(Obj(("id", 9), ("players", new[] { Obj(("osuId", 3)), Obj(("osuId", 8)) })), Known));
    }

    [Fact]
    public void The_block_ladder_live_recent_pages_profiles_events_and_the_summary()
    {
        var ratings = Obj(
            ("1", Obj(("name", "p1"), ("r", 1620.4), ("rd", 80), ("vol", 0.06), ("lastAt", "2026-11-05T20:30:00Z"), ("w", 6), ("l", 1), ("streak", 3), ("peak", 1650), ("discordId", Discord))),
            ("2", Obj(("name", "p2"), ("r", 1480), ("rd", 95), ("w", 2), ("l", 5), ("streak", -2), ("peak", 1500))),
            ("3", Obj(("name", "p3"), ("r", 1700), ("rd", 200), ("w", 2), ("l", 0), ("streak", 2), ("peak", 1700))), // provisional: after the rated ones
            ("4", Obj(("name", "p4"), ("r", 1500), ("rd", 350), ("w", 0), ("l", 0))), // no ranked duel
            ("9", Obj(("name", "restricted"), ("r", 2000), ("rd", 50), ("w", 9), ("l", 0))));
        var matches = new[]
        {
            Duel(1), Duel(2, ("winner", 2), ("players", new[] { Side(1, 1), Side(2, 3) }), ("status", "forfeit")), Duel(3, ("status", "cancelled")),
            Duel(4, ("status", "abandoned"), ("players", new[] { Side(1, 1), Side(2, 1) })), Duel(5, ("ranked", false), ("players", new[] { Side(1, 3), Side(3, 0) })),
        };
        var active = Obj(("id", 6), ("players", new[] { Obj(("osuId", 3), ("points", 1)), Obj(("osuId", 4), ("points", 0)) }), ("startedAt", "2026-11-06T20:00:00Z"));
        var block = Build.DuelsBlock(Data(ratings, matches, [active]), Known);
        var file = block.File;

        Assert.Equal("[[1,1,false],[2,2,false],[3,null,true]]",
            Build.ArrayOf(file["ladder"].Items.Select(r => JsNode.ArrayOf(r["u"], r["rank"], r["prov"]))).Stringify());
        Assert.Equal(
            $$"""{"u":1,"name":"p1","r":1620,"rd":80,"w":6,"l":1,"streak":3,"peak":1650,"last":{{Utc(2026, 11, 5, 20, 30)}},"prov":false,"rank":1}""",
            file["ladder"][0].Stringify());
        Assert.True(Rules.DuelProvisionalRd > 95 && Rules.DuelProvisionalRd <= 200);
        Assert.Equal([6.0], file["live"].Items.Select(d => d["id"].Number));
        Assert.Equal([5.0, 4, 2, 1], file["recent"].Items.Select(d => d["id"].Number)); // newest first, the cancelled one gone
        Assert.Equal(4, file["total"].Number);
        Assert.Equal(["1001", "1002", "1003", "1004", "1005"], Keys(file["maps"]));
        Assert.Equal(["duels/0.json"], Keys(block.Pages));
        Assert.Equal(["1", "2", "4", "5"], Keys(block.Pages["duels/0.json"]["duels"]));
        Assert.Equal("duels/12.json", Rules.DuelFile(1234));

        var p1 = block.Profiles[1];
        Assert.Equal("""{"r":1620,"rd":80,"prov":false,"rank":1,"w":6,"l":1,"streak":3,"peak":1650}""", p1["rating"].Stringify());
        Assert.Equal("""[[5,"w",3,[3,0]],[4,"x",2,[1,1]],[2,"l",2,[1,3]],[1,"w",2,[3,1]]]""",
            Build.ArrayOf(p1["recent"].Items.Select(d => JsNode.ArrayOf(d["id"], d["res"], d["opp"], d["s"]))).Stringify());
        Assert.Equal(1, p1["recent"][2]["ff"].Number);
        Assert.Equal(12, p1["recent"][3]["d"].Number);
        Assert.True(p1["recent"][0]["d"].IsUndefined); // unranked
        // Head to head: the abandoned duel counts for nobody; most-played opponent first.
        Assert.Equal("[[2,1,1],[3,1,0]]", p1["h2h"].Stringify());
        Assert.True(block.Profiles[3]["rating"]["prov"].BoolValue);
        Assert.False(block.Profiles.ContainsKey(9));

        // Ranked results only, newest first; a forfeit says so.
        Assert.Equal(
            $$"""[{"t":{{Utc(2026, 11, 2, 20, 30)}},"k":"duel","u":2,"v":1,"d":2,"sc":[3,1],"r":12,"ff":1},{"t":{{Utc(2026, 11, 1, 20, 30)}},"k":"duel","u":1,"v":2,"d":1,"sc":[3,1],"r":12}]""",
            Build.ArrayOf(block.Events).Stringify());
        Assert.Equal("""{"live":1,"players":3,"total":4,"leader":1}""", block.Summary.Stringify());
        var everything = file.Stringify() + block.Pages.Stringify() + string.Concat(block.Profiles.Values.Select(p => p.Stringify())) + Build.ArrayOf(block.Events).Stringify();
        Assert.DoesNotContain(Discord, everything);
        Assert.DoesNotContain("restricted", file.Stringify());
    }

    [Fact]
    public void The_same_duel_in_two_month_files_counts_once_as_the_later_file_has_it()
    {
        var block = Build.DuelsBlock(Data(JsNode.Object(), [Duel(1, ("code", "OLD")), Duel(1, ("code", "NEW"))], []), Known);
        Assert.Equal(["NEW"], block.File["recent"].Items.Select(d => d["code"].Text));
    }

    [Fact]
    public void The_Duels_folder_ratings_every_month_of_matches_and_only_state_json_s_active_list()
    {
        var root = Directory.CreateTempSubdirectory("duels-").FullName;
        try
        {
            Assert.Null(BotDataReader.LoadDuels(root, null));
            Directory.CreateDirectory(Path.Combine(root, "Duels", "matches"));
            var empty = BotDataReader.LoadDuels(root, null);
            Assert.Equal("{}", empty.Ratings.Stringify());
            Assert.Empty(empty.Matches);
            Assert.Empty(empty.Active);
            void Write(string file, string text) => File.WriteAllText(Path.Combine(root, "Duels", file), text);
            Write("ratings.json", """{"players":{"1":{"r":1500}}}""");
            Write("matches/2026-12.json", Obj(("duels", new[] { Duel(2) })).Stringify());
            Write("matches/2026-11.json", Obj(("duels", new[] { Duel(1) })).Stringify());
            Write("matches/notes.json", Obj(("duels", new[] { Duel(3) })).Stringify());
            Write("matches/2027-01.json", "{ not json");
            Write("state.json", Obj(("channelId", Discord), ("challenges", new[] { Obj(("discordId", Discord)) }), ("active", new[] { Obj(("id", 5)) }), ("nextId", 6)).Stringify());
            var loaded = BotDataReader.LoadDuels(root, null);
            Assert.Equal("""{"1":{"r":1500}}""", loaded.Ratings.Stringify());
            Assert.Equal([1.0, 2.0], loaded.Matches.Select(d => d["id"].Number));
            Assert.Equal("""[{"id":5}]""", Build.ArrayOf(loaded.Active).Stringify());
            Assert.Equal([1001.0, 1002, 1003, 1004, 1005, 1001, 1002, 1003, 1004, 1005], Build.DuelMapIds(loaded));
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    [Fact]
    public void Before_the_bot_has_written_any_duels_an_empty_folder_empty_files_or_junk_all_export_with_nothing_to_show()
    {
        var root = Directory.CreateTempSubdirectory("duels-empty-").FullName;
        var states = new List<DuelsData>();
        try
        {
            void Write(string file, string text) => File.WriteAllText(Path.Combine(root, "Duels", file), text);
            Directory.CreateDirectory(Path.Combine(root, "Duels", "matches"));
            states.Add(BotDataReader.LoadDuels(root, null)); // empty folder, empty matches/
            Write("ratings.json", "");
            Write("state.json", "");
            states.Add(BotDataReader.LoadDuels(root, null)); // empty files
            Write("ratings.json", "{}");
            Write("state.json", """{"active":null}""");
            Write("matches/2026-11.json", """{"duels":null}""");
            states.Add(BotDataReader.LoadDuels(root, null));
            Write("ratings.json", """{"players":[]}""");
            Write("matches/2026-11.json", "[]");
            Write("matches/2026-12.json", """{"duels":[null, 5, {"id":1}]}""");
            states.Add(BotDataReader.LoadDuels(root, null));
            // Anything after the value is as unparsable as it is to JSON.parse.
            Write("matches/2026-12.json", """{"duels":[{"id":1}]} {"duels":[]}""");
            states.Add(BotDataReader.LoadDuels(root, null));
        }
        finally
        {
            Directory.Delete(root, true);
        }
        foreach (var loaded in states)
        {
            Assert.Equal("{}", loaded.Ratings.Stringify());
            Assert.Empty(loaded.Active);
            var block = Build.DuelsBlock(loaded, Known);
            Assert.Equal("""{"ladder":[],"live":[],"recent":[],"total":0,"maps":{}}""", block.File.Stringify());
            Assert.Equal(0, block.Pages.Count);
            Assert.Equal("""{"live":0,"players":0,"total":0,"leader":null}""", block.Summary.Stringify());
        }
        Assert.Empty(states[^1].Matches);
    }

    // ---- Edge values: the expected JSON is what tools/lib/duels.mjs gave for the same inputs -----------------------

    [Fact]
    public void Edge_values_round_trim_and_cut_as_JavaScript_does()
    {
        // U+FEFF and U+3000 are JavaScript whitespace and are trimmed; U+0085 isn't (though .NET's Trim takes it).
        var nel = ((char)0x85).ToString();
        var name1 = (char)0xFEFF + nel + "p1" + (char)0x3000;
        // 39 units and a banana: the 40-unit cut leaves its high surrogate alone.
        var name2 = "  " + new string('x', 39) + char.ConvertFromUtf32(0x1F34C) + "  ";
        var duel = JsNode.Parse("""
            {"id":7,"code":"  CODE-THAT-IS-LONGER-THAN-24-UNITS  ","ranked":true,"bestOf":4,"status":"finished",
             "startedAt":"2026-11-03T21:00:00+01:00","endedAt":"2026-11-03T20:30:00","matchId":0,"stars":{"min":5.555,"max":6.999},
             "wager":2.5,"winner":1,
             "players":[{"osuId":1,"points":2.5,"ratingBefore":1500.5,"ratingAfter":1512.49,"rdAfter":109.5},
                        {"osuId":2,"points":-1,"ratingBefore":null,"ratingAfter":1490}],
             "rounds":[{"n":1.5,"beatmapId":11,"stars":6.005,"winner":2,"void":"  ",
                        "scores":[{"osuId":2,"score":1.5,"acc":98.125,"combo":-3,"misses":2,"passed":0},{"osuId":3,"score":1}]},
                       {"n":2,"beatmapId":"12","winner":1},
                       {"n":3,"beatmapId":13,"winner":1,"void":" Lag ","scores":{"osuId":1}}]}
            """);
        duel["players"][0].Set("name", name1);
        duel["players"][1].Set("name", name2);
        Assert.Equal(
            Q("{'id':7,'code':'CODE-THAT-IS-LONGER-THAN','ranked':true,'bestOf':null,'status':'finished','start':1793736000,'end':1793737800," +
              "'mp':null,'stars':[5.56,7],'wager':null,'winner':1,'players':[{'u':1,'name':'" + nel + "p1','pts':0,'before':1501,'after':1512," +
              "'rd':110},{'u':2,'name':'" + new string('x', 39) + "BACKSLASHud83c','pts':0}],'rounds':[{'n':null,'map':11,'stars':6.01,'winner':2," +
              "'void':null,'scores':[{'u':2,'score':0,'acc':98.13,'combo':0,'miss':2,'pass':true}]},{'n':3,'map':13,'stars':null,'winner':null," +
              "'void':'Lag','scores':[]}]}").Replace("BACKSLASH", "\\"),
            Build.DuelCopy(duel, Known).Node.Stringify());

        var block = Build.DuelsBlock(Data(JsNode.Parse("""
            {"1":{"r":-1.5,"w":1},
             "2":{"name":" two ","r":1620.5,"rd":109.4,"w":1,"l":0,"streak":1.5,"peak":1600,"lastAt":"nope"},
             "3":{"r":1620.5,"rd":109.6,"w":1,"l":0,"peak":1700},
             "4":{"r":1620.5,"rd":80,"w":0.5,"l":2},
             "04":{"r":1700,"rd":80,"w":1,"l":0},
             "x":{"r":1,"w":1}}
            """), [], JsNode.Parse("""
            [{"id":8,"players":[{"osuId":1},{"osuId":2}],"startedAt":"2026-11-05T09:00:00Z"},
             {"id":9,"players":[{"osuId":3},{"osuId":4}],"startedAt":"2026-11-05T09:00:00Z"},
             {"id":10,"players":[{"osuId":1},{"osuId":3}]}]
            """).Items), Known);
        // Halves round up (1620.5 → 1621, -1.5 → -1); 109.6 rounds to 110, provisional; "04" is player 4 again.
        Assert.Equal(
            Q("[{'u':4,'name':'#4','r':1700,'rd':80,'w':1,'l':0,'streak':0,'peak':1700,'last':null,'prov':false,'rank':1}," +
              "{'u':2,'name':'two','r':1621,'rd':109,'w':1,'l':0,'streak':0,'peak':1621,'last':null,'prov':false,'rank':2}," +
              "{'u':4,'name':'#4','r':1621,'rd':80,'w':0,'l':2,'streak':0,'peak':1621,'last':null,'prov':false,'rank':3}," +
              "{'u':3,'name':'#3','r':1621,'rd':110,'w':1,'l':0,'streak':0,'peak':1700,'last':null,'prov':true,'rank':null}," +
              "{'u':1,'name':'#1','r':-1,'rd':350,'w':1,'l':0,'streak':0,'peak':0,'last':null,'prov':true,'rank':null}]"),
            block.File["ladder"].Stringify());
        // The same start: the higher id first; no start last.
        Assert.Equal(
            Q("[{'id':9,'code':null,'ranked':false,'bestOf':null,'start':1793869200,'mp':null,'players':[{'u':3,'name':'#3','pts':0},{'u':4,'name':'#4','pts':0}]}," +
              "{'id':8,'code':null,'ranked':false,'bestOf':null,'start':1793869200,'mp':null,'players':[{'u':1,'name':'#1','pts':0},{'u':2,'name':'#2','pts':0}]}," +
              "{'id':10,'code':null,'ranked':false,'bestOf':null,'start':null,'mp':null,'players':[{'u':1,'name':'#1','pts':0},{'u':3,'name':'#3','pts':0}]}]"),
            block.File["live"].Stringify());
        // A player on the ladder twice keeps the later row on their profile.
        Assert.Equal("""{"rating":{"r":1621,"rd":80,"prov":false,"rank":3,"w":0,"l":2,"streak":0,"peak":1621},"recent":[],"h2h":[]}""", block.Profiles[4].Stringify());
        Assert.Equal("""{"rating":{"r":-1,"rd":350,"prov":true,"rank":null,"w":1,"l":0,"streak":0,"peak":0},"recent":[],"h2h":[]}""", block.Profiles[1].Stringify());
        Assert.Equal("""{"live":3,"players":5,"total":0,"leader":4}""", block.Summary.Stringify());
    }

    [Fact]
    public void Duel_files_hold_a_hundred_ids_and_list_past_the_array_index_range_as_inserted()
    {
        Assert.Equal("duels/0.json", Rules.DuelFile(99));
        Assert.Equal("duels/1.json", Rules.DuelFile(100));
        Assert.Equal("duels/42949672.json", Rules.DuelFile(4294967296));
        // Newest first: 4294967296, 4294967294, 4294967295. 4294967294 is the last array-index key, so it's listed first;
        // the others in the order they were added.
        var block = Build.DuelsBlock(Data(JsNode.Object(), [
            Duel(4294967295L, ("startedAt", "2026-11-01T20:00:00Z"), ("endedAt", "2026-11-01T20:30:00Z")),
            Duel(4294967294L, ("startedAt", "2026-11-02T20:00:00Z"), ("endedAt", "2026-11-02T20:30:00Z")),
            Duel(4294967296L, ("startedAt", "2026-11-03T20:00:00Z"), ("endedAt", "2026-11-03T20:30:00Z")),
        ], []), Known);
        Assert.Equal(["duels/42949672.json"], Keys(block.Pages));
        Assert.Equal(["4294967294", "4294967296", "4294967295"], Keys(block.Pages["duels/42949672.json"]["duels"]));
    }

    // ---- completion.json's years (completion.test.mjs) -----------------------------------------------------------

    [Fact]
    public void Each_ranked_year_gets_its_total_and_clears_oldest_first_a_map_without_a_ranked_date_is_only_in_the_totals()
    {
        var years = Build.CompletionYears([
            (JsDate.IsoTime("2014-03-01T00:00:00Z"), false), (JsDate.IsoTime("2014-12-31T23:00:00Z"), true),
            (JsDate.IsoTime("2021-06-01T00:00:00Z"), true), (double.NaN, true),
        ]);
        Assert.Equal("[[2014,2,1],[2021,1,1]]", years.Stringify());
    }
}
