import * as vscode from "vscode";
import { Node } from "web-tree-sitter";
import { TreeManager } from "../parser/treeManager";

export class TesterDocumentSymbolProvider
  implements vscode.DocumentSymbolProvider
{
  constructor(private treeManager: TreeManager) {}

  provideDocumentSymbols(
    document: vscode.TextDocument,
  ): vscode.DocumentSymbol[] {
    const tree = this.treeManager.getTree(document);
    const symbols: vscode.DocumentSymbol[] = [];

    const walk = (node: Node, parentSuite?: vscode.DocumentSymbol) => {
      switch (node.type) {
        case "configuration_block":
          symbols.push(
            new vscode.DocumentSymbol(
              "Configuration",
              "",
              vscode.SymbolKind.Module,
              this.nodeToRange(node),
              this.nodeToRange(node),
            ),
          );
          break;

        case "test_suite":
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

          symbols.push(suiteSymbol);

          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {walk(child, suiteSymbol);}
          }

          return;

        case "test_case":
          if (!parentSuite) {break;}

          const idNode = node.childForFieldName("id");
          const titleNode2 = node.childForFieldName("title");

          const id = idNode ? idNode.text : "";
          const caseTitle = titleNode2
            ? this.cleanString(titleNode2.text)
            : "Test Case";

          const label = id ? `${id}. ${caseTitle}` : caseTitle;

          parentSuite.children.push(
            new vscode.DocumentSymbol(
              label,
              "",
              vscode.SymbolKind.Method,
              this.nodeToRange(node),
              this.nodeToRange(node),
            ),
          );
          break;
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {walk(child, parentSuite);}
      }
    };

    walk(tree.rootNode);
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
    return str.replace(/^["']|["']$/g, "").trim();
  }
}
