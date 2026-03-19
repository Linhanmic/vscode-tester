import * as vscode from "vscode";
import {
  ActiveSendTask,
  CanSession,
  CanTransport,
  CanTransportRxFrame,
  CaseCommand,
  ParsedReceiveBitCommand,
  ParsedReceiveDirectCommand,
  ParsedReceivePrintCommand,
  ParsedSendCommand,
  ParsedTestCase,
  ParsedTestDocument,
  ParsedTestSuite,
  ResolvedChannelConfig,
  RunnerEventSink,
} from "./types";
import { TesterRuntimeParser } from "./parser";
import { createDefaultTransport } from "./transportLoader";
import { OutputReporter } from "./outputReporter";
import { ChannelCaptureHub } from "./channelCaptureHub";
import {
  caseLabel,
  extractRangeValue,
  formatDataBytes,
  formatMessageId,
  isExtendedFrame,
  RunnerCancellation,
  sleepInterruptible,
  TesterCancellationError,
  TesterRuntimeError,
} from "./utils";

class SendTaskManager {
  private readonly configByChannelIndex: Map<number, ResolvedChannelConfig>;
  private readonly tasks = new Map<string, ActiveSendTask>();
  private readonly failures: Error[] = [];

  constructor(
    private readonly session: CanSession,
    configs: ResolvedChannelConfig[],
    private readonly reporter: OutputReporter,
    private readonly cancellation: RunnerCancellation,
  ) {
    this.configByChannelIndex = new Map(
      configs.map((config) => [config.channelIndex, config]),
    );
  }

  async start(command: ParsedSendCommand, channelIndex: number) {
    const key = `${channelIndex}:${command.messageId}`;
    const existingTask = this.tasks.get(key);
    if (existingTask) {
      this.reporter.sendTaskReplaced(channelIndex, command.messageId);
      await this.stopTask(existingTask, "replaced");
    }

    const task: ActiveSendTask = {
      key,
      channelIndex,
      messageId: command.messageId,
      command,
      cancelled: false,
      sentCount: 0,
      promise: Promise.resolve(),
    };

    this.reporter.sendTaskStarted(command, channelIndex);
    task.promise = this.runTask(task)
      .catch((error) => {
        if (!task.cancelled) {
          this.failures.push(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      })
      .finally(() => {
        if (this.tasks.get(key) === task) {
          this.tasks.delete(key);
        }
      });

    this.tasks.set(key, task);
  }

  throwIfFailed() {
    const failure = this.failures.shift();
    if (failure) {
      throw failure;
    }
  }

  async stopAll() {
    const activeTasks = Array.from(this.tasks.values());
    const stopReason = this.cancellation.isCancellationRequested()
      ? "cancelled"
      : "cleanup";
    for (const task of activeTasks) {
      task.cancelled = true;
      task.stopReason = stopReason;
    }

    await Promise.allSettled(activeTasks.map((task) => task.promise));
    this.tasks.clear();
    return activeTasks.length;
  }

  private async stopTask(
    task: ActiveSendTask,
    reason: "replaced" | "cleanup" | "cancelled",
  ) {
    task.cancelled = true;
    task.stopReason = reason;
    await task.promise;
    this.tasks.delete(task.key);
  }

  private async runTask(task: ActiveSendTask) {
    const { command, channelIndex } = task;
    let reason: "completed" | "replaced" | "cleanup" | "cancelled" = "cancelled";

    try {
      if (command.count === 0) {
        this.reporter.note(
          "info",
          `跳过发送 ch${channelIndex} ${formatMessageId(command.messageId)}，count=0`,
        );
        reason = "completed";
        return;
      }

      for (let index = 0; index < command.count; index += 1) {
        this.cancellation.throwIfRequested();
        if (task.cancelled) {
          reason = task.stopReason ?? "cancelled";
          return;
        }

        await this.session.send({
          channelIndex,
          id: command.messageId,
          data: Buffer.from(command.dataBytes),
          extended: isExtendedFrame(command.messageId),
          ...(this.isCanFdChannel(channelIndex) ? { bitrateSwitch: true } : {}),
        });
        task.sentCount += 1;
        this.reporter.recordTxFrame(
          channelIndex,
          command.messageId,
          command.dataBytes,
          task.sentCount,
          command.count,
        );

        if (index < command.count - 1 && command.periodMs > 0) {
          await sleepInterruptible(command.periodMs, this.cancellation, () => task.cancelled);
        }
      }

      reason = "completed";
    } finally {
      this.reporter.sendTaskStopped(
        channelIndex,
        command.messageId,
        task.sentCount,
        command.count,
        reason,
      );
    }
  }

  private isCanFdChannel(channelIndex: number) {
    return this.configByChannelIndex.get(channelIndex)?.dataBaudRateBps !== undefined;
  }
}

class CaseRunner {
  private readonly sendTaskManager: SendTaskManager;
  private readonly configByChannelIndex: Map<number, ResolvedChannelConfig>;
  private readonly captureHub: ChannelCaptureHub;

  constructor(
    private readonly session: CanSession,
    private readonly configs: ResolvedChannelConfig[],
    private readonly reporter: OutputReporter,
    private readonly cancellation: RunnerCancellation,
    private readonly defaultReceiveTimeoutMs: number,
  ) {
    this.configByChannelIndex = new Map(
      configs.map((config) => [config.channelIndex, config]),
    );
    this.sendTaskManager = new SendTaskManager(
      session,
      configs,
      reporter,
      cancellation,
    );
    this.captureHub = new ChannelCaptureHub(
      session,
      configs.map((config) => config.channelIndex),
      reporter,
      cancellation,
    );
  }

  async run(testCase: ParsedTestCase) {
    this.reporter.caseStarted(testCase);
    this.captureHub.start();

    try {
      for (const command of testCase.commands) {
        this.cancellation.throwIfRequested();
        this.sendTaskManager.throwIfFailed();
        this.captureHub.throwIfFailed();
        await this.executeCommand(command);
      }

      this.sendTaskManager.throwIfFailed();
      this.captureHub.throwIfFailed();
      this.reporter.caseFinished(testCase, "passed");
    } catch (error) {
      if (error instanceof TesterCancellationError) {
        this.reporter.caseFinished(testCase, "cancelled");
      } else {
        this.reporter.caseFinished(
          testCase,
          "failed",
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    } finally {
      const stoppedTaskCount = await this.sendTaskManager.stopAll();
      await this.captureHub.stop();
      await this.session.clear();
      this.reporter.cleanup(
        stoppedTaskCount,
        Array.from(this.configByChannelIndex.keys()).sort((left, right) => left - right),
      );
    }
  }

  private async executeCommand(command: CaseCommand) {
    switch (command.kind) {
      case "tcans":
        await this.executeSend(command);
        break;
      case "tdelay":
        this.reporter.delay(command.delayMs);
        await sleepInterruptible(command.delayMs, this.cancellation);
        break;
      case "tcanr_direct":
        await this.executeReceiveDirect(command);
        break;
      case "tcanr_bit":
        await this.executeReceiveBit(command);
        break;
      case "tcanr_print":
        await this.executeReceivePrint(command);
        break;
    }
  }

  private async executeSend(command: ParsedSendCommand) {
    const channelIndex = this.resolveChannelIndex(
      command.channelOverride,
      command.range,
    );
    await this.sendTaskManager.start(command, channelIndex);
  }

  private async executeReceiveDirect(command: ParsedReceiveDirectCommand) {
    const channelIndex = this.resolveChannelIndex(
      command.channelOverride,
      command.range,
    );
    const frame = await this.waitForMatchingFrame(
      command,
      channelIndex,
      command.waitTimeMs,
      (receivedFrame) =>
        receivedFrame.data.length === command.expectedBytes.length &&
        receivedFrame.data.every(
          (byte, index) => byte === command.expectedBytes[index],
        ),
    );

    this.reporter.receiveMatched(channelIndex, frame.id, frame.data);
  }

  private async executeReceiveBit(command: ParsedReceiveBitCommand) {
    const channelIndex = this.resolveChannelIndex(
      command.channelOverride,
      command.range,
    );
    const frame = await this.waitForMatchingFrame(
      command,
      channelIndex,
      command.waitTimeMs,
      (receivedFrame) =>
        command.ranges.every((range, index) => {
          const actualValue = extractRangeValue(receivedFrame, range);
          return actualValue === command.expectedValues[index];
        }),
    );

    this.reporter.receiveMatched(channelIndex, frame.id, frame.data);
  }

  private async executeReceivePrint(command: ParsedReceivePrintCommand) {
    const channelIndex = this.resolveChannelIndex(
      command.channelOverride,
      command.range,
    );
    const frame = await this.waitForMatchingFrame(
      command,
      channelIndex,
      this.defaultReceiveTimeoutMs,
      () => true,
    );
    const extractedValues = command.ranges.map((range) => ({
      range: range.text,
      value: extractRangeValue(frame, range),
    }));

    this.reporter.receivePrinted(
      channelIndex,
      frame.id,
      frame.data,
      extractedValues.map((item) => `${item.range}=${item.value}`).join(" "),
    );
  }

  private async waitForMatchingFrame(
    command:
      | ParsedReceiveDirectCommand
      | ParsedReceiveBitCommand
      | ParsedReceivePrintCommand,
    channelIndex: number,
    timeoutMs: number,
    predicate: (frame: CanTransportRxFrame) => boolean,
  ): Promise<CanTransportRxFrame> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      this.cancellation.throwIfRequested();
      this.sendTaskManager.throwIfFailed();
      this.captureHub.throwIfFailed();

      const remaining = Math.max(0, deadline - Date.now());
      const frame = await this.captureHub.readNextFrame(
        channelIndex,
        Math.min(remaining, 100),
      );
      if (!frame) {
        continue;
      }

      if (frame.id !== command.messageId) {
        this.reporter.receiveIgnored(channelIndex, frame.id, frame.data);
        continue;
      }

      if (predicate(frame)) {
        return frame;
      }

      this.reporter.receiveMismatch(channelIndex, frame.id, frame.data);
    }

    throw new TesterRuntimeError(
      `等待报文超时: ch${channelIndex} ${formatMessageId(command.messageId)} (${timeoutMs}ms)`,
      command.range,
    );
  }

  private resolveChannelIndex(
    channelOverride: number | undefined,
    range: vscode.Range,
  ) {
    const resolvedChannelIndex =
      channelOverride !== undefined
        ? channelOverride
        : this.configs.length === 1
          ? this.configs[0].channelIndex
          : 0;

    if (channelOverride === undefined && this.configs.length > 1) {
      if (!this.configByChannelIndex.has(0)) {
        throw new TesterRuntimeError(
          "存在多个 tcaninit 配置且未初始化默认通道 0，tcans/tcanr 必须显式指定通道",
          range,
        );
      }
    }

    this.ensureChannelConfigured(resolvedChannelIndex, range);
    return resolvedChannelIndex;
  }

  private ensureChannelConfigured(channelIndex: number, range: vscode.Range) {
    const config = this.configByChannelIndex.get(channelIndex);
    if (!config) {
      throw new TesterRuntimeError(
        `通道 ${channelIndex} 未在 tcaninit 中初始化`,
        range,
      );
    }
    return config;
  }
}

export class TesterRunService {
  private resolvedTransport: CanTransport | undefined;
  private transportPromise: Promise<CanTransport> | undefined;

  constructor(
    private readonly parser: TesterRuntimeParser,
    private readonly output: vscode.OutputChannel,
    transport: CanTransport | undefined,
    private readonly eventSink?: RunnerEventSink,
  ) {
    this.resolvedTransport = transport;
  }

  async runTestSuite(uri: vscode.Uri, suiteStartLine: number) {
    const document = await vscode.workspace.openTextDocument(uri);
    const parsedDocument = this.parser.parseDocument(document);
    const suite = parsedDocument.suites.find(
      (currentSuite) => currentSuite.startLine === suiteStartLine,
    );

    if (!suite) {
      throw new TesterRuntimeError(`未找到起始行 ${suiteStartLine} 对应的测试集`);
    }

    await this.executeSuite(document, parsedDocument, suite);
  }

  async runTestCase(
    uri: vscode.Uri,
    suiteStartLine: number,
    caseStartLine: number,
  ) {
    const document = await vscode.workspace.openTextDocument(uri);
    const parsedDocument = this.parser.parseDocument(document);
    const suite = parsedDocument.suites.find(
      (currentSuite) => currentSuite.startLine === suiteStartLine,
    );

    if (!suite) {
      throw new TesterRuntimeError(`未找到起始行 ${suiteStartLine} 对应的测试集`);
    }

    const testCase = suite.cases.find(
      (currentCase) => currentCase.startLine === caseStartLine,
    );
    if (!testCase) {
      throw new TesterRuntimeError(`未找到起始行 ${caseStartLine} 对应的测试用例`);
    }

    await this.executeSingleCase(document, parsedDocument, suite, testCase);
  }

  private async executeSuite(
    document: vscode.TextDocument,
    parsedDocument: ParsedTestDocument,
    suite: ParsedTestSuite,
  ) {
    this.ensureRunnable(document, parsedDocument.configuration);

    const reporter = new OutputReporter(this.output, this.eventSink);
    reporter.show();
    reporter.runStarted("suite", suite.title, suite.cases.length);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: `运行测试集: ${suite.title}`,
      },
      async (progress, token) => {
        const cancellation = new RunnerCancellation(token);
        let session: CanSession | undefined;
        let passedCount = 0;
        let failedCount = 0;
        let status: "passed" | "failed" | "cancelled" = "passed";
        const transport = await this.getTransport();

        try {
          session = await transport.open(parsedDocument.configuration);
          for (const [index, testCase] of suite.cases.entries()) {
            progress.report({
              message: `${index + 1}/${suite.cases.length} ${caseLabel(testCase)}`,
            });

            try {
              const caseRunner = new CaseRunner(
                session,
                parsedDocument.configuration,
                reporter,
                cancellation,
                this.getDefaultReceiveTimeoutMs(),
              );
              await caseRunner.run(testCase);
              passedCount += 1;
            } catch (error) {
              if (error instanceof TesterCancellationError) {
                status = "cancelled";
                throw error;
              }

              failedCount += 1;
            }
          }
          if (failedCount > 0) {
            status = "failed";
          }
        } catch (error) {
          if (!(error instanceof TesterCancellationError)) {
            status = "failed";
            if (passedCount === 0 && failedCount === 0) {
              failedCount = 1;
            }
          }
          throw error;
        } finally {
          if (session) {
            await session.close();
          }
          reporter.runFinished(
            "suite",
            suite.title,
            passedCount,
            failedCount,
            status,
          );
        }

        const summary = `${suite.title} 执行完成，通过 ${passedCount}，失败 ${failedCount}`;

        if (failedCount > 0) {
          void vscode.window.showWarningMessage(summary);
        } else {
          void vscode.window.showInformationMessage(summary);
        }
      },
    );
  }

  private async executeSingleCase(
    document: vscode.TextDocument,
    parsedDocument: ParsedTestDocument,
    suite: ParsedTestSuite,
    testCase: ParsedTestCase,
  ) {
    this.ensureRunnable(document, parsedDocument.configuration);

    const reporter = new OutputReporter(this.output, this.eventSink);
    reporter.show();
    reporter.runStarted("case", testCase.label, 1);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: `运行测试用例: ${caseLabel(testCase)}`,
      },
      async (progress, token) => {
        progress.report({ message: suite.title });
        const cancellation = new RunnerCancellation(token);
        let session: CanSession | undefined;
        let status: "passed" | "failed" | "cancelled" = "passed";
        const transport = await this.getTransport();

        try {
          session = await transport.open(parsedDocument.configuration);
          const caseRunner = new CaseRunner(
            session,
            parsedDocument.configuration,
            reporter,
            cancellation,
            this.getDefaultReceiveTimeoutMs(),
          );
          await caseRunner.run(testCase);
        } catch (error) {
          status =
            error instanceof TesterCancellationError ? "cancelled" : "failed";
          throw error;
        } finally {
          if (session) {
            await session.close();
          }
          reporter.runFinished(
            "case",
            testCase.label,
            status === "passed" ? 1 : 0,
            status === "failed" ? 1 : 0,
            status,
          );
        }
      },
    );

    void vscode.window.showInformationMessage(
      `测试用例通过: ${caseLabel(testCase)}`,
    );
  }

  private ensureRunnable(
    document: vscode.TextDocument,
    configs: ResolvedChannelConfig[],
  ) {
    if (configs.length === 0) {
      throw new TesterRuntimeError(
        `文件 ${document.fileName} 中缺少 tcaninit 配置`,
      );
    }
  }

  private getDefaultReceiveTimeoutMs() {
    return vscode.workspace
      .getConfiguration("tester")
      .get<number>("execution.defaultReceiveTimeoutMs", 3000);
  }

  private formatError(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private async getTransport() {
    if (this.resolvedTransport) {
      return this.resolvedTransport;
    }

    if (!this.transportPromise) {
      this.transportPromise = createDefaultTransport().then((transport) => {
        this.resolvedTransport = transport;
        return transport;
      });
    }

    return this.transportPromise;
  }
}
