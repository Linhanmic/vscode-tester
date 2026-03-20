type WebviewState = {
  selectedNodeId?: string;
  activeToolTab?: string;
  decoderInput?: string;
  collapsedSuiteIds?: string[];
  selectedScriptUri?: string;
};

const fallbackApi = {
  getState(): WebviewState | undefined {
    return undefined;
  },
  setState(_: WebviewState) {},
  postMessage(message: unknown) {
    console.info("postMessage", message);
  },
};

export const vscodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi<WebviewState>()
    : fallbackApi;

export type { WebviewState };
