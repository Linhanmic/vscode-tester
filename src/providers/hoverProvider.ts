import * as vscode from "vscode";
import { Tree, Node } from "web-tree-sitter";
import { TreeManager } from "../parser/treeManager";
import { CAN_COMMAND_NODE_TYPES } from "../constants";
import { CanCommandInfo } from "../types";
import {
  type DecodedDisplayMessage,
  type DecodedDisplaySignal,
  formatDisplayDataBytes,
  formatMessageId,
  isDecodedDisplayError,
} from "../dbc/displayModel";
import type { DbcManager } from "../dbc/dbcManager";

const DATA_SPLIT_PATTERN = /[-\s]+/;
const PIPE_PATTERN = /\|/g;
const NEWLINE_PATTERN = /\r?\n/g;

export class TesterHoverProvider implements vscode.HoverProvider {
  constructor(
    private treeManager: TreeManager,
    private readonly getDbcManager: () => Promise<DbcManager>,
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | null> {
    const tree = this.treeManager.getTree(document);
    const node = this.findCanCommandNode(tree, document, position);
    if (!node) {
      return null;
    }

    const info = this.extractCanInfo(node, document);
    if (!info) {
      return null;
    }

    try {
      const dbcManager = await this.getDbcManager();
      const markdown = this.buildMarkdown(info, dbcManager);
      if (!markdown) {
        return null;
      }
      return new vscode.Hover(markdown);
    } catch (e) {
      console.error("Error building hover markdown:", e);
      return null;
    }
  }

  private findCanCommandNode(
    tree: Tree,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Node | null {
    const offset = document.offsetAt(position);
    let node: Node | null = tree.rootNode.descendantForIndex(offset);

    while (node) {
      if (CAN_COMMAND_NODE_TYPES.has(node.type)) {
        return node;
      }
      node = node.parent;
    }

    return null;
  }

  private getNodeText(node: Node, document: vscode.TextDocument): string {
    return document.getText(
      new vscode.Range(
        document.positionAt(node.startIndex),
        document.positionAt(node.endIndex),
      ),
    );
  }

  private parseDataSequence(text: string): number[] {
    return text
      .split(DATA_SPLIT_PATTERN)
      .filter((b) => b.length > 0)
      .map((b) => parseInt(b, 16));
  }

  private extractCanInfo(
    node: Node,
    document: vscode.TextDocument,
  ): CanCommandInfo | null {
    const idNode = node.childForFieldName("message_id");
    if (!idNode) {
      return null;
    }

    const idText = this.getNodeText(idNode, document);
    const messageId = parseInt(idText, 16);

    if (
      node.type === "tcans_command" ||
      node.type === "tcanr_direct_compare_command"
    ) {
      const dataFieldName =
        node.type === "tcans_command" ? "message_data" : "expected_data";
      const dataNode = node.childForFieldName(dataFieldName);
      if (!dataNode) {
        return null;
      }
      const dataBytes = this.parseDataSequence(
        this.getNodeText(dataNode, document),
      );
      return {
        type: "full_decode",
        messageId,
        dataBytes,
        nodeType: node.type,
      };
    } else {
      const bitRangeNode = node.childForFieldName("expected_bit_range");
      return {
        type: "message_info",
        messageId,
        bitRange: bitRangeNode
          ? this.getNodeText(bitRangeNode, document)
          : undefined,
        nodeType: node.type,
      };
    }
  }

  private buildMarkdown(
    info: CanCommandInfo,
    dbcManager: DbcManager,
  ): vscode.MarkdownString | null {
    if (info.type === "full_decode") {
      return this.buildFullDecodeMarkdown(info, dbcManager);
    } else {
      return this.buildMessageInfoMarkdown(info, dbcManager);
    }
  }

  private buildFullDecodeMarkdown(info: {
    messageId: number;
    dataBytes: number[];
    nodeType: string;
  }, dbcManager: DbcManager): vscode.MarkdownString {
    const result = dbcManager.decodeMessageForDisplay(
      info.messageId,
      info.dataBytes,
    );

    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const dataHex = formatDisplayDataBytes(info.dataBytes);

    if (isDecodedDisplayError(result)) {
      md.appendMarkdown(`### ⚠️ 报文解析失败\n\n`);
      md.appendMarkdown(`**ID**: ${formatMessageId(info.messageId)}\n\n`);
      md.appendMarkdown(`**数据**: ${dataHex}\n\n`);
      md.appendMarkdown(`**原因**: ${this.escapeMarkdownCell(result.message)}\n\n`);
      return md;
    }

    this.appendMessageDetails(md, result);
    return md;
  }

  private buildMessageInfoMarkdown(info: {
    messageId: number;
    bitRange?: string;
    nodeType: string;
  }, dbcManager: DbcManager): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const modeText =
      info.nodeType === "tcanr_print_command" ? "打印输出" : "位域对比";
    md.appendMarkdown(`**模式**: ${modeText}`);
    if (info.bitRange) {
      md.appendMarkdown(` · **位域范围**: \`${info.bitRange}\``);
    }
    md.appendMarkdown(`\n\n`);

    const result = dbcManager.getMessageDefinition(info.messageId);
    if (isDecodedDisplayError(result)) {
      md.appendMarkdown(`**DBC**: ${this.escapeMarkdownCell(result.message)}\n\n`);
      return md;
    }

    this.appendMessageDetails(md, result, {
      showHeading: false,
      showData: false,
    });
    return md;
  }

  private appendMessageDetails(
    markdown: vscode.MarkdownString,
    message: DecodedDisplayMessage,
    options?: {
      showHeading?: boolean;
      showData?: boolean;
    },
  ) {
    const showData = options?.showData ?? true;
    const orderedSignals = this.orderSignals(message.signals);
    const headerParts = [
      `**${this.escapeMarkdownCell(message.name)}**`,
      `\`${message.idHex}\``,
      `DLC \`${message.dlc}\``,
    ];
    if (message.sendingNode) {
      headerParts.push(`节点 \`${this.escapeMarkdownCell(message.sendingNode)}\``);
    }
    markdown.appendMarkdown(`${headerParts.join(" · ")}\n\n`);

    if (message.description) {
      markdown.appendMarkdown(`> ${this.escapeMarkdownCell(message.description)}\n\n`);
    }

    if (message.multiplexerName) {
      if (typeof message.multiplexerValue === "number") {
        markdown.appendMarkdown(
          `**复用摘要**: \`${this.escapeMarkdownCell(message.multiplexerName)} = ${message.multiplexerValue}\` -> \`m${message.multiplexerValue}\`\n\n`,
        );
      } else {
        markdown.appendMarkdown(
          `**复用摘要**: \`${this.escapeMarkdownCell(message.multiplexerName)}\`\n\n`,
        );
      }
    }

    if (showData) {
      markdown.appendMarkdown(`**数据** \`${message.dataText}\`\n\n`);
    }

    if (orderedSignals.length === 0) {
      markdown.appendMarkdown(`*该报文无信号定义*\n\n`);
      return;
    }

    const rows: string[] = [
      `| 类型 | 信号名 | 描述 | 位置 | 解析值 |`,
      `|:-----|:-------|:-----|:-----|:-------|`,
    ];

    for (const signal of orderedSignals) {
      const nameCell = signal.multiplexTag
        ? `\`${this.escapeMarkdownCell(signal.name)}\` \`${this.escapeMarkdownCell(signal.multiplexTag)}\``
        : `\`${this.escapeMarkdownCell(signal.name)}\``;
      rows.push(
        `| ${this.getSignalTypeLabel(signal)} | ${nameCell} | ${this.escapeMarkdownCell(signal.description)} | \`${this.escapeMarkdownCell(this.formatSignalPosition(signal, message.hasPayload))}\` | ${this.escapeMarkdownCell(this.formatSignalValue(signal, message.hasPayload))} |`,
      );
    }

    markdown.appendMarkdown(rows.join("\n") + "\n\n");
  }

  private orderSignals(signals: DecodedDisplaySignal[]) {
    const roleOrder = { multiplexer: 0, multiplexed: 1, base: 2 } as const;
    return signals.slice().sort(
      (a, b) => roleOrder[a.role] - roleOrder[b.role],
    );
  }

  private getSignalTypeLabel(signal: DecodedDisplaySignal) {
    if (signal.role === "multiplexer") {
      return "复用器";
    }

    if (signal.role === "multiplexed") {
      return "当前分支";
    }

    return "基础";
  }

  private formatSignalValue(
    signal: DecodedDisplaySignal,
    hasPayload: boolean,
  ) {
    if (!hasPayload) {
      return "-";
    }

    if (signal.physValueText === "-" && signal.rawValueHexText === "-") {
      return "-";
    }

    return signal.physValueText;
  }

  private formatSignalPosition(
    signal: DecodedDisplaySignal,
    hasPayload: boolean,
  ) {
    if (!hasPayload || signal.rawValueHexText === "-") {
      return signal.locationText;
    }

    return `${signal.locationText}=${signal.rawValueHexText}`;
  }

  private escapeMarkdownCell(value: string): string {
    return value.replace(PIPE_PATTERN, "\\|").replace(NEWLINE_PATTERN, "<br/>");
  }
}
