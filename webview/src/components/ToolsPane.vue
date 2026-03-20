<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { StudioDbcSnapshot, StudioDecoderSnapshot } from "../shared";

const props = defineProps<{
  activeTab: string;
  decoderInput: string;
  dbc: StudioDbcSnapshot;
  device: {
    loadState: "idle" | "loading" | "ready" | "error";
    status: { state: string; message: string; canSend: boolean };
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
      messageIdText: string;
      dataText: string;
      periodMs: number;
      count: number;
      sentCount: number;
      status: string;
    }>;
  };
  busMonitor: {
    loadState: "idle" | "loading" | "ready" | "error";
    runStatus: string;
    runTitle: string;
    currentCase: string;
    passedCount: number;
    failedCount: number;
    activeTasks: Array<{
      key: string;
      channelIndex: number;
      messageIdText: string;
      data: string;
      sentCount: number;
      count: number;
      periodMs: number;
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
}>();

const emit = defineEmits<{
  (event: "update:activeTab", value: string): void;
  (event: "update:decoderInput", value: string): void;
  (event: "start-device-task", payload: {
    channelIndex: number;
    messageIdText: string;
    dataText: string;
    periodMs: number | string;
    count: number | string;
  }): void;
  (event: "stop-device-task", key: string): void;
  (event: "decode", input: string): void;
  (event: "set-dbc-path", path: string): void;
  (event: "pick-dbc-path"): void;
  (event: "clear-dbc-path"): void;
  (event: "clear-bus"): void;
}>();

const tabs = [
  { id: "device", label: "设备" },
  { id: "bus", label: "总线" },
  { id: "decoder", label: "解析" },
  { id: "dbc", label: "DBC" },
] as const;

const dbcSelectValue = computed({
  get: () => props.dbc.configuredPath,
  set: (value: string) => emit("set-dbc-path", value),
});
const deviceDrafts = reactive(
  {} as Record<
    number,
    {
      messageIdText: string;
      dataText: string;
      periodMs: number;
      count: number;
    }
  >,
);

watch(
  () => props.device.channels,
  (channels) => {
    for (const channel of channels) {
      deviceDrafts[channel.channelIndex] = {
        messageIdText: channel.draft.messageIdText,
        dataText: channel.draft.dataText,
        periodMs: channel.draft.periodMs,
        count: channel.draft.count,
      };
    }
  },
  { deep: true, immediate: true },
);

function onDecoderInput(event: Event) {
  emit(
    "update:decoderInput",
    (event.target as HTMLTextAreaElement | null)?.value ?? "",
  );
}
</script>

<template>
  <aside class="tools-pane">
    <section class="panel">
      <header class="panel-header">
        <div>
          <h2>工具台</h2>
          <p>把高频操作固定到可视区，长日志和结果列表独立滚动。</p>
        </div>
      </header>

      <div class="tab-strip">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="tab"
          :class="{ active: activeTab === tab.id }"
          @click="emit('update:activeTab', tab.id)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="panel-body">
        <template v-if="activeTab === 'device'">
          <div v-if="device.loadState === 'loading'" class="empty">
            正在初始化设备服务
          </div>
          <div v-else class="tool-shell">
            <div class="tool-fixed stack">
              <div class="status-card">
                <strong>{{ device.deviceLabel }}</strong>
                <p>{{ device.status.message }}</p>
              </div>
            </div>

            <div class="tool-scroll scroll-region">
              <div class="stack">
                <div
                  v-for="channel in device.channels"
                  :key="channel.channelIndex"
                  class="device-card"
                >
                  <div class="card-head">
                    <strong>ch{{ channel.channelIndex }}</strong>
                    <span class="muted">{{ channel.deviceId }} / {{ channel.deviceIndex }}</span>
                  </div>
                  <div class="grid two">
                    <input
                      v-model="deviceDrafts[channel.channelIndex].messageIdText"
                      placeholder="报文 ID"
                    />
                    <input
                      v-model="deviceDrafts[channel.channelIndex].dataText"
                      placeholder="报文数据"
                    />
                    <input
                      v-model.number="deviceDrafts[channel.channelIndex].periodMs"
                      placeholder="周期"
                    />
                    <input
                      v-model.number="deviceDrafts[channel.channelIndex].count"
                      placeholder="次数"
                    />
                  </div>
                  <button
                    type="button"
                    class="primary-wide"
                    :disabled="!device.status.canSend"
                    @click="emit('start-device-task', { channelIndex: channel.channelIndex, messageIdText: deviceDrafts[channel.channelIndex].messageIdText, dataText: deviceDrafts[channel.channelIndex].dataText, periodMs: deviceDrafts[channel.channelIndex].periodMs, count: deviceDrafts[channel.channelIndex].count })"
                  >
                    启动临时发送
                  </button>
                </div>

                <div v-if="device.activeTasks.length" class="card">
                  <div class="card-head">
                    <strong>活动任务</strong>
                  </div>
                  <div class="sub-list">
                    <div v-for="task in device.activeTasks" :key="task.key" class="sub-item">
                      <span>ch{{ task.channelIndex }} {{ task.messageIdText }} {{ task.sentCount }}/{{ task.count }}</span>
                      <button type="button" class="ghost" @click="emit('stop-device-task', task.key)">
                        停止
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="activeTab === 'bus'">
          <div v-if="busMonitor.loadState === 'loading'" class="empty">
            正在初始化总线监视
          </div>
          <div v-else class="tool-shell">
            <div class="tool-fixed stack">
              <div class="status-card">
                <div class="card-head">
                  <strong>{{ busMonitor.runTitle }}</strong>
                  <button type="button" class="ghost" @click="emit('clear-bus')">
                    清空
                  </button>
                </div>
                <p>当前 {{ busMonitor.currentCase }}</p>
              </div>
              <div class="chip-row chip-wrap">
                <span class="chip">状态 {{ busMonitor.runStatus }}</span>
                <span class="chip">通过 {{ busMonitor.passedCount }}</span>
                <span class="chip">失败 {{ busMonitor.failedCount }}</span>
                <span class="chip">活动任务 {{ busMonitor.activeTasks.length }}</span>
              </div>
            </div>

            <div class="tool-scroll scroll-region">
              <div class="stack">
                <div class="card">
                  <div class="card-head">
                    <strong>最近报文</strong>
                    <span class="muted">{{ busMonitor.visibleFrames.length }} / {{ busMonitor.totalFrameCount }}</span>
                  </div>
                  <div class="list-scroll scroll-region inner-scroll">
                    <div class="sub-list compact-list">
                      <div v-for="frame in busMonitor.visibleFrames" :key="frame.key" class="sub-item">
                        <span>{{ frame.direction.toUpperCase() }} ch{{ frame.channelIndex }} {{ frame.messageIdText }}</span>
                        <span class="muted">{{ frame.data }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="card">
                  <div class="card-head">
                    <strong>日志</strong>
                    <span class="muted">{{ busMonitor.visibleLogs.length }} / {{ busMonitor.totalLogCount }}</span>
                  </div>
                  <div class="list-scroll scroll-region inner-scroll log-scroll">
                    <div class="sub-list">
                      <div v-for="log in busMonitor.visibleLogs" :key="log.id" class="log-item">
                        <strong>{{ log.title }}</strong>
                        <span class="muted">{{ log.timeText }}</span>
                        <p>{{ log.description }}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="activeTab === 'decoder'">
          <div v-if="decoder.loadState === 'loading'" class="empty">
            正在初始化解码服务
          </div>
          <div v-else class="tool-shell">
            <div class="tool-fixed stack">
              <div class="status-card">
                <strong>解码状态</strong>
                <p>{{ decoder.status.message }}</p>
              </div>
              <div class="card">
                <textarea
                  :value="decoderInput"
                  rows="6"
                  placeholder="每行一条：报文ID, 数据"
                  @input="onDecoderInput"
                />
                <div class="actions top-gap">
                  <button
                    type="button"
                    class="primary-wide"
                    :disabled="!decoder.status.canDecode"
                    @click="emit('decode', decoderInput)"
                  >
                    解析
                  </button>
                </div>
                <div class="chip-row chip-wrap top-gap">
                  <span class="chip">总数 {{ decoder.summary.total }}</span>
                  <span class="chip">成功 {{ decoder.summary.successCount }}</span>
                  <span class="chip">失败 {{ decoder.summary.errorCount }}</span>
                </div>
              </div>
            </div>

            <div class="tool-scroll scroll-region">
              <div class="card fill-card">
                <div class="card-head">
                  <strong>解析结果</strong>
                  <span class="muted">最多显示 60 条</span>
                </div>
                <div class="list-scroll scroll-region inner-scroll result-scroll">
                  <div class="stack">
                    <div
                      v-for="item in decoder.items.slice(0, 60)"
                      :key="`${item.lineNumber}-${item.rawInput}`"
                      class="result-card"
                    >
                      <div class="card-head">
                        <strong>{{ item.kind === 'message' ? item.message.name : '解析失败' }}</strong>
                        <span class="muted">第 {{ item.lineNumber }} 行</span>
                      </div>
                      <p>{{ item.rawInput }}</p>
                      <p v-if="item.kind === 'message'">{{ item.message.idHex }} / {{ item.message.dataText }}</p>
                      <p v-else class="error-text">{{ item.message }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div v-if="dbc.loadState === 'loading'" class="empty">
            正在扫描工作区 DBC 文件
          </div>
          <div v-else class="tool-shell">
            <div class="tool-fixed stack">
              <div class="status-card">
                <strong>DBC</strong>
                <p>{{ dbc.message ?? dbc.status.message }}</p>
              </div>
              <div class="card">
                <select v-model="dbcSelectValue">
                  <option value="">自动发现</option>
                  <option v-for="file in dbc.availableFiles" :key="file" :value="file">
                    {{ file }}
                  </option>
                </select>
                <div class="actions top-gap">
                  <button type="button" class="primary-wide" @click="emit('pick-dbc-path')">
                    浏览 DBC
                  </button>
                  <button type="button" class="ghost" @click="emit('clear-dbc-path')">
                    自动发现
                  </button>
                </div>
                <div class="muted path top-gap">{{ dbc.configuredPath || "当前未指定，使用自动发现" }}</div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.tools-pane {
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

.tab-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--studio-border);
}

.tab {
  min-height: 38px;
  font-weight: 600;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.tab.active {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 12px;
}

.tool-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-fixed {
  flex: 0 0 auto;
}

.tool-scroll {
  flex: 1;
  min-height: 0;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.status-card,
.card,
.device-card,
.result-card {
  border: 1px solid var(--studio-border);
  border-radius: var(--studio-radius);
  padding: 12px;
  background: var(--studio-surface-alt);
}

.device-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.fill-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.list-scroll {
  min-height: 0;
}

.inner-scroll {
  margin-top: 10px;
  border-top: 1px solid var(--studio-border);
  padding-top: 10px;
}

.log-scroll {
  max-height: 240px;
}

.result-scroll {
  flex: 1;
  max-height: 320px;
}

.status-card p,
.log-item p,
.result-card p,
.card p {
  margin: 4px 0 0;
  line-height: 1.5;
}

.card-head,
.sub-item,
.chip-row,
.actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.chip-wrap,
.actions {
  flex-wrap: wrap;
}

.sub-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.compact-list .sub-item {
  align-items: start;
}

.grid {
  display: grid;
  gap: 8px;
}

.grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.primary-wide {
  width: 100%;
}

.top-gap {
  margin-top: 10px;
}

.muted {
  color: var(--studio-muted);
}

.chip {
  border: 1px solid var(--studio-border);
  border-radius: 999px;
  padding: 5px 9px;
  font-size: 11px;
}

.ghost {
  background: transparent;
  border: 1px solid var(--studio-border);
}

.empty {
  flex: 1;
  color: var(--studio-muted);
  text-align: center;
  padding: 20px 12px;
  border: 1px dashed var(--studio-border);
  border-radius: var(--studio-radius);
}

.log-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.path {
  word-break: break-all;
}

.error-text {
  color: var(--vscode-errorForeground);
}

@media (max-width: 1200px) {
  .tab-strip,
  .grid.two {
    grid-template-columns: 1fr;
  }

  .result-scroll,
  .log-scroll {
    max-height: none;
  }
}
</style>
