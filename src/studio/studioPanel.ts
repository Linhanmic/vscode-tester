import * as fs from "node:fs";
import * as vscode from "vscode";
import { MessageDecoderService } from "../messageDecoder/messageDecoderService";
import { DeviceManagerService } from "../deviceManager/deviceManagerService";
import { ProjectConfigService } from "../projectConfig/projectConfigService";
import {
  RUN_TEST_COMMAND_COMMAND,
  RUN_TEST_CASE_COMMAND,
  RUN_TEST_SUITE_COMMAND,
} from "../constants";
import type {
  StudioSnapshot,
  StudioToWebviewMessage,
  WebviewToStudioMessage,
} from "./types";
import { BusMonitorService } from "./busMonitorService";
import { DbcWorkspaceService } from "./dbcWorkspaceService";
import { ScriptModelService } from "./scriptModelService";
import { WorkspaceScriptIndexService } from "./workspaceScriptIndexService";

function createNonce() {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}

interface CachedStudioAssets {
  scriptPath: string;
  stylePath: string;
  scriptContent: string;
  styleContent: string;
}

export interface TesterStudioPanelServices {
  scriptIndexService: WorkspaceScriptIndexService;
  dbcWorkspaceService: DbcWorkspaceService;
  projectConfigService: ProjectConfigService;
  scriptModelService: ScriptModelService;
  deviceManagerService: DeviceManagerService;
  busMonitorService: BusMonitorService;
  messageDecoderService: MessageDecoderService;
}

export class TesterStudioPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private services: TesterStudioPanelServices | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly serviceDisposables: vscode.Disposable[] = [];
  private static cachedAssets: CachedStudioAssets | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  dispose() {
    this.clearServiceBindings();
    this.panel?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  async show() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "testerStudio",
      "Tester Studio",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: WebviewToStudioMessage) => {
        void this.handleMessage(message);
      }),
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      }),
    );
  }

  attachServices(services: TesterStudioPanelServices) {
    if (this.services === services) {
      void this.postCurrentSnapshot();
      return;
    }

    this.clearServiceBindings();
    this.services = services;
    this.serviceDisposables.push(
      services.scriptIndexService.onDidChangeSnapshot((snapshot) => {
        this.postMessage({
          type: "updateScripts",
          snapshot,
        });
      }),
      services.dbcWorkspaceService.onDidChangeSnapshot((snapshot) => {
        this.postMessage({
          type: "updateDbc",
          snapshot,
        });
      }),
      services.scriptModelService.onDidChangeSnapshot((snapshot) => {
        this.postMessage({
          type: "updateProject",
          snapshot,
        });
      }),
      services.deviceManagerService.onDidChangeSnapshot((snapshot) => {
        this.postMessage({
          type: "updateDevice",
          snapshot,
        });
      }),
      services.busMonitorService.onDidChangeSnapshot((snapshot) => {
        this.postMessage({
          type: "updateBusMonitor",
          snapshot,
        });
      }),
      services.messageDecoderService.onDidChangeSnapshot((snapshot) => {
        this.postMessage({
          type: "updateDecoder",
          snapshot,
        });
      }),
    );
    void this.postCurrentSnapshot();
  }

  reportError(message: string) {
    this.postMessage({
      type: "error",
      message,
    });
  }

  private clearServiceBindings() {
    for (const disposable of this.serviceDisposables) {
      disposable.dispose();
    }
    this.serviceDisposables.length = 0;
  }

  private async handleMessage(message: WebviewToStudioMessage) {
    if (message.type === "ready") {
      await this.postCurrentSnapshot();
      return;
    }

    const services = this.services;
    if (!services) {
      this.reportError("Studio 仍在初始化，请稍后重试");
      return;
    }

    try {
      switch (message.type) {
        case "refreshScripts":
          await services.scriptIndexService.refresh();
          return;
        case "selectScript":
          if (message.pick) {
            await services.scriptIndexService.pickScript();
            return;
          }
          await services.scriptIndexService.selectScript(
            message.uri ? vscode.Uri.parse(message.uri) : undefined,
          );
          return;
        case "openInEditor":
          await this.openInEditor(
            vscode.Uri.parse(message.uri),
            message.startLine,
            message.startCharacter ?? 0,
          );
          return;
        case "runSuite":
          await vscode.commands.executeCommand(
            RUN_TEST_SUITE_COMMAND,
            vscode.Uri.parse(message.uri),
            message.suiteStartLine,
          );
          return;
        case "runCase":
          await vscode.commands.executeCommand(
            RUN_TEST_CASE_COMMAND,
            vscode.Uri.parse(message.uri),
            message.suiteStartLine,
            message.caseStartLine,
          );
          return;
        case "runCommand":
          await vscode.commands.executeCommand(
            RUN_TEST_COMMAND_COMMAND,
            vscode.Uri.parse(message.uri),
            message.suiteStartLine,
            message.caseStartLine,
            message.commandStartLine,
          );
          return;
        case "mutateConfig":
          if (message.mode === "raw") {
            await services.projectConfigService.replaceConfigurationRaw(
              message.rawText ?? "",
            );
            return;
          }
          if (!message.payload) {
            throw new Error("缺少配置数据");
          }
          await services.projectConfigService.replaceConfiguration(
            message.payload,
          );
          return;
        case "mutateSuite":
          await services.scriptModelService.mutateSuite(message.mutation);
          return;
        case "mutateCase":
          await services.scriptModelService.mutateCase(message.mutation);
          return;
        case "mutateCommand":
          await services.scriptModelService.mutateCommand(message.mutation);
          return;
        case "mutateRawBlock":
          await services.scriptModelService.mutateRaw(message.mutation);
          return;
        case "startDeviceTask":
          await services.deviceManagerService.startTask(message.payload);
          return;
        case "stopDeviceTask":
          await services.deviceManagerService.stopTask(message.key);
          return;
        case "decodeMessages":
          services.messageDecoderService.decode(message.input);
          return;
        case "setDbcPath":
          await services.dbcWorkspaceService.setConfiguredPath(message.path);
          return;
        case "pickDbcPath":
          await services.dbcWorkspaceService.pickConfiguredPath();
          return;
        case "clearDbcPath":
          await services.dbcWorkspaceService.clearConfiguredPath();
          return;
        case "clearBusMonitor":
          services.busMonitorService.clear();
          return;
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(text);
      this.reportError(text);
    }
  }

  private async postCurrentSnapshot() {
    if (!this.services) {
      this.postMessage({
        type: "initStudio",
        snapshot: createLoadingSnapshot(),
      });
      return;
    }

    const projectSnapshot = this.services.scriptModelService.getSnapshot();
    const snapshot: StudioSnapshot = {
      scripts: this.services.scriptIndexService.getSnapshot(),
      dbc: this.services.dbcWorkspaceService.getSnapshot(),
      project: projectSnapshot,
      device: this.services.deviceManagerService.getSnapshot(),
      busMonitor: this.services.busMonitorService.getSnapshot(),
      decoder: this.services.messageDecoderService.getSnapshot(),
      capabilities: {
        canUseGlobalTools: true,
        canEditScript: projectSnapshot.loadState === "ready" && projectSnapshot.state === "ready",
        canRunScript: projectSnapshot.loadState === "ready" && projectSnapshot.state === "ready",
        canManageDevice:
          projectSnapshot.loadState === "ready" && projectSnapshot.state === "ready",
      },
    };

    this.postMessage({
      type: "initStudio",
      snapshot,
    });
  }

  private async openInEditor(
    uri: vscode.Uri,
    startLine: number,
    startCharacter: number,
  ) {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
    });
    const position = new vscode.Position(startLine, startCharacter);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }

  private postMessage(message: StudioToWebviewMessage) {
    if (!this.panel) {
      return;
    }

    void this.panel.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview) {
    const nonce = createNonce();
    const assets = this.getCachedAssets();
    if (assets instanceof Error) {
      return this.getErrorHtml(nonce, assets.message);
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tester Studio</title>
    <style nonce="${nonce}">${assets.styleContent}</style>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}">
      window.__TESTER_STUDIO__ = {
        initialTheme: document.body.dataset.vscodeThemeId ?? "",
      };
    </script>
    <script nonce="${nonce}" type="module">${assets.scriptContent}</script>
  </body>
</html>`;
  }

  private getCachedAssets() {
    const scriptPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "dist",
      "webview",
      "assets",
      "studio.js",
    ).fsPath;
    const stylePath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "dist",
      "webview",
      "assets",
      "studio.css",
    ).fsPath;

    if (!fs.existsSync(scriptPath) || !fs.existsSync(stylePath)) {
      return new Error(
        [
          "Studio 前端资源不存在。",
          `JS: ${scriptPath}`,
          `CSS: ${stylePath}`,
          "请先执行 npm run compile 或 npm run build:webview。",
        ].join("\n"),
      );
    }

    if (
      TesterStudioPanel.cachedAssets &&
      TesterStudioPanel.cachedAssets.scriptPath === scriptPath &&
      TesterStudioPanel.cachedAssets.stylePath === stylePath
    ) {
      return TesterStudioPanel.cachedAssets;
    }

    TesterStudioPanel.cachedAssets = {
      scriptPath,
      stylePath,
      styleContent: fs.readFileSync(stylePath, "utf8"),
      scriptContent: fs
        .readFileSync(scriptPath, "utf8")
        .replace(/<\/script/gi, "<\\/script"),
    };
    return TesterStudioPanel.cachedAssets;
  }

  private getErrorHtml(
    nonce: string,
    message: string,
  ) {
    const escaped = message
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tester Studio</title>
    <style nonce="${nonce}">
      html,
      body {
        margin: 0;
        min-height: 100%;
        background: var(--vscode-editor-background);
        color: var(--vscode-foreground);
        font-family: var(--vscode-font-family);
      }

      main {
        padding: 20px;
      }

      .card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        padding: 16px;
        background: var(--vscode-editorWidget-background);
      }

      h1 {
        margin: 0 0 12px;
        font-size: 16px;
      }

      pre {
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>Tester Studio 启动失败</h1>
        <pre>${escaped}</pre>
      </div>
    </main>
  </body>
</html>`;
  }
}

function createLoadingSnapshot(): StudioSnapshot {
  return {
    scripts: {
      loadState: "loading",
      message: "正在初始化脚本索引",
      items: [],
    },
    dbc: {
      loadState: "loading",
      message: "正在初始化 DBC 工作区",
      status: {
        state: "unloaded",
        message: "当前未加载 DBC 文件",
      },
      configuredPath: "",
      availableFiles: [],
    },
    project: {
      loadState: "loading",
      message: "正在初始化脚本模型",
      state: "no-script-selected",
      items: [],
      outlineNodes: [],
      summary: {
        suiteCount: 0,
        caseCount: 0,
        commandCount: 0,
      },
      config: {
        status: {
          state: "parser-unavailable",
          message: "Studio 正在初始化",
          canEdit: false,
          canCreateConfigBlock: false,
          canTakeOver: false,
        },
        hasConfigurationBlock: false,
        channels: [],
        diagnose: {},
        dtcs: [],
        dbcStatus: {
          state: "unloaded",
          message: "当前未加载 DBC 文件",
        },
        dbcConfiguredPath: "",
        availableDbcFiles: [],
        isSingleDevice: false,
        deviceLabel: "未配置设备",
      },
    },
    device: {
      loadState: "loading",
      status: {
        state: "no-script-selected",
        message: "设备服务正在初始化",
        canSend: false,
      },
      deviceLabel: "未配置设备",
      channels: [],
      activeTasks: [],
    },
    busMonitor: {
      loadState: "loading",
      runStatus: "idle",
      runTitle: "初始化中",
      currentCase: "无",
      passedCount: 0,
      failedCount: 0,
      activeTasks: [],
      visibleFrames: [],
      visibleLogs: [],
      totalFrameCount: 0,
      totalLogCount: 0,
    },
    decoder: {
      loadState: "loading",
      message: "解码服务正在初始化",
      status: {
        state: "unloaded",
        message: "当前未加载 DBC 文件",
        canDecode: false,
      },
      items: [],
      summary: {
        total: 0,
        successCount: 0,
        errorCount: 0,
      },
    },
    capabilities: {
      canUseGlobalTools: true,
      canEditScript: false,
      canRunScript: false,
      canManageDevice: false,
    },
  };
}
