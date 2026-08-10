// Control UI E2E tests prove the Workbench route against a deterministic Gateway.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canRunPlaywrightChromium,
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
  waitForControlUiRoute,
  type ControlUiE2eServer,
} from "../../test-helpers/control-ui-e2e.ts";

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const allowMissingChromium = process.env.OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM === "1";
const describeControlUiE2e = chromiumAvailable || !allowMissingChromium ? describe : describe.skip;
const artifactDir = path.resolve(process.cwd(), ".artifacts/control-ui-e2e/workbench");

let browser: Browser;
let server: ControlUiE2eServer;

function configSnapshot() {
  const config = {
    agents: { defaults: { model: "openai/gpt-5.6-luna" } },
    plugins: {
      entries: {
        "workbench-guardrails": {
          enabled: true,
          config: { approvalTtlMinutes: 30, profile: "coding" },
        },
        workboard: { enabled: true },
      },
    },
  };
  return {
    config,
    hash: "workbench-e2e-config",
    issues: [],
    path: "/tmp/openclaw-e2e/openclaw.json",
    raw: JSON.stringify(config),
    resolved: config,
    sourceConfig: config,
    valid: true,
  };
}

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: path.join(artifactDir, name),
  });
}

describeControlUiE2e("Control UI Workbench", () => {
  beforeAll(async () => {
    if (!chromiumAvailable) {
      throw new Error(`Playwright Chromium is not available at ${chromiumExecutablePath}`);
    }
    await rm(artifactDir, { force: true, recursive: true });
    await mkdir(artifactDir, { recursive: true });
    server = await startControlUiE2eServer();
    browser = await chromium.launch({ executablePath: chromiumExecutablePath });
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("verifies setup evidence, shows safety state, and creates a durable mission", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 1000, width: 1600 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const gateway = await installMockGateway(page, {
      agentModel: "openai/gpt-5.6-luna",
      assistantName: "Main agent",
      featureMethods: [
        "agents.list",
        "channels.status",
        "config.apply",
        "config.get",
        "config.set",
        "openclaw.setup.verify",
        "plugins.setEnabled",
        "workbench.guardrails.journal.clear",
        "workbench.guardrails.journal.list",
        "workbench.guardrails.status",
        "workboard.cards.create",
      ],
      methodResponses: {
        "agents.list": {
          agents: [
            { id: "main", name: "Main agent" },
            { id: "writer", name: "Writer" },
          ],
          defaultId: "main",
          mainKey: "main",
          scope: "agent",
        },
        "channels.status": {
          ts: 1,
          channelOrder: ["discord"],
          channelLabels: { discord: "Discord" },
          channels: {},
          channelAccounts: {
            discord: [
              {
                accountId: "default",
                configured: true,
                connected: true,
                enabled: true,
                running: true,
              },
            ],
          },
          channelDefaultAccountId: { discord: "default" },
        },
        "config.get": configSnapshot(),
        "openclaw.setup.verify": {
          latencyMs: 84,
          modelRef: "openai/gpt-5.6-luna",
          ok: true,
        },
        "workbench.guardrails.status": {
          active: true,
          journalCount: 1,
          policyId: "workbench-guardrails",
          profile: "coding",
        },
        "workbench.guardrails.journal.list": {
          events: [
            {
              at: "2026-08-09T15:00:00.000Z",
              details: {
                action: {
                  effect: "read",
                  targets: ["https://example.test/reference"],
                  tool: "browser.open",
                },
                decision: { outcome: "allow" },
              },
              taskId: "journal-1",
              type: "decision",
            },
          ],
          journalCount: 1,
        },
        "workboard.cards.create": {
          card: { id: "mission-42", title: "Ship the Workbench demo" },
        },
      },
    });

    try {
      const response = await page.goto(`${server.baseUrl}workbench`);
      expect(response?.status()).toBe(200);
      await waitForControlUiRoute(page, { pathname: "/workbench", routeId: "workbench" });
      await page
        .getByRole("heading", {
          name: "Make OpenClaw useful in a few deliberate steps.",
        })
        .waitFor();
      await expect
        .poll(() => page.locator(".workbench-readiness__ring").textContent())
        .toContain("75%");
      await capture(page, "01-overview.png");

      await page.getByRole("button", { exact: true, name: "Guided setup" }).click();
      await page
        .getByRole("heading", { name: "Set up the parts that make work possible." })
        .waitFor();
      await page.locator(".workbench-stepper").getByRole("button", { name: "Model" }).click();
      await page.getByRole("button", { exact: true, name: "Verify model" }).click();
      await page.getByText("openai/gpt-5.6-luna answered in 84 ms.").waitFor();
      await capture(page, "02-model-verified.png");

      await page
        .locator(".workbench-view-nav")
        .getByRole("button", { exact: true, name: "Safety" })
        .click();
      await page.getByRole("heading", { name: "Guardrails health" }).waitFor();
      await page.getByText("Tool: browser.open").waitFor();
      await page.getByText("Read · https://example.test/reference").waitFor();
      await page.getByText("Allowed", { exact: true }).waitFor();
      await capture(page, "03-safety-journal.png");

      await page
        .locator(".workbench-view-nav")
        .getByRole("button", { exact: true, name: "New mission" })
        .click();
      await page.getByLabel("Mission outcome").fill("Ship the Workbench demo");
      await page
        .getByLabel("Context and acceptance criteria")
        .fill("Run the acceptance suite and attach the evidence.");
      await page.getByLabel("Initial owner").selectOption("writer");
      await page.getByLabel("Priority").selectOption("high");
      await page.getByRole("button", { exact: true, name: "Create mission" }).click();

      const request = await gateway.waitForRequest("workboard.cards.create");
      expect(request.params).toEqual({
        agentId: "writer",
        labels: ["workbench"],
        notes: "Run the acceptance suite and attach the evidence.",
        priority: "high",
        status: "todo",
        title: "Ship the Workbench demo",
      });
      await page.getByText("Mission saved").waitFor();
      await page.getByText("mission-42").waitFor();
      await capture(page, "04-mission-created.png");
    } finally {
      await context.close();
    }
  });
});
