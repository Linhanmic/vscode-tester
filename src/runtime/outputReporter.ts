import * as vscode from "vscode";
import {
  ParsedSendCommand,
  ParsedTestCase,
  RunnerEvent,
  RunnerEventSink,
} from "./types";
import { formatDataBytes, formatMessageId } from "./utils";

type LogLevel = "RUN " | "CASE" | "TX  " | "RX  " | "WAIT" | "WARN" | "ERR ";

function formatTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.toLocaleTimeString("zh-CN", {
    hour12: false,
  })}.${date.getMilliseconds().toString().padStart(3, "0")}`;
}

export class OutputReporter {
  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly eventSink?: RunnerEventSink,
  ) {}

  show() {
    this.output.show(true);
  }

  runStarted(
    scope: "suite" | "case" | "command",
    title: string,
    totalCases: number,
  ) {
    this.write(
      "RUN ",
      scope === "suite"
        ? `开始执行测试集: ${title} (${totalCases} 个用例)`
        : scope === "case"
          ? `开始执行单用例: ${title}`
          : `开始执行到命令: ${title}`,
      {
        type: "run-started",
        scope,
        title,
        totalCases,
        timestamp: Date.now(),
      },
    );
  }

  runFinished(
    scope: "suite" | "case" | "command",
    title: string,
    passedCount: number,
    failedCount: number,
    status: "passed" | "failed" | "cancelled",
  ) {
    this.write(
      status === "failed" ? "WARN" : "RUN ",
      `${title} 执行完成，通过 ${passedCount}，失败 ${failedCount}`,
      {
        type: "run-finished",
        scope,
        title,
        passedCount,
        failedCount,
        status,
        timestamp: Date.now(),
      },
    );
  }

  caseStarted(testCase: ParsedTestCase) {
    this.write("CASE", `开始: ${testCase.label}`, {
      type: "case-started",
      caseLabel: testCase.label,
      timestamp: Date.now(),
    });
  }

  caseFinished(
    testCase: ParsedTestCase,
    status: "passed" | "failed" | "cancelled",
    message?: string,
  ) {
    const level: LogLevel =
      status === "failed" ? "ERR " : status === "cancelled" ? "WARN" : "CASE";
    const statusLabel =
      status === "passed" ? "通过" : status === "failed" ? "失败" : "取消";
    this.write(level, `${statusLabel}: ${testCase.label}${message ? ` - ${message}` : ""}`, {
      type: "case-finished",
      caseLabel: testCase.label,
      status,
      message,
      timestamp: Date.now(),
    });
  }

  sendTaskStarted(command: ParsedSendCommand, channelIndex: number) {
    this.write(
      "TX  ",
      `启动后台发送 ch${channelIndex} ${formatMessageId(command.messageId)} ${formatDataBytes(command.dataBytes)} 周期=${command.periodMs}ms 次数=${command.count}`,
      {
        type: "send-task-started",
        key: `${channelIndex}:${command.messageId}`,
        channelIndex,
        messageId: command.messageId,
        data: formatDataBytes(command.dataBytes),
        periodMs: command.periodMs,
        count: command.count,
        timestamp: Date.now(),
      },
    );
  }

  sendTaskReplaced(channelIndex: number, messageId: number) {
    this.write("TX  ", `顶替活动发送 ch${channelIndex} ${formatMessageId(messageId)}`, {
      type: "send-task-replaced",
      key: `${channelIndex}:${messageId}`,
      channelIndex,
      messageId,
      timestamp: Date.now(),
    });
  }

  sendTaskStopped(
    channelIndex: number,
    messageId: number,
    sentCount: number,
    count: number,
    reason: "completed" | "replaced" | "cleanup" | "cancelled",
  ) {
    if (reason === "completed") {
      this.write(
        "TX  ",
        `后台发送完成 ch${channelIndex} ${formatMessageId(messageId)} 已发送 ${sentCount}/${count}`,
        {
          type: "send-task-stopped",
          key: `${channelIndex}:${messageId}`,
          channelIndex,
          messageId,
          sentCount,
          count,
          reason,
          timestamp: Date.now(),
        },
      );
      return;
    }

    this.emit({
      type: "send-task-stopped",
      key: `${channelIndex}:${messageId}`,
      channelIndex,
      messageId,
      sentCount,
      count,
      reason,
      timestamp: Date.now(),
    });
  }

  recordTxFrame(
    channelIndex: number,
    messageId: number,
    data: readonly number[] | Buffer,
    sentCount: number,
    count: number,
  ) {
    const formattedData = formatDataBytes(data);
    this.emit({
      type: "bus-frame",
      direction: "tx",
      channelIndex,
      messageId,
      data: formattedData,
      note: `${sentCount}/${count}`,
      timestamp: Date.now(),
    });
    this.emit({
      type: "tx-frame",
      key: `${channelIndex}:${messageId}`,
      channelIndex,
      messageId,
      data: formattedData,
      sentCount,
      count,
      timestamp: Date.now(),
    });
  }

  observeFrame(
    channelIndex: number,
    messageId: number,
    data: readonly number[] | Buffer,
  ) {
    this.emit({
      type: "bus-frame",
      direction: "rx",
      channelIndex,
      messageId,
      data: formatDataBytes(data),
      note: "捕获",
      timestamp: Date.now(),
    });
  }

  delay(durationMs: number) {
    this.write("WAIT", `阻塞延时 ${durationMs}ms`, {
      type: "delay",
      durationMs,
      timestamp: Date.now(),
    });
  }

  receiveMatched(channelIndex: number, messageId: number, data: readonly number[] | Buffer) {
    this.write("RX  ", `匹配 ch${channelIndex} ${formatMessageId(messageId)} ${formatDataBytes(data)}`, {
      type: "rx-frame",
      channelIndex,
      messageId,
      data: formatDataBytes(data),
      outcome: "matched",
      timestamp: Date.now(),
    });
  }

  receivePrinted(channelIndex: number, messageId: number, data: readonly number[] | Buffer, detail: string) {
    this.write(
      "RX  ",
      `打印 ch${channelIndex} ${formatMessageId(messageId)} ${formatDataBytes(data)} ${detail}`,
      {
        type: "rx-frame",
        channelIndex,
        messageId,
        data: formatDataBytes(data),
        outcome: "printed",
        timestamp: Date.now(),
      },
    );
  }

  receiveMismatch(channelIndex: number, messageId: number, data: readonly number[] | Buffer) {
    this.write(
      "WARN",
      `同 ID 内容未匹配 ch${channelIndex} ${formatMessageId(messageId)} ${formatDataBytes(data)}`,
      {
        type: "rx-frame",
        channelIndex,
        messageId,
        data: formatDataBytes(data),
        outcome: "mismatch",
        timestamp: Date.now(),
      },
    );
  }

  receiveIgnored(channelIndex: number, messageId: number, data: readonly number[] | Buffer) {
    this.emit({
      type: "rx-frame",
      channelIndex,
      messageId,
      data: formatDataBytes(data),
      outcome: "ignored",
      timestamp: Date.now(),
    });
  }

  cleanup(stoppedTaskCount: number, clearedChannels: number[]) {
    this.write(
      "RUN ",
      `清理完成: 停止活动发送 ${stoppedTaskCount} 个，清空通道 ${clearedChannels.map((channelIndex) => `ch${channelIndex}`).join(", ") || "全部"} 缓冲区`,
      {
        type: "cleanup",
        stoppedTaskCount,
        clearedChannels,
        timestamp: Date.now(),
      },
    );
  }

  note(level: "info" | "warn" | "error", message: string) {
    const tag: LogLevel =
      level === "error" ? "ERR " : level === "warn" ? "WARN" : "RUN ";
    this.write(tag, message, {
      type: "note",
      level,
      message,
      timestamp: Date.now(),
    });
  }

  private write(level: LogLevel, message: string, event: RunnerEvent) {
    this.output.appendLine(`[${formatTimestamp(event.timestamp)}] ${level} ${message}`);
    this.emit(event);
  }

  private emit(event: RunnerEvent) {
    this.eventSink?.handleEvent(event);
  }
}
