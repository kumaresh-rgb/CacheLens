using System.Net;
using System.Reflection;
using CacheLens.Core;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace CacheLens.AspNetCore;

public static class CacheLensEndpointExtensions
{
    /// <summary>
    /// Maps the <c>/_cachelens/*</c> endpoints the VS Code extension talks to. Call after
    /// <c>AddCacheLens()</c> was used in <c>ConfigureServices</c>. Every request under this
    /// prefix is rejected unless it comes from loopback and carries this process's current
    /// bearer token (see <see cref="CacheLensRuntimeState"/>) — CacheLens is meant to run
    /// side-by-side with the app it's inspecting, never as a remotely reachable surface.
    /// </summary>
    public static IEndpointRouteBuilder MapCacheLens(this IEndpointRouteBuilder endpoints)
    {
        var options = endpoints.ServiceProvider.GetRequiredService<CacheLensOptions>();
        if (!options.Enabled)
        {
            return endpoints;
        }

        var group = endpoints.MapGroup(options.RoutePrefix).AddEndpointFilter(RequireLocalAuthenticatedCaller);

        group.MapGet("/meta", (CacheLensRegistry registry) => Results.Ok(new HandshakeInfo
        {
            ProtocolVersion = ProtocolVersion.Current,
            ApplicationName = Assembly.GetEntryAssembly()?.GetName().Name ?? "unknown",
            ProcessId = Environment.ProcessId,
            AvailableCacheKinds = registry.AvailableCacheKinds,
            PackageVersion = typeof(CacheLensEndpointExtensions).Assembly.GetName().Version?.ToString() ?? "0.0.0",
        }));

        group.MapGet("/snapshot", (CacheLensRegistry registry) => Results.Ok(registry.Snapshot()));

        group.MapPost("/evict/{key}", (string key, CacheLensRegistry registry) =>
            registry.Evict(key) ? Results.Ok() : Results.NotFound());

        group.MapPost("/clear", (CacheLensRegistry registry) =>
        {
            registry.Clear();
            return Results.Ok();
        });

        return endpoints;
    }

    private static async ValueTask<object?> RequireLocalAuthenticatedCaller(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;

        var remoteIp = http.Connection.RemoteIpAddress;
        if (remoteIp is null || !IPAddress.IsLoopback(remoteIp))
        {
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        var runtimeState = http.RequestServices.GetRequiredService<CacheLensRuntimeState>();
        var expected = $"Bearer {runtimeState.Token}";
        if (http.Request.Headers.Authorization != expected)
        {
            return Results.StatusCode(StatusCodes.Status401Unauthorized);
        }

        return await next(context);
    }
}
