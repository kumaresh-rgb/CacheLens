namespace CacheLens.Core;

/// <summary>
/// The CacheLens wire protocol version spoken by this build of the library.
/// Bump this whenever the shape of <see cref="CacheEntrySnapshot"/>, <see cref="HandshakeInfo"/>,
/// or the endpoint contracts change in a way clients need to feature-detect.
///
/// The VS Code extension and the NuGet package version independently in the wild, so this is the
/// one thing both sides must agree on to stay compatible — see the "Wire Protocol &amp;
/// Compatibility" section of the architecture plan.
/// </summary>
public static class ProtocolVersion
{
    public const int Current = 1;
}
