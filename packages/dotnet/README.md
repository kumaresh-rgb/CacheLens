# CacheLens

**Runtime visibility for ASP.NET Core `IMemoryCache`.**

Browse cached keys, inspect values, and track expiration and hit counts — live, from inside VS
Code, without changing a single line of your caching code.

> This package is one half of CacheLens. It instruments your application; the
> [**CacheLens VS Code extension**](https://marketplace.visualstudio.com/items?itemName=cachelens.cachelens)
> displays what it finds. You need both.

---

## Install

```bash
dotnet add package CacheLens.AspNetCore
```

Then install the [CacheLens extension](https://marketplace.visualstudio.com/items?itemName=cachelens.cachelens)
in VS Code.

## Use

Two lines in `Program.cs`:

```csharp
using CacheLens.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

if (builder.Environment.IsDevelopment())
{
    builder.Services.AddCacheLens();
}

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapCacheLens();
}

app.Run();
```

Run your app. It appears in the CacheLens panel within a few seconds — there is no host, port, or
token to configure anywhere.

Your existing `Set` / `Get` / `GetOrCreate` calls stay exactly as they are. CacheLens wraps
whatever `IMemoryCache` you already registered, from the outside.

---

## Why the `IsDevelopment()` checks

CacheLens exposes the contents of your cache, which may include real customer data. Those checks
keep it out of production. Please keep them.

The endpoint fails closed by default:

| Control | Behaviour |
|---|---|
| **Loopback only** | Requests from other hosts are rejected regardless of the bind address |
| **Per-process token** | A fresh bearer token each startup; the extension reads it automatically |
| **Redaction** | Keys containing `password`, `token`, `secret` and similar return metadata only |
| **Payload ceiling** | Values above 64 KB are reported by size rather than transmitted |

## Configuration

```csharp
builder.Services.AddCacheLens(options =>
{
    options.RedactKeyPatterns = ["password", "secret", "token", "apikey"];
    options.MaxValuePayloadBytes = 64 * 1024;
    options.RoutePrefix = "/_cachelens";
    options.EnableDiscovery = true;
});
```

---

## Scope

Supports **.NET 8** and **.NET 9**, ASP.NET Core applications.

Not yet supported, stated plainly:

- **`IMemoryCache`, plus `HybridCache` L1.** HybridCache stores its in-process tier in the
  registered `IMemoryCache`, so those entries are visible; its distributed tier is not.
  `IDistributedCache` is not tracked — the in-memory provider holds its own private cache.
- **ASP.NET Core only** — console applications and worker services are not yet covered.
- Entries cached before CacheLens starts are not tracked.

---

[Website](https://cache-lens.vercel.app) ·
[Documentation](https://github.com/kumaresh-rgb/CacheLens/blob/main/docs/INSTALLATION.md) ·
[Source](https://github.com/kumaresh-rgb/CacheLens) ·
[Issues](https://github.com/kumaresh-rgb/CacheLens/issues)

MIT licensed.
