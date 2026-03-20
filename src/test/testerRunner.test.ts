import * as assert from "assert";
import * as vscode from "vscode";
import { TreeManager } from "../parser/treeManager";
import { loadLanguage } from "../parser/testerParser";
import { TesterRuntimeParser } from "../runtime/parser";
import { TesterRunService } from "../runtime/runner";
import {
  CanSession,
  CanTransport,
  CanTransportFrame,
  CanTransportRxFrame,
  ResolvedChannelConfig,
} from "../runtime/types";

class FakeSession implements CanSession {
  readonly sentFrames: CanTransportFrame[] = [];
  readonly clearCalls: Array<number | undefined> = [];
  readonly readQueue: Array<CanTransportRxFrame | null> = [];
  closeCalls = 0;

  async send(frame: CanTransportFrame): Promise<void> {
    this.sentFrames.push({
      ...frame,
      data: Buffer.from(frame.data),
    });
  }

  async read(): Promise<CanTransportRxFrame | null> {
    return this.readQueue.shift() ?? null;
  }

  async clear(channelIndex?: number): Promise<void> {
    this.clearCalls.push(channelIndex);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

class FakeTransport implements CanTransport {
  readonly session = new FakeSession();
  openedConfigs: ResolvedChannelConfig[] = [];

  async open(configs: ResolvedChannelConfig[]): Promise<CanSession> {
    this.openedConfigs = configs;
    return this.session;
  }
}

suite("TesterRunService", () => {
  test("同一用例内同 ID 的 tcans 会被后续命令顶替，结束后会清缓冲", async () => {
    await loadLanguage();

    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: [
        "tset",
        "  tcaninit 4,0,0,500,2000",
        "tend",
        "",
        "ttitle=套件",
        "  tstart=用例一",
        "    tcans 18FF0012,11-22-33-44,50,3",
        "    tcans 18FF0012,AA-BB-CC-DD,0,1",
        "    tcanr 18FF0013,11-22-33-44,10",
        "  tend",
        "ttitle-end",
      ].join("\n"),
    });

    const treeManager = new TreeManager({
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);
    const parser = new TesterRuntimeParser(treeManager);
    const fakeTransport = new FakeTransport();
    fakeTransport.session.readQueue.push({
      channelIndex: 0,
      id: 0x18ff0013,
      data: Buffer.from([0x11, 0x22, 0x33, 0x44]),
      extended: true,
      remote: false,
      fd: true,
      timestampUs: 0,
      bitrateSwitch: true,
      errorStateIndicator: false,
    });

    const outputChannel = vscode.window.createOutputChannel("Tester Runner Test");
    const service = new TesterRunService(parser, outputChannel, fakeTransport);
    await service.runTestCase(document.uri, 4, 5);

    assert.strictEqual(fakeTransport.openedConfigs.length, 1);
    assert.ok(fakeTransport.session.sentFrames.length >= 2);
    assert.deepStrictEqual(
      Array.from(fakeTransport.session.sentFrames[0].data),
      [0x11, 0x22, 0x33, 0x44],
    );
    assert.deepStrictEqual(
      Array.from(fakeTransport.session.sentFrames.at(-1)?.data ?? []),
      [0xaa, 0xbb, 0xcc, 0xdd],
    );
    assert.ok(fakeTransport.session.clearCalls.length >= 1);
    assert.strictEqual(fakeTransport.session.closeCalls, 1);
  });

  test("经典 CAN 通道发送时不应附带 CAN FD 标志", async () => {
    await loadLanguage();

    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: [
        "tset",
        "  tcaninit 41,0,0,500",
        "tend",
        "",
        "ttitle=套件",
        "  tstart=经典CAN",
        "    tcans 18FF0012,11-22-33-44,0,1",
        "  tend",
        "ttitle-end",
      ].join("\n"),
    });

    const treeManager = new TreeManager({
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);
    const parser = new TesterRuntimeParser(treeManager);
    const fakeTransport = new FakeTransport();
    const outputChannel = vscode.window.createOutputChannel("Tester Runner Test");
    const service = new TesterRunService(parser, outputChannel, fakeTransport);

    await service.runTestCase(document.uri, 4, 5);

    assert.strictEqual(fakeTransport.session.sentFrames.length, 1);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(
        fakeTransport.session.sentFrames[0],
        "bitrateSwitch",
      ),
      false,
    );
  });

  test("运行到命令时应从用例起点执行到目标命令并在该处停止", async () => {
    await loadLanguage();

    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: [
        "tset",
        "  tcaninit 41,0,0,500,2000",
        "tend",
        "",
        "ttitle=套件",
        "  tstart=用例一",
        "    tcans 18FF0012,11-22-33-44,0,1",
        "    tdelay 1",
        "    tcanr 18FF0013,11-22-33-44,10",
        "    tcans 18FF0014,AA-BB-CC-DD,0,1",
        "  tend",
        "ttitle-end",
      ].join("\n"),
    });

    const treeManager = new TreeManager({
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);
    const parser = new TesterRuntimeParser(treeManager);
    const fakeTransport = new FakeTransport();
    fakeTransport.session.readQueue.push({
      channelIndex: 0,
      id: 0x18ff0013,
      data: Buffer.from([0x11, 0x22, 0x33, 0x44]),
      extended: true,
      remote: false,
      fd: true,
      timestampUs: 0,
      bitrateSwitch: true,
      errorStateIndicator: false,
    });

    const outputChannel = vscode.window.createOutputChannel("Tester Runner Test");
    const service = new TesterRunService(parser, outputChannel, fakeTransport);

    await service.runTestCommand(document.uri, 4, 5, 8);

    assert.strictEqual(fakeTransport.session.sentFrames.length, 1);
    assert.strictEqual(fakeTransport.session.sentFrames[0].id, 0x18ff0012);
    assert.strictEqual(fakeTransport.session.closeCalls, 1);
  });

  test("多个 tcaninit 时未显式写通道默认使用通道 0", async () => {
    await loadLanguage();

    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: [
        "tset",
        "  tcaninit 41,0,0,500,2000",
        "  tcaninit 41,0,1,500,2000",
        "tend",
        "",
        "ttitle=套件",
        "  tstart=默认通道",
        "    tcans 18FF0012,11-22-33-44,0,1",
        "    tcanr 18FF0013,11-22-33-44,10",
        "  tend",
        "ttitle-end",
      ].join("\n"),
    });

    const treeManager = new TreeManager({
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);
    const parser = new TesterRuntimeParser(treeManager);
    const fakeTransport = new FakeTransport();
    fakeTransport.session.readQueue.push({
      channelIndex: 0,
      id: 0x18ff0013,
      data: Buffer.from([0x11, 0x22, 0x33, 0x44]),
      extended: true,
      remote: false,
      fd: true,
      timestampUs: 0,
      bitrateSwitch: true,
      errorStateIndicator: false,
    });

    const outputChannel = vscode.window.createOutputChannel("Tester Runner Test");
    const service = new TesterRunService(parser, outputChannel, fakeTransport);

    await service.runTestCase(document.uri, 5, 6);

    assert.strictEqual(fakeTransport.session.sentFrames.length, 1);
    assert.strictEqual(fakeTransport.session.sentFrames[0].channelIndex, 0);
  });

  test("多个 tcaninit 且未初始化通道 0 时省略通道会报错", async () => {
    await loadLanguage();

    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: [
        "tset",
        "  tcaninit 41,0,1,500,2000",
        "  tcaninit 41,0,2,500,2000",
        "tend",
        "",
        "ttitle=套件",
        "  tstart=缺少默认通道",
        "    tcans 18FF0012,11-22-33-44,0,1",
        "  tend",
        "ttitle-end",
      ].join("\n"),
    });

    const treeManager = new TreeManager({
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);
    const parser = new TesterRuntimeParser(treeManager);
    const fakeTransport = new FakeTransport();
    const outputChannel = vscode.window.createOutputChannel("Tester Runner Test");
    const service = new TesterRunService(parser, outputChannel, fakeTransport);

    await assert.rejects(
      () => service.runTestCase(document.uri, 5, 6),
      (error: unknown) =>
        error instanceof Error &&
        error.message ===
          "存在多个 tcaninit 配置且未初始化默认通道 0，tcans/tcanr 必须显式指定通道",
    );
  });
});
