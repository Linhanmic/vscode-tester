import { CanSession, CanTransportRxFrame } from "./types";
import { OutputReporter } from "./outputReporter";
import { RunnerCancellation } from "./utils";

interface ChannelState {
  frames: CanTransportRxFrame[];
  cursor: number;
  waiters: Array<() => void>;
}

export class ChannelCaptureHub {
  private readonly channelStates = new Map<number, ChannelState>();
  private readonly readLoops: Promise<void>[] = [];
  private failures: Error[] = [];
  private stopped = false;

  constructor(
    private readonly session: CanSession,
    channelIndexes: number[],
    private readonly reporter: OutputReporter,
    private readonly cancellation: RunnerCancellation,
  ) {
    for (const channelIndex of channelIndexes) {
      this.channelStates.set(channelIndex, {
        frames: [],
        cursor: 0,
        waiters: [],
      });
    }
  }

  start() {
    for (const channelIndex of this.channelStates.keys()) {
      this.readLoops.push(this.runLoop(channelIndex));
    }
  }

  throwIfFailed() {
    const failure = this.failures.shift();
    if (failure) {
      throw failure;
    }
  }

  async stop() {
    this.stopped = true;
    for (const state of this.channelStates.values()) {
      const waiters = [...state.waiters];
      state.waiters.length = 0;
      for (const waiter of waiters) {
        waiter();
      }
    }
    await Promise.allSettled(this.readLoops);
  }

  async readNextFrame(
    channelIndex: number,
    timeoutMs: number,
  ): Promise<CanTransportRxFrame | null> {
    const state = this.requireChannelState(channelIndex);
    this.cancellation.throwIfRequested();
    this.throwIfFailed();

    const frame = this.takeNextFrame(state);
    if (frame) {
      return frame;
    }

    await this.waitForFrames(state, timeoutMs);
    this.cancellation.throwIfRequested();
    this.throwIfFailed();
    return this.takeNextFrame(state) ?? null;
  }

  private requireChannelState(channelIndex: number) {
    const state = this.channelStates.get(channelIndex);
    if (!state) {
      throw new Error(`channel ${channelIndex} is not being monitored`);
    }
    return state;
  }

  private takeNextFrame(state: ChannelState) {
    const frame = state.frames[state.cursor];
    if (!frame) {
      return undefined;
    }

    state.cursor += 1;
    if (state.cursor > 64) {
      state.frames.splice(0, state.cursor);
      state.cursor = 0;
    }
    return frame;
  }

  private async waitForFrames(state: ChannelState, timeoutMs: number) {
    if (timeoutMs <= 0 || this.stopped) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        state.waiters = state.waiters.filter((waiter) => waiter !== complete);
        resolve();
      }, timeoutMs);

      const complete = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve();
      };

      state.waiters.push(complete);
    });
  }

  private async runLoop(channelIndex: number) {
    const state = this.requireChannelState(channelIndex);

    while (!this.stopped) {
      try {
        const frame = await this.session.read(channelIndex, 100);
        if (!frame) {
          continue;
        }

        state.frames.push(frame);
        if (state.frames.length > 512) {
          const removable = Math.min(state.cursor, state.frames.length - 512);
          if (removable > 0) {
            state.frames.splice(0, removable);
            state.cursor -= removable;
          }
        }

        this.reporter.observeFrame(channelIndex, frame.id, frame.data);
        const waiters = [...state.waiters];
        state.waiters.length = 0;
        for (const waiter of waiters) {
          waiter();
        }
      } catch (error) {
        if (this.stopped) {
          return;
        }
        this.failures.push(error instanceof Error ? error : new Error(String(error)));
        const waiters = [...state.waiters];
        state.waiters.length = 0;
        for (const waiter of waiters) {
          waiter();
        }
        return;
      }
    }
  }
}
