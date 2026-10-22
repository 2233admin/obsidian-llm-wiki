import type { HealthCheck, SettingValidationIssue } from "../settings-client";

export const ONBOARDING_STEPS = [
  "vault",
  "project",
  "capabilities",
  "minimum-settings",
  "first-search",
  "complete",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingInput {
  vaultAvailable: boolean;
  projectId?: string;
  capabilityHealth: readonly HealthCheck[];
  validationIssues: readonly SettingValidationIssue[];
  firstSearchCompleted: boolean;
  requiredCapabilityIds?: readonly string[];
}

export interface OnboardingState {
  step: OnboardingStep;
  title: string;
  nextAction: string;
  blockingHealth: readonly HealthCheck[];
  blockingSettings: readonly SettingValidationIssue[];
}

type OnboardingStepContent = Pick<OnboardingState, "title" | "nextAction">;

const STEP_CONTENT: Record<OnboardingStep, OnboardingStepContent> = {
  vault: {
    title: "Bind a desktop vault",
    nextAction: "Open a desktop filesystem-backed vault, then reopen LLM Wiki settings.",
  },
  project: {
    title: "Bind this workspace to a Project",
    nextAction: "Choose a canonical Project ID such as project/my-project.",
  },
  capabilities: {
    title: "Repair required capabilities",
    nextAction: "Use the remediation action beside each unavailable capability, then run Doctor again.",
  },
  "minimum-settings": {
    title: "Complete minimum settings",
    nextAction: "Open All Settings and resolve the highlighted validation errors.",
  },
  "first-search": {
    title: "Run your first search",
    nextAction: "Open LLM Wiki and search the active note or Project context.",
  },
  complete: {
    title: "LLM Wiki is ready",
    nextAction: "Continue from the Project Hub or open the advanced control plane when needed.",
  },
};

const CANONICAL_PROJECT_ID = /^project\/[a-z0-9][a-z0-9-]*$/;

function blockingHealth(input: OnboardingInput): HealthCheck[] {
  const required = new Set(input.requiredCapabilityIds ?? ["settings-platform"]);
  return input.capabilityHealth.filter(check => required.has(check.capabilityId) && check.state === "unavailable");
}

function stepFor(input: OnboardingInput, unavailableCount: number, settingsCount: number): OnboardingStep {
  if (!input.vaultAvailable) return "vault";
  if (!input.projectId || !CANONICAL_PROJECT_ID.test(input.projectId)) return "project";
  if (unavailableCount > 0) return "capabilities";
  if (settingsCount > 0) return "minimum-settings";
  if (!input.firstSearchCompleted) return "first-search";
  return "complete";
}

export function deriveOnboardingState(input: OnboardingInput): OnboardingState {
  const blockingHealthItems = blockingHealth(input);
  const blockingSettings = input.validationIssues.filter(issue => issue.severity === "error");
  const step = stepFor(input, blockingHealthItems.length, blockingSettings.length);
  return {
    step,
    ...STEP_CONTENT[step],
    blockingHealth: blockingHealthItems,
    blockingSettings,
  };
}
