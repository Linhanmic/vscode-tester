import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { DbcManager } from "../dbc/dbcManager";
import { TreeManager } from "../parser/treeManager";
import { TesterHoverProvider } from "../providers/hoverProvider";

function createExtensionContext() {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

async function withHoverProvider(
  dbcContent: string,
  callback: (provider: TesterHoverProvider) => Promise<void>,
) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hover-provider-"));
  const dbcPath = path.join(tempDir, "test.dbc");
  await fs.writeFile(dbcPath, dbcContent, "utf8");

  try {
    const manager = new DbcManager(createExtensionContext());
    await manager.loadDbcFile(dbcPath);
    const provider = new TesterHoverProvider({} as TreeManager, manager);
    await callback(provider);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

suite("TesterHoverProvider", () => {
  test("完整 payload hover 使用单表展示，并过滤未生效复用分支", async () => {
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
      'CM_ SG_ 100 SigB "支路 B";',
    ].join("\n");

    await withHoverProvider(dbcContent, async (provider) => {
      const markdown = (provider as any).buildFullDecodeMarkdown({
        messageId: 100,
        dataBytes: [1, 0x22, 0x33],
        nodeType: "tcans_command",
      }) as vscode.MarkdownString;

      assert.ok(
        markdown.value.includes("| 类型 | 信号名 | 描述 | 位置 | 解析值 |"),
      );
      assert.ok(markdown.value.includes("复用摘要"));
      assert.ok(markdown.value.includes("m1"));
      assert.ok(markdown.value.includes("SigB"));
      assert.ok(markdown.value.includes("支路 B"));
      assert.ok(markdown.value.includes("复用器"));
      assert.ok(markdown.value.includes("当前分支"));
      assert.ok(markdown.value.includes("基础"));
      assert.ok(!markdown.value.includes("复用结构"));
      assert.ok(!markdown.value.includes("基础信号"));
      assert.ok(!markdown.value.includes("SigA"));
      assert.ok(markdown.value.includes("`1.0-1.7=0x1`"));
      assert.ok(markdown.value.includes("`2.0-2.7=0x22`"));
      assert.ok(markdown.value.includes("`3.0-3.7=0x33`"));
      assert.ok(markdown.value.includes("| 基础 | `Base` | - | `2.0-2.7=0x22` | 34 |"));

      const multiplexerIndex = markdown.value.indexOf("Mode");
      const multiplexedIndex = markdown.value.indexOf("SigB");
      const baseIndex = markdown.value.indexOf("Base");
      assert.ok(multiplexerIndex >= 0);
      assert.ok(multiplexedIndex > multiplexerIndex);
      assert.ok(baseIndex > multiplexedIndex);
    });
  });

  test("无 payload hover 仍可展示报文定义", async () => {
    const dbcContent = [
      'VERSION ""',
      "",
      "NS_ :",
      "BS_:",
      "BU_: ECU",
      "",
      "BO_ 256 PrintMsg: 2 ECU",
      ' SG_ Sig : 0|8@1+ (1,0) [0|255] "" ECU',
      'CM_ BO_ 256 "打印报文";',
      'CM_ SG_ 256 Sig "打印信号";',
    ].join("\n");

    await withHoverProvider(dbcContent, async (provider) => {
      const markdown = (provider as any).buildMessageInfoMarkdown({
        messageId: 256,
        bitRange: "0.0-0.7",
        nodeType: "tcanr_print_command",
      }) as vscode.MarkdownString;

      assert.ok(markdown.value.includes("模式"));
      assert.ok(markdown.value.includes("PrintMsg"));
      assert.ok(markdown.value.includes("打印报文"));
      assert.ok(markdown.value.includes("| 类型 | 信号名 | 描述 | 位置 | 解析值 |"));
      assert.ok(markdown.value.includes("打印信号"));
      assert.ok(markdown.value.includes("| 基础 |"));
      assert.ok(markdown.value.includes("| - |"));
      assert.ok(markdown.value.includes("`1.0-1.7`"));
    });
  });
});
