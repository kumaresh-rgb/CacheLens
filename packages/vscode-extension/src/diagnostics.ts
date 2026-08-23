import * as fs from "fs";
import * as vscode from "vscode";
import { DiscoveryWatcher, readInstanceFile } from "./discovery";

/**
 * Reports what CacheLens can and cannot see on this machine.
 *
 * Added because the commonest support report — "there is no token in that folder" — is almost
 * never about the folder. It is an app that never turned CacheLens on, so no discovery file was
 * ever written. Nothing in the UI distinguished that from "the folder is somewhere else", and
 * an empty panel gave people no way to tell which.
 *
 * This names the exact path, says whether it exists, lists whatever is in it, and gives the
 * specific reasons a file would be missing.
 */
export async function showDiagnostics(): Promise<void> {
  const dir = DiscoveryWatcher.instanceDirectory;
  const lines: string[] = [];

  lines.push("CacheLens — diagnostics");
  lines.push("=".repeat(60));
  lines.push("");
  lines.push("Discovery folder");
  lines.push(`  ${dir}`);

  let exists = false;
  try {
    exists = fs.existsSync(dir);
  } catch {
    exists = false;
  }
  lines.push(`  exists: ${exists ? "yes" : "no"}`);
  lines.push("");

  let files: string[] = [];
  if (exists) {
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch (err) {
      lines.push(`  could not read the folder: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  lines.push(`Apps found: ${files.length}`);
  lines.push("");

  for (const name of files) {
    const parsed = readInstanceFile(`${dir}/${name}`.replace(/\\/g, "/"));
    if (parsed) {
      lines.push(`  ${name}`);
      lines.push(`    process : ${parsed.processName} (pid ${parsed.processId})`);
      lines.push(`    url     : ${parsed.url}`);
      lines.push(`    token   : present (${parsed.token.length} characters, not shown)`);
      lines.push(`    started : ${parsed.startedAt}`);
    } else {
      lines.push(`  ${name} — could not be parsed as a discovery file`);
    }
    lines.push("");
  }

  if (files.length === 0) {
    lines.push("No app has registered itself. In order of how often it turns out to be the cause:");
    lines.push("");
    lines.push("  1. The app is not running. CacheLens only reports live processes — the file is");
    lines.push("     deleted on shutdown.");
    lines.push("");
    lines.push("  2. The app is not in Development. CacheLens is normally registered inside an");
    lines.push("     IsDevelopment() check, so in any other environment it never starts.");
    lines.push("     Check ASPNETCORE_ENVIRONMENT.");
    lines.push("");
    lines.push("  3. The two lines are missing. Both are needed:");
    lines.push("         builder.Services.AddCacheLens();   // before Build()");
    lines.push("         app.MapCacheLens();                // after Build()");
    lines.push("");
    lines.push("  4. The package is not installed:  dotnet add package CacheLens.AspNetCore");
    lines.push("");
    lines.push("The definitive check is your app's startup log. If CacheLens is running it prints:");
    lines.push("");
    lines.push("     CacheLens is tracking this app's caches at http://localhost:PORT");
    lines.push("");
    lines.push("No such line means CacheLens never started, and no discovery file exists to find.");
    lines.push("");
    lines.push("An app inside a container or on another host writes its file on THAT machine, not");
    lines.push("this one. Copy it across, then use Add Remote Connection -> Select a discovery file.");
  }

  lines.push("");
  lines.push("=".repeat(60));
  lines.push(`Extension: ${vscode.extensions.getExtension("cachelens.cachelens")?.packageJSON.version ?? "unknown"}`);
  lines.push(`VS Code:   ${vscode.version}`);
  lines.push(`Platform:  ${process.platform}`);

  const doc = await vscode.workspace.openTextDocument({
    content: lines.join("\n"),
    language: "plaintext",
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

/** Opens the discovery folder in the OS file manager, creating it if it has never been used. */
export async function revealDiscoveryFolder(): Promise<void> {
  const dir = DiscoveryWatcher.instanceDirectory;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Showing the folder is best-effort; if it cannot be created, reveal will report why.
  }
  await vscode.env.openExternal(vscode.Uri.file(dir));
}
