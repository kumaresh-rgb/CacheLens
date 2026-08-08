# CacheLens — Architecture Plan

> Naming resolved to **CacheLens** (was "CacheViewer" during initial planning); package/route/
> temp-directory names below reflect that. See [Implementation status](#implementation-status)
> for what's actually built vs. still planned.

## Context

.NET's `IMemoryCache` (and friends: `IDistributedCache`, the new .NET 9 `HybridCache`) give
you no built-in way to see what's actually inside the cache at runtime — no key list, no
values, no TTLs, no hit/miss stats. Every team ends up hand-rolling `_cache.TryGetValue` debug
endpoints or reflecting into `MemoryCache` internals. Redis has Redis Insight-style viewers;
in-proc .NET caching has nothing equivalent. This project fills that gap: a VS Code extension
paired with an open-source NuGet package that together let a developer *see* their cache (keys,
values, size, expiration, hit/miss) the way they'd browse Redis keys today.

Decisions locked in early on:
- **Data access for v1**: NuGet package decorates the cache and exposes it over a localhost-only
  endpoint; the extension is a client of that endpoint (not a zero-install process-attach — that's
  a later stretch goal).
- **Cache scope for v1**: `IMemoryCache` + `IDistributedCache` + `HybridCache`.
- **App target for v1**: ASP.NET Core web apps (has DI + a request pipeline to piggyback on).
- **Business model**: fully free and open source (MIT), no paywall — optimize for adoption.
- **Goal**: dead-simple onboarding (`dotnet add package` + install the extension, zero manual
  config to get your first view of the cache), because ease-of-use is the product's whole pitch.

## Implementation status

**Built and verified end-to-end** (`packages/dotnet/CacheLens.Core`, `CacheLens.AspNetCore`,
`samples/CacheLens.Sample`, `packages/vscode-extension`):
- `TrackedMemoryCache` — full `IMemoryCache` decorator with its own side-index, hit counts,
  expiration tracking, and JSON serialization with redaction/size-cap rules.
- `AddCacheLens()` / `MapCacheLens()` — DI wiring that wraps whatever `IMemoryCache` the app
  already had registered, plus `/meta`, `/snapshot`, `/evict/{key}`, `/clear` minimal API
  endpoints gated by loopback-only + per-run bearer token.
- Discovery file writer — writes `%TEMP%/cachelens/instances/<pid>.json` on startup (camelCase
  JSON, matching the HTTP endpoints), removes it on shutdown.
- The VS Code extension: a `DiscoveryWatcher` that file-watches the instance directory, an
  `InstanceManager` that polls each discovered (or manually-added) app's endpoints and tracks
  connection state, a tree view (Activity Bar → CacheLens) grouping entries under each app with
  size/TTL/hit-count at a glance, a webview inspector panel for a selected key (formatted JSON,
  metadata, Evict/Refresh/Copy), a status bar summary, and commands for refresh/clear/evict/
  export-snapshot/add-remote-connection. Compiles clean (`tsc --noEmit`), bundles clean
  (esbuild), and packages clean (`vsce package`, 10.5 KB, no warnings).

**Not built yet**:
- Live push updates (`WS /_cachelens/stream`) — the extension polls every 3s (only while its
  view is visible) rather than subscribing to a push stream.
- `IDistributedCache` / `HybridCache` tracking (`CacheLensRegistry` and the extension's
  `CacheKind` enum are already shaped to add these without touching the endpoints or the tree
  view's grouping).
- Publishing to the VS Code Marketplace / Open VSX / nuget.org — nothing's published yet, this
  is all local-build-only so far.
- An actual test project (xUnit for the .NET side, `@vscode/test-electron` for the extension) —
  verification so far has been targeted manual/fixture-based checks per change, documented in
  [Verification](#verification) below.
- The product/marketing site.

## High-Level Architecture

```
┌─────────────────────────────┐        localhost only         ┌──────────────────────────────┐
│  ASP.NET Core app (user's)  │◄──────────────────────────────►│   VS Code Extension           │
│                              │   HTTP (snapshot) + WebSocket  │                                │
│  services.AddCacheLens()    │   (live updates), token-auth   │  Tree View + Webview inspector │
│                              │                                │                                │
│  ┌────────────────────────┐ │                                │  ┌──────────────────────────┐  │
│  │ TrackedMemoryCache      │ │                                │  │ Discovery Watcher          │  │
│  │ TrackedDistributedCache │ │  writes discovery file on boot │  │ (watches instance folder)  │  │
│  │ TrackedHybridCache      │ │ ───────────────────────────► │  └──────────────────────────┘  │
│  └────────────────────────┘ │  %TEMP%/cachelens/<pid>.json   │  ┌──────────────────────────┐  │
│  ┌────────────────────────┐ │                                │  │ Connection Client (ws)    │  │
│  │ Minimal API endpoints   │ │                                │  └──────────────────────────┘  │
│  │ /_cachelens/*           │ │                                │  ┌──────────────────────────┐  │
│  └────────────────────────┘ │                                │  │ React Webview UI (table,   │  │
└─────────────────────────────┘                                │  │ JSON inspector, evict/clear)│  │
                                                                 └──────────────────────────────┘
```

Two independently-shippable, versioned components joined by a small versioned wire protocol:

1. **`CacheLens` NuGet package(s)** — instruments the app's caches and serves the data.
2. **`CacheLens` VS Code extension** — discovers running instances and renders the data.

## Component 1: NuGet Package

Repo layout under `packages/dotnet/`:
- `CacheLens.Core` — shared contracts: `CacheEntrySnapshot`, wire-protocol DTOs, protocol
  version constant. Referenced by both the instrumentation package and (later) any CLI/tooling.
- `CacheLens.AspNetCore` — the package users actually install. Multi-targets `net8.0`/`net9.0`
  (keep dependency-light so it doesn't force upgrades across a huge install base).

**Why a side-index instead of reflecting into `MemoryCache` internals**: `MemoryCache`'s ability
to enumerate keys has changed across .NET versions and isn't guaranteed stable. Instead, wrap
each cache abstraction in a decorator that maintains its own `ConcurrentDictionary<object,
TrackedCacheEntry>`, updated on every write/remove/eviction callback. This is stable across
.NET versions and doesn't depend on private fields.

One subtlety worth calling out since it caused a real bug during the spike: `MemoryCache`
invokes `PostEvictionCallbacks` **asynchronously** (thread-pool), not inline. If a key expires
and gets recreated quickly, the old entry's delayed eviction callback can run *after* the new
entry has already been committed to the index — a naive `_index.TryRemove(key, ...)` in that
callback would then delete the wrong (newer) entry. The fix is an identity-checked removal (only
remove if the index still holds *this exact* tracked-entry instance for that key), implemented
via `ConcurrentDictionary`'s `ICollection<KeyValuePair<,>>.Remove(item)` compare-and-remove
overload. See `TrackedMemoryCache.OnEntryEvicted` for the implementation and its doc comment.

- `TrackedMemoryCache : IMemoryCache` — wraps the real `MemoryCache`, tracks key, declared
  value type, estimated size, absolute/sliding expiration, created/last-accessed timestamps,
  hit count. Registers an eviction callback on every entry to keep the index honest.
- `TrackedDistributedCache : IDistributedCache` *(not yet built)* — can't enumerate a remote
  store, so it would track *recently-touched* keys/ops from this process's own calls, and
  optionally accept a user-supplied `IConnectionMultiplexer` to do a real Redis `SCAN` for full
  key listing when available.
- `TrackedHybridCache` *(not yet built)* — wraps .NET 9's `HybridCache`, reporting L1 (in-proc)
  stats fully and L2 stats when the underlying distributed store is introspectable the same way.

Registration is one call: `services.AddCacheLens(options => { ... })`, which decorates
whatever `IMemoryCache` registration already exists in DI — no changes needed at cache call
sites. It works by removing the existing `IMemoryCache` `ServiceDescriptor`, rebuilding its
original implementation from that descriptor (factory/type/instance, whichever it used), and
wrapping the result in `TrackedMemoryCache` — see `ServiceCollectionExtensions.AddCacheLens`.

**Local transport** (Minimal API endpoints under a configurable route, default
`/_cachelens`):
- `GET /_cachelens/meta` — handshake: app name, PID, protocol version, which cache types are
  present.
- `GET /_cachelens/snapshot` — full current listing.
- `WS /_cachelens/stream` *(not yet built)* — push add/update/evict events for live updates.
- `POST /_cachelens/evict/{key}`, `POST /_cachelens/clear`.

**Safety defaults** (important — this must never become an accidental prod data leak):
- Disabled unless `IsDevelopment()` or explicitly opted in.
- Every request checked against loopback (`IPAddress.IsLoopback`) regardless of what address
  Kestrel is actually bound to.
- Random per-run token required on every request (logged to console at startup, like Jupyter's
  token URLs) — the extension reads it from the discovery file, never typed by hand.
- Configurable key-pattern redaction (e.g. keys containing `password`/`token` never send
  values, only metadata) — `CacheLensOptions.RedactKeyPatterns`.
- Value payloads capped in size (`CacheLensOptions.MaxValuePayloadBytes`); oversized values
  reported as omitted with a reason rather than serialized in full.

**Discovery (the thing that makes this "just work")**: on startup, the package writes a small
JSON file to a well-known per-user directory (`%TEMP%/cachelens/instances/<pid>.json` —
`{ processId, processName, url, token, startedAt }`), deleted on graceful shutdown. This mirrors
how the .NET diagnostics IPC and the Aspire dashboard find running processes. The extension (once
built) just watches that directory — press F5 on the app, the extension shows it automatically,
no host/port typed anywhere. A manual "Add remote connection" (host:port) command will cover
Docker/Kubernetes/port-forwarded scenarios later.

## Component 2: VS Code Extension

`packages/vscode-extension/src/`, plain TypeScript bundled with esbuild (no framework — the
webview is a hand-written HTML string, not React, since a single read-only-ish detail panel
didn't justify the dependency; revisit if the inspector grows real interactivity):

- **`discovery.ts` (`DiscoveryWatcher`)** — file-watches the instance directory, diffs against
  the previously-known set of instances, fires a change event. *Built.*
- **`instanceManager.ts` (`InstanceManager`)** — merges discovered + manually-added connections,
  polls each one's `/meta` + `/snapshot` (3s interval, only while the tree view is visible),
  tracks per-instance connection state and protocol-version mismatches. *Built* (poll-based; a
  `Connection Client` subscribing to a push `WS /_cachelens/stream` is the planned upgrade once
  that endpoint exists).
- **`views/treeDataProvider.ts`** — Tree View (Activity Bar → CacheLens) with an app node per
  instance (icon reflects connecting/connected/error) and a key node per entry (size · hits ·
  expiration in the description, full metadata in the tooltip), sorted by key. *Built*; grouping
  by cache kind (Memory/Distributed/Hybrid) is a straightforward follow-up once more than one
  kind exists to group.
- **`webview/inspectorPanel.ts`** — click a key to see pretty-printed JSON, metadata, and
  Evict/Refresh/Copy actions in a webview panel; styled entirely with VS Code CSS variables so
  it tracks the active theme with no extra work. *Built.*
- **`statusBar.ts`** — total entries / connected-app count across all instances. *Built.*
- **Commands** (`package.json` → `contributes.commands`) — `CacheLens: Refresh`, `Clear All
  Entries`, `Evict`, `Inspect Value`, `Add Remote Connection...`, `Export Snapshot as JSON...`,
  `Copy Value`. *Built.*
- Activates only when a `.csproj`/`.sln`/`.slnx` is present in the workspace
  (`activationEvents: workspaceContains:...`), so it doesn't slow down VS Code for non-.NET
  users. *Built.*

## Wire Protocol & Compatibility

Given the eventual install base, package and extension versions will drift out of sync in the
wild (a team upgrades the extension but not the NuGet package, or vice versa). The `/meta`
handshake carries an explicit protocol version (`CacheLens.Core.ProtocolVersion.Current`); the
extension must handle older protocol versions gracefully (feature-detect, not assume) and show a
friendly "update your package" message on a hard mismatch rather than failing silently.

## Phased Roadmap

1. **Spike** *(done)* — `IMemoryCache` decorator + `/snapshot` endpoint + sample app, driven
   manually via `curl`/the discovery file. Proved the end-to-end value prop.
2. **MVP** *(mostly done)* — the VS Code extension: discovery-file auto-detection, tree view,
   webview value inspector, evict/clear, done. Still open: WebSocket live updates (currently
   polling), docs site v1, and actually publishing to NuGet, VS Code Marketplace, and Open VSX.
3. **Broaden scope** — `IDistributedCache` (with optional Redis `SCAN` integration) and
   `HybridCache` support, redaction rules, snapshot export/import, side-by-side multi-instance
   view.
4. **Stretch: zero-install attach** — explore EventCounters/EventPipe-based read-only stats
   (counts, hit rate) without requiring the NuGet reference, shipped as a clearly-labeled
   reduced-fidelity "attach mode" (no key/value browsing — that needs app-level serialization
   cooperation, which only the package can provide).
5. **Growth** — GitHub Discussions, issue templates, contribution guide, roadmap board,
   sponsorship links, blog/launch content, integration recipes (e.g. an Aspire dashboard tie-in).

## Scaling to a Large Install Base

- Multi-target the NuGet package broadly (`net8.0`+) and keep it dependency-light so it doesn't
  force framework upgrades.
- Strict semver + the protocol-version handshake above, since NuGet and extension releases
  won't upgrade in lockstep across millions of installs.
- CI/CD via GitHub Actions: tag-triggered publish to nuget.org, VS Code Marketplace, and Open
  VSX, with automated changelogs.
- Telemetry, if any, is opt-in, anonymous, and respects VS Code's global telemetry setting.
- Repo stays a single monorepo (`packages/dotnet`, `packages/vscode-extension`, `site`, `docs`)
  so protocol changes to both sides ship atomically in one PR.

## Product Site *(not yet built)*

A modern, animated marketing/docs site (e.g. Astro or Next.js static export) separate from the
docs-as-reference content, deployed on Vercel/GitHub Pages:
- Hero with a looping demo (video/Lottie) of the extension actually browsing a cache.
- Problem statement mirroring this plan's Context section — visitors should immediately
  recognize "yes, I've hit this."
- Two-tab install block: VS Code Marketplace button + copy-paste `dotnet add package` command.
- Scroll-triggered feature showcase (Framer Motion/GSAP), GitHub star badge, changelog, docs.
- SEO targets: "dotnet cache viewer", "IMemoryCache debug", "view in-memory cache vscode",
  "redis insight alternative dotnet".

## Verification

**.NET side**:
- `samples/CacheLens.Sample` exercises the whole path today: absolute-expiration cache-aside
  read, sliding-expiration read, and a redacted-by-key-pattern write. Confirmed manually via
  `curl` against `/_cachelens/meta`, `/snapshot`, `/evict/{key}`, `/clear`, including the
  loopback + bearer-token auth rejection paths.
- The eviction-identity race described above was caught with a targeted repro (rapid
  expire-and-recreate under the same key in a tight loop) before being fixed — worth keeping as
  a regression test once a test project exists.

**Extension side**:
- `tsc --noEmit` and the esbuild bundle both pass clean with `strict` TypeScript settings.
- `vsce package` produces a clean VSIX (10.5 KB, no warnings) with only the built output, not
  raw source, once `.vscodeignore` + a package-local `LICENSE`/`README.md` were added — catches
  real manifest/packaging mistakes without needing a GUI.
- `format.ts`'s formatting logic (size, expiration countdowns, redaction descriptions, relative
  timestamps) was checked against a real `/snapshot` response captured from the running sample
  app, not hand-typed fixtures — this is also what caught and confirmed the discovery-file
  casing fix (the file was PascalCase while the HTTP endpoints were camelCase; now both match).
- Not yet run: an actual Extension Development Host session (F5) against the sample app, or
  `@vscode/test-electron` coverage — this environment can build and reason about the code but
  hasn't launched the GUI extension host. Treat that as the next concrete verification step
  before considering the MVP done, alongside an xUnit project for the .NET side.
