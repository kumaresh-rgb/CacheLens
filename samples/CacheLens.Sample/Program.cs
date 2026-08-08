using CacheLens.AspNetCore;
using Microsoft.Extensions.Caching.Memory;

var builder = WebApplication.CreateBuilder(args);

// CacheLens is a development-time tool — gate it behind the environment so it's never
// accidentally active in production. See the "Safety defaults" section of the architecture
// plan for the rest of the guardrails (loopback + token auth, redaction, size caps).
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddCacheLens();
}

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapCacheLens();
}

var summaries = new[]
{
    "Freezing", "Bracing", "Chilly", "Cool", "Mild", "Warm", "Balmy", "Hot", "Sweltering", "Scorching",
};

// A typical cache-aside read: cached for 30s so repeated requests are served from memory.
// Watch this key's HitCount climb in the CacheLens viewer as you refresh.
app.MapGet("/weatherforecast", (IMemoryCache cache) =>
{
    return cache.GetOrCreate("weather-forecast", entry =>
    {
        entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
        return Enumerable.Range(1, 5).Select(index =>
                new WeatherForecast(
                    DateOnly.FromDateTime(DateTime.Now.AddDays(index)),
                    Random.Shared.Next(-20, 55),
                    summaries[Random.Shared.Next(summaries.Length)]))
            .ToArray();
    });
})
.WithName("GetWeatherForecast");

// A longer-lived value with a sliding expiration, to show CacheLens rendering a different
// expiration shape than the absolute one above.
app.MapGet("/profile/{userId}", (string userId, IMemoryCache cache) =>
{
    return cache.GetOrCreate($"profile:{userId}", entry =>
    {
        entry.SlidingExpiration = TimeSpan.FromMinutes(5);
        return new { userId, displayName = $"User {userId}", plan = "free" };
    });
});

// A key matching the default redaction patterns (see CacheLensOptions.RedactKeyPatterns) —
// CacheLens will show this entry exists (key, size, TTL) but never its value.
app.MapPost("/session/{userId}", (string userId, IMemoryCache cache) =>
{
    var token = Guid.NewGuid().ToString("N");
    cache.Set($"session-token:{userId}", token, TimeSpan.FromMinutes(10));
    return Results.Ok(new { userId, tokenIssued = true });
});

app.Run();

internal sealed record WeatherForecast(DateOnly Date, int TemperatureC, string? Summary)
{
    public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
}
