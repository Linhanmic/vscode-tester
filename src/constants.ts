import * as vscode from "vscode";

export const LANGUAGE_ID = "tester";
export const DOCUMENT_SELECTOR: vscode.DocumentFilter = {
  scheme: "file",
  language: LANGUAGE_ID,
};

export const CAN_COMMAND_NODE_TYPES = new Set([
  "tcans_command",
  "tcanr_bit_compare_command",
  "tcanr_direct_compare_command",
  "tcanr_print_command",
]);
