#!/usr/bin/env node
import { runBroker, DEFAULT_ENDPOINTS } from "pi-synapse";
import { health, publish, subscribe } from "pi-synapse";
import type { BusEndpoints } from "pi-synapse";

const HELP = `
pi-synapse CLI client

Commands:
  broker   [--xsub=URL] [--xpub=URL] [--control=URL]
  ping     [--control=URL] [--timeout=MS]
  subscribe <prefix> [--xpub=URL]
  publish  <topic> <json> [--xsub=URL] [--control=URL] [--timeout=MS]

Defaults:
  xsub     ${DEFAULT_ENDPOINTS.xsub}
  xpub     ${DEFAULT_ENDPOINTS.xpub}
  control  ${DEFAULT_ENDPOINTS.control}
  timeout  750ms
`.trim();

function parseArgs(argv: string[]): {
	cmd: string | undefined;
	positional: string[];
	flags: Record<string, string>;
} {
	const positional: string[] = [];
	const flags: Record<string, string> = {};

	for (const arg of argv) {
		if (arg.startsWith("--")) {
			const eq = arg.indexOf("=");
			if (eq === -1) {
				flags[arg.slice(2)] = "true";
			} else {
				flags[arg.slice(2, eq)] = arg.slice(eq + 1);
			}
		} else {
			positional.push(arg);
		}
	}

	return { cmd: positional[0], positional: positional.slice(1), flags };
}

function endpoints(flags: Record<string, string>): Partial<BusEndpoints> {
	const out: Partial<BusEndpoints> = {};
	if (flags["xsub"]) out.xsub = flags["xsub"];
	if (flags["xpub"]) out.xpub = flags["xpub"];
	if (flags["control"]) out.control = flags["control"];
	return out;
}

function timeoutMs(flags: Record<string, string>): number | undefined {
	const v = flags["timeout"];
	if (!v) return undefined;
	const n = parseInt(v, 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

function fmt(obj: unknown): string {
	return JSON.stringify(obj, null, 2);
}

async function cmdBroker(flags: Record<string, string>) {
	const ep = endpoints(flags);
	const merged = { ...DEFAULT_ENDPOINTS, ...ep };
	console.log(`broker starting`);
	console.log(`  xsub    ${merged.xsub}`);
	console.log(`  xpub    ${merged.xpub}`);
	console.log(`  control ${merged.control}`);
	await runBroker({ endpoints: ep });
	console.log(`broker running (Ctrl+C to stop)`);
	await new Promise(() => {});
}

async function cmdPing(flags: Record<string, string>) {
	const ep = endpoints(flags);
	const t = timeoutMs(flags);
	const ok = await health({ endpoints: ep, ...(t ? { timeoutMs: t } : {}) });
	if (ok) {
		console.log("PONG");
		process.exit(0);
	} else {
		console.error("TIMEOUT — broker not reachable");
		process.exit(1);
	}
}

async function cmdSubscribe(
	positional: string[],
	flags: Record<string, string>,
) {
	const prefix = positional[0];
	if (!prefix) {
		console.error("subscribe requires <prefix>");
		process.exit(1);
	}
	const ep = endpoints(flags);
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

	process.once("SIGINT", () => {
		unsub();
		process.exit(0);
	});

	await new Promise(() => {});
}

async function cmdPublish(positional: string[], flags: Record<string, string>) {
	const topic = positional[0];
	const jsonStr = positional[1];

	if (!topic || !jsonStr) {
		console.error("publish requires <topic> <json>");
		process.exit(1);
	}

	let payload: unknown;
	try {
		payload = JSON.parse(jsonStr);
	} catch {
		console.error(`invalid JSON: ${jsonStr}`);
		process.exit(1);
	}

	const ep = endpoints(flags);
	const t = timeoutMs(flags);
	const result = await publish(topic, payload, {
		endpoints: ep,
		...(t ? { timeoutMs: t } : {}),
	});

	if (result.ok) {
		console.log(`published to "${topic}"`);
	} else {
		console.error(`publish failed [${result.code}]: ${result.error}`);
		process.exit(1);
	}
}

async function main() {
	const { cmd, positional, flags } = parseArgs(process.argv.slice(2));

	if (!cmd || flags.help || flags.h) {
		console.log(HELP);
		process.exit(0);
	}

	switch (cmd) {
		case "broker":
			await cmdBroker(flags);
			break;
		case "ping":
			await cmdPing(flags);
			break;
		case "subscribe":
			await cmdSubscribe(positional, flags);
			break;
		case "publish":
			await cmdPublish(positional, flags);
			break;
		default:
			console.error(`unknown command: ${cmd}`);
			console.log(HELP);
			process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
