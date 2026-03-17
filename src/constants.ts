import * as vscode from "vscode";

export const LANGUAGE_ID = "tester";
export const DOCUMENT_SELECTOR: vscode.DocumentFilter = {
  scheme: "file",
  language: LANGUAGE_ID,
};

// Tree-sitter node types based on grammar.js
export const CAN_COMMAND_NODE_TYPES = new Set([
  "tcans_command",
  "tcanr_bit_compare_command",
  "tcanr_direct_compare_command",
  "tcanr_print_command",
]);

export const TCANS_NODE_TYPE = "tcans_command";
export const TCANR_NODE_TYPES = [
  "tcanr_bit_compare_command",
  "tcanr_direct_compare_command",
  "tcanr_print_command",
] as const;

// All Tester DSL keywords (for future keyword completion)
export const TESTER_KEYWORDS = [
  "tset",
  "tend",
  "ttitle",
  "ttitle-end",
  "tstart",
  "tcans",
  "tcanr",
  "tdelay",
  "tcaninit",
  "tcans_ch_def",
  "tdiagnose_sid",
  "tdiagnose_rid",
  "tdiagnose_keyk",
  "tdiagnose_dtc",
  "tnote",
  "tconfirm",
  "tenum",
  "tbitfield",
] as const;
