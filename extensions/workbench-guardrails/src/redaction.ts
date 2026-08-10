import os from "node:os";

const SENSITIVE_KEY =
  /(?:api[-_]?key|access[-_]?key|authorization|auth[-_]?token|bearer|client[-_]?secret|cookie|credential|passphrase|password|private[-_]?key|refresh[-_]?token|secret|token)/iu;
const SECRET_VALUE =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:A[KS]IA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:pk|sk)_(?:live|test)_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b|\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b)/u;
const BEARER_VALUE = /\bBearer\s+[^\s,;]+/giu;
const SENSITIVE_QUERY_VALUE =
  /([?&](?:access[-_]?token|api[-_]?key|auth|authorization|credential|key|password|secret|token)=)[^&#\s]*/giu;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/gu;
const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_ENTRIES = 100;
const MAX_STRING_LENGTH = 2_048;
const MAX_DISPLAY_TARGETS = 5;
const MAX_DISPLAY_TARGET_LENGTH = 140;
const MAX_DISPLAY_SUMMARY_LENGTH = 360;

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function aliasHomeDirectory(value: string): string {
  let result = value;
  const home = os.homedir();
  if (home) {
    const exactHome = new RegExp(
      `${escapeRegExp(home)}(?=$|[\\\\/])`,
      process.platform === "win32" ? "giu" : "gu",
    );
    result = result.replace(exactHome, "~");
  }
  return result
    .replace(/(?:[a-z]:)?[\\/]Users[\\/][^\\/)\]},;]+(?=[\\/)\]},;]|$)/giu, "~")
    .replace(/\/(?:home|Users)\/[^/)\]},;]+(?=[/)\]},;]|$)/gu, "~");
}

export function sanitizeJournalText(value: string, maxLength = MAX_STRING_LENGTH): string {
  const withoutControls = value.replace(CONTROL_CHARACTER, " ");
  const withHomeAlias = aliasHomeDirectory(withoutControls);
  if (SECRET_VALUE.test(withHomeAlias)) {
    return "[REDACTED]";
  }
  const withSafeQuery = withHomeAlias.replace(SENSITIVE_QUERY_VALUE, "$1[REDACTED]");
  const withoutBearer = withSafeQuery.replace(BEARER_VALUE, "Bearer [REDACTED]");
  return truncate(withoutBearer.replace(/\s{2,}/gu, " ").trim(), maxLength);
}

export function sanitizeDisplayTargets(targets: readonly string[] | undefined): string[] {
  if (!targets || targets.length === 0) {
    return [];
  }
  const displayed = targets
    .slice(0, MAX_DISPLAY_TARGETS)
    .map((target) => sanitizeJournalText(target, MAX_DISPLAY_TARGET_LENGTH));
  if (targets.length > MAX_DISPLAY_TARGETS) {
    displayed.push(`… +${targets.length - MAX_DISPLAY_TARGETS} more`);
  }
  return displayed;
}

export function summarizeToolAction(
  effect: string,
  tool: string,
  targets: readonly string[] | undefined,
): string {
  const safeEffect = sanitizeJournalText(effect, 24) || "unknown";
  const safeTool = sanitizeJournalText(tool, 80) || "unnamed tool";
  const displayTargets = sanitizeDisplayTargets(targets);
  const prefix = `${safeEffect} via ${safeTool}`;
  const summary = `${prefix}${displayTargets.length > 0 ? ` (${displayTargets.join(", ")})` : ""}`;
  if (summary.length <= MAX_DISPLAY_SUMMARY_LENGTH || displayTargets.length === 0) {
    return summary;
  }
  const omittedMarker =
    displayTargets.length > MAX_DISPLAY_TARGETS ? displayTargets.at(-1) : undefined;
  const retainedTargets = omittedMarker ? displayTargets.slice(0, -1) : displayTargets;
  const fixedLength =
    prefix.length + 3 + (displayTargets.length - 1) * 2 + (omittedMarker?.length ?? 0);
  const targetLength = Math.floor(
    (MAX_DISPLAY_SUMMARY_LENGTH - fixedLength) / retainedTargets.length,
  );
  const boundedTargets = retainedTargets.map((target) => truncate(target, targetLength));
  if (omittedMarker) {
    boundedTargets.push(omittedMarker);
  }
  return `${prefix} (${boundedTargets.join(", ")})`;
}

function redactString(value: string): string {
  return sanitizeJournalText(value);
}

function redactJournalValueInternal(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (key && SENSITIVE_KEY.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (depth >= MAX_DEPTH) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }
    seen.add(value);
    const redacted = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry) => redactJournalValueInternal(entry, undefined, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      redacted.push(`[TRUNCATED ${value.length - MAX_ARRAY_ITEMS} ITEMS]`);
    }
    seen.delete(value);
    return redacted;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }
    seen.add(value);
    const entries = Object.entries(value as Record<string, unknown>);
    const redacted = Object.fromEntries(
      entries
        .slice(0, MAX_OBJECT_ENTRIES)
        .map(([entryKey, entryValue]) => [
          entryKey,
          redactJournalValueInternal(entryValue, entryKey, depth + 1, seen),
        ]),
    );
    if (entries.length > MAX_OBJECT_ENTRIES) {
      redacted["[TRUNCATED]"] = `${entries.length - MAX_OBJECT_ENTRIES} entries omitted`;
    }
    seen.delete(value);
    return redacted;
  }
  return value;
}

export function redactJournalValue(value: unknown, key?: string): unknown {
  return redactJournalValueInternal(value, key, 0, new WeakSet());
}
