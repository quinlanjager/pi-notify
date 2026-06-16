import { randomUUID } from "node:crypto";

export type NotificationEnvelope<T = unknown> = {
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

export type EnvelopeSource = {
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
	source: EnvelopeSource,
	meta?: Record<string, unknown>,
): NotificationEnvelope<T> {
	return {
		v: 1,
		id: randomUUID(),
		ts: Date.now(),
		topic,
		pid: source.pid,
		...(source.hostname ? { hostname: source.hostname } : {}),
		payload,
		...(meta ? { meta } : {}),
	};
}
