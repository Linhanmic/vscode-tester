import * as vscode from "vscode";
import {
  TesterBusMonitorStore,
  type BusMonitorSnapshot,
} from "../providers/busMonitorStore";
import type { RunnerEvent, RunnerEventSink } from "../runtime/types";

export class BusMonitorService
  implements RunnerEventSink, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<BusMonitorSnapshot>();
  private readonly store = new TesterBusMonitorStore();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {}

  dispose() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    this.emitter.dispose();
  }

  getSnapshot(): BusMonitorSnapshot {
    return this.store.createSnapshot();
  }

  get onDidChangeSnapshot(): vscode.Event<BusMonitorSnapshot> {
    return this.emitter.event;
  }

  handleEvent(event: RunnerEvent): void {
    this.store.handleEvent(event);
    this.scheduleRefresh();
  }

  clear() {
    this.store.clear();
    this.scheduleRefresh();
  }

  private scheduleRefresh() {
    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.emitter.fire(this.getSnapshot());
    }, 140);
  }
}
