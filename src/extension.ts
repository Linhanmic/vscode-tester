import * as vscode from "vscode";
import { loadLanguage } from "./parser/testerParser";
import { TesterDocumentSymbolProvider } from "./providers/documentSymbolProvider";
import { TesterFoldingProvider } from "./providers/foldingProvider";
import { TesterDiagnosticProvider } from "./providers/diagnosticProvider";
import { TesterHoverProvider } from "./providers/hoverProvider";
import { TreeManager } from "./parser/treeManager";
import { DbcManager } from "./dbc/dbcManager";
import { TesterCompletionProvider } from "./providers/completionProvider";
import { DOCUMENT_SELECTOR } from "./constants";

export async function activate(context: vscode.ExtensionContext) {
  await loadLanguage();

  const treeManager = new TreeManager(context);
  const dbcManager = new DbcManager(context);
  await dbcManager.initialize();

  // Register all providers
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      DOCUMENT_SELECTOR,
      new TesterDocumentSymbolProvider(treeManager),
    ),
    vscode.languages.registerFoldingRangeProvider(
      DOCUMENT_SELECTOR,
      new TesterFoldingProvider(treeManager),
    ),
    vscode.languages.registerHoverProvider(
      DOCUMENT_SELECTOR,
      new TesterHoverProvider(treeManager, dbcManager),
    ),
    vscode.languages.registerCompletionItemProvider(
      DOCUMENT_SELECTOR,
      new TesterCompletionProvider(treeManager),
      " ",
    ),
  );

  // Conditionally enable diagnostics
  const config = vscode.workspace.getConfiguration("tester");
  if (config.get<boolean>("diagnostics.enabled", true)) {
    const diagnosticProvider = new TesterDiagnosticProvider(treeManager);
    context.subscriptions.push(diagnosticProvider);
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) =>
        diagnosticProvider.updateDiagnostics(e.document),
      ),
      vscode.workspace.onDidOpenTextDocument((doc) =>
        diagnosticProvider.updateDiagnostics(doc),
      ),
    );
  }
}

export function deactivate() {}
