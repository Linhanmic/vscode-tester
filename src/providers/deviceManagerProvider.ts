import * as vscode from "vscode";
import { DeviceManagerService } from "../deviceManager/deviceManagerService";

function createNonce() {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}

export class TesterDeviceManagerProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly deviceManagerService: DeviceManagerService) {
    this.disposables.push(
      this.deviceManagerService.onDidChangeSnapshot(() => {
        this.postSnapshot();
      }),
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();
    this.postSnapshot();

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) {
          this.view = undefined;
        }
      }),
    );
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: any) {
    try {
      switch (message?.type) {
        case "ready":
          this.postSnapshot();
          return;
        case "startTask":
          await this.deviceManagerService.startTask(message.payload);
          return;
        case "stopTask":
          await this.deviceManagerService.stopTask(String(message.key ?? ""));
          return;
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(text);
    }
  }

  private postSnapshot() {
    if (!this.view) {
      return;
    }

    void this.view.webview.postMessage({
      type: "snapshot",
      snapshot: this.deviceManagerService.getSnapshot(),
    });
  }

  private getHtml() {
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        color-scheme: light dark;
        --bg: var(--vscode-sideBar-background);
        --panel: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
        --border: var(--vscode-panel-border);
        --muted: var(--vscode-descriptionForeground);
        --fg: var(--vscode-foreground);
        --accent: var(--vscode-textLink-foreground);
        --warning: var(--vscode-editorWarning-foreground);
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border);
        --btn-bg: var(--vscode-button-background);
        --btn-fg: var(--vscode-button-foreground);
        --btn-hover: var(--vscode-button-hoverBackground);
      }

      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        min-height: 100%;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
        font-size: 12px;
      }

      body { padding: 8px; }

      .layout {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .panel {
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--panel);
        overflow: hidden;
      }

      .panel-header {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .panel-body {
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .title {
        margin: 0;
        font-size: 13px;
      }

      .subtitle {
        color: var(--muted);
        font-size: 11px;
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border: 1px solid var(--border);
        border-radius: 999px;
        font-size: 11px;
        color: var(--muted);
      }

      .status-badge.ready,
      .status-badge.sending {
        color: var(--accent);
      }

      .status-badge.unsupported,
      .status-badge.unmanaged,
      .status-badge.driver-unavailable {
        color: var(--warning);
      }

      .channel-card,
      .task-card {
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .grid-2 {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .grid-4 {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--muted);
      }

      input,
      button {
        border-radius: 6px;
        font: inherit;
      }

      input {
        width: 100%;
        padding: 5px 8px;
        border: 1px solid var(--input-border);
        background: var(--input-bg);
        color: var(--input-fg);
      }

      button {
        border: none;
        padding: 5px 12px;
        background: var(--btn-bg);
        color: var(--btn-fg);
        cursor: pointer;
      }

      button:hover {
        background: var(--btn-hover);
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .empty {
        color: var(--muted);
        text-align: center;
        padding: 16px 12px;
      }

      @media (max-width: 640px) {
        .grid-2,
        .grid-4 {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="layout" id="app">
      <div class="empty">正在加载设备管理...</div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const app = document.getElementById("app");

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function render(snapshot) {
        const canSend = Boolean(snapshot.status?.canSend);
        const channelCards = snapshot.channels.length
          ? snapshot.channels.map((channel) => \`
              <section class="channel-card">
                <div>
                  <strong>ch\${channel.channelIndex}</strong>
                  <div class="subtitle">device \${channel.deviceId} / \${channel.deviceIndex}</div>
                </div>
                <div class="meta">
                  <span>仲裁 \${channel.arbitrationBaudRateKbps} kbps</span>
                  <span>数据 \${channel.dataBaudRateKbps ?? "-"}</span>
                </div>
                <div class="grid-2">
                  <input id="draft-\${channel.channelIndex}-id" placeholder="报文 ID，如 0x261" value="\${escapeHtml(channel.draft.messageIdText)}" />
                  <input id="draft-\${channel.channelIndex}-data" placeholder="报文数据，如 2A 01 00 00 00 00 00 D4" value="\${escapeHtml(channel.draft.dataText)}" />
                </div>
                <div class="grid-2">
                  <input id="draft-\${channel.channelIndex}-period" placeholder="周期 ms" value="\${channel.draft.periodMs}" />
                  <input id="draft-\${channel.channelIndex}-count" placeholder="次数" value="\${channel.draft.count}" />
                </div>
                <button data-action="start-task" data-channel-index="\${channel.channelIndex}" type="button"\${canSend ? "" : " disabled"}>启动临时发送</button>
              </section>
            \`).join("")
          : '<div class="empty">当前没有可用通道</div>';

        const taskCards = snapshot.activeTasks.length
          ? snapshot.activeTasks.map((task) => \`
              <section class="task-card">
                <div>
                  <strong>ch\${task.channelIndex} \${escapeHtml(task.messageIdText)}</strong>
                  <div class="subtitle">\${escapeHtml(task.dataText)}</div>
                </div>
                <div class="meta">
                  <span>周期 \${task.periodMs} ms</span>
                  <span>进度 \${task.sentCount}/\${task.count}</span>
                  <span>状态 \${task.status}</span>
                </div>
                <button data-action="stop-task" data-key="\${escapeHtml(task.key)}" type="button">停止任务</button>
              </section>
            \`).join("")
          : '<div class="empty">当前没有运行中的临时发送任务</div>';

        app.innerHTML = \`
          <section class="panel">
            <div class="panel-header">
              <div>
                <h3 class="title">设备管理</h3>
                <div class="subtitle">\${escapeHtml(snapshot.documentPath ?? "未选择文档")}</div>
              </div>
              <span class="status-badge \${escapeHtml(snapshot.status.state)}">\${escapeHtml(snapshot.status.message)}</span>
            </div>
            <div class="panel-body">
              <div class="meta">
                <span>\${escapeHtml(snapshot.deviceLabel)}</span>
              </div>
              \${canSend ? "" : '<div class="subtitle">当前状态不可发送，请先处理上方状态提示</div>'}
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <h3 class="title">已配置通道</h3>
              <div class="subtitle">数据来源于当前脚本 tset</div>
            </div>
            <div class="panel-body">\${channelCards}</div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <h3 class="title">活动发送</h3>
            </div>
            <div class="panel-body">\${taskCards}</div>
          </section>
        \`;

        wireEvents();
      }

      function wireEvents() {
        document.querySelectorAll("[data-action='start-task']").forEach((element) => {
          element.addEventListener("click", () => {
            const channelIndex = Number(element.dataset.channelIndex);
            vscode.postMessage({
              type: "startTask",
              payload: {
                channelIndex,
                messageIdText: document.getElementById("draft-" + channelIndex + "-id").value,
                dataText: document.getElementById("draft-" + channelIndex + "-data").value,
                periodMs: document.getElementById("draft-" + channelIndex + "-period").value,
                count: document.getElementById("draft-" + channelIndex + "-count").value,
              },
            });
          });
        });
        document.querySelectorAll("[data-action='stop-task']").forEach((element) => {
          element.addEventListener("click", () => {
            vscode.postMessage({
              type: "stopTask",
              key: element.dataset.key,
            });
          });
        });
      }

      window.addEventListener("message", (event) => {
        if (event.data?.type === "snapshot") {
          render(event.data.snapshot);
        }
      });

      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
  }
}
