import { Publisher, Subscriber, Request as ZmqRequest } from "zeromq";
import typia from "typia";
import { hostname as osHostname } from "node:os";

import type { NotificationEnvelope } from "@/src/notification.ts";
import { makeEnvelope, normalizeTopic } from "@/src/notification.ts";

export type BusEndpoints = {
	/** Publishers connect here (broker binds XSUB). */
	xsub: string;
	/** Subscribers connect here (broker binds XPUB). */
	xpub: string;
	/** Health ping endpoint (broker binds REP). */
	control: string;
};

export type PublishResult =
	| { ok: true }
	| {
			ok: false;
			code: "BROKER_UNAVAILABLE" | "INVALID_TOPIC";
			error: string;
	  };

export const DEFAULT_ENDPOINTS: BusEndpoints = {
	xsub: "tcp://127.0.0.1:47836",
	xpub: "tcp://127.0.0.1:47837",
	control: "tcp://127.0.0.1:47838",
};

export type SubscribeHandler = (
	msg: NotificationEnvelope,
) => void | Promise<void>;

export type PublishOptions = {
	endpoints?: Partial<BusEndpoints>;
	meta?: Record<string, unknown>;
	timeoutMs?: number;
};

export type SubscribeOptions = {
	endpoints?: Partial<BusEndpoints>;
};

export type HealthOptions = {
	endpoints?: Partial<BusEndpoints>;
	timeoutMs?: number;
};

function resolveEndpoints(partial?: Partial<BusEndpoints>): BusEndpoints {
	return { ...DEFAULT_ENDPOINTS, ...partial };
}

function resolveTimeoutMs(timeoutMs?: number): number {
	return typeof timeoutMs === "number" &&
		Number.isFinite(timeoutMs) &&
		timeoutMs > 0
		? timeoutMs
		: 750;
}

async function pingControl(
	controlUrl: string,
	timeoutMs: number,
): Promise<boolean> {
	const req = new ZmqRequest({ receiveTimeout: timeoutMs });
	try {
		req.connect(controlUrl);
		await req.send("PING");
		const [res] = await req.receive();
		req.close();
		return res?.toString() === "PONG";
	} catch {
		req.close();
		return false;
	}
}

export async function health(opts: HealthOptions = {}): Promise<boolean> {
	const endpoints = resolveEndpoints(opts.endpoints);
	const timeoutMs = resolveTimeoutMs(opts.timeoutMs);
	return pingControl(endpoints.control, timeoutMs);
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

	const endpoints = resolveEndpoints(opts.endpoints);
	const timeoutMs = resolveTimeoutMs(opts.timeoutMs);

	// ZMQ PUB is fire-and-forget — probe control first to detect broker-down
	const up = await pingControl(endpoints.control, timeoutMs);
	if (!up) {
		return {
			ok: false,
			code: "BROKER_UNAVAILABLE",
			error: `Broker not reachable at ${endpoints.control}`,
		};
	}

	const sock = new Publisher({ linger: 200 });
	try {
		sock.connect(endpoints.xsub);
		const env = makeEnvelope(
			topic,
			payload,
			{ pid: process.pid, hostname: osHostname() },
			opts.meta,
		);
		// Brief pause for TCP handshake before send + close
		await new Promise<void>((r) => setTimeout(r, 5));
		await sock.send([topic, JSON.stringify(env)]);
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			code: "BROKER_UNAVAILABLE",
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		sock.close();
	}
}

export async function subscribe(
	prefix: string,
	handler: SubscribeHandler,
	opts: SubscribeOptions = {},
): Promise<() => void> {
	const pfx = normalizeTopic(prefix);
	if (!pfx) {
		throw new Error("Invalid subscription prefix");
	}

	const endpoints = resolveEndpoints(opts.endpoints);
	const sock = new Subscriber();
	sock.connect(endpoints.xpub);
	sock.subscribe(pfx);

	(async () => {
		for await (const [, data] of sock) {
			if (!data) {
				continue;
			}
			const parsed = typia.json.isParse<NotificationEnvelope>(data.toString());
			if (parsed) {
				await handler(parsed);
			}
		}
	})();

	return () => {
		sock.close();
	};
}
