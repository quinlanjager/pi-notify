# pi-notify (ZeroMQ notification bus) — Refactor Plan

## Goal
Turn this repo into a **standalone npm library** for building **cross-process notification systems** using **ZeroMQ (Node.js)**. Add optional **Pi integration** via `register(pi, ...)`. Remove agent-end-specific behavior.

Non-goals:
- No persistence / replay.
- No delivery acknowledgements.
- No auto-starting the broker by default.

---

## Core design
### Topology (1 broker process)
Use the standard ZeroMQ **XSUB/XPUB proxy** pattern.

Broker binds 3 TCP endpoints (defaults; configurable):
- **XSUB** (publisher ingress): `tcp://127.0.0.1:47836`
- **XPUB** (subscriber egress): `tcp://127.0.0.1:47837`
- **CONTROL** (REQ/REP health): `tcp://127.0.0.1:47838`

Why 2 message ports:
- XSUB and XPUB are different ZeroMQ socket types. One TCP port can’t host both.

### Semantics (document explicitly)
- Best-effort PUB/SUB.
- If broker is down: `publish()` fails gracefully.
- If subscribers are absent: messages are dropped downstream; publisher cannot know.
- Late subscribers miss prior messages.

---

## Public API (library)
### Exports (from `index.ts`)
Remove these from public API:
- `configure(options)` ❌
- `startBroker(options)` ❌

Public exports:
- `publish(topic, payload, opts?)`
- `subscribe(prefix, handler, opts?)`
- `health(opts?)`
- `register(pi, opts?)` (Pi integration)
- Types: `NotifyEnvelope`, `PublishResult`, `BusEndpoints`, `RegisterOptions`

### Suggested TypeScript shapes
```ts
export type BusEndpoints = {
  xsub: string;    // publishers connect (broker binds)
  xpub: string;    // subscribers connect (broker binds)
  control: string; // health ping
};

export type NotifyEnvelope<T = unknown> = {
  v: 1;
  id: string;
  ts: number;
  topic: string;
  payload: T;
  meta?: Record<string, unknown>;
};

export type PublishResult =
  | { ok: true }
  | { ok: false; code: "BROKER_UNAVAILABLE"; error: string };

export async function publish<T>(topic: string, payload: T, opts?: {
  endpoints?: Partial<BusEndpoints>;
  meta?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<PublishResult>;

export async function subscribe(
  prefix: string,
  handler: (msg: NotifyEnvelope) => void | Promise<void>,
  opts?: {
    endpoints?: Partial<BusEndpoints>;
  }
): Promise<() => void>;

export async function health(opts?: {
  endpoints?: Partial<BusEndpoints>;
  timeoutMs?: number;
}): Promise<boolean>;
```

### Message framing
ZeroMQ multipart frames:
- Frame 0: topic string (utf8) — used for prefix filtering.
- Frame 1: JSON string of `NotifyEnvelope`.

---

## Pi integration (`register`)
### API
```ts
const notify = await register(pi, {
  agent: { name: "builder", role: "ci" },
  meta: { team: "infra" },
  bus: { endpoints: { /* overrides */ } },
});

pi.on("agent_end", async (event, ctx) => {
  await notify.publish("pi.agent_end", { event }, { ctx });
});
```

### Responsibilities
- Store metadata once per process (agent name, role, static meta).
- Provide helper `publish()` that merges metadata from:
  1) library defaults (pid/hostname)
  2) `register()` meta
  3) ctx-derived meta (cwd, sessionFile, run ids if present)
  4) per-call meta

Assumption: meta **immutable** after `register()` unless we later add `setMeta()`.

Optional: on `session_start`, set status:
- `pi-notify: connected/offline` (if UI available)

No default event wiring. Caller wires `pi.on(...)`.

---

## Broker (NOT public API)
Broker still exists, but exposed via **CLI** (and/or internal module), not library exports.

Internal module:
- `src/bus/broker.ts` with `runBroker({ endpoints })`.

Control plane:
- REP socket answers:
  - `PING` → `PONG`

Startup behavior:
- If port already bound (EADDRINUSE): exit 0 (assume broker already running).

---

## CLI
Add npm bin (example name; final depends on package name):
- `pi-notify-bus start` — run broker
- `pi-notify-bus health` — ping broker, exit code 0/1
- `pi-notify-bus endpoints` — print effective endpoints

CLI uses env overrides.

---

## Configuration
Support env vars (names TBD; example):
- `PI_NOTIFY_XSUB`
- `PI_NOTIFY_XPUB`
- `PI_NOTIFY_CONTROL`

Library functions accept `opts.endpoints` overrides.

Defaults:
- xsub: `tcp://127.0.0.1:47836`
- xpub: `tcp://127.0.0.1:47837`
- control: `tcp://127.0.0.1:47838`

---

## Repo refactor (file-level)
### Remove/retire agent-end HTTP/SSE system
Delete or replace:
- `src/integration/agent-end-http-server.ts`
- `src/integration/agent-end-server-client.ts`
- `src/integration/agent-end-server-process.ts`
- `src/server-main.ts`
- `src/lib/format.ts`
- `src/lib/types.ts`
- `test/agent-end-server.test.ts`

### Add new modules
- `src/bus/types.ts`
- `src/bus/client.ts` (publish/subscribe/health + singleton sockets)
- `src/pi/register.ts`
- `src/cli.ts` (broker CLI)
- `src/bus/broker.ts` (broker runtime)

Update:
- `index.ts` exports new surface
- `README.md` rewritten for generic notification bus

---

## Tests (vitest)
Replace HTTP server tests with ZMQ tests:
1) Start broker (child process or in-process internal runner) on random free ports.
2) Subscribe to `test.`
3) Publish `test.one`
4) Assert subscriber receives within timeout.

Note: PUB/SUB has subscription propagation delay; tests must wait briefly before publishing (or retry publish).

---

## Build + npm packaging
Current repo is TS entrypoints. For npm distribution:
- Add build step (tsc/tsup) to `dist/`.
- Update `package.json`:
  - `main`, `types`, `exports`
  - `bin` entry for broker CLI
  - dependency: `zeromq`

---

## Docs (README)
Must include:
- Quickstart: start broker, publish, subscribe
- Best-effort semantics + limitations
- Endpoint config + env vars
- Pi `register()` example with agent metadata
- Troubleshooting: broker down => publish failure result
