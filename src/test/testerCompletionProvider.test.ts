import * as assert from "assert";
import * as vscode from "vscode";
import { TreeManager } from "../parser/treeManager";
import { TesterCompletionProvider } from "../providers/completionProvider";

suite("TesterCompletionProvider", () => {
  test("上一行注释优先作为补全标签，插入文本只保留命令主体", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: ["// 发动机状态", "tcans 1,100,11-22,10,1"].join("\n"),
    });
    const provider = new TesterCompletionProvider({} as TreeManager);
    const commandLine = document.lineAt(1).text;
    const start = document.offsetAt(new vscode.Position(1, 0));
    const end = document.offsetAt(new vscode.Position(1, commandLine.length));
    const fakeNode = {
      type: "tcans_command",
      startIndex: start,
      endIndex: end,
      endPosition: { column: commandLine.length },
    };

    const commandInfo = (provider as any).parseCommandNode(fakeNode, document);

    assert.ok(commandInfo);
    assert.strictEqual(commandInfo.label, "发动机状态");
    assert.strictEqual(commandInfo.detail, "tcans 1,100,11-22,10,1");
    assert.strictEqual(commandInfo.insertText, "1,100,11-22,10,1");
    assert.strictEqual(commandInfo.insertText.includes("//"), false);
  });
});
