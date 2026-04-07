import * as vscode from "vscode";
import { DOCUMENT_SELECTOR } from "./constants";
import { ExtensionServiceHost } from "./serviceHost";

export function activate(context: vscode.ExtensionContext) {
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
        const services = await host.ensureLanguageServices();
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
}

export function deactivate() {}
