using System.Diagnostics;
using System.Text.Json;
using CacheLens.Core;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CacheLens.AspNetCore;

/// <summary>
/// Writes the discovery file the VS Code extension watches for on app startup, and removes it
/// on graceful shutdown, so a developer never has to type in a host/port by hand — see
/// <see cref="CacheLensInstanceFile"/>.
/// </summary>
internal sealed class CacheLensDiscoveryHostedService : IHostedService
{
    // camelCase to match the naming policy Minimal APIs use for the HTTP responses by default —
    // the extension's JSON parsing shouldn't have to special-case this one file's casing.
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IServer _server;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly CacheLensRuntimeState _runtimeState;
    private readonly ILogger<CacheLensDiscoveryHostedService> _logger;
    private string? _instanceFilePath;

    public CacheLensDiscoveryHostedService(
        IServer server,
        IHostApplicationLifetime lifetime,
        CacheLensRuntimeState runtimeState,
        ILogger<CacheLensDiscoveryHostedService> logger)
    {
        _server = server;
        _lifetime = lifetime;
        _runtimeState = runtimeState;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        // The server hasn't bound its addresses yet at StartAsync time, so hook the lifetime
        // events instead of doing this inline here.
        _lifetime.ApplicationStarted.Register(WriteInstanceFile);
        _lifetime.ApplicationStopping.Register(DeleteInstanceFile);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private void WriteInstanceFile()
    {
        var address = _server.Features.Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault();
        if (address is null)
        {
            _logger.LogWarning(
                "CacheLens couldn't determine this app's listening address; the VS Code extension won't auto-discover it.");
            return;
        }

        try
        {
            Directory.CreateDirectory(CacheLensInstanceFile.InstanceDirectory);

            var process = Process.GetCurrentProcess();
            var file = new CacheLensInstanceFile
            {
                ProcessId = process.Id,
                ProcessName = process.ProcessName,
                Url = NormalizeAddress(address),
                Token = _runtimeState.Token,
                StartedAt = DateTimeOffset.UtcNow,
            };

            _instanceFilePath = Path.Combine(CacheLensInstanceFile.InstanceDirectory, $"{process.Id}.json");
            File.WriteAllText(_instanceFilePath, JsonSerializer.Serialize(file, JsonOptions));
            _logger.LogInformation("CacheLens is tracking this app's caches at {Url}", file.Url);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex, "CacheLens couldn't write its discovery file; auto-discovery won't find this instance.");
        }
    }

    private void DeleteInstanceFile()
    {
        if (_instanceFilePath is null)
        {
            return;
        }

        try
        {
            File.Delete(_instanceFilePath);
        }
        catch
        {
            // Best-effort cleanup: a stale file just means the extension shows a dead instance
            // until a connection attempt fails and it prunes the entry.
        }
    }

    /// <summary>
    /// Kestrel addresses like "http://[::]:5000" or "http://+:5000" (all interfaces) aren't
    /// dialable as literal URLs — swap the wildcard host for loopback, which is where the
    /// endpoint is reachable anyway (non-loopback requests are rejected regardless, see the
    /// auth filter in <see cref="CacheLensEndpointExtensions"/>).
    /// </summary>
    private static string NormalizeAddress(string address) =>
        address
            .Replace("://+", "://127.0.0.1", StringComparison.Ordinal)
            .Replace("://[::]", "://127.0.0.1", StringComparison.Ordinal)
            .Replace("://0.0.0.0", "://127.0.0.1", StringComparison.Ordinal);
}
