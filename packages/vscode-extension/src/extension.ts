import * as vscode from "vscode";
import { CacheLensStatusBar } from "./statusBar";
import { InstanceManager } from "./instanceManager";
import { CacheLensTreeDataProvider, EntryNode, InstanceNode } from "./views/treeDataProvider";
import { InspectorPanelManager } from "./webview/inspectorPanel";
import { runConnectFlow } from "./connectFlow";

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

    vscode.commands.registerCommand("cachelens.connectRemote", () => runConnectFlow(instances)),

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

