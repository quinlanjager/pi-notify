import type { BusEndpoints, PublishResult, SubscribeHandler } from "./lib/notify-types.js";
import { DEFAULT_ENDPOINTS } from "./lib/notify-types.js";
import { hostname as osHostname } from "node:os";
import { makeEnvelope, normalizeTopic } from "./lib/notify-lib.js";
import { processHealth, processPublish, processSubscribe } from "./process/zmq-client.js";

export type PublishOptions = {
  endpoints?: Partial<BusEndpoints>;
  meta?: Record<string, unknown>;
  timeoutMs?: number;
};

export type SubscribeOptions = {
  endpoints?: Partial<BusEndpoints>;
  timeoutMs?: number;
};

export type HealthOptions = {
  endpoints?: Partial<BusEndpoints>;
  timeoutMs?: number;
};

function resolveEndpoints(partial?: Partial<BusEndpoints>): BusEndpoints {
  return {
    xsub: partial?.xsub ?? DEFAULT_ENDPOINTS.xsub,
    xpub: partial?.xpub ?? DEFAULT_ENDPOINTS.xpub,
    control: partial?.control ?? DEFAULT_ENDPOINTS.control,
  };
}

function resolveTimeoutMs(timeoutMs?: number): number {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 750;
}

export async function health(opts: HealthOptions = {}): Promise<boolean> {
  return processHealth({ endpoints: resolveEndpoints(opts.endpoints), timeoutMs: resolveTimeoutMs(opts.timeoutMs) });
}

export async function publish<T>(topicInput: string, payload: T, opts: PublishOptions = {}): Promise<PublishResult> {
  const topic = normalizeTopic(topicInput);
  if (!topic) return { ok: false, code: "INVALID_TOPIC", error: "Invalid topic" };

  const env = makeEnvelope(topic, payload, { pid: process.pid, hostname: osHostname() }, opts.meta);
  return processPublish(env, { endpoints: resolveEndpoints(opts.endpoints), timeoutMs: resolveTimeoutMs(opts.timeoutMs) });
}

export async function subscribe(prefix: string, handler: SubscribeHandler, opts: SubscribeOptions = {}): Promise<() => void> {
  const pfx = normalizeTopic(prefix);
  if (!pfx) throw new Error("Invalid subscription prefix");
  return processSubscribe(pfx, handler, { endpoints: resolveEndpoints(opts.endpoints), timeoutMs: resolveTimeoutMs(opts.timeoutMs) });
}
