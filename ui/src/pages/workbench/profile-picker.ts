import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import {
  WORKBENCH_PROFILE_OPTIONS,
  type WorkbenchGuardrailsProfile,
  type WorkbenchOperationState,
} from "./types.ts";

export type WorkbenchProfilePickerProps = {
  profile: WorkbenchGuardrailsProfile;
  approvalTtlMinutes: number;
  disabled: boolean;
  operation: WorkbenchOperationState;
  compact?: boolean;
  onProfileChange: (profile: WorkbenchGuardrailsProfile) => void;
  onTtlChange: (minutes: number) => void;
  onApply: () => void;
};

const WORKBENCH_APPROVAL_TTL_PRESETS = [15, 30, 60, 240, 1440] as const;

function operationNotice(operation: WorkbenchOperationState) {
  if (operation.phase === "idle") {
    return nothing;
  }
  return html`
    <div
      class="workbench-notice workbench-notice--${operation.phase}"
      role=${operation.phase === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span class="workbench-notice__dot" aria-hidden="true"></span>
      <span>${operation.message}</span>
    </div>
  `;
}

export function renderWorkbenchProfilePicker(props: WorkbenchProfilePickerProps) {
  const approvalTtlMinutes =
    Number.isFinite(props.approvalTtlMinutes) &&
    props.approvalTtlMinutes >= 1 &&
    props.approvalTtlMinutes <= 10_080
      ? Math.floor(props.approvalTtlMinutes)
      : 60;
  const hasPreset = WORKBENCH_APPROVAL_TTL_PRESETS.some(
    (minutes) => minutes === approvalTtlMinutes,
  );
  return html`
    <div class="workbench-profile-picker ${props.compact ? "is-compact" : ""}">
      <div
        class="workbench-profile-grid"
        role="radiogroup"
        aria-label=${t("workbench.safety.profileLabel")}
      >
        ${WORKBENCH_PROFILE_OPTIONS.map(
          (option) => html`
            <label
              class="workbench-profile workbench-profile--${option.tone} ${props.profile ===
              option.id
                ? "is-selected"
                : ""}"
            >
              <input
                type="radio"
                name="workbench-guardrails-profile"
                value=${option.id}
                .checked=${props.profile === option.id}
                ?disabled=${props.disabled}
                @change=${() => props.onProfileChange(option.id)}
              />
              <span class="workbench-profile__control" aria-hidden="true"></span>
              <span class="workbench-profile__copy">
                <strong>${t(`workbench.profiles.${option.id}.title`)}</strong>
                <span>${t(`workbench.profiles.${option.id}.summary`)}</span>
                <small>${t(`workbench.profiles.${option.id}.approval`)}</small>
              </span>
            </label>
          `,
        )}
      </div>

      <div class="workbench-safety-controls">
        <label class="workbench-field workbench-field--inline">
          <span>
            <strong>${t("workbench.safety.expiryLabel")}</strong>
            <small>${t("workbench.safety.expiryHelp")}</small>
          </span>
          <select
            .value=${String(approvalTtlMinutes)}
            ?disabled=${props.disabled}
            @change=${(event: Event) =>
              props.onTtlChange(Number((event.currentTarget as HTMLSelectElement).value))}
          >
            ${!hasPreset
              ? html`<option value=${String(approvalTtlMinutes)}>
                  ${t("workbench.safety.expiryCustom", {
                    minutes: String(approvalTtlMinutes),
                  })}
                </option>`
              : ""}
            <option value="15">${t("workbench.safety.expiry15")}</option>
            <option value="30">${t("workbench.safety.expiry30")}</option>
            <option value="60">${t("workbench.safety.expiry60")}</option>
            <option value="240">${t("workbench.safety.expiry240")}</option>
            <option value="1440">${t("workbench.safety.expiry1440")}</option>
          </select>
        </label>
        <div class="workbench-safety-controls__action">
          <button
            class="btn primary"
            type="button"
            ?disabled=${props.disabled || props.operation.phase === "running"}
            @click=${props.onApply}
          >
            ${props.operation.phase === "running"
              ? t("workbench.safety.applying")
              : t("workbench.safety.apply")}
          </button>
          <small>${t("workbench.safety.restartDisclosure")}</small>
        </div>
      </div>
      ${operationNotice(props.operation)}
    </div>
  `;
}
