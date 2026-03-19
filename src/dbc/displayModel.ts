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

interface BitPosition {
  byte: number;
  bit: number;
}

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
  const positions = collectSignalBitPositions(signal);
  if (positions.length === 0) {
    return "-";
  }

  positions.sort(compareBitPosition);
  const start = positions[0];
  const end = positions[positions.length - 1];
  return `${start.byte}.${start.bit}-${end.byte}.${end.bit}`;
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
    signals: buildDisplaySignals(message, undefined, undefined, extendedSelectors),
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
    ),
  };
}

function buildDisplaySignals(
  message: Message,
  boundSignals: Map<string, BoundSignal> | undefined,
  activeMultiplexerValue: number | undefined,
  extendedSelectors: Map<string, number[]>,
): DecodedDisplaySignal[] {
  const activeMultiplexedSignalNames =
    activeMultiplexerValue === undefined
      ? undefined
      : collectActiveMultiplexedSignalNames(
          message,
          activeMultiplexerValue,
          extendedSelectors,
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
): Set<string> {
  const activeNames = new Set<string>();
  const multiplexerName = findMultiplexerName(message);

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

  const sorted = [...new Set(extendedSelectors)].sort((left, right) => left - right);
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

function parseStandardMultiplexValue(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^m(\d+)$/i);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function findMultiplexerName(message: Message): string | undefined {
  for (const [name, signal] of message.signals) {
    if (signal.multiplexer) {
      return name;
    }
  }
  return undefined;
}

function collectSignalBitPositions(signal: Signal): BitPosition[] {
  if (signal.length <= 0) {
    return [];
  }

  if (signal.endian === "Intel") {
    const positions: BitPosition[] = [];
    for (let offset = 0; offset < signal.length; offset += 1) {
      const absoluteBit = signal.startBit + offset;
      positions.push({
        byte: Math.floor(absoluteBit / 8) + 1,
        bit: absoluteBit % 8,
      });
    }
    return positions;
  }

  return collectMotorolaBitPositions(signal.startBit, signal.length);
}

function collectMotorolaBitPositions(
  startBit: number,
  length: number,
): BitPosition[] {
  const endSequentialIndex =
    8 * Math.floor(startBit / 8) + (7 - (startBit % 8));
  const startSequentialIndex = endSequentialIndex - length + 1;
  const positions: BitPosition[] = [];

  for (
    let sequentialIndex = startSequentialIndex;
    sequentialIndex <= endSequentialIndex;
    sequentialIndex += 1
  ) {
    const byteIndex = Math.floor(sequentialIndex / 8);
    const bitIndexWithinByteFromMsb = sequentialIndex % 8;
    positions.push({
      byte: byteIndex + 1,
      bit: 7 - bitIndexWithinByteFromMsb,
    });
  }

  return positions;
}

function compareBitPosition(left: BitPosition, right: BitPosition) {
  if (left.byte !== right.byte) {
    return left.byte - right.byte;
  }

  return left.bit - right.bit;
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
