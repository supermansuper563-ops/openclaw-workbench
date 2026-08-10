import { isRecord } from "@openclaw/normalization-core/record-coerce";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import type { ApplicationContext } from "../../app/context.ts";
import { t } from "../../i18n/index.ts";
import { canCallGatewayMethod } from "../../lib/gateway-methods.ts";
import { runPluginConfigMutation, setPluginEnabled } from "../../lib/plugins/index.ts";
import { verifyModelSetup } from "../model-setup/rpc.ts";
import type {
  WorkbenchCheckState,
  WorkbenchGuardrailJournalEvent,
  WorkbenchGuardrailsProfile,
  WorkbenchGuardrailsRuntime,
  WorkbenchMissionDraft,
  WorkbenchMissionResult,
} from "./types.ts";

const GUARDRAILS_PLUGIN_ID = "workbench-guardrails";
const WORKBOARD_PLUGIN_ID = "workboard";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readJournalEvent(value: unknown): WorkbenchGuardrailJournalEvent | null {
  if (
    !isRecord(value) ||
    typeof value.at !== "string" ||
    (value.type !== "decision" && value.type !== "approval" && value.type !== "outcome") ||
    typeof value.taskId !== "string" ||
    !isRecord(value.details)
  ) {
    return null;
  }
  return {
    at: value.at,
    type: value.type,
    taskId: value.taskId,
    details: value.details,
  };
}

function readProfile(value: unknown): WorkbenchGuardrailsProfile {
  return value === "coding" ||
    value === "research-only" ||
    value === "high-autonomy" ||
    value === "personal-safe"
    ? value
    : "personal-safe";
}

export async function verifyWorkbenchModel(
  client: GatewayBrowserClient,
): Promise<WorkbenchCheckState> {
  try {
    const result = await verifyModelSetup(client);
    const checkedAt = Date.now();
    return result.ok
      ? {
          phase: "ready",
          detail: t("workbench.setup.model.answered", {
            model: result.modelRef,
            latency: String(Math.round(result.latencyMs)),
          }),
          checkedAt,
        }
      : { phase: "attention", detail: result.error, checkedAt };
  } catch (error) {
    return { phase: "error", detail: errorMessage(error), checkedAt: Date.now() };
  }
}

export async function readGuardrailsRuntime(
  context: ApplicationContext,
): Promise<WorkbenchGuardrailsRuntime> {
  const snapshot = context.gateway.snapshot;
  if (!canCallGatewayMethod(snapshot, "workbench.guardrails.status", "operator.read")) {
    return {
      phase: "inactive",
      detail: t("workbench.safety.runtime.unregisteredDetail"),
      checkedAt: Date.now(),
    };
  }
  try {
    const result = await snapshot.client?.request<unknown>("workbench.guardrails.status", {});
    if (!isRecord(result) || result.active !== true) {
      return {
        phase: "inactive",
        detail:
          isRecord(result) && typeof result.detail === "string"
            ? result.detail
            : t("workbench.safety.runtime.inactiveDetail"),
        checkedAt: Date.now(),
      };
    }
    return {
      phase: "active",
      profile: readProfile(result.profile),
      journalCount:
        typeof result.journalCount === "number" && Number.isFinite(result.journalCount)
          ? Math.max(0, Math.floor(result.journalCount))
          : 0,
      checkedAt: Date.now(),
    };
  } catch (error) {
    return { phase: "error", detail: errorMessage(error), checkedAt: Date.now() };
  }
}

export async function listGuardrailsJournal(
  context: ApplicationContext,
  limit = 12,
): Promise<WorkbenchGuardrailJournalEvent[]> {
  const snapshot = context.gateway.snapshot;
  if (!canCallGatewayMethod(snapshot, "workbench.guardrails.journal.list", "operator.read")) {
    return [];
  }
  const result = await snapshot.client?.request<unknown>("workbench.guardrails.journal.list", {
    limit,
  });
  const values = isRecord(result) && Array.isArray(result.events) ? result.events : [];
  return values
    .map(readJournalEvent)
    .filter((event): event is WorkbenchGuardrailJournalEvent => !!event);
}

export async function clearGuardrailsJournal(context: ApplicationContext): Promise<void> {
  const snapshot = context.gateway.snapshot;
  if (!canCallGatewayMethod(snapshot, "workbench.guardrails.journal.clear", "operator.admin")) {
    throw new Error(t("workbench.errors.journalAdminRequired"));
  }
  await snapshot.client?.request("workbench.guardrails.journal.clear", {});
}

async function enablePlugin(
  context: ApplicationContext,
  client: GatewayBrowserClient,
  pluginId: string,
): Promise<void> {
  await runPluginConfigMutation(context.runtimeConfig, client, (currentClient) =>
    setPluginEnabled(currentClient, pluginId, true),
  );
}

function assertCurrentGatewayClient(
  context: ApplicationContext,
  client: GatewayBrowserClient,
): void {
  if (
    context.gateway.snapshot.phase !== "connected" ||
    context.gateway.snapshot.client !== client
  ) {
    throw new Error(t("workbench.errors.gatewayReconnectForFoundation"));
  }
}

export async function configureWorkbenchFoundation(params: {
  context: ApplicationContext;
  profile: WorkbenchGuardrailsProfile;
  approvalTtlMinutes: number;
  enableWorkboard: boolean;
}): Promise<{ applied: boolean }> {
  const client = params.context.gateway.snapshot.client;
  if (!client || params.context.gateway.snapshot.phase !== "connected") {
    throw new Error(t("workbench.errors.gatewayReconnectForFoundation"));
  }

  await enablePlugin(params.context, client, GUARDRAILS_PLUGIN_ID);
  assertCurrentGatewayClient(params.context, client);
  if (params.enableWorkboard) {
    await enablePlugin(params.context, client, WORKBOARD_PLUGIN_ID);
    assertCurrentGatewayClient(params.context, client);
  }

  const approvalTtlMinutes = Math.min(10_080, Math.max(1, params.approvalTtlMinutes));
  const patched = await params.context.runtimeConfig.patchFromSnapshot(() => ({
    options: {
      raw: {
        plugins: {
          entries: {
            [GUARDRAILS_PLUGIN_ID]: {
              enabled: true,
              config: {
                profile: params.profile,
                approvalTtlMinutes,
              },
            },
            ...(params.enableWorkboard ? { [WORKBOARD_PLUGIN_ID]: { enabled: true } } : {}),
          },
        },
      },
      note: t("workbench.safety.foundationNote"),
    },
  }));
  assertCurrentGatewayClient(params.context, client);
  if (!patched) {
    throw new Error(
      params.context.runtimeConfig.state.lastError ?? t("workbench.errors.foundationSaveFailed"),
    );
  }

  const applied = params.context.runtimeConfig.canApply
    ? await params.context.runtimeConfig.apply()
    : false;
  return { applied };
}

export async function createWorkbenchMission(
  context: ApplicationContext,
  draft: WorkbenchMissionDraft,
): Promise<WorkbenchMissionResult> {
  const snapshot = context.gateway.snapshot;
  if (!canCallGatewayMethod(snapshot, "workboard.cards.create", "operator.write")) {
    throw new Error(t("workbench.errors.workboardReconnectRequired"));
  }
  const title = draft.title.trim();
  if (title.length < 3) {
    throw new Error(t("workbench.errors.missionTitleShort"));
  }
  if (title.length > 240) {
    throw new Error(t("workbench.errors.missionTitleLong"));
  }
  const notes = draft.notes.trim();
  if (notes.length > 8_000) {
    throw new Error(t("workbench.errors.missionNotesLong"));
  }
  const result = await snapshot.client?.request<unknown>("workboard.cards.create", {
    title,
    notes,
    priority: draft.priority,
    status: "todo",
    labels: ["workbench"],
    ...(draft.agentId ? { agentId: draft.agentId } : {}),
  });
  const card = isRecord(result) && isRecord(result.card) ? result.card : null;
  if (!card || typeof card.id !== "string" || typeof card.title !== "string") {
    throw new Error(t("workbench.errors.invalidMissionResult"));
  }
  return { id: card.id, title: card.title };
}
