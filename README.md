# CacheLens

See what's actually inside your ASP.NET Core `IMemoryCache` at runtime — keys, values, size,
expiration, hit/miss counts — the way you'd browse keys in Redis. .NET gives you no built-in way
to do this today; CacheLens fills that gap.

> **Status: pre-release.** The `IMemoryCache` tracking package, its local HTTP endpoint, and the
> VS Code extension (tree view + webview inspector) all work end-to-end against the sample app
> (see [Quick start](#quick-start) below). Nothing is published yet — no NuGet package, no
> Marketplace listing — this is all run-from-source today. See [Roadmap](#roadmap) for what's
> left, and [`docs/architecture.md`](docs/architecture.md) for the full architecture and status.

## Why

`IMemoryCache` doesn't expose enumeration, so every team ends up hand-rolling debug endpoints or
reflecting into `MemoryCache` internals to answer "what's actually in the cache right now?".
CacheLens wraps your cache registrations so that question has a real answer, without changing how
you call `Set`/`Get`/`GetOrCreate` anywhere in your app.

## Repository layout

```
packages/dotnet/CacheLens.Core         Shared contracts and wire-protocol DTOs
packages/dotnet/CacheLens.AspNetCore   The package you actually install
packages/vscode-extension              The VS Code extension (tree view + webview inspector)
samples/CacheLens.Sample               Minimal API app exercising the package
docs/architecture.md                   Full architecture + roadmap
```

## Quick start

```bash
dotnet add package CacheLens.AspNetCore   # not published yet — build locally for now, see below
```

```csharp
var builder = WebApplication.CreateBuilder(args);

if (builder.Environment.IsDevelopment())
{
    builder.Services.AddCacheLens(); // wraps your existing IMemoryCache registration
}

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapCacheLens(); // exposes /_cachelens/* — localhost + token protected, see below
}
```

Run your app, open the **CacheLens** view in VS Code's Activity Bar (see below to run the
extension from source — it's not on the Marketplace yet), and it shows up automatically: no
host, port, or token to type in anywhere.

### Try it with the sample app

```bash
# terminal 1 — the app being inspected
cd samples/CacheLens.Sample
dotnet run
curl http://localhost:5225/weatherforecast     # populate the cache
curl http://localhost:5225/profile/42
curl -X POST http://localhost:5225/session/42  # a redacted key, by name pattern
```

```bash
# terminal 2 — build the extension, then run it from VS Code
cd packages/vscode-extension
npm install
npm run bundle
```

Then open `packages/vscode-extension` as a folder in VS Code and press **F5** to launch an
Extension Development Host — the sample app should appear in the CacheLens view within a couple
of seconds, with `weather-forecast` and `profile:42` showing their values and `session-token:42`
showing as redacted.

Prefer the raw HTTP API? The console log line CacheLens prints
(`CacheLens is tracking this app's caches at http://127.0.0.1:PORT`) and the discovery file at
`%TEMP%/cachelens/instances/<pid>.json` have everything you need:

```bash
TOKEN=$(cat "$TEMP/cachelens/instances/"*.json | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -H "Authorization: Bearer $TOKEN" http://localhost:5225/_cachelens/snapshot
```

### Endpoints

All under the configurable `RoutePrefix` (default `/_cachelens`), all requiring a loopback
caller and the process's current bearer token:

| Endpoint | Purpose |
|---|---|
| `GET /meta` | Handshake: protocol version, cache kinds present, package version |
| `GET /snapshot` | Full current listing of tracked entries |
| `POST /evict/{key}` | Evict one entry by its string key |
| `POST /clear` | Evict everything tracked |

### Safety defaults

- Off unless `IsDevelopment()` (or explicitly enabled).
- Rejects any request not from loopback, regardless of what address the app is bound to.
- Requires a random per-run bearer token (never typed by hand — read from the discovery file).
- Redacts values (not metadata) for keys matching common secret-shaped patterns
  (`password`, `token`, `secret`, …) — configurable via `CacheLensOptions.RedactKeyPatterns`.
- Caps serialized value size (`MaxValuePayloadBytes`, default 64 KB) rather than shipping huge
  blobs to a client.

## Roadmap

See [`docs/architecture.md`](docs/architecture.md) for the full plan. In short: live push
updates (currently the extension polls every few seconds), then `IDistributedCache` and
`HybridCache` support, then actually publishing to NuGet/Marketplace/Open VSX, then zero-install
process-attach as a stretch goal.

## Contributing

Not yet accepting external contributions — the project is still finding its shape. Issues and
discussion are welcome once the repo is public.

## License

[MIT](LICENSE)
