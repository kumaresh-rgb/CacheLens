import * as vscode from "vscode";
import { describeOmittedReason, formatExpiration, formatRelativeTime, formatSize } from "../format";
import { CacheInstance, InstanceManager } from "../instanceManager";
import { CacheEntrySnapshot, ValueOmittedReason } from "../types";

/**
 * One webview panel per (instance, key) pair, reused on repeat inspection of the same entry.
 * Content is entirely self-contained (no external resources) and styled with VS Code's CSS
 * variables so it follows the active theme automatically.
 */
export class InspectorPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(private readonly instances: InstanceManager) {}

  show(instance: CacheInstance, entry: CacheEntrySnapshot): void {
    const panelKey = `${instance.id}::${entry.key}`;
    const existing = this.panels.get(panelKey);
    if (existing) {
      existing.reveal(vscode.ViewColumn.Beside, true);
      this.render(existing, instance, entry);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "cachelens.inspector",
      entry.key,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );

    panel.webview.onDidReceiveMessage(async (message: { type: string }) => {
      switch (message.type) {
        case "evict":
          await this.instances.evict(instance.id, entry.key);
          panel.dispose();
          break;
        case "refresh":
          await this.instances.refreshInstance(instance.id);
          this.refreshIfLive(instance.id, entry.key);
          break;
        case "copy": {
          const current = this.instances.getInstance(instance.id)?.entries.find((e) => e.key === entry.key);
          if (current?.valueJson) {
            await vscode.env.clipboard.writeText(current.valueJson);
            void vscode.window.showInformationMessage(`Copied value of "${entry.key}" to the clipboard.`);
          }
          break;
        }
      }
    });

    panel.onDidDispose(() => this.panels.delete(panelKey));
    this.panels.set(panelKey, panel);
    this.render(panel, instance, entry);
  }

  /** Re-renders an open panel for (instanceId, key) after a background refresh, if it's still open. */
  refreshIfLive(instanceId: string, key: string): void {
    const panel = this.panels.get(`${instanceId}::${key}`);
    const instance = this.instances.getInstance(instanceId);
    const entry = instance?.entries.find((e) => e.key === key);
    if (panel && instance && entry) {
      this.render(panel, instance, entry);
    }
  }

  /** Called whenever InstanceManager's data changes (e.g. background polling) to keep every open panel in sync. */
  refreshAllOpen(): void {
    for (const panelKey of this.panels.keys()) {
      const separatorIndex = panelKey.indexOf("::");
      const instanceId = panelKey.slice(0, separatorIndex);
      const key = panelKey.slice(separatorIndex + 2);
      this.refreshIfLive(instanceId, key);
    }
  }

  private render(panel: vscode.WebviewPanel, instance: CacheInstance, entry: CacheEntrySnapshot): void {
    panel.title = entry.key;
    panel.webview.html = renderHtml(instance, entry);
  }

  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}

/**
 * Which semantic state this entry is in, per the temperature system in docs/brand.md.
 * Drives the status chip's color so the entry's condition reads before any text is parsed.
 */
function entryTone(entry: CacheEntrySnapshot): { tone: "warm" | "cold" | "locked"; label: string } {
  if (entry.valueOmitted === ValueOmittedReason.RedactedByKeyPattern) {
    return { tone: "locked", label: "Redacted" };
  }
  const expiration = formatExpiration(entry);
  if (expiration === "expired") {
    return { tone: "cold", label: "Expired" };
  }
  return { tone: "warm", label: expiration ?? "No expiration" };
}

function renderHtml(instance: CacheInstance, entry: CacheEntrySnapshot): string {
  const valueBlock = entry.valueOmitted !== null
    ? `<p class="omitted">${escapeHtml(describeOmittedReason(entry.valueOmitted))}</p>`
    : `<pre class="value">${escapeHtml(prettyPrintJson(entry.valueJson))}</pre>`;

  const expiration = formatExpiration(entry);
  const { tone, label: toneLabel } = entryTone(entry);

  const rows: [string, string][] = [
    ["Application", instance.meta?.applicationName ?? instance.label],
    ["Type", entry.valueType ?? "—"],
    ["Size", formatSize(entry.sizeBytes)],
    ["Hits", String(entry.hitCount)],
    ["Created", `${formatRelativeTime(entry.createdAt)} (${entry.createdAt})`],
    ["Last accessed", entry.lastAccessedAt ? `${formatRelativeTime(entry.lastAccessedAt)} (${entry.lastAccessedAt})` : "—"],
    ["Expiration", expiration ?? "none"],
  ];

  const metadataRows = rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("\n");

  return /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  /*
    Colors come from VS Code's own theme variables, deliberately: an extension that imposes its
    brand palette over the user's chosen theme reads as broken, not designed. The two brand
    accents from docs/brand.md appear only where the platform offers no semantic equivalent —
    the state chip (warm = live, cold = expired, muted = redacted) — and both are defined
    per-theme below so they stay legible on light, dark, and high-contrast grounds.
  */
  :root {
    --cl-warm: #b8780e;
    --cl-cold: #5a6b7d;
    --cl-warm-soft: rgba(184, 120, 14, 0.12);
    --cl-cold-soft: rgba(90, 107, 125, 0.12);
  }
  body.vscode-dark, body.vscode-high-contrast {
    --cl-warm: #f2a93b;
    --cl-cold: #7c8fa8;
    --cl-warm-soft: rgba(242, 169, 59, 0.14);
    --cl-cold-soft: rgba(124, 143, 168, 0.14);
  }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 0 18px 20px;
    line-height: 1.6;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--vscode-panel-border);
    padding: 16px 0 12px;
    margin-bottom: 16px;
  }
  h1 {
    font-family: var(--vscode-editor-font-family);
    font-size: 1.05em;
    font-weight: 600;
    word-break: break-all;
    margin: 0;
    flex: 1;
    min-width: 0;
  }

  /* State chip — the one place brand color earns its keep, because VS Code has no
     "this cache entry is warm vs cold" variable to borrow. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 9px;
    border-radius: 100px;
    font-size: 0.85em;
    white-space: nowrap;
    border: 1px solid currentColor;
  }
  .chip::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex: none;
  }
  .chip[data-tone="warm"] { color: var(--cl-warm); background: var(--cl-warm-soft); }
  .chip[data-tone="cold"] { color: var(--cl-cold); background: var(--cl-cold-soft); }
  .chip[data-tone="locked"] { color: var(--vscode-descriptionForeground); background: transparent; }

  table { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
  th {
    text-align: left;
    color: var(--vscode-descriptionForeground);
    font-weight: 400;
    padding: 4px 16px 4px 0;
    vertical-align: top;
    white-space: nowrap;
    width: 1%;
  }
  td {
    padding: 4px 0;
    word-break: break-word;
    font-family: var(--vscode-editor-font-family);
    font-variant-numeric: tabular-nums;
  }

  .label {
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--vscode-descriptionForeground);
    margin: 0 0 8px;
  }

  pre.value {
    background: var(--vscode-textCodeBlock-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 14px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--vscode-editor-font-family);
    margin: 0;
  }
  p.omitted {
    color: var(--vscode-descriptionForeground);
    border: 1px dashed var(--vscode-panel-border);
    border-radius: 6px;
    padding: 14px;
    margin: 0;
  }

  .actions { display: flex; gap: 8px; margin-bottom: 22px; flex-wrap: wrap; }
  button {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid transparent;
    padding: 5px 13px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
  button.danger {
    background: transparent;
    border-color: var(--vscode-errorForeground);
    color: var(--vscode-errorForeground);
  }
  button.danger:hover {
    background: var(--vscode-errorForeground);
    color: var(--vscode-editor-background);
  }
</style>
</head>
<body>
  <div class="head">
    <h1>${escapeHtml(entry.key)}</h1>
    <span class="chip" data-tone="${tone}">${escapeHtml(toneLabel)}</span>
  </div>
  <table>${metadataRows}</table>
  <div class="actions">
    <button id="refresh">Refresh</button>
    ${entry.valueOmitted === null ? '<button id="copy">Copy Value</button>' : ""}
    <button id="evict" class="danger">Evict</button>
  </div>
  <p class="label">Value</p>
  ${valueBlock}
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById("refresh")?.addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
    document.getElementById("copy")?.addEventListener("click", () => vscode.postMessage({ type: "copy" }));
    document.getElementById("evict")?.addEventListener("click", () => vscode.postMessage({ type: "evict" }));
  </script>
</body>
</html>`;
}

function prettyPrintJson(json: string | null): string {
  if (json === null) {
    return "null";
  }
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
