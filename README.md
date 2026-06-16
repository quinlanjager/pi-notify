# pi-synapse (work in progress)

ZeroMQ-backed cross-process notification bus for Node.js.

## Status
Scaffolded public API:
- `publish(topic, payload, opts?)`
- `subscribe(prefix, handler, opts?)`
- `health(opts?)`
- `register(pi, opts?)` (Pi helper)

Transport implementation (ZeroMQ sockets + broker CLI) not implemented yet.
See `PLAN.md`.
