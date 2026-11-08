using System;
using System.Buffers;
using System.Globalization;
using System.Text;

namespace PtCatch.Engine.Js;

/// <summary>
/// A forward-only UTF-8 writer whose output is byte for byte what <c>JSON.stringify</c> makes of the same values: no
/// whitespace, V8's number formatting, and JSON.stringify's string escaping (only <c>"</c>, <c>\</c>, control
/// characters and lone surrogates; everything else, emoji included, as is). System.Text.Json's writer escapes far more
/// and formats numbers its own way, so it can't be used for files whose names are hashes of their bytes.
/// </summary>
public sealed class JsJsonWriter : IDisposable
{
    private byte[] buffer;
    private int length;
    // One bit per nesting level: does the next value at this level need a comma first.
    private ulong commas;
    private int depth;
    private bool afterKey;
    private ulong[] deepCommas;

    public JsJsonWriter(int capacity = 1 << 16)
    {
        buffer = ArrayPool<byte>.Shared.Rent(capacity);
    }

    /// <summary>The bytes written so far.</summary>
    public ReadOnlySpan<byte> Written => buffer.AsSpan(0, length);

    public int Length => length;

    /// <summary>Starts over, keeping the buffer.</summary>
    public void Reset()
    {
        length = 0;
        commas = 0;
        depth = 0;
        afterKey = false;
    }

    public byte[] ToArray() => Written.ToArray();

    public void Dispose()
    {
        if (buffer != null)
        {
            ArrayPool<byte>.Shared.Return(buffer);
            buffer = null;
        }
    }

    public void BeginObject()
    {
        BeforeValue();
        Byte((byte)'{');
        Push();
    }

    public void EndObject()
    {
        Pop();
        Byte((byte)'}');
    }

    public void BeginArray()
    {
        BeforeValue();
        Byte((byte)'[');
        Push();
    }

    public void EndArray()
    {
        Pop();
        Byte((byte)']');
    }

    /// <summary>An object key; the next call writes its value.</summary>
    public void Key(string name)
    {
        Comma();
        QuotedString(name);
        Byte((byte)':');
        afterKey = true;
    }

    /// <summary>An integer key, as JavaScript writes one (keys are strings).</summary>
    public void Key(long name)
    {
        Comma();
        Span<byte> digits = stackalloc byte[24];
        name.TryFormat(digits, out var written, default, CultureInfo.InvariantCulture);
        Ensure(written + 3);
        buffer[length++] = (byte)'"';
        digits[..written].CopyTo(buffer.AsSpan(length));
        length += written;
        buffer[length++] = (byte)'"';
        buffer[length++] = (byte)':';
        afterKey = true;
    }

    /// <summary>A number; NaN and the infinities are <c>null</c>, as in JSON.stringify.</summary>
    public void Number(double v)
    {
        BeforeValue();
        if (double.IsNaN(v) || double.IsInfinity(v))
        {
            Ascii("null");
            return;
        }
        Span<char> chars = stackalloc char[40];
        JsMath.Format(v, chars, out var n);
        Ensure(n);
        for (var i = 0; i < n; i++)
        {
            buffer[length++] = (byte)chars[i];
        }
    }

    public void Number(long v)
    {
        BeforeValue();
        Ensure(24);
        v.TryFormat(buffer.AsSpan(length), out var written, default, CultureInfo.InvariantCulture);
        length += written;
    }

    public void Number(int v) => Number((long)v);

    /// <summary>A number or null (<see cref="double.NaN"/> is null too).</summary>
    public void NumberOrNull(double? v)
    {
        if (v is double d)
        {
            Number(d);
        }
        else
        {
            Null();
        }
    }

    public void String(string s)
    {
        BeforeValue();
        if (s == null)
        {
            Ascii("null");
            return;
        }
        QuotedString(s);
    }

    public void Bool(bool v)
    {
        BeforeValue();
        Ascii(v ? "true" : "false");
    }

    public void Null()
    {
        BeforeValue();
        Ascii("null");
    }

    /// <summary>A value from a <see cref="JsNode"/> tree.</summary>
    public void Node(JsNode node) => JsNode.Write(this, node);

    /// <summary>Already-serialized JSON for one value (written by this class).</summary>
    public void RawValue(ReadOnlySpan<byte> json)
    {
        BeforeValue();
        Ensure(json.Length);
        json.CopyTo(buffer.AsSpan(length));
        length += json.Length;
    }

    private void BeforeValue()
    {
        if (afterKey)
        {
            afterKey = false;
            return;
        }
        Comma();
    }

    private void Comma()
    {
        if (depth == 0)
        {
            return;
        }
        if (GetBit())
        {
            Byte((byte)',');
        }
        else
        {
            SetBit();
        }
    }

    private bool GetBit()
    {
        var level = depth - 1;
        return level < 64 ? (commas & (1UL << level)) != 0 : (deepCommas[(level - 64) / 64] & (1UL << ((level - 64) % 64))) != 0;
    }

    private void SetBit()
    {
        var level = depth - 1;
        if (level < 64)
        {
            commas |= 1UL << level;
        }
        else
        {
            deepCommas[(level - 64) / 64] |= 1UL << ((level - 64) % 64);
        }
    }

    private void Push()
    {
        depth++;
        var level = depth - 1;
        if (level < 64)
        {
            commas &= ~(1UL << level);
        }
        else
        {
            deepCommas ??= new ulong[4];
            if ((level - 64) / 64 >= deepCommas.Length)
            {
                Array.Resize(ref deepCommas, deepCommas.Length * 2);
            }
            deepCommas[(level - 64) / 64] &= ~(1UL << ((level - 64) % 64));
        }
    }

    private void Pop() => depth--;

    private void Byte(byte b)
    {
        Ensure(1);
        buffer[length++] = b;
    }

    private void Ascii(string s)
    {
        Ensure(s.Length);
        for (var i = 0; i < s.Length; i++)
        {
            buffer[length++] = (byte)s[i];
        }
    }

    private void Ensure(int extra)
    {
        if (length + extra <= buffer.Length)
        {
            return;
        }
        var next = ArrayPool<byte>.Shared.Rent(Math.Max(buffer.Length * 2, length + extra));
        buffer.AsSpan(0, length).CopyTo(next);
        ArrayPool<byte>.Shared.Return(buffer);
        buffer = next;
    }

    private static readonly byte[] Hex = "0123456789abcdef"u8.ToArray();

    /// <summary>JSON.stringify's QuoteJSONString.</summary>
    private void QuotedString(string s)
    {
        Ensure(s.Length * 3 + 2);
        buffer[length++] = (byte)'"';
        var runStart = 0;
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            if (c >= 0x20 && c != '"' && c != '\\' && !char.IsSurrogate(c))
            {
                continue;
            }
            if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]))
            {
                i++;
                continue;
            }
            Utf8(s, runStart, i);
            Ensure(6);
            buffer[length++] = (byte)'\\';
            switch (c)
            {
                case '"': buffer[length++] = (byte)'"'; break;
                case '\\': buffer[length++] = (byte)'\\'; break;
                case '\b': buffer[length++] = (byte)'b'; break;
                case '\f': buffer[length++] = (byte)'f'; break;
                case '\n': buffer[length++] = (byte)'n'; break;
                case '\r': buffer[length++] = (byte)'r'; break;
                case '\t': buffer[length++] = (byte)'t'; break;
                default:
                    buffer[length++] = (byte)'u';
                    buffer[length++] = Hex[(c >> 12) & 0xF];
                    buffer[length++] = Hex[(c >> 8) & 0xF];
                    buffer[length++] = Hex[(c >> 4) & 0xF];
                    buffer[length++] = Hex[c & 0xF];
                    break;
            }
            runStart = i + 1;
        }
        Utf8(s, runStart, s.Length);
        Ensure(1);
        buffer[length++] = (byte)'"';
    }

    private void Utf8(string s, int from, int to)
    {
        if (to <= from)
        {
            return;
        }
        var chars = s.AsSpan(from, to - from);
        Ensure(Encoding.UTF8.GetMaxByteCount(chars.Length));
        length += Encoding.UTF8.GetBytes(chars, buffer.AsSpan(length));
    }
}
