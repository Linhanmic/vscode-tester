<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type {
  StudioCaseNode,
  StudioCommandNode,
  StudioConfigNode,
  StudioLoadingState,
  StudioNoteNode,
  StudioProjectSummary,
  StudioRawNode,
  StudioSuiteNode,
} from "../shared";
import type { TreeNodeInfo } from "../viewModels";

const props = defineProps<{
  projectLoadState: StudioLoadingState;
  projectState: "no-script-selected" | "ready" | "error";
  projectMessage: string;
  selectedNode?: TreeNodeInfo;
  selectedScriptUri?: string;
  projectSummary: StudioProjectSummary;
  projectConfigMessage: string;
  selectedSuiteTitle?: string;
  selectedScriptName?: string;
}>();

const emit = defineEmits<{
  (event: "open-node", node: TreeNodeInfo): void;
  (event: "mutate-config", payload: {
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
  }): void;
  (event: "mutate-suite", payload: {
    action: "create" | "update" | "delete" | "move";
    suiteStartLine?: number;
    direction?: "up" | "down";
    payload?: { title: string };
  }): void;
  (event: "mutate-case", payload: {
    action: "create" | "update" | "delete" | "move";
    suiteStartLine: number;
    caseStartLine?: number;
    direction?: "up" | "down";
    payload?: { idText?: string; title: string };
  }): void;
  (event: "mutate-raw", payload: {
    scope: "root" | "config" | "suite" | "case";
    targetStartLine: number;
    rawText: string;
  }): void;
  (event: "run-suite", payload: { uri: string; suiteStartLine: number }): void;
  (event: "run-case", payload: {
    uri: string;
    suiteStartLine: number;
    caseStartLine: number;
  }): void;
  (event: "run-command", payload: {
    uri: string;
    suiteStartLine: number;
    caseStartLine: number;
    commandStartLine: number;
  }): void;
}>();

const configDraft = reactive({
  channels: [] as Array<{
    deviceId: number;
    deviceIndex: number;
    channelIndex: number;
    arbitrationBaudRateKbps: number;
    dataBaudRateKbps?: number;
  }>,
  diagnose: {
    requestId: "",
    responseId: "",
    keyk: "",
  },
  dtcs: [] as Array<{ dtc: string; description: string }>,
  rawText: "",
});

const suiteDraft = reactive({
  title: "",
  rawText: "",
  newSuiteTitle: "",
  newCaseTitle: "",
  newCaseId: "",
});

const caseDraft = reactive({
  title: "",
  idText: "",
  rawText: "",
});

const selectedKind = computed(() => props.selectedNode?.kind);
const selectedPayload = computed(() => props.selectedNode?.payload);
const selectedSuiteStartLine = computed(() => props.selectedNode?.suiteStartLine);
const configNode = computed(() =>
  selectedPayload.value?.kind === "config"
    ? (selectedPayload.value as StudioConfigNode)
    : undefined,
);
const suiteNode = computed(() =>
  selectedPayload.value?.kind === "suite"
    ? (selectedPayload.value as StudioSuiteNode)
    : undefined,
);
const caseNode = computed(() =>
  selectedPayload.value?.kind === "case"
    ? (selectedPayload.value as StudioCaseNode)
    : undefined,
);
const suiteCases = computed(() =>
  suiteNode.value?.children.filter(
    (child): child is StudioCaseNode => child.kind === "case",
  ) ?? [],
);
const caseMetrics = computed(() => {
  const node = caseNode.value;
  if (!node) {
    return {
      commandCount: 0,
      noteCount: 0,
      rawCount: 0,
    };
  }

  return {
    commandCount: node.children.filter((child) => child.kind === "command").length,
    noteCount: node.children.filter((child) => child.kind === "note").length,
    rawCount: node.children.filter((child) => child.kind === "raw").length,
  };
});

watch(
  () => props.selectedNode?.id,
  () => {
    hydrateDrafts();
  },
  { immediate: true },
);

function hydrateDrafts() {
  const payload = selectedPayload.value;
  if (!payload) {
    return;
  }

  if (payload.kind === "config") {
    const node = payload as StudioConfigNode;
    configDraft.rawText = node.rawText;
    if (node.mode === "managed") {
      configDraft.channels = node.channels.map((channel) => ({ ...channel }));
      configDraft.diagnose.requestId = node.diagnose.requestId ?? "";
      configDraft.diagnose.responseId = node.diagnose.responseId ?? "";
      configDraft.diagnose.keyk = node.diagnose.keyk ?? "";
      configDraft.dtcs = node.dtcs.map((item) => ({ ...item }));
    }
    return;
  }

  if (payload.kind === "suite") {
    const node = payload as StudioSuiteNode;
    suiteDraft.title = node.title;
    suiteDraft.rawText = node.rawText;
    return;
  }

  if (payload.kind === "case") {
    const node = payload as StudioCaseNode;
    caseDraft.title = node.title;
    caseDraft.idText = node.idText ?? "";
    caseDraft.rawText = node.rawText;
  }
}

function saveManagedConfig(node: StudioConfigNode) {
  if (node.mode !== "managed") {
    return;
  }
  emit("mutate-config", {
    mode: "managed",
    payload: {
      channels: configDraft.channels.map((channel) => ({
        deviceId: Number(channel.deviceId),
        deviceIndex: Number(channel.deviceIndex),
        channelIndex: Number(channel.channelIndex),
        arbitrationBaudRateKbps: Number(channel.arbitrationBaudRateKbps),
        dataBaudRateKbps:
          channel.dataBaudRateKbps === undefined ||
          channel.dataBaudRateKbps === null ||
          channel.dataBaudRateKbps === 0
            ? undefined
            : Number(channel.dataBaudRateKbps),
      })),
      diagnose: {
        requestId: configDraft.diagnose.requestId || undefined,
        responseId: configDraft.diagnose.responseId || undefined,
        keyk: configDraft.diagnose.keyk || undefined,
      },
      dtcs: configDraft.dtcs.map((item) => ({
        dtc: item.dtc,
        description: item.description,
      })),
    },
  });
}

function createSuite() {
  if (!suiteDraft.newSuiteTitle.trim()) {
    return;
  }
  emit("mutate-suite", {
    action: "create",
    payload: {
      title: suiteDraft.newSuiteTitle,
    },
  });
  suiteDraft.newSuiteTitle = "";
}

function createCase() {
  if (!suiteDraft.newCaseTitle.trim() || selectedSuiteStartLine.value === undefined) {
    return;
  }
  emit("mutate-case", {
    action: "create",
    suiteStartLine: selectedSuiteStartLine.value,
    payload: {
      title: suiteDraft.newCaseTitle,
      idText: suiteDraft.newCaseId || undefined,
    },
  });
  suiteDraft.newCaseTitle = "";
  suiteDraft.newCaseId = "";
}

function saveSuite(node: StudioSuiteNode) {
  emit("mutate-suite", {
    action: "update",
    suiteStartLine: node.startLine,
    payload: {
      title: suiteDraft.title,
    },
  });
}

function saveCase(node: StudioCaseNode, suiteStartLine?: number) {
  if (suiteStartLine === undefined) {
    return;
  }
  emit("mutate-case", {
    action: "update",
    suiteStartLine,
    caseStartLine: node.startLine,
    payload: {
      title: caseDraft.title,
      idText: caseDraft.idText || undefined,
    },
  });
}

function saveRaw(scope: "root" | "config" | "suite" | "case", startLine: number, text: string) {
  emit("mutate-raw", {
    scope,
    targetStartLine: startLine,
    rawText: text,
  });
}

function caseChildTag(node: StudioCommandNode | StudioNoteNode | StudioRawNode) {
  if (node.kind === "note") {
    return node.style === "line" ? "//" : "tnote";
  }
  if (node.kind === "raw") {
    return "raw";
  }
  return node.commandKind;
}

function caseChildSummary(node: StudioCommandNode | StudioNoteNode | StudioRawNode) {
  if (node.kind === "note") {
    return node.text || "注释";
  }
  if (node.kind === "raw") {
    return `未结构化块: ${node.rawKind}`;
  }

  switch (node.commandKind) {
    case "tcans":
      return `${node.messageIdText ?? "?"} ${node.dataText ?? ""}`.trim();
    case "tcanr_direct":
      return `${node.messageIdText ?? "?"} ${node.expectedText ?? ""}`.trim();
    case "tcanr_bit":
      return `${node.messageIdText ?? "?"} ${node.bitRangeText ?? ""} -> ${node.expectedText ?? ""}`.trim();
    case "tcanr_print":
      return `${node.messageIdText ?? "?"} ${node.bitRangeText ?? ""} print`.trim();
    case "tdelay":
      return `${node.countText ?? "0"} ms`;
  }
}

function runToCommand(node: StudioCommandNode) {
  if (
    !props.selectedScriptUri ||
    selectedSuiteStartLine.value === undefined ||
    !caseNode.value
  ) {
    return;
  }

  emit("run-command", {
    uri: props.selectedScriptUri,
    suiteStartLine: selectedSuiteStartLine.value,
    caseStartLine: caseNode.value.startLine,
    commandStartLine: node.startLine,
  });
}
</script>

<template>
  <section class="detail-pane">
    <div v-if="projectLoadState === 'loading'" class="placeholder scroll-region">
      <h2>正在加载</h2>
      <p>{{ projectMessage }}</p>
    </div>

    <div v-else-if="projectState === 'no-script-selected'" class="placeholder scroll-region">
      <h2>全局工具模式</h2>
      <p>当前未选择脚本文件。左侧工具台仍可使用 DBC 配置、报文解析和总线监视。</p>
    </div>

    <div v-else-if="projectState === 'error'" class="placeholder error scroll-region">
      <h2>脚本解析失败</h2>
      <p>{{ projectMessage }}</p>
    </div>

    <div v-else-if="!selectedNode" class="detail-shell">
      <div class="section-header">
        <div>
          <h2>脚本概览</h2>
          <p>{{ selectedScriptName ?? "当前脚本" }} 的工作台总览。</p>
        </div>
      </div>

      <div class="detail-scroll scroll-region">
        <div class="metric-grid">
          <div class="metric-card">
            <span class="metric-label">测试集</span>
            <strong>{{ projectSummary.suiteCount }}</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">用例</span>
            <strong>{{ projectSummary.caseCount }}</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">命令</span>
            <strong>{{ projectSummary.commandCount }}</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">配置状态</span>
            <strong>{{ projectConfigMessage }}</strong>
          </div>
        </div>

        <div class="workspace-grid">
          <section class="section">
            <h3>工作台摘要</h3>
            <p class="hint">左侧树用于导航和运行，右侧用于编辑与原文调整。</p>
          </section>

          <section class="section">
            <h3>新增测试集</h3>
            <div class="inline-form">
              <input v-model="suiteDraft.newSuiteTitle" placeholder="测试集标题" />
              <button type="button" @click="createSuite">新增测试集</button>
            </div>
          </section>
        </div>
      </div>
    </div>

    <template v-else-if="selectedKind === 'config'">
      <div class="section-header">
        <div>
          <h2>项目配置</h2>
          <p>更紧凑的配置工作台，保存操作固定在底部。</p>
        </div>
        <button type="button" class="ghost" @click="emit('open-node', selectedNode)">
          在编辑器中定位
        </button>
      </div>

      <div class="detail-scroll scroll-region">
        <template v-if="configNode?.mode === 'managed'">
          <div class="workspace-grid config-grid">
            <section class="section span-2">
              <h3>通道</h3>
              <div v-for="(channel, index) in configDraft.channels" :key="index" class="grid four">
                <input v-model.number="channel.deviceId" placeholder="device_id" type="number" />
                <input v-model.number="channel.deviceIndex" placeholder="device_index" type="number" />
                <input v-model.number="channel.channelIndex" placeholder="channel_index" type="number" />
                <input v-model.number="channel.arbitrationBaudRateKbps" placeholder="仲裁 kbps" type="number" />
                <input v-model.number="channel.dataBaudRateKbps" placeholder="数据 kbps" type="number" />
                <button type="button" class="warn" @click="configDraft.channels.splice(index, 1)">删除</button>
              </div>
              <button
                type="button"
                class="ghost"
                @click="configDraft.channels.push({ deviceId: 41, deviceIndex: 0, channelIndex: configDraft.channels.length, arbitrationBaudRateKbps: 500 })"
              >
                新增通道
              </button>
            </section>

            <section class="section">
              <h3>诊断</h3>
              <div class="grid">
                <input v-model="configDraft.diagnose.responseId" placeholder="tdiagnose_rid" />
                <input v-model="configDraft.diagnose.requestId" placeholder="tdiagnose_sid" />
                <input v-model="configDraft.diagnose.keyk" placeholder="tdiagnose_keyk" />
              </div>
            </section>

            <section class="section">
              <h3>故障码</h3>
              <div class="stack-list">
                <div v-for="(item, index) in configDraft.dtcs" :key="index" class="grid three">
                  <input v-model="item.dtc" placeholder="DTC" />
                  <input v-model="item.description" placeholder="描述" />
                  <button type="button" class="warn" @click="configDraft.dtcs.splice(index, 1)">删除</button>
                </div>
              </div>
              <button
                type="button"
                class="ghost"
                @click="configDraft.dtcs.push({ dtc: '', description: '' })"
              >
                新增故障码
              </button>
            </section>
          </div>

          <div class="action-bar">
            <button type="button" class="primary-action" @click="configNode && saveManagedConfig(configNode)">
              保存配置
            </button>
          </div>
        </template>

        <template v-else>
          <section class="section">
            <h3>原文配置块</h3>
            <textarea v-model="configDraft.rawText" rows="18" />
          </section>
          <div class="action-bar">
            <button type="button" class="primary-action" @click="emit('mutate-config', { mode: 'raw', rawText: configDraft.rawText })">
              保存原文
            </button>
          </div>
        </template>
      </div>
    </template>

    <template v-else-if="selectedKind === 'suite'">
      <div class="section-header">
        <div>
          <h2>测试集</h2>
          <p>测试集标题、用例列表和新增入口集中在一个工作台里。</p>
        </div>
        <div class="actions">
          <button type="button" class="ghost" @click="emit('open-node', selectedNode)">
            定位
          </button>
          <button
            v-if="selectedScriptUri"
            type="button"
            @click="suiteNode && emit('run-suite', { uri: selectedScriptUri, suiteStartLine: suiteNode.startLine })"
          >
            运行测试集
          </button>
        </div>
      </div>

      <div class="detail-scroll scroll-region">
        <template v-if="suiteNode?.managed">
          <div class="workspace-grid">
            <section class="section">
              <h3>基本信息</h3>
              <input v-model="suiteDraft.title" placeholder="测试集标题" />
            </section>

            <section class="section">
              <h3>新增用例</h3>
              <div class="grid">
                <input v-model="suiteDraft.newCaseId" placeholder="序号（可选）" />
                <input v-model="suiteDraft.newCaseTitle" placeholder="用例标题" />
                <button type="button" @click="createCase">新增用例</button>
              </div>
            </section>

            <section class="section span-2">
              <h3>用例列表</h3>
              <div v-if="suiteCases.length" class="case-card-list">
                <div v-for="item in suiteCases" :key="item.id" class="case-card">
                  <strong>{{ item.label }}</strong>
                  <span class="muted">命令 {{ item.children.filter((child) => child.kind === 'command').length }}</span>
                  <span class="muted">第 {{ item.startLine + 1 }} 行</span>
                </div>
              </div>
              <div v-else class="muted">当前测试集还没有用例</div>
            </section>
          </div>

          <div class="action-bar">
            <button type="button" class="primary-action" @click="suiteNode && saveSuite(suiteNode)">保存测试集</button>
            <button
              type="button"
              class="ghost"
              @click="suiteNode && emit('mutate-suite', { action: 'move', suiteStartLine: suiteNode.startLine, direction: 'up' })"
            >
              上移
            </button>
            <button
              type="button"
              class="ghost"
              @click="suiteNode && emit('mutate-suite', { action: 'move', suiteStartLine: suiteNode.startLine, direction: 'down' })"
            >
              下移
            </button>
            <button
              type="button"
              class="warn"
              @click="suiteNode && emit('mutate-suite', { action: 'delete', suiteStartLine: suiteNode.startLine })"
            >
              删除
            </button>
          </div>
        </template>

        <template v-else>
          <section class="section">
            <h3>整段测试集原文</h3>
            <textarea v-model="suiteDraft.rawText" rows="18" />
          </section>
          <div class="action-bar">
            <button
              type="button"
              class="primary-action"
              @click="suiteNode && saveRaw('suite', suiteNode.startLine, suiteDraft.rawText)"
            >
              保存原文
            </button>
          </div>
        </template>
      </div>
    </template>

    <template v-else-if="selectedKind === 'case'">
      <div class="section-header">
        <div>
          <h2>测试用例</h2>
          <p>用例摘要、命令时间线和原文编辑整合为一个工作台。</p>
        </div>
        <div class="actions">
          <button type="button" class="ghost" @click="emit('open-node', selectedNode)">
            定位
          </button>
          <button
            v-if="selectedScriptUri && selectedSuiteStartLine !== undefined"
            type="button"
            @click="caseNode && emit('run-case', { uri: selectedScriptUri, suiteStartLine: selectedSuiteStartLine, caseStartLine: caseNode.startLine })"
          >
            运行用例
          </button>
        </div>
      </div>

      <div class="detail-scroll scroll-region">
        <template v-if="caseNode?.managed">
          <div class="metric-grid">
            <div class="metric-card">
              <span class="metric-label">所属测试集</span>
              <strong>{{ selectedSuiteTitle ?? "未识别" }}</strong>
            </div>
            <div class="metric-card">
              <span class="metric-label">用例编号</span>
              <strong>{{ caseDraft.idText || "未设置" }}</strong>
            </div>
            <div class="metric-card">
              <span class="metric-label">命令数</span>
              <strong>{{ caseMetrics.commandCount }}</strong>
            </div>
            <div class="metric-card">
              <span class="metric-label">注释 / 原文块</span>
              <strong>{{ caseMetrics.noteCount }} / {{ caseMetrics.rawCount }}</strong>
            </div>
          </div>

          <div class="workspace-grid">
            <section class="section">
              <h3>基本信息</h3>
              <div class="grid">
                <input v-model="caseDraft.idText" placeholder="序号（可选）" />
                <input v-model="caseDraft.title" placeholder="用例标题" />
              </div>
            </section>

            <section class="section">
              <h3>运行提示</h3>
              <p class="hint">命令不会单独编辑，右侧时间线中的按钮用于“运行到此命令”。</p>
            </section>

            <section class="section span-2">
              <h3>命令时间线</h3>
              <div v-if="caseNode.children.length" class="timeline">
                <div
                  v-for="child in caseNode.children"
                  :key="child.id"
                  class="timeline-item"
                >
                  <div class="timeline-rail">
                    <span class="timeline-dot" />
                  </div>
                  <div class="timeline-card">
                    <div class="timeline-header">
                      <div>
                        <span class="command-kind">{{ caseChildTag(child) }}</span>
                        <strong>{{ child.label }}</strong>
                      </div>
                      <span class="muted">第 {{ child.startLine + 1 }} 行</span>
                    </div>
                    <p class="timeline-summary">{{ caseChildSummary(child) }}</p>
                    <div class="timeline-actions">
                      <button
                        v-if="child.kind === 'command'"
                        type="button"
                        class="ghost"
                        @click="runToCommand(child)"
                      >
                        运行到此命令
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="muted">当前用例没有命令</div>
            </section>

            <section class="section span-2">
              <h3>整段用例原文</h3>
              <p class="hint">需要调整命令时，直接编辑整个用例原文并保存。</p>
              <textarea v-model="caseDraft.rawText" rows="20" />
            </section>
          </div>

          <div class="action-bar">
            <button
              type="button"
              class="primary-action"
              @click="caseNode && saveCase(caseNode, selectedSuiteStartLine)"
            >
              保存用例信息
            </button>
            <button
              type="button"
              class="ghost"
              @click="caseNode && saveRaw('case', caseNode.startLine, caseDraft.rawText)"
            >
              保存整段原文
            </button>
            <button
              type="button"
              class="ghost"
              @click="caseNode && emit('mutate-case', { action: 'move', suiteStartLine: selectedSuiteStartLine ?? 0, caseStartLine: caseNode.startLine, direction: 'up' })"
            >
              上移
            </button>
            <button
              type="button"
              class="ghost"
              @click="caseNode && emit('mutate-case', { action: 'move', suiteStartLine: selectedSuiteStartLine ?? 0, caseStartLine: caseNode.startLine, direction: 'down' })"
            >
              下移
            </button>
            <button
              type="button"
              class="warn"
              @click="caseNode && emit('mutate-case', { action: 'delete', suiteStartLine: selectedSuiteStartLine ?? 0, caseStartLine: caseNode.startLine })"
            >
              删除
            </button>
          </div>
        </template>

        <template v-else>
          <section class="section">
            <h3>整段用例原文</h3>
            <textarea v-model="caseDraft.rawText" rows="20" />
          </section>
          <div class="action-bar">
            <button
              type="button"
              class="primary-action"
              @click="caseNode && saveRaw('case', caseNode.startLine, caseDraft.rawText)"
            >
              保存原文
            </button>
          </div>
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
.detail-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--studio-gap);
  overflow: hidden;
}

.detail-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--studio-gap);
}

.detail-scroll {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--studio-gap);
}

.workspace-grid,
.metric-grid {
  display: grid;
  gap: 12px;
}

.workspace-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.metric-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.span-2 {
  grid-column: span 2;
}

.placeholder,
.section,
.metric-card {
  border: 1px solid var(--studio-border);
  border-radius: var(--studio-radius);
  background: var(--studio-surface);
  padding: 14px;
}

.placeholder {
  flex: 1;
}

.placeholder.error {
  border-color: var(--vscode-inputValidation-errorBorder);
}

.placeholder h2,
.section-header h2,
.section h3,
.metric-card strong {
  margin: 0;
}

.placeholder p,
.section-header p,
.hint {
  margin: 6px 0 0;
  color: var(--studio-muted);
  line-height: 1.5;
}

.metric-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.metric-label {
  color: var(--studio-muted);
  font-size: 11px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 12px;
  border: 1px solid var(--studio-border);
  border-radius: var(--studio-radius);
  background: var(--studio-surface);
  padding: 14px;
}

.grid {
  display: grid;
  gap: 10px;
}

.grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.grid.four {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.actions,
.inline-form,
.action-bar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.action-bar {
  position: sticky;
  bottom: 0;
  z-index: 2;
  padding: 12px;
  border: 1px solid var(--studio-border);
  border-radius: var(--studio-radius);
  background: color-mix(in srgb, var(--studio-surface) 88%, transparent);
  backdrop-filter: blur(6px);
}

.primary-action {
  min-width: 150px;
}

.case-card-list,
.stack-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.case-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  border: 1px solid var(--studio-border);
  border-radius: var(--studio-radius);
  background: var(--studio-surface-alt);
  padding: 10px 12px;
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.timeline-item {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.timeline-rail {
  position: relative;
  min-height: 100%;
}

.timeline-rail::after {
  content: "";
  position: absolute;
  top: 14px;
  bottom: -12px;
  left: 11px;
  width: 1px;
  background: var(--studio-border);
}

.timeline-item:last-child .timeline-rail::after {
  display: none;
}

.timeline-dot {
  position: absolute;
  top: 10px;
  left: 6px;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--vscode-button-background);
}

.timeline-card {
  border: 1px solid var(--studio-border);
  border-radius: var(--studio-radius);
  padding: 12px;
  background: var(--studio-surface-alt);
}

.timeline-header,
.timeline-actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.command-kind {
  display: inline-block;
  min-width: 72px;
  margin-right: 8px;
  color: var(--studio-muted);
  font-size: 11px;
  text-transform: uppercase;
}

.timeline-summary {
  margin: 8px 0 0;
  color: var(--studio-muted);
  line-height: 1.5;
  word-break: break-word;
}

input,
textarea,
select {
  width: 100%;
}

textarea {
  resize: vertical;
  min-height: 180px;
}

.muted {
  color: var(--studio-muted);
}

button.warn {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-errorForeground);
}

button.ghost {
  background: transparent;
  border: 1px solid var(--studio-border);
}

@media (max-width: 1200px) {
  .workspace-grid,
  .metric-grid,
  .grid.three,
  .grid.four {
    grid-template-columns: 1fr;
  }

  .span-2 {
    grid-column: auto;
  }

  .section-header,
  .case-card,
  .timeline-header,
  .timeline-actions {
    flex-direction: column;
    align-items: start;
  }

  .timeline-item {
    grid-template-columns: 16px minmax(0, 1fr);
  }
}
</style>
