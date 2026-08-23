using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Threading;
using CacheLens.Core;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Primitives;

namespace CacheLens.AspNetCore;

/// <summary>
/// Decorates a real <see cref="IMemoryCache"/> so every write, read, and eviction is mirrored
/// into a side index CacheLens can enumerate and serialize. <see cref="MemoryCache"/> itself
/// doesn't expose a stable, version-independent way to list its contents, so this class is the
/// mechanism that makes "seeing what's in the cache" possible at all — see the "Why a
/// side-index" note in the architecture plan.
///
/// All <see cref="IMemoryCache"/> members (including the <c>Set</c>/<c>Get</c>/<c>GetOrCreate</c>
/// extension methods in <c>Microsoft.Extensions.Caching.Memory.CacheExtensions</c>, which all
/// funnel through <see cref="CreateEntry"/>) work exactly as before — tracking is purely a side
/// effect.
/// </summary>
public sealed class TrackedMemoryCache : IMemoryCache
{
    private readonly IMemoryCache _inner;
    private readonly CacheLensOptions _options;
    private readonly ConcurrentDictionary<object, TrackedCacheEntry> _index = new();

    /// <summary>Wraps <paramref name="inner"/> so its contents can be enumerated and inspected.</summary>
    /// <param name="inner">The real cache every operation is delegated to.</param>
    /// <param name="options">Redaction and payload-size rules applied when building a snapshot.</param>
    public TrackedMemoryCache(IMemoryCache inner, CacheLensOptions options)
    {
        _inner = inner;
        _options = options;
    }

    /// <inheritdoc />
    public bool TryGetValue(object key, out object? value)
    {
        var found = _inner.TryGetValue(key, out value);
        if (found && _index.TryGetValue(key, out var entry))
        {
            Interlocked.Increment(ref entry.HitCount);
            entry.LastAccessedAt = DateTimeOffset.UtcNow;
        }

        return found;
    }

    /// <inheritdoc />
    public ICacheEntry CreateEntry(object key) => new TrackedCacheEntryWrapper(_inner.CreateEntry(key), key, this);

    /// <inheritdoc />
    public void Remove(object key)
    {
        _inner.Remove(key);
        _index.TryRemove(key, out _);
    }

    /// <summary>Current snapshot of tracked entries, serialized and redacted per the configured options.</summary>
    public IReadOnlyList<CacheEntrySnapshot> Snapshot()
    {
        var snapshot = new List<CacheEntrySnapshot>(_index.Count);
        foreach (var entry in _index.Values)
        {
            snapshot.Add(ToSnapshot(entry, _options));
        }

        return snapshot;
    }

    /// <summary>
    /// Evicts the entry whose <see cref="TrackedCacheEntry.KeyString"/> matches, for keys
    /// CacheLens can only address by their string form (e.g. from an HTTP route parameter).
    /// Non-string cache keys are still visible in <see cref="Snapshot"/> but can't be evicted
    /// this way today.
    /// </summary>
    public bool EvictByKeyString(string keyString)
    {
        var match = _index.Values.FirstOrDefault(e => e.KeyString == keyString);
        if (match is null)
        {
            return false;
        }

        Remove(match.Key);
        return true;
    }

    /// <summary>Evicts every tracked entry from both the real cache and the index.</summary>
    public void Clear()
    {
        foreach (var key in _index.Keys.ToArray())
        {
            _inner.Remove(key);
        }

        _index.Clear();
    }

    /// <inheritdoc />
    public void Dispose() => _inner.Dispose();

    private void OnEntryCommitted(object key, TrackedCacheEntry entry) => _index[key] = entry;

    /// <summary>
    /// Removes <paramref name="entry"/> only if it's still the entry currently indexed under
    /// <paramref name="key"/> — see the identity-race note on <see cref="TrackedCacheEntry"/>.
    /// A plain <c>_index.TryRemove(key, ...)</c> here would be a real bug: it could delete a
    /// brand-new entry that already replaced this one under the same key.
    /// </summary>
    private void OnEntryEvicted(object key, TrackedCacheEntry entry) =>
        ((ICollection<KeyValuePair<object, TrackedCacheEntry>>)_index)
            .Remove(new KeyValuePair<object, TrackedCacheEntry>(key, entry));

    private static CacheEntrySnapshot ToSnapshot(TrackedCacheEntry entry, CacheLensOptions options)
    {
        string? valueJson = null;
        ValueOmittedReason? omitted;
        long? sizeBytes = null;

        if (options.IsRedacted(entry.KeyString))
        {
            omitted = ValueOmittedReason.RedactedByKeyPattern;
        }
        else
        {
            try
            {
                var json = JsonSerializer.Serialize(entry.Value);
                sizeBytes = Encoding.UTF8.GetByteCount(json);
                if (sizeBytes > options.MaxValuePayloadBytes)
                {
                    omitted = ValueOmittedReason.ExceedsMaxSize;
                }
                else
                {
                    valueJson = json;
                    omitted = null;
                }
            }
            catch
            {
                // Not every cached type is JSON-serializable (circular refs, non-public
                // constructors, etc.) — that's still a valid thing to cache, just not one
                // CacheLens can show the value of.
                omitted = ValueOmittedReason.NotSerializable;
            }
        }

        return new CacheEntrySnapshot
        {
            Key = entry.KeyString,
            Kind = CacheKind.Memory,
            ValueType = entry.Value?.GetType().Name,
            ValueJson = valueJson,
            ValueOmitted = omitted,
            SizeBytes = sizeBytes,
            AbsoluteExpiration = entry.AbsoluteExpiration,
            SlidingExpirationSeconds = entry.SlidingExpiration?.TotalSeconds,
            CreatedAt = entry.CreatedAt,
            LastAccessedAt = entry.LastAccessedAt,
            HitCount = Interlocked.Read(ref entry.HitCount),
        };
    }

    /// <summary>
    /// Wraps the real <see cref="ICacheEntry"/> returned by <see cref="IMemoryCache.CreateEntry"/>.
    /// The real entry only actually commits into the cache on <see cref="Dispose"/> (that's how
    /// <c>IMemoryCache</c> works), so that's also the only point at which CacheLens can capture
    /// a final, accurate snapshot of what was written.
    /// </summary>
    private sealed class TrackedCacheEntryWrapper : ICacheEntry
    {
        private readonly ICacheEntry _inner;
        private readonly object _key;
        private readonly TrackedMemoryCache _owner;
        private bool _committed;

        public TrackedCacheEntryWrapper(ICacheEntry inner, object key, TrackedMemoryCache owner)
        {
            _inner = inner;
            _key = key;
            _owner = owner;
        }

        public object Key => _inner.Key;

        public object? Value
        {
            get => _inner.Value;
            set => _inner.Value = value;
        }

        public DateTimeOffset? AbsoluteExpiration
        {
            get => _inner.AbsoluteExpiration;
            set => _inner.AbsoluteExpiration = value;
        }

        public TimeSpan? AbsoluteExpirationRelativeToNow
        {
            get => _inner.AbsoluteExpirationRelativeToNow;
            set => _inner.AbsoluteExpirationRelativeToNow = value;
        }

        public TimeSpan? SlidingExpiration
        {
            get => _inner.SlidingExpiration;
            set => _inner.SlidingExpiration = value;
        }

        public IList<IChangeToken> ExpirationTokens => _inner.ExpirationTokens;

        public IList<PostEvictionCallbackRegistration> PostEvictionCallbacks => _inner.PostEvictionCallbacks;

        public CacheItemPriority Priority
        {
            get => _inner.Priority;
            set => _inner.Priority = value;
        }

        public long? Size
        {
            get => _inner.Size;
            set => _inner.Size = value;
        }

        public void Dispose()
        {
            if (_committed)
            {
                return;
            }

            _committed = true;

            // Built now (not after Dispose) and mutated in place afterwards, so the exact same
            // instance can serve as both the post-eviction-callback's identity token and the
            // value ultimately stored in the index — see the note on TrackedCacheEntry.
            var now = DateTimeOffset.UtcNow;
            var trackedEntry = new TrackedCacheEntry
            {
                Key = _key,
                KeyString = _key.ToString() ?? "<null>",
                CreatedAt = now,
                LastAccessedAt = now,
            };

            _inner.PostEvictionCallbacks.Add(new PostEvictionCallbackRegistration
            {
                EvictionCallback = static (key, _, _, state) =>
                {
                    var (owner, entry) = ((TrackedMemoryCache, TrackedCacheEntry))state!;
                    owner.OnEntryEvicted(key, entry);
                },
                State = (_owner, trackedEntry),
            });

            // Disposing the real entry is what commits it into the underlying MemoryCache, and
            // is also what resolves AbsoluteExpirationRelativeToNow into a concrete
            // AbsoluteExpiration on this same object — so expiration must be read back
            // afterwards, not before.
            _inner.Dispose();

            trackedEntry.Value = _inner.Value;
            trackedEntry.AbsoluteExpiration = _inner.AbsoluteExpiration;
            trackedEntry.SlidingExpiration = _inner.SlidingExpiration;

            _owner.OnEntryCommitted(_key, trackedEntry);
        }
    }
}
