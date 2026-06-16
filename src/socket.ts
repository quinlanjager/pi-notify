import { connect } from "@nats-io/transport-node";
import typia from "typia";

import type { NotifyEnvelope } from "@/src/notify.ts";
import { makeEnvelope, normalizeTopic } from "@/src/notify.ts";
import { hostname as osHostname } from "node:os";

export type BusEndpoints = {
	url: string;
};

export type PublishResult =
	| { ok: true }
	| {
			ok: false;
			code: "BROKER_UNAVAILABLE" | "INVALID_TOPIC" | "NOT_IMPLEMENTED";
			error: string;
	  };

export const DEFAULT_ENDPOINTS: BusEndpoints = {
	url: "nats://127.0.0.1:4222",
};

export type SubscribeHandler = (msg: NotifyEnvelope) => void | Promise<void>;

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

const enc = new TextEncoder();
const dec = new TextDecoder();

function resolveUrl(partial?: Partial<BusEndpoints>): string {
	return partial?.url ?? DEFAULT_ENDPOINTS.url;
}

function resolveTimeoutMs(timeoutMs?: number): number {
	return typeof timeoutMs === "number" &&
		Number.isFinite(timeoutMs) &&
		timeoutMs > 0
		? timeoutMs
		: 750;
}

export async function health(opts: HealthOptions = {}): Promise<boolean> {
	const url = resolveUrl(opts.endpoints);
	const timeoutMs = resolveTimeoutMs(opts.timeoutMs);
	try {
		const nc = await connect({
			servers: url,
			timeout: timeoutMs,
			reconnect: false,
		});
		await nc.drain();
		return true;
	} catch {
		return false;
	}
}

export async function publish<T>(
	topicInput: string,
	payload: T,
	opts: PublishOptions = {},
): Promise<PublishResult> {
	const topic = normalizeTopic(topicInput);
	if (!topic) {
		return { ok: false, code: "INVALID_TOPIC", error: "Invalid topic" };
	}

	const url = resolveUrl(opts.endpoints);
	const timeoutMs = resolveTimeoutMs(opts.timeoutMs);
	const env = makeEnvelope(
		topic,
		payload,
		{ pid: process.pid, hostname: osHostname() },
		opts.meta,
	);

	try {
		const nc = await connect({
			servers: url,
			timeout: timeoutMs,
			reconnect: false,
		});
		nc.publish(topic, enc.encode(JSON.stringify(env)));
		await nc.drain();
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			code: "BROKER_UNAVAILABLE",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function subscribe(
	prefix: string,
	handler: SubscribeHandler,
	opts: SubscribeOptions = {},
): Promise<() => void> {
	const pfx = normalizeTopic(prefix);
	if (!pfx) throw new Error("Invalid subscription prefix");

	const url = resolveUrl(opts.endpoints);
	const nc = await connect({ servers: url });
	const sub = nc.subscribe(pfx);

	(async () => {
		for await (const msg of sub) {
			const parsed = typia.json.isParse<NotifyEnvelope>(dec.decode(msg.data));
			if (parsed) {
				await handler(parsed);
			}
		}
	})();

	return () => {
		sub.unsubscribe();
		nc.drain().catch(() => {});
	};
}
