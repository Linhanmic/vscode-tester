import * as vscode from "vscode";
import { ProjectConfigService } from "../projectConfig/projectConfigService";

function createNonce() {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}

export class TesterProjectConfigProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly projectConfigService: ProjectConfigService) {
    this.disposables.push(
      this.projectConfigService.onDidChangeSnapshot(() => {
        this.postSnapshot();
      }),
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);
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
        case "refresh":
          await this.projectConfigService.refresh();
          return;
        case "createConfigBlock":
          await this.projectConfigService.createConfigBlock();
          return;
        case "takeOverConfigBlock":
          await this.projectConfigService.takeOverConfigBlock();
          return;
        case "setDbcPath":
          await this.projectConfigService.setDbcPath(String(message.path ?? ""));
          return;
        case "clearDbcPath":
          await this.projectConfigService.clearDbcPath();
          return;
        case "pickDbcPath":
          await this.projectConfigService.pickDbcPath();
          return;
        case "addChannel":
          await this.projectConfigService.addChannel(message.channel);
          return;
        case "updateChannel":
          await this.projectConfigService.updateChannel(
            Number(message.index),
            message.channel,
          );
          return;
        case "removeChannel":
          await this.projectConfigService.removeChannel(Number(message.index));
          return;
        case "updateDiagnose":
          await this.projectConfigService.updateDiagnose(message.diagnose);
          return;
        case "addDtc":
          await this.projectConfigService.addDtc(message.item);
          return;
        case "updateDtc":
          await this.projectConfigService.updateDtc(
            Number(message.index),
            message.item,
          );
          return;
        case "removeDtc":
          await this.projectConfigService.removeDtc(Number(message.index));
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
      snapshot: this.projectConfigService.getSnapshot(),
    });
  }

  private getHtml(webview: vscode.Webview) {
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
        --error: var(--vscode-errorForeground);
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
        color: var(--muted);
        font-size: 11px;
      }

      .status-badge.managed,
      .status-badge.loaded {
        color: var(--accent);
      }

      .status-badge.unmanaged,
      .status-badge.error {
        color: var(--warning);
      }

      .status-badge.no-document,
      .status-badge.no-config-block,
      .status-badge.parser-unavailable,
      .status-badge.unloaded {
        color: var(--muted);
      }

      .meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .meta-item {
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 8px;
      }

      .meta-label {
        color: var(--muted);
        margin-bottom: 4px;
      }

      .path {
        word-break: break-all;
      }

      .toolbar,
      .inline-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
      }

      button,
      select,
      input {
        border-radius: 6px;
        border: 1px solid var(--input-border);
        background: var(--input-bg);
        color: var(--input-fg);
        font: inherit;
      }

      button {
        background: var(--btn-bg);
        color: var(--btn-fg);
        border: none;
        padding: 5px 12px;
        cursor: pointer;
      }

      button:hover {
        background: var(--btn-hover);
      }

      input,
      select {
        padding: 5px 8px;
        min-width: 0;
        width: 100%;
      }

      .warning {
        padding: 8px 10px;
        border: 1px solid color-mix(in srgb, var(--warning) 50%, var(--border));
        border-radius: 8px;
        color: var(--warning);
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        border-bottom: 1px solid var(--border);
        padding: 6px 4px;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: var(--muted);
        font-weight: 600;
      }

      .empty {
        color: var(--muted);
        text-align: center;
        padding: 18px 12px;
      }

      .grid-4 {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }

      .grid-2 {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      @media (max-width: 640px) {
        .meta,
        .grid-4,
        .grid-2 {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="layout" id="app">
      <div class="empty">正在加载项目配置...</div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const app = document.getElementById("app");
      let snapshot = null;

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function getChannelValue(index, field) {
        return document.getElementById("channel-" + index + "-" + field)?.value ?? "";
      }

      function getDtcValue(index, field) {
        return document.getElementById("dtc-" + index + "-" + field)?.value ?? "";
      }

      function render(snapshotPayload) {
        snapshot = snapshotPayload;
        const status = snapshot.status;
        const dbcConfiguredPath = snapshot.dbcConfiguredPath || "";
        const dbcCandidates = [...snapshot.availableDbcFiles];
        if (dbcConfiguredPath && !dbcCandidates.includes(dbcConfiguredPath)) {
          dbcCandidates.unshift(dbcConfiguredPath);
        }
        const dbcOptions = [
          '<option value="">自动发现</option>',
          ...dbcCandidates.map((filePath) => {
            const selected = filePath === dbcConfiguredPath ? " selected" : "";
            return '<option value="' + escapeHtml(filePath) + '"' + selected + '>' + escapeHtml(filePath) + '</option>';
          })
        ].join("");
        const deviceRulePanel = snapshot.deviceRules
          ? '<div class="warning"><strong>设备规则</strong><div>' + escapeHtml(snapshot.deviceRules.summary) + '</div></div>'
          : "";

        const channelRows = snapshot.channels.length
          ? snapshot.channels.map((channel, index) => \`
              <tr>
                <td><input id="channel-\${index}-deviceId" value="\${channel.deviceId}" /></td>
                <td><input id="channel-\${index}-deviceIndex" value="\${channel.deviceIndex}" /></td>
                <td><input id="channel-\${index}-channelIndex" value="\${channel.channelIndex}" /></td>
                <td><input id="channel-\${index}-arb" value="\${channel.arbitrationBaudRateKbps}" /></td>
                <td><input id="channel-\${index}-data" value="\${channel.dataBaudRateKbps ?? ""}" /></td>
                <td>
                  <div class="inline-actions">
                    <button data-action="save-channel" data-index="\${index}" type="button">保存</button>
                    <button data-action="remove-channel" data-index="\${index}" type="button">删除</button>
                  </div>
                </td>
              </tr>
            \`).join("")
          : '<tr><td colspan="6" class="empty">当前没有 tcaninit 配置</td></tr>';

        const dtcRows = snapshot.dtcs.length
          ? snapshot.dtcs.map((item, index) => \`
              <tr>
                <td><input id="dtc-\${index}-code" value="\${escapeHtml(item.dtc)}" /></td>
                <td><input id="dtc-\${index}-description" value="\${escapeHtml(item.description)}" /></td>
                <td>
                  <div class="inline-actions">
                    <button data-action="save-dtc" data-index="\${index}" type="button">保存</button>
                    <button data-action="remove-dtc" data-index="\${index}" type="button">删除</button>
                  </div>
                </td>
              </tr>
            \`).join("")
          : '<tr><td colspan="3" class="empty">当前没有诊断故障码配置</td></tr>';

        const editablePanels = status.canEdit ? \`
          <section class="panel">
            <div class="panel-header">
              <div>
                <h3 class="title">通道配置</h3>
                <div class="subtitle">\${escapeHtml(snapshot.deviceLabel)}</div>
              </div>
            </div>
            <div class="panel-body">
              \${deviceRulePanel}
              <table>
                <thead>
                  <tr>
                    <th>device_id</th>
                    <th>device_index</th>
                    <th>channel_index</th>
                    <th>仲裁 kbps</th>
                    <th>数据 kbps</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>\${channelRows}</tbody>
              </table>
              <div class="grid-4">
                <input id="new-channel-deviceId" placeholder="device_id" />
                <input id="new-channel-deviceIndex" placeholder="device_index" />
                <input id="new-channel-channelIndex" placeholder="channel_index" />
                <input id="new-channel-arb" placeholder="仲裁 kbps" />
              </div>
              <div class="grid-2">
                <input id="new-channel-data" placeholder="数据 kbps（可选）" />
                <button id="addChannelBtn" type="button">新增通道</button>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <h3 class="title">诊断配置</h3>
            </div>
            <div class="panel-body">
              <div class="grid-2">
                <input id="diag-rid" placeholder="tdiagnose_rid" value="\${escapeHtml(snapshot.diagnose.responseId ?? "")}" />
                <input id="diag-sid" placeholder="tdiagnose_sid" value="\${escapeHtml(snapshot.diagnose.requestId ?? "")}" />
              </div>
              <div class="grid-2">
                <input id="diag-keyk" placeholder="tdiagnose_keyk" value="\${escapeHtml(snapshot.diagnose.keyk ?? "")}" />
                <button id="saveDiagnoseBtn" type="button">保存诊断配置</button>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <h3 class="title">故障码配置</h3>
            </div>
            <div class="panel-body">
              <table>
                <thead>
                  <tr>
                    <th>DTC</th>
                    <th>描述</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>\${dtcRows}</tbody>
              </table>
              <div class="grid-2">
                <input id="new-dtc-code" placeholder="故障码" />
                <input id="new-dtc-description" placeholder="描述" />
              </div>
              <button id="addDtcBtn" type="button">新增故障码</button>
            </div>
          </section>
        \` : "";

        const actionPanel = status.canCreateConfigBlock
          ? '<button id="createConfigBlockBtn" type="button">创建 tset 配置块</button>'
          : status.canTakeOver
            ? '<div class="warning">' + escapeHtml(status.message) + '</div><button id="takeOverConfigBlockBtn" type="button">接管并规范化配置块</button>'
            : '';

        app.innerHTML = \`
          <section class="panel">
            <div class="panel-header">
              <div>
                <h3 class="title">当前文档</h3>
                <div class="subtitle">\${escapeHtml(snapshot.documentPath ?? "未选择文档")}</div>
              </div>
              <span class="status-badge \${escapeHtml(status.state)}">\${escapeHtml(status.message)}</span>
            </div>
            <div class="panel-body">
              <div class="meta">
                <div class="meta-item">
                  <div class="meta-label">配置块状态</div>
                  <div>\${snapshot.hasConfigurationBlock ? "已存在 tset" : "未创建 tset"}</div>
                </div>
                <div class="meta-item">
                  <div class="meta-label">DBC 状态</div>
                  <div>\${escapeHtml(snapshot.dbcStatus.message)}</div>
                </div>
              </div>
              \${actionPanel}
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <h3 class="title">DBC 配置</h3>
              <button id="refreshBtn" type="button">刷新</button>
            </div>
            <div class="panel-body">
              <div class="toolbar">
                <select id="dbcSelect">\${dbcOptions}</select>
                <button id="applyDbcBtn" type="button">应用</button>
                <button id="pickDbcBtn" type="button">浏览...</button>
                <button id="clearDbcBtn" type="button">自动发现</button>
              </div>
              <div class="path">\${escapeHtml(dbcConfiguredPath || "当前使用自动发现")}</div>
            </div>
          </section>

          \${editablePanels || ""}
        \`;

        wireEvents();
      }

      function wireEvents() {
        document.getElementById("refreshBtn")?.addEventListener("click", () => {
          vscode.postMessage({ type: "refresh" });
        });
        document.getElementById("applyDbcBtn")?.addEventListener("click", () => {
          const value = document.getElementById("dbcSelect").value;
          if (!value) {
            vscode.postMessage({ type: "clearDbcPath" });
            return;
          }
          vscode.postMessage({ type: "setDbcPath", path: value });
        });
        document.getElementById("pickDbcBtn")?.addEventListener("click", () => {
          vscode.postMessage({ type: "pickDbcPath" });
        });
        document.getElementById("clearDbcBtn")?.addEventListener("click", () => {
          vscode.postMessage({ type: "clearDbcPath" });
        });
        document.getElementById("createConfigBlockBtn")?.addEventListener("click", () => {
          vscode.postMessage({ type: "createConfigBlock" });
        });
        document.getElementById("takeOverConfigBlockBtn")?.addEventListener("click", () => {
          vscode.postMessage({ type: "takeOverConfigBlock" });
        });
        document.getElementById("saveDiagnoseBtn")?.addEventListener("click", () => {
          vscode.postMessage({
            type: "updateDiagnose",
            diagnose: {
              responseId: document.getElementById("diag-rid").value,
              requestId: document.getElementById("diag-sid").value,
              keyk: document.getElementById("diag-keyk").value,
            },
          });
        });
        document.getElementById("addChannelBtn")?.addEventListener("click", () => {
          vscode.postMessage({
            type: "addChannel",
            channel: {
              deviceId: document.getElementById("new-channel-deviceId").value,
              deviceIndex: document.getElementById("new-channel-deviceIndex").value,
              channelIndex: document.getElementById("new-channel-channelIndex").value,
              arbitrationBaudRateKbps: document.getElementById("new-channel-arb").value,
              dataBaudRateKbps: document.getElementById("new-channel-data").value,
            },
          });
        });
        document.getElementById("addDtcBtn")?.addEventListener("click", () => {
          vscode.postMessage({
            type: "addDtc",
            item: {
              dtc: document.getElementById("new-dtc-code").value,
              description: document.getElementById("new-dtc-description").value,
            },
          });
        });

        document.querySelectorAll("[data-action='save-channel']").forEach((element) => {
          element.addEventListener("click", () => {
            const index = Number(element.dataset.index);
            vscode.postMessage({
              type: "updateChannel",
              index,
              channel: {
                deviceId: getChannelValue(index, "deviceId"),
                deviceIndex: getChannelValue(index, "deviceIndex"),
                channelIndex: getChannelValue(index, "channelIndex"),
                arbitrationBaudRateKbps: getChannelValue(index, "arb"),
                dataBaudRateKbps: getChannelValue(index, "data"),
              },
            });
          });
        });
        document.querySelectorAll("[data-action='remove-channel']").forEach((element) => {
          element.addEventListener("click", () => {
            vscode.postMessage({
              type: "removeChannel",
              index: Number(element.dataset.index),
            });
          });
        });
        document.querySelectorAll("[data-action='save-dtc']").forEach((element) => {
          element.addEventListener("click", () => {
            const index = Number(element.dataset.index);
            vscode.postMessage({
              type: "updateDtc",
              index,
              item: {
                dtc: getDtcValue(index, "code"),
                description: getDtcValue(index, "description"),
              },
            });
          });
        });
        document.querySelectorAll("[data-action='remove-dtc']").forEach((element) => {
          element.addEventListener("click", () => {
            vscode.postMessage({
              type: "removeDtc",
              index: Number(element.dataset.index),
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
