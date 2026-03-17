import * as vscode from "vscode";
import { Node } from "web-tree-sitter";
import { TreeManager } from "../parser/treeManager";

export class TesterFoldingProvider implements vscode.FoldingRangeProvider {
  constructor(private treeManager: TreeManager) {}

  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const tree = this.treeManager.getTree(document);
    const foldingRanges: vscode.FoldingRange[] = [];

    const walk = (node: Node) => {
      switch (node.type) {
        case "configuration_block":
        case "test_suite":
        case "test_case": {
          const startLine = node.startPosition.row;
          const endLine = node.endPosition.row;

          // 至少两行才允许折叠
          if (endLine > startLine) {
            foldingRanges.push(
              new vscode.FoldingRange(
                startLine,
                endLine - 1, // VSCode 折叠通常不包含最后一行
                vscode.FoldingRangeKind.Region,
              ),
            );
          }

          break;
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          walk(child);
        }
      }
    };

    walk(tree.rootNode);

    return foldingRanges;
  }
}
