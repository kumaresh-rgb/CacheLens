namespace CacheLens.Core;

/// <summary>
/// Response body for <c>GET /_cachelens/meta</c> — the first thing the extension asks a
/// connection for, before trusting anything else it says.
/// </summary>
public sealed class HandshakeInfo
{
    /// <summary>Wire-protocol version this application speaks.</summary>
    public required int ProtocolVersion { get; init; }

    /// <summary>Entry assembly name of the running application.</summary>
    public required string ApplicationName { get; init; }

    /// <summary>Operating-system process id.</summary>
    public required int ProcessId { get; init; }

    /// <summary>Which cache kinds this application currently has tracked.</summary>
    public required IReadOnlyList<CacheKind> AvailableCacheKinds { get; init; }

    /// <summary>CacheLens.AspNetCore package version, for surfacing "please update" hints.</summary>
    public required string PackageVersion { get; init; }
}
