import type { BusEndpoints, NotifyEnvelope, PublishResult, SubscribeHandler } from "../lib/notify-types.js";

export type ZmqClientOptions = {
  endpoints: BusEndpoints;
  timeoutMs: number;
};

// NOTE: This module is the process/integration layer. It will own zeromq sockets.
// Stubs for now; real implementation next.

export async function processHealth(_opts: ZmqClientOptions): Promise<boolean> {
  return false;
}

export async function processPublish(_env: NotifyEnvelope, _opts: ZmqClientOptions): Promise<PublishResult> {
  return { ok: false, code: "NOT_IMPLEMENTED", error: "publish() not implemented yet" };
}

export async function processSubscribe(
  _prefix: string,
  _handler: SubscribeHandler,
  _opts: ZmqClientOptions
): Promise<() => void> {
  return () => {
    // no-op
  };
}
