import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { DbcManager } from "../dbc/dbcManager";

suite("DbcManager", () => {
  test("保留 UTF-8 DBC 中的中文描述", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbc-manager-"));
    const dbcPath = path.join(tempDir, "utf8.dbc");
    const dbcContent = [
      'VERSION ""',
      "",
      "NS_ :",
      "BS_:",
      "BU_: Vector__XXX",
      "",
      "BO_ 256 Msg: 8 Vector__XXX",
      ' SG_ Sig : 0|8@1+ (1,0) [0|255] "" Vector__XXX',
      "",
      'CM_ BO_ 256 "中文报文";',
      'CM_ SG_ 256 Sig "中文信号";',
    ].join("\n");

    await fs.writeFile(dbcPath, dbcContent, "utf8");

    try {
      const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      const manager = new DbcManager(context);
      await manager.loadDbcFile(dbcPath);

      assert.strictEqual(manager.isLoaded(), true);

      const dbcData = (manager as any).dbcData;
      const message = dbcData.messages.get("Msg");

      assert.ok(message);
      assert.strictEqual(message.description, "中文报文");
      assert.strictEqual(message.signals.get("Sig")?.description, "中文信号");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
