import { XPublisher, XSubscriber, Reply } from "zeromq";

import type { BusEndpoints } from "@/src/client.ts";
import { DEFAULT_ENDPOINTS } from "@/src/client.ts";

export type BrokerOptions = {
	endpoints?: Partial<BusEndpoints>;
};

export async function runBroker(opts: BrokerOptions = {}): Promise<() => void> {
	const endpoints: BusEndpoints = { ...DEFAULT_ENDPOINTS, ...opts.endpoints };

	const xsub = new XSubscriber();
	const xpub = new XPublisher();
	const control = new Reply();

	try {
		await xsub.bind(endpoints.xsub);
		await xpub.bind(endpoints.xpub);
		await control.bind(endpoints.control);
	} catch (err) {
		xsub.close();
		xpub.close();
		control.close();
		if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
			process.exit(0);
		}
		throw err;
	}

	// Publisher messages: XSUB → XPUB
	async function forwardToXpub() {
		for await (const frames of xsub) {
			await xpub.send(frames);
		}
	}

	// Subscription frames: XPUB → XSUB
	async function forwardToXsub() {
		for await (const frames of xpub) {
			await xsub.send(frames);
		}
	}

	// Control plane
	async function serveControl() {
		for await (const [req] of control) {
			if (req?.toString() === "PING") {
				await control.send("PONG");
			}
		}
	}

	forwardToXpub().catch(() => {});
	forwardToXsub().catch(() => {});
	serveControl().catch(() => {});

	function teardown() {
		process.off("SIGINT", teardown);
		process.off("SIGTERM", teardown);
		xsub.close();
		xpub.close();
		control.close();
	}

	process.once("SIGINT", teardown);
	process.once("SIGTERM", teardown);

	return teardown;
}
