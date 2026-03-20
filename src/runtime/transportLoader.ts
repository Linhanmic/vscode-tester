import { CanTransport } from "./types";

export async function createDefaultTransport(): Promise<CanTransport> {
  const { ZlgCanTransport } = await import("./transport.js");
  return new ZlgCanTransport();
}

export class TransportResolver {
  private resolved: CanTransport | undefined;
  private pending: Promise<CanTransport> | undefined;

  constructor(transport?: CanTransport) {
    this.resolved = transport;
  }

  async get(): Promise<CanTransport> {
    if (this.resolved) {
      return this.resolved;
    }

    if (!this.pending) {
      this.pending = createDefaultTransport()
        .then((transport) => {
          this.resolved = transport;
          return transport;
        })
        .catch((error) => {
          this.pending = undefined;
          throw error;
        });
    }

    return this.pending;
  }
}
