import * as assert from "assert";
import * as vscode from "vscode";
import type { DeviceManagerSnapshot } from "../deviceManager/types";
import { TesterDeviceManagerProvider } from "../providers/deviceManagerProvider";

class MockDeviceManagerService {
  private readonly emitter = new vscode.EventEmitter<DeviceManagerSnapshot>();
  refreshCount = 0;

  constructor(private readonly snapshot: DeviceManagerSnapshot) {}

  get onDidChangeSnapshot(): vscode.Event<DeviceManagerSnapshot> {
    return this.emitter.event;
  }

  getSnapshot() {
    return this.snapshot;
  }

  async startTask() {}

  async stopTask() {}
}

suite("TesterDeviceManagerProvider", () => {
  test("未连接运行器时仍生成基础界面", () => {
    const provider = new TesterDeviceManagerProvider(
      new MockDeviceManagerService({
        status: {
          state: "driver-unavailable",
          message: "驱动不可用：缺少运行时",
          canSend: false,
        },
        documentPath: "demo.tester",
        deviceLabel: "device 41 / 0",
        channels: [],
        activeTasks: [],
      }) as any,
    );

    const html = (provider as any).getHtml() as string;
    assert.ok(html.includes("正在加载设备管理"));
    assert.ok(html.includes('id="app"'));
    assert.ok(html.includes('type: "ready"'));
  });

  test("快照会被推送到 webview", async () => {
    const provider = new TesterDeviceManagerProvider(
      new MockDeviceManagerService({
        status: {
          state: "ready",
          message: "可直接基于当前脚本通道发起临时发送，首次发送时会检查驱动",
          canSend: true,
        },
        documentPath: "demo.tester",
        deviceLabel: "device 41 / 0",
        channels: [],
        activeTasks: [],
      }) as any,
    );
    const messages: unknown[] = [];

    (provider as any).view = {
      webview: {
        postMessage: async (message: unknown) => {
          messages.push(message);
          return true;
        },
      },
    };

    (provider as any).postSnapshot();
    assert.strictEqual((messages[0] as any).type, "snapshot");
    assert.strictEqual((messages[0] as any).snapshot.documentPath, "demo.tester");
  });
});
