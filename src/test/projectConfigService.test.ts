import * as assert from "assert";
import * as vscode from "vscode";
import { DbcManager } from "../dbc/dbcManager";
import { loadLanguage } from "../parser/testerParser";
import { TreeManager } from "../parser/treeManager";
import { ProjectConfigService } from "../projectConfig/projectConfigService";
import { DbcWorkspaceService } from "../studio/dbcWorkspaceService";

function createExtensionContext() {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

suite("ProjectConfigService", () => {
  test("可从当前活动 Tester 文档提取受管配置块", async () => {
    await loadLanguage();

    const context = createExtensionContext();
    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: [
        "tset",
        "  tcaninit 41,0,0,500,2000",
        "  tdiagnose_rid 0x7A1",
        "  tdiagnose_sid 7A9",
        "  tdiagnose_keyk 10086",
        "  tdiagnose_dtc C10087,发动机过热",
        "tend",
      ].join("\n"),
    });
    await vscode.window.showTextDocument(document);

    const dbcManager = new DbcManager(context);
    const dbcWorkspaceService = new DbcWorkspaceService(dbcManager);
    const service = new ProjectConfigService(
      context,
      dbcManager,
      dbcWorkspaceService,
    );
    service.setTreeManager(new TreeManager(context));
    await service.refresh();

    const snapshot = service.getSnapshot();
    assert.strictEqual(snapshot.status.state, "managed");
    assert.strictEqual(snapshot.channels.length, 1);
    assert.strictEqual(snapshot.channels[0].deviceId, 41);
    assert.strictEqual(snapshot.channels[0].channelIndex, 0);
    assert.strictEqual(snapshot.diagnose.responseId, "0x7A1");
    assert.strictEqual(snapshot.diagnose.requestId, "7A9");
    assert.strictEqual(snapshot.diagnose.keyk, "10086");
    assert.strictEqual(snapshot.dtcs.length, 1);
    assert.strictEqual(snapshot.dtcs[0].description, "发动机过热");

    service.dispose();
  });

  test("配置块含注释时进入只读保护状态", async () => {
    await loadLanguage();

    const context = createExtensionContext();
    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: ["tset", "  // 注释", "  tcaninit 41,0,0,500", "tend"].join("\n"),
    });
    await vscode.window.showTextDocument(document);

    const dbcManager = new DbcManager(context);
    const dbcWorkspaceService = new DbcWorkspaceService(dbcManager);
    const service = new ProjectConfigService(
      context,
      dbcManager,
      dbcWorkspaceService,
    );
    service.setTreeManager(new TreeManager(context));
    await service.refresh();

    const snapshot = service.getSnapshot();
    assert.strictEqual(snapshot.status.state, "unmanaged");
    assert.strictEqual(snapshot.status.canTakeOver, true);

    service.dispose();
  });

  test("无配置块时可创建标准 tset", async () => {
    await loadLanguage();

    const context = createExtensionContext();
    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: ["ttitle=套件", "  tstart=用例", "  tend", "ttitle-end"].join("\n"),
    });
    await vscode.window.showTextDocument(document);

    const dbcManager = new DbcManager(context);
    const dbcWorkspaceService = new DbcWorkspaceService(dbcManager);
    const service = new ProjectConfigService(
      context,
      dbcManager,
      dbcWorkspaceService,
    );
    service.setTreeManager(new TreeManager(context));
    await service.refresh();

    assert.strictEqual(service.getSnapshot().status.canCreateConfigBlock, true);
    await service.createConfigBlock();

    assert.ok(document.getText().startsWith("tset\ntend\n\n"));
    service.dispose();
  });
});
