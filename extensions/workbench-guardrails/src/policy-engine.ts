import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type {
  ActionDecision,
  ActionEffect,
  GuardrailsProfile,
  GuardrailsRule,
  ToolAction,
} from "./types.js";

export type GuardrailsPolicyConfig = {
  profile: GuardrailsProfile;
  approvalTtlMinutes: number;
  rules: GuardrailsRule[];
};

const APPROVAL_ONLY_EFFECTS = new Set<ActionEffect>(["delete", "publish"]);
const MAX_POLICY_TARGETS = 64;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const WINDOWS_ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\)/iu;
const WINDOWS_DEVICE_PATH = /^\\\\[?.][\\/]/u;

type NormalizedPolicyPath = {
  flavor: "posix" | "win32";
  value: string;
};

const HOST_PATH_FLAVOR: NormalizedPolicyPath["flavor"] =
  process.platform === "win32" ? "win32" : "posix";

function hasTraversalSegment(value: string, flavor: NormalizedPolicyPath["flavor"]): boolean {
  const segments = value.split(flavor === "win32" ? /[\\/]+/u : /\/+/u);
  return segments.some((segment) => segment === "." || segment === "..");
}

function normalizePolicyPath(value: string): NormalizedPolicyPath | undefined {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.startsWith("//") ||
    CONTROL_CHARACTER.test(value)
  ) {
    return undefined;
  }
  const flavor = WINDOWS_ABSOLUTE_PATH.test(value) ? "win32" : "posix";
  const pathApi = flavor === "win32" ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(value) || (flavor === "win32" && WINDOWS_DEVICE_PATH.test(value))) {
    return undefined;
  }
  if (hasTraversalSegment(value, flavor)) {
    return undefined;
  }
  return { flavor, value: pathApi.normalize(value) };
}

function pathIsInside(prefix: NormalizedPolicyPath, target: NormalizedPolicyPath): boolean {
  if (prefix.flavor !== target.flavor) {
    return false;
  }
  const pathApi = prefix.flavor === "win32" ? path.win32 : path.posix;
  const normalizedPrefix =
    prefix.flavor === "win32" ? prefix.value.toLocaleLowerCase("en-US") : prefix.value;
  const normalizedTarget =
    target.flavor === "win32" ? target.value.toLocaleLowerCase("en-US") : target.value;
  const relative = pathApi.relative(normalizedPrefix, normalizedTarget);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative))
  );
}

/**
 * Resolve every existing ancestor before applying containment. This catches a
 * target such as `/workspace/link/file` when `link` points outside the policy
 * root, while still supporting not-yet-created leaf paths. Paths for the other
 * operating-system flavor stay lexical so one host can validate portable
 * policy configuration and tests.
 */
function canonicalizeHostPath(value: NormalizedPolicyPath): NormalizedPolicyPath | undefined {
  if (value.flavor !== HOST_PATH_FLAVOR) {
    return value;
  }
  const pathApi = value.flavor === "win32" ? path.win32 : path.posix;
  const missingSegments: string[] = [];
  let existingAncestor = value.value;
  while (!existsSync(existingAncestor)) {
    const parent = pathApi.dirname(existingAncestor);
    if (parent === existingAncestor) {
      return undefined;
    }
    missingSegments.unshift(pathApi.basename(existingAncestor));
    existingAncestor = parent;
  }
  try {
    const resolvedAncestor = realpathSync.native(existingAncestor);
    const resolved =
      missingSegments.length > 0
        ? pathApi.resolve(resolvedAncestor, ...missingSegments)
        : resolvedAncestor;
    return normalizePolicyPath(resolved);
  } catch {
    return undefined;
  }
}

export function targetsMatchPrefix(
  targets: readonly string[] | undefined,
  targetPrefix: string,
): boolean {
  if (!targets || targets.length === 0 || targets.length > MAX_POLICY_TARGETS) {
    return false;
  }
  const normalizedPrefix = normalizePolicyPath(targetPrefix);
  const prefix = normalizedPrefix ? canonicalizeHostPath(normalizedPrefix) : undefined;
  if (!prefix) {
    return false;
  }
  return targets.every((target) => {
    const normalizedTarget = normalizePolicyPath(target);
    const canonicalTarget = normalizedTarget ? canonicalizeHostPath(normalizedTarget) : undefined;
    return canonicalTarget ? pathIsInside(prefix, canonicalTarget) : false;
  });
}

function mandatoryDecision(
  profile: GuardrailsProfile,
  action: ToolAction,
): ActionDecision | undefined {
  if (profile === "research-only" && action.effect !== "read") {
    return action.effect === "unknown"
      ? { outcome: "block", reason: "research-only blocks unclassified tool actions" }
      : { outcome: "block", reason: "research-only permits read-only actions" };
  }
  if (action.effect === "unknown") {
    return { outcome: "ask", reason: "unclassified tool actions require approval" };
  }
  if (APPROVAL_ONLY_EFFECTS.has(action.effect)) {
    return { outcome: "ask", reason: `${action.effect} actions always require approval` };
  }
  return undefined;
}

export function profileRules(profile: GuardrailsProfile, action: ToolAction): ActionDecision {
  const mandatory = mandatoryDecision(profile, action);
  if (mandatory) {
    return mandatory;
  }
  if (profile === "high-autonomy") {
    return { outcome: "allow", reason: "allowed by the high-autonomy profile" };
  }
  if (action.effect === "send" || action.effect === "execute") {
    return { outcome: "ask", reason: `${action.effect} actions require approval in this profile` };
  }
  if (profile === "personal-safe" && action.effect === "write") {
    return { outcome: "ask", reason: "writes require approval in the personal-safe profile" };
  }
  return { outcome: "allow", reason: "allowed by the selected profile" };
}

export function evaluateAction(profile: GuardrailsProfile, action: ToolAction): ActionDecision {
  if (!action.tool.trim() || !action.summary.trim()) {
    return { outcome: "block", reason: "actions need a tool name and user-readable summary" };
  }
  return profileRules(profile, action);
}

export function evaluateRules(
  rules: readonly GuardrailsRule[],
  action: ToolAction,
): ActionDecision | undefined {
  for (const rule of rules) {
    if (rule.tools && !rule.tools.includes(action.tool)) {
      continue;
    }
    if (rule.effects && !rule.effects.includes(action.effect)) {
      continue;
    }
    if (rule.targetPrefix !== undefined && !targetsMatchPrefix(action.targets, rule.targetPrefix)) {
      continue;
    }
    return {
      outcome: rule.outcome,
      reason: rule.reason ?? "matched a configured Workbench Guardrails rule",
    };
  }
  return undefined;
}

export function enforceDecisionFloor(
  profile: GuardrailsProfile,
  action: ToolAction,
  decision: ActionDecision,
): ActionDecision {
  const mandatory = mandatoryDecision(profile, action);
  if (!mandatory || decision.outcome === "block") {
    return decision;
  }
  if (mandatory.outcome === "block" || decision.outcome === "allow") {
    return mandatory;
  }
  return decision;
}
