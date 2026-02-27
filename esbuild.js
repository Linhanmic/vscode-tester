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
  // 1. 复制 parser 目录
  if (fs.existsSync("./parser")) {
    await fs.copy("./parser", "./dist/parser");
    console.log("Copied parser directory to dist");
  }

  // 2.  web-tree-sitter 通常需要 tree-sitter.wasm 和 对应的 js 文件
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

  // 3. 复制其他资源 (grammar.js 等)
  // const assets = ["./grammar.js", "./language-configuration.json"];
  // for (const asset of assets) {
  //   if (fs.existsSync(asset)) {
  //     await fs.copy(asset, path.join('./dist', path.basename(asset)));
  //     console.log(`Copied ${asset} to dist`);
  //   }
  // }
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
