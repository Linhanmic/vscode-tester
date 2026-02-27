// TesterHoverProvider.ts
import * as vscode from "vscode";
import { Tree } from "web-tree-sitter";
import { TreeManager } from "./treeManager";
import { DbcManager } from "./dbcManager";

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
    const node = this.findTcansNode(tree, document, position);
    if (!node) {
      console.log(`No tcans_command node found at position ${position}`);
      return null;
    }

    const info = this.extractTcansInfo(node, document);
    if (!info) {
      console.log(
        `Failed to extract tcans info from node at position ${position}`,
      );
      return null;
    }
    try {
      const markdown = this.buildMarkdown(info);
      if (!markdown) {
        console.log(
          `Failed to build markdown for tcans info at position ${position}`,
        );
        return null;
      }
      return new vscode.Hover(markdown);
    } catch (e) {
      console.error("Error building hover markdown:", e);
      return null;
    }

    // return new vscode.Hover(markdown);
  }

  private findTcansNode(
    tree: Tree,
    document: vscode.TextDocument,
    position: vscode.Position,
  ) {
    const offset = document.offsetAt(position);
    let node = tree.rootNode.descendantForIndex(offset);

    while (node) {
      if (node.type === "tcans_command") {
        return node;
      }
      console.log(
        `Visited node: ${node.type} [${node.startIndex}, ${node.endIndex}]`,
      );
      node = node.parent;
    }

    return null;
  }

  private extractTcansInfo(node: any, document: vscode.TextDocument) {
    const idNode = node.childForFieldName("message_id");
    const dataNode = node.childForFieldName("message_data");
    if (!idNode || !dataNode) {
      return null;
    }

    const idText = document.getText(
      new vscode.Range(
        document.positionAt(idNode.startIndex),
        document.positionAt(idNode.endIndex),
      ),
    );

    const messageId = parseInt(idText, 16);

    const dataText = document.getText(
      new vscode.Range(
        document.positionAt(dataNode.startIndex),
        document.positionAt(dataNode.endIndex),
      ),
    );

    const dataBytes = dataText.split(/[-\s]+/).map((b) => parseInt(b, 16));

    return { messageId, dataBytes };
  }

private buildMarkdown(info: any) {
  const boundMessage = this.dbcManager.decodeMessage(info.messageId, info.dataBytes);

  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  if (!boundMessage) {
    md.appendMarkdown(`### ⚠️ 报文解析失败\n\n`);
    md.appendMarkdown(
      `**ID**: 0x${info.messageId.toString(16).toUpperCase().padStart(3, '0')}\n\n`
    );
    md.appendMarkdown(
      `**数据**: ${info.dataBytes
        .map((b: number) => b.toString(16).padStart(2, "0").toUpperCase())
        .join(" ")}\n\n`
    );
    return md;
  }

  const message = boundMessage.boundData.message;
  const signals = boundMessage.boundSignals;

  // 报文标题 - 显示原始名称
  md.appendMarkdown(`### 📋 ${message.name}\n\n`);
  
  // 报文描述（如果存在）
  if (message.description) {
    md.appendMarkdown(`> ${message.description}\n\n`);
  }
  
  // 报文基本信息
  md.appendMarkdown(`**ID**: 0x${message.id.toString(16).toUpperCase().padStart(3, '0')} (${message.id})`);
  md.appendMarkdown(` | **DLC**: ${message.dlc}`);
  if (message.sendingNode) {
    md.appendMarkdown(` | **节点**: ${message.sendingNode}`);
  }
  md.appendMarkdown(`\n\n`);
  
  // 原始数据
  md.appendMarkdown(
    `**数据**: ${info.dataBytes
      .map((b: number) => b.toString(16).padStart(2, "0").toUpperCase())
      .join(" ")}\n\n`
  );
  
  md.appendMarkdown(`---\n\n`);

  if (signals.size === 0) {
    md.appendMarkdown(`*该报文无信号定义*\n\n`);
    return md;
  }

  // 信号表格 - 包含描述列
  md.appendMarkdown(`#### 🔍 信号详情\n\n`);
  md.appendMarkdown(`| 信号名 | 描述 | 物理值 | 原始值 |\n`);
  md.appendMarkdown(`|:-------|:-----|:-------|:-------|\n`);

  signals.forEach((boundSignal: any, signalName: string) => {
    const signalDef = message.signals.get(signalName);
    
    // 描述列
    const description = signalDef?.description || '-';
    
    // 物理值（带单位）
    const physValue = boundSignal.physValue || `${boundSignal.value}`;

    md.appendMarkdown(
      `| \`${signalName}\` | ${description} | **${physValue}** | ${boundSignal.rawValue} |\n`
    );
  });

  md.appendMarkdown(`\n`);

  return md;
}

  // 添加辅助方法：从 DBC 数据获取消息定义
  private getMessageDefinition(messageId: number) {
    if (!this.dbcManager.isLoaded()) {
      return null;
    }

    // 访问 dbcData 中的消息定义
    // 根据 candied 库的结构调整访问方式
    const dbcData = (this.dbcManager as any).dbcData;

    // 假设 dbcData.messages 是 Map 或对象
    if (dbcData?.messages) {
      // 如果是 Map
      if (dbcData.messages instanceof Map) {
        return dbcData.messages.get(messageId);
      }
      // 如果是对象
      return dbcData.messages[messageId];
    }

    return null;
  }
}
