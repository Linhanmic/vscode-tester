<script setup lang="ts">
import { computed } from "vue";
import type {
  StudioLoadingState,
  StudioOutlineNode,
  StudioScriptItem,
  StudioScriptsSnapshot,
} from "../shared";
import type { ProjectSummary } from "../viewModels";

const props = defineProps<{
  scripts: StudioScriptsSnapshot;
  treeNodes: StudioOutlineNode[];
  selectedNodeId?: string;
  overviewNodeId: string;
  summary: ProjectSummary;
  projectLoadState: StudioLoadingState;
  selectedScriptUri?: string;
  collapsedSuiteIds: string[];
}>();

const emit = defineEmits<{
  (event: "select-script", item?: StudioScriptItem): void;
  (event: "pick-script"): void;
  (event: "select-node", nodeId: string): void;
  (event: "toggle-suite", suiteId: string): void;
  (event: "run-suite", payload: { uri: string; suiteStartLine: number }): void;
  (event: "run-case", payload: {
    uri: string;
    suiteStartLine: number;
    caseStartLine: number;
  }): void;
}>();

const configNodes = computed(() =>
  props.treeNodes.filter((node) => node.kind === "config"),
);

const suiteGroups = computed(() => {
  const collapsed = new Set(props.collapsedSuiteIds);
  const groups: Array<{
    suite: StudioOutlineNode;
    collapsed: boolean;
    cases: StudioOutlineNode[];
  }> = [];

  for (const node of props.treeNodes) {
    if (node.kind === "suite") {
      groups.push({
        suite: node,
        collapsed: collapsed.has(node.id),
        cases: [],
      });
      continue;
    }

    if (node.kind !== "case") {
      continue;
    }

    const group = groups.find((item) => item.suite.startLine === node.suiteStartLine);
    if (group) {
      group.cases.push(node);
    }
  }

  return groups;
});

function kindLabel(kind: StudioOutlineNode["kind"]) {
  switch (kind) {
    case "config":
      return "配置";
    case "suite":
      return "测试集";
    case "case":
      return "用例";
  }
}

function runSuite(node: StudioOutlineNode) {
  if (!props.selectedScriptUri || node.suiteStartLine === undefined) {
    return;
  }

  emit("run-suite", {
    uri: props.selectedScriptUri,
    suiteStartLine: node.suiteStartLine,
  });
}

function runCase(node: StudioOutlineNode) {
  if (
    !props.selectedScriptUri ||
    node.suiteStartLine === undefined ||
    node.caseStartLine === undefined
  ) {
    return;
  }

  emit("run-case", {
    uri: props.selectedScriptUri,
    suiteStartLine: node.suiteStartLine,
    caseStartLine: node.caseStartLine,
  });
}
</script>

<template>
  <aside class="sidebar">
    <section class="panel">
      <header class="panel-header">
        <div>
          <h2>导航与运行</h2>
          <p>{{ scripts.message ?? "页面主动选择脚本，按测试集 / 用例树导航与运行" }}</p>
        </div>
        <button type="button" class="secondary" @click="emit('pick-script')">
          选择文件
        </button>
      </header>

      <div class="panel-body scroll-region">
        <section class="subsection">
          <div class="subsection-head">
            <h3>脚本</h3>
            <span>{{ scripts.items.length }} 个</span>
          </div>

          <div v-if="scripts.loadState === 'loading'" class="empty">
            正在加载脚本列表
          </div>
          <div v-else class="script-list">
            <button
              type="button"
              class="script-item"
              :class="{ active: !scripts.selectedUri }"
              @click="emit('select-script', undefined)"
            >
              <span class="script-name">全局工具模式</span>
              <span class="script-path">未选择脚本时也可使用 DBC / 解析 / 总线</span>
            </button>
            <button
              v-for="item in scripts.items"
              :key="item.uri"
              type="button"
              class="script-item"
              :class="{ active: item.uri === scripts.selectedUri }"
              @click="emit('select-script', item)"
            >
              <span class="script-name">{{ item.name }}</span>
              <span class="script-path">{{ item.path }}</span>
            </button>
          </div>
        </section>

        <section class="subsection">
          <div class="subsection-head">
            <h3>结构树</h3>
            <span>
              {{ summary.suiteCount }} 集 / {{ summary.caseCount }} 例 /
              {{ summary.commandCount }} 条命令
            </span>
          </div>

          <div v-if="projectLoadState === 'loading'" class="empty">
            正在解析脚本结构
          </div>
          <div v-else-if="scripts.selectedUri" class="tree-root">
            <div class="tree-entry top-entry">
              <button
                type="button"
                class="tree-main"
                :class="{ active: selectedNodeId === overviewNodeId }"
                @click="emit('select-node', overviewNodeId)"
              >
                <span class="tree-bullet" />
                <span class="tree-kind">脚本</span>
                <span class="tree-label">脚本概览</span>
              </button>
            </div>

            <div v-for="node in configNodes" :key="node.id" class="tree-entry top-entry">
              <button
                type="button"
                class="tree-main"
                :class="{ active: node.id === selectedNodeId }"
                @click="emit('select-node', node.id)"
              >
                <span class="tree-bullet" />
                <span class="tree-kind">{{ kindLabel(node.kind) }}</span>
                <span class="tree-label">{{ node.label }}</span>
              </button>
            </div>

            <div
              v-for="group in suiteGroups"
              :key="group.suite.id"
              class="tree-group"
            >
              <div class="tree-entry suite-entry">
                <button
                  type="button"
                  class="tree-toggle"
                  @click="emit('toggle-suite', group.suite.id)"
                >
                  <span class="twisty" :class="{ collapsed: group.collapsed }" />
                </button>
                <button
                  type="button"
                  class="tree-main"
                  :class="{ active: group.suite.id === selectedNodeId }"
                  @click="emit('select-node', group.suite.id)"
                >
                  <span class="tree-bullet" />
                  <span class="tree-kind">{{ kindLabel(group.suite.kind) }}</span>
                  <span class="tree-label">{{ group.suite.label }}</span>
                </button>
                <button
                  v-if="selectedScriptUri"
                  type="button"
                  class="tree-run ghost"
                  @click.stop="runSuite(group.suite)"
                >
                  运行
                </button>
              </div>

              <div v-if="!group.collapsed" class="tree-children">
                <div
                  v-for="caseNode in group.cases"
                  :key="caseNode.id"
                  class="tree-entry case-entry"
                >
                  <span class="tree-branch" />
                  <button
                    type="button"
                    class="tree-main"
                    :class="{ active: caseNode.id === selectedNodeId }"
                    @click="emit('select-node', caseNode.id)"
                  >
                    <span class="tree-bullet" />
                    <span class="tree-kind">{{ kindLabel(caseNode.kind) }}</span>
                    <span class="tree-label">{{ caseNode.label }}</span>
                  </button>
                  <button
                    v-if="selectedScriptUri"
                    type="button"
                    class="tree-run ghost"
                    @click.stop="runCase(caseNode)"
                  >
                    运行
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty">
            选择脚本后显示结构树
          </div>
        </section>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.sidebar {
  min-width: 0;
  min-height: 0;
  display: flex;
}

.panel {
  width: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--studio-border);
  border-radius: var(--studio-radius);
  background: var(--studio-surface);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--studio-border);
}

.panel-header h2 {
  margin: 0;
  font-size: 13px;
}

.panel-header p {
  margin: 4px 0 0;
  color: var(--studio-muted);
  font-size: 11px;
  line-height: 1.4;
}

.panel-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px;
}

.subsection {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.subsection-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  color: var(--studio-muted);
}

.subsection-head h3 {
  margin: 0;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.secondary {
  align-self: start;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.secondary:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.script-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.script-item {
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--studio-border);
  background: transparent;
  color: inherit;
  text-align: left;
}

.script-item:hover,
.tree-main:hover {
  background: var(--vscode-list-hoverBackground);
}

.script-item.active,
.tree-main.active {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.script-name,
.tree-label {
  font-weight: 600;
}

.script-path {
  color: var(--studio-muted);
  font-size: 11px;
  word-break: break-all;
}

.tree-root {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tree-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tree-children {
  position: relative;
  margin-left: 20px;
  padding-left: 16px;
  border-left: 1px solid var(--studio-border);
}

.tree-entry {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.top-entry {
  grid-template-columns: minmax(0, 1fr);
}

.tree-toggle {
  min-width: 24px;
  min-height: 32px;
  padding: 0;
  border: none;
  background: transparent;
}

.twisty {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);
  transition: transform 120ms ease;
}

.twisty.collapsed {
  transform: rotate(-45deg);
}

.tree-main {
  position: relative;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--studio-border);
  background: transparent;
  color: inherit;
  text-align: left;
}

.tree-bullet {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--studio-muted);
  flex: 0 0 auto;
}

.tree-kind {
  min-width: 40px;
  color: var(--studio-muted);
  font-size: 11px;
}

.tree-label {
  min-width: 0;
}

.tree-run {
  min-width: 64px;
}

.tree-run.ghost {
  background: transparent;
  border: 1px solid var(--studio-border);
}

.tree-branch {
  position: absolute;
  left: -16px;
  width: 16px;
  border-top: 1px solid var(--studio-border);
}

.case-entry {
  position: relative;
  margin: 4px 0;
}

.empty {
  padding: 18px 12px;
  color: var(--studio-muted);
  text-align: center;
  border: 1px dashed var(--studio-border);
  border-radius: var(--studio-radius);
}
</style>
