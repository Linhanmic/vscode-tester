import * as vscode from "vscode";
import { RunnerEvent, RunnerEventSink } from "../runtime/types";
import { TesterBusMonitorStore } from "./busMonitorStore";

function createNonce() {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}

export class TesterBusMonitorProvider
  implements vscode.WebviewViewProvider, RunnerEventSink, vscode.Disposable
{
  private readonly store = new TesterBusMonitorStore();
  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message) => {
        if (message?.type === "ready") {
          this.postSnapshot();
          return;
        }

        if (message?.type === "clear") {
          this.clear();
        }
      }),
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) {
          this.view = undefined;
        }
      }),
    );

    this.postSnapshot();
  }

  handleEvent(event: RunnerEvent): void {
    this.store.handleEvent(event);
    this.scheduleRefresh();
  }

  clear() {
    this.store.clear();
    this.scheduleRefresh();
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

  private scheduleRefresh() {
    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.postSnapshot();
    }, 80);
  }

  private postSnapshot() {
    if (!this.view) {
      return;
    }

    void this.view.webview.postMessage({
      type: "snapshot",
      snapshot: this.store.createSnapshot(),
    });
  }

  private getHtml(webview: vscode.Webview) {
    const nonce = createNonce();
    const snapshot = JSON.stringify(this.store.createSnapshot());

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"
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
        --warn: var(--vscode-editorWarning-foreground);
        --error: var(--vscode-errorForeground);
        --success: #2f8f5b;
        --changed: color-mix(in srgb, #f6c344 35%, transparent);
        --row-hover: color-mix(in srgb, var(--vscode-list-hoverBackground) 85%, transparent);
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

      .toolbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 8px;
        border-bottom: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg) 92%, var(--panel));
        backdrop-filter: blur(10px);
      }

      .status-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--panel);
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--muted);
      }

      .status-running .status-dot { background: var(--accent); }
      .status-passed .status-dot { background: var(--success); }
      .status-failed .status-dot { background: var(--error); }
      .status-cancelled .status-dot { background: var(--warn); }

      .toolbar-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
      }

      button, label.toggle {
        border: 1px solid var(--border);
        background: var(--panel);
        color: var(--fg);
        border-radius: 6px;
        padding: 4px 8px;
        cursor: pointer;
      }

      label.toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .content {
        min-height: 0;
        flex: 1;
        overflow: auto;
        padding: 8px;
      }

      details.section {
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--panel);
        margin-bottom: 10px;
        overflow: hidden;
      }

      details.section > summary {
        cursor: pointer;
        padding: 10px 12px;
        font-weight: 600;
        list-style: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      details.section > summary::-webkit-details-marker {
        display: none;
      }

      .section-body {
        border-top: 1px solid var(--border);
        padding: 8px;
      }

      .meta-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .meta-card {
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 8px;
        background: color-mix(in srgb, var(--panel) 92%, transparent);
      }

      .meta-card .label {
        color: var(--muted);
        margin-bottom: 4px;
      }

      .table-wrap {
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: 8px;
      }

      table {
        width: 100%;
        min-width: 920px;
        border-collapse: collapse;
        table-layout: fixed;
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
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: left;
      }

      tbody tr.data-row {
        cursor: pointer;
      }

      tbody tr.data-row:hover {
        background: var(--row-hover);
      }

      tbody tr.detail-row td {
        white-space: normal;
        padding: 10px 12px;
        background: color-mix(in srgb, var(--panel) 92%, transparent);
      }

      .direction {
        font-weight: 700;
      }

      .direction.tx { color: var(--accent); }
      .direction.rx { color: var(--success); }

      .byte {
        display: inline-flex;
        min-width: 28px;
        justify-content: center;
        padding: 2px 4px;
        border-radius: 4px;
      }

      .byte.changed {
        background: var(--changed);
        animation: pulse 1.4s ease-out;
      }

      @keyframes pulse {
        from { transform: scale(1.04); }
        to { transform: scale(1); }
      }

      .empty {
        padding: 16px;
        color: var(--muted);
        text-align: center;
      }

      .history {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 10px;
      }

      .history-entry {
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 8px;
      }

      .history-title {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        color: var(--muted);
        margin-bottom: 4px;
      }

      .log-list {
        max-height: 320px;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .log-item {
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 8px;
      }

      .log-item.warn { border-color: color-mix(in srgb, var(--warn) 55%, var(--border)); }
      .log-item.error { border-color: color-mix(in srgb, var(--error) 55%, var(--border)); }

      .log-head {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }

      .muted { color: var(--muted); }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        border: 1px solid var(--border);
        border-radius: 999px;
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <div id="statusChips"></div>
      <div class="toolbar-actions">
        <label class="toggle">
          <input id="autoScrollToggle" type="checkbox" checked />
          自动滚动日志
        </label>
        <button id="expandAllButton" type="button">展开全部</button>
        <button id="collapseAllButton" type="button">折叠全部</button>
        <button id="clearButton" type="button">清空</button>
      </div>
    </div>
    <div class="content" id="content"></div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const initialState = ${snapshot};
      let state = initialState;
      let previousState = initialState;
      const persisted = vscode.getState() ?? {};
      const expandedRows = new Set(persisted.expandedRows ?? []);
      const sectionState = {
        status: persisted.sectionState?.status ?? true,
        tasks: persisted.sectionState?.tasks ?? true,
        frames: persisted.sectionState?.frames ?? true,
        logs: persisted.sectionState?.logs ?? true,
      };
      let autoScrollLogs = persisted.autoScrollLogs ?? true;

      const content = document.getElementById("content");
      const statusChips = document.getElementById("statusChips");
      const autoScrollToggle = document.getElementById("autoScrollToggle");
      const clearButton = document.getElementById("clearButton");
      const expandAllButton = document.getElementById("expandAllButton");
      const collapseAllButton = document.getElementById("collapseAllButton");

      autoScrollToggle.checked = autoScrollLogs;
      autoScrollToggle.addEventListener("change", (event) => {
        autoScrollLogs = event.target.checked;
        persist();
      });

      clearButton.addEventListener("click", () => {
        expandedRows.clear();
        vscode.postMessage({ type: "clear" });
        persist();
      });

      expandAllButton.addEventListener("click", () => {
        sectionState.status = true;
        sectionState.tasks = true;
        sectionState.frames = true;
        sectionState.logs = true;
        state.frames.forEach((frame) => expandedRows.add(frame.key));
        render();
      });

      collapseAllButton.addEventListener("click", () => {
        sectionState.status = false;
        sectionState.tasks = false;
        sectionState.frames = false;
        sectionState.logs = false;
        expandedRows.clear();
        render();
      });

      function persist() {
        vscode.setState({
          expandedRows: Array.from(expandedRows),
          sectionState,
          autoScrollLogs,
        });
      }

      function formatTime(timestamp) {
        const date = new Date(timestamp);
        const base = date.toLocaleTimeString("zh-CN", { hour12: false });
        return \`\${base}.\${String(date.getMilliseconds()).padStart(3, "0")}\`;
      }

      function escapeHtml(value) {
        return value
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function renderStatusChip(label, value, statusClass = "") {
        return \`<span class="status-chip \${statusClass}"><span class="status-dot"></span><span>\${escapeHtml(label)}: \${escapeHtml(value)}</span></span>\`;
      }

      function render() {
        statusChips.innerHTML = [
          renderStatusChip("状态", state.runStatus === "running" ? "运行中" : state.runStatus === "passed" ? "已通过" : state.runStatus === "failed" ? "有失败" : state.runStatus === "cancelled" ? "已取消" : "空闲", \`status-\${state.runStatus}\`),
          renderStatusChip("目标", state.runTitle),
          renderStatusChip("当前用例", state.currentCase),
          renderStatusChip("汇总", \`通过 \${state.passedCount} / 失败 \${state.failedCount}\`),
        ].join("");

        content.innerHTML = [
          renderStatusSection(),
          renderTaskSection(),
          renderFrameSection(),
          renderLogSection(),
        ].join("");

        wireSectionToggles();
        wireFrameRows();
        if (autoScrollLogs) {
          const logList = document.getElementById("logList");
          if (logList) {
            logList.scrollTop = logList.scrollHeight;
          }
        }

        previousState = state;
        persist();
      }

      function renderSection(id, title, description, innerHtml) {
        const open = sectionState[id] ? "open" : "";
        return \`
          <details class="section" data-section-id="\${id}" \${open}>
            <summary><span>\${escapeHtml(title)}</span><span class="muted">\${escapeHtml(description)}</span></summary>
            <div class="section-body">\${innerHtml}</div>
          </details>
        \`;
      }

      function renderStatusSection() {
        return renderSection(
          "status",
          "运行状态",
          state.runStatus,
          \`
            <div class="meta-grid">
              <div class="meta-card"><div class="label">当前目标</div><div>\${escapeHtml(state.runTitle)}</div></div>
              <div class="meta-card"><div class="label">当前用例</div><div>\${escapeHtml(state.currentCase)}</div></div>
              <div class="meta-card"><div class="label">通过数</div><div>\${state.passedCount}</div></div>
              <div class="meta-card"><div class="label">失败数</div><div>\${state.failedCount}</div></div>
            </div>
          \`,
        );
      }

      function renderTaskSection() {
        if (!state.activeTasks.length) {
          return renderSection("tasks", "活动发送", "0", '<div class="empty">当前没有活动发送任务</div>');
        }

        const rows = state.activeTasks
          .map(
            (task) => \`
              <tr>
                <td>ch\${task.channelIndex}</td>
                <td>\${escapeHtml(task.messageIdText)}</td>
                <td>\${escapeHtml(task.data)}</td>
                <td>\${task.sentCount}/\${task.count}</td>
                <td>\${task.periodMs}ms</td>
                <td>\${escapeHtml(formatTime(task.updatedAt))}</td>
              </tr>
            \`,
          )
          .join("");

        return renderSection(
          "tasks",
          "活动发送",
          String(state.activeTasks.length),
          \`
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>通道</th>
                    <th>ID</th>
                    <th>数据</th>
                    <th>进度</th>
                    <th>周期</th>
                    <th>更新时间</th>
                  </tr>
                </thead>
                <tbody>\${rows}</tbody>
              </table>
            </div>
          \`,
        );
      }

      function renderByteCell(frame, index) {
        const value = frame.bytes[index] ?? "--";
        const changed = frame.changedIndices.includes(index) ? " changed" : "";
        return \`<td><span class="byte\${changed}">\${escapeHtml(value)}</span></td>\`;
      }

      function renderFrameSection() {
        if (!state.frames.length) {
          return renderSection("frames", "总线报文", "0", '<div class="empty">运行后会在这里持续显示总线上的所有捕获报文</div>');
        }

        const rows = state.frames
          .map((frame) => {
            const isExpanded = expandedRows.has(frame.key);
            const history = frame.history
              .map(
                (entry) => \`
                  <div class="history-entry">
                    <div class="history-title">
                      <span>\${escapeHtml(formatTime(entry.timestamp))}</span>
                      <span>\${escapeHtml(entry.status)} · 第 \${entry.count} 次</span>
                    </div>
                    <div>\${escapeHtml(entry.data)}</div>
                    <div class="muted">变化字节: \${entry.changedIndices.length ? entry.changedIndices.map((index) => \`D\${index}\`).join(", ") : "无"}</div>
                  </div>
                \`,
              )
              .join("");

            return \`
              <tr class="data-row" data-frame-key="\${escapeHtml(frame.key)}">
                <td>\${isExpanded ? "▾" : "▸"}</td>
                <td><span class="direction \${frame.direction}">\${frame.direction.toUpperCase()}</span></td>
                <td>ch\${frame.channelIndex}</td>
                <td>\${escapeHtml(frame.messageIdText)}</td>
                \${Array.from({ length: 8 }, (_, index) => renderByteCell(frame, index)).join("")}
                <td>\${frame.updateCount}</td>
                <td>\${escapeHtml(frame.status)}</td>
                <td>\${escapeHtml(formatTime(frame.updatedAt))}</td>
              </tr>
              \${isExpanded ? \`
                <tr class="detail-row">
                  <td colspan="15">
                    <div><span class="badge">\${escapeHtml(frame.direction.toUpperCase())}</span> <span class="badge">ch\${frame.channelIndex}</span> <span class="badge">\${escapeHtml(frame.messageIdText)}</span></div>
                    <div style="margin-top:8px;">完整数据: <code>\${escapeHtml(frame.data)}</code></div>
                    <div class="muted" style="margin-top:4px;">最近变化: \${frame.changedIndices.length ? frame.changedIndices.map((index) => \`D\${index}\`).join(", ") : "无"}</div>
                    <div class="history">\${history}</div>
                  </td>
                </tr>
              \` : ""}
            \`;
          })
          .join("");

        return renderSection(
          "frames",
          "总线报文",
          String(state.frames.length),
          \`
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>方向</th>
                    <th>通道</th>
                    <th>ID</th>
                    <th>D0</th>
                    <th>D1</th>
                    <th>D2</th>
                    <th>D3</th>
                    <th>D4</th>
                    <th>D5</th>
                    <th>D6</th>
                    <th>D7</th>
                    <th>次数</th>
                    <th>状态</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>\${rows}</tbody>
              </table>
            </div>
          \`,
        );
      }

      function renderLogSection() {
        if (!state.logs.length) {
          return renderSection("logs", "运行日志", "0", '<div class="empty">暂无运行日志</div>');
        }

        const items = state.logs
          .map(
            (log) => \`
              <div class="log-item \${log.level}">
                <div class="log-head">
                  <strong>\${escapeHtml(log.title)}</strong>
                  <span class="muted">\${escapeHtml(formatTime(log.timestamp))}</span>
                </div>
                <div>\${escapeHtml(log.description)}</div>
              </div>
            \`,
          )
          .join("");

        return renderSection(
          "logs",
          "运行日志",
          String(state.logs.length),
          \`<div class="log-list" id="logList">\${items}</div>\`,
        );
      }

      function wireSectionToggles() {
        document.querySelectorAll("details.section").forEach((element) => {
          element.addEventListener("toggle", () => {
            sectionState[element.dataset.sectionId] = element.open;
            persist();
          });
        });
      }

      function wireFrameRows() {
        document.querySelectorAll("[data-frame-key]").forEach((element) => {
          element.addEventListener("click", () => {
            const key = element.dataset.frameKey;
            if (!key) {
              return;
            }
            if (expandedRows.has(key)) {
              expandedRows.delete(key);
            } else {
              expandedRows.add(key);
            }
            render();
          });
        });
      }

      window.addEventListener("message", (event) => {
        if (event.data?.type !== "snapshot") {
          return;
        }

        state = event.data.snapshot;
        render();
      });

      render();
      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
  }
}
