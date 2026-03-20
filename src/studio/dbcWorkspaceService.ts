import * as vscode from "vscode";
import { DbcManager } from "../dbc/dbcManager";
import type { StudioDbcSnapshot } from "./types";

export class DbcWorkspaceService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<StudioDbcSnapshot>();
  private readonly disposables: vscode.Disposable[] = [];
  private snapshot: StudioDbcSnapshot;
  private refreshVersion = 0;
  private started = false;
  private startPromise: Promise<void> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly dbcManager: DbcManager) {
    this.snapshot = this.createSnapshot([]);
    this.disposables.push(this.emitter);
  }

  dispose() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  getSnapshot(): StudioDbcSnapshot {
    return {
      loadState: this.snapshot.loadState,
      message: this.snapshot.message,
      status: { ...this.snapshot.status },
      configuredPath: this.snapshot.configuredPath,
      availableFiles: [...this.snapshot.availableFiles],
    };
  }

  get onDidChangeSnapshot(): vscode.Event<StudioDbcSnapshot> {
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
      message: "正在扫描工作区 DBC 文件",
    };
    this.emitter.fire(this.getSnapshot());

    try {
      const files = await this.dbcManager.discoverWorkspaceDbcFiles();
      if (version !== this.refreshVersion) {
        return;
      }

      this.snapshot = this.createSnapshot(files, "ready");
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

  async setConfiguredPath(filePath: string) {
    await this.dbcManager.setConfiguredPath(filePath);
  }

  async clearConfiguredPath() {
    await this.dbcManager.clearConfiguredPath();
  }

  async pickConfiguredPath() {
    const result = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "选择 DBC 文件",
      filters: {
        DBC: ["dbc"],
      },
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });

    if (!result?.length) {
      return;
    }

    await this.setConfiguredPath(result[0].fsPath);
  }

  getAvailableFiles() {
    return [...this.snapshot.availableFiles];
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
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.dbc");
    this.disposables.push(
      watcher,
      this.dbcManager.onDidChangeStatus(() => {
        this.snapshot = this.createSnapshot(
          this.snapshot.availableFiles,
          this.snapshot.loadState === "idle" ? "ready" : this.snapshot.loadState,
        );
        this.emitter.fire(this.getSnapshot());
      }),
      watcher.onDidChange(() => {
        this.scheduleRefresh();
      }),
      watcher.onDidCreate(() => {
        this.scheduleRefresh();
      }),
      watcher.onDidDelete(() => {
        this.scheduleRefresh();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("tester.dbcFilePath")) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.scheduleRefresh();
      }),
    );
    this.started = true;
    await this.dbcManager.initialize();
    await this.refresh();
  }

  private scheduleRefresh() {
    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 150);
  }

  private createSnapshot(
    availableFiles: string[],
    loadState: StudioDbcSnapshot["loadState"] = "idle",
  ): StudioDbcSnapshot {
    return {
      loadState,
      status: this.dbcManager.getStatus(),
      configuredPath: this.dbcManager.getConfiguredPathSetting(),
      availableFiles,
      message:
        loadState === "ready" && availableFiles.length === 0
          ? "当前工作区没有 DBC 文件"
          : undefined,
    };
  }
}
