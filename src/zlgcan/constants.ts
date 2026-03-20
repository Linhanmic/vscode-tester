/**
 * ZLGCAN 硬件常量 — 基于致远电子 ZLGCAN 二次开发手册
 */

/** 仲裁域固定波特率 (kbps) */
export const VALID_ARBITRATION_BAUD_RATES_KBPS: ReadonlySet<number> = new Set([
  1000, 800, 500, 250, 125, 100, 50,
]);

/** 数据域固定波特率 (kbps, 仅 CAN FD) */
export const VALID_DATA_BAUD_RATES_KBPS: ReadonlySet<number> = new Set([
  5000, 4000, 2000, 1000, 800, 500, 250, 125, 100,
]);

/** 设备类型号 → 人类可读名称 */
export const DEVICE_TYPE_LABELS: ReadonlyMap<number, string> = new Map([
  [41, "USBCANFD-200U"],
  [42, "USBCANFD-100U"],
  [43, "USBCANFD-MINI"],
  [59, "USBCANFD-800U"],
  [76, "USBCANFD-400U"],
  [39, "PCIE-CANFD-200U"],
  [48, "CANFDNET-200U(TCP)"],
  [49, "CANFDNET-200U(UDP)"],
]);

/** CAN 经典帧最大载荷 */
export const CAN_CLASSIC_MAX_BYTES = 8;

/** CAN FD 帧最大载荷 */
export const CAN_FD_MAX_BYTES = 64;

/** 将波特率集合格式化为逗号分隔的提示字符串 */
export function formatBaudRateHint(validSet: ReadonlySet<number>): string {
  return Array.from(validSet)
    .sort((a, b) => a - b)
    .join(", ");
}

/** 查找设备类型号对应的人类可读名称 */
export function getDeviceTypeLabel(deviceId: number): string {
  return DEVICE_TYPE_LABELS.get(deviceId) ?? `设备类型 ${deviceId}`;
}

/**
 * 为传输层错误附加 ZLGCAN 诊断上下文
 */
export function enrichTransportError(
  error: unknown,
  deviceId: number,
  hasFdChannel: boolean,
): string {
  const raw = error instanceof Error ? error.message : String(error);
  const label = getDeviceTypeLabel(deviceId);
  const mode = hasFdChannel ? "CAN FD" : "经典 CAN";
  const hints = [
    `设备型号: ${label}`,
    `模式: ${mode}`,
    "排查顺序: 1)确认设备已连接 2)检查波特率 3)检查总线接线/终端电阻 4)确认 ACK 应答",
  ];
  return `${raw}\n${hints.join("；")}`;
}
