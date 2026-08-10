import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { renderWorkbenchProfilePicker } from "./profile-picker.ts";
import type {
  WorkbenchGuardrailJournalEvent,
  WorkbenchGuardrailsProfile,
  WorkbenchGuardrailsRuntime,
  WorkbenchOperationState,
} from "./types.ts";

export type WorkbenchSafetyViewProps = {
  runtime: WorkbenchGuardrailsRuntime;
  events: readonly WorkbenchGuardrailJournalEvent[];
  journalLoading: boolean;
  journalError: string | null;
  profile: WorkbenchGuardrailsProfile;
  approvalTtlMinutes: number;
  operation: WorkbenchOperationState;
  canAdminister: boolean;
  configurationReady: boolean;
  onProfileChange: (profile: WorkbenchGuardrailsProfile) => void;
  onTtlChange: (minutes: number) => void;
  onApply: () => void;
  onRefresh: () => void;
  onClear: () => void;
};

const JOURNAL_EFFECT_KEYS: Readonly<Record<string, string>> = {
  read: "workbench.safety.journal.effect.read",
  write: "workbench.safety.journal.effect.write",
  execute: "workbench.safety.journal.effect.execute",
  send: "workbench.safety.journal.effect.send",
  publish: "workbench.safety.journal.effect.publish",
  delete: "workbench.safety.journal.effect.delete",
  unknown: "workbench.safety.journal.effect.unknown",
};

const JOURNAL_OUTCOME_KEYS: Readonly<Record<string, string>> = {
  allow: "workbench.safety.journal.outcome.allow",
  ask: "workbench.safety.journal.outcome.ask",
  block: "workbench.safety.journal.outcome.block",
  "allow-once": "workbench.safety.journal.outcome.allowOnce",
  deny: "workbench.safety.journal.outcome.deny",
  completed: "workbench.safety.journal.outcome.completed",
  error: "workbench.safety.journal.outcome.error",
};

export function journalEventPresentation(event: WorkbenchGuardrailJournalEvent): {
  title: string;
  detail: string;
  outcome: string;
} {
  const action = isRecord(event.details.action) ? event.details.action : null;
  const decision = isRecord(event.details.decision) ? event.details.decision : null;
  const resolution = event.details.resolution;
  const tool =
    typeof action?.tool === "string"
      ? action.tool
      : typeof event.details.toolName === "string"
        ? event.details.toolName
        : undefined;
  const rawEffect = typeof action?.effect === "string" ? action.effect : undefined;
  const effect = rawEffect
    ? t(JOURNAL_EFFECT_KEYS[rawEffect] ?? "workbench.safety.journal.effect.unknown")
    : undefined;
  const targets = Array.isArray(action?.targets)
    ? action.targets.filter((target): target is string => typeof target === "string").slice(0, 2)
    : [];
  const target = targets.join(", ");
  const status = typeof event.details.status === "string" ? event.details.status : undefined;
  const rawOutcome =
    (typeof decision?.outcome === "string" ? decision.outcome : undefined) ??
    (typeof resolution === "string"
      ? resolution
      : isRecord(resolution) && typeof resolution.decision === "string"
        ? resolution.decision
        : undefined) ??
    status;
  const outcome = rawOutcome
    ? t(JOURNAL_OUTCOME_KEYS[rawOutcome] ?? "workbench.safety.journal.outcome.unknown")
    : t(`workbench.safety.journal.type.${event.type}`);
  return {
    title: tool
      ? t("workbench.safety.journal.toolTitle", { tool })
      : t(`workbench.safety.journal.type.${event.type}`),
    detail:
      [effect, target].filter(Boolean).join(" · ") || t("workbench.safety.journal.redactedDetail"),
    outcome,
  };
}

function runtimeDetail(runtime: WorkbenchGuardrailsRuntime): string {
  if (runtime.phase === "active") {
    return t("workbench.safety.runtime.activeDetail", {
      profile: t(`workbench.profiles.${runtime.profile}.title`),
      count: String(runtime.journalCount),
    });
  }
  if (runtime.phase === "loading") {
    return t("workbench.safety.runtime.loadingDetail");
  }
  if (runtime.phase === "idle") {
    return t("workbench.safety.runtime.idleDetail");
  }
  return runtime.detail;
}

export function renderWorkbenchSafetyView(props: WorkbenchSafetyViewProps) {
  return html`
    <section class="workbench-panel workbench-safety" aria-labelledby="workbench-safety-title">
      <div class="workbench-panel__header">
        <div>
          <p class="workbench-kicker">${t("workbench.safety.kicker")}</p>
          <h1 id="workbench-safety-title">${t("workbench.safety.heading")}</h1>
          <p>${t("workbench.safety.intro")}</p>
        </div>
        <div class="workbench-runtime-badge is-${props.runtime.phase}">
          <span aria-hidden="true"></span>
          ${t(`workbench.safety.runtime.phase.${props.runtime.phase}`)}
        </div>
      </div>

      <div class="workbench-safety-layout">
        <div class="workbench-safety-main">
          <section class="workbench-subpanel">
            <div class="workbench-subpanel__header">
              <div>
                <h2>${t("workbench.safety.profilesHeading")}</h2>
                <p>${t("workbench.safety.profilesBody")}</p>
              </div>
            </div>
            ${renderWorkbenchProfilePicker({
              profile: props.profile,
              approvalTtlMinutes: props.approvalTtlMinutes,
              disabled:
                !props.canAdminister ||
                !props.configurationReady ||
                props.operation.phase === "running",
              operation: props.operation,
              onProfileChange: props.onProfileChange,
              onTtlChange: props.onTtlChange,
              onApply: props.onApply,
            })}
            ${!props.canAdminister
              ? html`<p class="workbench-permission-warning" role="alert">
                  ${t("workbench.safety.adminRequired")}
                </p>`
              : nothing}
          </section>

          <section class="workbench-subpanel">
            <div class="workbench-subpanel__header">
              <div>
                <h2>${t("workbench.safety.journal.heading")}</h2>
                <p>${t("workbench.safety.journal.body")}</p>
              </div>
              <div class="workbench-inline-actions">
                <button
                  class="btn"
                  type="button"
                  ?disabled=${props.journalLoading}
                  @click=${props.onRefresh}
                >
                  ${props.journalLoading
                    ? t("workbench.safety.journal.refreshing")
                    : t("workbench.safety.journal.refresh")}
                </button>
                <button
                  class="btn danger"
                  type="button"
                  ?disabled=${!props.canAdminister || props.events.length === 0}
                  @click=${props.onClear}
                >
                  ${t("workbench.safety.journal.clear")}
                </button>
              </div>
            </div>
            ${props.journalError
              ? html`<div class="workbench-notice workbench-notice--error" role="alert">
                  ${props.journalError}
                </div>`
              : nothing}
            ${props.events.length === 0
              ? html`<div class="workbench-empty-state">
                  <span aria-hidden="true">◎</span>
                  <strong>${t("workbench.safety.journal.emptyTitle")}</strong>
                  <p>${t("workbench.safety.journal.emptyBody")}</p>
                </div>`
              : html`<ol class="workbench-journal-list">
                  ${props.events.map((event) => {
                    const presentation = journalEventPresentation(event);
                    const timestamp = new Date(event.at);
                    return html`<li>
                      <span
                        class="workbench-journal-list__type is-${event.type}"
                        aria-hidden="true"
                      ></span>
                      <div class="workbench-journal-list__content">
                        <strong>${presentation.title}</strong>
                        <span>${presentation.detail}</span>
                        <small
                          >${Number.isFinite(timestamp.getTime())
                            ? timestamp.toLocaleString()
                            : event.at}</small
                        >
                      </div>
                      <span class="workbench-journal-list__outcome">${presentation.outcome}</span>
                    </li>`;
                  })}
                </ol>`}
          </section>
        </div>

        <aside class="workbench-safety-aside">
          <section class="workbench-runtime-card">
            <p class="workbench-kicker">${t("workbench.safety.runtime.kicker")}</p>
            <h2>${t("workbench.safety.runtime.heading")}</h2>
            <p>${runtimeDetail(props.runtime)}</p>
            <button class="btn" type="button" @click=${props.onRefresh}>
              ${t("workbench.safety.runtime.check")}
            </button>
          </section>
          <section class="workbench-boundary-card">
            <p class="workbench-kicker">${t("workbench.safety.boundaries.kicker")}</p>
            <h2>${t("workbench.safety.boundaries.heading")}</h2>
            <ul>
              <li>${t("workbench.safety.boundaries.notSandbox")}</li>
              <li>${t("workbench.safety.boundaries.unknown")}</li>
              <li>${t("workbench.safety.boundaries.operator")}</li>
              <li>${t("workbench.safety.boundaries.separateGateways")}</li>
            </ul>
          </section>
        </aside>
      </div>
    </section>
  `;
}
