export interface KnownCanDeviceRule {
  deviceId: number;
  deviceName: string;
  fixedBaudOnly: boolean;
  arbitrationOptionsKbps: number[];
  dataOptionsKbps: number[];
  summary: string;
}

export interface DeviceRuleChannelConfig {
  deviceId: number;
  arbitrationBaudRateKbps: number;
  dataBaudRateKbps?: number;
}

const USBCANFD_ARBITRATION_OPTIONS_KBPS = [
  1000, 800, 500, 250, 125, 100, 50,
];
const USBCANFD_DATA_OPTIONS_KBPS = [
  5000, 4000, 2000, 1000, 800, 500, 250, 125, 100,
];

function createUsbcanfdFixedBaudRule(
  deviceId: number,
  deviceName: string,
): KnownCanDeviceRule {
  return {
    deviceId,
    deviceName,
    fixedBaudOnly: true,
    arbitrationOptionsKbps: [...USBCANFD_ARBITRATION_OPTIONS_KBPS],
    dataOptionsKbps: [...USBCANFD_DATA_OPTIONS_KBPS],
    summary:
      `${deviceName}(${deviceId}) 仅支持固定波特率；仲裁域可选 ` +
      `${USBCANFD_ARBITRATION_OPTIONS_KBPS.join("/")} kbps，数据域可选 ` +
      `${USBCANFD_DATA_OPTIONS_KBPS.join("/")} kbps；` +
      "自定义波特率需 ZCANPRO 计算器，当前 DSL 不支持。",
  };
}

const KNOWN_DEVICE_RULES = new Map<number, KnownCanDeviceRule>([
  [41, createUsbcanfdFixedBaudRule(41, "USBCANFD-200U")],
  [42, createUsbcanfdFixedBaudRule(42, "USBCANFD-100U")],
  [59, createUsbcanfdFixedBaudRule(59, "USBCANFD-800U")],
  [76, createUsbcanfdFixedBaudRule(76, "USBCANFD-400U")],
  [85, createUsbcanfdFixedBaudRule(85, "USBCANFD-800H")],
]);

export function getKnownCanDeviceRule(deviceId: number) {
  return KNOWN_DEVICE_RULES.get(deviceId);
}

export function validateDeviceRuleChannelConfig(
  config: DeviceRuleChannelConfig,
) {
  const rule = getKnownCanDeviceRule(config.deviceId);
  if (!rule || !rule.fixedBaudOnly) {
    return undefined;
  }

  if (!rule.arbitrationOptionsKbps.includes(config.arbitrationBaudRateKbps)) {
    return rule.summary;
  }

  if (
    config.dataBaudRateKbps !== undefined &&
    !rule.dataOptionsKbps.includes(config.dataBaudRateKbps)
  ) {
    return rule.summary;
  }

  return undefined;
}

export function getChannelsDeviceRule(
  channels: ReadonlyArray<{ deviceId: number }>,
) {
  if (!channels.length) {
    return undefined;
  }

  const firstDeviceId = channels[0].deviceId;
  const isSingleDevice = channels.every(
    (channel) => channel.deviceId === firstDeviceId,
  );
  if (!isSingleDevice) {
    return undefined;
  }

  return getKnownCanDeviceRule(firstDeviceId);
}
