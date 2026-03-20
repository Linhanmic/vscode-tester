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
  status: {
    state: "unloaded" | "loaded" | "error";
    message: string;
    path?: string;
  };
  configuredPath: string;
  availableFiles: string[];
}

export interface StudioDecoderStatus {
  state: "unloaded" | "loaded" | "error";
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
    signals: Array<{
      name: string;
      description: string;
      locationText: string;
      rawValueHexText: string;
      physValueText: string;
      multiplexTag?: string;
    }>;
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
  channels: Array<{
    deviceId: number;
    deviceIndex: number;
    channelIndex: number;
    arbitrationBaudRateKbps: number;
    dataBaudRateKbps?: number;
  }>;
  diagnose: {
    requestId?: string;
    responseId?: string;
    keyk?: string;
  };
  dtcs: Array<{
    dtc: string;
    description: string;
  }>;
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

export interface StudioDeviceRules {
  deviceId: number;
  deviceName: string;
  fixedBaudOnly: boolean;
  arbitrationOptionsKbps: number[];
  dataOptionsKbps: number[];
  summary: string;
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
  config: {
    status: {
      state:
        | "no-script-selected"
        | "parser-unavailable"
        | "no-config-block"
        | "managed"
        | "unmanaged";
      message: string;
      canEdit: boolean;
      canCreateConfigBlock: boolean;
      canTakeOver: boolean;
    };
    documentPath?: string;
    hasConfigurationBlock: boolean;
    channels: Array<{
      deviceId: number;
      deviceIndex: number;
      channelIndex: number;
      arbitrationBaudRateKbps: number;
      dataBaudRateKbps?: number;
    }>;
    deviceRules?: StudioDeviceRules;
    diagnose: {
      requestId?: string;
      responseId?: string;
      keyk?: string;
    };
    dtcs: Array<{ dtc: string; description: string }>;
    dbcStatus: StudioDbcSnapshot["status"];
    dbcConfiguredPath: string;
    availableDbcFiles: string[];
    isSingleDevice: boolean;
    deviceLabel: string;
  };
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
  device: {
    loadState: StudioLoadingState;
    status: {
      state: string;
      message: string;
      canSend: boolean;
    };
    documentPath?: string;
    deviceLabel: string;
    channels: Array<{
      deviceId: number;
      deviceIndex: number;
      channelIndex: number;
      arbitrationBaudRateKbps: number;
      dataBaudRateKbps?: number;
      draft: {
        messageIdText: string;
        dataText: string;
        periodMs: number;
        count: number;
      };
    }>;
    activeTasks: Array<{
      key: string;
      channelIndex: number;
      messageId: number;
      messageIdText: string;
      dataText: string;
      periodMs: number;
      count: number;
      sentCount: number;
      status: string;
    }>;
  };
  busMonitor: {
    loadState: StudioLoadingState;
    runStatus: string;
    runTitle: string;
    currentCase: string;
    passedCount: number;
    failedCount: number;
    activeTasks: Array<{
      key: string;
      channelIndex: number;
      messageId: number;
      messageIdText: string;
      data: string;
      periodMs: number;
      count: number;
      sentCount: number;
      updatedAt: number;
    }>;
    visibleFrames: Array<{
      key: string;
      direction: "tx" | "rx";
      channelIndex: number;
      messageIdText: string;
      data: string;
      updateCount: number;
      status: string;
    }>;
    visibleLogs: Array<{
      id: string;
      timestamp: number;
      timeText: string;
      level: "info" | "warn" | "error";
      title: string;
      description: string;
    }>;
    totalFrameCount: number;
    totalLogCount: number;
  };
  decoder: StudioDecoderSnapshot;
  capabilities: StudioCapabilities;
}

export type StudioToWebviewMessage =
  | { type: "initStudio"; snapshot: StudioSnapshot }
  | { type: "updateScripts"; snapshot: StudioScriptsSnapshot }
  | { type: "updateDbc"; snapshot: StudioDbcSnapshot }
  | { type: "updateProject"; snapshot: StudioProjectSnapshot }
  | { type: "updateDevice"; snapshot: StudioSnapshot["device"] }
  | { type: "updateBusMonitor"; snapshot: StudioSnapshot["busMonitor"] }
  | { type: "updateDecoder"; snapshot: StudioDecoderSnapshot }
  | { type: "error"; message: string };

export type WebviewToStudioMessage =
  | { type: "ready" }
  | { type: "refreshScripts" }
  | { type: "selectScript"; uri?: string; pick?: boolean }
  | { type: "openInEditor"; uri: string; startLine: number; startCharacter?: number }
  | { type: "runSuite"; uri: string; suiteStartLine: number }
  | { type: "runCase"; uri: string; suiteStartLine: number; caseStartLine: number }
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
      payload?: {
        channels: Array<{
          deviceId: number;
          deviceIndex: number;
          channelIndex: number;
          arbitrationBaudRateKbps: number;
          dataBaudRateKbps?: number;
        }>;
        diagnose: {
          requestId?: string;
          responseId?: string;
          keyk?: string;
        };
        dtcs: Array<{ dtc: string; description: string }>;
      };
      rawText?: string;
    }
  | { type: "mutateSuite"; mutation: Record<string, unknown> }
  | { type: "mutateCase"; mutation: Record<string, unknown> }
  | { type: "mutateCommand"; mutation: Record<string, unknown> }
  | { type: "mutateRawBlock"; mutation: Record<string, unknown> }
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
