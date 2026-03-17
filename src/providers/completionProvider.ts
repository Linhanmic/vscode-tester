import * as vscode from "vscode";
import { Tree, Node } from "web-tree-sitter";
import { TreeManager } from "../parser/treeManager";
import { CAN_COMMAND_NODE_TYPES } from "../constants";
import { ExtractedCommand, TesterCommandType } from "../types";

export class TesterCompletionProvider implements vscode.CompletionItemProvider {
  private treeManager: TreeManager;
  private commandInfoMap = new WeakMap<vscode.CompletionItem, ExtractedCommand>();

  constructor(treeManager: TreeManager) {
    this.treeManager = treeManager;
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    try {
      const tree = this.treeManager.getTree(document);
      const positionOffset = document.offsetAt(position);

      const currentNode = this.getNodeAtPosition(
        tree.rootNode,
        positionOffset,
      );

      if (!currentNode) {
        return [];
      }

      const completionItems = this.extractCommandsFromTree(tree, document);

      const lineText = document.lineAt(position.line).text;
      const linePrefix = lineText.substring(0, position.character);
      const currentCommandType = this.getCurrentCommandType(linePrefix);

      if (!currentCommandType) {
        return [];
      }

      const filteredCommands = completionItems.filter(
        (item) => item.commandType === currentCommandType,
      );

      const uniqueCommands = this.deduplicateCommands(filteredCommands);

      return uniqueCommands.map((cmd) => {
        const item = new vscode.CompletionItem(
          cmd.label,
          vscode.CompletionItemKind.Snippet,
        );

        item.insertText = new vscode.SnippetString(cmd.insertText);
        item.detail = cmd.detail;
        item.documentation = cmd.documentation;
        item.sortText = cmd.sortText;
        item.filterText = cmd.filterText;

        this.commandInfoMap.set(item, cmd);

        return item;
      });
    } catch (error) {
      console.error("Error in provideCompletionItems:", error);
      return [];
    }
  }

  private getCurrentCommandType(linePrefix: string): TesterCommandType | null {
    const match = linePrefix.match(/^\s*(tcans|tcanr)/);
    return match ? (match[1] as TesterCommandType) : null;
  }

  private extractCommandsFromTree(
    tree: Tree,
    document: vscode.TextDocument,
  ): ExtractedCommand[] {
    const commands: ExtractedCommand[] = [];
    const root = tree.rootNode;

    this.traverseTree(root, (node) => {
      if (CAN_COMMAND_NODE_TYPES.has(node.type)) {
        const commandInfo = this.parseCommandNode(node, document);
        if (commandInfo) {
          commands.push(commandInfo);
        }
      }
    });

    return commands;
  }

  private parseCommandNode(
    node: Node,
    document: vscode.TextDocument,
  ): ExtractedCommand | null {
    let commandType: TesterCommandType;

    if (node.type.includes("tcanr")) {
      commandType = "tcanr";
    } else if (node.type.includes("tcans")) {
      commandType = "tcans";
    } else {
      return null;
    }

    const commandText = document
      .getText(
        new vscode.Range(
          document.positionAt(node.startIndex),
          document.positionAt(node.endIndex),
        ),
      )
      .trim();

    const commentText = this.findCommentForCommandNode(node, document);

    let label: string;
    let detail: string;
    let documentation: vscode.MarkdownString;
    let sortText: string;
    let filterText: string;

    if (commentText) {
      label = commentText;
      detail = commandText;
      documentation = new vscode.MarkdownString(
        `**命令**: \`${commandText}\`\n\n${commentText}`,
      );
      sortText = `0_${commentText}`;
      filterText = `${commentText} ${commandText}`;
    } else {
      label = commandText;
      detail = `${commandType} 命令`;
      documentation = new vscode.MarkdownString(`\`${commandText}\``);
      sortText = `1_${commandText}`;
      filterText = commandText;
    }

    return {
      commandType,
      insertText: this.extractCoreCommand(commandText),
      label,
      detail,
      documentation,
      sortText,
      filterText,
    };
  }

  private extractCoreCommand(fullCommand: string): string {
    const trimmed = fullCommand.trim();
    if (trimmed.startsWith("tcans")) {
      return trimmed.substring(5).trim();
    } else if (trimmed.startsWith("tcanr")) {
      return trimmed.substring(5).trim();
    }
    return trimmed;
  }

  private findCommentForCommandNode(
    node: Node,
    document: vscode.TextDocument,
  ): string | null {
    const commandStartLine = document.positionAt(node.startIndex).line;
    const commandEndLine = document.positionAt(node.endIndex).line;

    // Check for trailing comment on same line
    const commandLine = document.lineAt(commandStartLine);
    const commandEndChar = node.endPosition.column;
    const lineTextAfterCommand = commandLine.text
      .substring(commandEndChar)
      .trim();

    if (lineTextAfterCommand.startsWith("//")) {
      return lineTextAfterCommand.substring(2).trim();
    }

    // Check next line for tnote
    if (commandEndLine + 1 < document.lineCount) {
      const nextLine = document.lineAt(commandEndLine + 1);
      if (nextLine.text.trim().startsWith("tnote =")) {
        const match = nextLine.text.match(/tnote\s*=\s*(.+)/);
        if (match) {
          return match[1].trim();
        }
      }
    }

    // Check previous line for comment or tnote
    if (commandStartLine > 0) {
      const prevLine = document.lineAt(commandStartLine - 1);
      const prevLineTrimmed = prevLine.text.trim();

      if (prevLineTrimmed.startsWith("//")) {
        return prevLineTrimmed.substring(2).trim();
      } else if (prevLineTrimmed.startsWith("tnote =")) {
        const match = prevLineTrimmed.match(/tnote\s*=\s*(.+)/);
        if (match) {
          return match[1].trim();
        }
      }
    }

    return null;
  }

  private traverseTree(node: Node, callback: (node: Node) => void) {
    callback(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.traverseTree(child, callback);
      }
    }
  }

  private getNodeAtPosition(node: Node, offset: number): Node | null {
    if (offset < node.startIndex || offset > node.endIndex) {
      return null;
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        const found = this.getNodeAtPosition(child, offset);
        if (found) {
          return found;
        }
      }
    }

    return node;
  }

  private deduplicateCommands(
    commands: ExtractedCommand[],
  ): ExtractedCommand[] {
    const seen = new Map<string, ExtractedCommand>();

    for (const cmd of commands) {
      const key = cmd.insertText;
      if (!seen.has(key) || (cmd.detail && !seen.get(key)?.detail)) {
        seen.set(key, cmd);
      }
    }

    return Array.from(seen.values());
  }

  resolveCompletionItem(
    item: vscode.CompletionItem,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CompletionItem> {
    if (item.detail) {
      return item;
    }

    const commandInfo = this.commandInfoMap.get(item);
    if (commandInfo) {
      item.detail = commandInfo.detail;
      item.documentation = commandInfo.documentation;
    }

    return item;
  }
}
