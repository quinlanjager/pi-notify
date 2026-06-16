import type {
	BusEndpoints,
	PublishResult,
	SubscribeHandler,
} from "@/src/socket.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { health, publish, subscribe } from "@/src/socket.ts";

export type RegisterOptions = {
	agent?: { name?: string; role?: string; tags?: string[] };
	meta?: Record<string, unknown>;
	bus?: { endpoints?: Partial<BusEndpoints>; timeoutMs?: number };
	statusKey?: string;

	/**
	 * Advanced/testing: override underlying bus functions.
	 * Not required for normal usage.
	 */
	transport?: {
		publish?: typeof publish;
		subscribe?: typeof subscribe;
		health?: typeof health;
	};
};

export type PiNotify = {
	publish<T>(
		topic: string,
		payload: T,
		opts?: { ctx?: ExtensionContext; meta?: Record<string, unknown> },
	): Promise<PublishResult>;
	subscribe(prefix: string, handler: SubscribeHandler): Promise<() => void>;
	health(): Promise<boolean>;
};

function normalizeMeta(
	meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!meta) return undefined;
	return Object.keys(meta).length > 0 ? meta : undefined;
}

function ctxMeta(
	ctx: ExtensionContext | undefined,
): Record<string, unknown> | undefined {
	if (!ctx) return undefined;

	const out: Record<string, unknown> = {};

	if (ctx.cwd) out.cwd = ctx.cwd;

	const sessionFile = ctx.sessionManager.getSessionFile();
	if (sessionFile) out.sessionFile = sessionFile;

	const runId = process.env.PI_AGENT_RUN_ID;
	if (runId) out.piRunId = runId;

	const groupId = process.env.PI_AGENT_GROUP_ID;
	if (groupId) out.piGroupId = groupId;

	const parentRunId = process.env.PI_AGENT_PARENT_RUN_ID;
	if (parentRunId) out.piParentRunId = parentRunId;

	return normalizeMeta(out);
}

export async function register(
	pi: ExtensionAPI,
	opts: RegisterOptions = {},
): Promise<PiNotify> {
	const transportPublish = opts.transport?.publish ?? publish;
	const transportSubscribe = opts.transport?.subscribe ?? subscribe;
	const transportHealth = opts.transport?.health ?? health;

	const statusKey =
		typeof opts.statusKey === "string" && opts.statusKey.trim().length > 0
			? opts.statusKey
			: "pi-notify";

	const baseMetaRaw: Record<string, unknown> = {};
	if (opts.meta) Object.assign(baseMetaRaw, opts.meta);

	const agent = opts.agent;
	if (agent) {
		if (agent.name) baseMetaRaw.agentName = agent.name;
		if (agent.role) baseMetaRaw.agentRole = agent.role;
		if (agent.tags) baseMetaRaw.agentTags = agent.tags;
	}

	const baseMeta = normalizeMeta(baseMetaRaw);

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const ok = await transportHealth(opts.bus ?? {});
		ctx.ui.setStatus(statusKey, ok ? "connected" : "offline");
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(statusKey, undefined);
	});

	return {
		async publish(topic, payload, callOpts = {}) {
			const metaRaw: Record<string, unknown> = {};

			if (baseMeta) Object.assign(metaRaw, baseMeta);

			const fromCtx = ctxMeta(callOpts.ctx);
			if (fromCtx) Object.assign(metaRaw, fromCtx);

			if (callOpts.meta) Object.assign(metaRaw, callOpts.meta);

			const meta = normalizeMeta(metaRaw);
			return transportPublish(topic, payload, {
				...(opts.bus ?? {}),
				...(meta !== undefined ? { meta } : {}),
			});
		},
		async subscribe(prefix, handler) {
			return transportSubscribe(prefix, handler, opts.bus ?? {});
		},
		async health() {
			return transportHealth(opts.bus ?? {});
		},
	};
}
