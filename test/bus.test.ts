import { afterAll, beforeAll, expect, test } from "vitest";

import { runBroker } from "@/src/broker.ts";
import type { NotifyEnvelope } from "@/src/notify.ts";
import type { BusEndpoints } from "@/src/client.ts";
import { health, publish, subscribe } from "@/src/client.ts";
import { getFreePorts } from "./helpers/get-free-ports.ts";

let endpoints: BusEndpoints;
let teardown: () => void;

beforeAll(async () => {
	const [xsubPort, xpubPort, controlPort] = await getFreePorts(3);
	endpoints = {
		xsub: `tcp://127.0.0.1:${xsubPort}`,
		xpub: `tcp://127.0.0.1:${xpubPort}`,
		control: `tcp://127.0.0.1:${controlPort}`,
	};

	teardown = await runBroker({ endpoints });

	const up = await health({ endpoints, timeoutMs: 2000 });
	if (!up) throw new Error("Broker did not start in time");
}, 5000);

afterAll(() => {
	teardown?.();
});

test("health returns true when broker running", async () => {
	expect(await health({ endpoints })).toBe(true);
});

test("publish → subscribe delivers message", async () => {
	const received: NotifyEnvelope[] = [];

	const unsub = await subscribe(
		"test.",
		(msg) => {
			received.push(msg);
		},
		{
			endpoints,
		},
	);

	// Wait for subscription frame to propagate through broker
	await new Promise<void>((r) => setTimeout(r, 50));

	const result = await publish("test.one", { x: 42 }, { endpoints });
	expect(result.ok).toBe(true);

	// Wait for delivery
	await new Promise<void>((r) => setTimeout(r, 100));

	unsub();

	expect(received).toHaveLength(1);
	expect(received[0]?.topic).toBe("test.one");
	expect(received[0]?.payload).toEqual({ x: 42 });
});
