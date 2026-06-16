#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { runBroker, DEFAULT_ENDPOINTS } from "@pi-synapse/core";
import { health, publish, subscribe } from "@pi-synapse/core";
import type { BusEndpoints } from "@pi-synapse/core";

/**
 * Resolve bus endpoints from environment variables. Unset vars fall back to
 * DEFAULT_ENDPOINTS downstream.
 *
 *   PI_SYNAPSE_XSUB     publishers connect here (broker binds XSUB)
 *   PI_SYNAPSE_XPUB     subscribers connect here (broker binds XPUB)
 *   PI_SYNAPSE_CONTROL  control endpoint
 */
function endpoints(): Partial<BusEndpoints> {
	const out: Partial<BusEndpoints> = {};
	if (process.env.PI_SYNAPSE_XSUB) out.xsub = process.env.PI_SYNAPSE_XSUB;
	if (process.env.PI_SYNAPSE_XPUB) out.xpub = process.env.PI_SYNAPSE_XPUB;
	if (process.env.PI_SYNAPSE_CONTROL)
		out.control = process.env.PI_SYNAPSE_CONTROL;
	return out;
}

function timeoutOpt(t: number | undefined): { timeoutMs: number } | object {
	return t && t > 0 ? { timeoutMs: t } : {};
}

function fmt(obj: unknown): string {
	return JSON.stringify(obj, null, 2);
}

function runIndefinitely(cleanup: () => void): Promise<never> {
	process.once("SIGINT", () => {
		cleanup();
		process.exit(0);
	});
	return new Promise(() => {});
}

async function cmdBroker() {
	const ep = endpoints();
	const merged = { ...DEFAULT_ENDPOINTS, ...ep };
	console.log("broker starting");
	console.log(`  xsub    ${merged.xsub}`);
	console.log(`  xpub    ${merged.xpub}`);
	console.log(`  control ${merged.control}`);
	await runBroker({ endpoints: ep });
	console.log("broker running (Ctrl+C to stop)");
	await runIndefinitely(() => {});
}

async function cmdPing(timeout: number | undefined) {
	const ep = endpoints();
	const ok = await health({ endpoints: ep, ...timeoutOpt(timeout) });
	if (ok) {
		console.log("PONG");
		process.exit(0);
	} else {
		console.error("TIMEOUT — broker not reachable");
		process.exit(1);
	}
}

async function cmdSubscribe(prefix: string) {
	const ep = endpoints();
	console.log(
		`subscribing to "${prefix}" on ${ep.xpub ?? DEFAULT_ENDPOINTS.xpub}`,
	);

	const unsub = await subscribe(
		prefix,
		(msg) => {
			console.log(fmt(msg));
		},
		{ endpoints: ep },
	);

	await runIndefinitely(unsub);
}

function parseMeta(
	raw: string | string[] | undefined,
): Record<string, string> | undefined {
	if (!raw) return undefined;
	const entries = (Array.isArray(raw) ? raw : [raw]).map((kv) => {
		const colon = kv.indexOf(":");
		if (colon === -1) {
			console.error(`--meta must be key:value, got: ${kv}`);
			process.exit(1);
		}
		return [kv.slice(0, colon), kv.slice(colon + 1)] as const;
	});
	return Object.fromEntries(entries);
}

async function cmdPublish(
	topic: string,
	jsonStr: string,
	timeout: number | undefined,
	meta: string | string[] | undefined,
) {
	let payload: unknown;
	try {
		payload = JSON.parse(jsonStr);
	} catch {
		console.error(`invalid JSON: ${jsonStr}`);
		process.exit(1);
	}

	const ep = endpoints();
	const metaObj = parseMeta(meta);
	const result = await publish(topic, payload, {
		endpoints: ep,
		...timeoutOpt(timeout),
		...(metaObj ? { meta: metaObj } : {}),
	});

	if (result.ok) {
		console.log(`published to "${topic}"`);
	} else {
		console.error(`publish failed [${result.code}]: ${result.error}`);
		process.exit(1);
	}
}

await yargs(hideBin(process.argv))
	.scriptName("pi-synapse")
	.usage("$0 <command> [options]")
	.epilogue(
		"Endpoints are set via env vars: PI_SYNAPSE_XSUB, PI_SYNAPSE_XPUB, PI_SYNAPSE_CONTROL.",
	)
	.command("broker", "start the message broker", (y) => y, cmdBroker)
	.command(
		"ping",
		"check broker reachability",
		(y) =>
			y.option("timeout", {
				type: "number",
				describe: "timeout in ms (default 750)",
			}),
		(argv) => cmdPing(argv.timeout),
	)
	.command(
		"subscribe <prefix>",
		"subscribe to topics matching <prefix>",
		(y) =>
			y.positional("prefix", {
				type: "string",
				describe: "topic prefix to subscribe to",
				demandOption: true,
			}),
		(argv) => cmdSubscribe(argv.prefix),
	)
	.command(
		"publish <topic> <json>",
		"publish a JSON payload to <topic>",
		(y) =>
			y
				.positional("topic", {
					type: "string",
					describe: "topic to publish to",
					demandOption: true,
				})
				.positional("json", {
					type: "string",
					describe: "JSON payload",
					demandOption: true,
				})
				.option("timeout", {
					type: "number",
					describe: "timeout in ms (default 750)",
				})
				.option("meta", {
					type: "string",
					describe: "metadata as key:value (repeatable)",
				}),
		(argv) => cmdPublish(argv.topic, argv.json, argv.timeout, argv.meta),
	)
	.demandCommand(1, "specify a command")
	.strict()
	.help()
	.alias("help", "h")
	.parse();
