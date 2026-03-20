import * as vscode from "vscode";

export interface BitRangeSegment {
  text: string;
  startByte: number;
  startBit: number;
  endByte: number;
  endBit: number;
  widthBits: number;
}

export interface ParsedNodeLocation {
  range: vscode.Range;
  startLine: number;
}

export interface ResolvedChannelConfig extends ParsedNodeLocation {
  deviceId: number;
  deviceIndex: number;
  channelIndex: number;
  arbitrationBaudRateKbps: number;
  arbitrationBaudRateBps: number;
  dataBaudRateKbps?: number;
  dataBaudRateBps?: number;
}

interface ParsedCommandBase extends ParsedNodeLocation {
  rawText: string;
  channelOverride?: number;
}

export interface ParsedSendCommand extends ParsedCommandBase {
  kind: "tcans";
  messageId: number;
  dataBytes: number[];
  periodMs: number;
  count: number;
}

export interface ParsedReceiveDirectCommand extends ParsedCommandBase {
  kind: "tcanr_direct";
  messageId: number;
  expectedBytes: number[];
  waitTimeMs: number;
}

export interface ParsedReceiveBitCommand extends ParsedCommandBase {
  kind: "tcanr_bit";
  messageId: number;
  ranges: BitRangeSegment[];
  expectedValues: number[];
  waitTimeMs: number;
}

export interface ParsedReceivePrintCommand extends ParsedCommandBase {
  kind: "tcanr_print";
  messageId: number;
  ranges: BitRangeSegment[];
}

export interface ParsedDelayCommand extends ParsedCommandBase {
  kind: "tdelay";
  delayMs: number;
}

export type CaseCommand =
  | ParsedSendCommand
  | ParsedReceiveDirectCommand
  | ParsedReceiveBitCommand
  | ParsedReceivePrintCommand
  | ParsedDelayCommand;

export interface ParsedTestCase extends ParsedNodeLocation {
  id?: number;
  title: string;
  label: string;
  commands: CaseCommand[];
}

export interface ParsedTestSuite extends ParsedNodeLocation {
  title: string;
  cases: ParsedTestCase[];
}

export interface ParsedTestDocument {
  configuration: ResolvedChannelConfig[];
  suites: ParsedTestSuite[];
}

export interface CanTransportFrame {
  channelIndex: number;
  id: number;
  data: Buffer;
  extended: boolean;
  bitrateSwitch?: boolean;
}

export interface CanTransportRxFrame extends CanTransportFrame {
  remote: boolean;
  fd: boolean;
  timestampUs: number;
  errorStateIndicator: boolean;
}

export interface CanSession {
  send(frame: CanTransportFrame): Promise<void>;
  read(
    channelIndex: number,
    timeoutMs: number,
  ): Promise<CanTransportRxFrame | null>;
  clear(channelIndex?: number): Promise<void>;
  close(): Promise<void>;
}

export interface CanTransport {
  open(configs: ResolvedChannelConfig[]): Promise<CanSession>;
}

export interface ActiveSendTask {
  key: string;
  channelIndex: number;
  messageId: number;
  command: ParsedSendCommand;
  cancelled: boolean;
  stopReason?: "completed" | "replaced" | "cleanup" | "cancelled";
  sentCount: number;
  promise: Promise<void>;
}

interface RunnerEventBase {
  timestamp: number;
}

export type RunnerEvent =
  | (RunnerEventBase & {
      type: "run-started";
      scope: "suite" | "case" | "command";
      title: string;
      totalCases: number;
    })
  | (RunnerEventBase & {
      type: "run-finished";
      scope: "suite" | "case" | "command";
      title: string;
      passedCount: number;
      failedCount: number;
      status: "passed" | "failed" | "cancelled";
    })
  | (RunnerEventBase & {
      type: "case-started";
      caseLabel: string;
    })
  | (RunnerEventBase & {
      type: "case-finished";
      caseLabel: string;
      status: "passed" | "failed" | "cancelled";
      message?: string;
    })
  | (RunnerEventBase & {
      type: "send-task-started";
      key: string;
      channelIndex: number;
      messageId: number;
      data: string;
      periodMs: number;
      count: number;
    })
  | (RunnerEventBase & {
      type: "send-task-replaced";
      key: string;
      channelIndex: number;
      messageId: number;
    })
  | (RunnerEventBase & {
      type: "send-task-stopped";
      key: string;
      channelIndex: number;
      messageId: number;
      sentCount: number;
      count: number;
      reason: "completed" | "replaced" | "cleanup" | "cancelled";
    })
  | (RunnerEventBase & {
      type: "bus-frame";
      direction: "tx" | "rx";
      channelIndex: number;
      messageId: number;
      data: string;
      note: string;
    })
  | (RunnerEventBase & {
      type: "tx-frame";
      key: string;
      channelIndex: number;
      messageId: number;
      data: string;
      sentCount: number;
      count: number;
    })
  | (RunnerEventBase & {
      type: "rx-frame";
      channelIndex: number;
      messageId: number;
      data: string;
      outcome: "matched" | "ignored" | "mismatch" | "printed";
    })
  | (RunnerEventBase & {
      type: "delay";
      durationMs: number;
    })
  | (RunnerEventBase & {
      type: "cleanup";
      stoppedTaskCount: number;
      clearedChannels: number[];
    })
  | (RunnerEventBase & {
      type: "note";
      level: "info" | "warn" | "error";
      message: string;
    });

export interface RunnerEventSink {
  handleEvent(event: RunnerEvent): void;
}
