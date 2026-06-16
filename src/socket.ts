import type {
	BusEndpoints,
	NotifyEnvelope,
	PublishResult,
	SubscribeHandler,
} from "@/src/notify.ts";
import {
	makeEnvelope,
	normalizeTopic,
	DEFAULT_ENDPOINTS,
} from "@/src//notify.ts";
import { hostname as osHostname } from "node:os";

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

export type SocketClientOptions = {
	endpoints: BusEndpoints;
	timeoutMs: number;
};

// Back-compat name (pre-unification)
export type ZmqClientOptions = SocketClientOptions;

function resolveEndpoints(partial?: Partial<BusEndpoints>): BusEndpoints {
	return {
		xsub: partial?.xsub ?? DEFAULT_ENDPOINTS.xsub,
		xpub: partial?.xpub ?? DEFAULT_ENDPOINTS.xpub,
		control: partial?.control ?? DEFAULT_ENDPOINTS.control,
	};
}

function resolveTimeoutMs(timeoutMs?: number): number {
	return typeof timeoutMs === "number" &&
		Number.isFinite(timeoutMs) &&
		timeoutMs > 0
		? timeoutMs
		: 750;
}

export async function health(opts: HealthOptions = {}): Promise<boolean> {
	return processHealth({
		endpoints: resolveEndpoints(opts.endpoints),
		timeoutMs: resolveTimeoutMs(opts.timeoutMs),
	});
}

export async function publish<T>(
	topicInput: string,
	payload: T,
	opts: PublishOptions = {},
): Promise<PublishResult> {
	const topic = normalizeTopic(topicInput);
	if (!topic)
		return { ok: false, code: "INVALID_TOPIC", error: "Invalid topic" };

	const env = makeEnvelope(
		topic,
		payload,
		{ pid: process.pid, hostname: osHostname() },
		opts.meta,
	);
	return processPublish(env, {
		endpoints: resolveEndpoints(opts.endpoints),
		timeoutMs: resolveTimeoutMs(opts.timeoutMs),
	});
}

export async function subscribe(
	prefix: string,
	handler: SubscribeHandler,
	opts: SubscribeOptions = {},
): Promise<() => void> {
	const pfx = normalizeTopic(prefix);
	if (!pfx) throw new Error("Invalid subscription prefix");
	return processSubscribe(pfx, handler, {
		endpoints: resolveEndpoints(opts.endpoints),
		timeoutMs: resolveTimeoutMs(opts.timeoutMs),
	});
}

// ---------------------------------------------------------------------------
// Process/integration layer.
// Owns sockets. Stubbed for now.
// ---------------------------------------------------------------------------

export async function processHealth(
	_opts: SocketClientOptions,
): Promise<boolean> {
	return false;
}

export async function processPublish(
	_env: NotifyEnvelope,
	_opts: SocketClientOptions,
): Promise<PublishResult> {
	return {
		ok: false,
		code: "NOT_IMPLEMENTED",
		error: "publish() not implemented yet",
	};
}

export async function processSubscribe(
	_prefix: string,
	_handler: SubscribeHandler,
	_opts: SocketClientOptions,
): Promise<() => void> {
	return () => {
		// no-op
	};
}
