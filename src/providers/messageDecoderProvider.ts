import * as vscode from "vscode";
import { DbcManager, type DbcManagerStatus } from "../dbc/dbcManager";
import {
  type DecodedDisplayMessage,
  isDecodedDisplayError,
} from "../dbc/displayModel";
import { parseMessageDecoderInput } from "./messageDecoderInput";

interface DecoderErrorItem {
  kind: "error";
  lineNumber: number;
  rawInput: string;
  message: string;
}

interface DecoderMessageItem {
  kind: "message";
  lineNumber: number;
  rawInput: string;
  message: DecodedDisplayMessage;
}

type DecoderResultItem = DecoderErrorItem | DecoderMessageItem;

interface DecoderStatusPayload {
  state: DbcManagerStatus["state"];
  message: string;
  path?: string;
  canDecode: boolean;
}

function createNonce() {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}

export class TesterMessageDecoderProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private dbcManager: DbcManager) {
    this.disposables.push(
      this.dbcManager.onDidChangeStatus(() => {
        this.postStatus();
      }),
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    this.postStatus();

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message) => {
        if (message?.type === "ready") {
          this.postStatus();
          return;
        }

        if (message?.type === "decode") {
          this.handleDecode(String(message.input ?? ""));
        }
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

  private handleDecode(input: string) {
    if (!this.view) {
      return;
    }

    const status = this.createStatusPayload(this.dbcManager.getStatus());
    const parsed = parseMessageDecoderInput(input);
    const items: DecoderResultItem[] = parsed.errors.map((error) => ({
      kind: "error",
      lineNumber: error.lineNumber,
      rawInput: error.rawInput,
      message: error.message,
    }));

    if (!status.canDecode) {
      for (const request of parsed.requests) {
        items.push({
          kind: "error",
          lineNumber: request.lineNumber,
          rawInput: request.rawInput,
          message: status.message,
        });
      }
      this.postResults(items);
      return;
    }

    for (const request of parsed.requests) {
      const result = this.dbcManager.decodeMessageForDisplay(
        request.messageId,
        request.dataBytes,
      );

      if (isDecodedDisplayError(result)) {
        items.push({
          kind: "error",
          lineNumber: request.lineNumber,
          rawInput: request.rawInput,
          message: result.message,
        });
        continue;
      }

      items.push({
        kind: "message",
        lineNumber: request.lineNumber,
        rawInput: request.rawInput,
        message: result,
      });
    }

    this.postResults(items);
  }

  private postResults(items: DecoderResultItem[]) {
    if (!this.view) {
      return;
    }

    const sorted = [...items].sort((left, right) => left.lineNumber - right.lineNumber);
    const successCount = sorted.filter((item) => item.kind === "message").length;
    const errorCount = sorted.length - successCount;

    void this.view.webview.postMessage({
      type: "results",
      items: sorted,
      summary: {
        total: sorted.length,
        successCount,
        errorCount,
      },
    });
  }

  private postStatus() {
    if (!this.view) {
      return;
    }

    void this.view.webview.postMessage({
      type: "status",
      status: this.createStatusPayload(this.dbcManager.getStatus()),
    });
  }

  private createStatusPayload(status: DbcManagerStatus): DecoderStatusPayload {
    return {
      state: status.state,
      message: status.message,
      path: status.path,
      canDecode: status.state === "loaded",
    };
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
        --card-error: color-mix(in srgb, var(--error) 10%, transparent);
      }

      * { box-sizing: border-box; }

      html, body {
        margin: 0;
        padding: 0;
        height: 100%;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
        font-size: 12px;
      }

      body {
        display: flex;
        flex-direction: column;
      }

      .input-area {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        border-bottom: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg) 92%, var(--panel));
      }

      .status-panel {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--panel);
      }

      .status-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--border);
        color: var(--muted);
        font-size: 11px;
      }

      .status-badge.loaded {
        color: var(--accent);
      }

      .status-badge.error {
        color: var(--error);
      }

      .status-text {
        font-weight: 600;
      }

      .status-path {
        color: var(--muted);
        font-size: 11px;
        word-break: break-all;
      }

      textarea {
        width: 100%;
        min-height: 108px;
        resize: vertical;
        padding: 8px;
        border: 1px solid var(--input-border);
        border-radius: 6px;
        background: var(--input-bg);
        color: var(--input-fg);
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        line-height: 1.45;
        outline: none;
      }

      textarea:focus {
        border-color: var(--accent);
      }

      .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      button {
        padding: 5px 12px;
        border: none;
        border-radius: 4px;
        background: var(--btn-bg);
        color: var(--btn-fg);
        cursor: pointer;
        white-space: nowrap;
      }

      button:hover {
        background: var(--btn-hover);
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .hint {
        color: var(--muted);
        font-size: 11px;
      }

      .summary {
        color: var(--muted);
        font-size: 11px;
        margin-left: auto;
      }

      .content {
        flex: 1;
        overflow: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .empty {
        color: var(--muted);
        text-align: center;
        padding: 20px 12px;
      }

      .card {
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--panel);
        overflow: hidden;
      }

      .card.error {
        border-color: color-mix(in srgb, var(--error) 35%, var(--border));
        background: var(--card-error);
      }

      .card-header {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      .card-title {
        margin: 0;
        font-size: 13px;
      }

      .card-subtitle {
        margin-top: 4px;
        color: var(--muted);
      }

      .line-tag {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 2px 8px;
        white-space: nowrap;
        color: var(--muted);
      }

      .card-body {
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .meta-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .meta-item {
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 8px;
      }

      .meta-item .label {
        color: var(--muted);
        margin-bottom: 4px;
      }

      .data-block, .raw-input {
        font-family: var(--vscode-editor-font-family);
      }

      .mux-note {
        color: var(--accent);
        font-size: 11px;
      }

      .table-wrap {
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: 8px;
      }

      table {
        width: 100%;
        min-width: 640px;
        border-collapse: collapse;
      }

      thead th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: color-mix(in srgb, var(--bg) 88%, var(--panel));
        color: var(--muted);
        font-weight: 600;
      }

      th, td {
        border-bottom: 1px solid var(--border);
        padding: 6px 8px;
        text-align: left;
        white-space: nowrap;
      }

      td.wrap {
        white-space: normal;
      }

      .signal-name {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .signal-tag {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 0 6px;
        color: var(--muted);
        font-size: 11px;
      }

      .error-message {
        color: var(--error);
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <div class="input-area">
      <div class="status-panel">
        <div class="status-row">
          <span class="status-badge" id="statusBadge">未加载 DBC</span>
          <span class="status-text" id="statusText">当前未加载 DBC 文件</span>
        </div>
        <div class="status-path" id="statusPath"></div>
      </div>
      <textarea
        id="decodeInput"
        placeholder="每行一条报文，格式: 报文ID, 报文数据&#10;示例:&#10;1A3, FF 00 AB 12 34 56 78 9A&#10;0x261, 2A 01 00 00 00 00 00 D4"
      ></textarea>
      <div class="toolbar">
        <button id="decodeBtn" type="button" disabled>解析</button>
        <div class="summary" id="summaryText">等待输入</div>
      </div>
      <div class="hint" id="statusHint">规则：ID 按十六进制解析，数据按空格分隔，单条报文长度必须为 1-8 字节。</div>
    </div>
    <div class="content" id="result">
      <div class="empty">输入一条或多条报文后点击“解析”</div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const persisted = vscode.getState() ?? {};
      const defaultStatus = {
        state: "unloaded",
        message: "当前未加载 DBC 文件",
        canDecode: false,
      };
      const input = document.getElementById("decodeInput");
      const btn = document.getElementById("decodeBtn");
      const result = document.getElementById("result");
      const summaryText = document.getElementById("summaryText");
      const statusBadge = document.getElementById("statusBadge");
      const statusText = document.getElementById("statusText");
      const statusPath = document.getElementById("statusPath");
      const statusHint = document.getElementById("statusHint");
      let currentStatus = defaultStatus;

      input.value = persisted.input ?? "";

      function persist() {
        vscode.setState({ input: input.value });
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function decode() {
        if (!currentStatus.canDecode) {
          return;
        }
        persist();
        vscode.postMessage({ type: "decode", input: input.value });
      }

      function renderStatus(status) {
        currentStatus = status ?? defaultStatus;
        const badgeText = currentStatus.state === "loaded"
          ? "已加载 DBC"
          : currentStatus.state === "error"
            ? "DBC 错误"
            : "未加载 DBC";
        statusBadge.className = "status-badge " + currentStatus.state;
        statusBadge.textContent = badgeText;
        statusText.textContent = currentStatus.message;
        statusPath.textContent = currentStatus.path ?? "";
        btn.disabled = !currentStatus.canDecode;
        statusHint.textContent = currentStatus.canDecode
          ? "规则：ID 按十六进制解析，数据按空格分隔，单条报文长度必须为 1-8 字节。"
          : "当前不可解析报文，请先确保 DBC 已正确加载。";
        persist();
      }

      function renderSignalRow(signal) {
        const tag = signal.multiplexTag
          ? '<span class="signal-tag">' + escapeHtml(signal.multiplexTag) + '</span>'
          : "";
        const positionText = signal.rawValueHexText && signal.rawValueHexText !== "-"
          ? signal.locationText + "=" + signal.rawValueHexText
          : signal.locationText;
        return \`
          <tr>
            <td><span class="signal-name"><code>\${escapeHtml(signal.name)}</code>\${tag}</span></td>
            <td class="wrap">\${escapeHtml(signal.description)}</td>
            <td><code>\${escapeHtml(positionText)}</code></td>
            <td>\${escapeHtml(signal.physValueText)}</td>
          </tr>
        \`;
      }

      function renderMessageCard(item) {
        const message = item.message;
        const muxNote = message.multiplexerName
          ? typeof message.multiplexerValue === "number"
            ? '<div class="mux-note">当前复用分支: ' + escapeHtml(message.multiplexerName) + ' = ' + escapeHtml(message.multiplexerValue) + '</div>'
            : '<div class="mux-note">复用开关: ' + escapeHtml(message.multiplexerName) + '</div>'
          : "";

        const signalTable = message.signals.length
          ? \`
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>信号名</th>
                    <th>描述</th>
                    <th>位置</th>
                    <th>解析值</th>
                  </tr>
                </thead>
                <tbody>\${message.signals.map(renderSignalRow).join("")}</tbody>
              </table>
            </div>
          \`
          : '<div class="empty">该报文无信号定义</div>';

        return \`
          <section class="card">
            <div class="card-header">
              <div>
                <h3 class="card-title">\${escapeHtml(message.name)}</h3>
                <div class="card-subtitle raw-input">\${escapeHtml(item.rawInput)}</div>
              </div>
              <span class="line-tag">第 \${item.lineNumber} 行</span>
            </div>
            <div class="card-body">
              \${message.description ? '<div>' + escapeHtml(message.description) + '</div>' : ""}
              <div class="meta-grid">
                <div class="meta-item"><div class="label">报文 ID</div><div>\${escapeHtml(message.idHex)} (\${message.id})</div></div>
                <div class="meta-item"><div class="label">DLC</div><div>\${message.dlc}</div></div>
                <div class="meta-item"><div class="label">发送节点</div><div>\${escapeHtml(message.sendingNode ?? "-")}</div></div>
                <div class="meta-item"><div class="label">数据</div><div class="data-block">\${escapeHtml(message.dataText)}</div></div>
              </div>
              \${muxNote}
              \${signalTable}
            </div>
          </section>
        \`;
      }

      function renderErrorCard(item) {
        return \`
          <section class="card error">
            <div class="card-header">
              <div>
                <h3 class="card-title">解析失败</h3>
                <div class="card-subtitle raw-input">\${escapeHtml(item.rawInput || "(空输入)")}</div>
              </div>
              <span class="line-tag">第 \${item.lineNumber} 行</span>
            </div>
            <div class="card-body">
              <div class="error-message">\${escapeHtml(item.message)}</div>
            </div>
          </section>
        \`;
      }

      function renderResults(payload) {
        const items = payload.items ?? [];
        summaryText.textContent = items.length
          ? '共 ' + payload.summary.total + ' 条，成功 ' + payload.summary.successCount + '，失败 ' + payload.summary.errorCount
          : '未生成结果';

        if (!items.length) {
          result.innerHTML = '<div class="empty">没有可解析的输入</div>';
          return;
        }

        result.innerHTML = items
          .map((item) => item.kind === "message" ? renderMessageCard(item) : renderErrorCard(item))
          .join("");
      }

      btn.addEventListener("click", decode);
      input.addEventListener("input", persist);
      input.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          decode();
        }
      });

      window.addEventListener("message", (event) => {
        const msg = event.data;
        if (msg?.type === "status") {
          renderStatus(msg.status);
          return;
        }
        if (msg?.type === "results") {
          renderResults(msg);
        }
      });

      renderStatus(currentStatus);
      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
  }
}
