using System;
using System.Collections.Generic;
using System.Globalization;

namespace PtCatch.Engine.Js;

/// <summary>
/// <c>Array.prototype.sort</c>'s guarantee: stable. .NET's sorts are not, and many of the exporter's comparators leave
/// ties to the input order, so every sort that can tie goes through here.
/// </summary>
public static class JsSort
{
    /// <summary>Sorts in place, keeping equal items in their order.</summary>
    public static void Stable<T>(List<T> list, Comparison<T> compare)
    {
        if (list.Count < 2)
        {
            return;
        }
        var items = list.ToArray();
        Stable(items.AsSpan(), compare);
        for (var i = 0; i < items.Length; i++)
        {
            list[i] = items[i];
        }
    }

    /// <summary>Sorts in place, keeping equal items in their order (a merge sort, as V8's TimSort is stable).</summary>
    public static void Stable<T>(Span<T> items, Comparison<T> compare)
    {
        if (items.Length < 2)
        {
            return;
        }
        if (items.Length <= 16)
        {
            InsertionSort(items, compare);
            return;
        }
        var scratch = new T[items.Length];
        MergeSort(items, scratch, compare);
    }

    public static void Stable<T>(T[] items, Comparison<T> compare) => Stable(items.AsSpan(), compare);

    private static void InsertionSort<T>(Span<T> a, Comparison<T> compare)
    {
        for (var i = 1; i < a.Length; i++)
        {
            var x = a[i];
            var j = i - 1;
            while (j >= 0 && compare(a[j], x) > 0)
            {
                a[j + 1] = a[j];
                j--;
            }
            a[j + 1] = x;
        }
    }

    private static void MergeSort<T>(Span<T> a, T[] scratch, Comparison<T> compare)
    {
        if (a.Length <= 16)
        {
            InsertionSort(a, compare);
            return;
        }
        var mid = a.Length / 2;
        MergeSort(a[..mid], scratch, compare);
        MergeSort(a[mid..], scratch, compare);
        if (compare(a[mid - 1], a[mid]) <= 0)
        {
            return;
        }
        a[..mid].CopyTo(scratch);
        int i = 0, j = mid, k = 0;
        while (i < mid && j < a.Length)
        {
            a[k++] = compare(a[j], scratch[i]) < 0 ? a[j++] : scratch[i++];
        }
        while (i < mid)
        {
            a[k++] = scratch[i++];
        }
    }

    /// <summary>The sign of a JavaScript comparator's number result (NaN counts as equal, as in V8).</summary>
    public static int Sign(double d) => d > 0 ? 1 : d < 0 ? -1 : 0;

    /// <summary>
    /// <c>a.localeCompare(b)</c> with no locale: ICU collation for the machine's locale, which is what Node uses.
    /// </summary>
    public static int LocaleCompare(string a, string b) =>
        Math.Sign(CultureInfo.CurrentCulture.CompareInfo.Compare(a ?? "undefined", b ?? "undefined", CompareOptions.None));

    /// <summary>JavaScript's default string ordering (<c>a < b</c>): by UTF-16 code units.</summary>
    public static int CodeUnits(string a, string b) => string.CompareOrdinal(a, b) switch { < 0 => -1, > 0 => 1, _ => 0 };
}
