import test from "node:test";
import assert from "node:assert/strict";

import { register, type PiApi, type PiContext } from "../src/pi/register.ts";
import type { PublishResult } from "../src/lib/notify-types.ts";

function makePiHarness(): { pi: PiApi; handlers: Map<string, (event: any, ctx: PiContext) => any> } {
  const handlers = new Map<string, (event: any, ctx: PiContext) => any>();
  const pi: PiApi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
  };
  return { pi, handlers };
}

function makeCtx(overrides: Partial<PiContext> = {}): PiContext {
  const statusCalls: Array<{ key: string; value: string | undefined }> = [];

  const base: PiContext = {
    hasUI: true,
    sessionManager: {
      getSessionFile() {
        return "/tmp/session.json";
      },
    },
    ui: {
      setStatus(key, value) {
        statusCalls.push({ key, value });
      },
      notify() {
        // ignore
      },
    },
  };

  const ctx = Object.assign(base, overrides);
  // expose for assertions
  (ctx as any).__statusCalls = statusCalls;
  return ctx;
}

test("register: sets status connected/offline on session_start when UI present", async () => {
  const { pi, handlers } = makePiHarness();

  await register(pi, {
    transport: {
      health: async () => true,
    },
  });

  const ctx = makeCtx();
  const onStart = handlers.get("session_start");
  assert.ok(onStart);

  await onStart({}, ctx);

  const calls = (ctx as any).__statusCalls as Array<{ key: string; value: string | undefined }>;
  assert.deepEqual(calls, [{ key: "pi-notify", value: "connected" }]);
});

test("register: clears status on session_shutdown", async () => {
  const { pi, handlers } = makePiHarness();

  await register(pi, {
    transport: {
      health: async () => true,
    },
  });

  const ctx = makeCtx();
  const onShutdown = handlers.get("session_shutdown");
  assert.ok(onShutdown);

  await onShutdown({}, ctx);

  const calls = (ctx as any).__statusCalls as Array<{ key: string; value: string | undefined }>;
  assert.deepEqual(calls, [{ key: "pi-notify", value: undefined }]);
});

test("register: does not touch UI when hasUI is false", async () => {
  const { pi, handlers } = makePiHarness();

  await register(pi, {
    transport: {
      health: async () => true,
    },
  });

  const ctx = makeCtx({ hasUI: false });
  const onStart = handlers.get("session_start");
  assert.ok(onStart);
  await onStart({}, ctx);

  const calls = (ctx as any).__statusCalls as Array<{ key: string; value: string | undefined }>;
  assert.deepEqual(calls, []);
});

test("register: merges register meta + ctx meta + per-call meta; per-call wins", async () => {
  const { pi } = makePiHarness();

  const captured: Array<{ topic: string; meta: any }> = [];
  const ok: PublishResult = { ok: true };

  const prevEnv = {
    PI_AGENT_RUN_ID: process.env.PI_AGENT_RUN_ID,
    PI_AGENT_GROUP_ID: process.env.PI_AGENT_GROUP_ID,
    PI_AGENT_PARENT_RUN_ID: process.env.PI_AGENT_PARENT_RUN_ID,
  };
  process.env.PI_AGENT_RUN_ID = "run-1";
  process.env.PI_AGENT_GROUP_ID = "group-1";
  process.env.PI_AGENT_PARENT_RUN_ID = "parent-1";

  try {
    const notify = await register(pi, {
      meta: { team: "infra" },
      agent: { name: "builder", role: "ci", tags: ["a"] },
      transport: {
        publish: async (topic, _payload, opts) => {
          captured.push({ topic, meta: opts?.meta });
          return ok;
        },
      },
    });

    const ctx = makeCtx({ cwd: "/repo" });

    await notify.publish(
      "pi.agent_end",
      { x: 1 },
      {
        ctx,
        meta: {
          team: "override",
          extra: 123,
        },
      }
    );

    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.topic, "pi.agent_end");

    assert.deepEqual(captured[0]?.meta, {
      team: "override",
      agentName: "builder",
      agentRole: "ci",
      agentTags: ["a"],
      cwd: "/repo",
      sessionFile: "/tmp/session.json",
      piRunId: "run-1",
      piGroupId: "group-1",
      piParentRunId: "parent-1",
      extra: 123,
    });
  } finally {
    process.env.PI_AGENT_RUN_ID = prevEnv.PI_AGENT_RUN_ID;
    process.env.PI_AGENT_GROUP_ID = prevEnv.PI_AGENT_GROUP_ID;
    process.env.PI_AGENT_PARENT_RUN_ID = prevEnv.PI_AGENT_PARENT_RUN_ID;
  }
});

test("register: meta omitted when empty", async () => {
  const { pi } = makePiHarness();

  const captured: any[] = [];

  const notify = await register(pi, {
    transport: {
      publish: async (_topic, _payload, opts) => {
        captured.push(opts);
        return { ok: true };
      },
    },
  });

  await notify.publish("t", { a: 1 });

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.meta, undefined);
});
