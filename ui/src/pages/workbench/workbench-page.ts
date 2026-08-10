import { consume } from "@lit/context";
import { html } from "lit";
import { state } from "lit/decorators.js";
import { titleForRoute } from "../../app-navigation.ts";
import type { RouteId } from "../../app-route-paths.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { hasOperatorAdminAccess } from "../../app/operator-access.ts";
import { t } from "../../i18n/index.ts";
import { canCallGatewayMethod } from "../../lib/gateway-methods.ts";
import { isWorkboardEnabledInConfigSnapshot } from "../../lib/plugin-activation.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { SubscriptionsController } from "../../lit/subscriptions-controller.ts";
import {
  canVerifyWorkbenchModel,
  readWorkbenchGatewayIdentity,
  WorkbenchGatewayEvidence,
  workbenchModelVerifyUnavailableReason,
} from "./gateway-evidence.ts";
import { renderWorkbenchMissionView } from "./mission-view.ts";
import {
  clearGuardrailsJournal,
  configureWorkbenchFoundation,
  createWorkbenchMission,
  listGuardrailsJournal,
  readGuardrailsRuntime,
  verifyWorkbenchModel,
} from "./operations.ts";
import { renderWorkbenchOverview } from "./overview-view.ts";
import {
  isWorkbenchGuardrailsActive,
  isWorkbenchGuardrailsEnabled,
  isWorkbenchModelConfigured,
  isWorkbenchModelVerified,
  readWorkbenchApprovalTtlMinutes,
  readWorkbenchGuardrailsProfile,
  resolveWorkbenchChannelHealth,
} from "./readiness.ts";
import { renderWorkbenchSafetyView } from "./safety-view.ts";
import { renderWorkbenchSetupView } from "./setup-view.ts";
import type {
  WorkbenchCheckState,
  WorkbenchGuardrailJournalEvent,
  WorkbenchGuardrailsProfile,
  WorkbenchGuardrailsRuntime,
  WorkbenchMissionDraft,
  WorkbenchMissionResult,
  WorkbenchOperationState,
  WorkbenchReadinessItem,
  WorkbenchSetupStep,
  WorkbenchView,
} from "./types.ts";
import "../../styles/workbench.css";
import "../../styles/workbench-controls.css";

class WorkbenchPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context!: ApplicationContext;

  @state() private activeView: WorkbenchView = "overview";
  @state() private setupStep: WorkbenchSetupStep = "gateway";
  @state() private modelCheck: WorkbenchCheckState = { phase: "idle" };
  @state() private guardrailsRuntime: WorkbenchGuardrailsRuntime = { phase: "idle" };
  @state() private journalEvents: WorkbenchGuardrailJournalEvent[] = [];
  @state() private journalLoading = false;
  @state() private journalError: string | null = null;
  @state() private channelProbing = false;
  @state() private guardrailsProfile: WorkbenchGuardrailsProfile = "personal-safe";
  @state() private approvalTtlMinutes = 60;
  @state() private foundationOperation: WorkbenchOperationState = { phase: "idle" };
  @state() private missionDraft: WorkbenchMissionDraft = {
    title: "",
    notes: "",
    priority: "normal",
    agentId: "",
  };
  @state() private missionOperation: WorkbenchOperationState = { phase: "idle" };
  @state() private missionResult: WorkbenchMissionResult | null = null;

  private guardrailsDraftTouched = false;
  private readonly gatewayEvidence = new WorkbenchGatewayEvidence();
  private modelCheckToken: object | null = null;
  private guardrailsRefreshToken: object | null = null;
  private channelRefreshToken: object | null = null;
  private guardrailsConfigRefreshToken: object | null = null;
  private guardrailsConfigClient: ApplicationContext["gateway"]["snapshot"]["client"] = null;
  private guardrailsConfigBaselineSnapshot: ApplicationContext["runtimeConfig"]["state"]["configSnapshot"] =
    null;
  private foundationApplyToken: object | null = null;
  private missionCreateToken: object | null = null;

  private readonly subscriptions = new SubscriptionsController(this)
    .watch(
      () => this.context?.gateway,
      (gateway, notify) => gateway.subscribe(notify),
      (gateway) => this.synchronizeGateway(gateway.snapshot),
    )
    .watch(
      () => this.context?.agents,
      (agents, notify) => agents.subscribe(notify),
    )
    .watch(
      () => this.context?.channels,
      (channels, notify) => channels.subscribe(notify),
      (channels) => this.synchronizeChannels(channels.state),
    )
    .watch(
      () => this.context?.runtimeConfig,
      (runtimeConfig, notify) => runtimeConfig.subscribe(notify),
      () => this.synchronizeRuntimeConfig(),
    )
    .watch(
      () => this.context?.workboard,
      (workboard, notify) => workboard.subscribe(notify),
    );

  override firstUpdated() {
    const firstRun = new URLSearchParams(window.location.search).get("firstRun") === "1";
    if (firstRun) {
      this.activeView = "setup";
    }
    if (this.context.gateway.snapshot.phase === "connected") {
      void this.refreshGuardrailsConfigForCurrentConnection();
      void this.refreshGuardrails();
    }
  }

  override disconnectedCallback() {
    this.modelCheckToken = null;
    this.guardrailsRefreshToken = null;
    this.channelRefreshToken = null;
    this.guardrailsConfigRefreshToken = null;
    this.guardrailsConfigBaselineSnapshot = null;
    this.foundationApplyToken = null;
    this.missionCreateToken = null;
    this.subscriptions.clear();
    super.disconnectedCallback();
  }

  private currentConfig(): unknown {
    const snapshot = this.context.runtimeConfig.state.configSnapshot;
    return snapshot?.runtimeConfig ?? snapshot?.resolved ?? snapshot?.config;
  }

  private syncGuardrailsDraft() {
    if (this.guardrailsDraftTouched) {
      return;
    }
    const config = this.currentConfig();
    this.guardrailsProfile = readWorkbenchGuardrailsProfile(config);
    this.approvalTtlMinutes = readWorkbenchApprovalTtlMinutes(config);
  }

  private hasCurrentGuardrailsConfig(): boolean {
    const identity = readWorkbenchGatewayIdentity(this.context.gateway.snapshot);
    return Boolean(
      identity.connected &&
      identity.client &&
      this.guardrailsConfigClient === identity.client &&
      this.context.runtimeConfig.state.client === identity.client,
    );
  }

  private synchronizeRuntimeConfig(): void {
    if (this.hasCurrentGuardrailsConfig()) {
      this.syncGuardrailsDraft();
      return;
    }
    const identity = readWorkbenchGatewayIdentity(this.context.gateway.snapshot);
    const state = this.context.runtimeConfig.state;
    if (
      !this.guardrailsConfigRefreshToken ||
      !identity.connected ||
      !identity.client ||
      state.client !== identity.client ||
      state.configLoading ||
      state.lastError ||
      !state.configSnapshot ||
      state.configSnapshot === this.guardrailsConfigBaselineSnapshot
    ) {
      return;
    }
    this.guardrailsConfigRefreshToken = null;
    this.guardrailsConfigBaselineSnapshot = null;
    this.guardrailsConfigClient = identity.client;
    this.syncGuardrailsDraft();
    this.requestUpdate();
  }

  private async refreshGuardrailsConfigForCurrentConnection(): Promise<void> {
    const identity = readWorkbenchGatewayIdentity(this.context.gateway.snapshot);
    if (!identity.connected || !identity.client) {
      return;
    }
    const token = {};
    const previousSnapshot = this.context.runtimeConfig.state.configSnapshot;
    this.guardrailsConfigRefreshToken = token;
    this.guardrailsConfigBaselineSnapshot = previousSnapshot;
    try {
      await this.context.runtimeConfig.refresh();
    } catch {
      return;
    }
    if (
      this.guardrailsConfigRefreshToken !== token ||
      !this.gatewayEvidence.isCurrent(identity, this.context.gateway.snapshot) ||
      this.context.runtimeConfig.state.client !== identity.client ||
      !this.context.runtimeConfig.state.configSnapshot ||
      this.context.runtimeConfig.state.configSnapshot === previousSnapshot ||
      this.context.runtimeConfig.state.lastError
    ) {
      return;
    }
    this.guardrailsConfigRefreshToken = null;
    this.guardrailsConfigBaselineSnapshot = null;
    this.guardrailsConfigClient = identity.client;
    this.syncGuardrailsDraft();
    this.requestUpdate();
  }

  private canAdminister(): boolean {
    return hasOperatorAdminAccess(this.context.gateway.snapshot.hello?.auth ?? null);
  }

  private invalidateLiveEvidence(): void {
    this.modelCheckToken = null;
    this.guardrailsRefreshToken = null;
    this.channelRefreshToken = null;
    this.guardrailsConfigRefreshToken = null;
    this.guardrailsConfigBaselineSnapshot = null;
    this.guardrailsConfigClient = null;
    this.foundationApplyToken = null;
    this.missionCreateToken = null;
    this.modelCheck = { phase: "idle" };
    this.guardrailsRuntime = { phase: "idle" };
    this.journalEvents = [];
    this.journalLoading = false;
    this.journalError = null;
    this.channelProbing = false;
    this.guardrailsDraftTouched = false;
    this.guardrailsProfile = "personal-safe";
    this.approvalTtlMinutes = 60;
    this.foundationOperation = { phase: "idle" };
    this.missionOperation = { phase: "idle" };
    this.missionResult = null;
    if (this.missionDraft.agentId) {
      this.missionDraft = { ...this.missionDraft, agentId: "" };
    }
    this.gatewayEvidence.invalidateChannelEvidence();
  }

  private synchronizeGateway(snapshot: ApplicationContext["gateway"]["snapshot"]): void {
    const observation = this.gatewayEvidence.observeGateway(snapshot, this.context.channels.state);
    if (!observation.changed) {
      return;
    }
    this.invalidateLiveEvidence();
    if (!observation.identity.connected || !observation.identity.client) {
      return;
    }
    void this.refreshGuardrailsConfigForCurrentConnection();
    void this.refreshGuardrails();
    void this.refreshChannelsForCurrentConnection(false);
  }

  private synchronizeChannels(state: ApplicationContext["channels"]["state"]): void {
    this.gatewayEvidence.observeChannels(this.context.gateway.snapshot, state);
  }

  private hasCurrentChannelEvidence(): boolean {
    return this.gatewayEvidence.hasCurrentChannelEvidence(
      this.context.gateway.snapshot,
      this.context.channels.state,
    );
  }

  private canVerifyModel(): boolean {
    return canVerifyWorkbenchModel(this.context.gateway.snapshot);
  }

  private modelVerifyUnavailableReason(): string | null {
    return workbenchModelVerifyUnavailableReason(this.context.gateway.snapshot);
  }

  private workboardAvailable(): boolean {
    return (
      isWorkboardEnabledInConfigSnapshot(this.context.runtimeConfig.state.configSnapshot) &&
      canCallGatewayMethod(
        this.context.gateway.snapshot,
        "workboard.cards.create",
        "operator.write",
      )
    );
  }

  private buildReadiness(): WorkbenchReadinessItem[] {
    const gatewayConnected = this.context.gateway.snapshot.phase === "connected";
    const modelConfigured = isWorkbenchModelConfigured(this.currentConfig());
    const channelState = this.context.channels.state;
    const channelEvidenceCurrent = this.hasCurrentChannelEvidence();
    const channelHealth = resolveWorkbenchChannelHealth(
      channelEvidenceCurrent ? channelState.channelsSnapshot : null,
    );
    const channelLive = Math.max(channelHealth.running, channelHealth.connected);
    const channelChecking =
      gatewayConnected && (this.channelProbing || channelState.channelsLoading);
    const guardrailsConfigured = isWorkbenchGuardrailsEnabled(this.currentConfig());

    return [
      {
        id: "gateway",
        phase: gatewayConnected ? "ready" : "blocked",
        title: t("workbench.readiness.gatewayTitle"),
        detail: gatewayConnected
          ? t("workbench.readiness.gatewayReady")
          : t("workbench.readiness.gatewayBlocked"),
        route: "connection",
      },
      {
        id: "model",
        phase:
          this.modelCheck.phase === "checking"
            ? "checking"
            : gatewayConnected && isWorkbenchModelVerified(this.modelCheck)
              ? "ready"
              : "attention",
        title: t("workbench.readiness.modelTitle"),
        detail:
          this.modelCheck.phase === "ready" ||
          this.modelCheck.phase === "attention" ||
          this.modelCheck.phase === "error"
            ? this.modelCheck.detail
            : modelConfigured
              ? t("workbench.readiness.modelConfigured")
              : t("workbench.readiness.modelMissing"),
        route: "model-setup",
      },
      {
        id: "channel",
        phase: channelChecking ? "checking" : channelLive > 0 ? "ready" : "attention",
        title: t("workbench.readiness.channelTitle"),
        detail: !gatewayConnected
          ? t("workbench.readiness.channelDisconnected")
          : channelChecking
            ? t("workbench.readiness.channelChecking")
            : channelState.channelsError
              ? t("workbench.readiness.channelError")
              : !channelEvidenceCurrent
                ? t("workbench.readiness.channelStale")
                : channelLive > 0
                  ? t("workbench.readiness.channelReady", { count: String(channelLive) })
                  : channelHealth.configured > 0
                    ? t("workbench.readiness.channelConfigured")
                    : t("workbench.readiness.channelMissing"),
        route: "channels",
      },
      {
        id: "guardrails",
        phase:
          this.guardrailsRuntime.phase === "loading"
            ? "checking"
            : gatewayConnected && isWorkbenchGuardrailsActive(this.guardrailsRuntime)
              ? "ready"
              : "attention",
        title: t("workbench.readiness.guardrailsTitle"),
        detail:
          this.guardrailsRuntime.phase === "active"
            ? t("workbench.readiness.guardrailsReady", {
                profile: t(`workbench.profiles.${this.guardrailsRuntime.profile}.title`),
              })
            : guardrailsConfigured
              ? t("workbench.readiness.guardrailsDegraded")
              : t("workbench.readiness.guardrailsMissing"),
        route: "plugins",
      },
    ];
  }

  private async refreshGuardrails(): Promise<void> {
    const identity = readWorkbenchGatewayIdentity(this.context.gateway.snapshot);
    if (!identity.connected || !identity.client) {
      this.guardrailsRefreshToken = null;
      this.guardrailsRuntime = { phase: "idle" };
      this.journalEvents = [];
      this.journalLoading = false;
      this.journalError = null;
      return;
    }
    const token = {};
    this.guardrailsRefreshToken = token;
    this.guardrailsRuntime = { phase: "loading" };
    this.journalLoading = true;
    this.journalError = null;
    const [runtime, journalResult] = await Promise.all([
      readGuardrailsRuntime(this.context),
      listGuardrailsJournal(this.context)
        .then((events) => ({ events, error: null as string | null }))
        .catch((error) => ({
          events: [],
          error: error instanceof Error ? error.message : String(error),
        })),
    ]);
    if (
      this.guardrailsRefreshToken !== token ||
      !this.gatewayEvidence.isCurrent(identity, this.context.gateway.snapshot)
    ) {
      return;
    }
    this.guardrailsRuntime = runtime;
    this.journalEvents = journalResult.events;
    this.journalError = journalResult.error;
    this.journalLoading = false;
  }

  private async verifyModel(): Promise<void> {
    const identity = readWorkbenchGatewayIdentity(this.context.gateway.snapshot);
    const client = identity.client;
    if (!client || !this.canVerifyModel()) {
      this.modelCheck = {
        phase: "error",
        detail: this.modelVerifyUnavailableReason() ?? t("workbench.errors.gatewayRequired"),
        checkedAt: Date.now(),
      };
      return;
    }
    const token = {};
    this.modelCheckToken = token;
    this.modelCheck = { phase: "checking" };
    const result = await verifyWorkbenchModel(client);
    if (
      this.modelCheckToken === token &&
      this.gatewayEvidence.isCurrent(identity, this.context.gateway.snapshot)
    ) {
      this.modelCheck = result;
    }
  }

  private async refreshChannelsForCurrentConnection(probe: boolean): Promise<void> {
    const identity = readWorkbenchGatewayIdentity(this.context.gateway.snapshot);
    if (!identity.connected || !identity.client || (probe && this.channelProbing)) {
      return;
    }
    const token = {};
    this.channelRefreshToken = token;
    this.gatewayEvidence.invalidateChannelEvidence();
    if (probe) {
      this.channelProbing = true;
    }
    try {
      await this.context.channels.refresh(probe);
    } finally {
      if (
        this.channelRefreshToken !== token ||
        !this.gatewayEvidence.isCurrent(identity, this.context.gateway.snapshot)
      ) {
        return;
      }
      if (!this.context.channels.state.channelsError) {
        this.gatewayEvidence.markChannelsCurrent(identity, this.context.channels.state);
      }
      if (probe) {
        this.channelProbing = false;
      }
    }
  }

  private async probeChannels(): Promise<void> {
    await this.refreshChannelsForCurrentConnection(true);
  }

  private async refreshAll(): Promise<void> {
    await Promise.all([this.verifyModel(), this.probeChannels(), this.refreshGuardrails()]);
  }

  private async applyFoundation(): Promise<void> {
    if (this.foundationOperation.phase === "running" || !this.hasCurrentGuardrailsConfig()) {
      return;
    }
    const identity = readWorkbenchGatewayIdentity(this.context.gateway.snapshot);
    const token = {};
    this.foundationApplyToken = token;
    this.foundationOperation = {
      phase: "running",
      message: t("workbench.safety.applyingDetail"),
    };
    try {
      const result = await configureWorkbenchFoundation({
        context: this.context,
        profile: this.guardrailsProfile,
        approvalTtlMinutes: this.approvalTtlMinutes,
        enableWorkboard: true,
      });
      if (
        this.foundationApplyToken !== token ||
        !this.gatewayEvidence.isCurrent(identity, this.context.gateway.snapshot)
      ) {
        return;
      }
      this.foundationApplyToken = null;
      this.guardrailsDraftTouched = false;
      this.syncGuardrailsDraft();
      this.foundationOperation = {
        phase: "success",
        message: result.applied
          ? t("workbench.safety.appliedRestarting")
          : t("workbench.safety.appliedRestartRequired"),
      };
      if (this.context.gateway.snapshot.phase === "connected") {
        await this.refreshGuardrails();
      }
    } catch (error) {
      if (
        this.foundationApplyToken !== token ||
        !this.gatewayEvidence.isCurrent(identity, this.context.gateway.snapshot)
      ) {
        return;
      }
      this.foundationApplyToken = null;
      this.foundationOperation = {
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async clearJournal(): Promise<void> {
    if (!window.confirm(t("workbench.safety.journal.clearConfirm"))) {
      return;
    }
    const identity = readWorkbenchGatewayIdentity(this.context.gateway.snapshot);
    try {
      await clearGuardrailsJournal(this.context);
      if (!this.gatewayEvidence.isCurrent(identity, this.context.gateway.snapshot)) {
        return;
      }
      this.journalEvents = [];
      await this.refreshGuardrails();
    } catch (error) {
      if (this.gatewayEvidence.isCurrent(identity, this.context.gateway.snapshot)) {
        this.journalError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  private async createMission(): Promise<void> {
    if (this.missionOperation.phase === "running") {
      return;
    }
    const identity = readWorkbenchGatewayIdentity(this.context.gateway.snapshot);
    const token = {};
    this.missionCreateToken = token;
    this.missionOperation = {
      phase: "running",
      message: t("workbench.mission.creatingDetail"),
    };
    this.missionResult = null;
    try {
      const result = await createWorkbenchMission(this.context, this.missionDraft);
      if (
        this.missionCreateToken !== token ||
        !this.gatewayEvidence.isCurrent(identity, this.context.gateway.snapshot)
      ) {
        return;
      }
      this.missionCreateToken = null;
      this.missionResult = result;
      this.missionOperation = {
        phase: "success",
        message: t("workbench.mission.createdMessage"),
      };
    } catch (error) {
      if (
        this.missionCreateToken !== token ||
        !this.gatewayEvidence.isCurrent(identity, this.context.gateway.snapshot)
      ) {
        return;
      }
      this.missionCreateToken = null;
      this.missionOperation = {
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private selectProfile(profile: WorkbenchGuardrailsProfile) {
    if (this.foundationOperation.phase === "running" || !this.hasCurrentGuardrailsConfig()) {
      return;
    }
    this.foundationApplyToken = null;
    this.guardrailsDraftTouched = true;
    this.guardrailsProfile = profile;
    this.foundationOperation = { phase: "idle" };
  }

  private selectTtl(minutes: number) {
    if (this.foundationOperation.phase === "running" || !this.hasCurrentGuardrailsConfig()) {
      return;
    }
    this.foundationApplyToken = null;
    this.guardrailsDraftTouched = true;
    this.approvalTtlMinutes = minutes;
    this.foundationOperation = { phase: "idle" };
  }

  private updateMissionDraft(patch: Partial<WorkbenchMissionDraft>) {
    this.missionCreateToken = null;
    this.missionDraft = { ...this.missionDraft, ...patch };
    this.missionOperation = { phase: "idle" };
    this.missionResult = null;
  }

  private navigate(route: RouteId) {
    this.context.navigate(route);
  }

  private renderNavigation() {
    const items: Array<{ id: WorkbenchView; label: string }> = [
      { id: "overview", label: t("workbench.views.overview") },
      { id: "setup", label: t("workbench.views.setup") },
      { id: "safety", label: t("workbench.views.safety") },
      { id: "mission", label: t("workbench.views.mission") },
    ];
    return html`<nav class="workbench-view-nav" aria-label=${t("workbench.views.label")}>
      ${items.map(
        (item) => html`<button
          type="button"
          class=${this.activeView === item.id ? "is-active" : ""}
          aria-current=${this.activeView === item.id ? "page" : "false"}
          @click=${() => {
            this.activeView = item.id;
          }}
        >
          ${item.label}
        </button>`,
      )}
    </nav>`;
  }

  private renderOverview(readiness: readonly WorkbenchReadinessItem[]) {
    return renderWorkbenchOverview({
      readiness,
      onCreateMission: () => (this.activeView = "mission"),
      onNavigate: (route) => this.navigate(route),
      onRunChecks: () => void this.refreshAll(),
      onStartSetup: () => (this.activeView = "setup"),
    });
  }
  override render() {
    const readiness = this.buildReadiness();
    const channelHealth = resolveWorkbenchChannelHealth(
      this.hasCurrentChannelEvidence() ? this.context.channels.state.channelsSnapshot : null,
    );
    const agents = (this.context.agents.state.agentsList?.agents ?? []).map((agent) => ({
      id: agent.id,
      label: agent.name?.trim() || agent.id,
    }));
    const view =
      this.activeView === "setup"
        ? renderWorkbenchSetupView({
            step: this.setupStep,
            readiness,
            gatewayConnected: this.context.gateway.snapshot.phase === "connected",
            canVerifyModel: this.canVerifyModel(),
            modelVerifyUnavailableReason: this.modelVerifyUnavailableReason(),
            modelCheck: this.modelCheck,
            channelHealth,
            channelProbing: this.channelProbing,
            profile: this.guardrailsProfile,
            approvalTtlMinutes: this.approvalTtlMinutes,
            operation: this.foundationOperation,
            canAdminister: this.canAdminister(),
            configurationReady: this.hasCurrentGuardrailsConfig(),
            onStepChange: (step) => (this.setupStep = step),
            onNavigate: (route) => this.navigate(route),
            onVerifyModel: () => void this.verifyModel(),
            onProbeChannels: () => void this.probeChannels(),
            onProfileChange: (profile) => this.selectProfile(profile),
            onTtlChange: (minutes) => this.selectTtl(minutes),
            onApplyFoundation: () => void this.applyFoundation(),
            onFinish: () => (this.activeView = "overview"),
          })
        : this.activeView === "safety"
          ? renderWorkbenchSafetyView({
              runtime: this.guardrailsRuntime,
              events: this.journalEvents,
              journalLoading: this.journalLoading,
              journalError: this.journalError,
              profile: this.guardrailsProfile,
              approvalTtlMinutes: this.approvalTtlMinutes,
              operation: this.foundationOperation,
              canAdminister: this.canAdminister(),
              configurationReady: this.hasCurrentGuardrailsConfig(),
              onProfileChange: (profile) => this.selectProfile(profile),
              onTtlChange: (minutes) => this.selectTtl(minutes),
              onApply: () => void this.applyFoundation(),
              onRefresh: () => void this.refreshGuardrails(),
              onClear: () => void this.clearJournal(),
            })
          : this.activeView === "mission"
            ? renderWorkbenchMissionView({
                draft: this.missionDraft,
                agents,
                operation: this.missionOperation,
                result: this.missionResult,
                workboardAvailable: this.workboardAvailable(),
                onDraftChange: (patch) => this.updateMissionDraft(patch),
                onCreate: () => void this.createMission(),
                onOpenWorkboard: () => this.navigate("workboard"),
                onEnableWorkboard: () => {
                  this.setupStep = "safety";
                  this.activeView = "setup";
                },
              })
            : this.renderOverview(readiness);

    return html`
      <section class="content-header workbench-header">
        <div class="page-title">${titleForRoute("workbench")}</div>
        ${this.renderNavigation()}
      </section>
      <main class="workbench-page">${view}</main>
    `;
  }
}

if (!customElements.get("openclaw-workbench-page")) {
  customElements.define("openclaw-workbench-page", WorkbenchPage);
}
