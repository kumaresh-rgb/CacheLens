namespace CacheLens.Core;

/// <summary>
/// Which cache abstraction a tracked entry (or an entire connection) came from.
/// </summary>
public enum CacheKind
{
    Memory = 0,
    Distributed = 1,
    Hybrid = 2,
}
