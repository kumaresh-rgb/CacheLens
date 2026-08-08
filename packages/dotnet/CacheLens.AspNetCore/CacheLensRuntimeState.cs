namespace CacheLens.AspNetCore;

/// <summary>
/// Per-process runtime state shared between the discovery file writer and the endpoint auth
/// check — most importantly the random bearer token that gates every <c>/_cachelens/*</c>
/// request. Generated once per process start; never persisted anywhere but the (gitignored,
/// per-user, transient) discovery file.
/// </summary>
internal sealed class CacheLensRuntimeState
{
    public string Token { get; } = Guid.NewGuid().ToString("N");
}
