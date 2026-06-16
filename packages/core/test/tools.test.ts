import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";

import {
	ctxMeta,
	synapsePublishExecute as makeSynapsePublishExecute,
	normalizeMeta,
} from "@/src/pi/tools.ts";
import type { PublishResult } from "@/src/client.ts";

function makeCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
	const base = {
		hasUI: true,
		cwd: undefined,
		sessionManager: {
			getSessionFile() {
				return "/tmp/session.json";
			},
		},
		ui: {
			setStatus() {},
			notify() {},
		},
	};
	return Object.assign(base, overrides) as unknown as ExtensionContext;
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

test("ctxMeta: returns undefined when ctx is undefined", () => {
	expect(ctxMeta(undefined)).toBeUndefined();
});

test("ctxMeta: extracts cwd and sessionFile from ctx", () => {
	const ctx = makeCtx({ cwd: "/repo" });
	const meta = ctxMeta(ctx);
	expect(meta?.cwd).toBe("/repo");
	expect(meta?.sessionFile).toBe("/tmp/session.json");
});

test("ctxMeta: includes PI env vars when set", () => {
	const prev = {
		run: process.env.PI_AGENT_RUN_ID,
		group: process.env.PI_AGENT_GROUP_ID,
		parent: process.env.PI_AGENT_PARENT_RUN_ID,
	};
	process.env.PI_AGENT_RUN_ID = "run-1";
	process.env.PI_AGENT_GROUP_ID = "group-1";
	process.env.PI_AGENT_PARENT_RUN_ID = "parent-1";

	try {
		const meta = ctxMeta(makeCtx());
		expect(meta?.piRunId).toBe("run-1");
		expect(meta?.piGroupId).toBe("group-1");
		expect(meta?.piParentRunId).toBe("parent-1");
	} finally {
		process.env.PI_AGENT_RUN_ID = prev.run;
		process.env.PI_AGENT_GROUP_ID = prev.group;
		process.env.PI_AGENT_PARENT_RUN_ID = prev.parent;
	}
});

test("ctxMeta: returns undefined when ctx has no meaningful fields", () => {
	const ctx = {
		cwd: undefined,
		sessionManager: { getSessionFile: () => undefined },
		ui: { setStatus() {}, notify() {} },
		hasUI: false,
	} as unknown as ExtensionContext;

	const prev = {
		run: process.env.PI_AGENT_RUN_ID,
		group: process.env.PI_AGENT_GROUP_ID,
		parent: process.env.PI_AGENT_PARENT_RUN_ID,
	};
	delete process.env.PI_AGENT_RUN_ID;
	delete process.env.PI_AGENT_GROUP_ID;
	delete process.env.PI_AGENT_PARENT_RUN_ID;

	try {
		expect(ctxMeta(ctx)).toBeUndefined();
	} finally {
		process.env.PI_AGENT_RUN_ID = prev.run;
		process.env.PI_AGENT_GROUP_ID = prev.group;
		process.env.PI_AGENT_PARENT_RUN_ID = prev.parent;
	}
});

test("makeSynapsePublishExecute: returns a function", () => {
	const { fn } = makeTransport();
	const execute = makeSynapsePublishExecute({ transportPublish: fn });
	expect(typeof execute).toBe("function");
});

test("makeSynapsePublishExecute: successful publish returns ok result", async () => {
	const { fn, calls } = makeTransport({ ok: true });
	const execute = makeSynapsePublishExecute({ transportPublish: fn });

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

test("makeSynapsePublishExecute: failed publish returns error result", async () => {
	const { fn } = makeTransport({
		ok: false,
		code: "BROKER_UNAVAILABLE",
		error: "broker down",
	});
	const execute = makeSynapsePublishExecute({ transportPublish: fn });

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

test("makeSynapsePublishExecute: merges baseMeta into publish opts", async () => {
	const { fn, calls } = makeTransport();
	const execute = makeSynapsePublishExecute({
		transportPublish: fn,
		baseMeta: { team: "infra", agentName: "builder" },
	});

	await execute(
		"c",
		{ topic: "t", payload: "p" },
		undefined,
		undefined,
		makeCtx(),
	);

	expect(calls[0]?.opts).toMatchObject({
		meta: { team: "infra", agentName: "builder" },
	});
});

test("makeSynapsePublishExecute: merges ctx meta with baseMeta", async () => {
	const { fn, calls } = makeTransport();
	const execute = makeSynapsePublishExecute({
		transportPublish: fn,
		baseMeta: { team: "infra" },
	});

	const ctx = makeCtx({ cwd: "/repo" });
	await execute("c", { topic: "t", payload: "p" }, undefined, undefined, ctx);

	expect(calls[0]?.opts).toMatchObject({
		meta: { team: "infra", cwd: "/repo", sessionFile: "/tmp/session.json" },
	});
});

test("makeSynapsePublishExecute: no meta key when baseMeta and ctx empty", async () => {
	const { fn, calls } = makeTransport();
	const ctx = {
		cwd: undefined,
		sessionManager: { getSessionFile: () => undefined },
		ui: { setStatus() {}, notify() {} },
		hasUI: false,
	} as unknown as ExtensionContext;

	const prev = {
		run: process.env.PI_AGENT_RUN_ID,
		group: process.env.PI_AGENT_GROUP_ID,
		parent: process.env.PI_AGENT_PARENT_RUN_ID,
	};
	delete process.env.PI_AGENT_RUN_ID;
	delete process.env.PI_AGENT_GROUP_ID;
	delete process.env.PI_AGENT_PARENT_RUN_ID;

	try {
		const execute = makeSynapsePublishExecute({ transportPublish: fn });
		await execute("c", { topic: "t", payload: "p" }, undefined, undefined, ctx);
		expect(
			(calls[0]?.opts as { meta?: unknown } | undefined)?.meta,
		).toBeUndefined();
	} finally {
		process.env.PI_AGENT_RUN_ID = prev.run;
		process.env.PI_AGENT_GROUP_ID = prev.group;
		process.env.PI_AGENT_PARENT_RUN_ID = prev.parent;
	}
});

test("makeSynapsePublishExecute: passes busOpts through to transport", async () => {
	const { fn, calls } = makeTransport();
	const busOpts = {
		endpoints: { xsub: "tcp://localhost:9999" },
		timeoutMs: 500,
	};
	const execute = makeSynapsePublishExecute({ transportPublish: fn, busOpts });

	await execute(
		"c",
		{ topic: "t", payload: "p" },
		undefined,
		undefined,
		makeCtx(),
	);

	expect(calls[0]?.opts).toMatchObject(busOpts);
});
