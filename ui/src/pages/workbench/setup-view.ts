import { html } from "lit";
import type { RouteId } from "../../app-route-paths.ts";
import { t } from "../../i18n/index.ts";
import { renderWorkbenchProfilePicker } from "./profile-picker.ts";
import {
  WORKBENCH_SETUP_STEPS,
  type WorkbenchChannelHealth,
  type WorkbenchCheckState,
  type WorkbenchGuardrailsProfile,
  type WorkbenchOperationState,
  type WorkbenchReadinessItem,
  type WorkbenchSetupStep,
} from "./types.ts";

export type WorkbenchSetupViewProps = {
  step: WorkbenchSetupStep;
  readiness: readonly WorkbenchReadinessItem[];
  gatewayConnected: boolean;
  canVerifyModel: boolean;
  modelVerifyUnavailableReason: string | null;
  modelCheck: WorkbenchCheckState;
  channelHealth: WorkbenchChannelHealth;
  channelProbing: boolean;
  profile: WorkbenchGuardrailsProfile;
  approvalTtlMinutes: number;
  operation: WorkbenchOperationState;
  canAdminister: boolean;
  configurationReady: boolean;
  onStepChange: (step: WorkbenchSetupStep) => void;
  onNavigate: (route: RouteId) => void;
  onVerifyModel: () => void;
  onProbeChannels: () => void;
  onProfileChange: (profile: WorkbenchGuardrailsProfile) => void;
  onTtlChange: (minutes: number) => void;
  onApplyFoundation: () => void;
  onFinish: () => void;
};

function phaseLabel(phase: WorkbenchReadinessItem["phase"]): string {
  if (phase === "ready") {
    return t("workbench.status.ready");
  }
  if (phase === "checking") {
    return t("workbench.status.checking");
  }
  if (phase === "blocked") {
    return t("workbench.status.blocked");
  }
  return t("workbench.status.attention");
}

function setupStepBody(props: WorkbenchSetupViewProps) {
  if (props.step === "gateway") {
    return html`
      <div class="workbench-step__body">
        <div class="workbench-step__icon workbench-step__icon--gateway" aria-hidden="true">01</div>
        <div>
          <p class="workbench-kicker">${t("workbench.setup.gateway.kicker")}</p>
          <h2>${t("workbench.setup.gateway.title")}</h2>
          <p>${t("workbench.setup.gateway.body")}</p>
          <div class="workbench-evidence ${props.gatewayConnected ? "is-ready" : "is-attention"}">
            <span class="workbench-evidence__pulse" aria-hidden="true"></span>
            <div>
              <strong
                >${props.gatewayConnected
                  ? t("workbench.setup.gateway.connected")
                  : t("workbench.setup.gateway.disconnected")}</strong
              >
              <span>${t("workbench.setup.gateway.evidence")}</span>
            </div>
          </div>
          <button class="btn" type="button" @click=${() => props.onNavigate("connection")}>
            ${t("workbench.setup.gateway.action")}
          </button>
        </div>
      </div>
    `;
  }

  if (props.step === "model") {
    return html`
      <div class="workbench-step__body">
        <div class="workbench-step__icon workbench-step__icon--model" aria-hidden="true">02</div>
        <div>
          <p class="workbench-kicker">${t("workbench.setup.model.kicker")}</p>
          <h2>${t("workbench.setup.model.title")}</h2>
          <p>${t("workbench.setup.model.body")}</p>
          <div class="workbench-evidence workbench-evidence--local">
            <span class="workbench-evidence__pulse" aria-hidden="true"></span>
            <div>
              <strong>${t("workbench.setup.model.localTitle")}</strong>
              <span>${t("workbench.setup.model.localBody")}</span>
            </div>
          </div>
          <div class="workbench-evidence is-${props.modelCheck.phase}">
            <span class="workbench-evidence__pulse" aria-hidden="true"></span>
            <div>
              <strong>${t(`workbench.setup.model.phase.${props.modelCheck.phase}`)}</strong>
              <span>
                ${props.modelCheck.phase === "idle" || props.modelCheck.phase === "checking"
                  ? t("workbench.setup.model.verifyHelp")
                  : props.modelCheck.detail}
              </span>
            </div>
          </div>
          <div class="workbench-inline-actions">
            <button
              class="btn primary"
              type="button"
              ?disabled=${!props.canVerifyModel || props.modelCheck.phase === "checking"}
              @click=${props.onVerifyModel}
            >
              ${props.modelCheck.phase === "checking"
                ? t("workbench.setup.model.verifying")
                : t("workbench.setup.model.verify")}
            </button>
            <button class="btn" type="button" @click=${() => props.onNavigate("model-setup")}>
              ${t("workbench.setup.model.configure")}
            </button>
          </div>
          ${props.modelVerifyUnavailableReason
            ? html`<p class="workbench-permission-warning" role="status">
                ${props.modelVerifyUnavailableReason}
              </p>`
            : ""}
        </div>
      </div>
    `;
  }

  if (props.step === "channel") {
    const channelReadiness = props.readiness.find((item) => item.id === "channel");
    return html`
      <div class="workbench-step__body">
        <div class="workbench-step__icon workbench-step__icon--channel" aria-hidden="true">03</div>
        <div>
          <p class="workbench-kicker">${t("workbench.setup.channel.kicker")}</p>
          <h2>${t("workbench.setup.channel.title")}</h2>
          <p>${t("workbench.setup.channel.body")}</p>
          <div class="workbench-channel-stats">
            <div>
              <strong>${props.channelHealth.configured}</strong
              ><span>${t("workbench.setup.channel.configured")}</span>
            </div>
            <div>
              <strong>${props.channelHealth.running}</strong
              ><span>${t("workbench.setup.channel.running")}</span>
            </div>
            <div>
              <strong>${props.channelHealth.connected}</strong
              ><span>${t("workbench.setup.channel.connected")}</span>
            </div>
          </div>
          <p class="workbench-supporting-copy">
            ${channelReadiness?.detail ?? t("workbench.readiness.channelStale")}
          </p>
          <div class="workbench-inline-actions">
            <button
              class="btn primary"
              type="button"
              ?disabled=${!props.gatewayConnected || props.channelProbing}
              @click=${props.onProbeChannels}
            >
              ${props.channelProbing
                ? t("workbench.setup.channel.probing")
                : t("workbench.setup.channel.probe")}
            </button>
            <button class="btn" type="button" @click=${() => props.onNavigate("channels")}>
              ${t("workbench.setup.channel.manage")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  if (props.step === "safety") {
    return html`
      <div class="workbench-step__body workbench-step__body--wide">
        <div class="workbench-step__icon workbench-step__icon--safety" aria-hidden="true">04</div>
        <div>
          <p class="workbench-kicker">${t("workbench.setup.safety.kicker")}</p>
          <h2>${t("workbench.setup.safety.title")}</h2>
          <p>${t("workbench.setup.safety.body")}</p>
          ${renderWorkbenchProfilePicker({
            profile: props.profile,
            approvalTtlMinutes: props.approvalTtlMinutes,
            disabled:
              !props.canAdminister ||
              !props.configurationReady ||
              props.operation.phase === "running",
            operation: props.operation,
            compact: true,
            onProfileChange: props.onProfileChange,
            onTtlChange: props.onTtlChange,
            onApply: props.onApplyFoundation,
          })}
          ${!props.canAdminister
            ? html`<p class="workbench-permission-warning" role="alert">
                ${t("workbench.setup.safety.adminRequired")}
              </p>`
            : ""}
        </div>
      </div>
    `;
  }

  const readyCount = props.readiness.filter((item) => item.phase === "ready").length;
  return html`
    <div class="workbench-step__body workbench-step__body--finish">
      <div class="workbench-step__icon workbench-step__icon--finish" aria-hidden="true">05</div>
      <div>
        <p class="workbench-kicker">${t("workbench.setup.finish.kicker")}</p>
        <h2>${t("workbench.setup.finish.title")}</h2>
        <p>${t("workbench.setup.finish.body")}</p>
        <div class="workbench-review-list">
          ${props.readiness.map(
            (item) => html`
              <button type="button" @click=${() => props.onNavigate(item.route)}>
                <span class="workbench-review-list__status is-${item.phase}"></span>
                <span><strong>${item.title}</strong><small>${item.detail}</small></span>
                <span class="workbench-review-list__phase">${phaseLabel(item.phase)}</span>
              </button>
            `,
          )}
        </div>
        <button class="btn primary workbench-finish-button" type="button" @click=${props.onFinish}>
          ${readyCount === props.readiness.length
            ? t("workbench.setup.finish.complete")
            : t("workbench.setup.finish.continue")}
        </button>
      </div>
    </div>
  `;
}

export function renderWorkbenchSetupView(props: WorkbenchSetupViewProps) {
  const stepIndex = WORKBENCH_SETUP_STEPS.indexOf(props.step);
  const previous = stepIndex > 0 ? WORKBENCH_SETUP_STEPS[stepIndex - 1] : undefined;
  const next =
    stepIndex < WORKBENCH_SETUP_STEPS.length - 1 ? WORKBENCH_SETUP_STEPS[stepIndex + 1] : undefined;
  return html`
    <section class="workbench-panel workbench-setup" aria-labelledby="workbench-setup-title">
      <div class="workbench-panel__header">
        <div>
          <p class="workbench-kicker">${t("workbench.setup.kicker")}</p>
          <h1 id="workbench-setup-title">${t("workbench.setup.heading")}</h1>
          <p>${t("workbench.setup.intro")}</p>
        </div>
        <span class="workbench-step-count">
          ${t("workbench.setup.stepCount", {
            current: String(stepIndex + 1),
            total: String(WORKBENCH_SETUP_STEPS.length),
          })}
        </span>
      </div>

      <nav class="workbench-stepper" aria-label=${t("workbench.setup.stepperLabel")}>
        ${WORKBENCH_SETUP_STEPS.map((step, index) => {
          const readiness = index < 4 ? props.readiness[index] : undefined;
          return html`
            <button
              type="button"
              class="${step === props.step ? "is-current" : ""} ${index < stepIndex
                ? "is-visited"
                : ""}"
              aria-current=${step === props.step ? "step" : "false"}
              @click=${() => props.onStepChange(step)}
            >
              <span class="workbench-stepper__index">${index + 1}</span>
              <span>${t(`workbench.setup.steps.${step}`)}</span>
              ${readiness
                ? html`<span
                    class="workbench-stepper__phase is-${readiness.phase}"
                    aria-hidden="true"
                  ></span>`
                : ""}
            </button>
          `;
        })}
      </nav>

      <div class="workbench-step">${setupStepBody(props)}</div>

      <div class="workbench-step__footer">
        <button
          class="btn"
          type="button"
          ?disabled=${!previous}
          @click=${() => previous && props.onStepChange(previous)}
        >
          ${t("workbench.setup.back")}
        </button>
        ${next
          ? html`<button class="btn primary" type="button" @click=${() => props.onStepChange(next)}>
              ${t("workbench.setup.next")}
            </button>`
          : ""}
      </div>
    </section>
  `;
}
