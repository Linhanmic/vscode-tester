// DbcManager.ts
import * as vscode from "vscode";
import { Can, Dbc } from "candied";
import dbcReader from "candied/lib/filesystem/DbcReader";

export class DbcManager {
  private dbcData: any = null;
  private dbcPath: string | null = null;
  private can: Can;

  constructor(private context: vscode.ExtensionContext) {
    this.can = new Can();
  }

  async initialize() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      console.warn("No workspace folders found, skipping DBC loading");
      return;
    }

    // 只查找第一个 DBC 文件
    for (const folder of folders) {
      const dbcFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*.dbc"),
        null,
        1, // 限制只返回 1 个文件
      );

      if (dbcFiles.length > 0) {
        await this.loadFile(dbcFiles[0].fsPath);
        break; // 找到第一个就停止
      }
    }

    // 监听文件变化
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.dbc");
    watcher.onDidChange((uri) => {
      // 如果变化的是当前加载的文件，重新加载
      if (uri.fsPath === this.dbcPath) {
        this.loadFile(uri.fsPath);
      }
    });
    watcher.onDidCreate((uri) => {
      // 如果还没有加载任何 DBC，加载新创建的
      if (!this.dbcData) {
        this.loadFile(uri.fsPath);
      }
    });
    watcher.onDidDelete((uri) => {
      // 如果删除的是当前加载的文件，清空数据
      if (uri.fsPath === this.dbcPath) {
        this.dbcData = null;
        this.dbcPath = null;
      }
    });
    this.context.subscriptions.push(watcher);
  }

  private async loadFile(path: string) {
    try {
      const fileContent = dbcReader(path);
      const dbc = new Dbc();
      this.dbcData = dbc.load(fileContent);
      this.dbcPath = path;
      this.can.database = this.dbcData;
      console.log(`DBC file loaded: ${path}`);
    } catch (e) {
      console.error(`DBC parse failed for ${path}:`, e);
      vscode.window.showErrorMessage(`Failed to load DBC file: ${path}`);
    }
  }

  /**
   * 解码 CAN 消息
   * @param messageId CAN 消息 ID
   * @param data 消息数据 Buffer
   * @returns 解码后的信号 Map，如果未加载 DBC 或解码失败返回 null
   */
  decodeMessage(messageId: number, datas: number[]) {
    if (!this.dbcData) {
      console.warn("No DBC file loaded");
      return null;
    }

    try {
      // 创建 CAN 帧并解码
      const canFrame = this.can.createFrame(messageId, datas);
      const boundMsg = this.can.decode(canFrame);

      return boundMsg;
    } catch (e) {
      console.error(`Failed to decode message ${messageId}:`, e);
      return null;
    }
  }

  /**
   * 检查是否已加载 DBC 文件
   */
  isLoaded(): boolean {
    return this.dbcData !== null;
  }

  /**
   * 获取当前加载的 DBC 文件路径
   */
  getDbcPath(): string | null {
    return this.dbcPath;
  }

  /**
   * 手动加载指定的 DBC 文件
   */
  async loadDbcFile(path: string) {
    await this.loadFile(path);
  }
}
