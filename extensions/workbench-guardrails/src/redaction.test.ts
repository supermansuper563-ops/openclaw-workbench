import { describe, expect, it } from "vitest";
import {
  redactJournalValue,
  sanitizeDisplayTargets,
  sanitizeJournalText,
  summarizeToolAction,
} from "./redaction.js";

describe("Workbench Guardrails journal redaction", () => {
  it("redacts nested secrets without discarding safe audit context", () => {
    expect(
      redactJournalValue({
        tool: "webhook",
        authorization: "Bearer private",
        request: {
          apiKey: "private",
          target: "https://example.test/hook",
          headers: [{ cookie: "private" }, { accept: "application/json" }],
        },
      }),
    ).toEqual({
      tool: "webhook",
      authorization: "[REDACTED]",
      request: {
        apiKey: "[REDACTED]",
        target: "https://example.test/hook",
        headers: [{ cookie: "[REDACTED]" }, { accept: "application/json" }],
      },
    });
  });

  it("redacts credential-shaped values even when their field name looks safe", () => {
    const token = `sk-${"a".repeat(32)}`;
    const jwt = `${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`;
    expect(
      redactJournalValue({
        note: "Bearer private-value",
        opaque: token,
        jwt,
        url: "https://example.test/?token=private&view=safe",
      }),
    ).toEqual({
      note: "Bearer [REDACTED]",
      opaque: "[REDACTED]",
      jwt: "[REDACTED]",
      url: "https://example.test/?token=[REDACTED]&view=safe",
    });
  });

  it("aliases home paths, strips controls, and bounds display targets", () => {
    expect(sanitizeJournalText("C:\\Users\\alice\\private\u0000\nnotes.txt")).toBe(
      "~\\private notes.txt",
    );
    expect(sanitizeJournalText("C:\\Users\\Alice Smith\\private\\notes.txt")).toBe(
      "~\\private\\notes.txt",
    );
    const rawTargets = Array.from(
      { length: 8 },
      (_, index) => `C:\\Users\\alice\\project\\${"x".repeat(180)}-${index}`,
    );
    const targets = sanitizeDisplayTargets(rawTargets);
    expect(targets).toHaveLength(6);
    expect(targets.at(-1)).toBe("… +3 more");
    expect(targets.slice(0, 5).every((target) => !target.includes("alice"))).toBe(true);
    expect(targets.slice(0, 5).every((target) => target.length <= 140)).toBe(true);

    const summary = summarizeToolAction("write", "apply_patch", rawTargets);
    expect(summary.length).toBeLessThanOrEqual(360);
    expect(summary).toContain("… +3 more)");
  });

  it("bounds recursive data and replaces circular references", () => {
    const circular: Record<string, unknown> = { safe: "context" };
    circular.self = circular;
    expect(redactJournalValue(circular)).toEqual({ safe: "context", self: "[CIRCULAR]" });
    expect(redactJournalValue(Array.from({ length: 101 }, (_, index) => index))).toHaveLength(101);
  });
});
