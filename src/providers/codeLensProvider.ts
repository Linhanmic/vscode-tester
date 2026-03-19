import * as vscode from "vscode";
import { RUN_TEST_CASE_COMMAND, RUN_TEST_SUITE_COMMAND } from "../constants";
import { TesterRuntimeParser } from "../runtime/parser";

export class TesterCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly parser: TesterRuntimeParser) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const parsedDocument = this.parser.parseDocument(document);
    const lenses: vscode.CodeLens[] = [];

    for (const suite of parsedDocument.suites) {
      lenses.push(
        new vscode.CodeLens(new vscode.Range(suite.range.start, suite.range.start), {
          title: "运行测试集",
          command: RUN_TEST_SUITE_COMMAND,
          arguments: [document.uri, suite.startLine],
        }),
      );

      for (const testCase of suite.cases) {
        lenses.push(
          new vscode.CodeLens(
            new vscode.Range(testCase.range.start, testCase.range.start),
            {
              title: "运行测试用例",
              command: RUN_TEST_CASE_COMMAND,
              arguments: [document.uri, suite.startLine, testCase.startLine],
            },
          ),
        );
      }
    }

    return lenses;
  }
}
