import type { RouteId } from "../../app-route-paths.ts";

export type WorkbenchView = "overview" | "setup" | "safety" | "mission";

export type WorkbenchSetupStep = "gateway" | "model" | "channel" | "safety" | "finish";

export const WORKBENCH_SETUP_STEPS: readonly WorkbenchSetupStep[] = [
  "gateway",
  "model",
  "channel",
  "safety",
  "finish",
];

export type WorkbenchGuardrailsProfile =
  | "personal-safe"
  | "coding"
  | "research-only"
  | "high-autonomy";

export type WorkbenchCheckState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "ready"; detail: string; checkedAt: number }
  | { phase: "attention"; detail: string; checkedAt: number }
  | { phase: "error"; detail: string; checkedAt: number };

export type WorkbenchGuardrailsRuntime =
  | { phase: "idle" }
  | { phase: "loading" }
  | {
      phase: "active";
      profile: WorkbenchGuardrailsProfile;
      journalCount: number;
      checkedAt: number;
    }
  | { phase: "inactive"; detail: string; checkedAt: number }
  | { phase: "error"; detail: string; checkedAt: number };

export type WorkbenchGuardrailJournalEvent = {
  at: string;
  type: "decision" | "approval" | "outcome";
  taskId: string;
  details: Record<string, unknown>;
};

export type WorkbenchOperationState =
  | { phase: "idle" }
  | { phase: "running"; message: string }
  | { phase: "success"; message: string }
  | { phase: "error"; message: string };

export type WorkbenchReadinessPhase = "ready" | "attention" | "blocked" | "checking";

export type WorkbenchReadinessItem = {
  id: "gateway" | "model" | "channel" | "guardrails";
  phase: WorkbenchReadinessPhase;
  title: string;
  detail: string;
  route: RouteId;
};

export type WorkbenchChannelHealth = {
  configured: number;
  running: number;
  connected: number;
  total: number;
};

export type WorkbenchMissionDraft = {
  title: string;
  notes: string;
  priority: "low" | "normal" | "high" | "urgent";
  agentId: string;
};

export type WorkbenchMissionResult = {
  id: string;
  title: string;
};

export type WorkbenchProfileOption = {
  id: WorkbenchGuardrailsProfile;
  tone: "safe" | "balanced" | "strict" | "autonomous";
};

export const WORKBENCH_PROFILE_OPTIONS: readonly WorkbenchProfileOption[] = [
  {
    id: "personal-safe",
    tone: "safe",
  },
  {
    id: "coding",
    tone: "balanced",
  },
  {
    id: "research-only",
    tone: "strict",
  },
  {
    id: "high-autonomy",
    tone: "autonomous",
  },
];
