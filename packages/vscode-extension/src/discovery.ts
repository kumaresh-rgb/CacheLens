import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { CacheLensInstanceFile } from "./types";

/**
 * Watches the shared per-user directory CacheLens.AspNetCore writes discovery files to
 * (%TEMP%/cachelens/instances/<pid>.json — see CacheLensInstanceFile.InstanceDirectory on the
 * .NET side) so running apps show up with zero configuration. One file per live process; a
 * missing/unparsable file just means "not there yet" or "mid-write", not an error.
 */
export class DiscoveryWatcher implements vscode.Disposable {
  static readonly instanceDirectory = path.join(os.tmpdir(), "cachelens", "instances");

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private readonly instances = new Map<number, CacheLensInstanceFile>();
  private watcher: vscode.FileSystemWatcher | undefined;

  start(): void {
    // Create the directory ourselves if no app has run yet — createFileSystemWatcher needs a
    // base that exists to reliably pick up files added later.
    fs.mkdirSync(DiscoveryWatcher.instanceDirectory, { recursive: true });

    this.rescan();

    const pattern = new vscode.RelativePattern(DiscoveryWatcher.instanceDirectory, "*.json");
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidCreate(() => this.rescan());
    this.watcher.onDidChange(() => this.rescan());
    this.watcher.onDidDelete(() => this.rescan());
  }

  getInstances(): CacheLensInstanceFile[] {
    return [...this.instances.values()];
  }

  private rescan(): void {
    let fileNames: string[];
    try {
      fileNames = fs.readdirSync(DiscoveryWatcher.instanceDirectory).filter((f) => f.endsWith(".json"));
    } catch {
      fileNames = [];
    }

    const seenPids = new Set<number>();
    let changed = false;

    for (const fileName of fileNames) {
      const filePath = path.join(DiscoveryWatcher.instanceDirectory, fileName);
      const parsed = readInstanceFile(filePath);
      if (parsed === undefined) {
        // Most commonly a file caught mid-write by the watcher; it'll settle on the next event.
        continue;
      }

      seenPids.add(parsed.processId);
      const existing = this.instances.get(parsed.processId);
      if (!existing || existing.token !== parsed.token || existing.url !== parsed.url) {
        this.instances.set(parsed.processId, parsed);
        changed = true;
      }
    }

    for (const pid of [...this.instances.keys()]) {
      if (!seenPids.has(pid)) {
        this.instances.delete(pid);
        changed = true;
      }
    }

    if (changed) {
      this._onDidChange.fire();
    }
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }
}

/**
 * Parses one discovery file, returning undefined for anything that isn't a well-formed one.
 * Shared with the manual connect flow, which lets people point straight at such a file.
 */
export function readInstanceFile(filePath: string): CacheLensInstanceFile | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CacheLensInstanceFile>;
    if (
      typeof parsed.processId === "number" &&
      typeof parsed.processName === "string" &&
      typeof parsed.url === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.startedAt === "string"
    ) {
      return parsed as CacheLensInstanceFile;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
