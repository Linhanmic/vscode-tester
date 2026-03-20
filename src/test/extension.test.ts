import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
  test("运行命令已注册", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("tester.openStudio"));
    assert.ok(commands.includes("tester.runTestSuite"));
    assert.ok(commands.includes("tester.runTestCase"));
    assert.ok(commands.includes("tester.runTestCommand"));
    assert.ok(commands.includes("tester.busMonitor.clear"));
  });
});
