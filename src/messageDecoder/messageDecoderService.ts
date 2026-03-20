import * as vscode from "vscode";
import { DbcManager } from "../dbc/dbcManager";
import { isDecodedDisplayError } from "../dbc/displayModel";
import { parseMessageDecoderInput } from "../providers/messageDecoderInput";
import type {
  StudioDecoderMessageItem,
  StudioDecoderResultItem,
  StudioDecoderSnapshot,
  StudioDecoderStatus,
} from "../studio/types";

export class MessageDecoderService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<StudioDecoderSnapshot>();
  private readonly disposables: vscode.Disposable[] = [];
  private snapshot: StudioDecoderSnapshot;

  constructor(private readonly dbcManager: DbcManager) {
    this.snapshot = this.createEmptySnapshot();
    this.disposables.push(
      this.emitter,
      this.dbcManager.onDidChangeStatus(() => {
        this.snapshot = {
          ...this.snapshot,
          status: this.createStatusPayload(),
        };
        this.emitter.fire(this.getSnapshot());
      }),
    );
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  getSnapshot(): StudioDecoderSnapshot {
    return {
      loadState: this.snapshot.loadState,
      message: this.snapshot.message,
      status: { ...this.snapshot.status },
      items: this.snapshot.items.map((item) =>
        item.kind === "error"
          ? { ...item }
          : {
              ...item,
              message: {
                ...item.message,
                signals: item.message.signals.map((signal) => ({ ...signal })),
              },
            },
      ),
      summary: { ...this.snapshot.summary },
    };
  }

  get onDidChangeSnapshot(): vscode.Event<StudioDecoderSnapshot> {
    return this.emitter.event;
  }

  decode(input: string) {
    const status = this.createStatusPayload();
    const parsed = parseMessageDecoderInput(input);
    const items: StudioDecoderResultItem[] = parsed.errors.map((error) => ({
      kind: "error",
      lineNumber: error.lineNumber,
      rawInput: error.rawInput,
      message: error.message,
    }));

    if (!status.canDecode) {
      for (const request of parsed.requests) {
        items.push({
          kind: "error",
          lineNumber: request.lineNumber,
          rawInput: request.rawInput,
          message: status.message,
        });
      }
      this.updateSnapshot(items, status);
      return;
    }

    for (const request of parsed.requests) {
      const result = this.dbcManager.decodeMessageForDisplay(
        request.messageId,
        request.dataBytes,
      );

      if (isDecodedDisplayError(result)) {
        items.push({
          kind: "error",
          lineNumber: request.lineNumber,
          rawInput: request.rawInput,
          message: result.message,
        });
        continue;
      }

      const messageItem: StudioDecoderMessageItem = {
        kind: "message",
        lineNumber: request.lineNumber,
        rawInput: request.rawInput,
        message: {
          id: result.id,
          idHex: result.idHex,
          name: result.name,
          description: result.description ?? "",
          dlc: result.dlc,
          dataText: result.dataText,
          sendingNode: result.sendingNode,
          multiplexerName: result.multiplexerName,
          multiplexerValue: result.multiplexerValue,
          signals: result.signals.map((signal) => ({
            name: signal.name,
            description: signal.description,
            locationText: signal.locationText,
            rawValueHexText: signal.rawValueHexText,
            physValueText: signal.physValueText,
            multiplexTag: signal.multiplexTag,
          })),
        },
      };
      items.push(messageItem);
    }

    this.updateSnapshot(items, status);
  }

  clearResults() {
    this.snapshot = this.createEmptySnapshot();
    this.emitter.fire(this.getSnapshot());
  }

  private createEmptySnapshot(): StudioDecoderSnapshot {
    return {
      loadState: "ready",
      status: this.createStatusPayload(),
      items: [],
      summary: {
        total: 0,
        successCount: 0,
        errorCount: 0,
      },
    };
  }

  private createStatusPayload(): StudioDecoderStatus {
    const status = this.dbcManager.getStatus();
    return {
      state: status.state,
      message: status.message,
      path: status.path,
      canDecode: status.state === "loaded",
    };
  }

  private updateSnapshot(
    items: StudioDecoderResultItem[],
    status: StudioDecoderStatus,
  ) {
    const sorted = [...items].sort((left, right) => left.lineNumber - right.lineNumber);
    const successCount = sorted.filter((item) => item.kind === "message").length;
    this.snapshot = {
      loadState: "ready",
      status,
      items: sorted,
      summary: {
        total: sorted.length,
        successCount,
        errorCount: sorted.length - successCount,
      },
    };
    this.emitter.fire(this.getSnapshot());
  }
}
