import type { ProjectChannelConfig } from "../projectConfig/types";

export type DeviceManagerStatusState =
  | "no-script-selected"
  | "parser-unavailable"
  | "no-config-block"
  | "unmanaged"
  | "not-configured"
  | "unsupported"
  | "driver-unavailable"
  | "ready"
  | "sending";

export interface DeviceManagerStatus {
  state: DeviceManagerStatusState;
  message: string;
  canSend: boolean;
}

export interface TemporarySendDraft {
  messageIdText: string;
  dataText: string;
  periodMs: number;
  count: number;
}

export interface DeviceManagerChannelItem extends ProjectChannelConfig {
  draft: TemporarySendDraft;
}

export interface DeviceManagerTaskSnapshot {
  key: string;
  channelIndex: number;
  messageId: number;
  messageIdText: string;
  dataText: string;
  periodMs: number;
  count: number;
  sentCount: number;
  status: "running" | "completed" | "stopped";
}

export interface DeviceManagerSnapshot {
  loadState: "idle" | "loading" | "ready" | "error";
  status: DeviceManagerStatus;
  documentPath?: string;
  deviceLabel: string;
  channels: DeviceManagerChannelItem[];
  activeTasks: DeviceManagerTaskSnapshot[];
}
