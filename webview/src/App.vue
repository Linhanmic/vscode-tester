<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import DetailPane from "./components/DetailPane.vue";
import ScriptSidebar from "./components/ScriptSidebar.vue";
import ToolsPane from "./components/ToolsPane.vue";
import type {
  StudioCaseNode,
  StudioProjectItem,
  StudioSnapshot,
  StudioSuiteNode,
  StudioToWebviewMessage,
  WebviewToStudioMessage,
} from "./shared";
import type { TreeNodeInfo } from "./viewModels";
import { vscodeApi } from "./vscode";

const SCRIPT_OVERVIEW_NODE_ID = "__script_overview__";
const TOOL_TABS = new Set(["device", "bus", "decoder", "dbc"]);

const initialState = vscodeApi.getState();
const initialToolTab =
  typeof initialState?.activeToolTab === "string" &&
  TOOL_TABS.has(initialState.activeToolTab)
    ? initialState.activeToolTab
    : "bus";
const state = reactive<StudioSnapshot>(createEmptySnapshot());
const uiState = reactive<{
  selectedNodeId?: string;
  activeToolTab: string;
  decoderInput: string;
  collapsedSuiteIds: string[];
  errorMessage: string;
}>({
  selectedNodeId: initialState?.selectedNodeId,
  activeToolTab: initialToolTab,
  decoderInput: initialState?.decoderInput ?? "",
  collapsedSuiteIds: Array.isArray(initialState?.collapsedSuiteIds)
    ? initialState.collapsedSuiteIds
    : [],
  errorMessage: "",
});

let lastKnownScriptUri = initialState?.selectedScriptUri;

const selectedNode = computed<TreeNodeInfo | undefined>(() => {
  if (
    !uiState.selectedNodeId ||
    uiState.selectedNodeId === SCRIPT_OVERVIEW_NODE_ID
  ) {
    return undefined;
  }

  const outlineNode = state.project.outlineNodes.find(
    (node) => node.id === uiState.selectedNodeId,
  );
  if (!outlineNode) {
    return undefined;
  }

  const payload = findNodeById(state.project.items, outlineNode.id);
  if (!payload) {
    return undefined;
  }

  return {
    ...outlineNode,
    payload,
  };
});

const selectedSuiteNode = computed<StudioSuiteNode | undefined>(() => {
  if (selectedNode.value?.payload.kind === "suite") {
    return selectedNode.value.payload;
  }

  if (selectedNode.value?.payload.kind !== "case") {
    return undefined;
  }

  return state.project.items.find(
    (item): item is StudioSuiteNode =>
      item.kind === "suite" &&
      item.startLine === selectedNode.value?.suiteStartLine,
  );
});

const projectMessage = computed(() => {
  if (state.project.loadState === "loading") {
    return state.project.message ?? "正在加载脚本结构";
  }

  if (state.project.state === "error") {
    return state.project.errorMessage ?? "脚本解析失败";
  }

  return state.project.config.status.message;
});

watch(
  () => [
    uiState.selectedNodeId,
    uiState.activeToolTab,
    uiState.decoderInput,
    uiState.collapsedSuiteIds.join("|"),
    state.project.script?.uri ?? "",
  ],
  () => {
    vscodeApi.setState({
      selectedNodeId: uiState.selectedNodeId,
      activeToolTab: uiState.activeToolTab,
      decoderInput: uiState.decoderInput,
      collapsedSuiteIds: [...uiState.collapsedSuiteIds],
      selectedScriptUri: state.project.script?.uri,
    });
  },
  {
    deep: true,
  },
);

watch(
  () => state.project.script?.uri,
  (uri) => {
    if (uri !== lastKnownScriptUri) {
      uiState.collapsedSuiteIds = [];
      lastKnownScriptUri = uri;
    }

    if (!uri) {
      uiState.selectedNodeId = undefined;
    }
  },
  { immediate: true },
);

watch(
  () => [
    state.project.script?.uri,
    state.project.outlineNodes.map((node) => node.id).join("|"),
  ],
  () => {
    if (!state.project.script?.uri) {
      uiState.selectedNodeId = undefined;
      return;
    }

    if (uiState.selectedNodeId === SCRIPT_OVERVIEW_NODE_ID) {
      return;
    }

    if (
      uiState.selectedNodeId &&
      state.project.outlineNodes.some((node) => node.id === uiState.selectedNodeId)
    ) {
      return;
    }

    uiState.selectedNodeId = SCRIPT_OVERVIEW_NODE_ID;
  },
  {
    immediate: true,
  },
);

function postMessage(message: WebviewToStudioMessage) {
  vscodeApi.postMessage(message);
}

function handleMessage(message: StudioToWebviewMessage) {
  switch (message.type) {
    case "initStudio":
      replaceSnapshot(message.snapshot);
      return;
    case "updateScripts":
      state.scripts = message.snapshot;
      return;
    case "updateDbc":
      state.dbc = message.snapshot;
      return;
    case "updateProject":
      state.project = message.snapshot;
      return;
    case "updateDevice":
      state.device = message.snapshot;
      return;
    case "updateBusMonitor":
      state.busMonitor = message.snapshot;
      return;
    case "updateDecoder":
      state.decoder = message.snapshot;
      return;
    case "error":
      uiState.errorMessage = message.message;
  }
}

function replaceSnapshot(snapshot: StudioSnapshot) {
  state.scripts = snapshot.scripts;
  state.dbc = snapshot.dbc;
  state.project = snapshot.project;
  state.device = snapshot.device;
  state.busMonitor = snapshot.busMonitor;
  state.decoder = snapshot.decoder;
  state.capabilities = snapshot.capabilities;
}

function selectScript(uri?: string) {
  postMessage({
    type: "selectScript",
    uri,
  });
}

function openNode(node: TreeNodeInfo) {
  postMessage({
    type: "openInEditor",
    uri: state.project.script?.uri ?? state.scripts.selectedUri ?? "",
    startLine: node.payload.range.start.line,
    startCharacter: node.payload.range.start.character,
  });
}

function toggleSuite(id: string) {
  const next = new Set(uiState.collapsedSuiteIds);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  uiState.collapsedSuiteIds = Array.from(next);
}

function onWindowMessage(event: MessageEvent<StudioToWebviewMessage>) {
  handleMessage(event.data);
}

onMounted(() => {
  window.addEventListener("message", onWindowMessage);
  postMessage({
    type: "ready",
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onWindowMessage);
});

function findNodeById(
  items: StudioProjectItem[],
  id: string,
): StudioProjectItem | StudioSuiteNode | StudioCaseNode | undefined {
  for (const item of items) {
    if (item.id === id) {
      return item;
    }

    if (item.kind !== "suite") {
      continue;
    }

    for (const suiteChild of item.children) {
      if (suiteChild.kind === "case" && suiteChild.id === id) {
        return suiteChild;
      }
    }
  }

  return undefined;
}

function createEmptySnapshot(): StudioSnapshot {
  return {
    scripts: {
      loadState: "loading",
      message: "正在初始化脚本索引",
      items: [],
    },
    dbc: {
      loadState: "loading",
      message: "正在初始化 DBC 工作区",
      status: {
        state: "unloaded",
        message: "当前未加载 DBC 文件",
      },
      configuredPath: "",
      availableFiles: [],
    },
    project: {
      loadState: "loading",
      message: "正在初始化脚本模型",
      state: "no-script-selected",
      items: [],
      outlineNodes: [],
      summary: {
        suiteCount: 0,
        caseCount: 0,
        commandCount: 0,
      },
      config: {
        status: {
          state: "parser-unavailable",
          message: "Studio 正在初始化",
          canEdit: false,
          canCreateConfigBlock: false,
          canTakeOver: false,
        },
        hasConfigurationBlock: false,
        channels: [],
        diagnose: {},
        dtcs: [],
        dbcStatus: {
          state: "unloaded",
          message: "当前未加载 DBC 文件",
        },
        dbcConfiguredPath: "",
        availableDbcFiles: [],
        isSingleDevice: false,
        deviceLabel: "未配置设备",
      },
    },
    device: {
      loadState: "loading",
      status: {
        state: "no-script-selected",
        message: "设备服务正在初始化",
        canSend: false,
      },
      deviceLabel: "未配置设备",
      channels: [],
      activeTasks: [],
    },
    busMonitor: {
      loadState: "loading",
      runStatus: "idle",
      runTitle: "初始化中",
      currentCase: "无",
      passedCount: 0,
      failedCount: 0,
      activeTasks: [],
      visibleFrames: [],
      visibleLogs: [],
      totalFrameCount: 0,
      totalLogCount: 0,
    },
    decoder: {
      loadState: "loading",
      message: "解码服务正在初始化",
      status: {
        state: "unloaded",
        message: "当前未加载 DBC 文件",
        canDecode: false,
      },
      items: [],
      summary: {
        total: 0,
        successCount: 0,
        errorCount: 0,
      },
    },
    capabilities: {
      canUseGlobalTools: true,
      canEditScript: false,
      canRunScript: false,
      canManageDevice: false,
    },
  };
}
</script>

<template>
  <main class="studio-shell">
    <div v-if="uiState.errorMessage" class="error-banner">
      <span>{{ uiState.errorMessage }}</span>
      <button type="button" class="secondary" @click="uiState.errorMessage = ''">
        关闭
      </button>
    </div>

    <section class="workbench">
      <div class="sidebar-column">
        <ScriptSidebar
          :scripts="state.scripts"
          :tree-nodes="state.project.outlineNodes"
          :selected-node-id="uiState.selectedNodeId"
          :overview-node-id="SCRIPT_OVERVIEW_NODE_ID"
          :summary="state.project.summary"
          :project-load-state="state.project.loadState"
          :selected-script-uri="state.project.script?.uri"
          :collapsed-suite-ids="uiState.collapsedSuiteIds"
          @select-script="selectScript($event?.uri)"
          @pick-script="postMessage({ type: 'selectScript', pick: true })"
          @select-node="uiState.selectedNodeId = $event"
          @toggle-suite="toggleSuite"
          @run-suite="postMessage({ type: 'runSuite', ...$event })"
          @run-case="postMessage({ type: 'runCase', ...$event })"
        />

        <ToolsPane
          :active-tab="uiState.activeToolTab"
          :decoder-input="uiState.decoderInput"
          :dbc="state.dbc"
          :device="state.device"
          :bus-monitor="state.busMonitor"
          :decoder="state.decoder"
          @update:active-tab="uiState.activeToolTab = $event"
          @update:decoder-input="uiState.decoderInput = $event"
          @start-device-task="postMessage({ type: 'startDeviceTask', payload: $event })"
          @stop-device-task="postMessage({ type: 'stopDeviceTask', key: $event })"
          @decode="postMessage({ type: 'decodeMessages', input: $event })"
          @set-dbc-path="postMessage({ type: 'setDbcPath', path: $event })"
          @pick-dbc-path="postMessage({ type: 'pickDbcPath' })"
          @clear-dbc-path="postMessage({ type: 'clearDbcPath' })"
          @clear-bus="postMessage({ type: 'clearBusMonitor' })"
        />
      </div>

      <div class="detail-column">
        <DetailPane
          :project-load-state="state.project.loadState"
          :project-state="state.project.state"
          :project-message="projectMessage"
          :selected-node="selectedNode"
          :selected-script-uri="state.project.script?.uri"
          :project-summary="state.project.summary"
          :project-config-message="state.project.config.status.message"
          :selected-suite-title="selectedSuiteNode?.title"
          :selected-script-name="state.project.script?.name"
          @open-node="openNode"
          @mutate-config="postMessage({ type: 'mutateConfig', ...$event })"
          @mutate-suite="postMessage({ type: 'mutateSuite', mutation: $event })"
          @mutate-case="postMessage({ type: 'mutateCase', mutation: $event })"
          @mutate-raw="postMessage({ type: 'mutateRawBlock', mutation: $event })"
          @run-suite="postMessage({ type: 'runSuite', ...$event })"
          @run-case="postMessage({ type: 'runCase', ...$event })"
          @run-command="postMessage({ type: 'runCommand', ...$event })"
        />
      </div>
    </section>
  </main>
</template>

<style scoped>
.studio-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
}

.workbench {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(420px, 460px) minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
}

.sidebar-column {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(260px, 0.8fr) minmax(360px, 1.2fr);
  gap: 12px;
}

.detail-column {
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.error-banner {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--vscode-inputValidation-errorBackground);
}

.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.secondary:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

@media (max-width: 1280px) {
  .studio-shell {
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }

  .workbench {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .sidebar-column {
    grid-template-rows: auto auto;
  }

  .detail-column {
    overflow: visible;
  }
}
</style>

<style>
:root {
  color-scheme: light dark;
  --studio-radius: 8px;
  --studio-border: var(--vscode-panel-border);
  --studio-surface: var(--vscode-sideBar-background);
  --studio-surface-alt: var(--vscode-editorWidget-background);
  --studio-muted: var(--vscode-descriptionForeground);
  --studio-gap: 12px;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  margin: 0;
  height: 100%;
  background: var(--vscode-editor-background);
  font-family:
    "Segoe UI Variable",
    "Microsoft YaHei UI",
    var(--vscode-font-family);
  font-size: 12px;
}

button,
input,
select,
textarea {
  border-radius: 6px;
  border: 1px solid var(--vscode-input-border, var(--studio-border));
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  font: inherit;
  padding: 7px 10px;
}

button {
  min-height: 34px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
}

button:hover {
  background: var(--vscode-button-hoverBackground);
}

button:disabled {
  cursor: default;
  opacity: 0.65;
}

input:focus,
select:focus,
textarea:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 0;
}

code {
  font-family: var(--vscode-editor-font-family);
}

.scroll-region {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

@media (max-width: 1280px) {
  .scroll-region {
    overflow: visible;
    scrollbar-gutter: auto;
  }
}
</style>
