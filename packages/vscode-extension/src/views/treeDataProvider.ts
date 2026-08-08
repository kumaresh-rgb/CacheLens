import * as vscode from "vscode";
import { formatExpiration, formatSize } from "../format";
import { CacheInstance, InstanceManager } from "../instanceManager";
import { CacheEntrySnapshot, ValueOmittedReason } from "../types";

export type CacheLensTreeNode = InstanceNode | EntryNode | MessageNode;

export interface InstanceNode {
  type: "instance";
  instance: CacheInstance;
}

export interface EntryNode {
  type: "entry";
  instance: CacheInstance;
  entry: CacheEntrySnapshot;
}

export interface MessageNode {
  type: "message";
  text: string;
}

export class CacheLensTreeDataProvider implements vscode.TreeDataProvider<CacheLensTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly instances: InstanceManager) {
    this.instances.onDidChangeData(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CacheLensTreeNode): vscode.TreeItem {
    switch (element.type) {
      case "instance":
        return this.instanceTreeItem(element.instance);
      case "entry":
        return this.entryTreeItem(element);
      case "message":
        return new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
    }
  }

  getChildren(element?: CacheLensTreeNode): CacheLensTreeNode[] {
    if (!element) {
      return this.instances.getInstances().map((instance): InstanceNode => ({ type: "instance", instance }));
    }

    if (element.type !== "instance") {
      return [];
    }

    const { instance } = element;
    if (instance.state === "connecting") {
      return [{ type: "message", text: "Connecting…" }];
    }
    if (instance.state === "error") {
      return [{ type: "message", text: instance.error ?? "Connection failed." }];
    }
    if (instance.protocolMismatch) {
      return [{ type: "message", text: "This app's CacheLens package is newer than this extension understands — update the extension." }];
    }
    if (instance.entries.length === 0) {
      return [{ type: "message", text: "No cache entries yet." }];
    }

    return [...instance.entries]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((entry): EntryNode => ({ type: "entry", instance, entry }));
  }

  private instanceTreeItem(instance: CacheInstance): vscode.TreeItem {
    const item = new vscode.TreeItem(instance.label, vscode.TreeItemCollapsibleState.Expanded);
    item.contextValue = "cachelens.instance";
    item.id = instance.id;

    switch (instance.state) {
      case "connecting":
        item.iconPath = new vscode.ThemeIcon("sync~spin");
        item.description = "connecting…";
        break;
      case "error":
        item.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
        item.description = "unreachable";
        break;
      case "connected":
        item.iconPath = new vscode.ThemeIcon("server-process");
        item.description = `${instance.entries.length} ${instance.entries.length === 1 ? "entry" : "entries"}`;
        break;
    }

    if (instance.meta) {
      item.tooltip = new vscode.MarkdownString(
        `**${instance.meta.applicationName}**\n\nPID ${instance.meta.processId} · protocol v${instance.meta.protocolVersion} · CacheLens.AspNetCore ${instance.meta.packageVersion}\n\n${instance.url}`,
      );
    }

    return item;
  }

  private entryTreeItem(element: EntryNode): vscode.TreeItem {
    const { entry } = element;
    const item = new vscode.TreeItem(entry.key, vscode.TreeItemCollapsibleState.None);
    item.contextValue = "cachelens.entry";
    item.command = {
      command: "cachelens.inspectEntry",
      title: "Inspect Value",
      arguments: [element],
    };

    const descriptionParts = [formatSize(entry.sizeBytes), `${entry.hitCount} hit${entry.hitCount === 1 ? "" : "s"}`];
    const expiration = formatExpiration(entry);
    if (expiration) {
      descriptionParts.push(expiration);
    }
    item.description = descriptionParts.join(" · ");

    if (entry.valueOmitted === ValueOmittedReason.RedactedByKeyPattern) {
      item.iconPath = new vscode.ThemeIcon("lock");
    } else {
      item.iconPath = new vscode.ThemeIcon("symbol-key");
    }

    item.tooltip = new vscode.MarkdownString(
      [
        `**${entry.key}**`,
        entry.valueType ? `Type: \`${entry.valueType}\`` : undefined,
        `Size: ${formatSize(entry.sizeBytes)}`,
        `Hits: ${entry.hitCount}`,
        `Created: ${entry.createdAt}`,
        entry.lastAccessedAt ? `Last accessed: ${entry.lastAccessedAt}` : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );

    return item;
  }
}
