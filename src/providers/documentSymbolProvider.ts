import * as vscode from "vscode";
import { Node } from "web-tree-sitter";
import { TreeManager } from "../parser/treeManager";

const QUOTE_PATTERN = /^["']|["']$/g;

export class TesterDocumentSymbolProvider
  implements vscode.DocumentSymbolProvider
{
  constructor(private treeManager: TreeManager) {}

  provideDocumentSymbols(
    document: vscode.TextDocument,
  ): vscode.DocumentSymbol[] {
    const tree = this.treeManager.getTree(document);
    const symbols: vscode.DocumentSymbol[] = [];

    // Only iterate top-level children of the root node.
    // test_suite and configuration_block are always top-level;
    // test_case is always a direct child of test_suite.
    // This avoids a full recursive traversal of the entire tree.
    for (let i = 0; i < tree.rootNode.childCount; i++) {
      const node = tree.rootNode.child(i);
      if (!node) { continue; }

      if (node.type === "configuration_block") {
        symbols.push(
          new vscode.DocumentSymbol(
            "Configuration",
            "",
            vscode.SymbolKind.Module,
            this.nodeToRange(node),
            this.nodeToRange(node),
          ),
        );
      } else if (node.type === "test_suite") {
        const titleNode = node.childForFieldName("title");
        const title = titleNode
          ? this.cleanString(titleNode.text)
          : "Test Suite";

        const suiteSymbol = new vscode.DocumentSymbol(
          title,
          "",
          vscode.SymbolKind.Class,
          this.nodeToRange(node),
          this.nodeToRange(node),
        );

        // Collect test cases from direct children only
        for (let j = 0; j < node.childCount; j++) {
          const child = node.child(j);
          if (!child || child.type !== "test_case") { continue; }

          const idNode = child.childForFieldName("id");
          const titleNode2 = child.childForFieldName("title");

          const id = idNode ? idNode.text : "";
          const caseTitle = titleNode2
            ? this.cleanString(titleNode2.text)
            : "Test Case";

          const label = id ? `${id}. ${caseTitle}` : caseTitle;

          suiteSymbol.children.push(
            new vscode.DocumentSymbol(
              label,
              "",
              vscode.SymbolKind.Method,
              this.nodeToRange(child),
              this.nodeToRange(child),
            ),
          );
        }

        symbols.push(suiteSymbol);
      }
    }

    return symbols;
  }

  private nodeToRange(node: Node): vscode.Range {
    return new vscode.Range(
      node.startPosition.row,
      node.startPosition.column,
      node.endPosition.row,
      node.endPosition.column,
    );
  }

  private cleanString(str: string): string {
    QUOTE_PATTERN.lastIndex = 0;
    return str.replace(QUOTE_PATTERN, "").trim();
  }
}
