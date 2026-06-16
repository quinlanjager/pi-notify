import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	BusEndpoints,
	PublishOptions,
	PublishResult,
} from "@/src/client.ts";

export type TransportPublish = (
	topic: string,
	payload: unknown,
	opts?: PublishOptions,
) => Promise<PublishResult>;

export type SynapsePublishToolDeps = {
	transportPublish: TransportPublish;
	baseMeta?: Record<string, unknown>;
	busOpts?: { endpoints?: Partial<BusEndpoints>; timeoutMs?: number };
};

export type SynapsePublishExecuteResult = {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
};

export function normalizeMeta(
	meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!meta) return undefined;
	return Object.keys(meta).length > 0 ? meta : undefined;
}

export function ctxMeta(
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

export function synapsePublishExecute(deps: SynapsePublishToolDeps) {
	return async function execute(
		_toolCallId: string,
		params: { topic: string; payload: string },
		_signal: AbortSignal | undefined,
		_onUpdate: unknown,
		ctx: ExtensionContext,
	): Promise<SynapsePublishExecuteResult> {
		const metaRaw: Record<string, unknown> = {};
		if (deps.baseMeta) Object.assign(metaRaw, deps.baseMeta);
		const fromCtx = ctxMeta(ctx);
		if (fromCtx) Object.assign(metaRaw, fromCtx);
		const meta = normalizeMeta(metaRaw);

		const res = await deps.transportPublish(params.topic, params.payload, {
			...(deps.busOpts ?? {}),
			...(meta !== undefined ? { meta } : {}),
		});

		if (res.ok) {
			return {
				content: [{ type: "text", text: `Published to "${params.topic}".` }],
				details: { ok: true, topic: params.topic },
			};
		}
		return {
			content: [
				{
					type: "text",
					text: `Publish failed (${res.code}): ${res.error}`,
				},
			],
			details: {
				ok: false,
				topic: params.topic,
				code: res.code,
				error: res.error,
			},
		};
	};
}
