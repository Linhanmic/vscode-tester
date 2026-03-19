import * as vscode from "vscode";
import { loadLanguage } from "./parser/testerParser";
import { TesterDocumentSymbolProvider } from "./providers/documentSymbolProvider";
import { TesterFoldingProvider } from "./providers/foldingProvider";
import { TesterDiagnosticProvider } from "./providers/diagnosticProvider";
import { TesterHoverProvider } from "./providers/hoverProvider";
import { TreeManager } from "./parser/treeManager";
import { DbcManager } from "./dbc/dbcManager";
import { TesterCompletionProvider } from "./providers/completionProvider";
import {
  BUS_MONITOR_VIEW_ID,
  CLEAR_BUS_MONITOR_COMMAND,
  DEVICE_MANAGER_VIEW_ID,
  DOCUMENT_SELECTOR,
  MESSAGE_DECODER_VIEW_ID,
  PROJECT_CONFIG_VIEW_ID,
  RUN_TEST_CASE_COMMAND,
  RUN_TEST_SUITE_COMMAND,
} from "./constants";
import { TesterRuntimeParser } from "./runtime/parser";
import { TesterCodeLensProvider } from "./providers/codeLensProvider";
import { TesterCancellationError } from "./runtime/utils";
import { TesterBusMonitorProvider } from "./providers/busMonitorProvider";
import { TesterMessageDecoderProvider } from "./providers/messageDecoderProvider";
import { ProjectConfigService } from "./projectConfig/projectConfigService";
import { TesterProjectConfigProvider } from "./providers/projectConfigProvider";
import { DeviceManagerService } from "./deviceManager/deviceManagerService";
import { TesterDeviceManagerProvider } from "./providers/deviceManagerProvider";

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Tester Runner");
  const dbcManager = new DbcManager(context);
  const busMonitorProvider = new TesterBusMonitorProvider();
  const messageDecoderProvider = new TesterMessageDecoderProvider(dbcManager);
  const projectConfigService = new ProjectConfigService(context, dbcManager);
  const projectConfigProvider = new TesterProjectConfigProvider(
    projectConfigService,
  );
  const deviceManagerService = new DeviceManagerService(
    context,
    projectConfigService,
    outputChannel,
    busMonitorProvider,
  );
  const deviceManagerProvider = new TesterDeviceManagerProvider(
    deviceManagerService,
  );

  context.subscriptions.push(
    outputChannel,
    dbcManager.onDidChangeStatus((status) => {
      logDbcStatus(outputChannel, status);
    }),
    vscode.window.registerWebviewViewProvider(
      BUS_MONITOR_VIEW_ID,
      busMonitorProvider,
    ),
    busMonitorProvider,
    vscode.window.registerWebviewViewProvider(
      MESSAGE_DECODER_VIEW_ID,
      messageDecoderProvider,
    ),
    messageDecoderProvider,
    vscode.window.registerWebviewViewProvider(
      PROJECT_CONFIG_VIEW_ID,
      projectConfigProvider,
    ),
    projectConfigProvider,
    vscode.window.registerWebviewViewProvider(
      DEVICE_MANAGER_VIEW_ID,
      deviceManagerProvider,
    ),
    deviceManagerProvider,
    vscode.commands.registerCommand(CLEAR_BUS_MONITOR_COMMAND, () => {
      busMonitorProvider.clear();
    }),
  );

  try {
    await dbcManager.initialize();
  } catch (error) {
    logActivationError(outputChannel, "DBC 初始化失败", error);
  }

  try {
    await loadLanguage();

    const treeManager = new TreeManager(context);
    projectConfigService.setTreeManager(treeManager);
    const runtimeParser = new TesterRuntimeParser(treeManager);

    context.subscriptions.push(
      vscode.languages.registerDocumentSymbolProvider(
        DOCUMENT_SELECTOR,
        new TesterDocumentSymbolProvider(treeManager),
      ),
      vscode.languages.registerFoldingRangeProvider(
        DOCUMENT_SELECTOR,
        new TesterFoldingProvider(treeManager),
      ),
      vscode.languages.registerHoverProvider(
        DOCUMENT_SELECTOR,
        new TesterHoverProvider(treeManager, dbcManager),
      ),
      vscode.languages.registerCompletionItemProvider(
        DOCUMENT_SELECTOR,
        new TesterCompletionProvider(treeManager),
        " ",
      ),
      vscode.languages.registerCodeLensProvider(
        DOCUMENT_SELECTOR,
        new TesterCodeLensProvider(runtimeParser),
      ),
      vscode.commands.registerCommand(
        RUN_TEST_SUITE_COMMAND,
        async (uri: vscode.Uri, suiteStartLine: number) => {
          try {
            const runService = await createRunService(
              runtimeParser,
              outputChannel,
              busMonitorProvider,
            );
            await runService.runTestSuite(uri, suiteStartLine);
          } catch (error) {
            handleRunnerError(error);
          }
        },
      ),
      vscode.commands.registerCommand(
        RUN_TEST_CASE_COMMAND,
        async (
          uri: vscode.Uri,
          suiteStartLine: number,
          caseStartLine: number,
        ) => {
          try {
            const runService = await createRunService(
              runtimeParser,
              outputChannel,
              busMonitorProvider,
            );
            await runService.runTestCase(uri, suiteStartLine, caseStartLine);
          } catch (error) {
            handleRunnerError(error);
          }
        },
      ),
    );

    // Conditionally enable diagnostics
    const config = vscode.workspace.getConfiguration("tester");
    if (config.get<boolean>("diagnostics.enabled", true)) {
      const diagnosticProvider = new TesterDiagnosticProvider(treeManager);
      context.subscriptions.push(diagnosticProvider);
      context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) =>
          diagnosticProvider.updateDiagnostics(e.document),
        ),
        vscode.workspace.onDidOpenTextDocument((doc) =>
          diagnosticProvider.updateDiagnostics(doc),
        ),
      );
    }
  } catch (error) {
    logActivationError(outputChannel, "语言服务初始化失败", error);
  }
}

export function deactivate() {}

function handleRunnerError(error: unknown) {
  if (error instanceof TesterCancellationError) {
    void vscode.window.showInformationMessage(error.message);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(message);
}

function logActivationError(
  outputChannel: vscode.OutputChannel,
  title: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  outputChannel.appendLine(`[${title}] ${message}`);
  void vscode.window.showErrorMessage(`${title}: ${message}`);
}

function logDbcStatus(
  outputChannel: vscode.OutputChannel,
  status: ReturnType<DbcManager["getStatus"]>,
) {
  if (status.state === "loaded") {
    outputChannel.appendLine(`[DBC] ${status.message}`);
    return;
  }

  if (status.state === "error") {
    outputChannel.appendLine(`[DBC] ${status.message}`);
  }
}

async function createRunService(
  runtimeParser: TesterRuntimeParser,
  outputChannel: vscode.OutputChannel,
  busMonitorProvider: TesterBusMonitorProvider,
) {
  const { TesterRunService } = await import("./runtime/runner.js");
  return new TesterRunService(
    runtimeParser,
    outputChannel,
    undefined,
    busMonitorProvider,
  );
}
