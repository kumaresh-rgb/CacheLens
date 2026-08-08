import * as vscode from "vscode";
import { InstanceManager } from "./instanceManager";

/**
 * Summarizes whichever instances are currently connected in one status bar item, since a
 * developer often just wants a glance ("is anything cached right now?") without opening the
 * tree view. Clicking it focuses the CacheLens view.
 */
export class CacheLensStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

  constructor(private readonly instances: InstanceManager) {
    this.item.command = "workbench.view.extension.cachelens";
    this.instances.onDidChangeData(() => this.update());
    this.update();
  }

  private update(): void {
    const all = this.instances.getInstances();
    if (all.length === 0) {
      this.item.hide();
      return;
    }

    const connected = all.filter((i) => i.state === "connected");
    const totalEntries = connected.reduce((sum, i) => sum + i.entries.length, 0);
    const totalHits = connected.reduce((sum, i) => sum + i.entries.reduce((s, e) => s + e.hitCount, 0), 0);

    this.item.text = `$(database) CacheLens: ${totalEntries} ${totalEntries === 1 ? "entry" : "entries"}`;
    this.item.tooltip = `${connected.length}/${all.length} app${all.length === 1 ? "" : "s"} connected · ${totalHits} cache hit${totalHits === 1 ? "" : "s"} observed`;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
