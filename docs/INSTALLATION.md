# Installing and using CacheLens

This guide is for developers who want to **use** CacheLens on their own .NET app. If you want to
work on CacheLens itself, read [CONTRIBUTING.md](../CONTRIBUTING.md) instead.

---

## What CacheLens is

.NET's `IMemoryCache` does not let you see inside it. On .NET 9 the concrete `MemoryCache` class
can list its keys, but that is all it gives you — no values, no expiry times, no sizes, no
per-key hit counts — and the interface your code is actually handed has no such thing. On .NET 8
there is nothing at all.

CacheLens adds that missing window. You get a live list of every cached key, its value, its
size, when it expires, and how many times it has been read — inside VS Code, while your app
runs.

---

## You need both halves

CacheLens is **two pieces**, and you need both:

| Piece | What it does | Where it goes |
|---|---|---|
| **NuGet package** | Watches your app's cache and serves the data | Inside your .NET app |
| **VS Code extension** | Displays that data | In your editor |

Think of it like a camera and a screen. The package is the camera inside your app. The extension
is the screen you watch it on. Neither is useful alone.

---

## Step 1 — Install the VS Code extension

### Option A: from inside VS Code (easiest)

1. Open VS Code.
2. Click the **Extensions** icon in the left sidebar (or press `Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Search for **CacheLens**.
4. Click **Install**.

### Option B: from the Marketplace website

Visit the [CacheLens page on the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cachelens.cachelens)
and click **Install**. Your browser will hand off to VS Code.

### Option C: from a `.vsix` file

If you have downloaded a `.vsix` file directly:

```bash
code --install-extension cachelens-0.1.0.vsix
```

Or in VS Code: **Extensions** → `...` menu at the top → **Install from VSIX...**

---

## Step 2 — Add the NuGet package to your app

In your project folder:

```bash
dotnet add package CacheLens.AspNetCore
```

Or add it directly to your `.csproj`:

```xml
<PackageReference Include="CacheLens.AspNetCore" Version="0.1.0" />
```

The package supports **.NET 8 and .NET 9**.

---

## Step 3 — Turn it on in your code

Open `Program.cs` and add two lines.

```csharp
using CacheLens.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// Your existing services...
builder.Services.AddMemoryCache();

// 👇 Add this
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddCacheLens();
}

var app = builder.Build();

// 👇 And this
if (app.Environment.IsDevelopment())
{
    app.MapCacheLens();
}

app.Run();
```

That is the whole setup.

**You do not need to change any of your caching code.** Your existing `Set`, `Get`,
`GetOrCreate`, and `Remove` calls keep working exactly as they are. CacheLens wraps your cache
from the outside.

### Why the `IsDevelopment()` checks?

CacheLens shows the contents of your cache, which may include real customer data. The
`IsDevelopment()` check makes sure it never turns on in production, even by accident. Please keep
those checks.

---

## Step 4 — Run your app

```bash
dotnet run
```

Look for this line in the console:

```
CacheLens is tracking this app's caches at http://localhost:5225
```

If you see it, CacheLens is working.

---

## Step 5 — Open the viewer

1. In VS Code, open the folder containing your .NET project.
2. Click the **CacheLens icon** in the left sidebar.
3. Your running app appears automatically within a few seconds.

**There is nothing to configure.** No port numbers, no tokens, no connection settings. When your
app starts, it leaves a small note on disk saying where it is and how to reach it, and the
extension finds it.

Click any key in the tree to open the inspector, where you can:

- Read the value as formatted JSON
- See the size, expiry countdown, and read count
- **Evict** that one key
- **Copy** the value to your clipboard

The toolbar at the top of the panel also lets you refresh, clear the whole cache, or export
everything to a JSON file.

---

## Settings you can change

Pass options to `AddCacheLens()`:

```csharp
builder.Services.AddCacheLens(options =>
{
    // Hide values for keys containing these words (case-insensitive).
    // The defaults below are already applied — this replaces them.
    options.RedactKeyPatterns = ["password", "secret", "token", "apikey", "creditcard"];

    // Values larger than this are reported by size only, not sent to the editor.
    options.MaxValuePayloadBytes = 64 * 1024;   // 64 KB

    // Change the URL path CacheLens serves on.
    options.RoutePrefix = "/_cachelens";

    // Turn off the auto-discovery file (you will then have to connect by hand).
    options.EnableDiscovery = true;

    // Master switch.
    options.Enabled = true;
});
```

---

## Is this safe?

CacheLens is built to fail closed. All of the following are **on by default**:

| Protection | What it means |
|---|---|
| **Development only** | The standard setup keeps it off outside development |
| **Your machine only** | Requests from any other machine are refused, even if your app is reachable from the network |
| **New password each run** | Every time your app starts it generates a fresh random token; the extension reads it automatically |
| **Secrets stay hidden** | Keys containing words like `password` or `token` never send their value — you see the key exists, not what is in it |
| **Big values stay put** | Anything over 64 KB is reported by size instead of being copied to your editor |

**One thing to be careful with:** the *Export Snapshot* feature writes real cached values to a
file on disk. Do not commit that file to source control or attach it to a public bug report
without checking what is in it first.

---

## Connecting to an app on another machine

> Full detail — which URL, where the token is, and what to do when nothing appears —
> is in **[CONNECTING.md](CONNECTING.md)**.

Auto-discovery only works for apps on your own computer. For an app in Docker or on a remote
server, forward its port to your machine first, then open the Command Palette
(`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **CacheLens: Add Remote Connection**.

You get two routes:

### Select a discovery file — recommended

Point the file picker at the app's `cachelens/instances/<pid>.json`. The URL **and** the token
are both read from it, so there is nothing to type and nothing to copy wrongly.

For a container, copy the file out first:

```bash
docker cp <container>:/tmp/cachelens/instances/. ./cachelens-instances/
```

### Enter a URL

Paste the **base address only** — `http://localhost:5225`, not
`http://localhost:5225/_cachelens`. If the app is running on this machine, CacheLens matches it
against the local discovery files and fills the token in automatically.

## Where is the token?

A fresh one is generated every time your app starts, and it is written **only** to the discovery
file — it is never printed to the console.

| Machine running the app | Path |
|---|---|
| Windows | `%TEMP%\cachelens\instances\<pid>.json` |
| macOS / Linux | `$TMPDIR/cachelens/instances/<pid>.json` |

```powershell
# Windows — print the token
(Get-Content "$env:TEMP\cachelens\instances\*.json" | ConvertFrom-Json).token
```

```bash
# macOS / Linux
cat "$TMPDIR/cachelens/instances/"*.json
```

Since it rotates on every restart, a token you saved yesterday will not work today. The
discovery-file route avoids that entirely.

---

## When something is wrong

**The CacheLens panel is empty and says no apps were found.**

- Is your app actually running?
- Did the console print `CacheLens is tracking this app's caches at...`? If not, the two lines
  from Step 3 are missing, or the app is not in Development mode.
- Is a folder with a `.csproj` or `.sln` open in VS Code? The extension stays asleep otherwise.

**An app is listed but marked "unreachable" with a 401 error.**

The app it points to has stopped, and something else is now on that port. This usually means an
app was force-killed and never cleaned up. Delete the leftover file and press refresh:

- Windows: `%TEMP%\cachelens\instances\`
- macOS / Linux: `$TMPDIR/cachelens/instances/`

**A key I expect to see is missing.**

CacheLens only knows about entries written *after* it started tracking. Anything cached before
the app started, or by a cache that was not registered through dependency injection, will not
appear.

**A value shows "Redacted" but is not a secret.**

Its key contains one of the redaction words. Adjust `RedactKeyPatterns` — see Settings above.

**Still stuck?**

Open an issue at [github.com/kumaresh-rgb/CacheLens/issues](https://github.com/kumaresh-rgb/CacheLens/issues)
with your .NET version, VS Code version, and what you tried.

---

## What is not supported yet

Being upfront about the current limits:

- **`IMemoryCache`, and `HybridCache`'s in-process tier.** HybridCache keeps its L1 entries in
  the registered `IMemoryCache`, so they show up; its distributed L2 tier does not.
- **`IDistributedCache` is not tracked.** Even the in-memory provider keeps its own private
  cache instance rather than the one registered in DI, so CacheLens cannot see it. Redis and SQL
  Server support is planned.
- **Updates every 3 seconds**, not instantly. Live push updates are planned.
- **ASP.NET Core apps only.** Console apps and worker services are not supported yet.
- **No automated tests yet.**

See [architecture.md](architecture.md) for the full roadmap.

---

## Removing CacheLens

1. Delete the two lines you added in Step 3.
2. `dotnet remove package CacheLens.AspNetCore`
3. Uninstall the extension from the Extensions panel in VS Code.

Nothing else is left behind. The only file CacheLens writes is a small note in your temp folder,
deleted when your app shuts down.
