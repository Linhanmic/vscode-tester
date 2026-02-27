import * as vscode from "vscode";
import { parser, tester } from "./testerParser";
import { Node, Query } from "web-tree-sitter";

export class TesterDiagnosticProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor() {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("tester");
  }

  updateDiagnostics(document: vscode.TextDocument): void {
    if (document.languageId !== "tester") {
      return;
    }

    const sourceCode = document.getText();
    const tree = parser.parse(sourceCode);
    if (!tree) {
      console.error("Failed to parse document, tree is null");
      return;
    }
    const diagnostics: vscode.Diagnostic[] = [];

    // 检查语法错误
    this.checkSyntaxErrors(tree.rootNode, document, diagnostics);

    // 检查语义错误
    // this.checkSemanticErrors(tree.rootNode, document, diagnostics);

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private checkSyntaxErrors(
    node: Node,
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[],
  ): void {
    // Tree-sitter 会自动标记 ERROR 和 MISSING 节点
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

    // 递归检查子节点
    for (const child of node.children) {
      this.checkSyntaxErrors(child, document, diagnostics);
    }
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
  }
}
