import * as assert from "assert";
import * as vscode from "vscode";
import { TreeManager } from "../parser/treeManager";
import { loadLanguage } from "../parser/testerParser";
import { TesterCodeLensProvider } from "../providers/codeLensProvider";
import { TesterRuntimeParser } from "../runtime/parser";

suite("TesterRuntimeParser", () => {
  test("tcaninit 使用 kbps 并换算为 bps", async () => {
    await loadLanguage();

    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: [
        "tset",
        "  tcaninit 4,0,0,500,2000",
        "tend",
        "",
        "ttitle=套件",
        "  1 tstart=用例一",
        "    tcans 18FF0012,11-22-33-44,100,1",
        "    tcanr 18FF0013,11-22-33-44,3000",
        "    tdelay 500",
        "  tend",
        "ttitle-end",
      ].join("\n"),
    });

    const treeManager = new TreeManager({
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);
    const parser = new TesterRuntimeParser(treeManager);
    const parsedDocument = parser.parseDocument(document);

    assert.strictEqual(parsedDocument.configuration.length, 1);
    assert.strictEqual(parsedDocument.configuration[0].arbitrationBaudRateKbps, 500);
    assert.strictEqual(parsedDocument.configuration[0].arbitrationBaudRateBps, 500000);
    assert.strictEqual(parsedDocument.configuration[0].dataBaudRateKbps, 2000);
    assert.strictEqual(parsedDocument.configuration[0].dataBaudRateBps, 2000000);
    assert.strictEqual(parsedDocument.suites.length, 1);
    assert.strictEqual(parsedDocument.suites[0].cases.length, 1);
    assert.strictEqual(parsedDocument.suites[0].cases[0].commands.length, 3);
  });

  test("明显按 bps 填写的波特率会报友好错误", async () => {
    await loadLanguage();

    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: ["tset", "  tcaninit 4,0,0,500000,2000000", "tend"].join("\n"),
    });

    const treeManager = new TreeManager({
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);
    const parser = new TesterRuntimeParser(treeManager);

    assert.throws(
      () => parser.parseDocument(document),
      /单位是 kbps，请写成 500 而不是 500000/,
    );
  });

  test("已收口的 USBCANFD 设备支持手册中的固定波特率", async () => {
    await loadLanguage();

    for (const deviceId of [41, 59]) {
      const document = await vscode.workspace.openTextDocument({
        language: "tester",
        content: ["tset", `  tcaninit ${deviceId},0,0,500,2000`, "tend"].join("\n"),
      });

      const treeManager = new TreeManager({
        subscriptions: [],
      } as unknown as vscode.ExtensionContext);
      const parser = new TesterRuntimeParser(treeManager);
      const parsedDocument = parser.parseDocument(document);

      assert.strictEqual(parsedDocument.configuration[0].deviceId, deviceId);
      assert.strictEqual(parsedDocument.configuration[0].arbitrationBaudRateKbps, 500);
      assert.strictEqual(parsedDocument.configuration[0].dataBaudRateKbps, 2000);
    }
  });

  test("已收口的 USBCANFD 设备遇到非固定波特率会直接报错", async () => {
    await loadLanguage();

    const invalidDocs = [
      ["tset", "  tcaninit 41,0,0,333", "tend"].join("\n"),
      ["tset", "  tcaninit 59,0,0,500,3333", "tend"].join("\n"),
      ["tset", "  tcaninit 41,0,0,500000", "tend"].join("\n"),
    ];

    for (const content of invalidDocs) {
      const document = await vscode.workspace.openTextDocument({
        language: "tester",
        content,
      });
      const treeManager = new TreeManager({
        subscriptions: [],
      } as unknown as vscode.ExtensionContext);
      const parser = new TesterRuntimeParser(treeManager);

      assert.throws(
        () => parser.parseDocument(document),
        /固定波特率|DSL 不支持/,
      );
    }
  });

  test("CodeLens 会挂到测试集和测试用例起始行", async () => {
    await loadLanguage();

    const document = await vscode.workspace.openTextDocument({
      language: "tester",
      content: [
        "tset",
        "  tcaninit 4,0,0,500,2000",
        "tend",
        "",
        "ttitle=套件",
        "  1 tstart=用例一",
        "    tdelay 1",
        "  tend",
        "ttitle-end",
      ].join("\n"),
    });

    const treeManager = new TreeManager({
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);
    const parser = new TesterRuntimeParser(treeManager);
    const provider = new TesterCodeLensProvider(parser);
    const codeLenses = provider.provideCodeLenses(document);

    assert.strictEqual(codeLenses.length, 2);
    assert.strictEqual(codeLenses[0].command?.title, "运行测试集");
    assert.strictEqual(codeLenses[1].command?.title, "运行测试用例");
  });
});
