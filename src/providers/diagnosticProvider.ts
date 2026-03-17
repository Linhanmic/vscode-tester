import * as vscode from "vscode";
import { Node } from "web-tree-sitter";
import { TreeManager } from "../parser/treeManager";

export class TesterDiagnosticProvider implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor(private treeManager: TreeManager) {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("tester");
  }

  updateDiagnostics(document: vscode.TextDocument): void {
    if (document.languageId !== "tester") {
      return;
    }

    const tree = this.treeManager.getTree(document);
    const diagnostics: vscode.Diagnostic[] = [];

    this.checkSyntaxErrors(tree.rootNode, document, diagnostics);

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private checkSyntaxErrors(
    node: Node,
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[],
  ): void {
    if (node.type === "ERROR" || node.isMissing) {
      const range = new vscode.Range(
        node.startPosition.row,
        node.startPosition.column,
        node.endPosition.row,
        node.endPosition.column,
      );

      const diagnostic = new vscode.Diagnostic(
        range,
        `Syntax error: unexpected '${node.text}'`,
        vscode.DiagnosticSeverity.Error,
      );
      diagnostics.push(diagnostic);
    }

    for (const child of node.children) {
      this.checkSyntaxErrors(child, document, diagnostics);
    }
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
  }
}
