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

    public required CacheKind Kind { get; init; }

    /// <summary>CLR type name of the cached value, e.g. "WeatherForecast[]". Null if unknown.</summary>
    public string? ValueType { get; init; }

    /// <summary>
    /// The value serialized to JSON for display, or null when redacted / not serializable /
    /// over <see cref="CacheLensOptions.MaxValuePayloadBytes"/>. See <see cref="ValueOmittedReason"/>.
    /// </summary>
    public string? ValueJson { get; init; }

    /// <summary>Why <see cref="ValueJson"/> is null, if it is. Null when a value is present.</summary>
    public ValueOmittedReason? ValueOmitted { get; init; }

    /// <summary>Estimated size in bytes of the serialized value, when known.</summary>
    public long? SizeBytes { get; init; }

    public DateTimeOffset? AbsoluteExpiration { get; init; }

    /// <summary>Sliding expiration window, if configured, in seconds.</summary>
    public double? SlidingExpirationSeconds { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset? LastAccessedAt { get; init; }

    /// <summary>Number of successful reads observed for this key since it was created.</summary>
    public long HitCount { get; init; }
}

public enum ValueOmittedReason
{
    RedactedByKeyPattern = 0,
    ExceedsMaxSize = 1,
    NotSerializable = 2,
}
