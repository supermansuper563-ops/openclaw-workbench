import { randomUUID } from "node:crypto";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerGuardrailsGatewayMethods } from "./src/gateway-methods.js";
import { createGuardrailsRuntime } from "./src/trusted-tool-policy.js";
import type { JournalEvent } from "./src/types.js";

export default definePluginEntry({
  id: "workbench-guardrails",
  name: "Workbench Guardrails",
  description: "Safety profiles, native approvals, and redacted execution journaling",
  register(api) {
    const journalStore = api.runtime.state.openKeyedStore<JournalEvent>({
      namespace: "execution-journal",
      maxEntries: 5_000,
    });
    const runtime = createGuardrailsRuntime(api.pluginConfig, {
      append: (event) => journalStore.register(`${event.at}:${randomUUID()}`, event),
    });
    api.registerTrustedToolPolicy(runtime.policy);
    api.registerAgentToolResultMiddleware(runtime.recordToolResult, {
      runtimes: ["openclaw", "codex"],
    });
    registerGuardrailsGatewayMethods(api, journalStore, runtime.profile);
  },
});
