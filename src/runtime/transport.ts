import { openSession } from "@vscode-tester/zlg-can";
import { validateDeviceRuleChannelConfig } from "../can/deviceRules";
import { enrichTransportError } from "../zlgcan/constants";
import { CanSession, CanTransport, ResolvedChannelConfig } from "./types";
import { TesterRuntimeError } from "./utils";

export class ZlgCanTransport implements CanTransport {
  async open(configs: ResolvedChannelConfig[]): Promise<CanSession> {
    if (configs.length === 0) {
      throw new TesterRuntimeError("缺少 tcaninit 配置，无法初始化 CAN 设备");
    }

    const [firstConfig, ...restConfigs] = configs;
    for (const config of configs) {
      const validationMessage = validateDeviceRuleChannelConfig(config);
      if (validationMessage) {
        throw new TesterRuntimeError(validationMessage, config.range);
      }
    }
    for (const currentConfig of restConfigs) {
      if (
        currentConfig.deviceId !== firstConfig.deviceId ||
        currentConfig.deviceIndex !== firstConfig.deviceIndex
      ) {
        throw new TesterRuntimeError(
          "当前运行器仅支持单设备多通道，请确保所有 tcaninit 使用相同的 device_id 与 device_index",
        );
      }
    }

    try {
      return await openSession({
        deviceType: firstConfig.deviceId,
        deviceIndex: firstConfig.deviceIndex,
        channels: configs.map((config) => ({
          channelIndex: config.channelIndex,
          arbitrationBaudRateBps: config.arbitrationBaudRateBps,
          dataBaudRateBps: config.dataBaudRateBps,
        })),
      });
    } catch (error) {
      throw new TesterRuntimeError(
        enrichTransportError(
          error,
          firstConfig.deviceId,
          configs.some((c) => c.dataBaudRateBps !== undefined),
        ),
      );
    }
  }
}
