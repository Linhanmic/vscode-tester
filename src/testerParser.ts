import { Parser, Language } from "web-tree-sitter";
import * as path from "path";

export let parser: Parser;
export let tester: Language;

export async function loadLanguage() {
  await Parser.init();
  parser = new Parser();
  tester = await Language.load(
    path.join(__dirname, "parsers/tree-sitter-tester.wasm"),
  );
  parser.setLanguage(tester);
}
