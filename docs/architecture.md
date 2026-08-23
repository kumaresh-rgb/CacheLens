# CacheLens — Architecture

A complete explanation of what CacheLens does, why it exists, how it is built, and how people
get it. Written to be readable start to finish, with no prior knowledge of the project.

**Contents**

1. [The problem, honestly stated](#1-the-problem-honestly-stated)
2. [What else exists — the market](#2-what-else-exists--the-market)
3. [End-to-end walkthrough](#3-end-to-end-walkthrough)
4. [System architecture](#4-system-architecture)
5. [How we solved the enumeration problem](#5-how-we-solved-the-enumeration-problem)
6. [A real bug worth knowing about](#6-a-real-bug-worth-knowing-about)
7. [Zero-configuration discovery](#7-zero-configuration-discovery)
8. [Security model](#8-security-model)
9. [The wire protocol](#9-the-wire-protocol)
10. [Folder and file structure](#10-folder-and-file-structure)
11. [How users get CacheLens](#11-how-users-get-cachelens)
12. [Status and roadmap](#12-status-and-roadmap)

---

## 1. The problem, honestly stated

### What .NET actually gives you

This section is deliberately precise, because the honest version of the problem is narrower than
the marketing version — and the honest version is still worth solving.

Everything below was verified by compiling against each framework, not read from a blog post:

| Capability | .NET 8 | .NET 9+ | Notes |
|---|---|---|---|
| `MemoryCache.Keys` | ❌ Does not exist | ✅ Exists | Returns `IEnumerable<object>` — **keys only** |
| `MemoryCache.Count` | ❌ | ✅ | Entry count |
| `GetCurrentStatistics()` | ✅ | ✅ | Aggregate hits/misses/size. Requires `TrackStatistics = true` |
| `IMemoryCache.Keys` | ❌ | ❌ | **The interface has no `Keys`, even on .NET 9** |

Two things follow from that table, and they are the whole reason this project exists.

**First: `Keys` gives you keys, and nothing else.** There is no built-in way to ask "when does
this key expire?", "how big is it?", "how many times has *this specific key* been read?", or
"when was it last touched?". `GetCurrentStatistics()` gives you totals across the entire cache,
never per-key detail. To see a value you must call `TryGetValue` for each key yourself.

**Second: `Keys` is on the concrete `MemoryCache` class, not the `IMemoryCache` interface.**
Standard dependency injection hands your code an `IMemoryCache`. So even on .NET 9, the
idiomatic way of receiving a cache cannot enumerate it without a downcast that may fail if
anything else has already wrapped the cache.

And on **.NET 8 — still a supported LTS release in wide production use — none of it exists.**

### So what is actually missing

```mermaid
graph LR
    subgraph BuiltIn["What .NET gives you"]
        A["MemoryCache.Keys<br/><i>.NET 9+ only</i><br/>a list of key objects"]
        B["GetCurrentStatistics()<br/>totals for the whole cache"]
    end

    subgraph Gap["What you still don't have"]
        C["The value behind each key"]
        D["When each key expires"]
        E["How big each entry is"]
        F["Hits per key"]
        G["Anything to look at it in"]
    end

    BuiltIn -.->|"leaves you with"| Gap

    style BuiltIn fill:#18211e,stroke:#37d6ae,color:#e9efeb
    style Gap fill:#18211e,stroke:#f2a93b,color:#e9efeb
```

CacheLens fills the right-hand box: **per-key metadata, plus somewhere to see it.**

### The workaround this replaces

Without CacheLens, teams keep a parallel list of keys by hand:

```csharp
private static readonly HashSet<string> _keys = new();

// Every cache write has to remember to also record the key…
_cache.Set("user:42", user);
_keys.Add("user:42");

app.MapGet("/debug/cache", (IMemoryCache cache) =>
    _keys.Where(k => cache.TryGetValue(k, out _)));
```

This drifts out of sync the moment an entry expires or is evicted under memory pressure, because
nothing tells `_keys` that happened. It also carries no expiry, size, or hit information.

---

## 2. What else exists — the market

An honest look at the alternatives, and why none of them cover this.

| Tool | What it does | Why it does not solve this |
|---|---|---|
| **RedisInsight**, **Another Redis Desktop Manager** | Excellent GUIs for browsing Redis keys and values | Redis only. `IMemoryCache` lives *inside your process* and speaks no network protocol |
| **dotnet-counters**, **dotnet-monitor** | Live EventCounters from a running .NET process | Aggregate numbers — cache hit ratio, entry count. No keys, no values |
| **.NET Aspire Dashboard** | Traces, logs and metrics for distributed apps | Telemetry-oriented. Does not enumerate in-process cache contents |
| **Application Insights / OpenTelemetry** | Metrics and distributed tracing | Same limitation: aggregates, not cache contents |
| **Visual Studio / Rider debugger** | Can inspect `MemoryCache` private fields in a watch window | Requires pausing execution, and depends on internal field names. Not a live view |
| **dotMemory**, **PerfView** | Memory profilers | Show objects on the heap, with no understanding of cache semantics like TTL |
| **Glimpse** (discontinued) | Had a cache tab for the old ASP.NET `HttpRuntime.Cache` | Dead since the .NET Framework era. Nothing replaced it for `IMemoryCache` |
| **Hand-rolled debug endpoint** | The `HashSet<string>` pattern above | Drifts out of sync; no metadata; rebuilt from scratch in every project |

```mermaid
quadrantChart
    title Cache inspection tooling
    x-axis "Aggregate numbers" --> "Per-key detail"
    y-axis "Remote / distributed cache" --> "In-process cache"
    quadrant-1 "CacheLens sits here"
    quadrant-2 "Profilers & debuggers"
    quadrant-3 "APM / metrics"
    quadrant-4 "Redis tooling"
    "RedisInsight": [0.85, 0.15]
    "dotnet-counters": [0.15, 0.75]
    "Aspire Dashboard": [0.25, 0.35]
    "App Insights": [0.15, 0.25]
    "VS debugger": [0.70, 0.90]
    "CacheLens": [0.92, 0.88]
```

**The gap in one sentence:** Redis has had a great key browser for a decade; the cache sitting
inside your own process has never had one.

---

## 3. End-to-end walkthrough

Let us follow one real cache entry from creation to inspection.

**The application code** (from `samples/CacheLens.Sample/Program.cs`):

```csharp
app.MapGet("/weatherforecast", (IMemoryCache cache) =>
{
    return cache.GetOrCreate("weather-forecast", entry =>
    {
        entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
        return GenerateForecast();
    });
});
```

Nothing here mentions CacheLens. That is the point — instrumentation is invisible to your code.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant App as Your App
    participant TMC as TrackedMemoryCache<br/>(CacheLens wrapper)
    participant MC as Real MemoryCache
    participant Idx as Side Index
    participant Ext as VS Code Extension

    Dev->>App: GET /weatherforecast
    App->>TMC: GetOrCreate("weather-forecast", …)
    TMC->>MC: CreateEntry("weather-forecast")
    MC-->>TMC: ICacheEntry
    Note over TMC: Wraps the entry so it can<br/>observe what gets committed
    TMC->>MC: Dispose() → commits to cache
    TMC->>Idx: Record key, type, size,<br/>expiry, timestamps
    TMC-->>App: forecast data
    App-->>Dev: 200 OK + JSON

    Note over Ext: meanwhile, every 3 seconds…
    Ext->>App: GET /_cachelens/snapshot<br/>(loopback + bearer token)
    App->>Idx: read tracked entries
    Idx-->>App: entry list
    App-->>Ext: JSON snapshot
    Ext->>Ext: render tree + countdowns
```

**What the developer sees in VS Code**, a second later:

```
CacheLens.Sample (16652)          3 entries
├── weather-forecast    387 B · 0 hits · expires in 29s
├── profile:42           53 B · 0 hits · sliding 300s
└── 🔒 session-token:42     — · 0 hits · expires in 5m
```

Clicking `weather-forecast` opens an inspector showing the formatted JSON value, its type
(`WeatherForecast[]`), exact timestamps, and buttons to refresh, copy, or evict it.

The `🔒` on `session-token:42` means the value was **never sent to the editor** — the key matched
a redaction rule. You can see the entry exists and how it is configured, but not its contents.

---

## 4. System architecture

CacheLens is two independently versioned programs joined by a small documented protocol.

```mermaid
graph TB
    subgraph YourMachine["Your development machine"]
        subgraph AppProcess["Your ASP.NET Core app process"]
            YourCode["Your code<br/>cache.Set / GetOrCreate"]
            Tracked["TrackedMemoryCache<br/><i>decorator</i>"]
            Real["MemoryCache<br/><i>the real one</i>"]
            Index[("Side index<br/>ConcurrentDictionary")]
            Endpoints["Minimal API<br/>/_cachelens/*"]

            YourCode --> Tracked
            Tracked --> Real
            Tracked --> Index
            Endpoints --> Index
        end

        Disc[/"Discovery file<br/>%TEMP%/cachelens/instances/&lt;pid&gt;.json"/]

        subgraph VSCode["VS Code"]
            Watcher["DiscoveryWatcher"]
            Manager["InstanceManager<br/><i>polls every 3s</i>"]
            Tree["Tree view"]
            Inspector["Webview inspector"]

            Watcher --> Manager
            Manager --> Tree
            Manager --> Inspector
        end

        AppProcess -.->|"writes on startup<br/>deletes on shutdown"| Disc
        Disc -.->|"watches"| Watcher
        Manager -->|"HTTP + bearer token<br/>loopback only"| Endpoints
    end

    style AppProcess fill:#111917,stroke:#f2a93b,color:#e9efeb
    style VSCode fill:#111917,stroke:#37d6ae,color:#e9efeb
    style Disc fill:#18211e,stroke:#7c8fa8,color:#e9efeb
```

### Why two separate pieces

They have different release cadences and different audiences. A team may upgrade the VS Code
extension without touching their app's NuGet package, or vice versa. Splitting them means neither
blocks the other — and the `/meta` handshake (see [§9](#9-the-wire-protocol)) lets each side
detect a version mismatch and say so clearly instead of failing in confusing ways.

---

## 5. How we solved the enumeration problem

This is the core engineering decision in the project.

### The options considered

```mermaid
graph TD
    Problem["How do we list what's in the cache?"]

    Problem --> Opt1["Use MemoryCache.Keys"]
    Problem --> Opt2["Reflect into private fields"]
    Problem --> Opt3["Wrap the cache in a decorator"]

    Opt1 --> R1["❌ .NET 9+ only<br/>❌ Not on IMemoryCache interface<br/>❌ Keys only — no TTL, size, or hits"]
    Opt2 --> R2["❌ Internal fields aren't a stable contract<br/>❌ Breaks silently on framework upgrades"]
    Opt3 --> R3["✅ Works on .NET 8 and 9<br/>✅ Captures full metadata<br/>✅ Only uses public API"]

    R3 --> Chosen["Chosen approach"]

    style Chosen fill:#18211e,stroke:#37d6ae,color:#e9efeb
    style R1 fill:#18211e,stroke:#e5646e,color:#e9efeb
    style R2 fill:#18211e,stroke:#e5646e,color:#e9efeb
    style R3 fill:#18211e,stroke:#37d6ae,color:#e9efeb
```

### The decorator

`TrackedMemoryCache` implements `IMemoryCache` and wraps whatever real cache was already
registered. Every write passes through it, so it can maintain its own index.

```mermaid
classDiagram
    class IMemoryCache {
        <<interface>>
        +TryGetValue(key, out value) bool
        +CreateEntry(key) ICacheEntry
        +Remove(key) void
    }

    class TrackedMemoryCache {
        -IMemoryCache _inner
        -ConcurrentDictionary _index
        +TryGetValue() bool
        +CreateEntry() ICacheEntry
        +Remove() void
        +Snapshot() CacheEntrySnapshot[]
        +EvictByKeyString(key) bool
        +Clear() void
    }

    class TrackedCacheEntry {
        +object Key
        +string KeyString
        +object Value
        +DateTimeOffset CreatedAt
        +DateTimeOffset LastAccessedAt
        +DateTimeOffset AbsoluteExpiration
        +TimeSpan SlidingExpiration
        +long HitCount
    }

    class MemoryCache {
        the real implementation
    }

    IMemoryCache <|.. TrackedMemoryCache : implements
    IMemoryCache <|.. MemoryCache : implements
    TrackedMemoryCache o-- MemoryCache : wraps
    TrackedMemoryCache *-- TrackedCacheEntry : indexes
```

### Swapping it in without touching your code

`AddCacheLens()` finds the existing `IMemoryCache` registration in the DI container, rebuilds
the original from its own `ServiceDescriptor`, and wraps that:

```mermaid
graph LR
    A["services.AddMemoryCache()"] --> B["DI container holds<br/>IMemoryCache → MemoryCache"]
    B --> C["AddCacheLens() runs"]
    C --> D["Remove the descriptor"]
    D --> E["Rebuild the original<br/>from that descriptor"]
    E --> F["Wrap in TrackedMemoryCache"]
    F --> G["Register the wrapper<br/>as IMemoryCache"]
    G --> H["Your code receives<br/>the wrapper, unchanged"]

    style H fill:#18211e,stroke:#37d6ae,color:#e9efeb
```

Rebuilding from the original descriptor matters: it preserves whatever the app configured
(size limits, compaction settings, a custom implementation) instead of silently replacing it
with a second, disconnected cache.

**Source:** [`ServiceCollectionExtensions.cs`](../packages/dotnet/CacheLens.AspNetCore/ServiceCollectionExtensions.cs)

### Why the entry wrapper is needed

`IMemoryCache.CreateEntry()` returns an `ICacheEntry` that only actually commits to the cache
when it is **disposed**. That is also the moment `AbsoluteExpirationRelativeToNow` gets resolved
into a concrete `AbsoluteExpiration`. So CacheLens wraps the entry too, and reads the final
values *after* calling `Dispose()` on the inner entry — reading before would capture incomplete
data.

---

## 6. A real bug worth knowing about

Worth documenting because the fix is non-obvious and easy to reintroduce.

`MemoryCache` invokes post-eviction callbacks **asynchronously on the thread pool**, not inline.
When a key expires and is immediately recreated, the old entry's eviction callback can run
*after* the new entry has already been committed:

```mermaid
sequenceDiagram
    participant T1 as Request thread
    participant Idx as Side index
    participant TP as Thread pool

    Note over Idx: index["weather"] = Entry A
    Note over TP: Entry A expires…
    T1->>Idx: recreate → index["weather"] = Entry B
    Note over Idx: index now correctly holds Entry B
    TP-->>Idx: Entry A's eviction callback fires (late!)
    rect rgb(90, 30, 35)
        Note over Idx: Naive: _index.TryRemove("weather")<br/>deletes Entry B — the WRONG entry
    end
    Note over Idx: Key vanishes from the viewer<br/>even though it is cached
```

**The fix** is an identity-checked removal — only remove if the index still holds *this exact*
entry instance:

```csharp
private void OnEntryEvicted(object key, TrackedCacheEntry entry) =>
    ((ICollection<KeyValuePair<object, TrackedCacheEntry>>)_index)
        .Remove(new KeyValuePair<object, TrackedCacheEntry>(key, entry));
```

That `ICollection` cast exposes `ConcurrentDictionary`'s compare-and-remove overload, which
removes only when both key *and* value match.

Caught with a targeted reproduction: expire and recreate the same key in a tight loop. The naive
version failed on ~30 of 200 iterations; the fixed version passed all 200.

**Source:** [`TrackedMemoryCache.cs`](../packages/dotnet/CacheLens.AspNetCore/TrackedMemoryCache.cs)

---

## 7. Zero-configuration discovery

The feature that makes CacheLens feel effortless: you never type a host, port, or token.

```mermaid
sequenceDiagram
    autonumber
    participant App as Your app
    participant FS as Temp folder
    participant Ext as Extension

    Note over App: dotnet run
    App->>App: Generate a random token<br/>for this process
    App->>App: Wait for Kestrel to bind a port
    App->>FS: Write [pid].json<br/>{processId, url, token, startedAt}
    App->>App: Log "CacheLens is tracking…"

    Note over Ext: File watcher is running
    FS-->>Ext: file created
    Ext->>Ext: Parse and validate
    Ext->>App: GET /_cachelens/meta
    App-->>Ext: {protocolVersion, appName, pid}
    Ext->>Ext: Check protocol compatibility
    Ext->>App: GET /_cachelens/snapshot
    App-->>Ext: entries
    Ext->>Ext: Show app in the tree

    Note over App: Ctrl+C
    App->>FS: Delete [pid].json
    FS-->>Ext: file deleted
    Ext->>Ext: Remove from tree
```

The approach mirrors how the .NET diagnostics IPC and the Aspire dashboard find running
processes.

**One known rough edge:** if an app is killed forcefully (`kill -9`, Stop-Process -Force, or a
crash), the shutdown hook never runs and the file is left behind. The extension then shows that
app as *unreachable* with a 401, because a different process now owns that port and the old token
no longer works. Deleting the stale file and refreshing clears it. A future version should
validate liveness by PID.

**Sources:** [`CacheLensDiscoveryHostedService.cs`](../packages/dotnet/CacheLens.AspNetCore/CacheLensDiscoveryHostedService.cs) ·
[`discovery.ts`](../packages/vscode-extension/src/discovery.ts)

---

## 8. Security model

A tool that displays cache contents is a data-leak risk, so every request runs a gauntlet:

```mermaid
flowchart TD
    Req["Incoming request to /_cachelens/*"]
    Req --> Q1{"Is CacheLens enabled?<br/><i>normally gated on IsDevelopment()</i>"}
    Q1 -->|No| Dead["Endpoint not mapped<br/>404"]
    Q1 -->|Yes| Q2{"From the loopback interface?"}
    Q2 -->|No| F403["403 Forbidden"]
    Q2 -->|Yes| Q3{"Bearer token matches<br/>this process's token?"}
    Q3 -->|No| F401["401 Unauthorized"]
    Q3 -->|Yes| Serve["Build the snapshot"]

    Serve --> Q4{"Does the key match<br/>a redaction pattern?"}
    Q4 -->|Yes| Redact["Send metadata only<br/>value withheld"]
    Q4 -->|No| Q5{"Serialized value<br/>over 64 KB?"}
    Q5 -->|Yes| TooBig["Report size only"]
    Q5 -->|No| Full["Send the value"]

    style F403 fill:#18211e,stroke:#e5646e,color:#e9efeb
    style F401 fill:#18211e,stroke:#e5646e,color:#e9efeb
    style Dead fill:#18211e,stroke:#e5646e,color:#e9efeb
    style Redact fill:#18211e,stroke:#7c8fa8,color:#e9efeb
    style Full fill:#18211e,stroke:#37d6ae,color:#e9efeb
```

Every layer is **on by default**. Defaults, in order of importance:

| Control | Default | Why |
|---|---|---|
| Environment gate | Documented setup wraps registration in `IsDevelopment()` | Keeps it out of production entirely |
| Loopback check | `IPAddress.IsLoopback` on every request | Holds even if Kestrel binds `0.0.0.0` |
| Bearer token | New random value every process start | A stale token from a previous run fails |
| Key redaction | `password`, `secret`, `token`, `apikey`, `connectionstring`, `credential` | Secrets stay out of the editor |
| Payload cap | 64 KB | Avoids shipping large blobs |

**One thing to watch:** *Export Snapshot* writes real cached values to a file on disk. That file
is covered by `.gitignore`, but check its contents before attaching it to a bug report.

---

## 9. The wire protocol

All endpoints sit under a configurable prefix, `/_cachelens` by default.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/meta` | Handshake — protocol version, app name, PID, package version |
| `GET` | `/snapshot` | All tracked entries with metadata |
| `POST` | `/evict/{key}` | Remove one entry |
| `POST` | `/clear` | Remove everything tracked |

### Version negotiation

The two halves version independently, so they will drift apart in the wild.

```mermaid
flowchart LR
    A["Extension connects"] --> B["GET /meta"]
    B --> C{"app protocolVersion<br/>vs extension's supported version"}
    C -->|"Equal"| D["Normal operation"]
    C -->|"App is newer"| E["Show: update the extension"]
    C -->|"App is older"| F["Feature-detect<br/>degrade gracefully"]

    style D fill:#18211e,stroke:#37d6ae,color:#e9efeb
    style E fill:#18211e,stroke:#f2a93b,color:#e9efeb
```

The version constant lives in
[`ProtocolVersion.cs`](../packages/dotnet/CacheLens.Core/ProtocolVersion.cs) and its TypeScript
mirror in [`types.ts`](../packages/vscode-extension/src/types.ts). **These two files describe the
same data in two languages and must be changed together.**

---

## 10. Folder and file structure

```
CacheLens/
│
├── packages/
│   ├── dotnet/
│   │   ├── CacheLens.Core/                    Shared contracts — no dependencies
│   │   │   ├── CacheEntrySnapshot.cs          One cache entry as sent over the wire
│   │   │   ├── CacheKind.cs                   Memory / Distributed / Hybrid
│   │   │   ├── CacheLensInstanceFile.cs       Discovery file shape + directory location
│   │   │   ├── HandshakeInfo.cs               Response body for GET /meta
│   │   │   └── ProtocolVersion.cs             ⚠️ Mirrored in types.ts
│   │   │
│   │   ├── CacheLens.AspNetCore/              The package users install
│   │   │   ├── TrackedMemoryCache.cs          ⭐ The decorator — core of the project
│   │   │   ├── TrackedCacheEntry.cs           One tracked entry in the side index
│   │   │   ├── CacheLensRegistry.cs           Aggregates tracked caches
│   │   │   ├── CacheLensOptions.cs            Redaction, size caps, route prefix
│   │   │   ├── CacheLensRuntimeState.cs       Per-process bearer token
│   │   │   ├── ServiceCollectionExtensions.cs AddCacheLens() — the DI swap
│   │   │   ├── CacheLensEndpointExtensions.cs MapCacheLens() — endpoints + auth
│   │   │   └── CacheLensDiscoveryHostedService.cs   Writes/removes the discovery file
│   │   │
│   │   └── icon.png                           Shared NuGet package icon
│   │
│   └── vscode-extension/                      The VS Code extension
│       ├── src/
│       │   ├── extension.ts                   Entry point, command registration
│       │   ├── types.ts                       ⚠️ Mirrors CacheLens.Core
│       │   ├── discovery.ts                   Watches the instance directory
│       │   ├── apiClient.ts                   HTTP calls to /_cachelens/*
│       │   ├── instanceManager.ts             Connection state + 3s polling
│       │   ├── format.ts                      Sizes, countdowns, relative times
│       │   ├── statusBar.ts                   Summary in the status bar
│       │   ├── views/
│       │   │   └── treeDataProvider.ts        The key tree
│       │   └── webview/
│       │       └── inspectorPanel.ts          The value inspector panel
│       ├── media/
│       │   ├── icon.svg                       Activity Bar icon (monochrome — required)
│       │   ├── icon-128.png                   Marketplace listing icon
│       │   └── logo.svg                       Full-colour brand mark
│       ├── package.json                       Manifest: commands, views, menus
│       ├── esbuild.js                         Bundler config
│       └── README.md                          → becomes the Marketplace listing
│
├── samples/
│   └── CacheLens.Sample/                      Test app: absolute + sliding + redacted keys
│
├── site/
│   └── index.html                             Product website (self-contained, no build)
│
├── docs/
│   ├── architecture.md                        This file
│   ├── INSTALLATION.md                        Guide for people using CacheLens
│   ├── brand.md                               Colour palette and typography rationale
│   └── images/
│
├── CONTRIBUTING.md                            Guide for people working on CacheLens
├── README.md                                  Project front page
├── vercel.json                                Static site deploy config
└── CacheLens.slnx                             Solution file
```

⭐ = start here if you are new to the codebase
⚠️ = must be changed together with its counterpart

---

## 11. How users get CacheLens

Users need **both halves**. The package instruments the app; the extension displays it. Neither
is useful alone.

```mermaid
flowchart TD
    Start["Developer wants to see inside their cache"]

    Start --> P1["Half 1: the NuGet package<br/><i>goes in their app</i>"]
    Start --> P2["Half 2: the VS Code extension<br/><i>goes in their editor</i>"]

    P1 --> N1["dotnet add package<br/>CacheLens.AspNetCore"]
    P1 --> N2["PackageReference in .csproj"]
    P1 --> N3["Build from source"]

    P2 --> V1["Search 'CacheLens' in<br/>the Extensions panel"]
    P2 --> V2["Marketplace website"]
    P2 --> V3["Open VSX<br/><i>Cursor, VSCodium</i>"]
    P2 --> V4["Install a .vsix file directly"]
    P2 --> V5["Run from source with F5"]

    N1 --> Wire["Add AddCacheLens()<br/>and MapCacheLens()"]
    V1 --> Wire
    Wire --> Run["dotnet run"]
    Run --> Done["App appears automatically<br/>in the CacheLens panel"]

    style Done fill:#18211e,stroke:#37d6ae,color:#e9efeb
    style P1 fill:#18211e,stroke:#f2a93b,color:#e9efeb
    style P2 fill:#18211e,stroke:#37d6ae,color:#e9efeb
```

### Distribution channels

| Channel | What it carries | Audience |
|---|---|---|
| **NuGet.org** | `CacheLens.AspNetCore`, `CacheLens.Core` | Every .NET developer — `dotnet add package` |
| **VS Code Marketplace** | The extension | VS Code users |
| **Open VSX** | The same extension | Cursor, VSCodium, Gitpod — these cannot read the MS Marketplace |
| **GitHub Releases** | `.vsix` and `.nupkg` files | Air-gapped or corporate environments |
| **GitHub source** | Everything | Contributors, and anyone who wants to build it themselves |

Publishing to **both** the VS Code Marketplace and Open VSX matters: Microsoft's Marketplace
terms restrict other editors from using it, so Cursor and VSCodium users can only install from
Open VSX. Skipping it silently excludes a large slice of the audience.

### Requirements

| | |
|---|---|
| .NET | 8.0 or 9.0 |
| App type | ASP.NET Core (needs DI and a request pipeline) |
| VS Code | 1.85 or newer |
| Platforms | Windows, macOS, Linux |

---

## 12. Status and roadmap

**Verified working** — exercised end to end against the sample app:

- `IMemoryCache` tracking: keys, values, sizes, absolute and sliding expiry, per-key hit counts
- Zero-config discovery, tree view, value inspector, evict, clear, snapshot export
- Loopback + token auth, key redaction, payload caps

**Known limitations**, stated plainly:

| Limitation | Detail |
|---|---|
| `IMemoryCache` only | `IDistributedCache` and `HybridCache` are designed for but not built |
| Polling, not push | Refreshes every 3 seconds while the view is visible; no WebSocket yet |
| ASP.NET Core only | Console apps and worker services need a different hosting approach |
| No automated tests | Verification has been manual and reproduction-driven |
| Stale discovery files | Force-killed apps leave a file behind (see [§7](#7-zero-configuration-discovery)) |

**Roadmap**

```mermaid
timeline
    title CacheLens roadmap
    section Done
        Spike : IMemoryCache decorator : HTTP endpoints : Sample app
        MVP : Discovery : Tree view : Inspector : Evict and export
    section Next
        Publish : NuGet : VS Code Marketplace : Open VSX
        Live updates : WebSocket push : replace 3s polling
    section Later
        Broader caches : IDistributedCache : Redis SCAN : HybridCache
        Dashboard : project-wide key view : endpoints alongside keys : exportable reports
        Quality : Automated tests : PID liveness checks
    section Exploring
        Zero install : EventPipe attach : reduced fidelity, no NuGet needed
```

---

## Appendix — verification notes

The .NET API claims in [§1](#1-the-problem-honestly-stated) were checked by compiling a probe
against each target framework rather than relying on documentation, which is ambiguous about
which version introduced `MemoryCache.Keys`:

- `MemoryCache.Keys` on **net8.0** → compile error `CS1061`
- `MemoryCache.Keys` on **net9.0** → compiles and returns keys
- `IMemoryCache.Keys` on **net9.0** → compile error `CS1061` (interface does not expose it)

Sources: [MemoryCache Class](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.caching.memory.memorycache) ·
[MemoryCache.Keys Property](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.caching.memory.memorycache.keys) ·
[IMemoryCache Interface](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.caching.memory.imemorycache)
