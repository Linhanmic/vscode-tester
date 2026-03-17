import * as vscode from "vscode";

// CAN full frame info (tcans / tcanr_direct_compare - has complete data for decoding)
export interface CanFullDecodeInfo {
  type: "full_decode";
  messageId: number;
  dataBytes: number[];
  nodeType: string;
}

// CAN message-only info (tcanr_bit_compare / tcanr_print - no full data)
export interface CanMessageOnlyInfo {
  type: "message_info";
  messageId: number;
  bitRange?: string;
  nodeType: string;
}

// Unified CAN command info type
export type CanCommandInfo = CanFullDecodeInfo | CanMessageOnlyInfo;

// Extracted command for completion
export interface ExtractedCommand {
  commandType: "tcans" | "tcanr";
  insertText: string;
  label: string;
  detail: string;
  documentation?: vscode.MarkdownString;
  sortText: string;
  filterText: string;
}

// Command type
export type TesterCommandType = "tcans" | "tcanr";

// DBC bound signal
export interface BoundSignal {
  physValue?: string;
  value: number;
  rawValue: number;
}

// DBC signal definition
export interface SignalDefinition {
  description?: string;
}
