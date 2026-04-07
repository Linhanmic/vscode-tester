# Tester Language Support for VS Code

为 Tester DSL 提供 VS Code 语言支持，面向 CAN 总线 / ECU 测试脚本编写场景。

## 功能

- 语法高亮：关键字、报文 ID、字节数据、注释等高亮显示
- 智能补全：输入 `tcans` / `tcanr` 时，补全当前文件中的同类命令
- 悬停信息：结合 DBC 文件显示报文和信号解码信息
- 大纲视图：显示配置块、测试集、测试用例层级
- 代码折叠：折叠配置块、测试集、测试用例
- 代码片段：内置常用 Tester 模板

## 安装

### 从 VSIX 安装

1. 下载 `.vsix` 文件。
2. 在 VS Code 中执行 `Extensions: Install from VSIX...`。
3. 选择对应文件完成安装。

### 从源码构建

```bash
git clone https://github.com/Linhanmic/vscode-tester.git
cd vscode-tester
npm install
npm run package
```

## 快速开始

推荐新建 `.tester` 文件；扩展当前也兼容 `.txt`。

输入 `ttemplate` 并按 `Tab` 可插入模板。一个当前稳定可解析的最小示例如下：

```tester
ttitle=基本通信测试
  tstart=发送报文验证
    tcans 18FF0012,11-22-33-44-55-66-77-88,100,1
    tcanr 18FF0013,0.0-3.7,11223344,3000
    tdelay 500
  tend
ttitle-end
```

## 配置项

在 VS Code 设置中搜索 `tester` 可找到以下配置：

| 配置项 | 类型 | 默认值 | 说明 |
|------|------|------|------|
| `tester.dbcFilePath` | string | `""` | DBC 文件路径。为空时自动搜索工作区中的第一个 `.dbc` 文件 |

## 代码片段

| 前缀 | 说明 |
|------|------|
| `ttemplate` | 完整测试文件模板 |
| `tset` | 配置块模板 |
| `ttitle` | 测试集模板 |
| `tstart` | 测试用例模板 |
| `tcans` | CAN 发送命令 |
| `tcanr` | CAN 接收校验命令 |
| `tcanr-print` | CAN 接收打印命令 |
| `tdelay` | 延时命令 |
| `tcaninit` | 通道初始化 |

## DBC 悬停

当工作区存在 `.dbc` 文件时，悬停在 `tcans` 或 `tcanr` 上可查看：

- 报文名称与描述
- 报文 ID、DLC、发送节点
- 信号物理值与原始值

如需显式指定 DBC 文件，可配置 `tester.dbcFilePath`。

## 说明

- 当前语法规范以 `tree-sitter` 实现为准。
- 当前仓库只保留基础语言支持能力，未启用运行器、Studio 和监控类功能。

## 许可证

项目当前在 [`package.json`](package.json) 中声明为 `MIT` 许可证。
