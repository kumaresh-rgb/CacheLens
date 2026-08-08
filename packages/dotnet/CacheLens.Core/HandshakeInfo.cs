namespace CacheLens.Core;

/// <summary>
/// Response body for <c>GET /_cachelens/meta</c> — the first thing the extension asks a
/// connection for, before trusting anything else it says.
/// </summary>
public sealed class HandshakeInfo
{
    public required int ProtocolVersion { get; init; }

    public required string ApplicationName { get; init; }

    public required int ProcessId { get; init; }

    public required IReadOnlyList<CacheKind> AvailableCacheKinds { get; init; }

    /// <summary>CacheLens.AspNetCore package version, for surfacing "please update" hints.</summary>
    public required string PackageVersion { get; init; }
}
