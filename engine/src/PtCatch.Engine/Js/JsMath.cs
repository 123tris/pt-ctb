using System;
using System.Globalization;
using System.Text;

namespace PtCatch.Engine.Js;

/// <summary>
/// JavaScript's number semantics where the site's files depend on them. The engine replaces a Node exporter whose
/// output the site (and the published file names, which are hashes of the bytes) already depend on, so every number has
/// to come out exactly as V8 writes it.
/// </summary>
public static class JsMath
{
    /// <summary>
    /// <c>Math.round</c>: the nearest integer, halves toward +∞. Not <see cref="Math.Round(double)"/>, which rounds
    /// halves to even, and not <c>Math.Floor(x + 0.5)</c>, which is wrong for 0.49999999999999994.
    /// </summary>
    public static double Round(double x)
    {
        if (double.IsNaN(x) || double.IsInfinity(x))
        {
            return x;
        }
        var floor = Math.Floor(x);
        return x - floor >= 0.5 ? floor + 1 : floor;
    }

    /// <summary>The exporter's <c>round(n, places)</c>: <c>Math.round(n * 10 ** places) / 10 ** places</c>.</summary>
    public static double Round(double n, int places)
    {
        var scale = places == 2 ? 100.0 : Math.Pow(10, places);
        return Round(n * scale) / scale;
    }

    /// <summary>
    /// <c>Number::toString(10)</c> (ECMA-262 §6.1.6.1.20) without the NaN/Infinity cases, which JSON writes as null. The
    /// digits are .NET's shortest round-trip ones ("R"), the same digits V8 picks; only where the decimal point goes and
    /// when to switch to exponent form differ between the two, and that is ECMAScript's rule below.
    /// </summary>
    public static void Append(StringBuilder sb, double v)
    {
        if (v == 0)
        {
            sb.Append('0'); // -0 too
            return;
        }
        if (Math.Abs(v) < 9e15 && v == Math.Floor(v))
        {
            sb.Append(((long)v).ToString(CultureInfo.InvariantCulture));
            return;
        }
        Span<char> buffer = stackalloc char[40];
        Format(v, buffer, out var length);
        sb.Append(buffer[..length]);
    }

    /// <summary>The same as <see cref="Append(StringBuilder, double)"/>, into a span of at least 40 chars.</summary>
    public static void Format(double v, Span<char> output, out int length)
    {
        length = 0;
        if (v == 0)
        {
            output[length++] = '0';
            return;
        }
        if (v < 0)
        {
            output[length++] = '-';
            v = -v;
        }
        if (v < 9e15 && v == Math.Floor(v))
        {
            ((long)v).TryFormat(output[length..], out var written, default, CultureInfo.InvariantCulture);
            length += written;
            return;
        }
        if (v >= 1e-6 && v < 1e9 && FewDecimals(v, output, ref length))
        {
            return;
        }

        // Shortest round-trip digits and the exponent n, so that v = 0.d1d2…dk × 10^n.
        Span<char> r = stackalloc char[32];
        v.TryFormat(r, out var rLength, "R", CultureInfo.InvariantCulture);
        Span<char> digits = stackalloc char[24];
        var k = 0;
        var pointAt = -1;
        var exponent = 0;
        for (var i = 0; i < rLength; i++)
        {
            var c = r[i];
            if (c == '.')
            {
                pointAt = k;
            }
            else if (c == 'E' || c == 'e')
            {
                exponent = int.Parse(r[(i + 1)..rLength], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
                break;
            }
            else
            {
                digits[k++] = c;
            }
        }
        if (pointAt < 0)
        {
            pointAt = k;
        }
        // Leading zeros ("0.00123") move the point; trailing zeros of an integer part stay significant only as n.
        var start = 0;
        while (start < k - 1 && digits[start] == '0')
        {
            start++;
            pointAt--;
        }
        var end = k;
        while (end > start + 1 && digits[end - 1] == '0')
        {
            end--;
        }
        var d = digits[start..end];
        k = d.Length;
        var n = pointAt + exponent;

        if (k <= n && n <= 21)
        {
            d.CopyTo(output[length..]);
            length += k;
            for (var i = 0; i < n - k; i++)
            {
                output[length++] = '0';
            }
        }
        else if (0 < n && n <= 21)
        {
            d[..n].CopyTo(output[length..]);
            length += n;
            output[length++] = '.';
            d[n..].CopyTo(output[length..]);
            length += k - n;
        }
        else if (-6 < n && n <= 0)
        {
            output[length++] = '0';
            output[length++] = '.';
            for (var i = 0; i < -n; i++)
            {
                output[length++] = '0';
            }
            d.CopyTo(output[length..]);
            length += k;
        }
        else
        {
            output[length++] = d[0];
            if (k > 1)
            {
                output[length++] = '.';
                d[1..].CopyTo(output[length..]);
                length += k - 1;
            }
            output[length++] = 'e';
            var e = n - 1;
            output[length++] = e < 0 ? '-' : '+';
            Math.Abs(e).TryFormat(output[length..], out var written, default, CultureInfo.InvariantCulture);
            length += written;
        }
    }

    private static readonly double[] Scales = [10, 100, 1000, 10000, 100000, 1000000];

    /// <summary>
    /// The fast path for the numbers the site's files are full of: pp, accuracy and stars, a few decimals each. When
    /// k / 10^p is exactly v (IEEE division is correctly rounded, so that's the double the decimal parses to) and k has
    /// at most 15 digits, that decimal, trailing zeros trimmed, is the one shortest string that round-trips: the same
    /// digits "R" (and V8) would find, without the general algorithm.
    /// </summary>
    private static bool FewDecimals(double v, Span<char> output, ref int length)
    {
        for (var p = 0; p < Scales.Length; p++)
        {
            var scaled = v * Scales[p];
            var k = Math.Round(scaled);
            if (Math.Abs(scaled - k) > 1e-3 || k / Scales[p] != v || k >= 1e15)
            {
                continue;
            }
            var digits = (long)k;
            var decimals = p + 1;
            while (decimals > 0 && digits % 10 == 0)
            {
                digits /= 10;
                decimals--;
            }
            Span<char> d = stackalloc char[20];
            digits.TryFormat(d, out var n, default, CultureInfo.InvariantCulture);
            if (n <= decimals)
            {
                output[length++] = '0';
                output[length++] = '.';
                for (var i = n; i < decimals; i++)
                {
                    output[length++] = '0';
                }
                d[..n].CopyTo(output[length..]);
                length += n;
            }
            else
            {
                d[..(n - decimals)].CopyTo(output[length..]);
                length += n - decimals;
                if (decimals > 0)
                {
                    output[length++] = '.';
                    d[(n - decimals)..n].CopyTo(output[length..]);
                    length += decimals;
                }
            }
            return true;
        }
        return false;
    }

    /// <summary><c>String(n)</c> for a finite number.</summary>
    public static string ToString(double v)
    {
        if (double.IsNaN(v))
        {
            return "NaN";
        }
        if (double.IsInfinity(v))
        {
            return v > 0 ? "Infinity" : "-Infinity";
        }
        Span<char> buffer = stackalloc char[40];
        Format(v, buffer, out var length);
        return new string(buffer[..length]);
    }

    /// <summary><c>Number.isSafeInteger</c>.</summary>
    public static bool IsSafeInteger(double v) => !double.IsNaN(v) && !double.IsInfinity(v) && v == Math.Floor(v) && Math.Abs(v) <= 9007199254740991;
}
