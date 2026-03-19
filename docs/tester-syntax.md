# Tester DSL 语法规范

## 文档定位

本文档以 `tree-sitter-tester` 项目的 `grammar.js` 为正式语法基线，用于约束当前 VS Code 扩展实际承诺支持的 Tester DSL 写法。

- 本文档描述“当前可解析、可高亮、可诊断”的正式语法。
- 外部设计草稿中的扩展想法可作为后续演进参考，但不构成当前实现承诺。
- 若文档示例与其他历史材料冲突，以本文档和 `grammar.js` 为准。

## 1. 结构总览

一个 Tester 文件由可选配置块和零个或多个测试集组成：

```ebnf
source_file ::= [configuration_block] test_suite*
```

对应结构如下：

```text
[配置块]
tset
  ...
tend

[测试集]
ttitle=...
  tstart=...
    ...
  tend
ttitle-end
```

正式支持的结构与命令如下：

- 文件结构：`tset ... tend`、`ttitle ... ttitle-end`、`tstart ... tend`
- 配置命令：`tcaninit`、`tdiagnose_sid`、`tdiagnose_rid`、`tdiagnose_keyk`、`tdiagnose_dtc`
- 测试命令：`tcans`、`tcanr`、`tdelay`
- 注释：`// ...`、`tnote=...`

## 2. 词法约定

### 2.1 注释

支持两种注释形式：

```tester
// 单行注释
tnote=这也是注释
```

说明：

- `tnote` 在当前语法中按注释处理，不是可执行命令。
- `tnote = 说明` 与 `tnote=说明` 都可被解析，建议统一使用 `tnote=说明`。

### 2.2 数值与字符串

- `integer`：十进制整数，当前 parser 词法允许负数，但正式规范只在需要计数、延时、波特率等场景中允许非负整数。
- `hex_number`：带 `0x` 前缀的十六进制数，如 `0x7E8`。
- `hex_number_without_0x`：不带 `0x` 前缀的十六进制数，如 `7E8`、`18FF0012`。
- `string`：一行内除换行外的任意文本，用于标题、描述、注释内容。

### 2.3 数据与位域

- `byte_data`：两位十六进制字节，如 `00`、`FF`、`7A`
- `data_sequence`：字节序列，字节之间可用 `-` 或空白分隔
- `bit`：`字节索引.位索引`，如 `0.0`、`3.7`
- `bit_range`：`起始bit-结束bit`，如 `0.0-3.7`
- 多个位域可使用 `+` 连接，如 `1.0-1.7+3.0-3.7`

位域说明：

- 字节索引从 `0` 开始。
- 位索引范围为 `0` 到 `7`。
- 文档与示例统一使用 `byte.bit-byte.bit` 表达范围。

## 3. 正式语法

### 3.1 配置块

```ebnf
configuration_block ::= "tset" configuration_item* "tend"
configuration_item  ::= tcaninit_command
                      | tdiagnose_sid_command
                      | tdiagnose_rid_command
                      | tdiagnose_keyk_command
                      | tdiagnose_dtc_command
```

配置块约束：

- 配置块最多出现一次。
- 配置块位于文件前部。
- 正式规范中，配置块只用于放置配置命令。

#### tcaninit

```text
tcaninit <device_id>,<device_index>,<channel_index>,<arbitration_baudrate>[,<data_baudrate>]
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `device_id` | 非负整数 | 设备类型或设备 ID |
| `device_index` | 非负整数 | 设备索引 |
| `channel_index` | 非负整数 | 设备通道索引 |
| `arbitration_baudrate` | 正整数 | 仲裁域波特率，单位 `kbps` |
| `data_baudrate` | 正整数 | 数据域波特率，单位 `kbps`，可选 |

说明：

- DSL 中的波特率统一使用 `kbps`。
- 运行时会自动换算为底层设备需要的 `bps`。
- 如果写成 `500000` 这类明显的 `bps` 数值，运行前会直接报错。

示例：

```tester
tset
  tcaninit 41,0,0,500,2000
  tcaninit 41,0,1,500
tend
```

#### tdiagnose_sid

```text
tdiagnose_sid <request_id>
```

说明：`tdiagnose_sid` 在当前语法中表示诊断请求 ID。

示例：

```tester
tset
  tdiagnose_sid 7A9
  tdiagnose_sid 0x7A9
tend
```

#### tdiagnose_rid

```text
tdiagnose_rid <response_id>
```

说明：`tdiagnose_rid` 在当前语法中表示诊断响应 ID。

示例：

```tester
tset
  tdiagnose_rid 7A1
  tdiagnose_rid 0x7A1
tend
```

#### tdiagnose_keyk

```text
tdiagnose_keyk <key_value>
```

示例：

```tester
tset
  tdiagnose_keyk 10086
  tdiagnose_keyk 0x12345678
tend
```

#### tdiagnose_dtc

```text
tdiagnose_dtc <dtc>,<description>
```

说明：

- 当前 parser 将 `dtc` 解析为十六进制字符集合形式。
- 稳定可用示例包括 `C10087`、`ABC123`、`0x1A2B`。
- `P0171`、`U11487` 这类带非十六进制字母前缀的代码不属于当前正式支持范围。

示例：

```tester
tset
  tdiagnose_dtc C10087,发动机过热
  tdiagnose_dtc 0x1A2B,示例故障码
tend
```

### 3.2 测试集与测试用例

```ebnf
test_suite ::= "ttitle" "=" string test_case+ "ttitle-end"
test_case  ::= [integer] "tstart" "=" string test_command* "tend"
```

说明：

- `ttitle=...` 定义测试集标题。
- `tstart=...` 定义测试用例标题。
- 测试用例前可带可选数字序号。

示例：

```tester
ttitle=网络管理测试
  1 tstart=节点唤醒验证
    tdelay 100
  tend
  2 tstart=节点休眠验证
    tdelay 5000
  tend
ttitle-end
```

### 3.3 测试命令

```ebnf
test_command ::= tcans_command | tcanr_command | tdelay_command
```

#### tcans

```text
tcans <message_id>,<message_data>,<period>,<count>
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `message_id` | 十六进制数 | 报文 ID，可带或不带 `0x` 前缀 |
| `message_data` | 数据序列 | 字节序列，支持 `-` 或空白分隔 |
| `period` | 非负整数 | 发送周期/间隔 |
| `count` | 非负整数 | 发送次数 |

示例：

```tester
ttitle=tcans示例
  tstart=发送报文
    tcans 18FF0012,11-22-33-44-55-66-77-88,100,1
    tcans 0x123,11 22 33 44,50,10
  tend
ttitle-end
```

#### tcanr 位域校验

```text
tcanr <message_id>,<bit_range>[+<bit_range>...],<expected_value>[+<expected_value>...],<wait_time>
```

说明：

- 用于按位域范围校验接收数据。
- `expected_value` 当前可写为十六进制数或十进制整数。
- 多段位域与多段期望值一一对应。

示例：

```tester
ttitle=tcanr位域校验示例
  tstart=按位校验
    tcanr 18FF0013,0.0-3.7,11223344,3000
    tcanr 0x456,1.2-1.5+3.0-3.7,0x0C+0xFF,500
  tend
ttitle-end
```

#### tcanr 整帧对比

```text
tcanr <message_id>,<expected_data>,<wait_time>
```

说明：`expected_data` 使用与 `tcans` 相同的字节序列语法。

示例：

```tester
ttitle=tcanr整帧对比示例
  tstart=整帧校验
    tcanr 18FF0013,11-22-33-44-55-66-77-88,3000
    tcanr 0x7E8,02 50 03 00 00 00 00 00,1000
  tend
ttitle-end
```

#### tcanr print 模式

```text
tcanr <message_id>,<bit_range>[+<bit_range>...],print
```

说明：当前 print 模式不带超时参数。

示例：

```tester
ttitle=tcanr打印示例
  tstart=打印位域
    tcanr 18FF0013,0.0-3.7,print
    tcanr 0x789,2.0-3.7,print
  tend
ttitle-end
```

#### tdelay

```text
tdelay <delay_time>
```

示例：

```tester
ttitle=tdelay示例
  tstart=等待
    tdelay 500
  tend
ttitle-end
```

## 4. 最小可运行示例

以下示例符合当前 parser 的正式支持范围：

```tester
// 设备配置
tset
  tcaninit 4,0,0,500,2000
  tdiagnose_rid 7A1
  tdiagnose_sid 7A9
  tdiagnose_keyk 10086
  tdiagnose_dtc C10087,发动机过热
tend

ttitle=基本通信测试
  1 tstart=发送报文验证
    tnote=发送请求报文
    tcans 18FF0012,11-22-33-44-55-66-77-88,100,1
    tcanr 18FF0013,0.0-3.7,11223344,3000
    tcanr 18FF0013,0.0-3.7,print
    tdelay 500
  tend
  2 tstart=整帧校验
    tcans 7A9,02-10-01-00-00-00-00-00,0,1
    tcanr 7A1,02-50-01-00-00-00-00-00,1000
  tend
ttitle-end
```

## 5. 编写建议

- 推荐使用 `.tester` 作为文件扩展名；`.txt` 仅用于兼容现有流程。
- 同一文件中先写配置块，再写测试集。
- 单通道场景可省略 `tcans` / `tcanr` 的通道前缀；多通道场景未显式写通道时默认使用通道 `0`，但仍建议显式写通道索引。
- DTC 若需要稳定解析，优先使用十六进制字符集合形式。
- `tnote` 仅用于注释说明，不要将其视为执行命令。

## 6. 已知限制与规划中能力

以下内容不属于当前正式支持语法：

- `tconfirm`
- `tenum`
- `tbitfield`
- `tcans_ch_def` 的“别名,通道索引”设计写法

说明：

- 这些关键字可能出现在高亮规则、关键词列表或历史草稿中，但当前 `grammar.js` 不提供完整正式支持，或实现与设计不一致。
- 若后续 parser 与扩展实现补齐，应再提升为正式语法。

## 7. 当前 parser 的已知宽松/异常行为

以下行为来自当前实现现状，仅作说明，不建议依赖：

- `integer` 词法允许负数，例如 `tdelay -1` 可被 parser 接受；正式规范仍要求延时、波特率、计数等参数使用非负整数。
- `tcans_ch_def` 当前实际更接近“整数列表”而非“通道别名定义”，因此本文档不将其纳入正式语法。
