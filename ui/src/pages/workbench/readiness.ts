import { isRecord } from "@openclaw/normalization-core/record-coerce";
import type { ChannelsStatusSnapshot } from "../../api/types.ts";
import type {
  WorkbenchChannelHealth,
  WorkbenchCheckState,
  WorkbenchGuardrailsProfile,
  WorkbenchGuardrailsRuntime,
} from "./types.ts";

type WorkbenchReadiness = {
  connected: boolean;
  agentConfigured: boolean;
  channelConfigured: boolean;
  guardrailsEnabled: boolean;
};

export function isWorkbenchGuardrailsEnabled(config: unknown): boolean {
  if (!isRecord(config)) {
    return false;
  }
  const plugins = config.plugins;
  if (!isRecord(plugins) || !isRecord(plugins.entries)) {
    return false;
  }
  const entry = plugins.entries["workbench-guardrails"];
  return isRecord(entry) && entry.enabled === true;
}

export function readWorkbenchGuardrailsProfile(config: unknown): WorkbenchGuardrailsProfile {
  if (!isRecord(config) || !isRecord(config.plugins) || !isRecord(config.plugins.entries)) {
    return "personal-safe";
  }
  const entry = config.plugins.entries["workbench-guardrails"];
  const pluginConfig = isRecord(entry) && isRecord(entry.config) ? entry.config : null;
  const profile = pluginConfig?.profile;
  return profile === "coding" ||
    profile === "research-only" ||
    profile === "high-autonomy" ||
    profile === "personal-safe"
    ? profile
    : "personal-safe";
}

export function readWorkbenchApprovalTtlMinutes(config: unknown): number {
  if (!isRecord(config) || !isRecord(config.plugins) || !isRecord(config.plugins.entries)) {
    return 60;
  }
  const entry = config.plugins.entries["workbench-guardrails"];
  const pluginConfig = isRecord(entry) && isRecord(entry.config) ? entry.config : null;
  const ttl = pluginConfig?.approvalTtlMinutes;
  return typeof ttl === "number" && Number.isFinite(ttl) && ttl >= 1 && ttl <= 10_080
    ? Math.floor(ttl)
    : 60;
}

function hasConfiguredModel(model: unknown): boolean {
  if (typeof model === "string") {
    return model.trim().length > 0;
  }
  return isRecord(model) && typeof model.primary === "string" && model.primary.trim().length > 0;
}

export function isWorkbenchModelConfigured(config: unknown): boolean {
  if (!isRecord(config) || !isRecord(config.agents)) {
    return false;
  }
  const agents = config.agents;
  if (isRecord(agents.defaults) && hasConfiguredModel(agents.defaults.model)) {
    return true;
  }
  if (
    isRecord(agents.entries) &&
    Object.values(agents.entries).some(
      (entry) => isRecord(entry) && hasConfiguredModel(entry.model),
    )
  ) {
    return true;
  }
  return (
    Array.isArray(agents.list) &&
    agents.list.some((entry) => isRecord(entry) && hasConfiguredModel(entry.model))
  );
}

function channelIds(snapshot: ChannelsStatusSnapshot): Set<string> {
  return new Set([
    ...snapshot.channelOrder,
    ...Object.keys(snapshot.channels),
    ...Object.keys(snapshot.channelAccounts),
  ]);
}

function readChannelFlags(value: unknown): {
  configured: boolean;
  running: boolean;
  connected: boolean;
} {
  if (!isRecord(value)) {
    return { configured: false, running: false, connected: false };
  }
  return {
    configured: value.configured === true,
    running: value.running === true,
    connected: value.connected === true,
  };
}

/** Distinguishes configured transports from transports that are actually live. */
export function resolveWorkbenchChannelHealth(
  snapshot: ChannelsStatusSnapshot | null | undefined,
): WorkbenchChannelHealth {
  if (!snapshot) {
    return { configured: 0, running: 0, connected: 0, total: 0 };
  }
  let configured = 0;
  let running = 0;
  let connected = 0;
  const ids = channelIds(snapshot);
  for (const id of ids) {
    const topLevel = readChannelFlags(snapshot.channels[id]);
    const accounts = Array.isArray(snapshot.channelAccounts[id])
      ? snapshot.channelAccounts[id].map(readChannelFlags)
      : [];
    const states = [topLevel, ...accounts];
    if (states.some((state) => state.configured || state.running || state.connected)) {
      configured += 1;
    }
    if (states.some((state) => state.running || state.connected)) {
      running += 1;
    }
    if (states.some((state) => state.connected)) {
      connected += 1;
    }
  }
  return { configured, running, connected, total: ids.size };
}

export function isWorkbenchModelVerified(state: WorkbenchCheckState): boolean {
  return state.phase === "ready";
}

export function isWorkbenchGuardrailsActive(runtime: WorkbenchGuardrailsRuntime): boolean {
  return runtime.phase === "active";
}

export function countReadyEssentials(readiness: WorkbenchReadiness): number {
  return Object.values(readiness).filter(Boolean).length;
}
