import * as vscode from "vscode";
import { CacheLensStatusBar } from "./statusBar";
import { InstanceManager } from "./instanceManager";
import { CacheLensTreeDataProvider, EntryNode, InstanceNode } from "./views/treeDataProvider";
import { InspectorPanelManager } from "./webview/inspectorPanel";

const POLL_INTERVAL_MS = 3000;

export function activate(context: vscode.ExtensionContext): void {
  const instances = new InstanceManager();
  const treeDataProvider = new CacheLensTreeDataProvider(instances);
  const inspectorPanels = new InspectorPanelManager(instances);
  const statusBar = new CacheLensStatusBar(instances);

  const treeView = vscode.window.createTreeView("cachelens.instances", {
    treeDataProvider,
    showCollapseAll: true,
  });

  // Only poll while the view is actually visible — no reason to hit apps' endpoints from a
  // collapsed/hidden panel, and it keeps this well-behaved for the "millions of users" case
  // where most of them aren't looking at this view most of the time.
  const syncPolling = () => {
    if (treeView.visible) {
      instances.startPolling(POLL_INTERVAL_MS);
    } else {
      instances.stopPolling();
    }
  };
  treeView.onDidChangeVisibility(syncPolling);

  instances.onDidChangeData(() => inspectorPanels.refreshAllOpen());

  instances.start();
  syncPolling();

  context.subscriptions.push(
    instances,
    inspectorPanels,
    statusBar,
    treeView,

    vscode.commands.registerCommand("cachelens.refresh", () => {
      void instances.refreshAll();
    }),

    vscode.commands.registerCommand("cachelens.clearAll", async (node?: InstanceNode) => {
      const instance = node?.instance;
      if (!instance) {
        return;
      }
      const confirmed = await vscode.window.showWarningMessage(
        `Evict every entry CacheLens is tracking in "${instance.label}"? This clears the app's real cache, not just this view.`,
        { modal: true },
        "Clear All",
      );
      if (confirmed === "Clear All") {
        await instances.clear(instance.id);
      }
    }),

    vscode.commands.registerCommand("cachelens.evictEntry", async (node?: EntryNode) => {
      if (!node) {
        return;
      }
      await instances.evict(node.instance.id, node.entry.key);
    }),

    vscode.commands.registerCommand("cachelens.inspectEntry", (node?: EntryNode) => {
      if (!node) {
        return;
      }
      inspectorPanels.show(node.instance, node.entry);
    }),

    vscode.commands.registerCommand("cachelens.copyValue", async (node?: EntryNode) => {
      if (!node?.entry.valueJson) {
        return;
      }
      await vscode.env.clipboard.writeText(node.entry.valueJson);
      void vscode.window.showInformationMessage(`Copied value of "${node.entry.key}" to the clipboard.`);
    }),

    vscode.commands.registerCommand("cachelens.connectRemote", async () => {
      const url = await vscode.window.showInputBox({
        prompt: "Base URL of the app — no route suffix. Use the address it logged at startup, or your forwarded port.",
        placeHolder: "http://127.0.0.1:5225",
        validateInput: (value) => (isValidHttpUrl(value) ? undefined : "Enter a full http(s):// URL."),
      });
      if (!url) {
        return;
      }

      const token = await vscode.window.showInputBox({
        prompt: `Token for ${url} — the "token" field in that machine's cachelens/instances/<pid>.json`,
        password: true,
      });
      if (!token) {
        return;
      }

      instances.addManualConnection(url, token);
    }),

    vscode.commands.registerCommand("cachelens.exportSnapshot", async () => {
      const all = instances.getInstances().filter((i) => i.state === "connected");
      if (all.length === 0) {
        void vscode.window.showWarningMessage("No connected CacheLens instances to export.");
        return;
      }

      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file("cachelens-snapshot.json"),
        filters: { JSON: ["json"] },
      });
      if (!target) {
        return;
      }

      const payload = all.map((instance) => ({
        application: instance.meta?.applicationName ?? instance.label,
        url: instance.url,
        exportedAt: new Date().toISOString(),
        entries: instance.entries,
      }));

      await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(payload, null, 2), "utf8"));
      void vscode.window.showInformationMessage(`Exported snapshot to ${target.fsPath}`);
    }),
  );
}

export function deactivate(): void {
  // All disposables are owned by context.subscriptions; nothing to do here.
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
