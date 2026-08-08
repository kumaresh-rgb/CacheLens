namespace CacheLens.Core;

/// <summary>
/// Shape of the discovery file each running app instance writes to the shared instance
/// directory (see <see cref="InstanceDirectory"/>) so the extension can find it with no
/// manual host/port entry. One file per process, named "{ProcessId}.json", removed on
/// graceful shutdown.
/// </summary>
public sealed class CacheLensInstanceFile
{
    public required int ProcessId { get; init; }

    public required string ProcessName { get; init; }

    /// <summary>Base URL of the local endpoint, e.g. "http://127.0.0.1:53214".</summary>
    public required string Url { get; init; }

    /// <summary>Per-run secret the extension must send as a bearer token on every request.</summary>
    public required string Token { get; init; }

    public required DateTimeOffset StartedAt { get; init; }

    /// <summary>
    /// Shared per-user directory both sides agree on for instance discovery files.
    /// Mirrors the convention used by the .NET diagnostics IPC / dotnet-monitor.
    /// </summary>
    public static string InstanceDirectory =>
        Path.Combine(Path.GetTempPath(), "cachelens", "instances");
}
