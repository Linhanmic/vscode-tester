import type { DbcManagerStatus } from "../dbc/dbcManager";
import type { DeviceManagerSnapshot } from "../deviceManager/types";
import type {
  ProjectChannelConfig,
  ProjectConfigSnapshot,
  ProjectDiagnoseConfig,
  ProjectDtcItem,
} from "../projectConfig/types";
import type { BusMonitorSnapshot } from "../providers/busMonitorStore";

export type StudioLoadingState = "idle" | "loading" | "ready" | "error";

export interface StudioPosition {
  line: number;
  character: number;
}

export interface StudioRange {
  start: StudioPosition;
  end: StudioPosition;
}

export interface StudioScriptItem {
  uri: string;
  name: string;
  path: string;
  source: "workspace" | "manual";
}

export interface StudioScriptsSnapshot {
  loadState: StudioLoadingState;
  message?: string;
  items: StudioScriptItem[];
  selectedUri?: string;
}

export interface StudioDbcSnapshot {
  loadState: StudioLoadingState;
  message?: string;
  status: DbcManagerStatus;
  configuredPath: string;
  availableFiles: string[];
}

export interface StudioDecoderStatus {
  state: DbcManagerStatus["state"];
  message: string;
  path?: string;
  canDecode: boolean;
}

export interface StudioDecoderErrorItem {
  kind: "error";
  lineNumber: number;
  rawInput: string;
  message: string;
}

export interface StudioDecodedSignalItem {
  name: string;
  description: string;
  locationText: string;
  rawValueHexText: string;
  physValueText: string;
  multiplexTag?: string;
}

export interface StudioDecoderMessageItem {
  kind: "message";
  lineNumber: number;
  rawInput: string;
  message: {
    id: number;
    idHex: string;
    name: string;
    description: string;
    dlc: number;
    dataText: string;
    sendingNode?: string;
    multiplexerName?: string;
    multiplexerValue?: number;
    signals: StudioDecodedSignalItem[];
  };
}

export type StudioDecoderResultItem =
  | StudioDecoderErrorItem
  | StudioDecoderMessageItem;

export interface StudioDecoderSnapshot {
  loadState: StudioLoadingState;
  message?: string;
  status: StudioDecoderStatus;
  items: StudioDecoderResultItem[];
  summary: {
    total: number;
    successCount: number;
    errorCount: number;
  };
}

interface StudioNodeBase {
  id: string;
  kind: string;
  label: string;
  startLine: number;
  range: StudioRange;
  rawText: string;
}

export interface StudioNoteNode extends StudioNodeBase {
  kind: "note";
  style: "line" | "tnote";
  text: string;
}

export interface StudioRawNode extends StudioNodeBase {
  kind: "raw";
  rawKind: string;
}

export interface StudioCommandNode extends StudioNodeBase {
  kind: "command";
  commandKind:
    | "tcans"
    | "tcanr_direct"
    | "tcanr_bit"
    | "tcanr_print"
    | "tdelay";
  messageIdText?: string;
  dataText?: string;
  bitRangeText?: string;
  expectedText?: string;
  waitTimeText?: string;
  periodText?: string;
  countText?: string;
  channelText?: string;
}

export type StudioCaseChildNode =
  | StudioCommandNode
  | StudioNoteNode
  | StudioRawNode;

export interface StudioCaseNode extends StudioNodeBase {
  kind: "case";
  managed: boolean;
  title: string;
  idText?: string;
  children: StudioCaseChildNode[];
}

export type StudioSuiteChildNode =
  | StudioCaseNode
  | StudioNoteNode
  | StudioRawNode;

export interface StudioSuiteNode extends StudioNodeBase {
  kind: "suite";
  managed: boolean;
  title: string;
  children: StudioSuiteChildNode[];
}

export interface StudioManagedConfigNode extends StudioNodeBase {
  kind: "config";
  mode: "managed";
  channels: ProjectChannelConfig[];
  diagnose: ProjectDiagnoseConfig;
  dtcs: ProjectDtcItem[];
}

export interface StudioRawConfigNode extends StudioNodeBase {
  kind: "config";
  mode: "raw";
  reason: string;
}

export type StudioConfigNode = StudioManagedConfigNode | StudioRawConfigNode;

export type StudioProjectItem =
  | StudioConfigNode
  | StudioSuiteNode
  | StudioNoteNode
  | StudioRawNode;

export interface StudioOutlineNode {
  id: string;
  label: string;
  kind: "config" | "suite" | "case";
  depth: number;
  suiteStartLine?: number;
  caseStartLine?: number;
  parentKind: "root" | "suite";
  startLine: number;
  range: StudioRange;
}

export interface StudioProjectSummary {
  suiteCount: number;
  caseCount: number;
  commandCount: number;
}

export interface StudioProjectSnapshot {
  loadState: StudioLoadingState;
  message?: string;
  state: "no-script-selected" | "ready" | "error";
  script?: StudioScriptItem;
  documentVersion?: number;
  items: StudioProjectItem[];
  outlineNodes: StudioOutlineNode[];
  summary: StudioProjectSummary;
  config: ProjectConfigSnapshot;
  errorMessage?: string;
}

export interface StudioCapabilities {
  canUseGlobalTools: boolean;
  canEditScript: boolean;
  canRunScript: boolean;
  canManageDevice: boolean;
}

export interface StudioSnapshot {
  scripts: StudioScriptsSnapshot;
  dbc: StudioDbcSnapshot;
  project: StudioProjectSnapshot;
  device: DeviceManagerSnapshot;
  busMonitor: BusMonitorSnapshot;
  decoder: StudioDecoderSnapshot;
  capabilities: StudioCapabilities;
}

export type StudioToWebviewMessage =
  | { type: "initStudio"; snapshot: StudioSnapshot }
  | { type: "updateScripts"; snapshot: StudioScriptsSnapshot }
  | { type: "updateDbc"; snapshot: StudioDbcSnapshot }
  | { type: "updateProject"; snapshot: StudioProjectSnapshot }
  | { type: "updateDevice"; snapshot: DeviceManagerSnapshot }
  | { type: "updateBusMonitor"; snapshot: BusMonitorSnapshot }
  | { type: "updateDecoder"; snapshot: StudioDecoderSnapshot }
  | { type: "error"; message: string };

export type StudioCommandMutation = {
  action: "create" | "update" | "delete" | "move";
  suiteStartLine: number;
  caseStartLine: number;
  targetStartLine?: number;
  direction?: "up" | "down";
  commandKind?:
    | "tcans"
    | "tcanr_direct"
    | "tcanr_bit"
    | "tcanr_print"
    | "tdelay"
    | "note";
  payload?: Record<string, string | undefined>;
};

export type StudioCaseMutation = {
  action: "create" | "update" | "delete" | "move";
  suiteStartLine: number;
  caseStartLine?: number;
  direction?: "up" | "down";
  payload?: {
    idText?: string;
    title: string;
  };
};

export type StudioSuiteMutation = {
  action: "create" | "update" | "delete" | "move";
  suiteStartLine?: number;
  direction?: "up" | "down";
  payload?: {
    title: string;
  };
};

export type StudioRawMutation = {
  scope: "root" | "config" | "suite" | "case";
  targetStartLine: number;
  rawText: string;
};

export type WebviewToStudioMessage =
  | { type: "ready" }
  | { type: "refreshScripts" }
  | { type: "selectScript"; uri?: string; pick?: boolean }
  | {
      type: "openInEditor";
      uri: string;
      startLine: number;
      startCharacter?: number;
    }
  | { type: "runSuite"; uri: string; suiteStartLine: number }
  | {
      type: "runCase";
      uri: string;
      suiteStartLine: number;
      caseStartLine: number;
    }
  | {
      type: "runCommand";
      uri: string;
      suiteStartLine: number;
      caseStartLine: number;
      commandStartLine: number;
    }
  | {
      type: "mutateConfig";
      mode: "managed" | "raw";
      payload?:
        | {
            channels: ProjectChannelConfig[];
            diagnose: ProjectDiagnoseConfig;
            dtcs: ProjectDtcItem[];
          }
        | undefined;
      rawText?: string;
    }
  | { type: "mutateSuite"; mutation: StudioSuiteMutation }
  | { type: "mutateCase"; mutation: StudioCaseMutation }
  | { type: "mutateCommand"; mutation: StudioCommandMutation }
  | { type: "mutateRawBlock"; mutation: StudioRawMutation }
  | {
      type: "startDeviceTask";
      payload: {
        channelIndex: number;
        messageIdText: string;
        dataText: string;
        periodMs: number | string;
        count: number | string;
      };
    }
  | { type: "stopDeviceTask"; key: string }
  | { type: "decodeMessages"; input: string }
  | { type: "setDbcPath"; path: string }
  | { type: "pickDbcPath" }
  | { type: "clearDbcPath" }
  | { type: "clearBusMonitor" };
