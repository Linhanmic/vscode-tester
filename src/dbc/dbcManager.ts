import { readFile } from "fs/promises";
import * as vscode from "vscode";
import { Can, Dbc } from "candied";

export class DbcManager {
  private dbcData: any = null;
  private dbcPath: string | null = null;
  private can: Can;

  constructor(private context: vscode.ExtensionContext) {
    this.can = new Can();
  }

  async initialize() {
    // Check for configured DBC path first
    const config = vscode.workspace.getConfiguration("tester");
    const configuredPath = config.get<string>("dbcFilePath", "");

    if (configuredPath) {
      await this.loadFile(configuredPath);
    } else {
      // Auto-discover first .dbc file in workspace
      const folders = vscode.workspace.workspaceFolders;
      if (!folders) {
        return;
      }

      for (const folder of folders) {
        const dbcFiles = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, "**/*.dbc"),
          null,
          1,
        );

        if (dbcFiles.length > 0) {
          await this.loadFile(dbcFiles[0].fsPath);
          break;
        }
      }
    }

    // Watch for DBC file changes
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.dbc");
    watcher.onDidChange((uri) => {
      if (uri.fsPath === this.dbcPath) {
        this.loadFile(uri.fsPath);
      }
    });
    watcher.onDidCreate((uri) => {
      if (!this.dbcData) {
        this.loadFile(uri.fsPath);
      }
    });
    watcher.onDidDelete((uri) => {
      if (uri.fsPath === this.dbcPath) {
        this.dbcData = null;
        this.dbcPath = null;
      }
    });
    this.context.subscriptions.push(watcher);
  }

  private async loadFile(path: string) {
    try {
      // candied 的 DbcReader 固定按 ASCII 读取，会破坏 UTF-8 DBC 里的中文描述。
      const fileContent = await readFile(path, "utf8");
      const dbc = new Dbc();
      this.dbcData = dbc.load(fileContent);
      this.dbcPath = path;
      this.can.database = this.dbcData;
    } catch (e) {
      console.error(`DBC parse failed for ${path}:`, e);
      vscode.window.showErrorMessage(`Failed to load DBC file: ${path}`);
    }
  }

  decodeMessage(messageId: number, datas: number[]) {
    if (!this.dbcData) {
      return null;
    }

    try {
      const canFrame = this.can.createFrame(messageId, datas);
      const boundMsg = this.can.decode(canFrame);
      return boundMsg;
    } catch (e) {
      console.error(`Failed to decode message ${messageId}:`, e);
      return null;
    }
  }

  isLoaded(): boolean {
    return this.dbcData !== null;
  }

  getDbcPath(): string | null {
    return this.dbcPath;
  }

  async loadDbcFile(path: string) {
    await this.loadFile(path);
  }
}
