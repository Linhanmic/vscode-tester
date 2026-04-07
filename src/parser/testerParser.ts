import { Parser, Language } from "web-tree-sitter";
import * as fs from "fs";
import * as path from "path";

export let parser: Parser;
export let tester: Language;
let loadingPromise: Promise<void> | undefined;

export async function loadLanguage() {
  if (parser && tester) {
    return;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = loadLanguageInternal();
  await loadingPromise;
}

async function loadLanguageInternal() {
  await Parser.init();
  parser = new Parser();
  tester = await Language.load(resolveWasmPath());
  parser.setLanguage(tester);
}

let cachedWasmPath: string | undefined;

function resolveWasmPath(): string {
  if (cachedWasmPath) {
    return cachedWasmPath;
  }

  const candidates = [
    path.join(__dirname, "parsers", "tree-sitter-tester.wasm"),
    path.join(__dirname, "..", "parsers", "tree-sitter-tester.wasm"),
    path.join(__dirname, "..", "..", "parsers", "tree-sitter-tester.wasm"),
    path.join(process.cwd(), "parsers", "tree-sitter-tester.wasm"),
    path.join(process.cwd(), "..", "tree-sitter-tester", "tree-sitter-tester.wasm"),
  ];

  const wasmPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!wasmPath) {
    throw new Error("Failed to locate tree-sitter-tester.wasm");
  }

  cachedWasmPath = wasmPath;
  return wasmPath;
}
