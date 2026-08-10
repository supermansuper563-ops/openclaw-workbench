// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ChannelsStatusSnapshot } from "../../api/types.ts";
import {
  countReadyEssentials,
  isWorkbenchGuardrailsActive,
  isWorkbenchGuardrailsEnabled,
  isWorkbenchModelConfigured,
  isWorkbenchModelVerified,
  readWorkbenchApprovalTtlMinutes,
  readWorkbenchGuardrailsProfile,
  resolveWorkbenchChannelHealth,
} from "./readiness.ts";

describe("Workbench readiness", () => {
  it("detects only an explicitly enabled bundled Guardrails entry", () => {
    expect(
      isWorkbenchGuardrailsEnabled({
        plugins: { entries: { "workbench-guardrails": { enabled: true } } },
      }),
    ).toBe(true);
    expect(
      isWorkbenchGuardrailsEnabled({
        plugins: { entries: { "workbench-guardrails": { enabled: false } } },
      }),
    ).toBe(false);
    expect(isWorkbenchGuardrailsEnabled({ plugins: {} })).toBe(false);
  });

  it("counts each completed essential once", () => {
    expect(
      countReadyEssentials({
        connected: true,
        agentConfigured: true,
        channelConfigured: false,
        guardrailsEnabled: true,
      }),
    ).toBe(3);
  });

  it("requires an explicit default or per-agent model reference", () => {
    expect(
      isWorkbenchModelConfigured({ agents: { defaults: { model: "openai/gpt-5.6-luna" } } }),
    ).toBe(true);
    expect(
      isWorkbenchModelConfigured({
        agents: { entries: { writer: { model: { primary: "anthropic/claude-sonnet-4-6" } } } },
      }),
    ).toBe(true);
    expect(
      isWorkbenchModelConfigured({ agents: { list: [{ id: "main", model: "google/gemini-3" }] } }),
    ).toBe(true);
    expect(isWorkbenchModelConfigured({ agents: { defaults: {}, list: [{ id: "main" }] } })).toBe(
      false,
    );
  });

  it("does not treat a merely configured channel as live", () => {
    const snapshot: ChannelsStatusSnapshot = {
      ts: 1,
      channelOrder: ["telegram", "discord", "slack"],
      channelLabels: {
        telegram: "Telegram",
        discord: "Discord",
        slack: "Slack",
      },
      channels: {
        telegram: { configured: true, running: false, connected: false },
        discord: { configured: true, running: true, connected: false },
      },
      channelAccounts: {
        telegram: [],
        discord: [],
        slack: [
          {
            accountId: "primary",
            configured: true,
            running: true,
            connected: true,
          },
        ],
      },
      channelDefaultAccountId: {
        telegram: "default",
        discord: "default",
        slack: "primary",
      },
    };

    expect(resolveWorkbenchChannelHealth(snapshot)).toEqual({
      configured: 3,
      running: 2,
      connected: 1,
      total: 3,
    });
    expect(resolveWorkbenchChannelHealth(null)).toEqual({
      configured: 0,
      running: 0,
      connected: 0,
      total: 0,
    });
  });

  it("requires live checks before calling models or Guardrails ready", () => {
    expect(isWorkbenchModelVerified({ phase: "idle" })).toBe(false);
    expect(isWorkbenchModelVerified({ phase: "attention", detail: "no reply", checkedAt: 1 })).toBe(
      false,
    );
    expect(isWorkbenchModelVerified({ phase: "ready", detail: "replied", checkedAt: 1 })).toBe(
      true,
    );

    expect(isWorkbenchGuardrailsActive({ phase: "idle" })).toBe(false);
    expect(
      isWorkbenchGuardrailsActive({ phase: "inactive", detail: "not registered", checkedAt: 1 }),
    ).toBe(false);
    expect(
      isWorkbenchGuardrailsActive({
        phase: "active",
        profile: "coding",
        journalCount: 2,
        checkedAt: 1,
      }),
    ).toBe(true);
  });

  it("reads valid Guardrails settings and falls back for invalid values", () => {
    const config = {
      plugins: {
        entries: {
          "workbench-guardrails": {
            enabled: true,
            config: { profile: "research-only", approvalTtlMinutes: 37.9 },
          },
        },
      },
    };

    expect(readWorkbenchGuardrailsProfile(config)).toBe("research-only");
    expect(readWorkbenchApprovalTtlMinutes(config)).toBe(37);
    expect(
      readWorkbenchGuardrailsProfile({
        plugins: { entries: { "workbench-guardrails": { config: { profile: "unsafe" } } } },
      }),
    ).toBe("personal-safe");
    expect(
      readWorkbenchApprovalTtlMinutes({
        plugins: {
          entries: { "workbench-guardrails": { config: { approvalTtlMinutes: 20_000 } } },
        },
      }),
    ).toBe(60);
  });
});
