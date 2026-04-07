import * as vscode from "vscode";
import { Tree, Node } from "web-tree-sitter";
import { TreeManager } from "../parser/treeManager";
import { CAN_COMMAND_NODE_TYPES } from "../constants";
import { ExtractedCommand, TesterCommandType } from "../types";

const COMMAND_PREFIX_PATTERN = /^\s*(tcans|tcanr)/;

export class TesterCompletionProvider implements vscode.CompletionItemProvider {
  private treeManager: TreeManager;
  private commandInfoMap = new WeakMap<vscode.CompletionItem, ExtractedCommand>();

  // Cache extracted commands per document version to avoid re-traversing the tree
  private commandCache = new Map<string, { version: number; tcans: ExtractedCommand[]; tcanr: ExtractedCommand[] }>();

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
      const lineText = document.lineAt(position.line).text;
      const linePrefix = lineText.substring(0, position.character);
      const currentCommandType = this.getCurrentCommandType(linePrefix);

      // Early exit before any tree work if not in a command context
      if (!currentCommandType) {
        return [];
      }

      const tree = this.treeManager.getTree(document);
      const uniqueCommands = this.getCachedCommands(document, tree, currentCommandType);

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

  private getCachedCommands(
    document: vscode.TextDocument,
    tree: Tree,
    commandType: TesterCommandType,
  ): ExtractedCommand[] {
    const key = document.uri.toString();
    const cached = this.commandCache.get(key);

    if (cached && cached.version === document.version) {
      return commandType === "tcans" ? cached.tcans : cached.tcanr;
    }

    const allCommands = this.extractCommandsFromTree(tree, document);
    const tcansCommands = this.deduplicateCommands(
      allCommands.filter((c) => c.commandType === "tcans"),
    );
    const tcanrCommands = this.deduplicateCommands(
      allCommands.filter((c) => c.commandType === "tcanr"),
    );

    this.commandCache.set(key, {
      version: document.version,
      tcans: tcansCommands,
      tcanr: tcanrCommands,
    });

    return commandType === "tcans" ? tcansCommands : tcanrCommands;
  }

  private getCurrentCommandType(linePrefix: string): TesterCommandType | null {
    const match = linePrefix.match(COMMAND_PREFIX_PATTERN);
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
    // if (commandEndLine + 1 < document.lineCount) {
    //   const nextLine = document.lineAt(commandEndLine + 1);
    //   if (nextLine.text.trim().startsWith("tnote =")) {
    //     const match = nextLine.text.match(/tnote\s*=\s*(.+)/);
    //     if (match) {
    //       return match[1].trim();
    //     }
    //   }
    // }

    // Check previous line for comment or tnote
    // if (commandStartLine > 0) {
    //   const prevLine = document.lineAt(commandStartLine - 1);
    //   const prevLineTrimmed = prevLine.text.trim();

    //   if (prevLineTrimmed.startsWith("//")) {
    //     return prevLineTrimmed.substring(2).trim();
    //   } else if (prevLineTrimmed.startsWith("tnote =")) {
    //     const match = prevLineTrimmed.match(/tnote\s*=\s*(.+)/);
    //     if (match) {
    //       return match[1].trim();
    //     }
    //   }
    // }

    return null;
  }

  private traverseTree(node: Node, callback: (node: Node) => void) {
    // Skip comment nodes entirely - they cannot contain commands
    if (node.type === "comment") {
      return;
    }
    callback(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.traverseTree(child, callback);
      }
    }
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
