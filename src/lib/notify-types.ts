export type BusEndpoints = {
	/** Publishers connect here (broker binds XSUB). */
	xsub: string;
	/** Subscribers connect here (broker binds XPUB). */
	xpub: string;
	/** Control plane health checks (broker binds REP). */
	control: string;
};

export type NotifyEnvelope<T = unknown> = {
	v: 1;
	id: string;
	ts: number;
	topic: string;

	/** PID of the publishing process. */
	pid: number;

	/** Hostname of the publishing machine (best-effort). */
	hostname?: string;

	payload: T;

	/** User-provided metadata only. Library will not inject fields here. */
	meta?: Record<string, unknown>;
};

export type PublishResult =
	| { ok: true }
	| {
			ok: false;
			code: "BROKER_UNAVAILABLE" | "INVALID_TOPIC" | "NOT_IMPLEMENTED";
			error: string;
	  };

export type SubscribeHandler = (msg: NotifyEnvelope) => void | Promise<void>;

export const DEFAULT_ENDPOINTS: BusEndpoints = {
	xsub: "tcp://127.0.0.1:47836",
	xpub: "tcp://127.0.0.1:47837",
	control: "tcp://127.0.0.1:47838",
};
