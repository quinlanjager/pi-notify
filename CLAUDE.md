# pi-notify


## Meta policy

Meta is **user-provided only**. The package must not inject any automatic metadata into bus messages — no agent name/role/tags, no cwd, no session file, no PI_AGENT_* env vars, nothing from ExtensionContext.

The only meta that reaches the transport is what the caller explicitly passes at the publish call site (`callOpts.meta`).

## Bus options policy

Bus configuration (endpoints, timeoutMs) must be set at program entry points, not threaded through call stacks. Transport functions must not accept or forward `busOpts`/`bus` parameters. If a caller needs custom endpoints they provide a pre-configured transport via `opts.transport`.
