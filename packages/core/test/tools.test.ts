import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";

import { synapsePublishExecute, normalizeMeta } from "@/src/pi/tools.ts";
import type { PublishResult } from "@/src/client.ts";

function makeCtx(): ExtensionContext {
	return {
		hasUI: true,
		cwd: undefined,
		sessionManager: { getSessionFile: () => undefined },
		ui: { setStatus() {}, notify() {} },
	} as unknown as ExtensionContext;
}

function makeTransport(result: PublishResult = { ok: true }) {
	const calls: Array<{
		topic: string;
		payload: unknown;
		opts: Record<string, unknown> | undefined;
	}> = [];
	const fn = async (
		topic: string,
		payload: unknown,
		opts?: Record<string, unknown>,
	): Promise<PublishResult> => {
		calls.push({ topic, payload, opts });
		return result;
	};
	return { fn, calls };
}

test("normalizeMeta: returns undefined for undefined input", () => {
	expect(normalizeMeta(undefined)).toBeUndefined();
});

test("normalizeMeta: returns undefined for empty object", () => {
	expect(normalizeMeta({})).toBeUndefined();
});

test("normalizeMeta: returns object when has keys", () => {
	expect(normalizeMeta({ a: 1 })).toEqual({ a: 1 });
});

test("synapsePublishExecute: returns a function", () => {
	const { fn } = makeTransport();
	const execute = synapsePublishExecute({ transportPublish: fn });
	expect(typeof execute).toBe("function");
});

test("synapsePublishExecute: successful publish returns ok result", async () => {
	const { fn, calls } = makeTransport({ ok: true });
	const execute = synapsePublishExecute({ transportPublish: fn });

	const res = await execute(
		"call-1",
		{ topic: "alerts.deploy", payload: "shipped v2" },
		undefined,
		undefined,
		makeCtx(),
	);

	expect(calls).toHaveLength(1);
	expect(calls[0]?.topic).toBe("alerts.deploy");
	expect(calls[0]?.payload).toBe("shipped v2");
	expect(res.details.ok).toBe(true);
	expect(res.content[0]?.text).toBe('Published to "alerts.deploy".');
});

test("synapsePublishExecute: failed publish returns error result", async () => {
	const { fn } = makeTransport({
		ok: false,
		code: "BROKER_UNAVAILABLE",
		error: "broker down",
	});
	const execute = synapsePublishExecute({ transportPublish: fn });

	const res = await execute(
		"call-1",
		{ topic: "alerts.deploy", payload: "x" },
		undefined,
		undefined,
		makeCtx(),
	);

	expect(res.details.ok).toBe(false);
	expect(res.details.code).toBe("BROKER_UNAVAILABLE");
	expect(res.content[0]?.text).toBe(
		"Publish failed (BROKER_UNAVAILABLE): broker down",
	);
});

test("synapsePublishExecute: no meta in publish opts by default", async () => {
	const { fn, calls } = makeTransport();
	const execute = synapsePublishExecute({ transportPublish: fn });

	await execute(
		"c",
		{ topic: "t", payload: "p" },
		undefined,
		undefined,
		makeCtx(),
	);

	expect(
		(calls[0]?.opts as { meta?: unknown } | undefined)?.meta,
	).toBeUndefined();
});

test("synapsePublishExecute: passes busOpts through to transport", async () => {
	const { fn, calls } = makeTransport();
	const busOpts = {
		endpoints: { xsub: "tcp://localhost:9999" },
		timeoutMs: 500,
	};
	const execute = synapsePublishExecute({ transportPublish: fn, busOpts });

	await execute(
		"c",
		{ topic: "t", payload: "p" },
		undefined,
		undefined,
		makeCtx(),
	);

	expect(calls[0]?.opts).toMatchObject(busOpts);
});
