using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace PtCatch.Engine.Js;

public enum JsKind : byte
{
    Undefined,
    Null,
    Bool,
    Number,
    String,
    Array,
    Object,
}

/// <summary>
/// A JSON value with JavaScript's semantics, for the small, loosely shaped files: the bot's weekly, hill, bounty and
/// economy files, the exporter's state, and the activity events built from them. It keeps what JSON.parse then
/// JSON.stringify would: object keys in insertion order, except integer-like keys, which JavaScript always lists
/// first in ascending order; a repeated key keeps its first position and its last value; undefined properties are
/// left out and undefined array items are null. The big, regular files never go through this; they are written column
/// by column with <see cref="JsJsonWriter"/>.
/// </summary>
public sealed class JsNode
{
    public static readonly JsNode Undefined = new(JsKind.Undefined);
    public static readonly JsNode NullValue = new(JsKind.Null);
    public static readonly JsNode True = new(JsKind.Bool) { boolean = true };
    public static readonly JsNode False = new(JsKind.Bool) { boolean = false };

    public readonly JsKind Kind;
    private double number;
    private string text;
    private bool boolean;
    private List<JsNode> items;
    private List<KeyValuePair<string, JsNode>> props;
    private Dictionary<string, int> index;

    private JsNode(JsKind kind)
    {
        Kind = kind;
    }

    public static JsNode Num(double v) => new(JsKind.Number) { number = v };

    public static JsNode Str(string s) => s == null ? NullValue : new(JsKind.String) { text = s };

    public static JsNode Bool(bool b) => b ? True : False;

    public static JsNode NumOrNull(double? v) => v is double d ? Num(d) : NullValue;

    public static JsNode Array(int capacity = 4) => new(JsKind.Array) { items = new List<JsNode>(capacity) };

    public static JsNode Object() => new(JsKind.Object) { props = new List<KeyValuePair<string, JsNode>>() };

    public static JsNode ArrayOf(params JsNode[] values)
    {
        var a = Array(values.Length);
        a.items.AddRange(values);
        return a;
    }

    public bool IsUndefined => Kind == JsKind.Undefined;

    public bool IsNullish => Kind is JsKind.Undefined or JsKind.Null;

    public bool IsArray => Kind == JsKind.Array;

    public bool IsObject => Kind == JsKind.Object;

    public bool IsString => Kind == JsKind.String;

    public bool IsNumber => Kind == JsKind.Number;

    public bool IsBool => Kind == JsKind.Bool;

    /// <summary>The number of an Number node (NaN otherwise; use <see cref="ToNumber"/> for JavaScript's coercion).</summary>
    public double Number => Kind == JsKind.Number ? number : double.NaN;

    public string Text => Kind == JsKind.String ? text : null;

    public bool BoolValue => Kind == JsKind.Bool && boolean;

    public int Count => Kind == JsKind.Array ? items.Count : Kind == JsKind.Object ? props.Count : 0;

    public IReadOnlyList<JsNode> Items => items ?? (IReadOnlyList<JsNode>)System.Array.Empty<JsNode>();

    public IReadOnlyList<KeyValuePair<string, JsNode>> Props => props ?? (IReadOnlyList<KeyValuePair<string, JsNode>>)System.Array.Empty<KeyValuePair<string, JsNode>>();

    /// <summary>An array item or object property; <see cref="Undefined"/> when there is none (or this isn't one).</summary>
    public JsNode this[int i] => Kind == JsKind.Array && i >= 0 && i < items.Count ? items[i] : Undefined;

    public JsNode this[string key]
    {
        get
        {
            if (Kind != JsKind.Object)
            {
                return Undefined;
            }
            if (index != null)
            {
                return index.TryGetValue(key, out var i) ? props[i].Value : Undefined;
            }
            for (var i = 0; i < props.Count; i++)
            {
                if (props[i].Key == key)
                {
                    return props[i].Value;
                }
            }
            return Undefined;
        }
        set => Set(key, value);
    }

    public bool Has(string key) => !this[key].IsUndefined;

    /// <summary>Sets a property: a new key goes last, an existing one keeps its place.</summary>
    public JsNode Set(string key, JsNode value)
    {
        if (Kind != JsKind.Object)
        {
            throw new InvalidOperationException("Not an object");
        }
        if (index == null && props.Count >= 12)
        {
            index = new Dictionary<string, int>(props.Count * 2, StringComparer.Ordinal);
            for (var i = 0; i < props.Count; i++)
            {
                index[props[i].Key] = i;
            }
        }
        if (index != null)
        {
            if (index.TryGetValue(key, out var at))
            {
                props[at] = new KeyValuePair<string, JsNode>(key, value);
            }
            else
            {
                index[key] = props.Count;
                props.Add(new KeyValuePair<string, JsNode>(key, value));
            }
            return this;
        }
        for (var i = 0; i < props.Count; i++)
        {
            if (props[i].Key == key)
            {
                props[i] = new KeyValuePair<string, JsNode>(key, value);
                return this;
            }
        }
        props.Add(new KeyValuePair<string, JsNode>(key, value));
        return this;
    }

    public JsNode Set(string key, double value) => Set(key, Num(value));

    public JsNode Set(string key, string value) => Set(key, Str(value));

    public JsNode Set(string key, bool value) => Set(key, Bool(value));

    /// <summary><c>delete obj[key]</c>.</summary>
    public void Remove(string key)
    {
        if (Kind != JsKind.Object)
        {
            return;
        }
        for (var i = 0; i < props.Count; i++)
        {
            if (props[i].Key == key)
            {
                props.RemoveAt(i);
                if (index != null)
                {
                    index = null;
                }
                return;
            }
        }
    }

    public JsNode Add(JsNode value)
    {
        items.Add(value);
        return this;
    }

    public JsNode Add(double value) => Add(Num(value));

    public JsNode Add(string value) => Add(Str(value));

    /// <summary>JavaScript truthiness.</summary>
    public bool Truthy => Kind switch
    {
        JsKind.Undefined or JsKind.Null => false,
        JsKind.Bool => boolean,
        JsKind.Number => number != 0 && !double.IsNaN(number),
        JsKind.String => text.Length > 0,
        _ => true,
    };

    /// <summary>JavaScript's <c>Number(x)</c>.</summary>
    public double ToNumber() => Kind switch
    {
        JsKind.Undefined => double.NaN,
        JsKind.Null => 0,
        JsKind.Bool => boolean ? 1 : 0,
        JsKind.Number => number,
        JsKind.String => StringToNumber(text),
        JsKind.Array => items.Count == 0 ? 0 : items.Count == 1 ? items[0].ToNumber() : double.NaN,
        _ => double.NaN,
    };

    /// <summary><c>Number.isSafeInteger(x)</c>: false for anything but a number.</summary>
    public bool IsSafeInteger => Kind == JsKind.Number && JsMath.IsSafeInteger(number);

    /// <summary><c>Number(s)</c> for a string: trimmed, empty is 0, anything that isn't a whole numeric literal is NaN.</summary>
    public static double StringToNumber(string s)
    {
        var t = s.Trim();
        if (t.Length == 0)
        {
            return 0;
        }
        if (t.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            return long.TryParse(t.AsSpan(2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var hex) ? hex : double.NaN;
        }
        if (t is "Infinity" or "+Infinity")
        {
            return double.PositiveInfinity;
        }
        if (t == "-Infinity")
        {
            return double.NegativeInfinity;
        }
        foreach (var c in t)
        {
            if (!(char.IsAsciiDigit(c) || c is '.' or 'e' or 'E' or '+' or '-'))
            {
                return double.NaN;
            }
        }
        return double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : double.NaN;
    }

    /// <summary>Whether JavaScript treats a property key as an array index (listed first, in numeric order).</summary>
    public static bool IsIndexKey(string key, out uint value)
    {
        value = 0;
        if (key.Length == 0 || key.Length > 10 || (key.Length > 1 && key[0] == '0'))
        {
            return false;
        }
        ulong v = 0;
        foreach (var c in key)
        {
            if (!char.IsAsciiDigit(c))
            {
                return false;
            }
            v = v * 10 + (ulong)(c - '0');
        }
        if (v >= uint.MaxValue)
        {
            return false;
        }
        value = (uint)v;
        return true;
    }

    // ---- Parsing ----------------------------------------------------------------------------------------------

    /// <summary>JSON.parse, from UTF-8 (a leading byte-order mark is skipped, as the exporter's loaders do).</summary>
    public static JsNode Parse(ReadOnlySpan<byte> utf8)
    {
        if (utf8.StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF]))
        {
            utf8 = utf8[3..];
        }
        var reader = new Utf8JsonReader(utf8, new JsonReaderOptions { MaxDepth = 256 });
        reader.Read();
        return Read(ref reader);
    }

    public static JsNode Parse(string json) => Parse(Encoding.UTF8.GetBytes(json));

    /// <summary>Reads the value the reader is on, leaving the reader on its last token.</summary>
    public static JsNode Read(ref Utf8JsonReader reader)
    {
        switch (reader.TokenType)
        {
            case JsonTokenType.Null:
                return NullValue;
            case JsonTokenType.True:
                return True;
            case JsonTokenType.False:
                return False;
            case JsonTokenType.Number:
                return Num(reader.GetDouble());
            case JsonTokenType.String:
                return Str(reader.GetString());
            case JsonTokenType.StartArray:
            {
                var a = Array();
                while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                {
                    a.items.Add(Read(ref reader));
                }
                return a;
            }
            case JsonTokenType.StartObject:
            {
                var o = Object();
                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                {
                    var key = reader.GetString();
                    reader.Read();
                    o.Set(key, Read(ref reader));
                }
                return o;
            }
            default:
                throw new JsonException($"Unexpected {reader.TokenType}");
        }
    }

    // ---- Writing ----------------------------------------------------------------------------------------------

    public static void Write(JsJsonWriter w, JsNode node)
    {
        switch (node.Kind)
        {
            case JsKind.Undefined:
            case JsKind.Null:
                w.Null();
                return;
            case JsKind.Bool:
                w.Bool(node.boolean);
                return;
            case JsKind.Number:
                w.Number(node.number);
                return;
            case JsKind.String:
                w.String(node.text);
                return;
            case JsKind.Array:
                w.BeginArray();
                foreach (var item in node.items)
                {
                    Write(w, item);
                }
                w.EndArray();
                return;
            default:
                w.BeginObject();
                foreach (var (key, value) in OrderedProps(node))
                {
                    if (value.IsUndefined)
                    {
                        continue;
                    }
                    w.Key(key);
                    Write(w, value);
                }
                w.EndObject();
                return;
        }
    }

    /// <summary>An object's properties in JavaScript's enumeration order: index keys ascending, then the rest as inserted.</summary>
    public static IEnumerable<KeyValuePair<string, JsNode>> OrderedProps(JsNode node)
    {
        if (node.Kind != JsKind.Object)
        {
            yield break;
        }
        List<(uint, KeyValuePair<string, JsNode>)> indexed = null;
        foreach (var p in node.props)
        {
            if (IsIndexKey(p.Key, out var v))
            {
                (indexed ??= new List<(uint, KeyValuePair<string, JsNode>)>()).Add((v, p));
            }
        }
        if (indexed != null)
        {
            indexed.Sort((a, b) => a.Item1.CompareTo(b.Item1));
            foreach (var (_, p) in indexed)
            {
                yield return p;
            }
        }
        foreach (var p in node.props)
        {
            if (indexed == null || !IsIndexKey(p.Key, out _))
            {
                yield return p;
            }
        }
    }

    /// <summary>JSON.stringify of this value, as a string.</summary>
    public string Stringify()
    {
        using var w = new JsJsonWriter(1024);
        Write(w, this);
        return Encoding.UTF8.GetString(w.Written);
    }

    public override string ToString() => Stringify();
}
