import * as vscode from "vscode";
import { Tree, Node } from "web-tree-sitter";
import { TreeManager } from "./treeManager";

/**
 * Tester 命令补全提供器
 * 使用 Tree-sitter 语法树提供智能补全
 */
export class TesterCompletionProvider implements vscode.CompletionItemProvider {
  private treeManager: TreeManager;

  constructor(treeManager: TreeManager) {
    this.treeManager = treeManager;
  }

  /**
   * 提供补全项
   */
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    try {
      const tree = this.treeManager.getTree(document);
      const positionOffset = document.offsetAt(position);

      // 找到当前位置对应的语法节点
      const currentNode = this.getNodeAtPosition(
        tree.rootNode,
        positionOffset,
        document,
      );

      if (!currentNode) {
        return [];
      }

      // 检查是否在 tcans 或 tcanr 命令附近
      const completionItems = this.extractCommandsFromTree(tree, document);

      // 过滤出适合当前上下文的补全项
      const lineText = document.lineAt(position.line).text;
      const linePrefix = lineText.substring(0, position.character);
      const currentCommandType = this.getCurrentCommandType(linePrefix);

      if (!currentCommandType) {
        return [];
      }

      // 过滤相同类型的命令
      const filteredCommands = completionItems.filter(
        (item) => item.commandType === currentCommandType,
      );

      // 去重
      const uniqueCommands = this.deduplicateCommands(filteredCommands);

      // 转换为 VSCode CompletionItem
      return uniqueCommands.map((cmd) => {
        const item = new vscode.CompletionItem(
          cmd.label, // 显示标签（通常是注释，如果没有注释则是命令内容）
          vscode.CompletionItemKind.Snippet,
        );

        // 设置插入文本（实际的命令内容）
        item.insertText = new vscode.SnippetString(cmd.insertText);

        // 设置详细信息（显示实际命令内容）
        item.detail = cmd.detail;

        // 设置文档（显示完整信息）
        item.documentation = cmd.documentation;

        // 设置排序优先级（有注释的排在前面）
        item.sortText = cmd.sortText;

        // 设置过滤文本（用于模糊搜索）
        item.filterText = cmd.filterText;

        // 将命令信息保存到 item 中，用于 resolve 方法
        (item as any).commandInfo = cmd;

        return item;
      });
    } catch (error) {
      console.error("Error in provideCompletionItems:", error);
      return [];
    }
  }

  /**
   * 获取当前命令类型
   */
  private getCurrentCommandType(linePrefix: string): "tcans" | "tcanr" | null {
    const match = linePrefix.match(/^\s*(tcans|tcanr)/);
    return match ? (match[1] as "tcans" | "tcanr") : null;
  }

  /**
   * 从语法树中提取命令信息
   */
  private extractCommandsFromTree(
    tree: Tree,
    document: vscode.TextDocument,
  ): ExtractedCommand[] {
    const commands: ExtractedCommand[] = [];
    const root = tree.rootNode;

    // 遍历语法树查找 tcans 和 tcanr 命令
    this.traverseTree(root, (node) => {
      if (
        node.type === "tcans_command" ||
        node.type === "tcanr_compare_command" ||
        node.type === "tcanr_direct_compare_command" ||
        node.type === "tcanr_print_command"
      ) {
        const commandInfo = this.parseCommandNode(node, document);
        if (commandInfo) {
          commands.push(commandInfo);
        }
      }
    });

    return commands;
  }

  /**
   * 解析命令节点
   */
  private parseCommandNode(
    node: Node,
    document: vscode.TextDocument,
  ): ExtractedCommand | null {
    let commandType: "tcans" | "tcanr" = "tcans";
    let commandText = "";
    let label = "";
    let detail = "";
    let documentation: vscode.MarkdownString | undefined;
    let sortText = "";
    let filterText = "";

    // 确定命令类型
    if (node.type.includes("tcanr")) {
      commandType = "tcanr";
    } else if (node.type.includes("tcans")) {
      commandType = "tcans";
    } else {
      return null;
    }

    // 提取命令文本
    commandText = document
      .getText(
        new vscode.Range(
          document.positionAt(node.startIndex),
          document.positionAt(node.endIndex),
        ),
      )
      .trim();

    // 查找注释（可能是 tnote 或行注释）
    const commentText = this.findCommentForCommandNode(node, document);

    // 构建补全项
    if (commentText) {
      // 如果有注释，标签显示注释，详情显示命令内容
      label = commentText;
      detail = commandText;
      documentation = new vscode.MarkdownString(
        `**命令**: \`${commandText}\`\n\n${commentText}`,
      );
      sortText = `0_${commentText}`;
      filterText = `${commentText} ${commandText}`;
    } else {
      // 如果没有注释，标签和详情都显示命令内容
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

  /**
   * 提取核心命令文本（去除命令类型前缀）
   */
  private extractCoreCommand(fullCommand: string): string {
    const trimmed = fullCommand.trim();
    if (trimmed.startsWith("tcans")) {
      return trimmed.substring(5).trim(); // 移除 "tcans" 并修剪空格
    } else if (trimmed.startsWith("tcanr")) {
      return trimmed.substring(5).trim(); // 移除 "tcanr" 并修剪空格
    }
    return trimmed;
  }

  /**
   * 在命令节点附近查找注释
   */
  private findCommentForCommandNode(
    node: Node,
    document: vscode.TextDocument,
  ): string | null {
    const commandStartLine = document.positionAt(node.startIndex).line;
    const commandEndLine = document.positionAt(node.endIndex).line;

    // 检查同一行后面的注释（行尾注释）
    const commandLine = document.lineAt(commandStartLine);
    const commandEndChar = node.endPosition.column;
    const lineTextAfterCommand = commandLine.text
      .substring(commandEndChar)
      .trim();

    if (lineTextAfterCommand.startsWith("//")) {
      return lineTextAfterCommand.substring(2).trim();
    }

    // 检查下一行是否是 tnote 注释
    if (commandEndLine + 1 < document.lineCount) {
      const nextLine = document.lineAt(commandEndLine + 1);
      if (nextLine.text.trim().startsWith("tnote =")) {
        const match = nextLine.text.match(/tnote\s*=\s*(.+)/);
        if (match) {
          return match[1].trim();
        }
      }
    }

    // 检查上一行是否是注释
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

    // 搜索整个文档寻找与当前命令相关的注释（通过内容相似性）
    return this.searchRelatedComment(
      document,
      commandStartLine,
      commandEndLine,
      (fullCommand) => {
        return document
          .getText(
            new vscode.Range(
              document.positionAt(node.startIndex),
              document.positionAt(node.endIndex),
            ),
          )
          .trim();
      },
    );
  }

  /**
   * 搜索相关注释
   */
  private searchRelatedComment(
    document: vscode.TextDocument,
    commandStartLine: number,
    commandEndLine: number,
    getCommandText: (fullCommand: string) => string,
  ): string | null {
    const commandText = getCommandText("");
    const commandParts = commandText
      .split(/\s+/)
      .filter((part) => part.length > 2); // 取较长的关键词

    // 向前搜索几行寻找可能的注释
    for (
      let i = Math.max(0, commandStartLine - 10);
      i < commandStartLine;
      i++
    ) {
      const line = document.lineAt(i);
      const lineText = line.text.trim();

      if (lineText.startsWith("//") || lineText.startsWith("tnote =")) {
        const comment = lineText.startsWith("//")
          ? lineText.substring(2).trim()
          : lineText.replace(/tnote\s*=\s*/, "").trim();

        // 检查注释是否与命令内容相关
        if (this.isCommentRelatedToCommand(comment, commandParts)) {
          return comment;
        }
      }
    }

    // 向后搜索几行寻找可能的注释
    for (
      let i = commandEndLine + 1;
      i < Math.min(document.lineCount, commandEndLine + 10);
      i++
    ) {
      const line = document.lineAt(i);
      const lineText = line.text.trim();

      if (lineText.startsWith("//") || lineText.startsWith("tnote =")) {
        const comment = lineText.startsWith("//")
          ? lineText.substring(2).trim()
          : lineText.replace(/tnote\s*=\s*/, "").trim();

        // 检查注释是否与命令内容相关
        if (this.isCommentRelatedToCommand(comment, commandParts)) {
          return comment;
        }
      }
    }

    return null;
  }

  /**
   * 检查注释是否与命令相关
   */
  private isCommentRelatedToCommand(
    comment: string,
    commandParts: string[],
  ): boolean {
    // 简单的相关性检查：注释中是否包含命令中的关键词
    const commentLower = comment.toLowerCase();
    return commandParts.some((part) =>
      commentLower.includes(part.toLowerCase()),
    );
  }

  /**
   * 遍历语法树
   */
  private traverseTree(node: Node, callback: (node: Node) => void) {
    callback(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.traverseTree(child, callback);
      }
    }
  }

  /**
   * 根据位置获取语法节点
   */
  private getNodeAtPosition(
    node: Node,
    offset: number,
    document: vscode.TextDocument,
  ): Node | null {
    if (offset < node.startIndex || offset > node.endIndex) {
      return null;
    }

    // 检查子节点
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        const found = this.getNodeAtPosition(child, offset, document);
        if (found) {
          return found;
        }
      }
    }

    // 如果没有匹配的子节点，则返回当前节点
    return node;
  }

  /**
   * 去重命令
   */
  private deduplicateCommands(
    commands: ExtractedCommand[],
  ): ExtractedCommand[] {
    const seen = new Map<string, ExtractedCommand>();

    for (const cmd of commands) {
      const key = cmd.insertText;

      // 如果已存在，优先保留有注释的
      if (!seen.has(key) || (cmd.detail && !seen.get(key)?.detail)) {
        seen.set(key, cmd);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * 解析补全项的额外信息（可选）
   * 这个方法会在用户选中某个补全项时调用
   */
  resolveCompletionItem(
    item: vscode.CompletionItem,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CompletionItem> {
    // 如果已有详细信息，直接返回
    if (item.detail) {
      return item;
    }

    // 从保存的信息中恢复详细信息
    const commandInfo = (item as any).commandInfo as
      | ExtractedCommand
      | undefined;
    if (commandInfo) {
      item.detail = commandInfo.detail;
      item.documentation = commandInfo.documentation;
    }

    return item;
  }
}

/**
 * 提取的命令信息接口
 */
interface ExtractedCommand {
  commandType: "tcans" | "tcanr";
  insertText: string;
  label: string; // 显示在建议列表中的文本（注释或命令内容）
  detail: string; // 选中后显示的详细信息
  documentation?: vscode.MarkdownString; // 更多文档信息
  sortText: string; // 排序文本
  filterText: string; // 过滤文本
}
