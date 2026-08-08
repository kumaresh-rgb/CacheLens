namespace CacheLens.AspNetCore;

/// <summary>
/// CacheLens's own record of one <see cref="TrackedMemoryCache"/> entry. Kept separately from
/// the real <c>MemoryCache</c> internals (which aren't a stable public surface to enumerate)
/// so tracking works the same way across .NET versions.
///
/// Instances are created and registered as a post-eviction-callback's state <em>before</em> the
/// real entry commits, then filled in afterwards — see the ordering note in
/// <see cref="TrackedMemoryCache"/>'s entry wrapper. That's what lets eviction handling remove
/// "this exact entry" by reference identity rather than "whatever's currently under this key",
/// which matters because <c>MemoryCache</c> invokes eviction callbacks on a thread-pool thread,
/// not synchronously — a same-keyed replacement can already be committed by the time an old
/// entry's callback runs.
/// </summary>
internal sealed class TrackedCacheEntry
{
    public required object Key { get; init; }

    public required string KeyString { get; init; }

    public object? Value { get; set; }

    public required DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset? LastAccessedAt { get; set; }

    public DateTimeOffset? AbsoluteExpiration { get; set; }

    public TimeSpan? SlidingExpiration { get; set; }

    /// <summary>Mutated via <see cref="System.Threading.Interlocked"/> from concurrent readers.</summary>
    public long HitCount;
}
