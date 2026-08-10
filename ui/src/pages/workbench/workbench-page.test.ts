/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import type { ApplicationContext } from "../../app/context.ts";
import { i18n } from "../../i18n/index.ts";
import { createChannelCapability } from "../../lib/channels/index.ts";
import { createApplicationContextProvider } from "../../test-helpers/application-context.ts";
import { waitForFast } from "../../test-helpers/wait-for.ts";
import type { WorkbenchGuardrailsProfile } from "./types.ts";
import "./workbench-page.ts";

type TestWorkbenchPage = HTMLElement & { updateComplete: Promise<boolean> };

function createWorkbenchContext(
  options: {
    channelError?: string | null;
    methods?: string[];
    request?: (method: string, params: unknown) => unknown | Promise<unknown>;
    scopes?: string[];
    workboardEnabled?: boolean;
    guardrailsConfig?: {
      profile: WorkbenchGuardrailsProfile;
      approvalTtlMinutes: number;
    };
  } = {},
) {
  const request = vi.fn(async (method: string, params: unknown) => {
    if (options.request) {
      return await options.request(method, params);
    }
    if (method === "openclaw.setup.verify") {
      return { ok: true, modelRef: "openai/gpt-5.6-luna", latencyMs: 81 };
    }
    throw new Error(`Unexpected method ${method}`);
  });
  const client = { request } as unknown as GatewayBrowserClient;
  const refreshChannels = vi.fn(async () => undefined);
  const gatewayListeners = new Set<(snapshot: unknown) => void>();
  const runtimeConfigListeners = new Set<() => void>();
  const subscribe = () => () => undefined;
  const gatewaySnapshot = {
    client,
    phase: "connected",
    offlineStable: false,
    canvasPluginSurfaceUrl: null,
    hello: {
      type: "hello-ok",
      protocol: 1,
      auth: {
        role: "operator",
        scopes: options.scopes ?? ["operator.read", "operator.write", "operator.admin"],
      },
      features: { methods: options.methods ?? ["openclaw.setup.verify"] },
    },
    assistantAgentId: "main",
    sessionKey: "main",
    lastError: null,
    lastErrorCode: null,
  };
  let guardrailsConfig = options.guardrailsConfig ?? null;
  let configRevision = 0;
  const buildConfigSnapshot = () => ({
    config: {
      agents: { defaults: { model: "openai/gpt-5.6-luna" } },
      plugins: {
        entries: {
          ...(options.workboardEnabled ? { workboard: { enabled: true } } : {}),
          ...(guardrailsConfig
            ? {
                "workbench-guardrails": {
                  enabled: true,
                  config: guardrailsConfig,
                },
              }
            : {}),
        },
      },
    },
    hash: `test-${configRevision}`,
  });
  const runtimeConfigState = {
    client,
    connected: true,
    configLoading: false,
    configSnapshot: buildConfigSnapshot(),
    lastError: null,
  };
  const notifyRuntimeConfig = () => {
    for (const listener of runtimeConfigListeners) {
      listener();
    }
  };
  const refreshConfig = vi.fn(async () => {
    const refreshClient = runtimeConfigState.client;
    runtimeConfigState.configLoading = true;
    notifyRuntimeConfig();
    await Promise.resolve();
    if (runtimeConfigState.client !== refreshClient) {
      return;
    }
    configRevision += 1;
    runtimeConfigState.configSnapshot = buildConfigSnapshot();
    runtimeConfigState.configLoading = false;
    runtimeConfigState.lastError = null;
    notifyRuntimeConfig();
  });
  const context = {
    basePath: "",
    gateway: {
      snapshot: gatewaySnapshot,
      subscribe: (listener: (snapshot: unknown) => void) => {
        gatewayListeners.add(listener);
        return () => gatewayListeners.delete(listener);
      },
      subscribeEvents: subscribe,
    },
    agents: {
      state: {
        agentsList: { agents: [{ id: "main", name: "Main" }] },
        agentsLoading: false,
      },
      subscribe,
    },
    channels: {
      state: {
        client,
        connected: true,
        channelsLoading: false,
        channelsError: options.channelError ?? null,
        channelsLastSuccess: 1,
        channelsSnapshot: {
          ts: 1,
          channelOrder: ["telegram"],
          channelLabels: { telegram: "Telegram" },
          channels: {
            telegram: { configured: true, running: false, connected: false },
          },
          channelAccounts: { telegram: [] },
          channelDefaultAccountId: { telegram: "default" },
        },
      },
      refresh: refreshChannels,
      subscribe,
    },
    runtimeConfig: {
      state: runtimeConfigState,
      refresh: refreshConfig,
      subscribe: (listener: () => void) => {
        runtimeConfigListeners.add(listener);
        return () => runtimeConfigListeners.delete(listener);
      },
    },
    workboard: { subscribe },
    navigate: vi.fn(),
    preload: vi.fn(async () => undefined),
  } as unknown as ApplicationContext;
  const disconnect = () => {
    Object.assign(gatewaySnapshot, { client: null, phase: "stopped" });
    Object.assign(runtimeConfigState, { client: null, connected: false });
    notifyRuntimeConfig();
    for (const listener of gatewayListeners) {
      listener(gatewaySnapshot);
    }
  };
  const replaceGatewayClient = (nextClient: GatewayBrowserClient) => {
    Object.assign(gatewaySnapshot, { client: nextClient, phase: "connected" });
    Object.assign(runtimeConfigState, { client: nextClient, connected: true });
    notifyRuntimeConfig();
    for (const listener of gatewayListeners) {
      listener(gatewaySnapshot);
    }
  };
  const setGuardrailsConfig = (profile: WorkbenchGuardrailsProfile, approvalTtlMinutes: number) => {
    guardrailsConfig = { profile, approvalTtlMinutes };
  };
  return {
    client,
    context,
    disconnect,
    refreshChannels,
    refreshConfig,
    replaceGatewayClient,
    request,
    setGuardrailsConfig,
  };
}

async function mountWorkbench(context: ApplicationContext): Promise<TestWorkbenchPage> {
  const provider = createApplicationContextProvider(context);
  const page = document.createElement("openclaw-workbench-page") as TestWorkbenchPage;
  provider.append(page);
  document.body.append(provider);
  await page.updateComplete;
  return page;
}

function clickButton(root: ParentNode, selector: string, index = 0): void {
  const button = root.querySelectorAll<HTMLButtonElement>(selector).item(index);
  expect(button).toBeInstanceOf(HTMLButtonElement);
  button.click();
}

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
}

describe("WorkbenchPage interactions", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("runs live model and channel checks from the guided setup", async () => {
    const { context, refreshChannels, request } = createWorkbenchContext();
    const page = await mountWorkbench(context);

    clickButton(page, ".workbench-view-nav button", 1);
    await page.updateComplete;
    clickButton(page, ".workbench-stepper button", 1);
    await page.updateComplete;
    expect(page.textContent).toContain("Run a local open-weight model");
    expect(page.textContent).toContain("Ollama, LM Studio, and vLLM");
    clickButton(page, ".workbench-inline-actions .btn:not(.primary)");
    expect(context.navigate).toHaveBeenCalledWith("model-setup");
    clickButton(page, ".workbench-inline-actions .btn.primary");

    await waitForFast(() => {
      expect(request).toHaveBeenCalledWith(
        "openclaw.setup.verify",
        {},
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      );
      expect(page.textContent).toContain("openai/gpt-5.6-luna answered in 81 ms.");
    });

    clickButton(page, ".workbench-stepper button", 2);
    await page.updateComplete;
    clickButton(page, ".workbench-inline-actions .btn.primary");

    await waitForFast(() => expect(refreshChannels).toHaveBeenCalledWith(true));
  });

  it("clears verified model evidence when the Gateway connection changes", async () => {
    const { context, disconnect } = createWorkbenchContext();
    const page = await mountWorkbench(context);

    clickButton(page, ".workbench-view-nav button", 1);
    await page.updateComplete;
    clickButton(page, ".workbench-stepper button", 1);
    await page.updateComplete;
    clickButton(page, ".workbench-inline-actions .btn.primary");
    await waitForFast(() =>
      expect(page.textContent).toContain("openai/gpt-5.6-luna answered in 81 ms."),
    );

    disconnect();
    await page.updateComplete;
    expect(page.textContent).not.toContain("openai/gpt-5.6-luna answered in 81 ms.");
    expect(page.textContent).toContain("Not tested yet");
  });

  it.each([
    {
      options: { scopes: ["operator.read", "operator.write"] },
      explanation: "Administrator access is required to run a model verification.",
    },
    {
      options: { methods: [] },
      explanation: "This Gateway does not advertise model verification.",
    },
  ])(
    "disables model verification when the capability is unavailable",
    async ({ options, explanation }) => {
      const { context, request } = createWorkbenchContext(options);
      const page = await mountWorkbench(context);

      clickButton(page, ".workbench-view-nav button", 1);
      await page.updateComplete;
      clickButton(page, ".workbench-stepper button", 1);
      await page.updateComplete;
      const verify = page.querySelector<HTMLButtonElement>(
        ".workbench-inline-actions .btn.primary",
      );
      expect(verify?.disabled).toBe(true);
      expect(page.textContent).toContain(explanation);
      verify?.click();
      expect(request).not.toHaveBeenCalledWith("openclaw.setup.verify", expect.anything());
    },
  );

  it("rebinds the safety draft to the replacement Gateway configuration", async () => {
    const { context, replaceGatewayClient, setGuardrailsConfig } = createWorkbenchContext({
      guardrailsConfig: { profile: "research-only", approvalTtlMinutes: 15 },
    });
    const page = await mountWorkbench(context);

    clickButton(page, ".workbench-view-nav button", 1);
    await page.updateComplete;
    clickButton(page, ".workbench-stepper button", 3);
    await waitForFast(() => {
      expect(page.querySelector<HTMLInputElement>('input[value="research-only"]')?.checked).toBe(
        true,
      );
      expect(page.querySelector<HTMLSelectElement>(".workbench-profile-picker select")?.value).toBe(
        "15",
      );
    });

    page.querySelector<HTMLInputElement>('input[value="high-autonomy"]')?.click();
    await page.updateComplete;
    expect(page.querySelector<HTMLInputElement>('input[value="high-autonomy"]')?.checked).toBe(
      true,
    );

    setGuardrailsConfig("coding", 240);
    replaceGatewayClient({ request: vi.fn() } as unknown as GatewayBrowserClient);
    await waitForFast(() => {
      expect(page.querySelector<HTMLInputElement>('input[value="coding"]')?.checked).toBe(true);
      expect(page.querySelector<HTMLSelectElement>(".workbench-profile-picker select")?.value).toBe(
        "240",
      );
    });
  });

  it("locks guided safety controls while a foundation apply is running", async () => {
    const { context } = createWorkbenchContext({
      guardrailsConfig: { profile: "research-only", approvalTtlMinutes: 60 },
    });
    const page = await mountWorkbench(context);

    clickButton(page, ".workbench-view-nav button", 1);
    await page.updateComplete;
    clickButton(page, ".workbench-stepper button", 3);
    await waitForFast(() =>
      expect(page.querySelector<HTMLInputElement>('input[value="research-only"]')?.disabled).toBe(
        false,
      ),
    );

    Object.assign(page, {
      foundationOperation: { phase: "running", message: "Applying foundation" },
    });
    await page.updateComplete;

    const pickerControls = page.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >(
      ".workbench-profile-picker input, .workbench-profile-picker select, .workbench-profile-picker button",
    );
    expect(pickerControls.length).toBeGreaterThan(0);
    expect([...pickerControls].every((control) => control.disabled)).toBe(true);

    page
      .querySelector<HTMLInputElement>('input[value="high-autonomy"]')
      ?.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await page.updateComplete;
    expect(page.querySelector<HTMLInputElement>('input[value="research-only"]')?.checked).toBe(
      true,
    );
  });

  it("does not count a retained channel snapshot after the latest check failed", async () => {
    const { context } = createWorkbenchContext({ channelError: "probe timed out" });
    const page = await mountWorkbench(context);

    expect(page.textContent).toContain(
      "The latest channel check failed. Open Channels for diagnostic details.",
    );
    const channelCard = [...page.querySelectorAll(".workbench-health-card")].find((card) =>
      card.textContent?.includes("Channel delivery"),
    );
    expect(channelCard?.classList.contains("is-attention")).toBe(true);
  });

  it("does not trust a retained channel snapshot from a different Gateway client", async () => {
    const { context } = createWorkbenchContext();
    Object.assign(context.channels.state, {
      client: { request: vi.fn() } as unknown as GatewayBrowserClient,
    });
    const page = await mountWorkbench(context);

    expect(page.textContent).toContain(
      "Channel status has not been confirmed on this Gateway yet.",
    );
  });

  it("does not bless channel evidence retained across a Gateway client replacement", async () => {
    const originalClient = {
      request: vi.fn(async () => ({
        ts: 1,
        channelOrder: ["telegram"],
        channelLabels: { telegram: "Telegram" },
        channels: { telegram: { configured: true } },
        channelAccounts: { telegram: [] },
        channelDefaultAccountId: { telegram: "default" },
      })),
    };
    let channelGatewaySnapshot = { client: originalClient, phase: "connected" };
    const channelGatewayListeners = new Set<(snapshot: typeof channelGatewaySnapshot) => void>();
    const channels = createChannelCapability({
      get snapshot() {
        return channelGatewaySnapshot;
      },
      subscribe(listener: (snapshot: typeof channelGatewaySnapshot) => void) {
        channelGatewayListeners.add(listener);
        return () => channelGatewayListeners.delete(listener);
      },
    } as never);
    await channels.refresh();
    expect(channels.state.channelsSnapshot).not.toBeNull();
    expect(channels.state.channelsLastSuccess).not.toBeNull();

    const replacementClient = { request: vi.fn() } as unknown as GatewayBrowserClient;
    channelGatewaySnapshot = { client: replacementClient as never, phase: "connected" };
    for (const listener of channelGatewayListeners) {
      listener(channelGatewaySnapshot);
    }

    expect(channels.state.client).toBe(replacementClient);
    expect(channels.state.channelsSnapshot).toBeNull();
    expect(channels.state.channelsLastSuccess).toBeNull();

    const { context } = createWorkbenchContext();
    Object.assign(context.gateway.snapshot, { client: replacementClient });
    Object.assign(context.channels, {
      state: channels.state,
      refresh: channels.refresh,
      subscribe: channels.subscribe,
    });
    const page = await mountWorkbench(context);

    expect(page.textContent).toContain(
      "Channel status has not been confirmed on this Gateway yet.",
    );
    channels.dispose();
  });

  it("ignores an in-flight mission result after the Gateway client changes", async () => {
    let resolveMission: ((value: unknown) => void) | undefined;
    const missionResponse = new Promise<unknown>((resolve) => {
      resolveMission = resolve;
    });
    const { context, replaceGatewayClient, request } = createWorkbenchContext({
      methods: ["workboard.cards.create"],
      workboardEnabled: true,
      request: async (method) => {
        if (method === "workboard.cards.create") {
          return await missionResponse;
        }
        throw new Error(`Unexpected method ${method}`);
      },
    });
    const page = await mountWorkbench(context);

    clickButton(page, ".workbench-view-nav button", 3);
    await page.updateComplete;
    const title = page.querySelector<HTMLInputElement>(".workbench-mission-form input");
    expect(title).toBeInstanceOf(HTMLInputElement);
    setInputValue(title!, "Ship on the original Gateway");
    await page.updateComplete;
    clickButton(page, ".workbench-mission-form .btn.primary");
    await waitForFast(() =>
      expect(request).toHaveBeenCalledWith(
        "workboard.cards.create",
        expect.objectContaining({ title: "Ship on the original Gateway" }),
      ),
    );

    replaceGatewayClient({ request: vi.fn() } as unknown as GatewayBrowserClient);
    await page.updateComplete;
    resolveMission?.({ card: { id: "old-card", title: "Ship on the original Gateway" } });
    await Promise.resolve();
    await page.updateComplete;

    expect(page.textContent).not.toContain(
      "Mission created. Open Workboard to review or dispatch it.",
    );
    expect(page.textContent).not.toContain("old-card");
  });

  it("clears a completed mission and its Gateway-specific agent after reconnect", async () => {
    const { context, replaceGatewayClient } = createWorkbenchContext({
      methods: ["workboard.cards.create"],
      workboardEnabled: true,
      request: async (method) => {
        if (method === "workboard.cards.create") {
          return { card: { id: "card-42", title: "Ship before reconnect" } };
        }
        throw new Error(`Unexpected method ${method}`);
      },
    });
    const page = await mountWorkbench(context);

    clickButton(page, ".workbench-view-nav button", 3);
    await page.updateComplete;
    const title = page.querySelector<HTMLInputElement>(".workbench-mission-form input");
    const agent = page.querySelector<HTMLSelectElement>(".workbench-mission-form select");
    expect(title).toBeInstanceOf(HTMLInputElement);
    expect(agent).toBeInstanceOf(HTMLSelectElement);
    setInputValue(title!, "Ship before reconnect");
    agent!.value = "main";
    agent!.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await page.updateComplete;
    clickButton(page, ".workbench-mission-form .btn.primary");
    await waitForFast(() => expect(page.textContent).toContain("card-42"));

    replaceGatewayClient({ request: vi.fn() } as unknown as GatewayBrowserClient);
    await page.updateComplete;

    expect(page.textContent).not.toContain("card-42");
    expect(page.textContent).not.toContain(
      "Mission created. Open Workboard to review or dispatch it.",
    );
    expect(page.querySelector<HTMLSelectElement>(".workbench-mission-form select")?.value).toBe("");
  });
});
