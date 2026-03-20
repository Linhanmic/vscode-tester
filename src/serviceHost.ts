import * as vscode from "vscode";
import { DbcManager } from "./dbc/dbcManager";
import { DeviceManagerService } from "./deviceManager/deviceManagerService";
import { LANGUAGE_ID } from "./constants";
import { MessageDecoderService } from "./messageDecoder/messageDecoderService";
import { TreeManager } from "./parser/treeManager";
import { loadLanguage } from "./parser/testerParser";
import { ProjectConfigService } from "./projectConfig/projectConfigService";
import { TesterCodeLensProvider } from "./providers/codeLensProvider";
import { TesterCompletionProvider } from "./providers/completionProvider";
import { TesterDiagnosticProvider } from "./providers/diagnosticProvider";
import { TesterDocumentSymbolProvider } from "./providers/documentSymbolProvider";
import { TesterFoldingProvider } from "./providers/foldingProvider";
import { TesterHoverProvider } from "./providers/hoverProvider";
import { TesterRuntimeParser } from "./runtime/parser";
import { BusMonitorService } from "./studio/busMonitorService";
import { DbcWorkspaceService } from "./studio/dbcWorkspaceService";
import { ScriptModelService } from "./studio/scriptModelService";
import {
  TesterStudioPanel,
  type TesterStudioPanelServices,
} from "./studio/studioPanel";
import { WorkspaceScriptIndexService } from "./studio/workspaceScriptIndexService";

export interface LanguageServices {
  treeManager: TreeManager;
  runtimeParser: TesterRuntimeParser;
  documentSymbolProvider: TesterDocumentSymbolProvider;
  foldingProvider: TesterFoldingProvider;
  completionProvider: TesterCompletionProvider;
  hoverProvider: TesterHoverProvider;
  codeLensProvider: TesterCodeLensProvider;
}

export interface RuntimeServices {
  runtimeParser: TesterRuntimeParser;
  busMonitorService: BusMonitorService;
}

export class ExtensionServiceHost implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private languageServices: LanguageServices | undefined;
  private languagePromise: Promise<LanguageServices> | undefined;
  private studioServices: TesterStudioPanelServices | undefined;
  private studioPromise: Promise<TesterStudioPanelServices> | undefined;
  private diagnosticsProvider: TesterDiagnosticProvider | undefined;

  readonly outputChannel = vscode.window.createOutputChannel("Tester Runner");
  readonly dbcManager: DbcManager;
  readonly busMonitorService = new BusMonitorService();
  readonly studioPanel: TesterStudioPanel;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.dbcManager = new DbcManager(context);
    this.studioPanel = new TesterStudioPanel(context);
    this.disposables.push(
      this.outputChannel,
      this.busMonitorService,
      this.studioPanel,
      this.dbcManager.onDidChangeStatus((status) => {
        if (status.state === "loaded" || status.state === "error") {
          this.outputChannel.appendLine(`[DBC] ${status.message}`);
        }
      }),
    );
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  prewarmLanguageServices() {
    void this.ensureLanguageServices().catch((error) => {
      this.handleError("语言服务初始化失败", error, false);
    });
  }

  async ensureDbcReady() {
    await this.dbcManager.initialize();
    return this.dbcManager;
  }

  async ensureLanguageServices(): Promise<LanguageServices> {
    if (this.languageServices) {
      return this.languageServices;
    }

    if (this.languagePromise) {
      return this.languagePromise;
    }

    this.languagePromise = this.initializeLanguageServices().catch((error) => {
      this.languagePromise = undefined;
      throw error;
    });
    return this.languagePromise;
  }

  async ensureRuntimeServices(): Promise<RuntimeServices> {
    const languageServices = await this.ensureLanguageServices();
    return {
      runtimeParser: languageServices.runtimeParser,
      busMonitorService: this.busMonitorService,
    };
  }

  async ensureStudioServices(): Promise<TesterStudioPanelServices> {
    if (this.studioServices) {
      return this.studioServices;
    }

    if (this.studioPromise) {
      return this.studioPromise;
    }

    this.studioPromise = this.initializeStudioServices().catch((error) => {
      this.studioPromise = undefined;
      throw error;
    });
    return this.studioPromise;
  }

  async openStudio() {
    await this.studioPanel.show();
    void this.ensureStudioServices().catch((error) => {
      this.handleError("Studio 初始化失败", error, true);
    });
  }

  private async initializeLanguageServices(): Promise<LanguageServices> {
    await loadLanguage();

    const treeManager = new TreeManager(this.context);
    const runtimeParser = new TesterRuntimeParser(treeManager);
    const languageServices: LanguageServices = {
      treeManager,
      runtimeParser,
      documentSymbolProvider: new TesterDocumentSymbolProvider(treeManager),
      foldingProvider: new TesterFoldingProvider(treeManager),
      completionProvider: new TesterCompletionProvider(treeManager),
      hoverProvider: new TesterHoverProvider(treeManager, this.dbcManager),
      codeLensProvider: new TesterCodeLensProvider(runtimeParser),
    };
    this.languageServices = languageServices;
    this.ensureDiagnosticsRegistered(treeManager);
    return languageServices;
  }

  private async initializeStudioServices(): Promise<TesterStudioPanelServices> {
    const localDisposables: vscode.Disposable[] = [];

    try {
      const languageServices = await this.ensureLanguageServices();
      const dbcWorkspaceService = new DbcWorkspaceService(this.dbcManager);
      const scriptIndexService = new WorkspaceScriptIndexService(this.context);
      localDisposables.push(scriptIndexService);
      localDisposables.push(dbcWorkspaceService);
      await Promise.all([
        dbcWorkspaceService.start(),
        scriptIndexService.start(),
      ]);

      const projectConfigService = new ProjectConfigService(
        this.context,
        this.dbcManager,
        dbcWorkspaceService,
        scriptIndexService,
      );
      projectConfigService.setTreeManager(languageServices.treeManager);

      const deviceManagerService = new DeviceManagerService(
        this.context,
        projectConfigService,
        this.outputChannel,
        this.busMonitorService,
      );
      const messageDecoderService = new MessageDecoderService(this.dbcManager);
      const scriptModelService = new ScriptModelService(
        languageServices.treeManager,
        projectConfigService,
        scriptIndexService,
      );

      localDisposables.push(
        projectConfigService,
        deviceManagerService,
        messageDecoderService,
        scriptModelService,
      );

      const studioServices: TesterStudioPanelServices = {
        scriptIndexService,
        dbcWorkspaceService,
        projectConfigService,
        scriptModelService,
        deviceManagerService,
        busMonitorService: this.busMonitorService,
        messageDecoderService,
      };

      this.studioServices = studioServices;
      this.disposables.push(...localDisposables);
      this.studioPanel.attachServices(studioServices);
      return studioServices;
    } catch (error) {
      for (const disposable of localDisposables) {
        disposable.dispose();
      }
      throw error;
    }
  }

  private ensureDiagnosticsRegistered(treeManager: TreeManager) {
    if (this.diagnosticsProvider) {
      return;
    }

    const config = vscode.workspace.getConfiguration("tester");
    if (!config.get<boolean>("diagnostics.enabled", true)) {
      return;
    }

    this.diagnosticsProvider = new TesterDiagnosticProvider(treeManager);
    this.disposables.push(
      this.diagnosticsProvider,
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.diagnosticsProvider?.updateDiagnostics(event.document);
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        this.diagnosticsProvider?.updateDiagnostics(document);
      }),
    );

    for (const document of vscode.workspace.textDocuments) {
      if (document.languageId === LANGUAGE_ID) {
        this.diagnosticsProvider.updateDiagnostics(document);
      }
    }
  }

  private handleError(title: string, error: unknown, showMessage: boolean) {
    const message = error instanceof Error ? error.message : String(error);
    this.outputChannel.appendLine(`[${title}] ${message}`);
    this.studioPanel.reportError(`${title}: ${message}`);
    if (showMessage) {
      void vscode.window.showErrorMessage(`${title}: ${message}`);
    }
  }
}
