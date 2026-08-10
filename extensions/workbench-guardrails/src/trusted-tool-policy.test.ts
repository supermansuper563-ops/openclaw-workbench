import { describe, expect, it, vi } from "vitest";
import { classifyToolActionEffect, createGuardrailsRuntime } from "./trusted-tool-policy.js";
import type { JournalEvent } from "./types.js";

const context = { toolName: "exec", runId: "run-1" };

describe("Workbench Guardrails trusted tool policy", () => {
  it("uses native approvals for shell execution", async () => {
    const append = vi.fn();
    const runtime = createGuardrailsRuntime({ profile: "personal-safe" }, { append });
    const result = await runtime.policy.evaluate(
      { toolName: "exec", params: {}, runId: "run-1" },
      context,
    );
    expect(result).toMatchObject({
      requireApproval: {
        title: "Approve unclassified action",
        allowedDecisions: ["allow-once", "deny"],
        severity: "critical",
      },
    });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ type: "decision" }));
  });

  it("classifies known tool families from their action instead of their neutral name", () => {
    expect(classifyToolActionEffect({ toolName: "browser", params: { action: "tabs" } })).toBe(
      "read",
    );
    expect(classifyToolActionEffect({ toolName: "browser", params: { action: "act" } })).toBe(
      "unknown",
    );
    expect(
      classifyToolActionEffect({ toolName: "computer", params: { action: "left_click" } }),
    ).toBe("unknown");
    expect(classifyToolActionEffect({ toolName: "cron", params: { action: "list" } })).toBe("read");
    expect(classifyToolActionEffect({ toolName: "cron", params: { action: "add" } })).toBe("write");
    expect(classifyToolActionEffect({ toolName: "nodes", params: { action: "notify" } })).toBe(
      "send",
    );
    expect(classifyToolActionEffect({ toolName: "nodes", params: { action: "approve" } })).toBe(
      "unknown",
    );
    expect(classifyToolActionEffect({ toolName: "nodes", params: { action: "invoke" } })).toBe(
      "unknown",
    );
    expect(
      classifyToolActionEffect({ toolName: "sessions", params: { action: "group_list" } }),
    ).toBe("read");
    expect(classifyToolActionEffect({ toolName: "sessions", params: { action: "delete" } })).toBe(
      "delete",
    );
    expect(classifyToolActionEffect({ toolName: "dashboard", params: { action: "read" } })).toBe(
      "read",
    );
    expect(
      classifyToolActionEffect({ toolName: "dashboard", params: { action: "tab_delete" } }),
    ).toBe("delete");
    expect(
      classifyToolActionEffect({ toolName: "gateway", params: { action: "config.get" } }),
    ).toBe("read");
    expect(classifyToolActionEffect({ toolName: "mobile_ui", params: { action: "act" } })).toBe(
      "unknown",
    );
    expect(
      classifyToolActionEffect({ toolName: "skill_workshop", params: { action: "create" } }),
    ).toBe("write");
    expect(
      classifyToolActionEffect({ toolName: "transcripts", params: { action: "summarize" } }),
    ).toBe("execute");
    expect(
      classifyToolActionEffect({
        toolName: "nodes",
        params: { action: "notifications_action", notificationAction: "reply" },
      }),
    ).toBe("send");
  });

  it("treats code-mode execution as unclassified regardless of the displayed tool name", () => {
    expect(
      classifyToolActionEffect({
        toolName: "neutral-helper",
        params: {},
        toolKind: "code_mode_exec",
      }),
    ).toBe("unknown");
  });

  it("fails closed for unknown and incomplete tool actions", async () => {
    for (const event of [
      { toolName: "mcp__untrusted__lookup", params: {} },
      { toolName: "browser", params: {} },
      { toolName: "computer", params: { action: "click" } },
      { toolName: "cron", params: { action: "create" } },
      { toolName: "nodes", params: {} },
    ]) {
      const runtime = createGuardrailsRuntime({ profile: "personal-safe" }, { append: vi.fn() });
      const result = await runtime.policy.evaluate({ ...event, runId: "run-1" }, context);
      expect(result).toMatchObject({
        requireApproval: {
          title: "Approve unclassified action",
          severity: "critical",
        },
      });
    }
  });

  it("blocks unknown and side-effect actions in research-only mode", async () => {
    for (const event of [
      { toolName: "mcp__untrusted__lookup", params: {} },
      { toolName: "browser", params: {} },
      { toolName: "computer", params: { action: "left_click" } },
      { toolName: "cron", params: { action: "add" } },
      { toolName: "nodes", params: { action: "notify" } },
      { toolName: "sessions_spawn", params: {} },
      { toolName: "delete", params: {} },
      { toolName: "publish", params: {} },
    ]) {
      const runtime = createGuardrailsRuntime({ profile: "research-only" }, { append: vi.fn() });
      const result = await runtime.policy.evaluate({ ...event, runId: "run-1" }, context);
      expect(result).toMatchObject({ block: true });
    }
  });

  it("continues to allow recognized reads in research-only mode", async () => {
    for (const event of [
      { toolName: "web_search", params: { query: "OpenClaw" } },
      { toolName: "browser", params: { action: "tabs" } },
      { toolName: "computer", params: { action: "screenshot" } },
      { toolName: "cron", params: { action: "list" } },
      { toolName: "nodes", params: { action: "status" } },
      { toolName: "sessions", params: { action: "group_list" } },
    ]) {
      const runtime = createGuardrailsRuntime({ profile: "research-only" }, { append: vi.fn() });
      await expect(
        runtime.policy.evaluate({ ...event, runId: "run-1" }, context),
      ).resolves.toBeUndefined();
    }
  });

  it("does not infer read access from an HTTP-looking parameter on an unknown tool", () => {
    expect(
      classifyToolActionEffect({ toolName: "mcp__untrusted__request", params: { method: "GET" } }),
    ).toBe("unknown");
    expect(classifyToolActionEffect({ toolName: "http_request", params: { method: "GET" } })).toBe(
      "read",
    );
    expect(classifyToolActionEffect({ toolName: "http_request", params: { method: "POST" } })).toBe(
      "unknown",
    );
    expect(
      classifyToolActionEffect({ toolName: "http_request", params: { method: "DELETE" } }),
    ).toBe("delete");
  });

  it("keeps arbitrary-capability tools behind the high-autonomy approval floor", async () => {
    for (const event of [
      { toolName: "shell_command", params: { command: "git push origin main" } },
      { toolName: "exec", params: { command: "rm -rf build" } },
      { toolName: "browser", params: { action: "act" } },
      { toolName: "computer", params: { action: "left_click" } },
      { toolName: "mobile_ui", params: { action: "act" } },
      { toolName: "http_request", params: { method: "POST" } },
      { toolName: "nodes", params: { action: "approve" } },
      { toolName: "nodes", params: { action: "invoke", invokeCommand: "custom.command" } },
    ]) {
      const runtime = createGuardrailsRuntime(
        { profile: "high-autonomy", rules: [{ outcome: "allow", tools: [event.toolName] }] },
        { append: vi.fn() },
      );
      const result = await runtime.policy.evaluate({ ...event, runId: "run-1" }, context);
      expect(result).toMatchObject({
        requireApproval: { severity: "critical", title: "Approve unclassified action" },
      });
    }
  });

  it("recognizes explicit destructive operations before custom rules", async () => {
    const movePatch = [
      "*** Begin Patch",
      "*** Update File: notes.txt",
      "*** Move to: archive/notes.txt",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n");
    expect(
      classifyToolActionEffect({
        toolName: "apply_patch",
        params: { patch: "*** Begin Patch\n*** Delete File: notes.txt\n*** End Patch" },
      }),
    ).toBe("delete");
    expect(
      classifyToolActionEffect({ toolName: "apply_patch", params: { input: movePatch } }),
    ).toBe("delete");
    expect(classifyToolActionEffect({ toolName: "process", params: { action: "kill" } })).toBe(
      "delete",
    );

    const runtime = createGuardrailsRuntime(
      { profile: "high-autonomy", rules: [{ outcome: "allow", tools: ["apply_patch"] }] },
      { append: vi.fn() },
    );
    const result = await runtime.policy.evaluate(
      {
        toolName: "apply_patch",
        params: { input: movePatch },
        runId: "run-1",
      },
      context,
    );
    expect(result).toMatchObject({
      requireApproval: { severity: "critical", title: "Approve delete action" },
    });
  });

  it("does not let custom allow rules bypass unknown, delete, or publish approvals", async () => {
    for (const event of [
      { toolName: "mcp__untrusted__lookup", params: {} },
      { toolName: "delete", params: {} },
      { toolName: "publish", params: {} },
    ]) {
      const runtime = createGuardrailsRuntime(
        { profile: "high-autonomy", rules: [{ outcome: "allow", tools: [event.toolName] }] },
        { append: vi.fn() },
      );
      const result = await runtime.policy.evaluate({ ...event, runId: "run-1" }, context);
      expect(result).toMatchObject({ requireApproval: { severity: "critical" } });
    }
  });

  it("only applies a target allow rule when every derived path is safely contained", async () => {
    const config = {
      profile: "personal-safe",
      rules: [
        {
          outcome: "allow",
          tools: ["apply_patch"],
          targetPrefix: "C:\\workspace",
        },
      ],
    };
    const safeRuntime = createGuardrailsRuntime(config, { append: vi.fn() });
    await expect(
      safeRuntime.policy.evaluate(
        {
          toolName: "apply_patch",
          params: {},
          derivedPaths: ["C:\\workspace\\a.ts", "C:\\workspace\\src\\b.ts"],
          runId: "run-1",
        },
        context,
      ),
    ).resolves.toBeUndefined();

    for (const derivedPaths of [
      ["C:\\workspace\\a.ts", "D:\\outside.ts"],
      ["C:\\workspace\\..\\outside.ts"],
      ["relative\\outside.ts"],
      [],
    ]) {
      const runtime = createGuardrailsRuntime(config, { append: vi.fn() });
      const result = await runtime.policy.evaluate(
        { toolName: "apply_patch", params: {}, derivedPaths, runId: "run-1" },
        context,
      );
      expect(result).toMatchObject({ requireApproval: { title: "Approve write action" } });
    }
  });

  it("sanitizes and bounds paths before approvals and journal writes", async () => {
    const entries: JournalEvent[] = [];
    const runtime = createGuardrailsRuntime(undefined, {
      append: (event) => entries.push(event),
    });
    const rawTargets = Array.from(
      { length: 8 },
      (_, index) => `C:\\Users\\alice\\private-project\\${"x".repeat(180)}-${index}\u0000`,
    );
    const result = await runtime.policy.evaluate(
      {
        toolName: "apply_patch",
        params: {},
        derivedPaths: rawTargets,
        runId: "run-1",
      },
      context,
    );
    if (!result || !("requireApproval" in result) || !result.requireApproval) {
      throw new Error("expected apply_patch to require approval");
    }
    expect(result.requireApproval.description.length).toBeLessThanOrEqual(500);
    expect(result.requireApproval.description).not.toContain("alice");
    expect(result.requireApproval.description).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
    expect(result.requireApproval.description).toContain("+3 more");
    expect(JSON.stringify(entries)).not.toContain("alice");
    expect(JSON.stringify(entries)).not.toContain("\\u0000");
  });

  it("redacts secrets before writing approval outcomes to the journal", async () => {
    const entries: JournalEvent[] = [];
    const runtime = createGuardrailsRuntime(undefined, {
      append: (event) => entries.push(event),
    });
    const approval = await runtime.policy.evaluate(
      {
        toolName: "send_message",
        params: {},
        derivedPaths: ["https://example.test/hook?token=private-value"],
        runId: "run-1",
      },
      context,
    );
    if (!approval || !("requireApproval" in approval) || !approval.requireApproval) {
      throw new Error("expected send_message to require approval");
    }
    await approval.requireApproval.onResolution?.("deny");
    expect(JSON.stringify(entries)).not.toContain("private-value");
    expect(entries).toHaveLength(2);
  });

  it("normalizes invalid configuration to safe defaults", async () => {
    const runtime = createGuardrailsRuntime(
      {
        profile: "unlimited",
        approvalTtlMinutes: 0,
        rules: [{ outcome: "allow", effects: ["made-up"] }],
      },
      { append: vi.fn() },
    );
    const result = await runtime.policy.evaluate(
      { toolName: "exec", params: {}, runId: "run-1" },
      context,
    );
    expect(result).toMatchObject({
      requireApproval: { timeoutMs: 60 * 60_000 },
    });
  });

  it("drops empty target-prefix rules instead of applying them globally", async () => {
    for (const targetPrefix of ["", "   "]) {
      const runtime = createGuardrailsRuntime(
        {
          profile: "personal-safe",
          rules: [{ outcome: "allow", effects: ["write"], targetPrefix }],
        },
        { append: vi.fn() },
      );
      const result = await runtime.policy.evaluate(
        {
          toolName: "apply_patch",
          params: {},
          derivedPaths: ["/workspace/notes.ts"],
          runId: "run-1",
        },
        context,
      );
      expect(result).toMatchObject({ requireApproval: { title: "Approve write action" } });
    }
  });
});
