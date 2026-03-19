import * as assert from "assert";
import { parseMessageDecoderInput } from "../providers/messageDecoderInput";

suite("parseMessageDecoderInput", () => {
  test("支持多行批量输入并跳过空行", () => {
    const result = parseMessageDecoderInput(
      ["1A3, FF 00 AB 12", "", "0x261, 2A 01 00 00 00 00 00 D4"].join("\n"),
    );

    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.requests.length, 2);
    assert.strictEqual(result.requests[0].lineNumber, 1);
    assert.strictEqual(result.requests[0].messageId, 0x1a3);
    assert.deepStrictEqual(result.requests[0].dataBytes, [0xff, 0x00, 0xab, 0x12]);
    assert.strictEqual(result.requests[1].lineNumber, 3);
    assert.strictEqual(result.requests[1].messageId, 0x261);
  });

  test("单行失败不会阻断其他行解析", () => {
    const result = parseMessageDecoderInput(
      [
        "XYZ, 00 11",
        "123, 00 GG",
        "456, 00 11 22 33 44 55 66 77 88",
        "789, 0A 0B",
      ].join("\n"),
    );

    assert.strictEqual(result.requests.length, 1);
    assert.strictEqual(result.requests[0].lineNumber, 4);
    assert.strictEqual(result.errors.length, 3);
    assert.deepStrictEqual(
      result.errors.map((error) => error.lineNumber),
      [1, 2, 3],
    );
  });
});
