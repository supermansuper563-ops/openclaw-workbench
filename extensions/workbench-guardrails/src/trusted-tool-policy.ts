import type {
  OpenClawPluginApi,
  PluginTrustedToolPolicyRegistration,
} from "openclaw/plugin-sdk/plugin-entry";
import {
  enforceDecisionFloor,
  evaluateAction,
  evaluateRules,
  type GuardrailsPolicyConfig,
} from "./policy-engine.js";
import {
  redactJournalValue,
  sanitizeDisplayTargets,
  sanitizeJournalText,
  summarizeToolAction,
} from "./redaction.js";
import type {
  ActionEffect,
  GuardrailsJournal,
  GuardrailsProfile,
  GuardrailsRule,
  JournalEvent,
  ToolAction,
} from "./types.js";

type BeforeToolEvent = Parameters<PluginTrustedToolPolicyRegistration["evaluate"]>[0];
type ToolContext = Parameters<PluginTrustedToolPolicyRegistration["evaluate"]>[1];
type ToolResultMiddleware = Parameters<OpenClawPluginApi["registerAgentToolResultMiddleware"]>[0];

const DEFAULT_CONFIG: GuardrailsPolicyConfig = {
  profile: "personal-safe",
  approvalTtlMinutes: 60,
  rules: [],
};
const EFFECTS = new Set<ActionEffect>([
  "read",
  "write",
  "execute",
  "send",
  "publish",
  "delete",
  "unknown",
]);

const FIXED_EFFECT_TOOLS = new Map<string, ActionEffect>([
  ["read", "read"],
  ["web_search", "read"],
  ["web_fetch", "read"],
  ["sessions_list", "read"],
  ["sessions_history", "read"],
  ["sessions_search", "read"],
  ["sessions_wait", "read"],
  ["sessions_yield", "read"],
  ["session_status", "read"],
  ["agents_list", "read"],
  ["agents_wait", "read"],
  ["image", "read"],
  ["pdf", "read"],
  ["structured_output", "read"],
  ["write", "write"],
  ["edit", "write"],
  ["apply_patch", "write"],
  ["update_plan", "write"],
  ["create_goal", "write"],
  ["update_goal", "write"],
  ["exec", "unknown"],
  ["terminal", "unknown"],
  ["shell_command", "unknown"],
  ["sessions_spawn", "execute"],
  ["agents_spawn", "execute"],
  ["system_agent", "unknown"],
  ["openclaw_delegate", "unknown"],
  ["openclaw", "unknown"],
  ["image_generate", "execute"],
  ["music_generate", "execute"],
  ["video_generate", "execute"],
  ["tts", "execute"],
  ["message", "send"],
  ["send_message", "send"],
  ["sessions_send", "send"],
  ["email", "send"],
  ["ask_user", "send"],
  ["delete", "delete"],
  ["remove", "delete"],
  ["unlink", "delete"],
  ["publish", "publish"],
  ["deploy", "publish"],
  ["git_push", "publish"],
  ["push", "publish"],
]);

const BROWSER_ACTIONS = new Map<string, ActionEffect>([
  ["doctor", "read"],
  ["status", "read"],
  ["profiles", "read"],
  ["tabs", "read"],
  ["snapshot", "read"],
  ["extract", "read"],
  ["console", "read"],
  ["screenshot", "read"],
  ["pdf", "read"],
  ["start", "execute"],
  ["stop", "execute"],
  ["importprofile", "execute"],
  ["open", "execute"],
  ["focus", "execute"],
  ["close", "execute"],
  ["navigate", "execute"],
  ["download", "write"],
  ["waitfordownload", "write"],
  ["upload", "send"],
  ["dialog", "unknown"],
  ["act", "unknown"],
]);
const COMPUTER_ACTIONS = new Map<string, ActionEffect>([
  ["screenshot", "read"],
  ["wait", "read"],
  ["left_click", "unknown"],
  ["right_click", "unknown"],
  ["middle_click", "unknown"],
  ["double_click", "unknown"],
  ["triple_click", "unknown"],
  ["mouse_move", "execute"],
  ["left_click_drag", "unknown"],
  ["left_mouse_down", "unknown"],
  ["left_mouse_up", "unknown"],
  ["scroll", "execute"],
  ["type", "unknown"],
  ["key", "unknown"],
  ["hold_key", "unknown"],
]);
const PROCESS_ACTIONS = new Map<string, ActionEffect>([
  ["list", "read"],
  ["poll", "read"],
  ["log", "read"],
  ["status", "read"],
  ["kill", "delete"],
  ["terminate", "delete"],
  ["write", "unknown"],
  ["submit", "unknown"],
]);
const CRON_ACTIONS = new Map<string, ActionEffect>([
  ["status", "read"],
  ["list", "read"],
  ["get", "read"],
  ["runs", "read"],
  ["next_check", "read"],
  ["add", "write"],
  ["update", "write"],
  ["remove", "delete"],
  ["run", "execute"],
  ["wake", "execute"],
]);
const NODE_ACTIONS = new Map<string, ActionEffect>([
  ["status", "read"],
  ["describe", "read"],
  ["pending", "read"],
  ["camera_list", "read"],
  ["photos_latest", "read"],
  ["location_get", "read"],
  ["notifications_list", "read"],
  ["device_status", "read"],
  ["device_info", "read"],
  ["device_permissions", "read"],
  ["device_health", "read"],
  ["which", "read"],
  ["approve", "unknown"],
  ["reject", "write"],
  ["notify", "send"],
  ["camera_snap", "execute"],
  ["camera_clip", "execute"],
  ["screen_record", "execute"],
  ["screen_snapshot", "execute"],
  ["notifications_action", "execute"],
  ["invoke", "unknown"],
]);
const SESSION_ACTIONS = new Map<string, ActionEffect>([
  ["group_list", "read"],
  ["patch", "write"],
  ["reset", "write"],
  ["group_set", "write"],
  ["group_rename", "write"],
  ["delete", "delete"],
  ["group_delete", "delete"],
]);
const SUBAGENT_ACTIONS = new Map<string, ActionEffect>([
  ["list", "read"],
  ["steer", "send"],
  ["kill", "delete"],
]);
const DASHBOARD_ACTIONS = new Map<string, ActionEffect>([
  ["read", "read"],
  ["tab_create", "write"],
  ["tab_update", "write"],
  ["tabs_reorder", "write"],
  ["widget_put", "write"],
  ["widget_move", "write"],
  ["widget_resize", "write"],
  ["focus_tab", "write"],
  ["set_chat_dock", "write"],
  ["tab_delete", "delete"],
  ["widget_remove", "delete"],
]);
const GATEWAY_ACTIONS = new Map<string, ActionEffect>([
  ["config.get", "read"],
  ["config.schema.lookup", "read"],
]);
const MOBILE_UI_ACTIONS = new Map<string, ActionEffect>([
  ["observe", "read"],
  ["act", "unknown"],
]);
const SCREEN_ACTIONS = new Map<string, ActionEffect>([
  ["split_right", "execute"],
  ["split_down", "execute"],
  ["close_pane", "execute"],
  ["focus", "execute"],
  ["sidebar_show", "execute"],
  ["sidebar_hide", "execute"],
  ["terminal_show", "execute"],
  ["terminal_hide", "execute"],
  ["browser_show", "execute"],
  ["browser_hide", "execute"],
  ["navigate", "execute"],
]);
const SKILL_WORKSHOP_ACTIONS = new Map<string, ActionEffect>([
  ["list", "read"],
  ["inspect", "read"],
  ["evaluate", "read"],
  ["create", "write"],
  ["update", "write"],
  ["revise", "write"],
  ["reject", "write"],
  ["quarantine", "write"],
  ["apply", "execute"],
]);
const TRANSCRIPT_ACTIONS = new Map<string, ActionEffect>([
  ["status", "read"],
  ["import", "write"],
  ["start", "execute"],
  ["stop", "execute"],
  ["summarize", "execute"],
]);

function readAction(params: Record<string, unknown>): string | undefined {
  return typeof params.action === "string" ? params.action.trim().toLowerCase() : undefined;
}

function familyActionEffect(
  toolName: string,
  params: Record<string, unknown>,
): ActionEffect | undefined {
  const action = readAction(params);
  if (!action) {
    return undefined;
  }
  if (toolName === "browser") {
    if ((action === "screenshot" || action === "pdf") && typeof params.path === "string") {
      return "write";
    }
    return BROWSER_ACTIONS.get(action);
  }
  if (toolName === "computer") {
    return COMPUTER_ACTIONS.get(action);
  }
  if (toolName === "process") {
    return PROCESS_ACTIONS.get(action);
  }
  if (toolName === "cron") {
    return CRON_ACTIONS.get(action);
  }
  if (toolName === "nodes") {
    if (action === "notifications_action") {
      const notificationAction =
        typeof params.notificationAction === "string"
          ? params.notificationAction.trim().toLowerCase()
          : undefined;
      if (notificationAction === "reply") {
        return "send";
      }
      return notificationAction === "open" || notificationAction === "dismiss"
        ? "execute"
        : undefined;
    }
    return NODE_ACTIONS.get(action);
  }
  if (toolName === "sessions") {
    return SESSION_ACTIONS.get(action);
  }
  if (toolName === "subagents") {
    return SUBAGENT_ACTIONS.get(action);
  }
  if (toolName === "dashboard") {
    return DASHBOARD_ACTIONS.get(action);
  }
  if (toolName === "gateway") {
    return GATEWAY_ACTIONS.get(action);
  }
  if (toolName === "mobile_ui") {
    return MOBILE_UI_ACTIONS.get(action);
  }
  if (toolName === "screen") {
    return SCREEN_ACTIONS.get(action);
  }
  if (toolName === "skill_workshop") {
    return SKILL_WORKSHOP_ACTIONS.get(action);
  }
  if (toolName === "transcripts") {
    return TRANSCRIPT_ACTIONS.get(action);
  }
  return undefined;
}

function patchDeletesContent(params: Record<string, unknown>): boolean {
  try {
    const source = JSON.stringify(params);
    return (
      /\*\*\* Delete File:/u.test(source) ||
      /\*\*\* Move to:/u.test(source) ||
      /deleted file mode\s+\d+/iu.test(source) ||
      /\+\+\+ (?:\/dev\/null|NUL)(?:\\n|\r?\n|$)/iu.test(source)
    );
  } catch {
    return true;
  }
}

export function classifyToolActionEffect(event: BeforeToolEvent): ActionEffect {
  if (event.toolKind === "code_mode_exec") {
    return "unknown";
  }
  const toolName = event.toolName.trim().toLowerCase();
  if (toolName === "apply_patch" && patchDeletesContent(event.params)) {
    return "delete";
  }
  const fixed = FIXED_EFFECT_TOOLS.get(toolName);
  if (fixed) {
    return fixed;
  }
  const family = familyActionEffect(toolName, event.params);
  if (family) {
    return family;
  }
  if (toolName === "http" || toolName === "http_request" || toolName === "web_request") {
    const method = typeof event.params.method === "string" ? event.params.method.toUpperCase() : "";
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return "read";
    }
    if (method === "DELETE") {
      return "delete";
    }
    return "unknown";
  }
  return "unknown";
}

function actionFrom(event: BeforeToolEvent): ToolAction {
  const effect = classifyToolActionEffect(event);
  const targets = event.derivedPaths ? [...event.derivedPaths] : undefined;
  return {
    tool: event.toolName,
    effect,
    ...(targets ? { targets } : {}),
    summary: summarizeToolAction(effect, event.toolName, targets),
  };
}

function journalAction(action: ToolAction): Record<string, unknown> {
  const targets = sanitizeDisplayTargets(action.targets);
  return {
    tool: sanitizeJournalText(action.tool, 80),
    effect: action.effect,
    ...(targets.length > 0 ? { targets } : {}),
    summary: action.summary,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRule(value: unknown): value is GuardrailsRule {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.outcome !== "allow" &&
    candidate.outcome !== "ask" &&
    candidate.outcome !== "block"
  ) {
    return false;
  }
  return (
    (candidate.tools === undefined || isStringArray(candidate.tools)) &&
    (candidate.effects === undefined ||
      (isStringArray(candidate.effects) &&
        candidate.effects.every((effect) => EFFECTS.has(effect as ActionEffect)))) &&
    (candidate.targetPrefix === undefined ||
      (typeof candidate.targetPrefix === "string" &&
        candidate.targetPrefix.length > 0 &&
        candidate.targetPrefix === candidate.targetPrefix.trim())) &&
    (candidate.reason === undefined || typeof candidate.reason === "string")
  );
}

function isProfile(value: unknown): value is GuardrailsProfile {
  return (
    value === "personal-safe" ||
    value === "coding" ||
    value === "research-only" ||
    value === "high-autonomy"
  );
}

function resolveGuardrailsConfig(
  value: Record<string, unknown> | undefined,
): GuardrailsPolicyConfig {
  const ttl = value?.approvalTtlMinutes;
  return {
    profile: isProfile(value?.profile) ? value.profile : DEFAULT_CONFIG.profile,
    approvalTtlMinutes:
      typeof ttl === "number" && Number.isFinite(ttl) && ttl >= 1 && ttl <= 10_080
        ? Math.floor(ttl)
        : DEFAULT_CONFIG.approvalTtlMinutes,
    rules: Array.isArray(value?.rules) ? value.rules.filter(isRule) : [],
  };
}

async function appendRedacted(journal: GuardrailsJournal, event: JournalEvent): Promise<void> {
  await journal.append(redactJournalValue(event) as JournalEvent);
}

export function createGuardrailsRuntime(
  pluginConfig: Record<string, unknown> | undefined,
  journal: GuardrailsJournal,
): {
  policy: PluginTrustedToolPolicyRegistration;
  recordToolResult: ToolResultMiddleware;
  profile: GuardrailsProfile;
} {
  const config = resolveGuardrailsConfig(pluginConfig);
  const policy: PluginTrustedToolPolicyRegistration = {
    id: "workbench-guardrails",
    description: "Apply local Workbench safety policy before tool calls.",
    async evaluate(event: BeforeToolEvent, ctx: ToolContext) {
      const action = actionFrom(event);
      const configuredDecision =
        evaluateRules(config.rules, action) ?? evaluateAction(config.profile, action);
      const decision = enforceDecisionFloor(config.profile, action, configuredDecision);
      const taskId = ctx.runId ?? event.runId ?? "unknown";
      await appendRedacted(journal, {
        at: new Date().toISOString(),
        type: "decision",
        taskId,
        details: { profile: config.profile, action: journalAction(action), decision },
      });
      if (decision.outcome === "allow") {
        return undefined;
      }
      if (decision.outcome === "block") {
        return { block: true, blockReason: decision.reason };
      }
      const effectLabel = action.effect === "unknown" ? "unclassified" : action.effect;
      return {
        requireApproval: {
          title: `Approve ${effectLabel} action`,
          description: sanitizeJournalText(`${action.summary}. ${decision.reason}`, 500),
          severity:
            action.effect === "delete" || action.effect === "publish" || action.effect === "unknown"
              ? "critical"
              : "warning",
          timeoutMs: config.approvalTtlMinutes * 60_000,
          timeoutReason: "Workbench Guardrails denied the action because approval expired.",
          allowedDecisions: ["allow-once", "deny"],
          pluginId: "workbench-guardrails",
          onResolution: async (resolution) => {
            await appendRedacted(journal, {
              at: new Date().toISOString(),
              type: "approval",
              taskId,
              details: { action: journalAction(action), resolution },
            });
          },
        },
      };
    },
  };

  const recordToolResult: ToolResultMiddleware = async (event, ctx) => {
    await appendRedacted(journal, {
      at: new Date().toISOString(),
      type: "outcome",
      taskId: ctx.runId ?? event.turnId ?? "unknown",
      details: {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        runtime: ctx.runtime,
        status: event.isError ? "error" : "completed",
      },
    });
  };

  return { policy, recordToolResult, profile: config.profile };
}
