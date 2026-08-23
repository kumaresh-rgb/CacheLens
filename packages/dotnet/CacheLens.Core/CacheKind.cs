namespace CacheLens.Core;

/// <summary>
/// Which cache abstraction a tracked entry (or an entire connection) came from.
/// </summary>
public enum CacheKind
{
    /// <summary>An in-process <c>IMemoryCache</c> entry.</summary>
    Memory = 0,

    /// <summary>An <c>IDistributedCache</c> entry. Reserved — not yet tracked.</summary>
    Distributed = 1,

    /// <summary>A <c>HybridCache</c> entry. Reserved — L1 entries surface as <see cref="Memory"/> today.</summary>
    Hybrid = 2,
}
