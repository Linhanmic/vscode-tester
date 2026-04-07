import * as vscode from "vscode";
import { TreeManager } from "./parser/treeManager";
import { loadLanguage } from "./parser/testerParser";
import { TesterCompletionProvider } from "./providers/completionProvider";
import { TesterDocumentSymbolProvider } from "./providers/documentSymbolProvider";
import { TesterFoldingProvider } from "./providers/foldingProvider";
import { TesterHoverProvider } from "./providers/hoverProvider";
import type { DbcManager } from "./dbc/dbcManager";

export interface LanguageServices {
  treeManager: TreeManager;
  documentSymbolProvider: TesterDocumentSymbolProvider;
  foldingProvider: TesterFoldingProvider;
  completionProvider: TesterCompletionProvider;
  hoverProvider: TesterHoverProvider;
}

export class ExtensionServiceHost implements vscode.Disposable {
  private languageServices: LanguageServices | undefined;
  private languagePromise: Promise<LanguageServices> | undefined;
  private dbcManager: DbcManager | undefined;
  private dbcManagerPromise: Promise<DbcManager> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  dispose() {}

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

  private async initializeLanguageServices(): Promise<LanguageServices> {
    await loadLanguage();

    const treeManager = new TreeManager(this.context);
    const languageServices: LanguageServices = {
      treeManager,
      documentSymbolProvider: new TesterDocumentSymbolProvider(treeManager),
      foldingProvider: new TesterFoldingProvider(treeManager),
      completionProvider: new TesterCompletionProvider(treeManager),
      hoverProvider: new TesterHoverProvider(
        treeManager,
        () => this.ensureDbcManager(),
      ),
    };
    this.languageServices = languageServices;
    return languageServices;
  }

  private async ensureDbcManager(): Promise<DbcManager> {
    if (this.dbcManager) {
      return this.dbcManager;
    }

    if (this.dbcManagerPromise) {
      return this.dbcManagerPromise;
    }

    this.dbcManagerPromise = this.initializeDbcManager().catch((error) => {
      this.dbcManagerPromise = undefined;
      throw error;
    });
    return this.dbcManagerPromise;
  }

  private async initializeDbcManager(): Promise<DbcManager> {
    const { DbcManager } = await import("./dbc/dbcManager.js");
    const dbcManager = new DbcManager(this.context);
    await dbcManager.initialize();
    this.dbcManager = dbcManager;
    return dbcManager;
  }
}
