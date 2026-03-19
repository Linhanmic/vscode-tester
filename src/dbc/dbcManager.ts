import { readFile } from "fs/promises";
import * as nodePath from "path";
import * as vscode from "vscode";
import { Can, Dbc } from "candied";
import type { BoundSignal } from "candied/lib/can/Can";
import type { DbcData, Message } from "candied/lib/dbc/Dbc";
import {
  buildDecodedMessageDisplay,
  buildMessageDefinitionDisplay,
  type DbcDisplayResult,
  formatMessageId,
} from "./displayModel";

export type DbcManagerStatusState = "unloaded" | "loaded" | "error";

export interface DbcManagerStatus {
  state: DbcManagerStatusState;
  message: string;
  path?: string;
}

export class DbcManager {
  private dbcData: DbcData | null = null;
  private dbcPath: string | null = null;
  private can: Can;
  private status: DbcManagerStatus = {
    state: "unloaded",
    message: "当前未加载 DBC 文件",
  };
  private readonly statusEmitter = new vscode.EventEmitter<DbcManagerStatus>();

  constructor(private context: vscode.ExtensionContext) {
    this.can = new Can();
    this.context.subscriptions.push(this.statusEmitter);
  }

  async initialize() {
    await this.reloadFromConfiguration();

    // Watch for DBC file changes
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.dbc");
    watcher.onDidChange((uri) => {
      if (uri.fsPath === this.dbcPath) {
        void this.loadFile(uri.fsPath);
      }
    });
    watcher.onDidCreate((uri) => {
      if (!this.dbcData) {
        void this.reloadFromConfiguration();
      }
    });
    watcher.onDidDelete((uri) => {
      if (uri.fsPath === this.dbcPath) {
        void this.reloadFromConfiguration();
      }
    });
    this.context.subscriptions.push(
      watcher,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("tester.dbcFilePath")) {
          void this.reloadFromConfiguration();
        }
      }),
    );
  }

  private async loadFile(filePath: string) {
    try {
      // candied 的 DbcReader 固定按 ASCII 读取，会破坏 UTF-8 DBC 里的中文描述。
      const fileContent = await readFile(filePath, "utf8");
      const dbc = new Dbc();
      this.dbcData = dbc.load(fileContent);
      this.dbcPath = filePath;
      this.can.database = this.dbcData;
      this.updateStatus({
        state: "loaded",
        message: `已加载 DBC: ${nodePath.basename(filePath)}`,
        path: filePath,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.dbcData = null;
      this.dbcPath = null;
      this.updateStatus({
        state: "error",
        message: `DBC 加载失败: ${nodePath.basename(filePath)}，${errorMessage}`,
        path: filePath,
      });
      console.error(`DBC parse failed for ${filePath}:`, e);
      vscode.window.showErrorMessage(`Failed to load DBC file: ${filePath}`);
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

  getConfiguredPathSetting(): string {
    return vscode.workspace
      .getConfiguration("tester")
      .get<string>("dbcFilePath", "");
  }

  getStatus(): DbcManagerStatus {
    return { ...this.status };
  }

  get onDidChangeStatus(): vscode.Event<DbcManagerStatus> {
    return this.statusEmitter.event;
  }

  getMessage(messageId: number): Message | null {
    if (!this.dbcData) {
      return null;
    }
    return this.can.idMap.get(messageId) ?? null;
  }

  getDbcData(): DbcData | null {
    return this.dbcData;
  }

  getMessageDefinition(messageId: number): DbcDisplayResult {
    if (!this.dbcData) {
      return this.createError(
        "dbc_not_loaded",
        "当前未加载 DBC 文件",
        messageId,
      );
    }

    const message = this.getMessage(messageId);
    if (!message) {
      return this.createError(
        "message_not_found",
        `DBC 中未找到报文定义: ${formatMessageId(messageId)}`,
        messageId,
      );
    }

    return buildMessageDefinitionDisplay(message);
  }

  decodeMessageForDisplay(
    messageId: number,
    dataBytes: readonly number[],
  ): DbcDisplayResult {
    if (!this.dbcData) {
      return this.createError(
        "dbc_not_loaded",
        "当前未加载 DBC 文件",
        messageId,
      );
    }

    const message = this.getMessage(messageId);
    if (!message) {
      return this.createError(
        "message_not_found",
        `DBC 中未找到报文定义: ${formatMessageId(messageId)}`,
        messageId,
      );
    }

    if (dataBytes.length !== message.dlc) {
      return {
        kind: "error",
        code: "payload_length_mismatch",
        id: messageId,
        idHex: formatMessageId(messageId),
        expectedDlc: message.dlc,
        actualDlc: dataBytes.length,
        message: `报文长度与 DBC 不匹配，期望 ${message.dlc} 字节，实际 ${dataBytes.length} 字节`,
      };
    }

    try {
      const boundSignals = this.decodeSignals(message, dataBytes);
      return buildDecodedMessageDisplay(message, dataBytes, boundSignals);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      return this.createError(
        "invalid_input",
        `报文解析失败: ${messageText}`,
        messageId,
      );
    }
  }

  async loadDbcFile(filePath: string) {
    await this.loadFile(filePath);
  }

  async reloadFromConfiguration() {
    const configuredPath = this.getConfiguredPathSetting();
    if (configuredPath) {
      await this.loadFile(configuredPath);
      return;
    }

    const discoveredPath = await this.findFirstWorkspaceDbcPath();
    if (discoveredPath) {
      await this.loadFile(discoveredPath);
      return;
    }

    this.clearLoadedDbc();
    this.updateStatus({
      state: "unloaded",
      message: "当前未加载 DBC 文件",
    });
  }

  async setConfiguredPath(filePath: string) {
    await vscode.workspace
      .getConfiguration("tester")
      .update("dbcFilePath", filePath, vscode.ConfigurationTarget.Workspace);
  }

  async clearConfiguredPath() {
    await this.setConfiguredPath("");
  }

  async discoverWorkspaceDbcFiles(limit = 50): Promise<string[]> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      return [];
    }

    const uris = await vscode.workspace.findFiles("**/*.dbc", null, limit);
    return uris.map((uri) => uri.fsPath);
  }

  private decodeSignals(
    message: Message,
    dataBytes: readonly number[],
  ): Map<string, BoundSignal> {
    const boundSignals = new Map<string, BoundSignal>();
    for (const [name, signal] of message.signals) {
      boundSignals.set(name, this.can.decodeSignal([...dataBytes], signal));
    }
    return boundSignals;
  }

  private createError(
    code: "dbc_not_loaded" | "message_not_found" | "invalid_input",
    message: string,
    messageId?: number,
  ): DbcDisplayResult {
    return {
      kind: "error",
      code,
      message,
      id: messageId,
      idHex:
        typeof messageId === "number" ? formatMessageId(messageId) : undefined,
    };
  }

  private updateStatus(status: DbcManagerStatus) {
    this.status = { ...status };
    this.statusEmitter.fire(this.getStatus());
  }

  private async findFirstWorkspaceDbcPath() {
    const files = await this.discoverWorkspaceDbcFiles(1);
    return files[0];
  }

  private clearLoadedDbc() {
    this.dbcData = null;
    this.dbcPath = null;
  }
}
