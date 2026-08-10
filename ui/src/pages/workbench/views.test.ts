/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderWorkbenchProfilePicker } from "./profile-picker.ts";
import { journalEventPresentation } from "./safety-view.ts";

describe("Workbench view helpers", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("preserves a valid custom approval lifetime in the native select", () => {
    const root = document.createElement("div");
    document.body.append(root);
    render(
      renderWorkbenchProfilePicker({
        profile: "coding",
        approvalTtlMinutes: 37,
        disabled: false,
        operation: { phase: "idle" },
        compact: true,
        onProfileChange: vi.fn(),
        onTtlChange: vi.fn(),
        onApply: vi.fn(),
      }),
      root,
    );

    const select = root.querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe("37");
    expect(select?.selectedOptions.item(0)?.textContent).toContain("Custom · 37 minutes");
    expect(root.querySelector(".workbench-profile-picker")?.classList.contains("is-compact")).toBe(
      true,
    );
  });

  it("localizes known journal enums and hides unknown internal tokens", () => {
    const known = journalEventPresentation({
      at: "2026-08-09T15:00:00.000Z",
      type: "decision",
      taskId: "known",
      details: {
        action: { effect: "read", targets: ["https://example.test/reference"] },
        decision: { outcome: "allow" },
      },
    });
    expect(known.detail).toBe("Read · https://example.test/reference");
    expect(known.outcome).toBe("Allowed");

    const unknown = journalEventPresentation({
      at: "2026-08-09T15:00:00.000Z",
      type: "decision",
      taskId: "unknown",
      details: {
        action: { effect: "private-effect" },
        decision: { outcome: "private-outcome" },
      },
    });
    expect(unknown.detail).toBe("Unclassified");
    expect(unknown.outcome).toBe("Unknown");
    expect(`${unknown.detail} ${unknown.outcome}`).not.toContain("private-");
  });
});
