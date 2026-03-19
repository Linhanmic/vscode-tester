import * as vscode from "vscode";
import { BitRangeSegment, CanTransportRxFrame, ParsedTestCase } from "./types";

export class TesterRuntimeError extends Error {
  constructor(
    message: string,
    readonly range?: vscode.Range,
  ) {
    super(message);
    this.name = "TesterRuntimeError";
  }
}

export class TesterCancellationError extends Error {
  constructor() {
    super("运行已取消");
    this.name = "TesterCancellationError";
  }
}

export class RunnerCancellation {
  private cancelled = false;

  constructor(token: vscode.CancellationToken) {
    token.onCancellationRequested(() => {
      this.cancelled = true;
    });
  }

  throwIfRequested() {
    if (this.cancelled) {
      throw new TesterCancellationError();
    }
  }

  isCancellationRequested() {
    return this.cancelled;
  }
}

export function toRange(node: {
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}): vscode.Range {
  return new vscode.Range(
    node.startPosition.row,
    node.startPosition.column,
    node.endPosition.row,
    node.endPosition.column,
  );
}

export function parseInteger(
  value: string,
  label: string,
  range?: vscode.Range,
  minimum = 0,
): number {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new TesterRuntimeError(`${label} 必须是 >= ${minimum} 的整数`, range);
  }
  return parsed;
}

export function parseHexLike(text: string): number {
  const normalized = text.trim().replace(/^0x/i, "");
  return Number.parseInt(normalized, 16);
}

export function parseDataSequence(text: string): number[] {
  return text
    .trim()
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((byteText) => Number.parseInt(byteText, 16));
}

export function parseBitRangeSegment(
  text: string,
  range?: vscode.Range,
): BitRangeSegment {
  const match = text
    .trim()
    .match(/^(\d+)\.(\d+)-(\d+)\.(\d+)$/);
  if (!match) {
    throw new TesterRuntimeError(`非法位域范围: ${text}`, range);
  }

  const startByte = Number.parseInt(match[1], 10);
  const startBit = Number.parseInt(match[2], 10);
  const endByte = Number.parseInt(match[3], 10);
  const endBit = Number.parseInt(match[4], 10);

  if (startBit > 7 || endBit > 7) {
    throw new TesterRuntimeError(`位索引必须在 0-7 之间: ${text}`, range);
  }

  const startIndex = startByte * 8 + startBit;
  const endIndex = endByte * 8 + endBit;
  if (endIndex < startIndex) {
    throw new TesterRuntimeError(`位域结束位置不能小于开始位置: ${text}`, range);
  }

  return {
    text: text.trim(),
    startByte,
    startBit,
    endByte,
    endBit,
    widthBits: endIndex - startIndex + 1,
  };
}

export function parseExpectedScalar(text: string, widthBits: number): number {
  const normalized = text.trim();
  if (/^0x/i.test(normalized) || /[A-Fa-f]/.test(normalized)) {
    return parseHexLike(normalized);
  }

  if (widthBits > 8 && normalized.length > 2 && normalized.length % 2 === 0) {
    return parseHexLike(normalized);
  }

  return Number.parseInt(normalized, 10);
}

export function formatMessageId(id: number): string {
  return `0x${id.toString(16).toUpperCase()}`;
}

export function formatDataBytes(data: readonly number[] | Buffer): string {
  return Array.from(data)
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
    .join("-");
}

export function isExtendedFrame(id: number): boolean {
  return id > 0x7ff;
}

export function caseLabel(testCase: ParsedTestCase): string {
  return testCase.label;
}

export async function sleepInterruptible(
  milliseconds: number,
  cancellation: RunnerCancellation,
  isCancelled?: () => boolean,
) {
  let remaining = milliseconds;
  while (remaining > 0) {
    cancellation.throwIfRequested();
    if (isCancelled?.()) {
      return;
    }

    const currentSlice = Math.min(remaining, 50);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, currentSlice);
    });
    remaining -= currentSlice;
  }
}

export function extractRangeValue(
  frame: CanTransportRxFrame,
  segment: BitRangeSegment,
): number {
  let value = 0;
  let offset = 0;

  for (let byteIndex = segment.startByte; byteIndex <= segment.endByte; byteIndex += 1) {
    const startBit = byteIndex === segment.startByte ? segment.startBit : 0;
    const endBit = byteIndex === segment.endByte ? segment.endBit : 7;
    const currentByte = frame.data[byteIndex] ?? 0;

    for (let bitIndex = startBit; bitIndex <= endBit; bitIndex += 1) {
      const bit = (currentByte >> bitIndex) & 0x1;
      value |= bit << offset;
      offset += 1;
    }
  }

  return value;
}
