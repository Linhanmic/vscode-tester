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

async function copyZlgRuntimePackage(workspaceRoot) {
  const zlgPackageRoot = path.join(workspaceRoot, "zlg-node");
  const zlgDistRoot = path.join(
    __dirname,
    "dist",
    "node_modules",
    "@vscode-tester",
    "zlg-can",
  );

  if (!fs.existsSync(zlgPackageRoot)) {
    console.error("Error: zlg-node workspace package not found.");
    return;
  }

  const releaseDir = path.join(zlgPackageRoot, "build", "Release");
  const nativeModulePath = path.join(releaseDir, "zlg_node.node");
  if (!fs.existsSync(nativeModulePath)) {
    console.error("Error: zlg-node native runtime not found. Build ../zlg-node first.");
    return;
  }

  const packageJsonPath = path.join(zlgPackageRoot, "package.json");
  const sourcePackageJson = await fs.readJson(packageJsonPath);

  await fs.remove(zlgDistRoot);
  await fs.ensureDir(path.join(zlgDistRoot, "build", "Release"));

  await fs.copy(path.join(zlgPackageRoot, "index.js"), path.join(zlgDistRoot, "index.js"));
  await fs.copy(path.join(zlgPackageRoot, "index.d.ts"), path.join(zlgDistRoot, "index.d.ts"));
  await fs.copy(path.join(zlgPackageRoot, "lib"), path.join(zlgDistRoot, "lib"));
  await fs.copy(nativeModulePath, path.join(zlgDistRoot, "build", "Release", "zlg_node.node"));

  const zlgNativeDllPath = path.join(releaseDir, "zlgcan.dll");
  if (fs.existsSync(zlgNativeDllPath)) {
    await fs.copy(zlgNativeDllPath, path.join(zlgDistRoot, "build", "Release", "zlgcan.dll"));
  }

  const kernelDllsPath = path.join(releaseDir, "kerneldlls");
  if (fs.existsSync(kernelDllsPath)) {
    await fs.copy(kernelDllsPath, path.join(zlgDistRoot, "build", "Release", "kerneldlls"));
  }

  await fs.writeJson(
    path.join(zlgDistRoot, "package.json"),
    {
      name: sourcePackageJson.name,
      version: sourcePackageJson.version,
      description: sourcePackageJson.description,
      main: "index.js",
      types: "index.d.ts",
      type: "commonjs",
      license: sourcePackageJson.license,
    },
    { spaces: 2 },
  );

  console.log("Copied @vscode-tester/zlg-can runtime package");
}

async function copyAssets() {
  const workspaceRoot = path.resolve(__dirname, "..");
  const grammarWasmPath = path.join(
    workspaceRoot,
    "tree-sitter-tester",
    "tree-sitter-tester.wasm",
  );
  const sourceParsersDir = path.join(__dirname, "parsers");
  const distParsersDir = path.join(__dirname, "dist", "parsers");

  if (fs.existsSync(grammarWasmPath)) {
    await fs.ensureDir(sourceParsersDir);
    await fs.ensureDir(distParsersDir);
    await fs.copy(grammarWasmPath, path.join(sourceParsersDir, "tree-sitter-tester.wasm"));
    await fs.copy(grammarWasmPath, path.join(distParsersDir, "tree-sitter-tester.wasm"));
    console.log("Copied latest tree-sitter-tester.wasm");
  } else {
    console.error("Error: tree-sitter-tester.wasm not found in sibling workspace.");
  }

  const webTreeSitterPath = path.join(
    __dirname,
    "node_modules",
    "web-tree-sitter",
  );
  if (fs.existsSync(webTreeSitterPath)) {
    await fs.copy(webTreeSitterPath, "./dist/node_modules/web-tree-sitter");
    console.log("Copied web-tree-sitter to dist/node_modules/web-tree-sitter");
  } else {
    console.error(
      'Error: web-tree-sitter not found in node_modules. Run "npm install" first.',
    );
  }
  await copyZlgRuntimePackage(workspaceRoot);
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
    external: ["vscode", "web-tree-sitter", "@vscode-tester/zlg-can"],
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
