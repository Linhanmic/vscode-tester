/// <reference types="vite/client" />

declare function acquireVsCodeApi<T = unknown>(): {
  getState(): T | undefined;
  setState(state: T): void;
  postMessage(message: unknown): void;
};
