import * as vscode from "vscode";
import { Node } from "web-tree-sitter";
import { TreeManager } from "../parser/treeManager";
import { ProjectConfigService } from "../projectConfig/projectConfigService";
import { parseDataSequence } from "../runtime/utils";
import type {
  StudioCaseChildNode,
  StudioCaseMutation,
  StudioCaseNode,
  StudioCommandMutation,
  StudioCommandNode,
  StudioConfigNode,
  StudioOutlineNode,
  StudioNoteNode,
  StudioProjectItem,
  StudioProjectSnapshot,
  StudioProjectSummary,
  StudioRawMutation,
  StudioRawNode,
  StudioRange,
  StudioSuiteChildNode,
  StudioSuiteMutation,
  StudioSuiteNode,
} from "./types";
import { WorkspaceScriptIndexService } from "./workspaceScriptIndexService";

type MutableCaseChildNode = StudioCaseChildNode;
type MutableSuiteChildNode = StudioSuiteChildNode;

export class ScriptModelService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<StudioProjectSnapshot>();
  private readonly disposables: vscode.Disposable[] = [];
  private snapshot: StudioProjectSnapshot;
  private refreshVersion = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly treeManager: TreeManager,
    private readonly projectConfigService: ProjectConfigService,
    private readonly scriptIndexService: WorkspaceScriptIndexService,
  ) {
    this.snapshot = this.createEmptySnapshot();
    this.disposables.push(
      this.emitter,
      this.scriptIndexService.onDidChangeSnapshot(() => {
        this.scheduleRefresh();
      }),
      this.projectConfigService.onDidChangeSnapshot(() => {
        this.scheduleRefresh();
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const selectedUri = this.scriptIndexService.getSelectedUri();
        if (
          selectedUri &&
          event.document.uri.toString() === selectedUri.toString()
        ) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        const selectedUri = this.scriptIndexService.getSelectedUri();
        if (
          selectedUri &&
          document.uri.toString() === selectedUri.toString()
        ) {
          this.scheduleRefresh();
        }
      }),
    );

    void this.refresh();
  }

  dispose() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  getSnapshot(): StudioProjectSnapshot {
    return structuredClone(this.snapshot);
  }

  get onDidChangeSnapshot(): vscode.Event<StudioProjectSnapshot> {
    return this.emitter.event;
  }

  async refresh() {
    const version = this.refreshVersion + 1;
    this.refreshVersion = version;
    const snapshot = await this.buildSnapshot();
    if (version !== this.refreshVersion) {
      return;
    }

    this.snapshot = snapshot;
    this.emitter.fire(snapshot);
  }

  async mutateSuite(mutation: StudioSuiteMutation) {
    const document = await this.requireSelectedDocument();
    const snapshot = await this.requireReadySnapshot();
    const suiteItems = snapshot.items.filter(
      (item): item is StudioSuiteNode => item.kind === "suite",
    );

    if (mutation.action === "create") {
      const title = mutation.payload?.title.trim();
      if (!title) {
        throw new Error("测试集标题不能为空");
      }

      const newSuite = this.createDefaultSuiteNode(title);
      const insertIndex =
        mutation.suiteStartLine === undefined
          ? snapshot.items.length
          : this.findInsertIndexByStartLine(snapshot.items, mutation.suiteStartLine);
      await this.insertTopLevelBlock(document, insertIndex, serializeSuite(newSuite));
      return;
    }

    const suiteIndex = suiteItems.findIndex(
      (suite) => suite.startLine === mutation.suiteStartLine,
    );
    if (suiteIndex === -1) {
      throw new Error("未找到目标测试集");
    }

    const suite = suiteItems[suiteIndex];
    if (mutation.action === "delete") {
      await this.replaceRange(document, suite.range, "");
      return;
    }

    if (mutation.action === "move") {
      const siblingIndex =
        mutation.direction === "up" ? suiteIndex - 1 : suiteIndex + 1;
      if (siblingIndex < 0 || siblingIndex >= suiteItems.length) {
        return;
      }

      const sibling = suiteItems[siblingIndex];
      await this.swapRanges(document, suite.range, suite.rawText, sibling.range, sibling.rawText);
      return;
    }

    if (!suite.managed) {
      throw new Error("当前测试集包含未受管内容，请改用原文编辑");
    }

    const title = mutation.payload?.title.trim();
    if (!title) {
      throw new Error("测试集标题不能为空");
    }

    const updatedSuite: StudioSuiteNode = {
      ...suite,
      title,
      label: title,
    };
    await this.replaceRange(document, suite.range, serializeSuite(updatedSuite));
  }

  async mutateCase(mutation: StudioCaseMutation) {
    const document = await this.requireSelectedDocument();
    const snapshot = await this.requireReadySnapshot();
    const suite = this.findSuite(snapshot.items, mutation.suiteStartLine);
    if (!suite) {
      throw new Error("未找到目标测试集");
    }
    if (!suite.managed) {
      throw new Error("当前测试集包含未受管内容，请改用原文编辑");
    }

    const children = [...suite.children];
    const caseIndex = children.findIndex(
      (item) => item.kind === "case" && item.startLine === mutation.caseStartLine,
    );

    if (mutation.action === "create") {
      const title = mutation.payload?.title.trim();
      if (!title) {
        throw new Error("测试用例标题不能为空");
      }

      const newCase = this.createDefaultCaseNode(title, mutation.payload?.idText);
      children.push(newCase);
      await this.replaceRange(
        document,
        suite.range,
        serializeSuite({
          ...suite,
          children,
        }),
      );
      return;
    }

    if (caseIndex === -1) {
      throw new Error("未找到目标测试用例");
    }

    if (mutation.action === "delete") {
      children.splice(caseIndex, 1);
    } else if (mutation.action === "move") {
      const swapIndex =
        mutation.direction === "up" ? caseIndex - 1 : caseIndex + 1;
      if (
        swapIndex < 0 ||
        swapIndex >= children.length ||
        children[swapIndex]?.kind !== "case"
      ) {
        return;
      }

      const current = children[caseIndex];
      children[caseIndex] = children[swapIndex] as MutableSuiteChildNode;
      children[swapIndex] = current;
    } else {
      const targetCase = children[caseIndex];
      if (targetCase?.kind !== "case") {
        throw new Error("目标节点不是测试用例");
      }
      if (!targetCase.managed) {
        throw new Error("当前测试用例包含未受管内容，请改用原文编辑");
      }

      const title = mutation.payload?.title.trim();
      if (!title) {
        throw new Error("测试用例标题不能为空");
      }

      children[caseIndex] = {
        ...targetCase,
        title,
        label: mutation.payload?.idText
          ? `${mutation.payload.idText}. ${title}`
          : title,
        idText: mutation.payload?.idText?.trim() || undefined,
      };
    }

    await this.replaceRange(
      document,
      suite.range,
      serializeSuite({
        ...suite,
        children,
      }),
    );
  }

  async mutateCommand(mutation: StudioCommandMutation) {
    const document = await this.requireSelectedDocument();
    const snapshot = await this.requireReadySnapshot();
    const suite = this.findSuite(snapshot.items, mutation.suiteStartLine);
    if (!suite?.managed) {
      throw new Error("当前测试集不可结构化编辑");
    }

    const caseNode = suite.children.find(
      (item): item is StudioCaseNode =>
        item.kind === "case" && item.startLine === mutation.caseStartLine,
    );
    if (!caseNode) {
      throw new Error("未找到目标测试用例");
    }
    if (!caseNode.managed) {
      throw new Error("当前测试用例不可结构化编辑");
    }

    const nextChildren = [...caseNode.children];
    const targetIndex = nextChildren.findIndex(
      (item) => item.startLine === mutation.targetStartLine,
    );

    if (mutation.action === "create") {
      const nextNode = this.createCaseChildFromPayload(
        mutation.commandKind,
        mutation.payload,
      );
      nextChildren.push(nextNode);
    } else {
      if (targetIndex === -1) {
        throw new Error("未找到目标命令");
      }

      if (mutation.action === "delete") {
        nextChildren.splice(targetIndex, 1);
      } else if (mutation.action === "move") {
        const swapIndex =
          mutation.direction === "up" ? targetIndex - 1 : targetIndex + 1;
        if (swapIndex < 0 || swapIndex >= nextChildren.length) {
          return;
        }
        const current = nextChildren[targetIndex];
        nextChildren[targetIndex] = nextChildren[swapIndex];
        nextChildren[swapIndex] = current;
      } else {
        nextChildren[targetIndex] = this.updateCaseChildFromPayload(
          nextChildren[targetIndex],
          mutation.payload,
        );
      }
    }

    const nextCase: StudioCaseNode = {
      ...caseNode,
      children: nextChildren,
    };
    const nextSuiteChildren = suite.children.map((item) =>
      item.startLine === caseNode.startLine ? nextCase : item,
    );
    await this.replaceRange(
      document,
      suite.range,
      serializeSuite({
        ...suite,
        children: nextSuiteChildren,
      }),
    );
  }

  async mutateRaw(mutation: StudioRawMutation) {
    const document = await this.requireSelectedDocument();
    const snapshot = await this.requireReadySnapshot();
    if (mutation.scope === "config") {
      await this.projectConfigService.replaceConfigurationRaw(mutation.rawText);
      return;
    }

    const target = this.findNodeByStartLine(snapshot.items, mutation.targetStartLine);
    if (!target) {
      throw new Error("未找到目标块");
    }
    await this.replaceRange(document, target.range, mutation.rawText.trim());
  }

  private scheduleRefresh() {
    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 60);
  }

  private async buildSnapshot(): Promise<StudioProjectSnapshot> {
    const selectedUri = this.scriptIndexService.getSelectedUri();
    const scriptsSnapshot = this.scriptIndexService.getSnapshot();
    const script = selectedUri
      ? scriptsSnapshot.items.find((item) => item.uri === selectedUri.toString())
      : undefined;
    const configSnapshot = this.projectConfigService.getSnapshot();

    if (!selectedUri || !script) {
      return {
        loadState: "ready",
        state: "no-script-selected",
        message: "当前未选择脚本文件",
        items: [],
        outlineNodes: [],
        summary: createProjectSummary([]),
        config: configSnapshot,
      };
    }

    try {
      const document = await vscode.workspace.openTextDocument(selectedUri);
      if (document.languageId !== "tester") {
        return {
          loadState: "error",
          state: "error",
          script,
          documentVersion: document.version,
          message: "当前选中文档不是 Tester 脚本",
          items: [],
          outlineNodes: [],
          summary: createProjectSummary([]),
          config: configSnapshot,
          errorMessage: "当前选中文档不是 Tester 脚本",
        };
      }

      const tree = this.treeManager.getTree(document);
      const items: StudioProjectItem[] = [];
      let hasConfigNode = false;
      for (let index = 0; index < tree.rootNode.namedChildCount; index += 1) {
        const child = tree.rootNode.namedChild(index);
        if (!child) {
          continue;
        }

        if (child.type === "configuration_block") {
          hasConfigNode = true;
          const parsedConfig = this.parseConfigNode(document, child, configSnapshot);
          if (parsedConfig) {
            items.push(parsedConfig);
          }
          continue;
        }

        if (child.type === "test_suite") {
          items.push(this.parseSuiteNode(document, child));
          continue;
        }

        if (child.type === "comment") {
          items.push(this.parseNoteNode(document, child, "root"));
          continue;
        }

        items.push(this.createRawNode(document, child, "root"));
      }

      if (!hasConfigNode && configSnapshot.hasConfigurationBlock) {
        items.unshift({
          kind: "raw",
          id: "root:config-missing",
          label: "配置块",
          rawKind: "configuration_block",
          startLine: 0,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          rawText: "",
        });
      }

      return {
        loadState: "ready",
        state: "ready",
        script,
        documentVersion: document.version,
        items,
        outlineNodes: buildOutlineNodes(items),
        summary: createProjectSummary(items),
        config: configSnapshot,
      };
    } catch (error) {
      return {
        loadState: "error",
        state: "error",
        script,
        message: error instanceof Error ? error.message : String(error),
        items: [],
        outlineNodes: [],
        summary: createProjectSummary([]),
        config: configSnapshot,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseConfigNode(
    document: vscode.TextDocument,
    node: Node,
    configSnapshot: ReturnType<ProjectConfigService["getSnapshot"]>,
  ): StudioConfigNode {
    const range = toStudioRange(node);
    const rawText = document.getText(this.toRange(node));
    const base = {
      kind: "config" as const,
      id: `config:${node.startPosition.row}`,
      label: "项目配置",
      startLine: node.startPosition.row,
      range,
      rawText,
    };

    if (configSnapshot.status.canEdit) {
      return {
        ...base,
        mode: "managed",
        channels: configSnapshot.channels,
        diagnose: configSnapshot.diagnose,
        dtcs: configSnapshot.dtcs,
      };
    }

    return {
      ...base,
      mode: "raw",
      reason: configSnapshot.status.message,
    };
  }

  private parseSuiteNode(
    document: vscode.TextDocument,
    node: Node,
  ): StudioSuiteNode {
    const title = node.childForFieldName("title")?.text.trim() ?? "未命名测试集";
    const children: StudioSuiteChildNode[] = [];
    let managed = !node.hasError;

    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (!child || child.type === "string") {
        continue;
      }

      if (child.type === "test_case") {
        const parsedCase = this.parseCaseNode(document, child);
        if (!parsedCase.managed) {
          managed = false;
        }
        children.push(parsedCase);
        continue;
      }

      if (child.type === "comment") {
        children.push(this.parseNoteNode(document, child, "suite"));
        continue;
      }

      managed = false;
      children.push(this.createRawNode(document, child, "suite"));
    }

    return {
      kind: "suite",
      id: `suite:${node.startPosition.row}`,
      label: title,
      title,
      managed,
      startLine: node.startPosition.row,
      range: toStudioRange(node),
      rawText: document.getText(this.toRange(node)),
      children,
    };
  }

  private parseCaseNode(
    document: vscode.TextDocument,
    node: Node,
  ): StudioCaseNode {
    const idText = node.childForFieldName("id")?.text.trim();
    const title = node.childForFieldName("title")?.text.trim() ?? "未命名用例";
    const children: StudioCaseChildNode[] = [];
    let managed = !node.hasError;

    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (!child || child.type === "string" || child.type === "integer") {
        continue;
      }

      if (child.type === "comment") {
        children.push(this.parseNoteNode(document, child, "case"));
        continue;
      }

      if (child.type === "test_command") {
        const parsedCommand = this.parseCommandNode(document, child);
        if (!parsedCommand) {
          managed = false;
          children.push(this.createRawNode(document, child, "case"));
          continue;
        }
        children.push(parsedCommand);
        continue;
      }

      managed = false;
      children.push(this.createRawNode(document, child, "case"));
    }

    return {
      kind: "case",
      id: `case:${node.startPosition.row}`,
      label: idText ? `${idText}. ${title}` : title,
      title,
      idText,
      managed,
      startLine: node.startPosition.row,
      range: toStudioRange(node),
      rawText: document.getText(this.toRange(node)),
      children,
    };
  }

  private parseNoteNode(
    document: vscode.TextDocument,
    node: Node,
    scope: "root" | "suite" | "case",
  ): StudioNoteNode {
    const rawText = document.getText(this.toRange(node));
    const text = node.namedChild(0)?.text.trim() ?? "";
    const style = rawText.trimStart().startsWith("tnote=") ? "tnote" : "line";
    return {
      kind: "note",
      id: `${scope}:note:${node.startPosition.row}`,
      label: text || "注释",
      text,
      style,
      startLine: node.startPosition.row,
      range: toStudioRange(node),
      rawText,
    };
  }

  private parseCommandNode(
    document: vscode.TextDocument,
    wrapperNode: Node,
  ): StudioCommandNode | undefined {
    const executableNode = resolveExecutableNode(wrapperNode);
    if (!executableNode) {
      return undefined;
    }

    if (
      executableNode.childForFieldName("send_channel") ||
      executableNode.childForFieldName("receive_channel")
    ) {
      return undefined;
    }

    const rawText = document.getText(this.toRange(wrapperNode));
    const base = {
      kind: "command" as const,
      id: `command:${wrapperNode.startPosition.row}`,
      startLine: wrapperNode.startPosition.row,
      range: toStudioRange(wrapperNode),
      rawText,
    };

    switch (executableNode.type) {
      case "tcans_command":
        return {
          ...base,
          label: "发送报文",
          commandKind: "tcans",
          messageIdText: fieldText(executableNode, "message_id"),
          dataText: normalizeDataText(fieldText(executableNode, "message_data")),
          periodText: fieldText(executableNode, "period"),
          countText: fieldText(executableNode, "count"),
        };
      case "tcanr_direct_compare_command":
        return {
          ...base,
          label: "整帧校验",
          commandKind: "tcanr_direct",
          messageIdText: fieldText(executableNode, "message_id"),
          expectedText: normalizeDataText(fieldText(executableNode, "expected_data")),
          waitTimeText: fieldText(executableNode, "wait_time"),
        };
      case "tcanr_bit_compare_command":
        return {
          ...base,
          label: "位域校验",
          commandKind: "tcanr_bit",
          messageIdText: fieldText(executableNode, "message_id"),
          bitRangeText: fieldText(executableNode, "expected_bit_range"),
          expectedText: fieldText(executableNode, "expected_data"),
          waitTimeText: fieldText(executableNode, "wait_time"),
        };
      case "tcanr_print_command":
        return {
          ...base,
          label: "位域打印",
          commandKind: "tcanr_print",
          messageIdText: fieldText(executableNode, "message_id"),
          bitRangeText: fieldText(executableNode, "expected_bit_range"),
        };
      case "tdelay_command":
        return {
          ...base,
          label: "阻塞延时",
          commandKind: "tdelay",
          countText: fieldText(executableNode, "delay_time"),
        };
      default:
        return undefined;
    }
  }

  private createRawNode(
    document: vscode.TextDocument,
    node: Node,
    scope: "root" | "suite" | "case",
  ): StudioRawNode {
    return {
      kind: "raw",
      id: `${scope}:raw:${node.startPosition.row}`,
      label: node.type,
      rawKind: node.type,
      startLine: node.startPosition.row,
      range: toStudioRange(node),
      rawText: document.getText(this.toRange(node)),
    };
  }

  private createDefaultSuiteNode(title: string): StudioSuiteNode {
    const defaultCase = this.createDefaultCaseNode("新用例");
    return {
      kind: "suite",
      id: "suite:new",
      label: title,
      title,
      managed: true,
      startLine: -1,
      range: emptyRange(),
      rawText: "",
      children: [defaultCase],
    };
  }

  private createDefaultCaseNode(title: string, idText?: string): StudioCaseNode {
    return {
      kind: "case",
      id: "case:new",
      label: idText ? `${idText}. ${title}` : title,
      title,
      idText: idText?.trim() || undefined,
      managed: true,
      startLine: -1,
      range: emptyRange(),
      rawText: "",
      children: [],
    };
  }

  private createCaseChildFromPayload(
    kind: StudioCommandMutation["commandKind"],
    payload?: Record<string, string | undefined>,
  ): MutableCaseChildNode {
    if (kind === "note") {
      return {
        kind: "note",
        id: "note:new",
        label: payload?.text?.trim() || "注释",
        text: payload?.text?.trim() || "",
        style: (payload?.style as "line" | "tnote" | undefined) ?? "tnote",
        startLine: -1,
        range: emptyRange(),
        rawText: "",
      };
    }

    if (!kind) {
      throw new Error("缺少命令类型");
    }

    return {
      kind: "command",
      id: "command:new",
      label: defaultCommandLabel(kind),
      commandKind: kind,
      startLine: -1,
      range: emptyRange(),
      rawText: "",
      messageIdText: payload?.messageIdText?.trim(),
      dataText: payload?.dataText?.trim(),
      bitRangeText: payload?.bitRangeText?.trim(),
      expectedText: payload?.expectedText?.trim(),
      waitTimeText: payload?.waitTimeText?.trim(),
      periodText: payload?.periodText?.trim(),
      countText: payload?.countText?.trim(),
    };
  }

  private updateCaseChildFromPayload(
    node: MutableCaseChildNode,
    payload?: Record<string, string | undefined>,
  ): MutableCaseChildNode {
    if (node.kind === "note") {
      const text = payload?.text?.trim() ?? node.text;
      const style = (payload?.style as "line" | "tnote" | undefined) ?? node.style;
      return {
        ...node,
        text,
        style,
        label: text || "注释",
      };
    }

    if (node.kind !== "command") {
      throw new Error("当前节点不可结构化编辑");
    }

    return {
      ...node,
      messageIdText: payload?.messageIdText?.trim() ?? node.messageIdText,
      dataText: payload?.dataText?.trim() ?? node.dataText,
      bitRangeText: payload?.bitRangeText?.trim() ?? node.bitRangeText,
      expectedText: payload?.expectedText?.trim() ?? node.expectedText,
      waitTimeText: payload?.waitTimeText?.trim() ?? node.waitTimeText,
      periodText: payload?.periodText?.trim() ?? node.periodText,
      countText: payload?.countText?.trim() ?? node.countText,
    };
  }

  private async requireSelectedDocument() {
    const selectedUri = this.scriptIndexService.getSelectedUri();
    if (!selectedUri) {
      throw new Error("当前未选择脚本文件");
    }
    return vscode.workspace.openTextDocument(selectedUri);
  }

  private async requireReadySnapshot() {
    await this.refresh();
    if (this.snapshot.state !== "ready") {
      throw new Error(this.snapshot.errorMessage ?? "当前脚本不可编辑");
    }
    return this.snapshot;
  }

  private findSuite(items: StudioProjectItem[], suiteStartLine: number) {
    return items.find(
      (item): item is StudioSuiteNode =>
        item.kind === "suite" && item.startLine === suiteStartLine,
    );
  }

  private findInsertIndexByStartLine(
    items: StudioProjectItem[],
    suiteStartLine: number,
  ) {
    const index = items.findIndex((item) => item.startLine === suiteStartLine);
    return index === -1 ? items.length : index + 1;
  }

  private findNodeByStartLine(
    items: StudioProjectItem[],
    startLine: number,
  ): StudioProjectItem | StudioSuiteChildNode | StudioCaseChildNode | undefined {
    for (const item of items) {
      if (item.startLine === startLine) {
        return item;
      }

      if (item.kind === "suite") {
        for (const suiteChild of item.children) {
          if (suiteChild.startLine === startLine) {
            return suiteChild;
          }

          if (suiteChild.kind === "case") {
            for (const caseChild of suiteChild.children) {
              if (caseChild.startLine === startLine) {
                return caseChild;
              }
            }
          }
        }
      }
    }

    return undefined;
  }

  private async insertTopLevelBlock(
    document: vscode.TextDocument,
    insertIndex: number,
    text: string,
  ) {
    const items = this.snapshot.items;
    const edit = new vscode.WorkspaceEdit();

    if (!items.length || insertIndex >= items.length) {
      const prefix = document.getText().trim() ? "\n\n" : "";
      edit.insert(
        document.uri,
        new vscode.Position(document.lineCount, 0),
        `${prefix}${text}\n`,
      );
    } else {
      const target = items[insertIndex];
      edit.insert(
        document.uri,
        new vscode.Position(target.range.start.line, 0),
        `${text}\n\n`,
      );
    }

    await vscode.workspace.applyEdit(edit);
    await this.refresh();
  }

  private async replaceRange(
    document: vscode.TextDocument,
    range: StudioRange,
    text: string,
  ) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, this.fromStudioRange(range), text);
    await vscode.workspace.applyEdit(edit);
    await this.refresh();
  }

  private async swapRanges(
    document: vscode.TextDocument,
    leftRange: StudioRange,
    leftText: string,
    rightRange: StudioRange,
    rightText: string,
  ) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, this.fromStudioRange(leftRange), rightText);
    edit.replace(document.uri, this.fromStudioRange(rightRange), leftText);
    await vscode.workspace.applyEdit(edit);
    await this.refresh();
  }

  private toRange(node: Node) {
    return new vscode.Range(
      node.startPosition.row,
      node.startPosition.column,
      node.endPosition.row,
      node.endPosition.column,
    );
  }

  private fromStudioRange(range: StudioRange) {
    return new vscode.Range(
      range.start.line,
      range.start.character,
      range.end.line,
      range.end.character,
    );
  }

  private createEmptySnapshot(): StudioProjectSnapshot {
    return {
      loadState: "idle",
      state: "no-script-selected",
      items: [],
      outlineNodes: [],
      summary: createProjectSummary([]),
      config: this.projectConfigService.getSnapshot(),
    };
  }
}

function resolveExecutableNode(node: Node): Node | null {
  if (
    node.type === "tcans_command" ||
    node.type === "tcanr_direct_compare_command" ||
    node.type === "tcanr_bit_compare_command" ||
    node.type === "tcanr_print_command" ||
    node.type === "tdelay_command"
  ) {
    return node;
  }

  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (!child) {
      continue;
    }

    const resolved = resolveExecutableNode(child);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function fieldText(node: Node, fieldName: string) {
  return node.childForFieldName(fieldName)?.text.trim() ?? "";
}

function normalizeDataText(value: string) {
  if (!value) {
    return "";
  }
  try {
    return parseDataSequence(value)
      .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
      .join("-");
  } catch {
    return value;
  }
}

function serializeSuite(node: StudioSuiteNode) {
  const lines = [`ttitle=${node.title}`];
  for (const child of node.children) {
    lines.push(serializeSuiteChild(child, 1));
  }
  lines.push("ttitle-end");
  return lines.join("\n");
}

function serializeSuiteChild(node: MutableSuiteChildNode, indentLevel: number): string {
  if (node.kind === "case") {
    return serializeCase(node, indentLevel);
  }
  return indentRaw(serializeCaseChild(node as MutableCaseChildNode, indentLevel), 0);
}

function serializeCase(node: StudioCaseNode, indentLevel: number) {
  const indent = "  ".repeat(indentLevel);
  const headerPrefix = node.idText ? `${node.idText} ` : "";
  const lines = [`${indent}${headerPrefix}tstart=${node.title}`];
  for (const child of node.children) {
    lines.push(serializeCaseChild(child, indentLevel + 1));
  }
  lines.push(`${indent}tend`);
  return lines.join("\n");
}

function serializeCaseChild(node: MutableCaseChildNode, indentLevel: number): string {
  const indent = "  ".repeat(indentLevel);
  if (node.kind === "note") {
    return node.style === "line"
      ? `${indent}// ${node.text}`.trimEnd()
      : `${indent}tnote=${node.text}`;
  }

  if (node.kind === "raw") {
    return indentRaw(node.rawText, indentLevel);
  }

  switch (node.commandKind) {
    case "tcans":
      requireText(node.messageIdText, "报文 ID");
      requireText(node.dataText, "报文数据");
      requireText(node.periodText, "发送周期");
      requireText(node.countText, "发送次数");
      return `${indent}tcans ${node.messageIdText},${node.dataText},${node.periodText},${node.countText}`;
    case "tcanr_direct":
      requireText(node.messageIdText, "报文 ID");
      requireText(node.expectedText, "期望数据");
      requireText(node.waitTimeText, "等待时间");
      return `${indent}tcanr ${node.messageIdText},${node.expectedText},${node.waitTimeText}`;
    case "tcanr_bit":
      requireText(node.messageIdText, "报文 ID");
      requireText(node.bitRangeText, "位域");
      requireText(node.expectedText, "期望值");
      requireText(node.waitTimeText, "等待时间");
      return `${indent}tcanr ${node.messageIdText},${node.bitRangeText},${node.expectedText},${node.waitTimeText}`;
    case "tcanr_print":
      requireText(node.messageIdText, "报文 ID");
      requireText(node.bitRangeText, "位域");
      return `${indent}tcanr ${node.messageIdText},${node.bitRangeText},print`;
    case "tdelay":
      requireText(node.countText, "延时时间");
      return `${indent}tdelay ${node.countText}`;
    default:
      return `${indent}${node.rawText}`;
  }
}

function indentRaw(text: string, indentLevel: number) {
  const indent = "  ".repeat(indentLevel);
  return text
    .split(/\r?\n/)
    .map((line) => (line ? `${indent}${line.trimStart()}` : line))
    .join("\n");
}

function defaultCommandLabel(kind: StudioCommandNode["commandKind"]) {
  switch (kind) {
    case "tcans":
      return "发送报文";
    case "tcanr_direct":
      return "整帧校验";
    case "tcanr_bit":
      return "位域校验";
    case "tcanr_print":
      return "位域打印";
    case "tdelay":
      return "阻塞延时";
  }
}

function requireText(value: string | undefined, label: string) {
  if (!value?.trim()) {
    throw new Error(`${label}不能为空`);
  }
}

function toStudioRange(node: Node): StudioRange {
  return {
    start: {
      line: node.startPosition.row,
      character: node.startPosition.column,
    },
    end: {
      line: node.endPosition.row,
      character: node.endPosition.column,
    },
  };
}

function emptyRange(): StudioRange {
  return {
    start: {
      line: 0,
      character: 0,
    },
    end: {
      line: 0,
      character: 0,
    },
  };
}

function buildOutlineNodes(items: StudioProjectItem[]): StudioOutlineNode[] {
  const nodes: StudioOutlineNode[] = [];

  for (const item of items) {
    if (item.kind !== "config" && item.kind !== "suite") {
      continue;
    }

    nodes.push({
      id: item.id,
      label: item.label,
      kind: item.kind,
      depth: 0,
      suiteStartLine: item.kind === "suite" ? item.startLine : undefined,
      parentKind: "root",
      startLine: item.startLine,
      range: item.range,
    });

    if (item.kind !== "suite") {
      continue;
    }

    appendSuiteOutlineNodes(nodes, item, 1);
  }

  return nodes;
}

function appendSuiteOutlineNodes(
  nodes: StudioOutlineNode[],
  suite: StudioSuiteNode,
  depth: number,
) {
  for (const child of suite.children) {
    if (child.kind !== "case") {
      continue;
    }

    nodes.push({
      id: child.id,
      label: child.label,
      kind: child.kind,
      depth,
      suiteStartLine: suite.startLine,
      caseStartLine: child.startLine,
      parentKind: "suite",
      startLine: child.startLine,
      range: child.range,
    });
  }
}

function createProjectSummary(items: StudioProjectItem[]): StudioProjectSummary {
  let suiteCount = 0;
  let caseCount = 0;
  let commandCount = 0;

  for (const item of items) {
    if (item.kind !== "suite") {
      continue;
    }

    suiteCount += 1;
    for (const suiteChild of item.children) {
      if (suiteChild.kind !== "case") {
        continue;
      }

      caseCount += 1;
      commandCount += suiteChild.children.filter(
        (child) => child.kind === "command",
      ).length;
    }
  }

  return {
    suiteCount,
    caseCount,
    commandCount,
  };
}
