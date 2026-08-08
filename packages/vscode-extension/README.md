# CacheLens

See what's actually inside your ASP.NET Core `IMemoryCache` at runtime — keys, values, size,
expiration, and hit/miss counts — without leaving VS Code.

## Setup

1. Add the NuGet package to the app you want to inspect:

   ```bash
   dotnet add package CacheLens.AspNetCore
   ```

2. Wire it up in `Program.cs`:

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

3. Run the app. It shows up in the **CacheLens** view in the Activity Bar automatically — no
   host, port, or token to type in by hand.

## What you get

- A live tree of every key currently in the app's `IMemoryCache`, with size, TTL, and hit count.
- Click a key to inspect its value as formatted JSON, see full metadata, evict it, or copy the
  value.
- Evict one key or clear everything, right from the tree.
- Values for keys that look secret-shaped (`password`, `token`, `secret`, …) are never sent to
  the editor — you'll see the key exists, never its contents.

See the [project README](https://github.com/cachelens/cachelens) for the full architecture and
roadmap (distributed/hybrid cache support, live push updates, and more are on the way).
