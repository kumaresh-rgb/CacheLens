# Connecting CacheLens to your app

Everything about how the extension finds your app, what to type where, and what to do when
nothing shows up.

---

## Read this first

**Most people never need this page.**

If your app runs on the same computer as VS Code, CacheLens finds it by itself. There is no URL
to paste and no token to look up. If your panel is empty, the cause is almost always that
**CacheLens never started inside your app** — not that you are missing a connection step.

Jump to [Nothing shows up](#nothing-shows-up) before reaching for a manual connection.

---

## How discovery works

```
Your app starts
   ↓
CacheLens generates a random token for this run
   ↓
It writes one small file:   <temp>/cachelens/instances/<pid>.json
   {  "processId": 7112,
      "processName": "MyApi",
      "url": "http://localhost:5225",
      "token": "9f3c…",
      "startedAt": "..."  }
   ↓
The extension is watching that folder, sees the file, reads the url + token
   ↓
Your app appears in the panel
   ↓
App shuts down → file is deleted → app disappears from the panel
```

Two consequences worth understanding:

- **The token changes every single time your app starts.** One you saved yesterday is already
  invalid. This is why pointing at the file beats copying the token out of it.
- **The file is written on the machine running the app.** For a container or a remote server, it
  is inside that container or on that server — not on your laptop.

---

## Method 1 — Select a discovery file

**Use this for containers, remote servers, and any time typing feels risky.**

The file already contains both the URL and the token, so the extension reads both and you type
nothing.

1. Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. **CacheLens: Add Remote Connection**
3. Choose **Select a discovery file**
4. Pick the app's `<pid>.json`

The dialog opens in your own machine's discovery folder, which is the right place for a local
app. For an app elsewhere, copy its file over first:

```bash
# From a Docker container
docker cp <container>:/tmp/cachelens/instances/. ./cachelens-instances/

# From a remote server
scp user@server:/tmp/cachelens/instances/*.json ./cachelens-instances/
```

Then point the dialog at the copied file.

> If the app is remote, its URL will be its own address — something like
> `http://0.0.0.0:8080`, which your machine cannot reach. Forward the port first
> (`kubectl port-forward`, `docker -p`, `ssh -L`) and use **Method 2** with your forwarded
> address instead.

---

## Method 2 — Enter a URL

**Which URL?** This is the question people get stuck on, so precisely:

### It is your app's own address — the one it already prints

Whatever address your ASP.NET Core app listens on. CacheLens does **not** run a separate server
or have a port of its own; it adds routes to the app you already have. So the URL is simply
where your app lives.

Your app tells you at startup:

```
info: Microsoft.Hosting.Lifetime[14]
      Now listening on: http://localhost:5225          ← this
info: CacheLens.AspNetCore.CacheLensDiscoveryHostedService[0]
      CacheLens is tracking this app's caches at http://localhost:5225   ← or this
```

It differs per project — it comes from your `launchSettings.json`, your `--urls` argument, or
`ASPNETCORE_URLS`. `5225` is just what the sample app happens to use. **Use your own port.**

### Base address only

| | |
|---|---|
| ✅ | `http://localhost:5225` |
| ✅ | `https://localhost:7164` |
| ✅ | `http://localhost:8080` — a forwarded port |
| ❌ | `http://localhost:5225/_cachelens` — the extension adds that itself |
| ❌ | `http://localhost:5225/weatherforecast` — not an app route |
| ❌ | `localhost:5225` — the scheme is required |

### Then the token, usually not

If the URL belongs to an app on **this machine**, CacheLens matches it against local discovery
files and fills the token in silently. You are connected.

You are only asked for a token when the address is somewhere this machine cannot see — a
forwarded port to another host. Then read it from that machine's discovery file:

```powershell
# Windows
(Get-Content "$env:TEMP\cachelens\instances\*.json" | ConvertFrom-Json).token
```

```bash
# macOS / Linux
cat "$TMPDIR/cachelens/instances/"*.json
```

> Matching is by host and port, not by exact text. Your app may log `http://localhost:5225`
> while its file records `http://127.0.0.1:5225` — CacheLens treats those as the same app.

---

## Nothing shows up

Run **CacheLens: Troubleshoot — Why don't I see my app?** from the Command Palette. It prints
the exact folder it watches, whether that folder exists, and every app it can currently see.

If it reports **0 apps**, work down this list. In practice it is nearly always the second one.

### 1. Is the app actually running?

The file is deleted on shutdown. A stopped app is correctly absent.

### 2. Is it in Development?

This is the usual answer. The documented setup wraps CacheLens in a check:

```csharp
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddCacheLens();
}
```

Outside Development that block never runs, so nothing is registered and no file is written.
Check `ASPNETCORE_ENVIRONMENT` — running with a Staging or Production profile silently disables
CacheLens by design.

### 3. Are both lines present?

Two calls are needed, in two different places:

```csharp
builder.Services.AddCacheLens();   // before builder.Build()
// ...
app.MapCacheLens();                // after builder.Build()
```

With only `AddCacheLens()`, the cache is tracked but no endpoint is exposed. With only
`MapCacheLens()`, there is nothing to serve.

### 4. Is the package installed?

```bash
dotnet add package CacheLens.AspNetCore
```

### The one check that settles it

Look at your app's startup output. If CacheLens is running, this line is there:

```
CacheLens is tracking this app's caches at http://localhost:PORT
```

**No line means CacheLens never started** — and no discovery file exists to find. Chasing the
folder will not help; the fix is in your `Program.cs` or your environment.

### "There is no file in that folder"

Almost always case 2 or 3 above. Confirm the folder itself with **CacheLens: Open Discovery
Folder**, which opens the exact path the extension watches — no guessing at what `%TEMP%`
expands to.

Remember that a containerised app writes inside the container. An empty folder on your laptop is
the expected result there, not a fault.

---

## Reference

| | |
|---|---|
| Discovery folder (Windows) | `%TEMP%\cachelens\instances\` |
| Discovery folder (macOS / Linux) | `$TMPDIR/cachelens/instances/` |
| One file per | running process, named `<pid>.json` |
| Token lifetime | regenerated on every start |
| Route prefix | `/_cachelens` — added by the extension, never typed |
| Poll interval | 3 seconds, only while the panel is visible |

Requests are refused unless they come from the loopback interface **and** carry the current
token, so a stale token fails closed rather than connecting to the wrong thing.
