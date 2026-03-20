import * as vscode from "vscode";
import { validateDeviceRuleChannelConfig } from "../can/deviceRules";
import { Node } from "web-tree-sitter";
import { TreeManager } from "../parser/treeManager";
import {
  CaseCommand,
  ParsedDelayCommand,
  ParsedReceiveBitCommand,
  ParsedReceiveDirectCommand,
  ParsedReceivePrintCommand,
  ParsedSendCommand,
  ParsedTestCase,
  ParsedTestDocument,
  ParsedTestSuite,
  ResolvedChannelConfig,
} from "./types";
import {
  VALID_ARBITRATION_BAUD_RATES_KBPS,
  VALID_DATA_BAUD_RATES_KBPS,
  formatBaudRateHint,
  CAN_FD_MAX_BYTES,
} from "../zlgcan/constants";
import {
  parseBitRangeSegment,
  parseDataSequence,
  parseExpectedScalar,
  parseHexLike,
  parseInteger,
  TesterRuntimeError,
  toRange,
} from "./utils";

const EXECUTABLE_COMMAND_TYPES = new Set([
  "tcans_command",
  "tcanr_bit_compare_command",
  "tcanr_direct_compare_command",
  "tcanr_print_command",
  "tdelay_command",
]);

export class TesterRuntimeParser {
  constructor(private readonly treeManager: TreeManager) {}

  parseDocument(document: vscode.TextDocument): ParsedTestDocument {
    const tree = this.treeManager.getTree(document);
    const configuration: ResolvedChannelConfig[] = [];
    const suites: ParsedTestSuite[] = [];

    this.traverse(tree.rootNode, (node) => {
      if (node.type === "tcaninit_command") {
        configuration.push(this.parseChannelConfig(node));
      } else if (node.type === "test_suite") {
        suites.push(this.parseSuite(node));
      }
    });

    return {
      configuration,
      suites,
    };
  }

  private parseChannelConfig(node: Node): ResolvedChannelConfig {
    const range = toRange(node);
    const deviceId = parseInteger(
      this.requireFieldText(node, "device_id", range),
      "device_id",
      range,
    );
    const arbitrationBaudRateKbps = this.parseBaudRateKbps(
      this.requireFieldText(node, "arbitration_baudrate", range),
      "仲裁域波特率",
      range,
    );
    const dataBaudRateText = this.optionalFieldText(node, "data_baudrate");
    const dataBaudRateKbps = dataBaudRateText
      ? this.parseBaudRateKbps(dataBaudRateText, "数据域波特率", range)
      : undefined;

    const validationMessage = validateDeviceRuleChannelConfig({
      deviceId,
      arbitrationBaudRateKbps,
      dataBaudRateKbps,
    });
    if (validationMessage) {
      throw new TesterRuntimeError(validationMessage, range);
    }

    return {
      range,
      startLine: range.start.line,
      deviceId,
      deviceIndex: parseInteger(
        this.requireFieldText(node, "device_index", range),
        "device_index",
        range,
      ),
      channelIndex: parseInteger(
        this.requireFieldText(node, "channel_index", range),
        "channel_index",
        range,
      ),
      arbitrationBaudRateKbps,
      arbitrationBaudRateBps: arbitrationBaudRateKbps * 1000,
      dataBaudRateKbps,
      dataBaudRateBps:
        dataBaudRateKbps === undefined ? undefined : dataBaudRateKbps * 1000,
    };
  }

  private parseBaudRateKbps(
    text: string,
    label: string,
    range: vscode.Range,
  ) {
    const value = parseInteger(text, label, range, 1);
    if (value >= 100000 && value % 1000 === 0) {
      throw new TesterRuntimeError(
        `${label} 单位是 kbps，请写成 ${value / 1000} 而不是 ${value}`,
        range,
      );
    }
    const validSet = label.includes("数据域")
      ? VALID_DATA_BAUD_RATES_KBPS
      : VALID_ARBITRATION_BAUD_RATES_KBPS;
    if (!validSet.has(value)) {
      throw new TesterRuntimeError(
        `${label} ${value} kbps 不在 ZLGCAN 支持范围内，有效值: ${formatBaudRateHint(validSet)}`,
        range,
      );
    }
    return value;
  }

  private parseSuite(node: Node): ParsedTestSuite {
    const range = toRange(node);
    return {
      title: this.requireFieldText(node, "title", range).trim(),
      cases: node.namedChildren
        .filter((child) => child.type === "test_case")
        .map((child) => this.parseCase(child)),
      range,
      startLine: range.start.line,
    };
  }

  private parseCase(node: Node): ParsedTestCase {
    const range = toRange(node);
    const idText = this.optionalFieldText(node, "id");
    const id = idText ? parseInteger(idText, "测试用例编号", range) : undefined;
    const title = this.requireFieldText(node, "title", range).trim();

    return {
      id,
      title,
      label: id === undefined ? title : `${id}. ${title}`,
      commands: node.namedChildren
        .filter((child) => child.type === "test_command")
        .map((child) => this.parseCommand(child)),
      range,
      startLine: range.start.line,
    };
  }

  private parseCommand(node: Node): CaseCommand {
    const executableNode = this.resolveExecutableNode(node);
    if (!executableNode) {
      throw new TesterRuntimeError("不支持的命令类型", toRange(node));
    }

    switch (executableNode.type) {
      case "tcans_command":
        return this.parseSendCommand(executableNode);
      case "tcanr_direct_compare_command":
        return this.parseReceiveDirectCommand(executableNode);
      case "tcanr_bit_compare_command":
        return this.parseReceiveBitCommand(executableNode);
      case "tcanr_print_command":
        return this.parseReceivePrintCommand(executableNode);
      case "tdelay_command":
        return this.parseDelayCommand(executableNode);
      default:
        throw new TesterRuntimeError(
          `不支持的命令类型: ${executableNode.type}`,
          toRange(executableNode),
        );
    }
  }

  private parseSendCommand(node: Node): ParsedSendCommand {
    const range = toRange(node);
    const channelText = this.optionalFieldText(node, "send_channel");
    const dataBytes = parseDataSequence(
      this.requireFieldText(node, "message_data", range),
    );
    if (dataBytes.length > CAN_FD_MAX_BYTES) {
      throw new TesterRuntimeError(
        `报文数据长度 ${dataBytes.length} 超过 CAN FD 最大 ${CAN_FD_MAX_BYTES} 字节`,
        range,
      );
    }

    return {
      kind: "tcans",
      messageId: parseHexLike(this.requireFieldText(node, "message_id", range)),
      dataBytes,
      periodMs: parseInteger(
        this.requireFieldText(node, "period", range),
        "发送周期",
        range,
      ),
      count: parseInteger(
        this.requireFieldText(node, "count", range),
        "发送次数",
        range,
      ),
      channelOverride: channelText
        ? parseInteger(channelText, "发送通道", range)
        : undefined,
      rawText: node.text.trim(),
      range,
      startLine: range.start.line,
    };
  }

  private parseReceiveDirectCommand(node: Node): ParsedReceiveDirectCommand {
    const range = toRange(node);
    const channelText = this.optionalFieldText(node, "receive_channel");

    return {
      kind: "tcanr_direct",
      messageId: parseHexLike(this.requireFieldText(node, "message_id", range)),
      expectedBytes: parseDataSequence(
        this.requireFieldText(node, "expected_data", range),
      ),
      waitTimeMs: parseInteger(
        this.requireFieldText(node, "wait_time", range),
        "等待时间",
        range,
      ),
      channelOverride: channelText
        ? parseInteger(channelText, "接收通道", range)
        : undefined,
      rawText: node.text.trim(),
      range,
      startLine: range.start.line,
    };
  }

  private parseReceiveBitCommand(node: Node): ParsedReceiveBitCommand {
    const range = toRange(node);
    const ranges = this.requireFieldText(node, "expected_bit_range", range)
      .split("+")
      .map((item) => parseBitRangeSegment(item, range));
    const expectedValues = this.requireFieldText(node, "expected_data", range)
      .split("+")
      .map((item, index) => parseExpectedScalar(item, ranges[index]?.widthBits ?? 8));

    if (ranges.length !== expectedValues.length) {
      throw new TesterRuntimeError("位域数量与期望值数量不一致", range);
    }

    const channelText = this.optionalFieldText(node, "receive_channel");

    return {
      kind: "tcanr_bit",
      messageId: parseHexLike(this.requireFieldText(node, "message_id", range)),
      ranges,
      expectedValues,
      waitTimeMs: parseInteger(
        this.requireFieldText(node, "wait_time", range),
        "等待时间",
        range,
      ),
      channelOverride: channelText
        ? parseInteger(channelText, "接收通道", range)
        : undefined,
      rawText: node.text.trim(),
      range,
      startLine: range.start.line,
    };
  }

  private parseReceivePrintCommand(node: Node): ParsedReceivePrintCommand {
    const range = toRange(node);
    const channelText = this.optionalFieldText(node, "receive_channel");

    return {
      kind: "tcanr_print",
      messageId: parseHexLike(this.requireFieldText(node, "message_id", range)),
      ranges: this.requireFieldText(node, "expected_bit_range", range)
        .split("+")
        .map((item) => parseBitRangeSegment(item, range)),
      channelOverride: channelText
        ? parseInteger(channelText, "接收通道", range)
        : undefined,
      rawText: node.text.trim(),
      range,
      startLine: range.start.line,
    };
  }

  private parseDelayCommand(node: Node): ParsedDelayCommand {
    const range = toRange(node);
    return {
      kind: "tdelay",
      delayMs: parseInteger(
        this.requireFieldText(node, "delay_time", range),
        "延时时间",
        range,
      ),
      rawText: node.text.trim(),
      range,
      startLine: range.start.line,
    };
  }

  private resolveExecutableNode(node: Node): Node | null {
    if (EXECUTABLE_COMMAND_TYPES.has(node.type)) {
      return node;
    }

    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (!child) {
        continue;
      }

      const resolved = this.resolveExecutableNode(child);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  private optionalFieldText(node: Node, fieldName: string): string | undefined {
    return node.childForFieldName(fieldName)?.text.trim();
  }

  private requireFieldText(
    node: Node,
    fieldName: string,
    range: vscode.Range,
  ): string {
    const value = this.optionalFieldText(node, fieldName);
    if (!value) {
      throw new TesterRuntimeError(`缺少字段 ${fieldName}`, range);
    }
    return value;
  }

  private traverse(node: Node, callback: (node: Node) => void) {
    callback(node);
    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (child) {
        this.traverse(child, callback);
      }
    }
  }
}
