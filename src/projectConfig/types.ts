import type { DbcManagerStatus } from "../dbc/dbcManager";

export type ProjectConfigStatusState =
  | "no-script-selected"
  | "parser-unavailable"
  | "no-config-block"
  | "managed"
  | "unmanaged";

export interface ProjectConfigStatus {
  state: ProjectConfigStatusState;
  message: string;
  canEdit: boolean;
  canCreateConfigBlock: boolean;
  canTakeOver: boolean;
}

export interface ProjectChannelConfig {
  deviceId: number;
  deviceIndex: number;
  channelIndex: number;
  arbitrationBaudRateKbps: number;
  dataBaudRateKbps?: number;
}

export interface ProjectDiagnoseConfig {
  requestId?: string;
  responseId?: string;
  keyk?: string;
}

export interface ProjectDtcItem {
  dtc: string;
  description: string;
}

export interface ProjectConfigSnapshot {
  status: ProjectConfigStatus;
  documentPath?: string;
  hasConfigurationBlock: boolean;
  channels: ProjectChannelConfig[];
  diagnose: ProjectDiagnoseConfig;
  dtcs: ProjectDtcItem[];
  dbcStatus: DbcManagerStatus;
  dbcConfiguredPath: string;
  availableDbcFiles: string[];
  isSingleDevice: boolean;
  deviceLabel: string;
}
