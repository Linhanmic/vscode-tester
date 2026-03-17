# vscode-tester

VSCode language extension for the **Tester DSL** — a domain-specific language for CAN bus / automotive ECU testing.

## Tech Stack

- **TypeScript** — source language
- **web-tree-sitter** (WASM) — incremental parsing via `parsers/tree-sitter-tester.wasm`
- **candied** — DBC file parsing and CAN message decoding
- **esbuild** — bundling to `dist/extension.js`

## Architecture

- **TreeManager** (`src/parser/treeManager.ts`) — caches and incrementally updates syntax trees per document
- **Providers** (`src/providers/`) — consume tree-sitter AST via TreeManager constructor injection
  - `completionProvider.ts` — tcans/tcanr command completion
  - `diagnosticProvider.ts` — syntax error diagnostics
  - `documentSymbolProvider.ts` — outline view (configuration, test suites, test cases)
  - `foldingProvider.ts` — code folding for blocks
  - `hoverProvider.ts` — CAN message decoding on hover (uses DbcManager)
- **DbcManager** (`src/dbc/dbcManager.ts`) — loads `.dbc` files, decodes CAN frames

## Build Commands

```bash
npm run compile        # Type-check + lint + esbuild
npm run watch          # Watch mode (tsc + esbuild)
npm run package        # Production build (minified)
npm run check-types    # Type-check only
npm run lint           # ESLint
npm run test           # VSCode extension tests
```

## Key Conventions

- Language ID: `"tester"`
- All providers receive `TreeManager` via constructor injection
- Document selector: `{ scheme: "file", language: "tester" }`
- Shared types in `src/types.ts`, constants in `src/constants.ts`

## DSL Keywords

`tset/tend`, `ttitle/ttitle-end`, `tstart/tend`, `tcans`, `tcanr`, `tdelay`, `tcaninit`, `tcans_ch_def`, `tdiagnose_sid/rid/keyk/dtc`, `tnote`, `tconfirm`, `tenum`, `tbitfield`

## Tree-sitter Node Types (grammar.js)

| Node Type | Key Fields |
|-----------|-----------|
| `tcans_command` | send_channel?, message_id, message_data, period, count |
| `tcanr_bit_compare_command` | receive_channel?, message_id, expected_bit_range, expected_data, wait_time |
| `tcanr_direct_compare_command` | receive_channel?, message_id, expected_data, wait_time |
| `tcanr_print_command` | receive_channel?, message_id, expected_bit_range |
| `configuration_block` | — (tset...tend) |
| `test_suite` | title |
| `test_case` | id?, title |
| `tdelay_command` | delay_time |
| `comment` | message (both `//` and `tnote =`) |

**Note**: `tcanr_compare_command` is a choice node (not a leaf) — it produces `tcanr_bit_compare_command` or `tcanr_direct_compare_command`.
