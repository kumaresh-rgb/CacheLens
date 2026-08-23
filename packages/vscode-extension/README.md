# CacheLens

**See what's actually inside your .NET cache.**

`IMemoryCache` won't tell you what it's holding. CacheLens shows you every key with its value,
size, expiry and hit count — live, in VS Code, without changing a single line of your caching
code.

---

## The problem

.NET 9 added `MemoryCache.Keys`, which gives you a list of key objects. Useful — and that is
where it stops. No values, no expiry, no sizes, no per-key hit counts. It sits on the concrete
`MemoryCache` class rather than the `IMemoryCache` interface your code is handed by dependency
injection, and on .NET 8 it does not exist at all.

So you end up keeping a shadow list of every key you ever set — which drifts out of sync the
moment an entry expires on its own, and still tells you nothing about the entries themselves.

## The fix

Two lines in `Program.cs`:

```csharp
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddCacheLens();
}

// ...

if (app.Environment.IsDevelopment())
{
    app.MapCacheLens();
}
```

Run your app, open the CacheLens panel, and every key is there.

**Your existing `Set` / `Get` / `GetOrCreate` calls stay exactly as they are.** CacheLens wraps
your cache from the outside.

---

## What you get

- **Live key browser** — every tracked key with size, time-to-live, and hit count at a glance
- **Value inspector** — click a key to read its value as formatted JSON, with full metadata
- **Expiry countdowns** — watch absolute and sliding expirations tick down in real time
- **Evict without restarting** — drop one key or clear everything, then watch it repopulate
- **Snapshot export** — save the whole cache state to JSON for a bug report
- **Zero configuration** — your app announces itself, the extension finds it. No ports or tokens
  to type anywhere

---

## Getting started

**1. Install this extension.**

**2. Add the companion NuGet package** to the app you want to inspect:

```bash
dotnet add package CacheLens.AspNetCore
```

Both halves are required — the package watches your cache, this extension displays it. Supports
**.NET 8** and **.NET 9**.

**3. Add the two `if` blocks** shown above to `Program.cs`.

**4. Run your app.** You should see this in the console:

```
CacheLens is tracking this app's caches at http://localhost:5225
```

**5. Open the CacheLens icon** in the VS Code sidebar. Your app appears within a few seconds.

> The folder open in VS Code must contain a `.csproj`, `.sln`, or `.slnx` file — the extension
> stays asleep otherwise, so it never slows down non-.NET work.

Full guide: **[Installation and usage](https://github.com/kumaresh-rgb/CacheLens/blob/main/docs/INSTALLATION.md)**

---

## Commands

Available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | What it does |
|---|---|
| `CacheLens: Refresh` | Fetch the latest cache state now |
| `CacheLens: Clear All Entries` | Evict everything in the selected app's cache |
| `CacheLens: Evict` | Remove one key |
| `CacheLens: Export Snapshot as JSON...` | Save the current state to a file |
| `CacheLens: Add Remote Connection...` | Connect to an app on another machine |
| `CacheLens: Copy Value` | Copy a cached value to the clipboard |

---

## Built for safety

Displaying cache contents is a data leak waiting to happen, so CacheLens fails closed by default:

| Protection | What it means |
|---|---|
| **Development only** | The documented setup keeps it off outside development |
| **Loopback only** | Requests from other machines are refused, regardless of what address your app binds to |
| **Fresh token per run** | Each process generates a random bearer token; the extension reads it automatically |
| **Secrets redacted** | Keys containing `password`, `token`, `secret` and similar send metadata only, never the value |
| **Large values capped** | Anything over 64 KB is reported by size instead of being sent to your editor |

Note that **Export Snapshot writes real cached values to disk** — check the contents before
committing or sharing that file.

---

## Settings

Configured in your .NET app, not in VS Code settings:

```csharp
builder.Services.AddCacheLens(options =>
{
    options.RedactKeyPatterns = ["password", "secret", "token", "apikey"];
    options.MaxValuePayloadBytes = 64 * 1024;
    options.RoutePrefix = "/_cachelens";
});
```

---

## Current limitations

Being upfront about what this does not do yet:

- **Only `IMemoryCache`.** `IDistributedCache` (Redis, SQL Server) and .NET 9's `HybridCache` are
  planned but not built.
- **Refreshes every 3 seconds** rather than instantly. Live push updates are planned.
- **ASP.NET Core apps only.** Console apps and worker services are not supported yet.
- Entries cached *before* CacheLens started are not tracked.

---

## Links

- **Source code:** [github.com/kumaresh-rgb/CacheLens](https://github.com/kumaresh-rgb/CacheLens)
- **Report an issue:** [github.com/kumaresh-rgb/CacheLens/issues](https://github.com/kumaresh-rgb/CacheLens/issues)
- **Architecture notes:** [docs/architecture.md](https://github.com/kumaresh-rgb/CacheLens/blob/main/docs/architecture.md)

MIT licensed. Free to use, modify, and distribute.
