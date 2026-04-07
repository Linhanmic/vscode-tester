const esbuild = require("esbuild");
const fs = require("fs-extra");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`,
        );
      });
      console.log("[watch] build finished");
    });
  },
};

async function copyAssets() {
  const workspaceRoot = path.resolve(__dirname, "..");
  const grammarWasmPath = path.join(
    workspaceRoot,
    "tree-sitter-tester",
    "tree-sitter-tester.wasm",
  );
  const sourceParsersDir = path.join(__dirname, "parsers");
  const distParsersDir = path.join(__dirname, "dist", "parsers");
  const distNodeModulesDir = path.join(__dirname, "dist", "node_modules");
  const distWebviewDir = path.join(__dirname, "dist", "webview");

  if (fs.existsSync(grammarWasmPath)) {
    await fs.ensureDir(sourceParsersDir);
    await fs.ensureDir(distParsersDir);
    await fs.copy(grammarWasmPath, path.join(sourceParsersDir, "tree-sitter-tester.wasm"));
    await fs.copy(grammarWasmPath, path.join(distParsersDir, "tree-sitter-tester.wasm"));
    console.log("Copied latest tree-sitter-tester.wasm");
  } else {
    console.error("Error: tree-sitter-tester.wasm not found in sibling workspace.");
  }

  await fs.remove(path.join(distNodeModulesDir, "@vscode-tester"));
  await fs.remove(path.join(distNodeModulesDir, "web-tree-sitter"));
  await fs.remove(distWebviewDir);

  const webTreeSitterPath = path.join(
    __dirname,
    "node_modules",
    "web-tree-sitter",
  );
  if (fs.existsSync(webTreeSitterPath)) {
    await fs.ensureDir(distNodeModulesDir);
    const webTreeSitterDistDir = path.join(distNodeModulesDir, "web-tree-sitter");
    await fs.ensureDir(webTreeSitterDistDir);
    await Promise.all([
      fs.copy(
        path.join(webTreeSitterPath, "package.json"),
        path.join(webTreeSitterDistDir, "package.json"),
      ),
      fs.copy(
        path.join(webTreeSitterPath, "LICENSE"),
        path.join(webTreeSitterDistDir, "LICENSE"),
      ),
      fs.copy(
        path.join(webTreeSitterPath, "web-tree-sitter.cjs"),
        path.join(webTreeSitterDistDir, "web-tree-sitter.cjs"),
      ),
      fs.copy(
        path.join(webTreeSitterPath, "web-tree-sitter.wasm"),
        path.join(webTreeSitterDistDir, "web-tree-sitter.wasm"),
      ),
    ]);
    console.log("Copied minimal web-tree-sitter runtime");
  } else {
    console.error(
      'Error: web-tree-sitter not found in node_modules. Run "npm install" first.',
    );
  }
}

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode", "web-tree-sitter"],
    logLevel: "silent",
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });
  if (watch) {
    await ctx.watch();
    // 在监听模式下也复制资产文件
    await copyAssets();
  } else {
    await ctx.rebuild();
    // 构建完成后复制资产文件
    await copyAssets();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
