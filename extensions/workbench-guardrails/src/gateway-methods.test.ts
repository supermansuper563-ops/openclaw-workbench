import type { GatewayRequestHandlerOptions } from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginStateEntry,
  PluginStateKeyedStore,
} from "openclaw/plugin-sdk/plugin-state-runtime";
import { describe, expect, it, vi } from "vitest";
import { GUARDRAILS_GATEWAY_METHODS, registerGuardrailsGatewayMethods } from "./gateway-methods.js";
import type { JournalEvent } from "./types.js";

type GatewayHandler = Parameters<OpenClawPluginApi["registerGatewayMethod"]>[1];
type Registration = {
  handler: GatewayHandler;
  options: Parameters<OpenClawPluginApi["registerGatewayMethod"]>[2];
};

function event(taskId: string, at: string, details: Record<string, unknown> = {}): JournalEvent {
  return { at, type: "decision", taskId, details };
}

function setup(entries: PluginStateEntry<JournalEvent>[] = []) {
  const registrations = new Map<string, Registration>();
  const registerGatewayMethod = vi.fn(
    (method: string, handler: GatewayHandler, options: Registration["options"]) => {
      registrations.set(method, { handler, options });
    },
  );
  const mutableEntries = [...entries];
  const clear = vi.fn(async () => {
    mutableEntries.length = 0;
  });
  const store = {
    entries: vi.fn(async () => [...mutableEntries]),
    clear,
  } as unknown as PluginStateKeyedStore<JournalEvent>;
  registerGuardrailsGatewayMethods(
    { registerGatewayMethod } as unknown as OpenClawPluginApi,
    store,
    "coding",
  );
  return { registrations, store, clear };
}

async function invoke(handler: GatewayHandler, params?: unknown) {
  const respond = vi.fn();
  await handler({ params, respond } as unknown as GatewayRequestHandlerOptions);
  return respond;
}

describe("Workbench Guardrails gateway methods", () => {
  it("registers the runtime status and journal methods with least-privilege scopes", () => {
    const { registrations } = setup();
    expect([...registrations.keys()]).toEqual([
      GUARDRAILS_GATEWAY_METHODS.status,
      GUARDRAILS_GATEWAY_METHODS.journalList,
      GUARDRAILS_GATEWAY_METHODS.journalClear,
    ]);
    expect(registrations.get(GUARDRAILS_GATEWAY_METHODS.status)?.options).toEqual({
      scope: "operator.read",
    });
    expect(registrations.get(GUARDRAILS_GATEWAY_METHODS.journalList)?.options).toEqual({
      scope: "operator.read",
    });
    expect(registrations.get(GUARDRAILS_GATEWAY_METHODS.journalClear)?.options).toEqual({
      scope: "operator.admin",
    });
  });

  it("reports active runtime status from the readable journal store", async () => {
    const { registrations } = setup([
      {
        key: "old",
        value: event("old", "2026-01-01T00:00:00.000Z"),
        createdAt: 100,
      },
      {
        key: "new",
        value: event("new", "2026-01-02T00:00:00.000Z"),
        createdAt: 200,
      },
    ]);
    const respond = await invoke(registrations.get(GUARDRAILS_GATEWAY_METHODS.status)!.handler);
    expect(respond).toHaveBeenCalledWith(true, {
      active: true,
      policyId: "workbench-guardrails",
      profile: "coding",
      journalCount: 2,
      lastEventAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("lists the newest bounded events and re-redacts legacy values", async () => {
    const { registrations } = setup([
      {
        key: "old",
        value: event("old", "2026-01-01T00:00:00.000Z"),
        createdAt: 100,
      },
      {
        key: "new",
        value: event("new", "2026-01-02T00:00:00.000Z", {
          target: "C:\\Users\\alice\\project\\notes.txt",
          note: "Bearer super-secret-value",
        }),
        createdAt: 200,
      },
    ]);
    const respond = await invoke(
      registrations.get(GUARDRAILS_GATEWAY_METHODS.journalList)!.handler,
      { limit: 1 },
    );
    expect(respond).toHaveBeenCalledTimes(1);
    const payload = respond.mock.calls[0]?.[1] as {
      events: JournalEvent[];
      journalCount: number;
    };
    expect(payload.journalCount).toBe(2);
    expect(payload.events.map((entry) => entry.taskId)).toEqual(["new"]);
    expect(JSON.stringify(payload)).not.toContain("alice");
    expect(JSON.stringify(payload)).not.toContain("super-secret-value");
  });

  it.each([0, 1.5, 201, "10"])("rejects an invalid list limit (%s)", async (limit) => {
    const { registrations } = setup();
    const respond = await invoke(
      registrations.get(GUARDRAILS_GATEWAY_METHODS.journalList)!.handler,
      { limit },
    );
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });

  it("clears the journal only through the admin-scoped method", async () => {
    const { registrations, clear } = setup([
      {
        key: "one",
        value: event("one", "2026-01-01T00:00:00.000Z"),
        createdAt: 100,
      },
    ]);
    const respond = await invoke(
      registrations.get(GUARDRAILS_GATEWAY_METHODS.journalClear)!.handler,
    );
    expect(clear).toHaveBeenCalledOnce();
    expect(respond).toHaveBeenCalledWith(true, {
      cleared: true,
      removed: 1,
      journalCount: 0,
    });
  });

  it("does not expose journal storage errors", async () => {
    const { registrations, store } = setup();
    vi.mocked(store.entries).mockRejectedValueOnce(
      new Error("database failed at C:\\Users\\alice\\private\\journal.sqlite"),
    );
    const respond = await invoke(
      registrations.get(GUARDRAILS_GATEWAY_METHODS.journalList)!.handler,
    );
    expect(JSON.stringify(respond.mock.calls)).not.toContain("alice");
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "UNAVAILABLE" }),
    );
  });
});
