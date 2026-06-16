import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "bun:test";

import { register } from "@/src/pi/register.ts";
import type { PublishResult } from "@/src/socket.ts";

type SessionHandler = (
	event: unknown,
	ctx: ExtensionContext,
) => unknown | Promise<unknown>;

type CtxWithStatusCalls = ExtensionContext & {
	__statusCalls: Array<{ key: string; value: string | undefined }>;
};

function makePiHarness(): {
	pi: ExtensionAPI;
	handlers: Map<string, SessionHandler>;
} {
	const handlers = new Map<string, SessionHandler>();
	const pi = {
		on(event, handler) {
			handlers.set(event, handler as SessionHandler);
		},
	} as ExtensionAPI;
	return { pi, handlers };
}

function makeCtx(
	overrides: Partial<ExtensionContext> = {},
): CtxWithStatusCalls {
	const statusCalls: Array<{ key: string; value: string | undefined }> = [];

	const base = {
		hasUI: true,
		sessionManager: {
			getSessionFile() {
				return "/tmp/session.json";
			},
		},
		ui: {
			setStatus(key: string, value: string | undefined) {
				statusCalls.push({ key, value });
			},
			notify() {
				// ignore
			},
		},
	};

	const ctx = Object.assign(base, overrides) as unknown as CtxWithStatusCalls;
	ctx.__statusCalls = statusCalls;
	return ctx;
}

test("register: sets status connected/offline on session_start when UI present", async () => {
	const { pi, handlers } = makePiHarness();

	await register(pi, {
		transport: {
			health: async () => true,
		},
	});

	const ctx = makeCtx();
	const onStart = handlers.get("session_start");
	expect(onStart).toBeTruthy();
	if (!onStart) throw new Error("missing session_start handler");

	await onStart({}, ctx);

	expect(ctx.__statusCalls).toEqual([{ key: "pi-notify", value: "connected" }]);
});

test("register: clears status on session_shutdown", async () => {
	const { pi, handlers } = makePiHarness();

	await register(pi, {
		transport: {
			health: async () => true,
		},
	});

	const ctx = makeCtx();
	const onShutdown = handlers.get("session_shutdown");
	expect(onShutdown).toBeTruthy();
	if (!onShutdown) throw new Error("missing session_shutdown handler");

	await onShutdown({}, ctx);

	expect(ctx.__statusCalls).toEqual([{ key: "pi-notify", value: undefined }]);
});

test("register: does not touch UI when hasUI is false", async () => {
	const { pi, handlers } = makePiHarness();

	await register(pi, {
		transport: {
			health: async () => true,
		},
	});

	const ctx = makeCtx({ hasUI: false });
	const onStart = handlers.get("session_start");
	expect(onStart).toBeTruthy();
	if (!onStart) throw new Error("missing session_start handler");

	await onStart({}, ctx);

	expect(ctx.__statusCalls).toEqual([]);
});

test("register: merges register meta + ctx meta + per-call meta; per-call wins", async () => {
	const { pi } = makePiHarness();

	const captured: Array<{
		topic: string;
		meta: Record<string, unknown> | undefined;
	}> = [];
	const ok: PublishResult = { ok: true };

	const prevEnv = {
		PI_AGENT_RUN_ID: process.env.PI_AGENT_RUN_ID,
		PI_AGENT_GROUP_ID: process.env.PI_AGENT_GROUP_ID,
		PI_AGENT_PARENT_RUN_ID: process.env.PI_AGENT_PARENT_RUN_ID,
	};
	process.env.PI_AGENT_RUN_ID = "run-1";
	process.env.PI_AGENT_GROUP_ID = "group-1";
	process.env.PI_AGENT_PARENT_RUN_ID = "parent-1";

	try {
		const notify = await register(pi, {
			meta: { team: "infra" },
			agent: { name: "builder", role: "ci", tags: ["a"] },
			transport: {
				publish: async (topic, _payload, opts) => {
					captured.push({ topic, meta: opts?.meta });
					return ok;
				},
			},
		});

		const ctx = makeCtx({ cwd: "/repo" });

		await notify.publish(
			"pi.agent_end",
			{ x: 1 },
			{
				ctx,
				meta: {
					team: "override",
					extra: 123,
				},
			},
		);

		expect(captured.length).toBe(1);
		expect(captured[0]?.topic).toBe("pi.agent_end");

		expect(captured[0]?.meta).toEqual({
			team: "override",
			agentName: "builder",
			agentRole: "ci",
			agentTags: ["a"],
			cwd: "/repo",
			sessionFile: "/tmp/session.json",
			piRunId: "run-1",
			piGroupId: "group-1",
			piParentRunId: "parent-1",
			extra: 123,
		});
	} finally {
		process.env.PI_AGENT_RUN_ID = prevEnv.PI_AGENT_RUN_ID;
		process.env.PI_AGENT_GROUP_ID = prevEnv.PI_AGENT_GROUP_ID;
		process.env.PI_AGENT_PARENT_RUN_ID = prevEnv.PI_AGENT_PARENT_RUN_ID;
	}
});

test("register: meta omitted when empty", async () => {
	const { pi } = makePiHarness();

	const captured: Array<unknown> = [];

	const notify = await register(pi, {
		transport: {
			publish: async (_topic, _payload, opts) => {
				captured.push(opts);
				return { ok: true };
			},
		},
	});

	await notify.publish("t", { a: 1 });

	expect(captured.length).toBe(1);
	expect((captured[0] as { meta?: unknown } | undefined)?.meta).toBeUndefined();
});
