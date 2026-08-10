import type { ApplicationContext, ApplicationGatewaySnapshot } from "../../app/context.ts";
import { hasOperatorAdminAccess } from "../../app/operator-access.ts";
import { t } from "../../i18n/index.ts";
import { isGatewayMethodAdvertised } from "../../lib/gateway-methods.ts";

export type WorkbenchGatewayIdentity = {
  client: ApplicationGatewaySnapshot["client"];
  hello: ApplicationGatewaySnapshot["hello"];
  connected: boolean;
};

export function readWorkbenchGatewayIdentity(
  snapshot: ApplicationGatewaySnapshot,
): WorkbenchGatewayIdentity {
  return {
    client: snapshot.client,
    hello: snapshot.hello,
    connected: snapshot.phase === "connected",
  };
}

function sameGatewayIdentity(
  left: WorkbenchGatewayIdentity | null,
  right: WorkbenchGatewayIdentity | null,
): boolean {
  return Boolean(
    left &&
    right &&
    left.client === right.client &&
    left.hello === right.hello &&
    left.connected === right.connected,
  );
}

export function canVerifyWorkbenchModel(snapshot: ApplicationGatewaySnapshot): boolean {
  return (
    snapshot.phase === "connected" &&
    Boolean(snapshot.client) &&
    hasOperatorAdminAccess(snapshot.hello?.auth ?? null) &&
    isGatewayMethodAdvertised(snapshot, "openclaw.setup.verify") === true
  );
}

export function workbenchModelVerifyUnavailableReason(
  snapshot: ApplicationGatewaySnapshot,
): string | null {
  if (snapshot.phase !== "connected" || !snapshot.client) {
    return t("workbench.setup.model.gatewayRequired");
  }
  if (!hasOperatorAdminAccess(snapshot.hello?.auth ?? null)) {
    return t("workbench.setup.model.adminRequired");
  }
  if (isGatewayMethodAdvertised(snapshot, "openclaw.setup.verify") !== true) {
    return t("workbench.setup.model.methodUnavailable");
  }
  return null;
}

export class WorkbenchGatewayEvidence {
  private observedIdentity: WorkbenchGatewayIdentity | null = null;
  private channelIdentity: WorkbenchGatewayIdentity | null = null;
  private observedChannelLastSuccess: number | null = null;

  observeGateway(
    snapshot: ApplicationGatewaySnapshot,
    channelState: ApplicationContext["channels"]["state"],
  ): { changed: boolean; identity: WorkbenchGatewayIdentity } {
    const identity = readWorkbenchGatewayIdentity(snapshot);
    if (!this.observedIdentity) {
      this.observedIdentity = identity;
      this.observedChannelLastSuccess = channelState.channelsLastSuccess;
      if (
        identity.connected &&
        identity.client &&
        channelState.client === identity.client &&
        !channelState.channelsError &&
        (channelState.channelsSnapshot !== null || channelState.channelsLastSuccess !== null)
      ) {
        this.channelIdentity = identity;
      }
      return { changed: false, identity };
    }
    if (sameGatewayIdentity(this.observedIdentity, identity)) {
      return { changed: false, identity };
    }
    this.observedIdentity = identity;
    this.channelIdentity = null;
    this.observedChannelLastSuccess = channelState.channelsLastSuccess;
    return { changed: true, identity };
  }

  observeChannels(
    snapshot: ApplicationGatewaySnapshot,
    state: ApplicationContext["channels"]["state"],
  ): void {
    const lastSuccessChanged = state.channelsLastSuccess !== this.observedChannelLastSuccess;
    this.observedChannelLastSuccess = state.channelsLastSuccess;
    const identity = readWorkbenchGatewayIdentity(snapshot);
    if (
      !identity.connected ||
      !identity.client ||
      state.client !== identity.client ||
      state.channelsError ||
      state.channelsLoading
    ) {
      this.channelIdentity = null;
      return;
    }
    if (lastSuccessChanged) {
      this.channelIdentity = identity;
    }
  }

  isCurrent(identity: WorkbenchGatewayIdentity, snapshot: ApplicationGatewaySnapshot): boolean {
    return sameGatewayIdentity(identity, readWorkbenchGatewayIdentity(snapshot));
  }

  hasCurrentChannelEvidence(
    snapshot: ApplicationGatewaySnapshot,
    state: ApplicationContext["channels"]["state"],
  ): boolean {
    const identity = readWorkbenchGatewayIdentity(snapshot);
    return (
      identity.connected &&
      Boolean(identity.client) &&
      state.client === identity.client &&
      !state.channelsError &&
      sameGatewayIdentity(this.channelIdentity, identity)
    );
  }

  invalidateChannelEvidence(): void {
    this.channelIdentity = null;
  }

  markChannelsCurrent(
    identity: WorkbenchGatewayIdentity,
    state: ApplicationContext["channels"]["state"],
  ): void {
    this.channelIdentity =
      identity.connected &&
      Boolean(identity.client) &&
      state.client === identity.client &&
      !state.channelsError &&
      !state.channelsLoading
        ? identity
        : null;
  }
}
