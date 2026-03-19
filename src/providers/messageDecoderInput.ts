export interface MessageDecoderRequest {
  lineNumber: number;
  rawInput: string;
  messageId: number;
  dataBytes: number[];
}

export interface MessageDecoderInputError {
  lineNumber: number;
  rawInput: string;
  message: string;
}

export interface MessageDecoderInputParseResult {
  requests: MessageDecoderRequest[];
  errors: MessageDecoderInputError[];
}

export function parseMessageDecoderInput(
  input: string,
): MessageDecoderInputParseResult {
  const requests: MessageDecoderRequest[] = [];
  const errors: MessageDecoderInputError[] = [];

  const lines = input.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawInput = lines[index];
    const trimmed = rawInput.trim();
    if (!trimmed) {
      continue;
    }

    const lineNumber = index + 1;
    const commaIndex = rawInput.indexOf(",");
    if (commaIndex === -1) {
      errors.push({
        lineNumber,
        rawInput,
        message: "缺少逗号分隔符，格式应为: 报文ID, 报文数据",
      });
      continue;
    }

    const idPart = rawInput.slice(0, commaIndex).trim();
    const dataPart = rawInput.slice(commaIndex + 1).trim();

    if (!HEX_ID_PATTERN.test(idPart)) {
      errors.push({
        lineNumber,
        rawInput,
        message: `非法报文 ID: ${idPart || "(空)"}`,
      });
      continue;
    }

    const byteTokens = dataPart.split(/\s+/).filter(Boolean);
    if (byteTokens.length === 0) {
      errors.push({
        lineNumber,
        rawInput,
        message: "报文数据不能为空",
      });
      continue;
    }

    if (byteTokens.length > 8) {
      errors.push({
        lineNumber,
        rawInput,
        message: `报文数据最多 8 字节，当前为 ${byteTokens.length} 字节`,
      });
      continue;
    }

    const invalidByte = byteTokens.find((token) => !HEX_BYTE_PATTERN.test(token));
    if (invalidByte) {
      errors.push({
        lineNumber,
        rawInput,
        message: `非法字节值: ${invalidByte}`,
      });
      continue;
    }

    requests.push({
      lineNumber,
      rawInput,
      messageId: Number.parseInt(stripHexPrefix(idPart), 16),
      dataBytes: byteTokens.map((token) =>
        Number.parseInt(stripHexPrefix(token), 16),
      ),
    });
  }

  return { requests, errors };
}

const HEX_ID_PATTERN = /^(?:0x)?[0-9a-f]+$/i;
const HEX_BYTE_PATTERN = /^(?:0x)?[0-9a-f]{1,2}$/i;

function stripHexPrefix(value: string) {
  return value.replace(/^0x/i, "");
}
