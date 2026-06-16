# pi-notify

## Meta policy

Meta is **user-provided only**. The package must not inject any automatic metadata into bus messages — no agent name/role/tags, no cwd, no session file, no PI_AGENT_* env vars, nothing from ExtensionContext.

The only meta that reaches the transport is what the caller explicitly passes at the publish call site (`callOpts.meta`).
