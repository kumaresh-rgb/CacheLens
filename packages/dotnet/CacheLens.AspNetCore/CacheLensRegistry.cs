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

    public IReadOnlyList<CacheKind> AvailableCacheKinds =>
        MemoryCache is not null ? [CacheKind.Memory] : [];

    public IReadOnlyList<CacheEntrySnapshot> Snapshot() =>
        MemoryCache?.Snapshot() ?? [];

    public bool Evict(string key) => MemoryCache?.EvictByKeyString(key) ?? false;

    public void Clear() => MemoryCache?.Clear();
}
