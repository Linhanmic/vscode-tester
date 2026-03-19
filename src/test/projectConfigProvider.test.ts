import * as assert from "assert";
import * as vscode from "vscode";
import type { ProjectConfigSnapshot } from "../projectConfig/types";
import { TesterProjectConfigProvider } from "../providers/projectConfigProvider";

class MockProjectConfigService {
  private readonly emitter = new vscode.EventEmitter<ProjectConfigSnapshot>();
  refreshCalls = 0;

  constructor(private readonly snapshot: ProjectConfigSnapshot) {}

  get onDidChangeSnapshot(): vscode.Event<ProjectConfigSnapshot> {
    return this.emitter.event;
  }

  getSnapshot() {
    return this.snapshot;
  }

  async refresh() {
    this.refreshCalls += 1;
  }
}

suite("TesterProjectConfigProvider", () => {
  test("未初始化语法服务时仍生成基础界面", () => {
    const provider = new TesterProjectConfigProvider(
      new MockProjectConfigService({
        status: {
          state: "parser-unavailable",
          message: "语法服务尚未初始化，当前无法读取配置块",
          canEdit: false,
          canCreateConfigBlock: false,
          canTakeOver: false,
        },
        documentPath: "demo.tester",
        hasConfigurationBlock: false,
        channels: [],
        diagnose: {},
        dtcs: [],
        dbcStatus: {
          state: "unloaded",
          message: "当前未加载 DBC 文件",
          path: undefined,
        },
        dbcConfiguredPath: "",
        availableDbcFiles: [],
        isSingleDevice: true,
        deviceLabel: "未配置设备",
      }) as any,
    );

    const html = (provider as any).getHtml({} as vscode.Webview) as string;
    assert.ok(html.includes("正在加载项目配置"));
    assert.ok(html.includes('id="app"'));
    assert.ok(html.includes('type: "ready"'));
  });

  test("refresh 消息会转发给服务层", async () => {
    const service = new MockProjectConfigService({
      status: {
        state: "managed",
        message: "当前配置块已接入侧边栏，可直接编辑",
        canEdit: true,
        canCreateConfigBlock: false,
        canTakeOver: false,
      },
      documentPath: "demo.tester",
      hasConfigurationBlock: true,
      channels: [],
      diagnose: {},
      dtcs: [],
      dbcStatus: {
        state: "unloaded",
        message: "当前未加载 DBC 文件",
        path: undefined,
      },
      dbcConfiguredPath: "",
      availableDbcFiles: [],
      isSingleDevice: true,
      deviceLabel: "device 41 / 0",
    });
    const provider = new TesterProjectConfigProvider(service as any);

    await (provider as any).handleMessage({ type: "refresh" });
    assert.strictEqual(service.refreshCalls, 1);
  });
});
