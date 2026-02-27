// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { loadLanguage } from "./testerParser";
import { TesterDocumentSymbolProvider } from "./testerDocumentSymbolProvider";
import { TesterFoldingProvider } from "./testerFoldingProvider";
import { TesterDiagnosticProvider } from "./testerDiagnosticProvider";
import { TesterHoverProvider } from "./testerHoverProvider";
import { TreeManager } from "./treeManager";
import { DbcManager } from "./dbcManager";
import { TesterCompletionProvider } from "./testerCompletionProvider";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "vscode-tester" is now active!');

  // Load the tester language
  await loadLanguage();

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand(
    "vscode-tester.helloWorld",
    () => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      vscode.window.showInformationMessage(
        "Hello World from Tester Language Support by Linhanmic!",
      );
    },
  );

  context.subscriptions.push(disposable);

  // 创建语法树管理器实例
  const treeManager = new TreeManager(context);

  // 注册文档符号提供者
  const symbolProvider = new TesterDocumentSymbolProvider(treeManager);
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { scheme: "file", language: "tester" },
      symbolProvider,
    ),
  );

  // 注册折叠范围提供者
  const foldingProvider = new TesterFoldingProvider(treeManager);
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      { scheme: "file", language: "tester" },
      foldingProvider,
    ),
  );

  // 注册诊断提供者
  //   const diagnosticProvider = new TesterDiagnosticProvider();
  //   context.subscriptions.push(diagnosticProvider);

  //   // 监听文档变化，更新诊断信息
  //   context.subscriptions.push(
  // 	vscode.workspace.onDidChangeTextDocument((event) => {
  // 	  diagnosticProvider.updateDiagnostics(event.document);
  // 	}),
  //   );

  //   // 文档打开时也更新诊断信息
  //   context.subscriptions.push(
  // 	vscode.workspace.onDidOpenTextDocument((document) => {
  // 	  diagnosticProvider.updateDiagnostics(document);
  // 	}),
  //   );

  // 注册悬停提供者
  // const hoverProvider = new TesterHoverProvider(context);
  // context.subscriptions.push(
  //   vscode.languages.registerHoverProvider(
  //     { scheme: "file", language: "tester" },
  //     hoverProvider,
  //   ),
  // );
  const dbcManager = new DbcManager(context);
  await dbcManager.initialize();

  // vscode.languages.registerHoverProvider(
  //   { language: "tester" },
  //   new TesterHoverProvider(treeManager, dbcManager)
  // );
  const testerHoverProvider = new TesterHoverProvider(treeManager, dbcManager);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: "file", language: "tester" },
      testerHoverProvider,
    ),
  );

  // 代码填充注册
  const testerCompletionProvider = new TesterCompletionProvider(treeManager);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { scheme: "file", language: "tester" },
      testerCompletionProvider,
      " ", // 触发补全的字符，例如点号
    ),
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
