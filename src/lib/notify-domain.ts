import { randomUUID } from "node:crypto";
import type { NotifyEnvelope } from "@/src/lib/notify-types.ts";

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
