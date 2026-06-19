import type { PublishResult, SubscribeHandler } from "@/src/client.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { health, publish, subscribe } from "@/src/client.ts";
import { runBroker } from "@/src/broker.ts";
import { Type } from "typebox";
import { synapsePublishExecute, normalizeMeta } from "@/src/pi/tools.ts";

export type RegisterOptions = {
	statusKey?: string;

	/** Register an LLM-callable tool for publishing notifications. Default: false. */
	tools?: boolean;

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

export type PiSynapse = {
	publish<T>(
		topic: string,
		payload: T,
		opts?: { meta?: Record<string, unknown> },
	): Promise<PublishResult>;
	subscribe(prefix: string, handler: SubscribeHandler): Promise<() => void>;
	health(): Promise<boolean>;
};

export async function register(
	pi: ExtensionAPI,
	opts: RegisterOptions = {},
): Promise<PiSynapse> {
	const transportPublish = opts.transport?.publish ?? publish;
	const transportSubscribe = opts.transport?.subscribe ?? subscribe;
	const transportHealth = opts.transport?.health ?? health;

	const statusKey =
		typeof opts.statusKey === "string" && opts.statusKey.trim().length > 0
			? opts.statusKey
			: "pi-synapse";

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) {
			return;
		}
		let ok = await transportHealth();
		if (!ok) {
			await runBroker();
		}
		ok = await transportHealth();

		ctx.ui.setStatus(statusKey, ok ? "connected" : "offline");
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) {
			return;
		}
		ctx.ui.setStatus(statusKey, undefined);
	});

	const publishImpl: PiSynapse["publish"] = async (
		topic,
		message,
		callOpts = {},
	) => {
		const meta = normalizeMeta(callOpts.meta);
		return transportPublish(
			topic,
			message,
			meta !== undefined ? { meta } : undefined,
		);
	};

	pi.registerCommand("synapse:publish", {
		description: "Send a notification to the synapse bus (topic + payload).",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const sp = trimmed.indexOf(" ");
			let topic = sp === -1 ? trimmed : trimmed.slice(0, sp);
			let payload = sp === -1 ? "" : trimmed.slice(sp + 1).trim();

			if (!topic) {
				topic =
					(
						await ctx.ui.input("Notification topic", "e.g. alerts.deploy")
					)?.trim() ?? "";
				if (!topic) {
					ctx.ui.notify("Publish cancelled: no topic.", "warning");
					return;
				}
			}
			if (!payload) {
				payload =
					(await ctx.ui.input("Payload (text)", "message body"))?.trim() ?? "";
			}

			const res = await publishImpl(topic, payload);
			if (res.ok) {
				ctx.ui.notify(`Published to "${topic}".`, "info");
			} else {
				ctx.ui.notify(`Publish failed (${res.code}): ${res.error}`, "error");
			}
		},
	});

	pi.registerCommand("synapse:run-broker", {
		description: "Starts the synapse broker owned by this session.",
		handler: async (args, ctx) => {
			let ok = await transportHealth();
			let alreadyStarted = true;

			try {
				if (!ok) {
					alreadyStarted = false;
					await runBroker();
				}
				ok = await transportHealth();

				if (ok && alreadyStarted) {
					ctx.ui.notify(`Broker already running`, "info");
				} else if (ok) {
					ctx.ui.notify(`Broker started`, "info");
				}
			} catch (error) {
				ctx.ui.notify(`Broker failed to start`, "error");
			}
		},
	});

	if (opts.tools) {
		const PublishParams = Type.Object({
			topic: Type.String({
				description: 'Topic to publish to, e.g. "alerts.deploy".',
			}),
			payload: Type.String({
				description: "Message body (sent as a raw string).",
			}),
		});

		pi.registerTool({
			name: "synapse_publish",
			label: "Synapse Publish",
			description:
				"Publish a notification to the synapse bus. Provide a dot-delimited topic and a text payload.",
			parameters: PublishParams,
			execute: synapsePublishExecute({ transportPublish }),
		});
	}

	return {
		publish: publishImpl,
		async subscribe(prefix, handler) {
			return transportSubscribe(prefix, handler);
		},
		async health() {
			return transportHealth();
		},
	};
}
