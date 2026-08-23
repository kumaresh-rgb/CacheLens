using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CacheLens.AspNetCore;

/// <summary>Dependency-injection entry point for CacheLens.</summary>
public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Wraps this app's <see cref="IMemoryCache"/> registration so CacheLens can track and
    /// expose its contents, and registers the plumbing <see cref="CacheLensEndpointExtensions.MapCacheLens"/>
    /// needs. Call <c>app.MapCacheLens()</c> after building the app to expose the endpoints.
    ///
    /// Typical usage gates this behind the environment, since it's a development-time tool:
    /// <code>
    /// if (builder.Environment.IsDevelopment())
    /// {
    ///     builder.Services.AddCacheLens();
    /// }
    /// </code>
    /// </summary>
    public static IServiceCollection AddCacheLens(this IServiceCollection services, Action<CacheLensOptions>? configure = null)
    {
        var options = new CacheLensOptions();
        configure?.Invoke(options);
        services.AddSingleton(options);

        if (!options.Enabled)
        {
            return services;
        }

        services.AddSingleton<CacheLensRuntimeState>();
        services.AddSingleton<CacheLensRegistry>();

        // Make sure an IMemoryCache exists at all (no-ops via TryAdd if the app already
        // registered one), then swap it for a tracked decorator wrapping whatever was there —
        // the app's own Set/Get/GetOrCreate calls keep working unchanged.
        services.AddMemoryCache();

        var descriptor = services.LastOrDefault(d => d.ServiceType == typeof(IMemoryCache));
        if (descriptor is not null)
        {
            services.Remove(descriptor);

            services.AddSingleton(sp =>
            {
                var inner = (IMemoryCache)CreateFromDescriptor(descriptor, sp);
                var tracked = new TrackedMemoryCache(inner, sp.GetRequiredService<CacheLensOptions>());
                sp.GetRequiredService<CacheLensRegistry>().MemoryCache = tracked;
                return tracked;
            });
            services.AddSingleton<IMemoryCache>(sp => sp.GetRequiredService<TrackedMemoryCache>());
        }

        if (options.EnableDiscovery)
        {
            services.AddHostedService<CacheLensDiscoveryHostedService>();
        }

        return services;
    }

    /// <summary>
    /// Builds whatever <see cref="IMemoryCache"/> the app (or <c>AddMemoryCache()</c>) had
    /// already registered, from its original <see cref="ServiceDescriptor"/>, so CacheLens can
    /// wrap it instead of silently replacing it with a second, disconnected cache instance.
    /// </summary>
    private static object CreateFromDescriptor(ServiceDescriptor descriptor, IServiceProvider serviceProvider)
    {
        if (descriptor.ImplementationInstance is not null)
        {
            return descriptor.ImplementationInstance;
        }

        if (descriptor.ImplementationFactory is not null)
        {
            return descriptor.ImplementationFactory(serviceProvider);
        }

        if (descriptor.ImplementationType is not null)
        {
            return ActivatorUtilities.CreateInstance(serviceProvider, descriptor.ImplementationType);
        }

        throw new InvalidOperationException(
            $"CacheLens couldn't resolve the existing {nameof(IMemoryCache)} registration to wrap it.");
    }
}
