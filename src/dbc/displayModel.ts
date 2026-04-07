import type { BoundSignal } from "candied/lib/can/Can";
import type { Message, Signal } from "candied/lib/dbc/Dbc";

export type DecodedDisplaySignalRole = "base" | "multiplexer" | "multiplexed";

export interface DecodedDisplaySignal {
  name: string;
  description: string;
  locationText: string;
  physValueText: string;
  rawValueText: string;
  rawValueHexText: string;
  role: DecodedDisplaySignalRole;
  multiplexTag?: string;
}

export interface DecodedDisplayMessage {
  kind: "message";
  id: number;
  idHex: string;
  name: string;
  description?: string;
  dlc: number;
  sendingNode?: string;
  dataBytes: number[];
  dataText: string;
  hasPayload: boolean;
  multiplexerName?: string;
  multiplexerValue?: number;
  signals: DecodedDisplaySignal[];
}

export type DecodedDisplayErrorCode =
  | "dbc_not_loaded"
  | "message_not_found"
  | "payload_length_mismatch"
  | "invalid_input";

export interface DecodedDisplayError {
  kind: "error";
  code: DecodedDisplayErrorCode;
  message: string;
  id?: number;
  idHex?: string;
  expectedDlc?: number;
  actualDlc?: number;
}

export type DbcDisplayResult = DecodedDisplayMessage | DecodedDisplayError;

export function isDecodedDisplayError(
  result: DbcDisplayResult,
): result is DecodedDisplayError {
  return result.kind === "error";
}

export function formatMessageId(messageId: number): string {
  return `0x${messageId.toString(16).toUpperCase().padStart(3, "0")}`;
}

export function formatDisplayDataBytes(dataBytes: readonly number[]): string {
  return dataBytes
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}

export function formatSignalLocation(signal: Signal): string {
  if (signal.length <= 0) {
    return "-";
  }

  const range = computeSignalBitRange(signal);
  if (!range) {
    return "-";
  }

  return `${range.startByte}.${range.startBit}-${range.endByte}.${range.endBit}`;
}

export function buildMessageDefinitionDisplay(
  message: Message,
): DecodedDisplayMessage {
  const multiplexerName = findMultiplexerName(message);
  const extendedSelectors = collectExtendedMultiplexSelectors(
    message,
    multiplexerName,
  );

  return {
    kind: "message",
    id: message.id,
    idHex: formatMessageId(message.id),
    name: message.name,
    description: message.description ?? undefined,
    dlc: message.dlc,
    sendingNode: message.sendingNode ?? undefined,
    dataBytes: [],
    dataText: "-",
    hasPayload: false,
    multiplexerName,
    signals: buildDisplaySignals(message, undefined, undefined, extendedSelectors, multiplexerName),
  };
}

export function buildDecodedMessageDisplay(
  message: Message,
  dataBytes: readonly number[],
  boundSignals: Map<string, BoundSignal>,
): DecodedDisplayMessage {
  const multiplexerName = findMultiplexerName(message);
  const multiplexerValue =
    multiplexerName !== undefined
      ? boundSignals.get(multiplexerName)?.rawValue
      : undefined;
  const extendedSelectors = collectExtendedMultiplexSelectors(
    message,
    multiplexerName,
  );

  return {
    kind: "message",
    id: message.id,
    idHex: formatMessageId(message.id),
    name: message.name,
    description: message.description ?? undefined,
    dlc: message.dlc,
    sendingNode: message.sendingNode ?? undefined,
    dataBytes: [...dataBytes],
    dataText: formatDisplayDataBytes(dataBytes),
    hasPayload: true,
    multiplexerName,
    multiplexerValue,
    signals: buildDisplaySignals(
      message,
      boundSignals,
      multiplexerValue,
      extendedSelectors,
      multiplexerName,
    ),
  };
}

function buildDisplaySignals(
  message: Message,
  boundSignals: Map<string, BoundSignal> | undefined,
  activeMultiplexerValue: number | undefined,
  extendedSelectors: Map<string, number[]>,
  multiplexerName: string | undefined,
): DecodedDisplaySignal[] {
  const activeMultiplexedSignalNames =
    activeMultiplexerValue === undefined
      ? undefined
      : collectActiveMultiplexedSignalNames(
          message,
          activeMultiplexerValue,
          extendedSelectors,
          multiplexerName,
        );

  const signals: DecodedDisplaySignal[] = [];

  for (const [name, signal] of message.signals) {
    const role = resolveSignalRole(signal, extendedSelectors.has(name));
    if (
      role === "multiplexed" &&
      activeMultiplexedSignalNames &&
      !activeMultiplexedSignalNames.has(name)
    ) {
      continue;
    }

    const boundSignal = boundSignals?.get(name);
    signals.push({
      name,
      description: signal.description ?? "-",
      locationText: formatSignalLocation(signal),
      physValueText: boundSignal
        ? (boundSignal.physValue?.trim() || `${boundSignal.value}`)
        : "-",
      rawValueText: boundSignal ? `${boundSignal.rawValue}` : "-",
      rawValueHexText: boundSignal
        ? formatRawValueHex(boundSignal.rawValue)
        : "-",
      role,
      multiplexTag: resolveMultiplexTag(
        signal,
        extendedSelectors.get(name),
        activeMultiplexerValue,
      ),
    });
  }

  return signals;
}

function collectActiveMultiplexedSignalNames(
  message: Message,
  activeMultiplexerValue: number,
  extendedSelectors: Map<string, number[]>,
  multiplexerName: string | undefined,
): Set<string> {
  const activeNames = new Set<string>();

  for (const [name, signal] of message.signals) {
    const selectorValue = parseStandardMultiplexValue(signal.multiplex);
    if (selectorValue !== null && selectorValue === activeMultiplexerValue) {
      activeNames.add(name);
      continue;
    }

    const selectors = extendedSelectors.get(name);
    if (selectors?.includes(activeMultiplexerValue)) {
      activeNames.add(name);
    }
  }

  if (!multiplexerName) {
    return activeNames;
  }

  const root = message.multiplexSignals.get(multiplexerName);
  const children = root?.children.get(activeMultiplexerValue) ?? [];
  for (const child of children) {
    activeNames.add(child.signal.name);
  }

  return activeNames;
}

function collectExtendedMultiplexSelectors(
  message: Message,
  multiplexerName: string | undefined,
): Map<string, number[]> {
  const selectors = new Map<string, number[]>();
  if (!multiplexerName) {
    return selectors;
  }

  const root = message.multiplexSignals.get(multiplexerName);
  if (!root) {
    return selectors;
  }

  for (const [value, children] of root.children) {
    for (const child of children) {
      const list = selectors.get(child.signal.name) ?? [];
      list.push(value);
      selectors.set(child.signal.name, list);
    }
  }

  return selectors;
}

function resolveSignalRole(
  signal: Signal,
  hasExtendedSelectors: boolean,
): DecodedDisplaySignalRole {
  if (signal.multiplexer) {
    return "multiplexer";
  }

  if (
    parseStandardMultiplexValue(signal.multiplex) !== null ||
    hasExtendedSelectors
  ) {
    return "multiplexed";
  }

  return "base";
}

function resolveMultiplexTag(
  signal: Signal,
  extendedSelectors: number[] | undefined,
  activeMultiplexerValue: number | undefined,
): string | undefined {
  if (signal.multiplexer) {
    return "M";
  }

  const standardValue = parseStandardMultiplexValue(signal.multiplex);
  if (standardValue !== null) {
    return `m${standardValue}`;
  }

  if (!extendedSelectors?.length) {
    return undefined;
  }

  if (
    activeMultiplexerValue !== undefined &&
    extendedSelectors.includes(activeMultiplexerValue)
  ) {
    return `m${activeMultiplexerValue}`;
  }

  const sorted = Array.from(new Set(extendedSelectors)).sort((left, right) => left - right);
  if (sorted.length === 1) {
    return `m${sorted[0]}`;
  }

  const ranges: string[] = [];
  let rangeStart = sorted[0];
  let previous = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push(formatSelectorRange(rangeStart, previous));
    rangeStart = current;
    previous = current;
  }

  ranges.push(formatSelectorRange(rangeStart, previous));
  return `m${ranges.join("/")}`;
}

function formatSelectorRange(start: number, end: number) {
  return start === end ? `${start}` : `${start}-${end}`;
}

const STANDARD_MULTIPLEX_PATTERN = /^m(\d+)$/i;
const multiplexValueCache = new Map<string, number | null>();

function parseStandardMultiplexValue(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const cached = multiplexValueCache.get(value);
  if (cached !== undefined) {
    return cached;
  }

  const match = value.match(STANDARD_MULTIPLEX_PATTERN);
  const result = match ? Number.parseInt(match[1], 10) : null;
  multiplexValueCache.set(value, result);
  return result;
}

function findMultiplexerName(message: Message): string | undefined {
  for (const [name, signal] of message.signals) {
    if (signal.multiplexer) {
      return name;
    }
  }
  return undefined;
}

interface BitRange {
  startByte: number;
  startBit: number;
  endByte: number;
  endBit: number;
}

function computeSignalBitRange(signal: Signal): BitRange | null {
  if (signal.length <= 0) {
    return null;
  }

  if (signal.endian === "Intel") {
    const firstBit = signal.startBit;
    const lastBit = signal.startBit + signal.length - 1;
    return {
      startByte: Math.floor(firstBit / 8) + 1,
      startBit: firstBit % 8,
      endByte: Math.floor(lastBit / 8) + 1,
      endBit: lastBit % 8,
    };
  }

  // Motorola: compute start and end positions directly
  const endSeqIndex = 8 * Math.floor(signal.startBit / 8) + (7 - (signal.startBit % 8));
  const startSeqIndex = endSeqIndex - signal.length + 1;

  const startByteIndex = Math.floor(startSeqIndex / 8);
  const startBitFromMsb = startSeqIndex % 8;
  const endByteIndex = Math.floor(endSeqIndex / 8);
  const endBitFromMsb = endSeqIndex % 8;

  // Sort by byte.bit ascending
  const s = { byte: startByteIndex + 1, bit: 7 - startBitFromMsb };
  const e = { byte: endByteIndex + 1, bit: 7 - endBitFromMsb };

  if (s.byte < e.byte || (s.byte === e.byte && s.bit < e.bit)) {
    return { startByte: s.byte, startBit: s.bit, endByte: e.byte, endBit: e.bit };
  }
  return { startByte: e.byte, startBit: e.bit, endByte: s.byte, endBit: s.bit };
}

function formatRawValueHex(rawValue: number): string {
  if (!Number.isFinite(rawValue)) {
    return `${rawValue}`;
  }

  if (!Number.isInteger(rawValue)) {
    return `${rawValue}`;
  }

  const prefix = rawValue < 0 ? "-0x" : "0x";
  return `${prefix}${Math.abs(rawValue).toString(16).toUpperCase()}`;
}
