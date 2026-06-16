import { randomUUID } from "node:crypto";

export type BusEndpoints = {
	/** Publishers connect here (broker binds XSUB). */
	xsub: string;
	/** Subscribers connect here (broker binds XPUB). */
	xpub: string;
	/** Control plane health checks (broker binds REP). */
	control: string;
};

export type NotifyEnvelope<T = unknown> = {
	v: 1;
	id: string;
	ts: number;
	topic: string;

	/** PID of the publishing process. */
	pid: number;

	/** Hostname of the publishing machine (best-effort). */
	hostname?: string;

	payload: T;

	/** User-provided metadata only. Library will not inject fields here. */
	meta?: Record<string, unknown>;
};

export type PublishResult =
	| { ok: true }
	| {
			ok: false;
			code: "BROKER_UNAVAILABLE" | "INVALID_TOPIC" | "NOT_IMPLEMENTED";
			error: string;
	  };

export type SubscribeHandler = (msg: NotifyEnvelope) => void | Promise<void>;

export const DEFAULT_ENDPOINTS: BusEndpoints = {
	xsub: "tcp://127.0.0.1:47836",
	xpub: "tcp://127.0.0.1:47837",
	control: "tcp://127.0.0.1:47838",
};

export type EnvelopeProvenance = {
	pid: number;
	hostname?: string;
};

export function normalizeTopic(input: string): string | undefined {
	const topic = input.trim();
	if (!topic) return undefined;
	return topic;
}

export function makeEnvelope<T>(
	topic: string,
	payload: T,
	provenance: EnvelopeProvenance,
	meta?: Record<string, unknown>,
): NotifyEnvelope<T> {
	return {
		v: 1,
		id: randomUUID(),
		ts: Date.now(),
		topic,
		pid: provenance.pid,
		...(provenance.hostname ? { hostname: provenance.hostname } : {}),
		payload,
		...(meta ? { meta } : {}),
	};
}
