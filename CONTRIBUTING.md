# Contributing to CacheLens

Thanks for taking a look. This guide explains how to get CacheLens running on your own machine,
how the code is organised, and how to send changes back.

You do not need to know anything about this project already. If a step here does not work for
you, that is a bug in this guide — please open an issue and say which step failed.

---

## 1. What you need first

| Tool | Version | Why |
|---|---|---|
| [.NET SDK](https://dotnet.microsoft.com/download) | 8.0 or newer | Builds the NuGet packages and the sample app |
| [Node.js](https://nodejs.org) | 18 or newer | Builds the VS Code extension |
| [VS Code](https://code.visualstudio.com) | 1.85 or newer | Runs the extension |
| Git | any recent | Gets the code |

Check what you have:

```bash
dotnet --version
node --version
```

---

## 2. Get the code

```bash
git clone https://github.com/kumaresh-rgb/CacheLens.git
cd CacheLens
```

---

## 3. How the project is laid out

CacheLens is **two programs that talk to each other**, plus a sample app to test with:

```
CacheLens/
├── packages/
│   ├── dotnet/
│   │   ├── CacheLens.Core/          Shared data shapes both sides agree on
│   │   └── CacheLens.AspNetCore/    The NuGet package users install in their app
│   └── vscode-extension/            The VS Code extension (what users see)
├── samples/
│   └── CacheLens.Sample/            A small test app with a few cached values
├── site/                            The marketing website (plain HTML)
└── docs/                            Architecture notes and guides
```

**How the two halves connect**, in plain terms:

1. A developer adds the **NuGet package** to their app. It wraps their cache so it can keep a
   list of what is inside.
2. The package opens a tiny web endpoint on the developer's own machine, and writes a small
   file saying "I am running here, and here is the password".
3. The **VS Code extension** watches for that file, reads it, and calls the endpoint to get the
   cache contents.

That file is the reason there is nothing to configure. Neither side needs you to type a port
number or a token.

---

## 4. Build everything once

```bash
# .NET side
dotnet build CacheLens.slnx

# Extension side
cd packages/vscode-extension
npm install
npm run bundle
cd ../..
```

Both should finish with no errors. If the .NET build complains that a file is *locked* or *in
use*, a sample app is still running from an earlier session — close it and build again.

---

## 5. Run it

You need **two things running at once**: the sample app, and the extension.

### Step A — start the sample app

```bash
cd samples/CacheLens.Sample
dotnet run
```

Look for this line in the output — it means CacheLens is active:

```
CacheLens is tracking this app's caches at http://localhost:5225
```

Leave this running.

### Step B — put some data in the cache

In a **second terminal**:

```bash
curl http://localhost:5225/weatherforecast     # cached for 30 seconds
curl http://localhost:5225/profile/42          # sliding 5 minute expiry
curl -X POST http://localhost:5225/session/42  # a deliberately hidden value
```

> **On Windows PowerShell**, `curl` is an alias for a different command and will reject `-X`.
> Use `curl.exe` instead, or `Invoke-WebRequest -Uri <url> -Method Post`.

### Step C — start the extension

Open the **`packages/vscode-extension` folder** in VS Code as its own window
(File → Open Folder), then press **F5**.

A second VS Code window opens, titled **[Extension Development Host]**. This window is running
your local copy of the extension.

In that new window:

1. Open the folder `samples/CacheLens.Sample`. (The extension only wakes up when it sees a .NET
   project, so it needs a .NET folder open.)
2. Click the **CacheLens icon** in the left sidebar.
3. Your sample app appears within a few seconds, with the three cached keys underneath it.

Click any key to open the inspector and see its value.

---

## 6. Checking your changes work

There is no automated test suite yet — this is a known gap and a good first contribution. For
now, changes are verified by hand:

**If you changed the .NET side:**

```bash
dotnet build CacheLens.slnx
```

Then restart the sample app and confirm the endpoint still answers correctly:

```bash
# macOS / Linux
TOKEN=$(cat "$TMPDIR/cachelens/instances/"*.json | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -H "Authorization: Bearer $TOKEN" http://localhost:5225/_cachelens/snapshot
```

```powershell
# Windows PowerShell
$file  = Get-ChildItem "$env:TEMP\cachelens\instances\*.json" | Select-Object -First 1
$token = (Get-Content $file | ConvertFrom-Json).token
Invoke-WebRequest -Uri http://localhost:5225/_cachelens/snapshot -Headers @{ Authorization = "Bearer $token" } |
  Select-Object -ExpandProperty Content
```

**If you changed the extension:**

```bash
cd packages/vscode-extension
npx tsc --noEmit -p .   # type check — must report nothing
npm run bundle          # rebuild
```

Then stop the debug session and press **F5** again. The extension does not reload images or
compiled code on its own, so a restart is required to see changes.

**Before opening a pull request**, confirm the extension still packages cleanly:

```bash
npx @vscode/vsce package --no-dependencies
```

This catches problems the type checker cannot see, such as a missing icon or a broken manifest.

---

## 7. Where to make changes

| I want to change... | Look in |
|---|---|
| How cache entries are tracked | `packages/dotnet/CacheLens.AspNetCore/TrackedMemoryCache.cs` |
| The HTTP endpoints | `packages/dotnet/CacheLens.AspNetCore/CacheLensEndpointExtensions.cs` |
| Settings like redaction rules | `packages/dotnet/CacheLens.AspNetCore/CacheLensOptions.cs` |
| The data both sides exchange | `packages/dotnet/CacheLens.Core/` **and** `packages/vscode-extension/src/types.ts` |
| The tree of keys in VS Code | `packages/vscode-extension/src/views/treeDataProvider.ts` |
| The value inspector panel | `packages/vscode-extension/src/webview/inspectorPanel.ts` |
| Finding running apps | `packages/vscode-extension/src/discovery.ts` |
| The website | `site/index.html` |
| Colours, icons, visual style | `docs/brand.md` |

### One important rule

`packages/dotnet/CacheLens.Core/` and `packages/vscode-extension/src/types.ts` describe the
**same data** in two languages. If you change a field in one, you must change it in the other,
or the extension will silently misread what the app sends.

If you change the *shape* of that data in a way older versions cannot understand, also increase
`ProtocolVersion.Current` in `packages/dotnet/CacheLens.Core/ProtocolVersion.cs`. The extension
uses that number to show a clear "please update" message instead of failing in a confusing way.

---

## 8. Style

There is no linter configured. Please match the code already around you:

- **C#** — file-scoped namespaces, `var` where the type is obvious, XML doc comments on public
  types.
- **TypeScript** — strict mode is on and must stay clean. No `any`.
- **Comments** — explain *why*, not *what*. A comment saying "loop over entries" is noise; a
  comment explaining why eviction callbacks need an identity check is worth keeping.
- **Commit messages** — short summary line, blank line, then the reasoning. Explain why the
  change was needed, not just what changed.

---

## 9. Sending a change

1. Fork the repo and create a branch: `git checkout -b fix-something`
2. Make your change.
3. Verify it using section 6 above.
4. Commit and push to your fork.
5. Open a pull request describing **what problem it solves**, and how you tested it.

Small, focused pull requests are much easier to review than large ones. If you are planning
something big, please open an issue first so we can agree on the approach before you spend time
on it.

---

## 10. Common problems

**"CacheLens is tracking..." never appears when I run the sample app.**
CacheLens only turns on in Development mode. Check that `ASPNETCORE_ENVIRONMENT` is
`Development`, which is the default when running from the `samples/CacheLens.Sample` folder.

**The extension shows an app as "unreachable" with a 401 error.**
That entry is left over from an app that was force-killed and never cleaned up after itself.
Delete the stale file and press refresh:

- Windows: `%TEMP%\cachelens\instances\`
- macOS / Linux: `$TMPDIR/cachelens/instances/`

**The tree stays empty.**
Make sure a .NET project folder is open in the Extension Development Host window. Without one,
the extension never activates. If it still fails, open **Help → Toggle Developer Tools** in that
window and check the Console tab for errors.

**The .NET build fails saying a DLL is locked.**
A sample app is still running. Close it, or stop the process, then build again.

**My icon or image change does not show up.**
Stop the debug session and press F5 again. VS Code caches these.

---

## 11. Project status

CacheLens is early. Some things are deliberately not built yet:

- No automated tests (a very welcome contribution).
- The extension polls every 3 seconds rather than receiving live updates.
- `IMemoryCache` is tracked, and `HybridCache` L1 comes along for free because it is stored
  there. `IDistributedCache` is not — its in-memory provider holds a private cache instance.

See [`docs/architecture.md`](docs/architecture.md) for the full picture of what exists and what
does not.
