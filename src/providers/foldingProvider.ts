import * as vscode from "vscode";
import { Node } from "web-tree-sitter";
import { TreeManager } from "../parser/treeManager";

const FOLDABLE_NODE_TYPES = new Set([
  "configuration_block",
  "test_suite",
  "test_case",
]);

export class TesterFoldingProvider implements vscode.FoldingRangeProvider {
  constructor(private treeManager: TreeManager) {}

  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const tree = this.treeManager.getTree(document);
    const foldingRanges: vscode.FoldingRange[] = [];

    // Only visit top-level nodes and their direct children (two levels deep).
    // Foldable blocks (configuration_block, test_suite, test_case) exist at
    // the top level or one level below (test_case inside test_suite).
    // This avoids recursing into deeply nested command nodes.
    for (let i = 0; i < tree.rootNode.childCount; i++) {
      const node = tree.rootNode.child(i);
      if (!node) { continue; }

      this.addFoldingRange(node, foldingRanges);

      if (node.type === "test_suite") {
        for (let j = 0; j < node.childCount; j++) {
          const child = node.child(j);
          if (child) {
            this.addFoldingRange(child, foldingRanges);
          }
        }
      }
    }

    return foldingRanges;
  }

  private addFoldingRange(node: Node, ranges: vscode.FoldingRange[]) {
    if (!FOLDABLE_NODE_TYPES.has(node.type)) {
      return;
    }

    const startLine = node.startPosition.row;
    const endLine = node.endPosition.row;

    // 至少两行才允许折叠
    if (endLine > startLine) {
      ranges.push(
        new vscode.FoldingRange(
          startLine,
          endLine - 1, // VSCode 折叠通常不包含最后一行
          vscode.FoldingRangeKind.Region,
        ),
      );
    }
  }
}
