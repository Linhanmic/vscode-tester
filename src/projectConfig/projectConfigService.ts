import * as vscode from "vscode";
import {
  getChannelsDeviceRule,
  validateDeviceRuleChannelConfig,
} from "../can/deviceRules";
import { Node } from "web-tree-sitter";
import { DbcManager } from "../dbc/dbcManager";
import { TreeManager } from "../parser/treeManager";
import { DbcWorkspaceService } from "../studio/dbcWorkspaceService";
import { WorkspaceScriptIndexService } from "../studio/workspaceScriptIndexService";
import { getDeviceTypeLabel } from "../zlgcan/constants";
import type {
  ProjectChannelConfig,
  ProjectConfigSnapshot,
  ProjectDiagnoseConfig,
  ProjectDtcItem,
} from "./types";

interface ParsedProjectConfigState {
  document?: vscode.TextDocument;
  configurationRange?: vscode.Range;
  hasConfigurationBlock: boolean;
  canEdit: boolean;
  canCreateConfigBlock: boolean;
  canTakeOver: boolean;
  message: string;
  channels: ProjectChannelConfig[];
  diagnose: ProjectDiagnoseConfig;
  dtcs: ProjectDtcItem[];
}

const SUPPORTED_CONFIG_COMMAND_TYPES = new Set([
  "tcaninit_command",
  "tdiagnose_sid_command",
  "tdiagnose_rid_command",
  "tdiagnose_keyk_command",
  "tdiagnose_dtc_command",
]);

export class ProjectConfigService implements vscode.Disposable {
  private treeManager: TreeManager | undefined;
  private snapshot: ProjectConfigSnapshot;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly emitter = new vscode.EventEmitter<ProjectConfigSnapshot>();
  private refreshVersion = 0;
  private selectedDocumentUri: vscode.Uri | undefined;

  constructor(
    _: vscode.ExtensionContext,
    private readonly dbcManager: DbcManager,
    private readonly dbcWorkspaceService: DbcWorkspaceService,
    scriptIndexService?: WorkspaceScriptIndexService,
  ) {
    this.snapshot = this.createInitialSnapshot();

    this.disposables.push(
      this.emitter,
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.isTrackedDocument(event.document)) {
          void this.refresh();
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.isTrackedDocument(document)) {
          void this.refresh();
        }
      }),
      this.dbcManager.onDidChangeStatus(() => {
        void this.refresh();
      }),
      this.dbcWorkspaceService.onDidChangeSnapshot(() => {
        void this.refresh();
      }),
    );

    if (scriptIndexService) {
      this.selectedDocumentUri = scriptIndexService.getSelectedUri();
      this.disposables.push(
        scriptIndexService.onDidChangeSnapshot(() => {
          this.selectedDocumentUri = scriptIndexService.getSelectedUri();
          void this.refresh();
        }),
      );
    } else {
      this.disposables.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
          void this.refresh();
        }),
      );
    }
    void this.refresh();
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  setTreeManager(treeManager: TreeManager) {
    this.treeManager = treeManager;
    void this.refresh();
  }

  setSelectedScript(uri: vscode.Uri | undefined) {
    this.selectedDocumentUri = uri;
    void this.refresh();
  }

  getSnapshot(): ProjectConfigSnapshot {
    return {
      ...this.snapshot,
      status: { ...this.snapshot.status },
      channels: this.snapshot.channels.map((channel) => ({ ...channel })),
      deviceRules: this.snapshot.deviceRules
        ? {
            ...this.snapshot.deviceRules,
            arbitrationOptionsKbps: [
              ...this.snapshot.deviceRules.arbitrationOptionsKbps,
            ],
            dataOptionsKbps: [...this.snapshot.deviceRules.dataOptionsKbps],
          }
        : undefined,
      diagnose: { ...this.snapshot.diagnose },
      dtcs: this.snapshot.dtcs.map((item) => ({ ...item })),
      availableDbcFiles: [...this.snapshot.availableDbcFiles],
      dbcStatus: { ...this.snapshot.dbcStatus },
    };
  }

  get onDidChangeSnapshot(): vscode.Event<ProjectConfigSnapshot> {
    return this.emitter.event;
  }

  async refresh() {
    const currentVersion = this.refreshVersion + 1;
    this.refreshVersion = currentVersion;
    const snapshot = await this.buildSnapshot();
    if (currentVersion !== this.refreshVersion) {
      return;
    }

    this.snapshot = snapshot;
    this.emitter.fire(this.getSnapshot());
  }

  async createConfigBlock() {
    const state = await this.getWritableState("create");
    if (state.hasConfigurationBlock) {
      return;
    }

    await this.writeConfigBlock(state.document!, {
      channels: [],
      diagnose: {},
      dtcs: [],
      configurationRange: undefined,
    });
  }

  async takeOverConfigBlock() {
    const state = await this.getWritableState("takeOver");
    if (!state.hasConfigurationBlock) {
      return;
    }

    await this.writeConfigBlock(state.document!, state);
  }

  async replaceConfiguration(payload: {
    channels: ProjectChannelConfig[];
    diagnose: ProjectDiagnoseConfig;
    dtcs: ProjectDtcItem[];
  }) {
    const state = await this.getWritableState("create-or-edit");
    await this.writeConfigBlock(state.document!, {
      channels: payload.channels.map((channel) => this.normalizeChannel(channel)),
      diagnose: this.normalizeDiagnose(payload.diagnose),
      dtcs: payload.dtcs.map((item) => this.normalizeDtc(item)),
      configurationRange: state.configurationRange,
    });
  }

  async replaceConfigurationRaw(rawText: string) {
    const state = await this.getWritableState("raw");
    const document = state.document!;
    const trimmed = rawText.trim();
    if (!trimmed) {
      if (!state.configurationRange) {
        return;
      }

      const edit = new vscode.WorkspaceEdit();
      edit.delete(document.uri, state.configurationRange);
      await vscode.workspace.applyEdit(edit);
      await this.refresh();
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    if (state.configurationRange) {
      edit.replace(document.uri, state.configurationRange, trimmed);
    } else {
      const suffix = document.getText().startsWith(trimmed) ? "\n" : "\n\n";
      edit.insert(document.uri, new vscode.Position(0, 0), trimmed + suffix);
    }
    await vscode.workspace.applyEdit(edit);
    await this.refresh();
  }

  async addChannel(channel: ProjectChannelConfig) {
    const state = await this.getWritableState("edit");
    state.channels.push(this.normalizeChannel(channel));
    await this.writeConfigBlock(state.document!, state);
  }

  async updateChannel(index: number, channel: ProjectChannelConfig) {
    const state = await this.getWritableState("edit");
    this.ensureIndex(index, state.channels.length, "通道");
    state.channels[index] = this.normalizeChannel(channel);
    await this.writeConfigBlock(state.document!, state);
  }

  async removeChannel(index: number) {
    const state = await this.getWritableState("edit");
    this.ensureIndex(index, state.channels.length, "通道");
    state.channels.splice(index, 1);
    await this.writeConfigBlock(state.document!, state);
  }

  async updateDiagnose(diagnose: ProjectDiagnoseConfig) {
    const state = await this.getWritableState("edit");
    state.diagnose = this.normalizeDiagnose(diagnose);
    await this.writeConfigBlock(state.document!, state);
  }

  async addDtc(item: ProjectDtcItem) {
    const state = await this.getWritableState("edit");
    state.dtcs.push(this.normalizeDtc(item));
    await this.writeConfigBlock(state.document!, state);
  }

  async updateDtc(index: number, item: ProjectDtcItem) {
    const state = await this.getWritableState("edit");
    this.ensureIndex(index, state.dtcs.length, "故障码");
    state.dtcs[index] = this.normalizeDtc(item);
    await this.writeConfigBlock(state.document!, state);
  }

  async removeDtc(index: number) {
    const state = await this.getWritableState("edit");
    this.ensureIndex(index, state.dtcs.length, "故障码");
    state.dtcs.splice(index, 1);
    await this.writeConfigBlock(state.document!, state);
  }

  async setDbcPath(filePath: string) {
    await this.dbcManager.setConfiguredPath(filePath);
  }

  async clearDbcPath() {
    await this.dbcManager.clearConfiguredPath();
  }

  async pickDbcPath() {
    const result = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "选择 DBC 文件",
      filters: {
        DBC: ["dbc"],
      },
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });

    if (!result?.length) {
      return;
    }

    await this.setDbcPath(result[0].fsPath);
  }

  private async buildSnapshot(): Promise<ProjectConfigSnapshot> {
    const availableDbcFiles = this.dbcWorkspaceService.getAvailableFiles();
    const parsedState = await this.parseCurrentDocument();
    const singleDeviceState = this.computeSingleDevice(parsedState.channels);
    const deviceRule = getChannelsDeviceRule(parsedState.channels);

    return {
      status: {
        state: this.resolveStatusState(parsedState),
        message: parsedState.message,
        canEdit: parsedState.canEdit,
        canCreateConfigBlock: parsedState.canCreateConfigBlock,
        canTakeOver: parsedState.canTakeOver,
      },
      documentPath: parsedState.document?.fileName,
      hasConfigurationBlock: parsedState.hasConfigurationBlock,
      channels: parsedState.channels,
      deviceRules: deviceRule
        ? {
            deviceId: deviceRule.deviceId,
            deviceName: deviceRule.deviceName,
            fixedBaudOnly: deviceRule.fixedBaudOnly,
            arbitrationOptionsKbps: [...deviceRule.arbitrationOptionsKbps],
            dataOptionsKbps: [...deviceRule.dataOptionsKbps],
            summary: deviceRule.summary,
          }
        : undefined,
      diagnose: parsedState.diagnose,
      dtcs: parsedState.dtcs,
      dbcStatus: this.dbcManager.getStatus(),
      dbcConfiguredPath: this.dbcManager.getConfiguredPathSetting(),
      availableDbcFiles,
      isSingleDevice: singleDeviceState.isSingleDevice,
      deviceLabel: singleDeviceState.label,
    };
  }

  private async parseCurrentDocument(): Promise<ParsedProjectConfigState> {
    const document = await this.getCurrentTesterDocument();
    if (!document) {
      return {
        hasConfigurationBlock: false,
        canEdit: false,
        canCreateConfigBlock: false,
        canTakeOver: false,
        message: this.selectedDocumentUri
          ? "当前选中文档不是 Tester 脚本"
          : "当前未选择脚本文件",
        channels: [],
        diagnose: {},
        dtcs: [],
      };
    }

    if (!this.treeManager) {
      return {
        document,
        hasConfigurationBlock: false,
        canEdit: false,
        canCreateConfigBlock: false,
        canTakeOver: false,
        message: "语法服务尚未初始化，当前无法读取配置块",
        channels: [],
        diagnose: {},
        dtcs: [],
      };
    }

    const tree = this.treeManager.getTree(document);
    const root = tree.rootNode;
    const configurationNode = this.findConfigurationBlock(root);
    if (!configurationNode) {
      return {
        document,
        hasConfigurationBlock: false,
        canEdit: false,
        canCreateConfigBlock: true,
        canTakeOver: false,
        message: "当前文档没有 tset 配置块，可直接创建",
        channels: [],
        diagnose: {},
        dtcs: [],
      };
    }

    const configurationRange = this.toRange(configurationNode);
    const rawText = document.getText(configurationRange);
    const commands = this.collectConfigCommands(configurationNode);
    const diagnose: ProjectDiagnoseConfig = {};
    const dtcs: ProjectDtcItem[] = [];
    const channels: ProjectChannelConfig[] = [];
    const unmanagedReasons: string[] = [];

    if (configurationNode.hasError) {
      unmanagedReasons.push("配置块存在语法错误");
    }
    if (/\/\/|(^|\s)tnote\s*=/im.test(rawText)) {
      unmanagedReasons.push("配置块包含注释");
    }

    let requestIdSeen = false;
    let responseIdSeen = false;
    let keykSeen = false;

    for (const command of commands) {
      switch (command.type) {
        case "tcaninit_command":
          channels.push({
            deviceId: this.parseIntegerField(command, "device_id"),
            deviceIndex: this.parseIntegerField(command, "device_index"),
            channelIndex: this.parseIntegerField(command, "channel_index"),
            arbitrationBaudRateKbps: this.parseIntegerField(
              command,
              "arbitration_baudrate",
            ),
            dataBaudRateKbps: this.optionalIntegerField(
              command,
              "data_baudrate",
            ),
          });
          break;
        case "tdiagnose_sid_command":
          if (requestIdSeen) {
            unmanagedReasons.push("存在多个 tdiagnose_sid");
            break;
          }
          diagnose.requestId = this.requireFieldText(command, "request_id");
          requestIdSeen = true;
          break;
        case "tdiagnose_rid_command":
          if (responseIdSeen) {
            unmanagedReasons.push("存在多个 tdiagnose_rid");
            break;
          }
          diagnose.responseId = this.requireFieldText(command, "response_id");
          responseIdSeen = true;
          break;
        case "tdiagnose_keyk_command":
          if (keykSeen) {
            unmanagedReasons.push("存在多个 tdiagnose_keyk");
            break;
          }
          diagnose.keyk = this.requireFieldText(command, "keyk");
          keykSeen = true;
          break;
        case "tdiagnose_dtc_command":
          dtcs.push({
            dtc: this.requireFieldText(command, "dtc"),
            description: this.requireFieldText(command, "description"),
          });
          break;
        case "tcans_ch_def_command":
          unmanagedReasons.push("配置块包含暂未受管的 tcans_ch_def");
          break;
        default:
          unmanagedReasons.push(`配置块包含暂未受管的命令: ${command.type}`);
          break;
      }
    }

    const managed = unmanagedReasons.length === 0;
    return {
      document,
      configurationRange,
      hasConfigurationBlock: true,
      canEdit: managed,
      canCreateConfigBlock: false,
      canTakeOver: !managed,
      message: managed
        ? "当前配置块已接入 Studio，可直接编辑"
        : `配置块处于只读保护状态：${unmanagedReasons[0]}`,
      channels,
      diagnose,
      dtcs,
    };
  }

  private async getWritableState(
    mode: "create" | "takeOver" | "edit" | "raw" | "create-or-edit",
  ) {
    const state = await this.parseCurrentDocument();
    if (!state.document) {
      throw new Error("当前未选择脚本文件");
    }

    if (mode === "create") {
      if (!state.canCreateConfigBlock) {
        throw new Error("当前文档已存在配置块");
      }
      return state;
    }

    if (mode === "takeOver") {
      if (!state.hasConfigurationBlock) {
        throw new Error("当前文档没有可接管的配置块");
      }
      return state;
    }

    if (mode === "create-or-edit") {
      if (!state.hasConfigurationBlock) {
        return state;
      }
      if (!state.canEdit) {
        throw new Error(state.message);
      }
      return state;
    }

    if (mode === "raw") {
      return state;
    }

    if (!state.canEdit) {
      throw new Error(state.message);
    }

    return state;
  }

  private async writeConfigBlock(
    document: vscode.TextDocument,
    state: Pick<
      ParsedProjectConfigState,
      "channels" | "diagnose" | "dtcs" | "configurationRange"
    >,
  ) {
    const serialized = this.serializeConfigurationBlock(
      state.channels,
      state.diagnose,
      state.dtcs,
    );
    const edit = new vscode.WorkspaceEdit();
    if (state.configurationRange) {
      edit.replace(document.uri, state.configurationRange, serialized);
    } else {
      const suffix = document.getText().startsWith("tset") ? "\n" : "\n\n";
      edit.insert(document.uri, new vscode.Position(0, 0), serialized + suffix);
    }

    await vscode.workspace.applyEdit(edit);
    await this.refresh();
  }

  private serializeConfigurationBlock(
    channels: ProjectChannelConfig[],
    diagnose: ProjectDiagnoseConfig,
    dtcs: ProjectDtcItem[],
  ) {
    const lines = ["tset"];

    for (const channel of channels) {
      const dataBaudRate =
        channel.dataBaudRateKbps === undefined
          ? ""
          : `,${channel.dataBaudRateKbps}`;
      lines.push(
        `  tcaninit ${channel.deviceId},${channel.deviceIndex},${channel.channelIndex},${channel.arbitrationBaudRateKbps}${dataBaudRate}`,
      );
    }

    if (diagnose.responseId) {
      lines.push(`  tdiagnose_rid ${diagnose.responseId}`);
    }
    if (diagnose.requestId) {
      lines.push(`  tdiagnose_sid ${diagnose.requestId}`);
    }
    if (diagnose.keyk) {
      lines.push(`  tdiagnose_keyk ${diagnose.keyk}`);
    }

    for (const item of dtcs) {
      lines.push(`  tdiagnose_dtc ${item.dtc},${item.description}`);
    }

    lines.push("tend");
    return lines.join("\n");
  }

  private collectConfigCommands(configurationNode: Node) {
    const commands: Node[] = [];
    this.traverse(configurationNode, (node) => {
      if (
        node !== configurationNode &&
        node.type.endsWith("_command") &&
        (SUPPORTED_CONFIG_COMMAND_TYPES.has(node.type) ||
          node.type === "tcans_ch_def_command")
      ) {
        commands.push(node);
      }
    });

    return commands;
  }

  private findConfigurationBlock(root: Node) {
    for (let index = 0; index < root.namedChildCount; index += 1) {
      const child = root.namedChild(index);
      if (child?.type === "configuration_block") {
        return child;
      }
    }
    return null;
  }

  private computeSingleDevice(channels: ProjectChannelConfig[]) {
    if (!channels.length) {
      return {
        isSingleDevice: false,
        label: "未配置设备",
      };
    }

    const first = channels[0];
    const isSingleDevice = channels.every(
      (channel) =>
        channel.deviceId === first.deviceId &&
        channel.deviceIndex === first.deviceIndex,
    );

    return {
      isSingleDevice,
      label: isSingleDevice
        ? `${getDeviceTypeLabel(first.deviceId)} #${first.deviceIndex}`
        : "存在多个设备配置",
    };
  }

  private resolveStatusState(state: ParsedProjectConfigState) {
    if (!state.document) {
      return "no-script-selected" as const;
    }
    if (!this.treeManager) {
      return "parser-unavailable" as const;
    }
    if (!state.hasConfigurationBlock) {
      return "no-config-block" as const;
    }
    return state.canEdit ? ("managed" as const) : ("unmanaged" as const);
  }

  private async getCurrentTesterDocument() {
    const sourceUri = this.selectedDocumentUri ?? vscode.window.activeTextEditor?.document.uri;
    if (!sourceUri) {
      return undefined;
    }

    const document = await vscode.workspace.openTextDocument(sourceUri);
    return document.languageId === "tester" ? document : undefined;
  }

  private isTrackedDocument(document: vscode.TextDocument) {
    if (this.selectedDocumentUri) {
      return document.uri.toString() === this.selectedDocumentUri.toString();
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    return activeDocument?.uri.toString() === document.uri.toString();
  }

  private createInitialSnapshot(): ProjectConfigSnapshot {
    return {
      status: {
        state: "no-script-selected",
        message: "当前未选择脚本文件",
        canEdit: false,
        canCreateConfigBlock: false,
        canTakeOver: false,
      },
      hasConfigurationBlock: false,
      channels: [],
      deviceRules: undefined,
      diagnose: {},
      dtcs: [],
      dbcStatus: this.dbcManager.getStatus(),
      dbcConfiguredPath: this.dbcManager.getConfiguredPathSetting(),
      availableDbcFiles: [],
      isSingleDevice: false,
      deviceLabel: "未配置设备",
    };
  }

  private normalizeChannel(channel: ProjectChannelConfig): ProjectChannelConfig {
    const rawDataBaudRate = channel.dataBaudRateKbps as
      | number
      | string
      | undefined
      | null;
    const normalized: ProjectChannelConfig = {
      deviceId: this.parsePlainInteger(channel.deviceId, "deviceId"),
      deviceIndex: this.parsePlainInteger(channel.deviceIndex, "deviceIndex"),
      channelIndex: this.parsePlainInteger(channel.channelIndex, "channelIndex"),
      arbitrationBaudRateKbps: this.parsePositiveInteger(
        channel.arbitrationBaudRateKbps,
        "arbitrationBaudRateKbps",
      ),
      dataBaudRateKbps:
        rawDataBaudRate === undefined ||
        rawDataBaudRate === null ||
        (typeof rawDataBaudRate === "string" &&
          rawDataBaudRate.trim() === "")
          ? undefined
          : this.parsePositiveInteger(
              rawDataBaudRate,
              "dataBaudRateKbps",
            ),
    };

    const validationMessage = validateDeviceRuleChannelConfig(normalized);
    if (validationMessage) {
      throw new Error(validationMessage);
    }

    return normalized;
  }

  private normalizeDiagnose(diagnose: ProjectDiagnoseConfig): ProjectDiagnoseConfig {
    return {
      requestId: this.normalizeOptionalText(diagnose.requestId),
      responseId: this.normalizeOptionalText(diagnose.responseId),
      keyk: this.normalizeOptionalText(diagnose.keyk),
    };
  }

  private normalizeDtc(item: ProjectDtcItem): ProjectDtcItem {
    const dtc = item.dtc.trim();
    const description = item.description.trim();
    if (!dtc || !description) {
      throw new Error("故障码和描述不能为空");
    }
    return {
      dtc,
      description,
    };
  }

  private normalizeOptionalText(value: string | undefined) {
    const text = value?.trim();
    return text ? text : undefined;
  }

  private parseIntegerField(node: Node, fieldName: string) {
    return this.parsePlainInteger(this.requireFieldText(node, fieldName), fieldName);
  }

  private optionalIntegerField(node: Node, fieldName: string) {
    const value = node.childForFieldName(fieldName)?.text.trim();
    return value ? this.parsePositiveInteger(value, fieldName) : undefined;
  }

  private requireFieldText(node: Node, fieldName: string) {
    const text = node.childForFieldName(fieldName)?.text.trim();
    if (!text) {
      throw new Error(`缺少字段 ${fieldName}`);
    }
    return text;
  }

  private parsePlainInteger(value: number | string, label: string) {
    const parsed =
      typeof value === "number" ? value : Number.parseInt(value.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${label} 必须是 >= 0 的整数`);
    }
    return parsed;
  }

  private parsePositiveInteger(value: number | string, label: string) {
    const parsed =
      typeof value === "number" ? value : Number.parseInt(value.trim(), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${label} 必须是 > 0 的整数`);
    }
    return parsed;
  }

  private ensureIndex(index: number, length: number, label: string) {
    if (index < 0 || index >= length) {
      throw new Error(`${label}索引超出范围`);
    }
  }

  private traverse(node: Node, callback: (node: Node) => void) {
    callback(node);
    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (child) {
        this.traverse(child, callback);
      }
    }
  }

  private toRange(node: Node) {
    return new vscode.Range(
      node.startPosition.row,
      node.startPosition.column,
      node.endPosition.row,
      node.endPosition.column,
    );
  }
}
