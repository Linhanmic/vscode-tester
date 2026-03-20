import * as vscode from "vscode";
import {
  CLEAR_BUS_MONITOR_COMMAND,
  DOCUMENT_SELECTOR,
  LANGUAGE_ID,
  OPEN_STUDIO_COMMAND,
  RUN_TEST_COMMAND_COMMAND,
  RUN_TEST_CASE_COMMAND,
  RUN_TEST_SUITE_COMMAND,
} from "./constants";
import { ExtensionServiceHost } from "./serviceHost";
import { TesterCancellationError } from "./runtime/utils";

export async function activate(context: vscode.ExtensionContext) {
  const host = new ExtensionServiceHost(context);

  context.subscriptions.push(
    host,
    vscode.languages.registerDocumentSymbolProvider(DOCUMENT_SELECTOR, {
      async provideDocumentSymbols(document) {
        const services = await host.ensureLanguageServices();
        return services.documentSymbolProvider.provideDocumentSymbols(document);
      },
    }),
    vscode.languages.registerFoldingRangeProvider(DOCUMENT_SELECTOR, {
      async provideFoldingRanges(document) {
        const services = await host.ensureLanguageServices();
        return services.foldingProvider.provideFoldingRanges(document);
      },
    }),
    vscode.languages.registerHoverProvider(DOCUMENT_SELECTOR, {
      async provideHover(document, position) {
        const [services] = await Promise.all([
          host.ensureLanguageServices(),
          host.ensureDbcReady(),
        ]);
        return services.hoverProvider.provideHover(document, position);
      },
    }),
    vscode.languages.registerCompletionItemProvider(
      DOCUMENT_SELECTOR,
      {
        async provideCompletionItems(document, position, token, context) {
          const services = await host.ensureLanguageServices();
          return services.completionProvider.provideCompletionItems(
            document,
            position,
            token,
            context,
          );
        },
        async resolveCompletionItem(item, token) {
          const services = await host.ensureLanguageServices();
          return services.completionProvider.resolveCompletionItem(item, token);
        },
      },
      " ",
    ),
  );

  const lazyCodeLensProvider: vscode.CodeLensProvider = {
    async provideCodeLenses(document) {
      const services = await host.ensureLanguageServices();
      return services.codeLensProvider.provideCodeLenses(document);
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      DOCUMENT_SELECTOR,
      lazyCodeLensProvider,
    ),
    vscode.commands.registerCommand(OPEN_STUDIO_COMMAND, async () => {
      await host.openStudio();
    }),
    vscode.commands.registerCommand(CLEAR_BUS_MONITOR_COMMAND, () => {
      host.busMonitorService.clear();
    }),
    registerRunCommand(host, RUN_TEST_SUITE_COMMAND, (service, args) => {
      const [uri, suiteStartLine] = args as [vscode.Uri, number];
      return service.runTestSuite(uri, suiteStartLine);
    }),
    registerRunCommand(host, RUN_TEST_CASE_COMMAND, (service, args) => {
      const [uri, suiteStartLine, caseStartLine] = args as [vscode.Uri, number, number];
      return service.runTestCase(uri, suiteStartLine, caseStartLine);
    }),
    registerRunCommand(host, RUN_TEST_COMMAND_COMMAND, (service, args) => {
      const [uri, suiteStartLine, caseStartLine, commandStartLine] = args as [vscode.Uri, number, number, number];
      return service.runTestCommand(uri, suiteStartLine, caseStartLine, commandStartLine);
    }),
  );

  if (
    vscode.workspace.textDocuments.some((document) => document.languageId === LANGUAGE_ID)
  ) {
    host.prewarmLanguageServices();
  }
}

export function deactivate() {}

function registerRunCommand(
  host: ExtensionServiceHost,
  commandId: string,
  execute: (
    service: import("./runtime/runner").TesterRunService,
    args: unknown[],
  ) => Promise<void>,
) {
  return vscode.commands.registerCommand(commandId, async (...args: unknown[]) => {
    try {
      const runtimeServices = await host.ensureRuntimeServices();
      const runService = await createRunService(
        runtimeServices.runtimeParser,
        host.outputChannel,
        runtimeServices.busMonitorService,
      );
      await execute(runService, args);
    } catch (error) {
      handleRunnerError(error);
    }
  });
}

function handleRunnerError(error: unknown) {
  if (error instanceof TesterCancellationError) {
    void vscode.window.showInformationMessage(error.message);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(message);
}

async function createRunService(
  runtimeParser: import("./runtime/parser").TesterRuntimeParser,
  outputChannel: vscode.OutputChannel,
  busMonitorService: import("./studio/busMonitorService").BusMonitorService,
) {
  const { TesterRunService } = await import("./runtime/runner.js");
  return new TesterRunService(
    runtimeParser,
    outputChannel,
    undefined,
    busMonitorService,
  );
}
