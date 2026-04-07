import * as vscode from "vscode";
import { Edit, Tree } from "web-tree-sitter";
import { parser } from "./testerParser";
import { LANGUAGE_ID } from "../constants";

// 初始目的:使用增量解析来提高性能，避免每次文档变化都重新解析整个文本
// 语法树管理器，负责维护每个打开的文档对应的语法树，并在文档内容变化时更新语法树
export class TreeManager implements vscode.Disposable {
  // 使用文档 URI 作为键，存储对应的语法树
  private trees = new Map<string, Tree>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === LANGUAGE_ID) {
          this.updateTree(e);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.disposeTree(doc.uri.toString());
      }),
    );
    context.subscriptions.push(this);
  }

  dispose() {
    for (const tree of this.trees.values()) {
      tree.delete();
    }
    this.trees.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  // 获取指定文档的语法树，如果不存在则创建并缓存
  getTree(document: vscode.TextDocument): Tree {
    const key = document.uri.toString();
    const existing = this.trees.get(key);

    if (existing) {
      return existing;
    }

    const tree = parser.parse(document.getText());
    if (!tree) {
      throw new Error("Failed to parse document, tree is null");
    }
    this.trees.set(key, tree);
    return tree;
  }

  private updateTree(event: vscode.TextDocumentChangeEvent) {
    const key = event.document.uri.toString();
    const oldTree = this.trees.get(key);
    if (!oldTree) {
      return;
    }

    for (const change of event.contentChanges) {
      const startPos = event.document.positionAt(change.rangeOffset);
      const oldEndPos = event.document.positionAt(
        change.rangeOffset + change.rangeLength,
      );
      const newEndPos = event.document.positionAt(
        change.rangeOffset + change.text.length,
      );

      oldTree.edit(
        new Edit({
          startIndex: change.rangeOffset,
          oldEndIndex: change.rangeOffset + change.rangeLength,
          newEndIndex: change.rangeOffset + change.text.length,
          startPosition: { row: startPos.line, column: startPos.character },
          oldEndPosition: { row: oldEndPos.line, column: oldEndPos.character },
          newEndPosition: { row: newEndPos.line, column: newEndPos.character },
        }),
      );
    }

    const newTree = parser.parse(event.document.getText(), oldTree);
    if (!newTree) {
      console.error("Failed to parse document after edit, new tree is null");
      return;
    }
    // Free the old tree's native memory before replacing
    oldTree.delete();
    this.trees.set(key, newTree);
  }

  private disposeTree(key: string) {
    const tree = this.trees.get(key);
    if (tree) {
      tree.delete();
      this.trees.delete(key);
    }
  }
}
