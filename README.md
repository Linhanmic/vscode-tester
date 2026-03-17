# Tester Language Support for VS Code

为 **Tester DSL**（CAN 总线 / 汽车 ECU 测试领域专用语言）提供 VS Code 语言支持。

## 功能特性

- **语法高亮** — 关键字、报文 ID、数据字节、注释等彩色显示
- **智能补全** — 输入 `tcans` / `tcanr` 时，自动补全当前文件中已有的同类命令
- **悬停解码** — 鼠标悬停在 CAN 命令上，自动解析报文 ID 和信号（需加载 DBC 文件）
- **语法诊断** — 实时检测语法错误并在编辑器中标注
- **大纲视图** — 在侧栏显示配置块、测试集、测试用例的层级结构
- **代码折叠** — 折叠配置块、测试集、测试用例等代码段
- **代码片段** — 内置常用命令模板，快速插入完整代码结构

## 安装

### 从 VSIX 安装

1. 下载 `.vsix` 文件
2. 在 VS Code 中按 `Ctrl+Shift+P`，输入 `Install from VSIX`
3. 选择下载的文件

### 从源码构建

```bash
git clone https://github.com/Linhanmic/vscode-tester.git
cd vscode-tester
npm install
npm run package
```

## 快速开始

创建一个 `.tester` 或 `.txt` 文件，输入 `ttemplate` 并按 Tab 即可生成完整的测试文件模板。

一个最小的 Tester 文件如下：

```
// 设备配置
tset
    tcaninit 4,0,0,500000,2000000
    tdiagnose_rid 7A1
    tdiagnose_sid 7A9
    tdiagnose_keyk 10086
tend

// 测试用例集
ttitle=基本通信测试
    tstart=发送报文验证
        tcans 18FF0012,11-22-33-44-55-66-77-88,100,1
        tcanr 18FF0013,0.0-3.7,11223344,3000
        tdelay 500
    tend
ttitle-end
```

## 配置项

在 VS Code 设置中搜索 `tester` 可以找到以下配置：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `tester.dbcFilePath` | string | `""` | DBC 文件路径。为空时自动搜索工作区中的第一个 `.dbc` 文件 |
| `tester.diagnostics.enabled` | boolean | `true` | 启用/禁用语法诊断 |

## 代码片段

| 前缀 | 说明 |
|------|------|
| `ttemplate` | 完整测试文件模板 |
| `tset` | 配置块（含 tcaninit、诊断、DTC） |
| `ttitle` | 测试用例集 |
| `tstart` | 测试用例 |
| `tcans` | CAN 发送命令 |
| `tcanr` | CAN 接收校验命令 |
| `tcanr-print` | CAN 接收打印命令 |
| `tdelay` | 延时命令 |
| `tcaninit` | 通道初始化 |
| `tdiag` | 诊断配置（rid + sid + keyk） |
| `tdtc` | 故障码配置 |

## DBC 悬停解码

当工作区中存在 `.dbc` 文件时，鼠标悬停在 `tcans` 或 `tcanr` 命令上会显示：

- 报文名称与描述
- 报文 ID、DLC、发送节点
- 各信号的物理值与原始值

如需指定 DBC 文件路径，可在设置中配置 `tester.dbcFilePath`。

## 语法规范

完整的 Tester DSL 语法规范请参阅 [docs/tester-syntax.md](docs/tester-syntax.md)。

## 许可证

[MIT](LICENSE)
