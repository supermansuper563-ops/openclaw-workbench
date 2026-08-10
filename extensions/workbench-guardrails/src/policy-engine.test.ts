import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  enforceDecisionFloor,
  evaluateAction,
  evaluateRules,
  targetsMatchPrefix,
} from "./policy-engine.js";
import type { ActionEffect, ToolAction } from "./types.js";

const action = (effect: ActionEffect): ToolAction => ({
  tool: "test-tool",
  effect,
  summary: "A test action",
});

describe("Workbench Guardrails policy engine", () => {
  it("keeps research-only read-only and blocks unknown actions", () => {
    expect(evaluateAction("research-only", action("read")).outcome).toBe("allow");
    for (const effect of ["write", "execute", "send", "publish", "delete"] as const) {
      expect(evaluateAction("research-only", action(effect)).outcome).toBe("block");
    }
    expect(evaluateAction("research-only", action("unknown"))).toEqual({
      outcome: "block",
      reason: "research-only blocks unclassified tool actions",
    });
  });

  it("asks before unknown and external side-effect actions", () => {
    expect(evaluateAction("personal-safe", action("unknown")).outcome).toBe("ask");
    expect(evaluateAction("personal-safe", action("send")).outcome).toBe("ask");
    expect(evaluateAction("high-autonomy", action("delete")).outcome).toBe("ask");
    expect(evaluateAction("high-autonomy", action("publish")).outcome).toBe("ask");
  });

  it("honors the first matching operator rule", () => {
    const decision = evaluateRules(
      [
        { outcome: "allow", tools: ["apply_patch"], targetPrefix: "C:\\workspace" },
        { outcome: "block", tools: ["apply_patch"] },
      ],
      {
        ...action("write"),
        tool: "apply_patch",
        targets: ["C:\\workspace\\notes.md"],
      },
    );
    expect(decision).toEqual({
      outcome: "allow",
      reason: "matched a configured Workbench Guardrails rule",
    });
  });

  it("requires every target to be an absolute path contained by the configured prefix", () => {
    expect(
      targetsMatchPrefix(["C:\\workspace\\notes.md", "c:/workspace/src/index.ts"], "C:\\workspace"),
    ).toBe(true);
    expect(
      targetsMatchPrefix(["/workspace/notes.md", "/workspace/src/index.ts"], "/workspace"),
    ).toBe(true);
    expect(
      targetsMatchPrefix(["C:\\workspace\\notes.md", "D:\\outside.txt"], "C:\\workspace"),
    ).toBe(false);
    expect(
      targetsMatchPrefix(["C:\\workspace\\notes.md", "/workspace/notes.md"], "C:\\workspace"),
    ).toBe(false);
    expect(targetsMatchPrefix(["C:\\workspace2\\notes.md"], "C:\\workspace")).toBe(false);
    expect(targetsMatchPrefix(["C:\\workspace\\..\\victim.txt"], "C:\\workspace")).toBe(false);
    expect(targetsMatchPrefix(["relative\\notes.md"], "C:\\workspace")).toBe(false);
    expect(targetsMatchPrefix(["//server/share/notes.md"], "//server/share")).toBe(false);
    expect(
      targetsMatchPrefix(
        ["\\\\server\\share\\workspace\\notes.md"],
        "\\\\server\\share\\workspace",
      ),
    ).toBe(true);
    expect(
      targetsMatchPrefix(
        ["\\\\server\\other\\workspace\\notes.md"],
        "\\\\server\\share\\workspace",
      ),
    ).toBe(false);
    expect(
      targetsMatchPrefix(["\\\\server\\share\\notes.md"], "\\\\server\\share\\workspace\\.."),
    ).toBe(false);
    expect(targetsMatchPrefix([], "C:\\workspace")).toBe(false);
    expect(targetsMatchPrefix(undefined, "C:\\workspace")).toBe(false);
  });

  it("does not treat an empty or whitespace target prefix as a global rule", () => {
    const toolAction: ToolAction = {
      ...action("write"),
      targets: ["/workspace/notes.md"],
    };
    expect(evaluateRules([{ outcome: "allow", targetPrefix: "" }], toolAction)).toBeUndefined();
    expect(evaluateRules([{ outcome: "allow", targetPrefix: "   " }], toolAction)).toBeUndefined();
  });

  it("rejects a target whose existing symlink ancestor escapes the prefix", () => {
    if (process.platform === "win32") {
      return;
    }
    const root = mkdtempSync(path.join(tmpdir(), "workbench-guardrails-"));
    try {
      const allowed = path.join(root, "allowed");
      const outside = path.join(root, "outside");
      mkdirSync(allowed);
      mkdirSync(outside);
      writeFileSync(path.join(outside, "secret.txt"), "private");
      symlinkSync(outside, path.join(allowed, "escape"), "dir");

      expect(targetsMatchPrefix([path.join(allowed, "escape", "secret.txt")], allowed)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("does not let configured allow rules bypass mandatory decisions", () => {
    for (const effect of ["unknown", "delete", "publish"] as const) {
      const toolAction = action(effect);
      const configured = evaluateRules([{ outcome: "allow", effects: [effect] }], toolAction);
      expect(configured).toBeDefined();
      expect(
        enforceDecisionFloor(
          "personal-safe",
          toolAction,
          configured ?? { outcome: "allow", reason: "test" },
        ).outcome,
      ).toBe("ask");
    }

    for (const effect of ["write", "execute", "send", "delete", "publish", "unknown"] as const) {
      const toolAction = action(effect);
      const configured = evaluateRules([{ outcome: "allow", effects: [effect] }], toolAction);
      expect(
        enforceDecisionFloor(
          "research-only",
          toolAction,
          configured ?? { outcome: "allow", reason: "test" },
        ).outcome,
      ).toBe("block");
    }
  });
});
