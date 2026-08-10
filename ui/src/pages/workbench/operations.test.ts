// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import type { ApplicationContext } from "../../app/context.ts";
import {
  configureWorkbenchFoundation,
  createWorkbenchMission,
  verifyWorkbenchModel,
} from "./operations.ts";

type RequestHandler = (method: string, params: unknown) => unknown | Promise<unknown>;

function createOperationContext(params: {
  methods?: string[];
  request?: RequestHandler;
  connected?: boolean;
  canApply?: boolean;
}) {
  const request = vi.fn(async (method: string, requestParams: unknown) =>
    params.request?.(method, requestParams),
  );
  const client = { request } as unknown as GatewayBrowserClient;
  let patchSpec: unknown;
  const patchFromSnapshot = vi.fn(async (build: (base: unknown) => unknown) => {
    patchSpec = build({});
    return true;
  });
  const apply = vi.fn(async () => true);
  const runExternalMutation = vi.fn(
    async (task: (active: GatewayBrowserClient) => Promise<unknown>) => ({
      ok: true as const,
      value: await task(client),
      refresh: { ok: true as const },
    }),
  );
  const subscribe = () => () => undefined;
  const gatewaySnapshot = {
    client: params.connected === false ? null : client,
    phase: params.connected === false ? "stopped" : "connected",
    hello: {
      type: "hello-ok",
      protocol: 1,
      auth: {
        role: "operator",
        scopes: ["operator.read", "operator.write", "operator.admin"],
      },
      features: { methods: params.methods ?? [] },
    },
  };
  const context = {
    gateway: {
      snapshot: gatewaySnapshot,
      subscribe,
      subscribeEvents: subscribe,
    },
    runtimeConfig: {
      state: { lastError: null },
      canApply: params.canApply ?? true,
      runExternalMutation,
      patchFromSnapshot,
      apply,
      subscribe,
    },
  } as unknown as ApplicationContext;
  return {
    apply,
    client,
    context,
    disconnect: () => Object.assign(gatewaySnapshot, { client: null, phase: "stopped" }),
    getPatchSpec: () => patchSpec,
    patchFromSnapshot,
    request,
    runExternalMutation,
  };
}

describe("Workbench operations", () => {
  it("reports a model ready only after the Gateway returns a live inference result", async () => {
    const request = vi.fn(async () => ({
      ok: true as const,
      modelRef: "openai/gpt-5.6-luna",
      latencyMs: 149.6,
    }));
    const client = { request } as unknown as GatewayBrowserClient;

    await expect(verifyWorkbenchModel(client)).resolves.toMatchObject({
      phase: "ready",
      detail: "openai/gpt-5.6-luna answered in 150 ms.",
    });
    expect(request).toHaveBeenCalledWith(
      "openclaw.setup.verify",
      {},
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it("keeps a failed or rejected model probe out of the ready state", async () => {
    const unavailableClient = {
      request: vi.fn(async () => ({
        ok: false as const,
        status: "unavailable" as const,
        error: "no configured model",
      })),
    } as unknown as GatewayBrowserClient;
    const rejectedClient = {
      request: vi.fn(async () => {
        throw new Error("gateway timed out");
      }),
    } as unknown as GatewayBrowserClient;

    await expect(verifyWorkbenchModel(unavailableClient)).resolves.toMatchObject({
      phase: "attention",
      detail: "no configured model",
    });
    await expect(verifyWorkbenchModel(rejectedClient)).resolves.toMatchObject({
      phase: "error",
      detail: "gateway timed out",
    });
  });

  it("enables the safety foundation through serialized plugin mutations before patching config", async () => {
    const harness = createOperationContext({
      methods: ["plugins.setEnabled", "config.patch", "config.apply"],
      request: async (method) => {
        if (method === "plugins.setEnabled") {
          return { ok: true, restartRequired: true };
        }
        throw new Error(`Unexpected method ${method}`);
      },
    });

    await expect(
      configureWorkbenchFoundation({
        context: harness.context,
        profile: "coding",
        approvalTtlMinutes: 0,
        enableWorkboard: true,
      }),
    ).resolves.toEqual({ applied: true });

    expect(harness.request.mock.calls).toEqual([
      ["plugins.setEnabled", { pluginId: "workbench-guardrails", enabled: true }],
      ["plugins.setEnabled", { pluginId: "workboard", enabled: true }],
    ]);
    expect(harness.runExternalMutation).toHaveBeenCalledTimes(2);
    expect(harness.getPatchSpec()).toEqual({
      options: {
        raw: {
          plugins: {
            entries: {
              "workbench-guardrails": {
                enabled: true,
                config: { profile: "coding", approvalTtlMinutes: 1 },
              },
              workboard: { enabled: true },
            },
          },
        },
        note: "Configure the OpenClaw Workbench safety foundation",
      },
    });
    expect(harness.patchFromSnapshot).toHaveBeenCalledOnce();
    expect(harness.apply).toHaveBeenCalledOnce();
  });

  it("refuses to mutate the safety foundation while disconnected", async () => {
    const harness = createOperationContext({ connected: false });

    await expect(
      configureWorkbenchFoundation({
        context: harness.context,
        profile: "personal-safe",
        approvalTtlMinutes: 60,
        enableWorkboard: true,
      }),
    ).rejects.toThrow("Reconnect to the Gateway");
    expect(harness.runExternalMutation).not.toHaveBeenCalled();
    expect(harness.patchFromSnapshot).not.toHaveBeenCalled();
  });

  it("stops the serialized foundation mutation when the Gateway client changes", async () => {
    let disconnect = () => undefined;
    const harness = createOperationContext({
      methods: ["plugins.setEnabled", "config.patch", "config.apply"],
      request: async (method) => {
        if (method === "plugins.setEnabled") {
          disconnect();
          return { ok: true, restartRequired: true };
        }
        throw new Error(`Unexpected method ${method}`);
      },
    });
    disconnect = harness.disconnect;

    await expect(
      configureWorkbenchFoundation({
        context: harness.context,
        profile: "coding",
        approvalTtlMinutes: 30,
        enableWorkboard: true,
      }),
    ).rejects.toThrow("Reconnect to the Gateway");

    expect(harness.request).toHaveBeenCalledTimes(1);
    expect(harness.patchFromSnapshot).not.toHaveBeenCalled();
    expect(harness.apply).not.toHaveBeenCalled();
  });

  it("creates a normalized Workboard mission through the advertised write method", async () => {
    const harness = createOperationContext({
      methods: ["workboard.cards.create"],
      request: async (method) => {
        if (method === "workboard.cards.create") {
          return { card: { id: "card-7", title: "Ship the release" } };
        }
        throw new Error(`Unexpected method ${method}`);
      },
    });

    await expect(
      createWorkbenchMission(harness.context, {
        title: "  Ship the release  ",
        notes: "  Run the complete acceptance suite.  ",
        priority: "high",
        agentId: "release-agent",
      }),
    ).resolves.toEqual({ id: "card-7", title: "Ship the release" });
    expect(harness.request).toHaveBeenCalledWith("workboard.cards.create", {
      title: "Ship the release",
      notes: "Run the complete acceptance suite.",
      priority: "high",
      status: "todo",
      labels: ["workbench"],
      agentId: "release-agent",
    });
  });

  it.each([
    {
      name: "short title",
      draft: { title: "x", notes: "", priority: "normal" as const, agentId: "" },
      message: "at least three characters",
    },
    {
      name: "oversized title",
      draft: { title: "x".repeat(241), notes: "", priority: "normal" as const, agentId: "" },
      message: "240 characters or fewer",
    },
    {
      name: "oversized notes",
      draft: {
        title: "Valid title",
        notes: "x".repeat(8_001),
        priority: "normal" as const,
        agentId: "",
      },
      message: "8,000 characters or fewer",
    },
  ])("rejects a mission with $name before sending it", async ({ draft, message }) => {
    const harness = createOperationContext({ methods: ["workboard.cards.create"] });

    await expect(createWorkbenchMission(harness.context, draft)).rejects.toThrow(message);
    expect(harness.request).not.toHaveBeenCalled();
  });

  it("does not create a mission when Workboard did not advertise the write method", async () => {
    const harness = createOperationContext({ methods: [] });

    await expect(
      createWorkbenchMission(harness.context, {
        title: "Valid mission",
        notes: "",
        priority: "normal",
        agentId: "",
      }),
    ).rejects.toThrow("Enable Workboard and reconnect");
    expect(harness.request).not.toHaveBeenCalled();
  });
});
