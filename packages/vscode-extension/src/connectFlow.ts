import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { DiscoveryWatcher, readInstanceFile } from "./discovery";
import { InstanceManager } from "./instanceManager";

/**
 * The "connect by hand" flow.
 *
 * The original version asked for a URL and then a bearer token as two plain input boxes. That
 * failed people in three ways at once, all reported from real use:
 *
 *   1. The token is written to a file in the temp directory. Nothing told you that, and the
 *      prompt actively pointed at the console log, where it has never appeared.
 *   2. VS Code closes an input box as soon as it loses focus. So going to find the token —
 *      the very thing the box was asking for — dismissed the box, along with the URL already
 *      typed into the previous step.
 *   3. Nothing was pre-filled, so the common case still meant typing a whole URL.
 *
 * This version removes the token step entirely wherever it can, and never closes on you.
 */
export async function runConnectFlow(instances: InstanceManager): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "$(file-directory) Select a discovery file",
        detail: "Point at the app's cachelens/instances/<pid>.json — the URL and token are both read from it",
        id: "file" as const,
      },
      {
        label: "$(edit) Enter a URL",
        detail: "For an app on this machine the token is filled in automatically",
        id: "url" as const,
      },
    ],
    {
      title: "Connect to a CacheLens app",
      placeHolder: "Apps on this machine are found automatically — this is for containers and remote hosts",
      ignoreFocusOut: true,
    },
  );

  if (!pick) {
    return;
  }

  if (pick.id === "file") {
    await connectFromFile(instances);
  } else {
    await connectFromUrl(instances);
  }
}

/** Reads both the URL and the token out of a discovery file, so nothing has to be typed. */
async function connectFromFile(instances: InstanceManager): Promise<void> {
  // Default the dialog to the local instance directory: for a local app the file is already
  // there, and for a remote one it is a sensible place to have copied it to.
  let defaultUri: vscode.Uri | undefined;
  try {
    if (fs.existsSync(DiscoveryWatcher.instanceDirectory)) {
      defaultUri = vscode.Uri.file(DiscoveryWatcher.instanceDirectory);
    }
  } catch {
    defaultUri = undefined;
  }

  const picked = await vscode.window.showOpenDialog({
    title: "Select a CacheLens discovery file",
    openLabel: "Connect",
    canSelectMany: false,
    defaultUri,
    filters: { "CacheLens discovery file": ["json"] },
  });

  const file = picked?.[0];
  if (!file) {
    return;
  }

  const parsed = readInstanceFile(file.fsPath);
  if (!parsed) {
    void vscode.window.showErrorMessage(
      `That file isn't a CacheLens discovery file. Expected JSON with "url" and "token" fields — look for ${path.join("cachelens", "instances", "<pid>.json")} in the temp directory of the machine running the app.`,
    );
    return;
  }

  instances.addManualConnection(parsed.url, parsed.token);
  void vscode.window.showInformationMessage(`Connecting to ${parsed.processName} at ${parsed.url}`);
}

/** Asks for a URL, then resolves the token locally rather than making anyone hunt for it. */
async function connectFromUrl(instances: InstanceManager): Promise<void> {
  const url = await vscode.window.showInputBox({
    title: "Connect to a CacheLens app",
    prompt: "Base URL only — no /_cachelens suffix. Use the address the app logged at startup, or your forwarded port.",
    value: "http://localhost:5225",
    valueSelection: [7, 26], // pre-select host:port so typing over it is one action
    ignoreFocusOut: true,
    validateInput: (v) => (isValidHttpUrl(v) ? undefined : "Enter a full http:// or https:// URL."),
  });

  if (!url) {
    return;
  }

  // If this URL belongs to an app running on this machine, its discovery file already holds
  // the token — asking the user for it would be busy-work.
  const local = instances.findDiscoveredByUrl(url);
  if (local) {
    instances.addManualConnection(local.url, local.token);
    void vscode.window.showInformationMessage(
      `Connected to ${local.processName} — token read from its discovery file.`,
    );
    return;
  }

  const token = await vscode.window.showInputBox({
    title: `Token for ${url}`,
    prompt: 'The "token" field inside cachelens/instances/<pid>.json, in the temp directory of the machine running the app. A new one is generated each time it starts.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length === 0 ? "Paste the token, or cancel and use the discovery file instead." : undefined),
  });

  if (!token) {
    return;
  }

  instances.addManualConnection(url, token.trim());
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
