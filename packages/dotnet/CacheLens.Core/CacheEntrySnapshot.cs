namespace CacheLens.Core;

/// <summary>
/// A point-in-time view of one cache entry, as sent to the VS Code extension over
/// <c>/_cachelens/snapshot</c> and <c>/_cachelens/stream</c>. Deliberately flat and
/// serialization-friendly (System.Text.Json) rather than mirroring internal decorator types.
/// </summary>
public sealed class CacheEntrySnapshot
{
    /// <summary>Cache key rendered as a string (the real key may be any object).</summary>
    public required string Key { get; init; }

    /// <summary>Which cache abstraction this entry came from.</summary>
    public required CacheKind Kind { get; init; }

    /// <summary>CLR type name of the cached value, e.g. "WeatherForecast[]". Null if unknown.</summary>
    public string? ValueType { get; init; }

    /// <summary>
    /// The value serialized to JSON for display, or null when redacted / not serializable /
    /// over the configured <c>CacheLensOptions.MaxValuePayloadBytes</c> ceiling. See
    /// <see cref="ValueOmittedReason"/> for which applies.
    /// </summary>
    public string? ValueJson { get; init; }

    /// <summary>Why <see cref="ValueJson"/> is null, if it is. Null when a value is present.</summary>
    public ValueOmittedReason? ValueOmitted { get; init; }

    /// <summary>Estimated size in bytes of the serialized value, when known.</summary>
    public long? SizeBytes { get; init; }

    /// <summary>When this entry expires outright, if an absolute expiration was set.</summary>
    public DateTimeOffset? AbsoluteExpiration { get; init; }

    /// <summary>Sliding expiration window, if configured, in seconds.</summary>
    public double? SlidingExpirationSeconds { get; init; }

    /// <summary>When CacheLens first observed this entry being committed.</summary>
    public required DateTimeOffset CreatedAt { get; init; }

    /// <summary>When this entry was last read through the tracked cache.</summary>
    public DateTimeOffset? LastAccessedAt { get; init; }

    /// <summary>Number of successful reads observed for this key since it was created.</summary>
    public long HitCount { get; init; }
}

/// <summary>Why a snapshot carries no value for an entry.</summary>
public enum ValueOmittedReason
{
    /// <summary>The key matched a configured redaction pattern.</summary>
    RedactedByKeyPattern = 0,

    /// <summary>The serialized value was larger than the configured payload ceiling.</summary>
    ExceedsMaxSize = 1,

    /// <summary>The value could not be serialized to JSON.</summary>
    NotSerializable = 2,
}
