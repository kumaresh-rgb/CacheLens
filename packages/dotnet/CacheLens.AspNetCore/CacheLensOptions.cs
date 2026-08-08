namespace CacheLens.AspNetCore;

/// <summary>
/// Options for <c>AddCacheLens()</c>. Defaults are deliberately conservative — CacheLens is a
/// development-time tool, and the safe default is "off unless you're clearly in dev."
/// </summary>
public sealed class CacheLensOptions
{
    /// <summary>
    /// Whether the CacheLens endpoints and tracking decorators are active at all. Defaults to
    /// true; callers typically gate the whole call to <c>AddCacheLens()</c> behind
    /// <c>builder.Environment.IsDevelopment()</c> rather than toggling this, but it's here for
    /// config-driven opt-in/opt-out too.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Route prefix the endpoints are mapped under. Defaults to "/_cachelens".</summary>
    public string RoutePrefix { get; set; } = "/_cachelens";

    /// <summary>
    /// Case-insensitive substrings matched against cache keys. A matching key's value is never
    /// sent to the client — only its metadata (size, expiration, hit count) — even though the
    /// endpoint itself is localhost + token protected. Defaults cover common secret-shaped key
    /// names.
    /// </summary>
    public List<string> RedactKeyPatterns { get; set; } =
    [
        "password", "secret", "token", "apikey", "api-key", "connectionstring", "credential",
    ];

    /// <summary>
    /// Values whose serialized JSON exceeds this size are reported as omitted rather than sent
    /// in full, to keep the endpoint cheap and avoid shipping huge blobs to the editor.
    /// </summary>
    public int MaxValuePayloadBytes { get; set; } = 64 * 1024;

    /// <summary>
    /// Whether to write a discovery file under <see cref="Core.CacheLensInstanceFile.InstanceDirectory"/>
    /// on startup so the VS Code extension can find this instance with no manual configuration.
    /// </summary>
    public bool EnableDiscovery { get; set; } = true;

    internal bool IsRedacted(string key)
    {
        foreach (var pattern in RedactKeyPatterns)
        {
            if (key.Contains(pattern, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
