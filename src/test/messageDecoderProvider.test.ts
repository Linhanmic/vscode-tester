import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { DbcManager } from "../dbc/dbcManager";
import { TesterMessageDecoderProvider } from "../providers/messageDecoderProvider";

function createExtensionContext() {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

async function withDbcManager(
  dbcContent: string,
  callback: (manager: DbcManager) => Promise<void>,
) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "message-decoder-provider-"),
  );
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

suite("TesterMessageDecoderProvider", () => {
  test("未加载 DBC 时仍生成输入界面和状态区域", () => {
    const provider = new TesterMessageDecoderProvider(
      new DbcManager(createExtensionContext()),
    );

    const html = (provider as any).getHtml({} as vscode.Webview) as string;
    assert.ok(html.includes('id="decodeInput"'));
    assert.ok(html.includes('id="statusBadge"'));
    assert.ok(html.includes('id="statusText"'));
    assert.ok(html.includes('id="statusPath"'));
    assert.ok(html.includes('button id="decodeBtn" type="button" disabled'));
  });

  test("状态消息可区分未加载和已加载 DBC", async () => {
    const provider = new TesterMessageDecoderProvider(
      new DbcManager(createExtensionContext()),
    );
    const postedMessages: unknown[] = [];
    (provider as any).view = {
      webview: {
        postMessage: async (message: unknown) => {
          postedMessages.push(message);
          return true;
        },
      },
    };

    (provider as any).postStatus();
    const unloadedMessage = postedMessages[0] as any;
    assert.strictEqual(unloadedMessage.type, "status");
    assert.strictEqual(unloadedMessage.status.state, "unloaded");
    assert.strictEqual(unloadedMessage.status.canDecode, false);

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
      const loadedProvider = new TesterMessageDecoderProvider(manager);
      const loadedMessages: unknown[] = [];
      (loadedProvider as any).view = {
        webview: {
          postMessage: async (message: unknown) => {
            loadedMessages.push(message);
            return true;
          },
        },
      };

      (loadedProvider as any).postStatus();
      const loadedMessage = loadedMessages[0] as any;
      assert.strictEqual(loadedMessage.type, "status");
      assert.strictEqual(loadedMessage.status.state, "loaded");
      assert.strictEqual(loadedMessage.status.canDecode, true);
      assert.ok(String(loadedMessage.status.path).endsWith("test.dbc"));
    });
  });
});
