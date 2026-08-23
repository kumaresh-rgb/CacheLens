using CacheLens.Core;

namespace CacheLens.AspNetCore;

/// <summary>
/// Aggregates whichever tracked caches are registered in this app so the endpoints can stay
/// kind-agnostic. Only <see cref="TrackedMemoryCache"/> exists today (v1 scope); the same shape
/// is where <c>IDistributedCache</c>/<c>HybridCache</c> tracking plugs in later without changing
/// the endpoints.
/// </summary>
public sealed class CacheLensRegistry
{
    internal TrackedMemoryCache? MemoryCache { get; set; }

    /// <summary>Which cache kinds this application currently has tracked.</summary>
    public IReadOnlyList<CacheKind> AvailableCacheKinds =>
        MemoryCache is not null ? [CacheKind.Memory] : [];

    /// <summary>Every tracked entry across all registered caches.</summary>
    public IReadOnlyList<CacheEntrySnapshot> Snapshot() =>
        MemoryCache?.Snapshot() ?? [];

    /// <summary>Evicts one entry by its string key. Returns false if no such key is tracked.</summary>
    public bool Evict(string key) => MemoryCache?.EvictByKeyString(key) ?? false;

    /// <summary>Evicts every tracked entry.</summary>
    public void Clear() => MemoryCache?.Clear();
}
