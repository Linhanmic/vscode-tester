import * as vscode from "vscode";
import { Tree, Node } from "web-tree-sitter";
import { TreeManager } from "../parser/treeManager";
import { DbcManager } from "../dbc/dbcManager";
import { CAN_COMMAND_NODE_TYPES } from "../constants";
import { CanCommandInfo } from "../types";

export class TesterHoverProvider implements vscode.HoverProvider {
  constructor(
    private treeManager: TreeManager,
    private dbcManager: DbcManager,
  ) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | null {
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
      const markdown = this.buildMarkdown(info);
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
    return text.split(/[-\s]+/).map((b) => parseInt(b, 16));
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

  private formatMessageId(id: number): string {
    return `0x${id.toString(16).toUpperCase().padStart(3, "0")}`;
  }

  private buildMarkdown(info: CanCommandInfo): vscode.MarkdownString | null {
    if (info.type === "full_decode") {
      return this.buildFullDecodeMarkdown(info);
    } else {
      return this.buildMessageInfoMarkdown(info);
    }
  }

  private buildFullDecodeMarkdown(info: {
    messageId: number;
    dataBytes: number[];
    nodeType: string;
  }): vscode.MarkdownString {
    const boundMessage = this.dbcManager.decodeMessage(
      info.messageId,
      info.dataBytes,
    );

    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const dataHex = info.dataBytes
      .map((b: number) => b.toString(16).padStart(2, "0").toUpperCase())
      .join(" ");

    if (!boundMessage) {
      md.appendMarkdown(`### ⚠️ 报文解析失败\n\n`);
      md.appendMarkdown(`**ID**: ${this.formatMessageId(info.messageId)}\n\n`);
      md.appendMarkdown(`**数据**: ${dataHex}\n\n`);
      return md;
    }

    const message = boundMessage.boundData.message;
    const signals = boundMessage.boundSignals;

    md.appendMarkdown(`### 📋 ${message.name}\n\n`);

    if (message.description) {
      md.appendMarkdown(`> ${message.description}\n\n`);
    }

    md.appendMarkdown(
      `**ID**: ${this.formatMessageId(message.id)} (${message.id})`,
    );
    md.appendMarkdown(` | **DLC**: ${message.dlc}`);
    if (message.sendingNode) {
      md.appendMarkdown(` | **节点**: ${message.sendingNode}`);
    }
    md.appendMarkdown(`\n\n`);

    md.appendMarkdown(`**数据**: ${dataHex}\n\n`);

    md.appendMarkdown(`---\n\n`);

    if (signals.size === 0) {
      md.appendMarkdown(`*该报文无信号定义*\n\n`);
      return md;
    }

    md.appendMarkdown(`#### 🔍 信号详情\n\n`);
    md.appendMarkdown(`| 信号名 | 描述 | 物理值 | 原始值 |\n`);
    md.appendMarkdown(`|:-------|:-----|:-------|:-------|\n`);

    signals.forEach((boundSignal: any, signalName: string) => {
      const signalDef = message.signals.get(signalName);
      const description = signalDef?.description || "-";
      const physValue = boundSignal.physValue || `${boundSignal.value}`;

      md.appendMarkdown(
        `| \`${signalName}\` | ${description} | **${physValue}** | ${boundSignal.rawValue} |\n`,
      );
    });

    md.appendMarkdown(`\n`);
    return md;
  }

  private buildMessageInfoMarkdown(info: {
    messageId: number;
    bitRange?: string;
    nodeType: string;
  }): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    md.appendMarkdown(`### 📋 CAN 接收命令\n\n`);
    md.appendMarkdown(`**ID**: ${this.formatMessageId(info.messageId)}\n\n`);

    if (info.bitRange) {
      md.appendMarkdown(`**位域范围**: ${info.bitRange}\n\n`);
    }

    if (info.nodeType === "tcanr_print_command") {
      md.appendMarkdown(`**模式**: 打印输出\n\n`);
    } else {
      md.appendMarkdown(`**模式**: 位域对比\n\n`);
    }

    // Try to get message name from DBC
    if (this.dbcManager.isLoaded()) {
      const testFrame = this.dbcManager.decodeMessage(info.messageId, []);
      if (testFrame) {
        const msgName = testFrame.boundData.message.name;
        if (msgName) {
          md.appendMarkdown(`**报文名称**: ${msgName}\n\n`);
        }
      }
    }

    return md;
  }
}
