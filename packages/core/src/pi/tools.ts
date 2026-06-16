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

export function synapsePublishExecute(deps: SynapsePublishToolDeps) {
	return async function execute(
		_toolCallId: string,
		params: { topic: string; payload: string },
		_signal: AbortSignal | undefined,
		_onUpdate: unknown,
		_ctx: ExtensionContext,
	): Promise<SynapsePublishExecuteResult> {
		const res = await deps.transportPublish(params.topic, params.payload, {
			...(deps.busOpts ?? {}),
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
