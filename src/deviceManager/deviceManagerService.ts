import * as vscode from "vscode";
import { OutputReporter } from "../runtime/outputReporter";
import { createDefaultTransport } from "../runtime/transportLoader";
import type { CanSession, CanTransport, RunnerEventSink } from "../runtime/types";
import {
  formatDataBytes,
  isExtendedFrame,
  parseDataSequence,
  parseHexLike,
} from "../runtime/utils";
import { ProjectConfigService } from "../projectConfig/projectConfigService";
import type {
  ProjectChannelConfig,
  ProjectConfigSnapshot,
} from "../projectConfig/types";
import type {
  DeviceManagerChannelItem,
  DeviceManagerSnapshot,
  DeviceManagerTaskSnapshot,
  TemporarySendDraft,
} from "./types";

interface RunningTask {
  key: string;
  channelIndex: number;
  messageId: number;
  dataBytes: number[];
  dataText: string;
  periodMs: number;
  count: number;
  sentCount: number;
  cancelled: boolean;
  status: "running" | "completed" | "stopped";
  promise: Promise<void>;
}

export class DeviceManagerService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly emitter = new vscode.EventEmitter<DeviceManagerSnapshot>();
  private readonly drafts = new Map<number, TemporarySendDraft>();
  private readonly tasks = new Map<string, RunningTask>();
  private readonly reporter: OutputReporter;
  private snapshot = this.createInitialSnapshot();
  private transport: CanTransport | undefined;
  private transportPromise: Promise<CanTransport> | undefined;
  private session: CanSession | undefined;
  private sessionSignature: string | undefined;
  private projectSnapshot: ProjectConfigSnapshot;
  private driverErrorMessage: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    projectConfigService: ProjectConfigService,
    outputChannel: vscode.OutputChannel,
    eventSink?: RunnerEventSink,
  ) {
    this.projectSnapshot = projectConfigService.getSnapshot();
    this.reporter = new OutputReporter(outputChannel, eventSink);
    this.disposables.push(
      this.emitter,
      projectConfigService.onDidChangeSnapshot((snapshot) => {
        void this.handleProjectSnapshotChanged(snapshot);
      }),
    );
    this.context.subscriptions.push(this);
    this.rebuildSnapshot();
  }

  dispose() {
    void this.stopAllTasks("stopped");
    void this.closeSession();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  getSnapshot(): DeviceManagerSnapshot {
    return {
      ...this.snapshot,
      status: { ...this.snapshot.status },
      channels: this.snapshot.channels.map((channel) => ({
        ...channel,
        draft: { ...channel.draft },
      })),
      activeTasks: this.snapshot.activeTasks.map((task) => ({ ...task })),
    };
  }

  get onDidChangeSnapshot(): vscode.Event<DeviceManagerSnapshot> {
    return this.emitter.event;
  }

  async startTask(payload: {
    channelIndex: number;
    messageIdText: string;
    dataText: string;
    periodMs: number | string;
    count: number | string;
  }) {
    this.driverErrorMessage = undefined;
    this.ensureCanSendBase();
    const channelIndex = this.parseInteger(payload.channelIndex, "通道索引", 0);
    const messageId = this.parseHexId(payload.messageIdText);
    const dataBytes = this.parsePayload(payload.dataText);
    const periodMs = this.parseInteger(payload.periodMs, "发送周期", 0);
    const count = this.parseInteger(payload.count, "发送次数", 1);
    const dataText = formatDataBytes(dataBytes);
    const taskKey = `${channelIndex}:${messageId}`;

    this.drafts.set(channelIndex, {
      messageIdText: payload.messageIdText.trim(),
      dataText: payload.dataText.trim(),
      periodMs,
      count,
    });

    await this.ensureSession(this.projectSnapshot.channels);
    const existingTask = this.tasks.get(taskKey);
    if (existingTask) {
      this.reporter.sendTaskReplaced(channelIndex, messageId);
      await this.stopTask(taskKey);
    }

    const task: RunningTask = {
      key: taskKey,
      channelIndex,
      messageId,
      dataBytes,
      dataText,
      periodMs,
      count,
      sentCount: 0,
      cancelled: false,
      status: "running",
      promise: Promise.resolve(),
    };

    this.reporter.sendTaskStarted(
      {
        kind: "tcans",
        messageId,
        dataBytes,
        periodMs,
        count,
        rawText: "",
        range: new vscode.Range(0, 0, 0, 0),
        startLine: 0,
      },
      channelIndex,
    );

    task.promise = this.runTask(task).finally(() => {
      if (this.tasks.get(task.key) === task && task.status !== "running") {
        this.tasks.delete(task.key);
      }
      this.rebuildSnapshot();
    });
    this.tasks.set(task.key, task);
    this.rebuildSnapshot();
  }

  async stopTask(key: string) {
    const task = this.tasks.get(key);
    if (!task) {
      return;
    }

    task.cancelled = true;
    if (task.status === "running") {
      task.status = "stopped";
    }
    await task.promise;
    this.tasks.delete(key);
    this.rebuildSnapshot();
  }

  private async runTask(task: RunningTask) {
    const session = this.session;
    if (!session) {
      throw new Error("CAN 会话尚未初始化");
    }

    try {
      for (let index = 0; index < task.count; index += 1) {
        if (task.cancelled) {
          return;
        }

        await session.send({
          channelIndex: task.channelIndex,
          id: task.messageId,
          data: Buffer.from(task.dataBytes),
          extended: isExtendedFrame(task.messageId),
          ...(this.isCanFdChannel(task.channelIndex)
            ? { bitrateSwitch: true }
            : {}),
        });

        task.sentCount += 1;
        this.reporter.recordTxFrame(
          task.channelIndex,
          task.messageId,
          task.dataBytes,
          task.sentCount,
          task.count,
        );
        this.rebuildSnapshot();

        if (index < task.count - 1 && task.periodMs > 0) {
          await this.delay(task.periodMs, () => task.cancelled);
        }
      }

      task.status = "completed";
      this.reporter.sendTaskStopped(
        task.channelIndex,
        task.messageId,
        task.sentCount,
        task.count,
        "completed",
      );
    } catch (error) {
      task.status = "stopped";
      const message = error instanceof Error ? error.message : String(error);
      this.reporter.note("error", `设备管理发送失败: ${message}`);
      throw error;
    }
  }

  private async ensureSession(channels: ProjectChannelConfig[]) {
    const signature = this.createSessionSignature(channels);
    if (this.session && this.sessionSignature === signature) {
      return;
    }

    if (this.session && this.sessionSignature !== signature) {
      await this.stopAllTasks("stopped");
      await this.closeSession();
      this.reporter.note("warn", "配置已变更，已停止临时发送任务");
    }

    try {
      const transport = await this.getTransport();
      this.session = await transport.open(
        channels.map((channel) => ({
          range: new vscode.Range(0, 0, 0, 0),
          startLine: 0,
          deviceId: channel.deviceId,
          deviceIndex: channel.deviceIndex,
          channelIndex: channel.channelIndex,
          arbitrationBaudRateKbps: channel.arbitrationBaudRateKbps,
          arbitrationBaudRateBps: channel.arbitrationBaudRateKbps * 1000,
          dataBaudRateKbps: channel.dataBaudRateKbps,
          dataBaudRateBps:
            channel.dataBaudRateKbps === undefined
              ? undefined
              : channel.dataBaudRateKbps * 1000,
        })),
      );
      this.driverErrorMessage = undefined;
      this.sessionSignature = signature;
    } catch (error) {
      this.driverErrorMessage =
        error instanceof Error ? error.message : String(error);
      this.rebuildSnapshot();
      throw error;
    }
  }

  private async getTransport() {
    if (this.transport) {
      return this.transport;
    }

    if (!this.transportPromise) {
      this.transportPromise = createDefaultTransport().then((transport) => {
        this.transport = transport;
        return transport;
      }).catch((error) => {
        this.transportPromise = undefined;
        throw error;
      });
    }

    return this.transportPromise;
  }

  private isCanFdChannel(channelIndex: number) {
    return this.projectSnapshot.channels.find(
      (channel) => channel.channelIndex === channelIndex,
    )?.dataBaudRateKbps;
  }

  private async handleProjectSnapshotChanged(snapshot: ProjectConfigSnapshot) {
    const previousSignature = this.createSessionSignature(this.projectSnapshot.channels);
    const nextSignature = this.createSessionSignature(snapshot.channels);
    this.projectSnapshot = snapshot;

    if (this.session && previousSignature !== nextSignature) {
      await this.stopAllTasks("stopped");
      await this.closeSession();
    }

    this.rebuildSnapshot();
  }

  private rebuildSnapshot() {
    const status = this.resolveStatus();
    this.snapshot = {
      status,
      documentPath: this.projectSnapshot.documentPath,
      deviceLabel: this.projectSnapshot.deviceLabel,
      channels: this.projectSnapshot.channels.map((channel) => ({
        ...channel,
        draft:
          this.drafts.get(channel.channelIndex) ?? this.createDefaultDraft(channel),
      })),
      activeTasks: Array.from(this.tasks.values())
        .sort((left, right) => left.channelIndex - right.channelIndex)
        .map((task) => ({
          key: task.key,
          channelIndex: task.channelIndex,
          messageId: task.messageId,
          messageIdText: `0x${task.messageId.toString(16).toUpperCase()}`,
          dataText: task.dataText,
          periodMs: task.periodMs,
          count: task.count,
          sentCount: task.sentCount,
          status: task.status,
        })),
    };
    this.emitter.fire(this.getSnapshot());
  }

  private resolveStatus(): DeviceManagerSnapshot["status"] {
    const projectStatus = this.projectSnapshot.status.state;
    if (projectStatus === "no-document") {
      return {
        state: "no-document",
        message: "请选择一个 Tester 脚本文档",
        canSend: false,
      };
    }
    if (projectStatus === "parser-unavailable") {
      return {
        state: "parser-unavailable",
        message: "语法服务尚未初始化，无法读取通道配置",
        canSend: false,
      };
    }
    if (projectStatus === "no-config-block") {
      return {
        state: "no-config-block",
        message: "当前文档没有 tset 配置块",
        canSend: false,
      };
    }
    if (projectStatus === "unmanaged") {
      return {
        state: "unmanaged",
        message: "当前配置块未接入侧边栏管理，设备管理已禁用",
        canSend: false,
      };
    }
    if (!this.projectSnapshot.channels.length) {
      return {
        state: "not-configured",
        message: "当前 tset 中没有 tcaninit 配置",
        canSend: false,
      };
    }
    if (!this.projectSnapshot.isSingleDevice) {
      return {
        state: "unsupported",
        message: "当前仅支持单设备多通道临时发送",
        canSend: false,
      };
    }
    if (this.driverErrorMessage) {
      return {
        state: "driver-unavailable",
        message: `驱动不可用：${this.driverErrorMessage}`,
        canSend: false,
      };
    }
    if (this.tasks.size > 0) {
      return {
        state: "sending",
        message: "临时发送任务运行中",
        canSend: true,
      };
    }
    return {
      state: "ready",
      message: "可直接基于当前脚本通道发起临时发送，首次发送时会检查驱动",
      canSend: true,
    };
  }

  private createDefaultDraft(channel: ProjectChannelConfig): TemporarySendDraft {
    return {
      messageIdText: "",
      dataText: "",
      periodMs: 100,
      count: 1,
    };
  }

  private createSessionSignature(channels: ProjectChannelConfig[]) {
    return JSON.stringify(
      channels.map((channel) => ({
        deviceId: channel.deviceId,
        deviceIndex: channel.deviceIndex,
        channelIndex: channel.channelIndex,
        arbitrationBaudRateKbps: channel.arbitrationBaudRateKbps,
        dataBaudRateKbps: channel.dataBaudRateKbps,
      })),
    );
  }

  private async stopAllTasks(reason: "stopped") {
    const tasks = Array.from(this.tasks.values());
    for (const task of tasks) {
      task.cancelled = true;
      task.status = reason;
    }

    await Promise.allSettled(tasks.map((task) => task.promise));
    for (const task of tasks) {
      this.reporter.sendTaskStopped(
        task.channelIndex,
        task.messageId,
        task.sentCount,
        task.count,
        "cleanup",
      );
      this.tasks.delete(task.key);
    }
    this.rebuildSnapshot();
  }

  private async closeSession() {
    if (!this.session) {
      return;
    }

    await this.session.close();
    this.session = undefined;
    this.sessionSignature = undefined;
  }

  private parseHexId(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("报文 ID 不能为空");
    }
    return parseHexLike(trimmed);
  }

  private parsePayload(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("报文数据不能为空");
    }
    const bytes = parseDataSequence(trimmed);
    if (!bytes.length) {
      throw new Error("报文数据不能为空");
    }
    if (bytes.length > 64) {
      throw new Error("临时发送最多支持 64 字节数据");
    }
    if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) {
      throw new Error("报文数据包含非法字节");
    }
    return bytes;
  }

  private parseInteger(
    value: number | string,
    label: string,
    minimum: number,
  ) {
    const parsed =
      typeof value === "number" ? value : Number.parseInt(value.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < minimum) {
      throw new Error(`${label} 必须是 >= ${minimum} 的整数`);
    }
    return parsed;
  }

  private createInitialSnapshot(): DeviceManagerSnapshot {
    return {
      status: {
        state: "no-document",
        message: "请选择一个 Tester 脚本文档",
        canSend: false,
      },
      deviceLabel: "未配置设备",
      channels: [],
      activeTasks: [],
    };
  }

  private async delay(milliseconds: number, isCancelled: () => boolean) {
    let remaining = milliseconds;
    while (remaining > 0) {
      if (isCancelled()) {
        return;
      }

      const currentSlice = Math.min(remaining, 50);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, currentSlice);
      });
      remaining -= currentSlice;
    }
  }

  private ensureCanSendBase() {
    const projectStatus = this.projectSnapshot.status.state;
    if (projectStatus === "no-document") {
      throw new Error("请选择一个 Tester 脚本文档");
    }
    if (projectStatus === "parser-unavailable") {
      throw new Error("语法服务尚未初始化，无法读取通道配置");
    }
    if (projectStatus === "no-config-block") {
      throw new Error("当前文档没有 tset 配置块");
    }
    if (projectStatus === "unmanaged") {
      throw new Error("当前配置块未接入侧边栏管理，设备管理已禁用");
    }
    if (!this.projectSnapshot.channels.length) {
      throw new Error("当前 tset 中没有 tcaninit 配置");
    }
    if (!this.projectSnapshot.isSingleDevice) {
      throw new Error("当前仅支持单设备多通道临时发送");
    }
  }
}
