using System;
using System.Globalization;
using System.Threading;

namespace PtCatch.Engine.Js;

/// <summary>
/// The date handling the exporter did through JavaScript's Date and Intl: <c>Date.parse</c> of the ISO strings the bot
/// writes, its <c>isoTime</c>, and Lisbon calendar fields (the community's weeks and months are Lisbon's).
/// </summary>
public static class JsDate
{
    private static readonly TimeZoneInfo Lisbon = FindLisbon();

    private static TimeZoneInfo FindLisbon()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Europe/Lisbon");
        }
        catch (TimeZoneNotFoundException)
        {
            // Windows without ICU only knows its own ids; Lisbon shares London's rules since 1996.
            return TimeZoneInfo.FindSystemTimeZoneById("GMT Standard Time");
        }
    }

    /// <summary>
    /// <c>Date.parse(s)</c> in milliseconds, or NaN, for the forms V8 reads the way the bot writes dates: a date alone
    /// (UTC), or a date and time, optionally with seconds and any number of fractional digits (the first three count),
    /// then Z, an offset, or nothing (local time). A space works in place of the T.
    /// </summary>
    public static double Parse(string s) => s == null ? double.NaN : Parse(s.AsSpan(), false);

    /// <summary><see cref="Parse(string)"/>, reading a date and time with no zone as UTC when <paramref name="utc"/>.</summary>
    private static double Parse(ReadOnlySpan<char> s, bool utc)
    {
        var p = s.Trim();
        if (!TryDigits(p, 0, 4, out var year) || p.Length < 10 || p[4] != '-' || p[7] != '-' ||
            !TryDigits(p, 5, 2, out var month) || !TryDigits(p, 8, 2, out var day))
        {
            return double.NaN;
        }
        if (month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(Math.Max(1, year), month))
        {
            return double.NaN;
        }
        var date = DaysFromCivil(year, month, day) * 86400000.0;
        if (p.Length == 10)
        {
            return date;
        }
        if (p[10] != 'T' && p[10] != 't' && p[10] != ' ')
        {
            return double.NaN;
        }
        var i = 11;
        if (!TryDigits(p, i, 2, out var hour) || p.Length < i + 5 || p[i + 2] != ':' || !TryDigits(p, i + 3, 2, out var minute))
        {
            return double.NaN;
        }
        i += 5;
        var second = 0;
        var ms = 0;
        if (i < p.Length && p[i] == ':')
        {
            if (!TryDigits(p, i + 1, 2, out second))
            {
                return double.NaN;
            }
            i += 3;
            if (i < p.Length && p[i] == '.')
            {
                i++;
                var digits = 0;
                while (i < p.Length && char.IsAsciiDigit(p[i]))
                {
                    if (digits < 3)
                    {
                        ms = ms * 10 + (p[i] - '0');
                    }
                    digits++;
                    i++;
                }
                if (digits == 0)
                {
                    return double.NaN;
                }
                for (; digits < 3; digits++)
                {
                    ms *= 10;
                }
            }
        }
        if (hour > 24 || minute > 59 || second > 59 || (hour == 24 && (minute != 0 || second != 0 || ms != 0)))
        {
            return double.NaN;
        }
        var time = date + ((hour * 60.0 + minute) * 60 + second) * 1000 + ms;
        if (i == p.Length)
        {
            return utc ? time : time - LocalOffsetMs(time);
        }
        if ((p[i] == 'Z' || p[i] == 'z') && i + 1 == p.Length)
        {
            return time;
        }
        if ((p[i] == '+' || p[i] == '-') && p.Length == i + 6 && p[i + 3] == ':' &&
            TryDigits(p, i + 1, 2, out var oh) && TryDigits(p, i + 4, 2, out var om))
        {
            var offset = (oh * 60 + om) * 60000.0;
            return p[i] == '+' ? time - offset : time + offset;
        }
        return double.NaN;
    }

    /// <summary><see cref="IsoTime(string)"/> straight from a JSON string's UTF-8 bytes (dates are ASCII).</summary>
    public static double IsoTime(ReadOnlySpan<byte> utf8)
    {
        if (utf8.Length > 64)
        {
            return IsoTime(System.Text.Encoding.UTF8.GetString(utf8));
        }
        Span<char> chars = stackalloc char[utf8.Length];
        for (var i = 0; i < utf8.Length; i++)
        {
            if (utf8[i] >= 0x80)
            {
                return IsoTime(System.Text.Encoding.UTF8.GetString(utf8));
            }
            chars[i] = (char)utf8[i];
        }
        return IsoTime(chars);
    }

    /// <summary>
    /// The exporter's <c>isoTime</c>: unix seconds (floored), reading a date with no zone as UTC. NaN when unreadable.
    /// </summary>
    public static double IsoTime(string date) => date == null ? double.NaN : IsoTime(date.AsSpan());

    private static double IsoTime(ReadOnlySpan<char> date)
    {
        // isoTime appends a Z to a date with no zone; V8 reads "2026-10-25Z" as that day's UTC midnight too.
        var zoned = date.IndexOfAny('z', 'Z') >= 0 || HasOffsetSuffix(date);
        var ms = Parse(date, !zoned);
        return double.IsNaN(ms) ? double.NaN : Math.Floor(ms / 1000);
    }

    /// <summary><c>Math.floor(Date.parse(s) / 1000)</c>, NaN when unreadable.</summary>
    public static double Unix(string s)
    {
        var ms = Parse(s);
        return double.IsNaN(ms) ? double.NaN : Math.Floor(ms / 1000);
    }

    private static bool HasOffsetSuffix(ReadOnlySpan<char> s) =>
        s.Length >= 6 && (s[^6] == '+' || s[^6] == '-') && char.IsAsciiDigit(s[^5]) && char.IsAsciiDigit(s[^4]) &&
        s[^3] == ':' && char.IsAsciiDigit(s[^2]) && char.IsAsciiDigit(s[^1]);

    private static bool TryDigits(ReadOnlySpan<char> s, int at, int count, out int value)
    {
        value = 0;
        if (at + count > s.Length)
        {
            return false;
        }
        for (var i = at; i < at + count; i++)
        {
            if (!char.IsAsciiDigit(s[i]))
            {
                return false;
            }
            value = value * 10 + (s[i] - '0');
        }
        return true;
    }

    /// <summary>Days since 1970-01-01 of a proleptic Gregorian date (any year).</summary>
    public static long DaysFromCivil(long y, int m, int d)
    {
        y -= m <= 2 ? 1 : 0;
        var era = (y >= 0 ? y : y - 399) / 400;
        var yoe = y - era * 400;
        var doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
        var doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    /// <summary>The calendar date of a day number (days since 1970-01-01).</summary>
    public static (long Year, int Month, int Day) CivilFromDays(long z)
    {
        z += 719468;
        var era = (z >= 0 ? z : z - 146096) / 146097;
        var doe = z - era * 146097;
        var yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        var y = yoe + era * 400;
        var doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        var mp = (5 * doy + 2) / 153;
        var d = (int)(doy - (153 * mp + 2) / 5 + 1);
        var m = (int)(mp < 10 ? mp + 3 : mp - 9);
        return (m <= 2 ? y + 1 : y, m, d);
    }

    private static double LocalOffsetMs(double localMs)
    {
        // The offset in force at that local wall-clock time, as V8 asks the OS for it.
        if (localMs < -62135596800000 || localMs > 253402300799000)
        {
            return 0;
        }
        var local = DateTime.SpecifyKind(DateTime.UnixEpoch.AddMilliseconds(localMs), DateTimeKind.Unspecified);
        return TimeZoneInfo.Local.GetUtcOffset(local).TotalMilliseconds;
    }

    private static readonly ZoneOffsets LisbonOffsets = new(Lisbon);
    private static readonly ZoneOffsets LocalOffsets = new(TimeZoneInfo.Local);


    /// <summary>
    /// A zone's UTC offset in seconds at a unix time. Zones change offset at most once a day, so each UTC day keeps the
    /// offset at its start and whether it changes before the next; only a changeover day asks the zone again. Filled as
    /// it's read; two threads filling the same day write the same values.
    /// </summary>
    private sealed class ZoneOffsets(TimeZoneInfo zone)
    {
        private const long FirstDay = -25567; // 1900-01-01
        private const int Days = 73414; // to 2100-12-31
        private const int Unknown = int.MinValue;
        private readonly int[] start = CreateUnknown();
        private readonly bool[] changes = new bool[Days];

        private static int[] CreateUnknown()
        {
            var a = new int[Days];
            Array.Fill(a, Unknown);
            return a;
        }

        public int At(double unixSeconds)
        {
            var seconds = (long)Math.Floor(unixSeconds);
            var day = (long)Math.Floor(unixSeconds / 86400);
            var i = day - FirstDay;
            if (i < 0 || i >= Days)
            {
                return Exact(seconds);
            }
            var offset = Volatile.Read(ref start[i]);
            if (offset == Unknown)
            {
                offset = Exact(day * 86400);
                changes[i] = Exact(day * 86400 + 86399) != offset;
                Volatile.Write(ref start[i], offset);
            }
            return changes[i] ? Exact(seconds) : offset;
        }

        private int Exact(long seconds) =>
            (int)zone.GetUtcOffset(DateTimeOffset.FromUnixTimeSeconds(Math.Clamp(seconds, -62135596800, 253402300799))).TotalSeconds;
    }

    /// <summary>Lisbon's hour (0-23) at a unix time.</summary>
    public static int LisbonHour(double unixSeconds)
    {
        var local = (long)Math.Floor(unixSeconds) + LisbonOffsets.At(unixSeconds);
        return (int)((local % 86400 + 86400) % 86400 / 3600);
    }

    /// <summary>Lisbon's calendar date at a unix time.</summary>
    public static (int Year, int Month, int Day) LisbonDate(double unixSeconds)
    {
        var local = Math.Floor(unixSeconds) + LisbonOffsets.At(unixSeconds);
        var (y, m, d) = CivilFromDays((long)Math.Floor(local / 86400));
        return ((int)y, m, d);
    }

    /// <summary>Lisbon's UTC offset at a unix time, in seconds.</summary>
    public static int LisbonOffset(double unixSeconds) => LisbonOffsets.At(unixSeconds);

    /// <summary>"yyyy-MM" in Lisbon.</summary>
    public static string LisbonMonth(double unixSeconds)
    {
        var (y, m, _) = LisbonDate(unixSeconds);
        return $"{y:D4}-{m:D2}";
    }

    /// <summary><c>new Date(t * 1000).getFullYear()</c>: the year in this machine's time zone.</summary>
    public static int LocalYear(double unixSeconds)
    {
        var local = Math.Floor(unixSeconds) + LocalOffsets.At(unixSeconds);
        return (int)CivilFromDays((long)Math.Floor(local / 86400)).Year;
    }

    /// <summary><c>new Date(t * 1000).toISOString().slice(0, 10)</c>.</summary>
    public static string UtcDay(double unixSeconds)
    {
        var (y, m, d) = CivilFromDays((long)Math.Floor(unixSeconds / 86400));
        return $"{y:D4}-{m:D2}-{d:D2}";
    }

    /// <summary><c>new Date(t * 1000).toISOString().replace('.000Z', 'Z')</c> for whole seconds.</summary>
    public static string IsoSeconds(double unixSeconds)
    {
        var days = (long)Math.Floor(unixSeconds / 86400);
        var rest = (long)(unixSeconds - days * 86400.0);
        var (y, m, d) = CivilFromDays(days);
        var year = y is >= 0 and <= 9999 ? y.ToString("D4", CultureInfo.InvariantCulture) : (y < 0 ? "-" : "+") + Math.Abs(y).ToString("D6", CultureInfo.InvariantCulture);
        return $"{year}-{m:D2}-{d:D2}T{rest / 3600:D2}:{rest / 60 % 60:D2}:{rest % 60:D2}Z";
    }

    /// <summary><c>Date.UTC(y, m - 1, d) / 1000</c> (months may overflow, as in JavaScript).</summary>
    public static double Utc(long year, int month, int day)
    {
        year += (month - 1) >= 0 ? (month - 1) / 12 : (month - 12) / 12;
        var m = ((month - 1) % 12 + 12) % 12 + 1;
        return (DaysFromCivil(year, m, 1) + day - 1) * 86400.0;
    }

    /// <summary>Day of the week of a unix time in UTC, Sunday = 0 (<c>getUTCDay</c>).</summary>
    public static int UtcWeekday(double unixSeconds) => (int)(((long)Math.Floor(unixSeconds / 86400) % 7 + 11) % 7);
}
