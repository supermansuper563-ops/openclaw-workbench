import { html } from "lit";
import type { RouteId } from "../../app-route-paths.ts";
import { t } from "../../i18n/index.ts";
import type { WorkbenchReadinessItem } from "./types.ts";

type CapabilityCard = {
  title: string;
  body: string;
  route: RouteId;
  accent: string;
};

export type WorkbenchOverviewViewProps = {
  readiness: readonly WorkbenchReadinessItem[];
  onCreateMission: () => void;
  onNavigate: (route: RouteId) => void;
  onRunChecks: () => void;
  onStartSetup: () => void;
};

export function renderWorkbenchOverview(props: WorkbenchOverviewViewProps) {
  const readyCount = props.readiness.filter((item) => item.phase === "ready").length;
  const percent = Math.round((readyCount / props.readiness.length) * 100);
  const capabilityCards: CapabilityCard[] = [
    {
      title: t("workbench.capabilities.workboard.title"),
      body: t("workbench.capabilities.workboard.body"),
      route: "workboard",
      accent: "violet",
    },
    {
      title: t("workbench.capabilities.tasks.title"),
      body: t("workbench.capabilities.tasks.body"),
      route: "tasks",
      accent: "cyan",
    },
    {
      title: t("workbench.capabilities.automations.title"),
      body: t("workbench.capabilities.automations.body"),
      route: "cron",
      accent: "amber",
    },
    {
      title: t("workbench.capabilities.approvals.title"),
      body: t("workbench.capabilities.approvals.body"),
      route: "approvals",
      accent: "rose",
    },
    {
      title: t("workbench.capabilities.memory.title"),
      body: t("workbench.capabilities.memory.body"),
      route: "memory",
      accent: "blue",
    },
    {
      title: t("workbench.capabilities.channels.title"),
      body: t("workbench.capabilities.channels.body"),
      route: "channels",
      accent: "green",
    },
  ];
  return html`
    <section class="workbench-hero">
      <div class="workbench-hero__copy">
        <p class="workbench-kicker">${t("workbench.overview.kicker")}</p>
        <h1>${t("workbench.overview.heading")}</h1>
        <p>${t("workbench.overview.intro")}</p>
        <div class="workbench-hero__actions">
          <button class="btn primary" type="button" @click=${props.onStartSetup}>
            ${t("workbench.overview.startSetup")}
          </button>
          <button class="btn" type="button" @click=${props.onCreateMission}>
            ${t("workbench.overview.createMission")}
          </button>
        </div>
      </div>
      <div class="workbench-readiness" aria-label=${t("workbench.overview.readinessLabel")}>
        <div class="workbench-readiness__ring" style=${`--readiness: ${percent * 3.6}deg`}>
          <span>${percent}%</span>
        </div>
        <div>
          <div class="workbench-readiness__label">${t("workbench.overview.readinessLabel")}</div>
          <div class="workbench-readiness__value">
            ${t("workbench.overview.readinessSummary", {
              ready: String(readyCount),
              total: String(props.readiness.length),
            })}
          </div>
          <small>${t("workbench.overview.readinessDisclosure")}</small>
        </div>
      </div>
    </section>

    <section class="workbench-section">
      <div class="workbench-section__heading">
        <div>
          <p class="workbench-kicker">${t("workbench.overview.healthKicker")}</p>
          <h2>${t("workbench.overview.healthHeading")}</h2>
          <p>${t("workbench.overview.healthBody")}</p>
        </div>
        <button class="btn" type="button" @click=${props.onRunChecks}>
          ${t("workbench.overview.runChecks")}
        </button>
      </div>
      <div class="workbench-health-grid">
        ${props.readiness.map(
          (item) => html`<button
            type="button"
            class="workbench-health-card is-${item.phase}"
            @click=${() => props.onNavigate(item.route)}
          >
            <span class="workbench-health-card__phase" aria-hidden="true"></span>
            <span>
              <small>${t(`workbench.status.${item.phase}`)}</small>
              <strong>${item.title}</strong>
              <span>${item.detail}</span>
            </span>
            <span class="workbench-card__arrow" aria-hidden="true">→</span>
          </button>`,
        )}
      </div>
    </section>

    <section class="workbench-section">
      <div class="workbench-section__heading">
        <div>
          <p class="workbench-kicker">${t("workbench.overview.operateKicker")}</p>
          <h2>${t("workbench.overview.operateHeading")}</h2>
          <p>${t("workbench.overview.operateBody")}</p>
        </div>
      </div>
      <div class="workbench-capability-grid">
        ${capabilityCards.map(
          (card) => html`<button
            type="button"
            class="workbench-capability-card workbench-capability-card--${card.accent}"
            @click=${() => props.onNavigate(card.route)}
          >
            <span class="workbench-capability-card__mark" aria-hidden="true"></span>
            <strong>${card.title}</strong>
            <span>${card.body}</span>
            <span class="workbench-card__arrow" aria-hidden="true">→</span>
          </button>`,
        )}
      </div>
    </section>
  `;
}
