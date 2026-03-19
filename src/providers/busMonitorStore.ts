import { RunnerEvent, RunnerEventSink } from "../runtime/types";

export type RunStatus = "idle" | "running" | "passed" | "failed" | "cancelled";

export interface BusMonitorTaskSnapshot {
  key: string;
  channelIndex: number;
  messageId: number;
  messageIdText: string;
  data: string;
  periodMs: number;
  count: number;
  sentCount: number;
  updatedAt: number;
}

export interface BusMonitorFrameHistoryEntry {
  timestamp: number;
  data: string;
  changedIndices: number[];
  count: number;
  status: string;
}

export interface BusMonitorFrameSnapshot {
  key: string;
  direction: "tx" | "rx";
  channelIndex: number;
  messageId: number;
  messageIdText: string;
  bytes: string[];
  data: string;
  changedIndices: number[];
  updatedAt: number;
  updateCount: number;
  status: string;
  history: BusMonitorFrameHistoryEntry[];
}

export interface BusMonitorLogEntry {
  id: string;
  timestamp: number;
  level: "info" | "warn" | "error";
  title: string;
  description: string;
}

export interface BusMonitorSnapshot {
  runStatus: RunStatus;
  runTitle: string;
  currentCase: string;
  passedCount: number;
  failedCount: number;
  activeTasks: BusMonitorTaskSnapshot[];
  frames: BusMonitorFrameSnapshot[];
  logs: BusMonitorLogEntry[];
}

function formatMessageId(messageId: number) {
  return `0x${messageId.toString(16).toUpperCase()}`;
}

function splitBytes(data: string) {
  return data
    .split("-")
    .map((byte) => byte.trim().toUpperCase())
    .filter(Boolean);
}

function compareChangedIndices(previous: string[], next: string[]) {
  const maximum = Math.max(previous.length, next.length);
  const changedIndices: number[] = [];
  for (let index = 0; index < maximum; index += 1) {
    if ((previous[index] ?? "") !== (next[index] ?? "")) {
      changedIndices.push(index);
    }
  }
  return changedIndices;
}

export class TesterBusMonitorStore implements RunnerEventSink {
  private runStatus: RunStatus = "idle";
  private runTitle = "空闲";
  private currentCase = "无";
  private passedCount = 0;
  private failedCount = 0;
  private readonly activeTasks = new Map<string, BusMonitorTaskSnapshot>();
  private readonly frames = new Map<string, BusMonitorFrameSnapshot>();
  private readonly logs: BusMonitorLogEntry[] = [];

  clear() {
    this.runStatus = "idle";
    this.runTitle = "空闲";
    this.currentCase = "无";
    this.passedCount = 0;
    this.failedCount = 0;
    this.activeTasks.clear();
    this.frames.clear();
    this.logs.length = 0;
  }

  handleEvent(event: RunnerEvent): void {
    switch (event.type) {
      case "run-started":
        this.clear();
        this.runStatus = "running";
        this.runTitle = event.title;
        this.currentCase = "准备中";
        this.pushLog(
          event.timestamp,
          "info",
          "开始执行",
          `${event.scope === "suite" ? "测试集" : "测试用例"}: ${event.title}`,
        );
        break;
      case "run-finished":
        this.runStatus = event.status;
        this.passedCount = event.passedCount;
        this.failedCount = event.failedCount;
        this.pushLog(
          event.timestamp,
          event.status === "failed" ? "warn" : "info",
          "执行完成",
          `${event.title} 通过 ${event.passedCount}，失败 ${event.failedCount}`,
        );
        break;
      case "case-started":
        this.currentCase = event.caseLabel;
        this.pushLog(event.timestamp, "info", "用例开始", event.caseLabel);
        break;
      case "case-finished":
        this.pushLog(
          event.timestamp,
          event.status === "failed"
            ? "error"
            : event.status === "cancelled"
              ? "warn"
              : "info",
          event.status === "passed"
            ? "用例通过"
            : event.status === "failed"
              ? "用例失败"
              : "用例取消",
          event.message ? `${event.caseLabel} - ${event.message}` : event.caseLabel,
        );
        break;
      case "send-task-started":
        this.activeTasks.set(event.key, {
          key: event.key,
          channelIndex: event.channelIndex,
          messageId: event.messageId,
          messageIdText: formatMessageId(event.messageId),
          data: event.data,
          periodMs: event.periodMs,
          count: event.count,
          sentCount: 0,
          updatedAt: event.timestamp,
        });
        break;
      case "send-task-replaced":
        this.pushLog(
          event.timestamp,
          "warn",
          "发送顶替",
          `ch${event.channelIndex} ${formatMessageId(event.messageId)}`,
        );
        break;
      case "send-task-stopped":
        this.activeTasks.delete(event.key);
        if (event.reason === "completed") {
          this.pushLog(
            event.timestamp,
            "info",
            "发送完成",
            `ch${event.channelIndex} ${formatMessageId(event.messageId)} ${event.sentCount}/${event.count}`,
          );
        }
        break;
      case "bus-frame":
        this.upsertFrame({
          key: `${event.direction}:${event.channelIndex}:${event.messageId}`,
          direction: event.direction,
          channelIndex: event.channelIndex,
          messageId: event.messageId,
          data: event.data,
          timestamp: event.timestamp,
          status: event.note,
        });
        break;
      case "tx-frame": {
        const task = this.activeTasks.get(event.key);
        if (task) {
          task.sentCount = event.sentCount;
          task.updatedAt = event.timestamp;
          task.data = event.data;
        }
        break;
      }
      case "rx-frame":
        if (event.outcome !== "ignored") {
          this.pushLog(
            event.timestamp,
            event.outcome === "mismatch" ? "warn" : "info",
            event.outcome === "matched"
              ? "报文匹配"
              : event.outcome === "printed"
                ? "报文打印"
                : "报文未匹配",
            `ch${event.channelIndex} ${formatMessageId(event.messageId)} ${event.data}`,
          );
        }
        break;
      case "delay":
        this.pushLog(event.timestamp, "info", "阻塞延时", `${event.durationMs}ms`);
        break;
      case "cleanup":
        this.activeTasks.clear();
        this.pushLog(
          event.timestamp,
          "info",
          "清理完成",
          `停止 ${event.stoppedTaskCount} 个活动发送，清空 ${event.clearedChannels.map((channelIndex) => `ch${channelIndex}`).join(", ") || "全部通道"}`,
        );
        break;
      case "note":
        this.pushLog(
          event.timestamp,
          event.level,
          event.level === "error"
            ? "错误"
            : event.level === "warn"
              ? "警告"
              : "提示",
          event.message,
        );
        break;
    }
  }

  createSnapshot(): BusMonitorSnapshot {
    return {
      runStatus: this.runStatus,
      runTitle: this.runTitle,
      currentCase: this.currentCase,
      passedCount: this.passedCount,
      failedCount: this.failedCount,
      activeTasks: Array.from(this.activeTasks.values()).sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
      frames: Array.from(this.frames.values()).sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
      logs: [...this.logs].sort((left, right) => left.timestamp - right.timestamp),
    };
  }

  private upsertFrame(options: {
    key: string;
    direction: "tx" | "rx";
    channelIndex: number;
    messageId: number;
    data: string;
    timestamp: number;
    status: string;
  }) {
    const previous = this.frames.get(options.key);
    const nextBytes = splitBytes(options.data);
    const previousBytes = previous?.bytes ?? [];
    const changedIndices =
      previousBytes.length === 0
        ? nextBytes.map((_, index) => index)
        : compareChangedIndices(previousBytes, nextBytes);

    const historyEntry: BusMonitorFrameHistoryEntry = {
      timestamp: options.timestamp,
      data: options.data,
      changedIndices,
      count: (previous?.updateCount ?? 0) + 1,
      status: options.status,
    };

    this.frames.set(options.key, {
      key: options.key,
      direction: options.direction,
      channelIndex: options.channelIndex,
      messageId: options.messageId,
      messageIdText: formatMessageId(options.messageId),
      bytes: nextBytes,
      data: options.data,
      changedIndices,
      updatedAt: options.timestamp,
      updateCount: (previous?.updateCount ?? 0) + 1,
      status: options.status,
      history: [historyEntry, ...(previous?.history ?? [])].slice(0, 10),
    });
  }

  private pushLog(
    timestamp: number,
    level: "info" | "warn" | "error",
    title: string,
    description: string,
  ) {
    this.logs.push({
      id: `${timestamp}:${title}:${this.logs.length}`,
      timestamp,
      level,
      title,
      description,
    });

    if (this.logs.length > 200) {
      this.logs.splice(0, this.logs.length - 200);
    }
  }
}
