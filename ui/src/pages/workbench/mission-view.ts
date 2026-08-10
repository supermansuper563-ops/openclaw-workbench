import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  WorkbenchMissionDraft,
  WorkbenchMissionResult,
  WorkbenchOperationState,
} from "./types.ts";

export type WorkbenchAgentOption = {
  id: string;
  label: string;
};

export type WorkbenchMissionViewProps = {
  draft: WorkbenchMissionDraft;
  agents: readonly WorkbenchAgentOption[];
  operation: WorkbenchOperationState;
  result: WorkbenchMissionResult | null;
  workboardAvailable: boolean;
  onDraftChange: (patch: Partial<WorkbenchMissionDraft>) => void;
  onCreate: () => void;
  onOpenWorkboard: () => void;
  onEnableWorkboard: () => void;
};

export function renderWorkbenchMissionView(props: WorkbenchMissionViewProps) {
  const titleLength = props.draft.title.length;
  const normalizedTitleLength = props.draft.title.trim().length;
  const canSubmit =
    props.workboardAvailable &&
    props.operation.phase !== "running" &&
    normalizedTitleLength >= 3 &&
    normalizedTitleLength <= 240 &&
    props.draft.notes.length <= 8_000;
  return html`
    <section class="workbench-panel workbench-mission" aria-labelledby="workbench-mission-title">
      <div class="workbench-panel__header">
        <div>
          <p class="workbench-kicker">${t("workbench.mission.kicker")}</p>
          <h1 id="workbench-mission-title">${t("workbench.mission.heading")}</h1>
          <p>${t("workbench.mission.intro")}</p>
        </div>
        <span class="workbench-mission__mode">${t("workbench.mission.mode")}</span>
      </div>

      <div class="workbench-mission-layout">
        <form
          class="workbench-mission-form"
          @submit=${(event: SubmitEvent) => {
            event.preventDefault();
            if (canSubmit) {
              props.onCreate();
            }
          }}
        >
          <label class="workbench-field">
            <span><strong>${t("workbench.mission.titleLabel")}</strong></span>
            <input
              type="text"
              maxlength="240"
              autocomplete="off"
              placeholder=${t("workbench.mission.titlePlaceholder")}
              ?disabled=${props.operation.phase === "running"}
              .value=${props.draft.title}
              @input=${(event: InputEvent) =>
                props.onDraftChange({ title: (event.currentTarget as HTMLInputElement).value })}
            />
            <small class="workbench-field__counter ${titleLength > 240 ? "is-error" : ""}"
              >${titleLength}/240</small
            >
          </label>

          <label class="workbench-field">
            <span>
              <strong>${t("workbench.mission.notesLabel")}</strong>
              <small>${t("workbench.mission.notesHelp")}</small>
            </span>
            <textarea
              rows="8"
              maxlength="8000"
              placeholder=${t("workbench.mission.notesPlaceholder")}
              ?disabled=${props.operation.phase === "running"}
              .value=${props.draft.notes}
              @input=${(event: InputEvent) =>
                props.onDraftChange({ notes: (event.currentTarget as HTMLTextAreaElement).value })}
            ></textarea>
            <small class="workbench-field__counter">${props.draft.notes.length}/8,000</small>
          </label>

          <div class="workbench-form-row">
            <label class="workbench-field">
              <span><strong>${t("workbench.mission.agentLabel")}</strong></span>
              <select
                .value=${props.draft.agentId}
                ?disabled=${props.operation.phase === "running"}
                @change=${(event: Event) =>
                  props.onDraftChange({
                    agentId: (event.currentTarget as HTMLSelectElement).value,
                  })}
              >
                <option value="">${t("workbench.mission.defaultAgent")}</option>
                ${props.agents.map(
                  (agent) => html`<option value=${agent.id}>${agent.label}</option>`,
                )}
              </select>
            </label>
            <label class="workbench-field">
              <span><strong>${t("workbench.mission.priorityLabel")}</strong></span>
              <select
                .value=${props.draft.priority}
                ?disabled=${props.operation.phase === "running"}
                @change=${(event: Event) =>
                  props.onDraftChange({
                    priority: (event.currentTarget as HTMLSelectElement)
                      .value as WorkbenchMissionDraft["priority"],
                  })}
              >
                <option value="low">${t("workbench.mission.priority.low")}</option>
                <option value="normal">${t("workbench.mission.priority.normal")}</option>
                <option value="high">${t("workbench.mission.priority.high")}</option>
                <option value="urgent">${t("workbench.mission.priority.urgent")}</option>
              </select>
            </label>
          </div>

          ${!props.workboardAvailable
            ? html`<div class="workbench-notice workbench-notice--error" role="alert">
                <div>
                  <strong>${t("workbench.mission.workboardRequired")}</strong>
                  <span>${t("workbench.mission.workboardRequiredBody")}</span>
                </div>
                <button class="btn" type="button" @click=${props.onEnableWorkboard}>
                  ${t("workbench.mission.enableWorkboard")}
                </button>
              </div>`
            : nothing}
          ${props.operation.phase !== "idle"
            ? html`<div
                class="workbench-notice workbench-notice--${props.operation.phase}"
                role=${props.operation.phase === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                ${props.operation.message}
              </div>`
            : nothing}

          <div class="workbench-mission-form__footer">
            <div class="workbench-mission-form__review">
              <strong>${t("workbench.mission.reviewTitle")}</strong>
              <span>${t("workbench.mission.reviewBody")}</span>
            </div>
            <button class="btn primary" type="submit" ?disabled=${!canSubmit}>
              ${props.operation.phase === "running"
                ? t("workbench.mission.creating")
                : t("workbench.mission.create")}
            </button>
          </div>
        </form>

        <aside class="workbench-mission-preview">
          <p class="workbench-kicker">${t("workbench.mission.previewKicker")}</p>
          <h2>${props.draft.title.trim() || t("workbench.mission.previewUntitled")}</h2>
          <p>${props.draft.notes.trim() || t("workbench.mission.previewEmpty")}</p>
          <dl>
            <div>
              <dt>${t("workbench.mission.previewAgent")}</dt>
              <dd>
                ${props.agents.find((agent) => agent.id === props.draft.agentId)?.label ??
                t("workbench.mission.defaultAgent")}
              </dd>
            </div>
            <div>
              <dt>${t("workbench.mission.previewPriority")}</dt>
              <dd>${t(`workbench.mission.priority.${props.draft.priority}`)}</dd>
            </div>
            <div>
              <dt>${t("workbench.mission.previewDestination")}</dt>
              <dd>${t("workbench.mission.previewWorkboard")}</dd>
            </div>
          </dl>
          ${props.result
            ? html`<div class="workbench-mission-result" role="status">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>${t("workbench.mission.createdTitle")}</strong>
                  <p>${props.result.title}</p>
                  <code>${props.result.id}</code>
                  <button class="btn primary" type="button" @click=${props.onOpenWorkboard}>
                    ${t("workbench.mission.openWorkboard")}
                  </button>
                </div>
              </div>`
            : nothing}
        </aside>
      </div>
    </section>
  `;
}
