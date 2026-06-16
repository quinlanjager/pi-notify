import { XPublisher, XSubscriber, Reply } from "zeromq";

import type { BusEndpoints } from "@/src/socket.ts";
import { DEFAULT_ENDPOINTS } from "@/src/socket.ts";

export type BrokerOptions = {
	endpoints?: Partial<BusEndpoints>;
};

export async function runBroker(opts: BrokerOptions = {}): Promise<void> {
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

	function cleanup() {
		xsub.close();
		xpub.close();
		control.close();
		process.exit(0);
	}

	process.once("SIGINT", cleanup);
	process.once("SIGTERM", cleanup);

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

	await Promise.all([forwardToXpub(), forwardToXsub(), serveControl()]);
}
