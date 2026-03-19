import { CanTransport } from "./types";

export async function createDefaultTransport(): Promise<CanTransport> {
  const { ZlgCanTransport } = await import("./transport.js");
  return new ZlgCanTransport();
}
