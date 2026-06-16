import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";

import { register } from "@/src/pi/register.ts";
import type { PublishResult } from "@/src/client.ts";

type SessionHandler = (
	event: unknown,
	ctx: ExtensionContext,
) => unknown | Promise<unknown>;

type CtxWithStatusCalls = ExtensionContext & {
	__statusCalls: Array<{ key: string; value: string | undefined }>;
};

type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;

type ToolDef = {
	name: string;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ExtensionContext,
	) => Promise<{
		content: Array<{ type: string; text?: string }>;
		details: Record<string, unknown>;
	}>;
};

function makePiHarness(): {
	pi: ExtensionAPI;
	handlers: Map<string, SessionHandler>;
	commands: Map<string, { handler: CommandHandler }>;
	tools: Map<string, ToolDef>;
} {
	const handlers = new Map<string, SessionHandler>();
	const commands = new Map<string, { handler: CommandHandler }>();
	const tools = new Map<string, ToolDef>();
	const pi = {
		on(event: string, handler: SessionHandler) {
			handlers.set(event, handler);
		},
		registerCommand(name: string, options: { handler: CommandHandler }) {
			commands.set(name, options);
		},
		registerTool(tool: ToolDef) {
			tools.set(tool.name, tool);
		},
	} as unknown as ExtensionAPI;
	return { pi, handlers, commands, tools };
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

type NotifyCall = { message: string; type: string | undefined };
type CmdCtx = ExtensionContext & {
	__notifyCalls: NotifyCall[];
	__inputTitles: string[];
};

// ctx for command handler tests: records notify() calls and feeds queued
// input() responses (one per prompt, in order).
function makeCommandCtx(inputs: Array<string | undefined> = []): CmdCtx {
	const notifyCalls: NotifyCall[] = [];
	const inputTitles: string[] = [];
	const queue = [...inputs];

	const base = {
		hasUI: true,
		sessionManager: {
			getSessionFile() {
				return "/tmp/session.json";
			},
		},
		ui: {
			setStatus() {},
			notify(message: string, type?: string) {
				notifyCalls.push({ message, type });
			},
			async input(title: string) {
				inputTitles.push(title);
				return queue.shift();
			},
		},
	};

	const ctx = base as unknown as CmdCtx;
	ctx.__notifyCalls = notifyCalls;
	ctx.__inputTitles = inputTitles;
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

	expect(ctx.__statusCalls).toEqual([
		{ key: "pi-synapse", value: "connected" },
	]);
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

	expect(ctx.__statusCalls).toEqual([{ key: "pi-synapse", value: undefined }]);
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

test("register: synapse:publish command parses topic + payload from args", async () => {
	const { pi, commands } = makePiHarness();

	const captured: Array<{ topic: string; payload: unknown }> = [];
	await register(pi, {
		transport: {
			publish: async (topic, payload) => {
				captured.push({ topic, payload });
				return { ok: true };
			},
		},
	});

	const cmd = commands.get("synapse:publish");
	expect(cmd).toBeTruthy();
	if (!cmd) throw new Error("missing synapse:publish command");

	const ctx = makeCommandCtx();
	await cmd.handler("alerts.deploy shipped v2", ctx);

	expect(captured).toEqual([{ topic: "alerts.deploy", payload: "shipped v2" }]);
	expect(ctx.__notifyCalls).toEqual([
		{ message: 'Published to "alerts.deploy".', type: "info" },
	]);
});

test("register: synapse:publish command prompts when args are empty", async () => {
	const { pi, commands } = makePiHarness();

	const captured: Array<{ topic: string; payload: unknown }> = [];
	await register(pi, {
		transport: {
			publish: async (topic, payload) => {
				captured.push({ topic, payload });
				return { ok: true };
			},
		},
	});

	const cmd = commands.get("synapse:publish");
	if (!cmd) throw new Error("missing synapse:publish command");

	const ctx = makeCommandCtx(["alerts.test", "hello"]);
	await cmd.handler("", ctx);

	expect(ctx.__inputTitles).toEqual(["Notification topic", "Payload (text)"]);
	expect(captured).toEqual([{ topic: "alerts.test", payload: "hello" }]);
	expect(ctx.__notifyCalls).toEqual([
		{ message: 'Published to "alerts.test".', type: "info" },
	]);
});

test("register: synapse_publish tool not registered by default", async () => {
	const { pi, tools } = makePiHarness();

	await register(pi, {
		transport: { publish: async () => ({ ok: true }) },
	});

	expect(tools.has("synapse_publish")).toBe(false);
});

test("register: synapse_publish tool registered + publishes when tools opt-in", async () => {
	const { pi, tools } = makePiHarness();

	const captured: Array<{ topic: string; payload: unknown }> = [];
	await register(pi, {
		tools: true,
		transport: {
			publish: async (topic, payload) => {
				captured.push({ topic, payload });
				return { ok: true };
			},
		},
	});

	const tool = tools.get("synapse_publish");
	expect(tool).toBeTruthy();
	if (!tool) throw new Error("missing synapse_publish tool");

	const res = await tool.execute(
		"call-1",
		{ topic: "alerts.deploy", payload: "shipped" },
		undefined,
		undefined,
		makeCtx(),
	);

	expect(captured).toEqual([{ topic: "alerts.deploy", payload: "shipped" }]);
	expect(res.content[0]?.text).toBe('Published to "alerts.deploy".');
	expect(res.details.ok).toBe(true);
});

test("register: synapse_publish tool reports publish failure", async () => {
	const { pi, tools } = makePiHarness();

	await register(pi, {
		tools: true,
		transport: {
			publish: async () => ({
				ok: false,
				code: "BROKER_UNAVAILABLE",
				error: "x",
			}),
		},
	});

	const tool = tools.get("synapse_publish");
	if (!tool) throw new Error("missing synapse_publish tool");

	const res = await tool.execute(
		"call-1",
		{ topic: "alerts.deploy", payload: "shipped" },
		undefined,
		undefined,
		makeCtx(),
	);

	expect(res.details.ok).toBe(false);
	expect(res.content[0]?.text).toBe("Publish failed (BROKER_UNAVAILABLE): x");
});
