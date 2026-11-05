namespace PtCatch.Engine.Js;

/// <summary>JavaScript's string methods where they differ from .NET's.</summary>
public static class JsString
{
    /// <summary>
    /// <c>String.prototype.trim</c>: strips ECMAScript's WhiteSpace and LineTerminator characters. Not
    /// <see cref="string.Trim()"/>, which strips U+0085 too and leaves U+FEFF.
    /// </summary>
    public static string Trim(string s)
    {
        var start = 0;
        var end = s.Length;
        while (start < end && IsSpace(s[start]))
        {
            start++;
        }
        while (end > start && IsSpace(s[end - 1]))
        {
            end--;
        }
        return start == 0 && end == s.Length ? s : s[start..end];
    }

    /// <summary>ECMAScript's WhiteSpace (tab, vertical tab, form feed, BOM and Unicode's Zs) and LineTerminator.</summary>
    public static bool IsSpace(char c) => (int)c switch
    {
        0x09 or 0x0A or 0x0B or 0x0C or 0x0D or 0x20 or 0xA0 or 0x1680 or 0x2028 or 0x2029 or 0x202F or 0x205F or 0x3000 or 0xFEFF => true,
        >= 0x2000 and <= 0x200A => true,
        _ => false,
    };
}
