import * as vscode from "vscode";
import { CacheLensApiError, clearAll, evictEntry, getMeta, getSnapshot } from "./apiClient";
import { DiscoveryWatcher } from "./discovery";
import { CacheEntrySnapshot, HandshakeInfo, SUPPORTED_PROTOCOL_VERSION } from "./types";

export type InstanceSource = "discovered" | "manual";
export type ConnectionState = "connecting" | "connected" | "error";

export interface CacheInstance {
  readonly id: string;
  readonly label: string;
  readonly source: InstanceSource;
  readonly url: string;
  readonly token: string;
  state: ConnectionState;
  meta: HandshakeInfo | undefined;
  entries: CacheEntrySnapshot[];
  error: string | undefined;
  /** Set when the app's protocol version is newer than this build understands. */
  protocolMismatch: boolean;
}

/**
 * Combines auto-discovered instances (from DiscoveryWatcher) with manually-added remote
 * connections into one list, keeps each instance's snapshot up to date, and is the single
 * source of truth the tree view and status bar render from.
 */
export class InstanceManager implements vscode.Disposable {
  private readonly _onDidChangeData = new vscode.EventEmitter<void>();
  readonly onDidChangeData = this._onDidChangeData.event;

  private readonly discovery = new DiscoveryWatcher();
  private readonly manualConnections = new Map<string, { url: string; token: string; label: string }>();
  private readonly instances = new Map<string, CacheInstance>();

  private pollTimer: ReturnType<typeof setInterval> | undefined;

  start(): void {
    this.discovery.onDidChange(() => {
      this.syncDiscoveredInstances();
      void this.refreshAll();
    });
    this.discovery.start();
    this.syncDiscoveredInstances();
    void this.refreshAll();
  }

  getInstances(): CacheInstance[] {
    return [...this.instances.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  getInstance(id: string): CacheInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * Finds a locally-discovered app whose endpoint matches `url`, so the manual connect flow
   * can fill the token in rather than sending someone to dig through the temp directory.
   *
   * Compares host and port rather than the raw string: an app logs "http://localhost:5225"
   * while its discovery file may record "http://127.0.0.1:5225". Those are the same app, and
   * a plain string comparison would miss it.
   */
  findDiscoveredByUrl(url: string): { url: string; token: string; processName: string } | undefined {
    const wanted = describeEndpoint(url);
    if (!wanted) {
      return undefined;
    }

    for (const file of this.discovery.getInstances()) {
      const candidate = describeEndpoint(file.url);
      if (candidate && candidate === wanted) {
        return { url: file.url, token: file.token, processName: file.processName };
      }
    }

    return undefined;
  }

  addManualConnection(url: string, token: string): void {
    const normalizedUrl = url.replace(/\/+$/, "");
    const id = `manual:${normalizedUrl}`;
    this.manualConnections.set(id, { url: normalizedUrl, token, label: normalizedUrl });
    this.instances.set(id, {
      id,
      label: normalizedUrl,
      source: "manual",
      url: normalizedUrl,
      token,
      state: "connecting",
      meta: undefined,
      entries: [],
      error: undefined,
      protocolMismatch: false,
    });
    this._onDidChangeData.fire();
    void this.refreshInstance(id);
  }

  removeManualConnection(id: string): void {
    this.manualConnections.delete(id);
    this.instances.delete(id);
    this._onDidChangeData.fire();
  }

  /** Begins polling every instance on an interval, for as long as the tree view is visible. */
  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => void this.refreshAll(), intervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async refreshAll(): Promise<void> {
    await Promise.all([...this.instances.keys()].map((id) => this.refreshInstance(id)));
  }

  async refreshInstance(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      return;
    }

    try {
      const connection = { url: instance.url, token: instance.token };
      const [meta, entries] = await Promise.all([getMeta(connection), getSnapshot(connection)]);
      instance.meta = meta;
      instance.entries = entries;
      instance.state = "connected";
      instance.error = undefined;
      instance.protocolMismatch = meta.protocolVersion > SUPPORTED_PROTOCOL_VERSION;
    } catch (err) {
      instance.state = "error";
      instance.error = err instanceof CacheLensApiError ? err.message : String(err);
    }

    this._onDidChangeData.fire();
  }

  async evict(id: string, key: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      return;
    }
    await evictEntry({ url: instance.url, token: instance.token }, key);
    await this.refreshInstance(id);
  }

  async clear(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      return;
    }
    await clearAll({ url: instance.url, token: instance.token });
    await this.refreshInstance(id);
  }

  private syncDiscoveredInstances(): void {
    const discovered = this.discovery.getInstances();
    const seenIds = new Set<string>();

    for (const file of discovered) {
      const id = `discovered:${file.processId}`;
      seenIds.add(id);
      const existing = this.instances.get(id);
      if (existing && existing.url === file.url && existing.token === file.token) {
        continue; // unchanged
      }

      this.instances.set(id, {
        id,
        label: `${file.processName} (${file.processId})`,
        source: "discovered",
        url: file.url,
        token: file.token,
        state: "connecting",
        meta: existing?.meta,
        entries: existing?.entries ?? [],
        error: undefined,
        protocolMismatch: false,
      });
    }

    for (const [id, instance] of this.instances) {
      if (instance.source === "discovered" && !seenIds.has(id)) {
        this.instances.delete(id);
      }
    }
  }

  dispose(): void {
    this.stopPolling();
    this.discovery.dispose();
    this._onDidChangeData.dispose();
  }
}

/** Reduces a URL to "host:port" with loopback aliases folded together, or undefined if unparsable. */
function describeEndpoint(url: string): string | undefined {
  try {
    const u = new URL(url);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    const host = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname)
      ? "loopback"
      : u.hostname.toLowerCase();
    return host + ":" + port;
  } catch {
    return undefined;
  }
}
