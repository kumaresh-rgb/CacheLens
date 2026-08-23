<div align="center">

<img src="https://raw.githubusercontent.com/kumaresh-rgb/CacheLens/main/packages/vscode-extension/media/icon-128.png" alt="CacheLens" width="84" height="84" />

# CacheLens

**Runtime visibility for ASP.NET Core `IMemoryCache`.**

Browse cached keys, inspect values, and track expiration and hit counts — live, without leaving
VS Code.

[Website](https://cache-lens.vercel.app) · [Documentation](https://github.com/kumaresh-rgb/CacheLens/blob/main/docs/INSTALLATION.md) · [Source](https://github.com/kumaresh-rgb/CacheLens) · [Report an issue](https://github.com/kumaresh-rgb/CacheLens/issues)

</div>

---

## See it work

![Running an app and watching its cache appear in CacheLens](https://raw.githubusercontent.com/kumaresh-rgb/CacheLens/main/docs/images/demo.gif)

Start your app, and it appears on its own — no host, port, or token to configure anywhere.

---

## Why this exists

.NET 9 added `MemoryCache.Keys`, which returns a list of key objects. Useful, and that is where
it stops:

- **Keys only** — no values, no expiry, no sizes, no per-key hit counts.
- **Wrong type** — it sits on the concrete `MemoryCache` class, not the `IMemoryCache` interface
  your code receives from dependency injection.
- **Absent on .NET 8** — still a supported LTS release.

So teams keep a shadow list of every key they set, which drifts out of sync the moment an entry
expires on its own — and still tells you nothing about the entries themselves.

CacheLens closes that gap.

---

## Getting started

CacheLens is two halves, and you need both. This extension is the viewer; a NuGet package
instruments your application.

**1 — Install this extension.**

**2 — Add the package** to the app you want to inspect:

```bash
dotnet add package CacheLens.AspNetCore
```

**3 — Register it** in `Program.cs`:

```csharp
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddCacheLens();
}

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapCacheLens();
}
```

Your existing `Set` / `Get` / `GetOrCreate` calls stay exactly as they are — CacheLens wraps the
cache from the outside.

**4 — Run your app.** You should see:

```
CacheLens is tracking this app's caches at http://localhost:5225
```

**5 — Open the CacheLens panel** in the Activity Bar. Your app appears within a few seconds.

> The folder open in VS Code must contain a `.csproj`, `.sln`, or `.slnx`. The extension stays
> dormant otherwise, so it never slows down non-.NET work.

Full walkthrough: **[Installation guide](https://github.com/kumaresh-rgb/CacheLens/blob/main/docs/INSTALLATION.md)** ·
Interactive version: **[cache-lens.vercel.app](https://cache-lens.vercel.app/#how)**

---

## Capabilities

| | |
|---|---|
| **Live key browser** | Every tracked key with size, time-to-live, and hit count |
| **Value inspector** | Formatted JSON with full entry metadata |
| **Expiry countdowns** | Absolute and sliding expirations, updating in place |
| **Eviction** | Drop a single key or clear the cache without restarting |
| **Snapshot export** | Save the full cache state to JSON for a bug report |
| **Zero configuration** | Applications are discovered automatically on the local machine |

### Commands

Available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---|---|
| `CacheLens: Refresh` | Fetch the current cache state |
| `CacheLens: Clear All Entries` | Evict everything in the selected application |
| `CacheLens: Evict` | Remove a single key |
| `CacheLens: Export Snapshot as JSON...` | Write the current state to a file |
| `CacheLens: Add Remote Connection...` | Connect to an application on another host |
| `CacheLens: Copy Value` | Copy a cached value to the clipboard |

---

## Security model

Exposing cache contents is a data-disclosure risk, so CacheLens fails closed by default:

| Control | Behaviour |
|---|---|
| **Environment gated** | The documented setup keeps it disabled outside development |
| **Loopback only** | Requests from other hosts are rejected regardless of the bind address |
| **Per-process token** | A fresh bearer token is generated at startup and read automatically |
| **Redaction** | Keys matching `password`, `token`, `secret` and similar return metadata only |
| **Payload ceiling** | Values above 64 KB are reported by size rather than transmitted |

Configured in your application, not in VS Code settings:

```csharp
builder.Services.AddCacheLens(options =>
{
    options.RedactKeyPatterns = ["password", "secret", "token", "apikey"];
    options.MaxValuePayloadBytes = 64 * 1024;
    options.RoutePrefix = "/_cachelens";
});
```

**Note:** *Export Snapshot* writes real cached values to disk. Review the file before sharing it.

---

## Requirements and current scope

| | |
|---|---|
| .NET | 8.0 or 9.0 |
| Application type | ASP.NET Core |
| VS Code | 1.85 or later |

Not yet supported, stated plainly:

- **`IMemoryCache` only.** `IDistributedCache` and `HybridCache` are planned.
- **Polls every 3 seconds** while the view is visible; live push updates are planned.
- **ASP.NET Core only** — console applications and worker services are not yet covered.
- Entries cached before CacheLens starts are not tracked.

Roadmap and design notes: **[architecture.md](https://github.com/kumaresh-rgb/CacheLens/blob/main/docs/architecture.md)**

---

MIT licensed. Contributions welcome — see
[CONTRIBUTING.md](https://github.com/kumaresh-rgb/CacheLens/blob/main/CONTRIBUTING.md).
