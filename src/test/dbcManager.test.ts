import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { DbcManager } from "../dbc/dbcManager";
import {
  formatSignalLocation,
  isDecodedDisplayError,
} from "../dbc/displayModel";

function createExtensionContext() {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

async function withDbcManager(
  dbcContent: string,
  callback: (manager: DbcManager) => Promise<void>,
) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbc-manager-"));
  const dbcPath = path.join(tempDir, "test.dbc");
  await fs.writeFile(dbcPath, dbcContent, "utf8");

  try {
    const manager = new DbcManager(createExtensionContext());
    await manager.loadDbcFile(dbcPath);
    await callback(manager);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

suite("DbcManager", () => {
  test("保留 UTF-8 DBC 中的中文描述", async () => {
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

    await withDbcManager(dbcContent, async (manager) => {
      assert.strictEqual(manager.isLoaded(), true);
      assert.strictEqual(manager.getStatus().state, "loaded");

      const dbcData = manager.getDbcData();
      if (!dbcData) {
        throw new Error("DBC 数据未加载");
      }
      const message = dbcData.messages.get("Msg");

      assert.ok(message);
      assert.strictEqual(message.description, "中文报文");
      assert.strictEqual(message.signals.get("Sig")?.description, "中文信号");
    });
  });

  test("标准复用信号只返回当前生效分支", async () => {
    const dbcContent = [
      'VERSION ""',
      "",
      "NS_ :",
      "BS_:",
      "BU_: ECU",
      "",
      "BO_ 100 TestMux: 3 ECU",
      ' SG_ Mode M : 0|8@1+ (1,0) [0|255] "" ECU',
      ' SG_ Base : 8|8@1+ (1,0) [0|255] "" ECU',
      ' SG_ SigA m0 : 16|8@1+ (1,0) [0|255] "" ECU',
      ' SG_ SigB m1 : 16|8@1+ (1,0) [0|255] "" ECU',
      'CM_ SG_ 100 SigA "支路 A";',
      'CM_ SG_ 100 SigB "支路 B";',
    ].join("\n");

    await withDbcManager(dbcContent, async (manager) => {
      const result = manager.decodeMessageForDisplay(100, [1, 0x22, 0x33]);
      assert.strictEqual(isDecodedDisplayError(result), false);

      if (isDecodedDisplayError(result)) {
        return;
      }

      assert.strictEqual(result.multiplexerName, "Mode");
      assert.strictEqual(result.multiplexerValue, 1);
      assert.deepStrictEqual(
        result.signals.map((signal) => signal.name),
        ["Mode", "Base", "SigB"],
      );
      assert.strictEqual(
        result.signals.find((signal) => signal.name === "SigB")?.multiplexTag,
        "m1",
      );
    });
  });

  test("SG_MUL_VAL_ 复用映射可命中当前分支", async () => {
    const dbcContent = [
      'VERSION ""',
      "",
      "NS_ :",
      "BS_:",
      "BU_: ECU",
      "",
      "BO_ 200 ExtMux: 3 ECU",
      ' SG_ Switch M : 0|8@1+ (1,0) [0|255] "" ECU',
      ' SG_ Child : 16|8@1+ (1,0) [0|255] "" ECU',
      ' SG_ Other : 16|8@1+ (1,0) [0|255] "" ECU',
      "SG_MUL_VAL_ 200 Child Switch 2-3;",
      "SG_MUL_VAL_ 200 Other Switch 4-4;",
    ].join("\n");

    await withDbcManager(dbcContent, async (manager) => {
      const result = manager.decodeMessageForDisplay(200, [3, 0x00, 0x55]);
      assert.strictEqual(isDecodedDisplayError(result), false);

      if (isDecodedDisplayError(result)) {
        return;
      }

      assert.deepStrictEqual(
        result.signals.map((signal) => signal.name),
        ["Switch", "Child"],
      );
      assert.strictEqual(
        result.signals.find((signal) => signal.name === "Child")?.multiplexTag,
        "m3",
      );
    });
  });

  test("可返回 DBC 未加载、报文不存在和 DLC 不匹配错误", async () => {
    const unloaded = new DbcManager(createExtensionContext());
    assert.strictEqual(unloaded.getStatus().state, "unloaded");
    const unloadedResult = unloaded.getMessageDefinition(0x100);
    assert.strictEqual(isDecodedDisplayError(unloadedResult), true);
    if (isDecodedDisplayError(unloadedResult)) {
      assert.strictEqual(unloadedResult.code, "dbc_not_loaded");
    }

    const dbcContent = [
      'VERSION ""',
      "",
      "NS_ :",
      "BS_:",
      "BU_: ECU",
      "",
      "BO_ 256 Msg: 2 ECU",
      ' SG_ Sig : 0|8@1+ (1,0) [0|255] "" ECU',
    ].join("\n");

    await withDbcManager(dbcContent, async (manager) => {
      const notFound = manager.getMessageDefinition(0x999);
      assert.strictEqual(isDecodedDisplayError(notFound), true);
      if (isDecodedDisplayError(notFound)) {
        assert.strictEqual(notFound.code, "message_not_found");
      }

      const mismatch = manager.decodeMessageForDisplay(256, [0x01]);
      assert.strictEqual(isDecodedDisplayError(mismatch), true);
      if (isDecodedDisplayError(mismatch)) {
        assert.strictEqual(mismatch.code, "payload_length_mismatch");
        assert.strictEqual(mismatch.expectedDlc, 2);
        assert.strictEqual(mismatch.actualDlc, 1);
      }

      assert.strictEqual(manager.getStatus().state, "loaded");
    });
  });
});

suite("displayModel", () => {
  test("位置信息格式覆盖 Intel 和 Motorola", () => {
    const intelSingle = formatSignalLocation({
      startBit: 0,
      length: 8,
      endian: "Intel",
    } as any);
    const intelCross = formatSignalLocation({
      startBit: 6,
      length: 5,
      endian: "Intel",
    } as any);
    const motorolaSingle = formatSignalLocation({
      startBit: 8,
      length: 8,
      endian: "Motorola",
    } as any);
    const motorolaCross = formatSignalLocation({
      startBit: 9,
      length: 8,
      endian: "Motorola",
    } as any);

    assert.strictEqual(intelSingle, "1.0-1.7");
    assert.strictEqual(intelCross, "1.6-2.2");
    assert.strictEqual(motorolaSingle, "2.0-2.7");
    assert.strictEqual(motorolaCross, "1.0-2.7");
  });
});
