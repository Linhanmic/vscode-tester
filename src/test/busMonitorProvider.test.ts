import * as assert from "assert";
import { TesterBusMonitorStore } from "../providers/busMonitorStore";

suite("TesterBusMonitorStore", () => {
  test("可根据总线事件更新活动发送、聚合报文和日志", () => {
    const store = new TesterBusMonitorStore();

    store.handleEvent({
      type: "run-started",
      scope: "suite",
      title: "发动机启动中",
      totalCases: 2,
      timestamp: Date.now(),
    });
    store.handleEvent({
      type: "case-started",
      caseLabel: "1. 发动机启动中",
      timestamp: Date.now(),
    });
    store.handleEvent({
      type: "send-task-started",
      key: "0:609",
      channelIndex: 0,
      messageId: 0x261,
      data: "2A-01-00-00-00-00-00-D4",
      periodMs: 100,
      count: 3,
      timestamp: Date.now(),
    });
    store.handleEvent({
      type: "bus-frame",
      direction: "tx",
      channelIndex: 0,
      messageId: 0x261,
      data: "2A-01-00-00-00-00-00-D4",
      note: "1/3",
      timestamp: Date.now(),
    });
    store.handleEvent({
      type: "tx-frame",
      key: "0:609",
      channelIndex: 0,
      messageId: 0x261,
      data: "2A-01-00-00-00-00-00-D4",
      sentCount: 1,
      count: 3,
      timestamp: Date.now(),
    });
    store.handleEvent({
      type: "bus-frame",
      direction: "rx",
      channelIndex: 1,
      messageId: 0x261,
      data: "2A-01-00-00-00-00-00-D4",
      note: "捕获",
      timestamp: Date.now(),
    });
    store.handleEvent({
      type: "rx-frame",
      channelIndex: 1,
      messageId: 0x261,
      data: "2A-01-00-00-00-00-00-D4",
      outcome: "matched",
      timestamp: Date.now(),
    });

    const snapshot = store.createSnapshot();

    assert.strictEqual(snapshot.activeTasks.length, 1);
    assert.strictEqual(snapshot.visibleFrames.length, 2);
    assert.strictEqual(snapshot.totalFrameCount, 2);
    assert.strictEqual(snapshot.totalLogCount >= 3, true);
    assert.strictEqual(snapshot.activeTasks[0].sentCount, 1);
    assert.strictEqual(snapshot.visibleFrames[0].direction, "rx");
    assert.strictEqual(snapshot.visibleFrames[1].direction, "tx");
    assert.strictEqual(snapshot.visibleFrames[0].status, "捕获");
    assert.ok(snapshot.visibleLogs.at(-1)?.description.includes("0x261"));
  });
});
