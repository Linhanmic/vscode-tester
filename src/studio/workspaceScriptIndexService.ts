import * as nodePath from "path";
import * as vscode from "vscode";
import type { StudioScriptItem, StudioScriptsSnapshot } from "./types";

const SELECTED_SCRIPT_STORAGE_KEY = "tester.studio.selectedScript";

export class WorkspaceScriptIndexService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<StudioScriptsSnapshot>();
  private readonly disposables: vscode.Disposable[] = [];
  private snapshot: StudioScriptsSnapshot = {
    loadState: "idle",
    items: [],
  };
  private refreshVersion = 0;
  private started = false;
  private startPromise: Promise<void> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.snapshot.selectedUri = this.context.workspaceState.get<string>(
      SELECTED_SCRIPT_STORAGE_KEY,
    );
    this.disposables.push(this.emitter);
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  getSnapshot(): StudioScriptsSnapshot {
    return this.snapshot;
  }

  getSelectedUri(): vscode.Uri | undefined {
    return this.snapshot.selectedUri
      ? vscode.Uri.parse(this.snapshot.selectedUri)
      : undefined;
  }

  get onDidChangeSnapshot(): vscode.Event<StudioScriptsSnapshot> {
    return this.emitter.event;
  }

  async refresh() {
    if (!this.started) {
      return;
    }

    const version = this.refreshVersion + 1;
    this.refreshVersion = version;

    this.snapshot = {
      ...this.snapshot,
      loadState: "loading",
      message: "正在扫描工作区脚本",
    };
    this.emitter.fire(this.getSnapshot());

    try {
      const workspaceUris = await vscode.workspace.findFiles("**/*.tester");
      const items = workspaceUris.map((uri) =>
        this.createScriptItem(uri, "workspace"),
      );
      const selectedUri = this.snapshot.selectedUri;

      if (selectedUri) {
        const alreadyIncluded = items.some((item) => item.uri === selectedUri);
        if (!alreadyIncluded) {
          const manualUri = vscode.Uri.parse(selectedUri);
          if (await this.fileExists(manualUri)) {
            items.unshift(this.createScriptItem(manualUri, "manual"));
          } else {
            await this.selectScript(undefined);
            return;
          }
        }
      }

      if (version !== this.refreshVersion) {
        return;
      }

      this.snapshot = {
        loadState: "ready",
        items: items.sort((left, right) =>
          left.path.localeCompare(right.path, "zh-CN"),
        ),
        selectedUri,
        message: items.length ? undefined : "当前工作区没有 Tester 脚本",
      };
      this.emitter.fire(this.getSnapshot());
    } catch (error) {
      if (version !== this.refreshVersion) {
        return;
      }

      this.snapshot = {
        ...this.snapshot,
        loadState: "error",
        message: error instanceof Error ? error.message : String(error),
      };
      this.emitter.fire(this.getSnapshot());
    }
  }

  async selectScript(uri: vscode.Uri | undefined) {
    const serialized = uri?.toString();
    this.snapshot = {
      items: [...this.snapshot.items],
      loadState: this.snapshot.loadState,
      selectedUri: serialized,
      message: this.snapshot.message,
    };
    await this.context.workspaceState.update(
      SELECTED_SCRIPT_STORAGE_KEY,
      serialized,
    );
    await this.refresh();
  }

  async pickScript() {
    const result = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "选择 Tester 脚本",
      filters: {
        "Tester 脚本": ["tester", "txt"],
        "所有文件": ["*"],
      },
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });

    if (!result?.length) {
      return;
    }

    await this.selectScript(result[0]);
  }

  async start() {
    if (this.started) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal().catch((error) => {
      this.startPromise = undefined;
      throw error;
    });
    await this.startPromise;
  }

  private async startInternal() {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.tester");
    this.disposables.push(
      watcher,
      watcher.onDidChange(() => {
        void this.refresh();
      }),
      watcher.onDidCreate(() => {
        void this.refresh();
      }),
      watcher.onDidDelete(() => {
        void this.refresh();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh();
      }),
    );
    this.started = true;
    await this.refresh();
  }

  private createScriptItem(
    uri: vscode.Uri,
    source: StudioScriptItem["source"],
  ): StudioScriptItem {
    return {
      uri: uri.toString(),
      name: nodePath.basename(uri.fsPath),
      path: uri.fsPath,
      source,
    };
  }

  private async fileExists(uri: vscode.Uri) {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
}
