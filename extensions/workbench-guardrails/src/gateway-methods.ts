import {
  ErrorCodes,
  errorShape,
  type GatewayRequestHandlerOptions,
} from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginStateKeyedStore } from "openclaw/plugin-sdk/plugin-state-runtime";
import { redactJournalValue } from "./redaction.js";
import type { GuardrailsProfile, JournalEvent } from "./types.js";

const DEFAULT_JOURNAL_LIMIT = 50;
const MAX_JOURNAL_LIMIT = 200;
const UNAVAILABLE_MESSAGE = "Workbench Guardrails journal is unavailable";
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export const GUARDRAILS_GATEWAY_METHODS = {
  status: "workbench.guardrails.status",
  journalList: "workbench.guardrails.journal.list",
  journalClear: "workbench.guardrails.journal.clear",
} as const;

export type WorkbenchGuardrailsStatusResponse = {
  active: true;
  policyId: "workbench-guardrails";
  profile: GuardrailsProfile;
  journalCount: number;
  lastEventAt?: string;
};

export type WorkbenchGuardrailsJournalListResponse = {
  events: JournalEvent[];
  journalCount: number;
};

export type WorkbenchGuardrailsJournalClearResponse = {
  cleared: true;
  removed: number;
  journalCount: 0;
};

function readLimit(params: unknown): number {
  if (params === undefined || params === null) {
    return DEFAULT_JOURNAL_LIMIT;
  }
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new Error("params must be an object");
  }
  const limit = (params as { limit?: unknown }).limit;
  if (limit === undefined) {
    return DEFAULT_JOURNAL_LIMIT;
  }
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_JOURNAL_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_JOURNAL_LIMIT}`);
  }
  return limit as number;
}

function sendUnavailable(respond: GatewayRequestHandlerOptions["respond"]): void {
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, UNAVAILABLE_MESSAGE));
}

function sendInvalidRequest(
  respond: GatewayRequestHandlerOptions["respond"],
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : "invalid request";
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function readEventTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) {
    return undefined;
  }
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

export function registerGuardrailsGatewayMethods(
  api: OpenClawPluginApi,
  store: PluginStateKeyedStore<JournalEvent>,
  profile: GuardrailsProfile,
): void {
  api.registerGatewayMethod(
    GUARDRAILS_GATEWAY_METHODS.status,
    async ({ respond }) => {
      try {
        const entries = await store.entries();
        const latestEntry = entries.reduce<(typeof entries)[number] | undefined>(
          (latest, entry) => (!latest || entry.createdAt > latest.createdAt ? entry : latest),
          undefined,
        );
        const lastEventAt = readEventTimestamp(latestEntry?.value.at);
        const response: WorkbenchGuardrailsStatusResponse = {
          active: true,
          policyId: "workbench-guardrails",
          profile,
          journalCount: entries.length,
          ...(lastEventAt ? { lastEventAt } : {}),
        };
        respond(true, response);
      } catch {
        sendUnavailable(respond);
      }
    },
    { scope: "operator.read" },
  );

  api.registerGatewayMethod(
    GUARDRAILS_GATEWAY_METHODS.journalList,
    async ({ params, respond }) => {
      let limit: number;
      try {
        limit = readLimit(params);
      } catch (error) {
        sendInvalidRequest(respond, error);
        return;
      }
      try {
        const entries = await store.entries();
        const events = entries
          .toSorted((left, right) => right.createdAt - left.createdAt)
          .slice(0, limit)
          .map((entry) => redactJournalValue(entry.value) as JournalEvent);
        const response: WorkbenchGuardrailsJournalListResponse = {
          events,
          journalCount: entries.length,
        };
        respond(true, response);
      } catch {
        sendUnavailable(respond);
      }
    },
    { scope: "operator.read" },
  );

  api.registerGatewayMethod(
    GUARDRAILS_GATEWAY_METHODS.journalClear,
    async ({ respond }) => {
      try {
        const entries = await store.entries();
        await store.clear();
        const response: WorkbenchGuardrailsJournalClearResponse = {
          cleared: true,
          removed: entries.length,
          journalCount: 0,
        };
        respond(true, response);
      } catch {
        sendUnavailable(respond);
      }
    },
    { scope: "operator.admin" },
  );
}
