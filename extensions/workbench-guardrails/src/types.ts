export type GuardrailsProfile = "personal-safe" | "coding" | "research-only" | "high-autonomy";

export type ActionEffect = "read" | "write" | "execute" | "send" | "publish" | "delete" | "unknown";
export type PolicyOutcome = "allow" | "ask" | "block";

export type ToolAction = {
  tool: string;
  effect: ActionEffect;
  targets?: readonly string[];
  summary: string;
};

export type ActionDecision = {
  outcome: PolicyOutcome;
  reason: string;
};

export type GuardrailsRule = {
  outcome: PolicyOutcome;
  tools?: string[];
  effects?: ActionEffect[];
  targetPrefix?: string;
  reason?: string;
};

export type JournalEvent = {
  at: string;
  type: "decision" | "approval" | "outcome";
  taskId: string;
  details: Record<string, unknown>;
};

export type GuardrailsJournal = {
  append: (event: JournalEvent) => unknown;
};
