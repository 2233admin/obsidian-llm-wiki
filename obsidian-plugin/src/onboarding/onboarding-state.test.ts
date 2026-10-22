import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { HealthCheck, SettingValidationIssue } from "../settings-client";
import { deriveOnboardingState } from "./onboarding-state";

function health(state: HealthCheck["state"], capabilityId = "runtime.python"): HealthCheck {
  return {
    capabilityId,
    state,
    summary: "Python runtime",
    evidence: [],
    remediations: state === "unavailable"
      ? [{ code: "configure-python", summary: "Configure Python." }]
      : [],
    checkedAt: "2026-08-29T00:00:00.000Z",
    snapshotId: "snapshot-1",
  };
}

function issue(severity: SettingValidationIssue["severity"]): SettingValidationIssue {
  return { code: "invalid", severity, message: "Setting is invalid.", key: "runtime.python.path" };
}

const readyInput = {
  vaultAvailable: true,
  projectId: "project/alpha",
  capabilityHealth: [health("available")],
  validationIssues: [],
  firstSearchCompleted: false,
};

describe("onboarding state", () => {
  test("walks a fresh vault through each blocking step", () => {
    assert.equal(deriveOnboardingState({ ...readyInput, vaultAvailable: false }).step, "vault");
    assert.equal(deriveOnboardingState({ ...readyInput, projectId: undefined }).step, "project");
    assert.equal(deriveOnboardingState({ ...readyInput, capabilityHealth: [health("unavailable", "settings-platform")] }).step, "capabilities");
    assert.equal(deriveOnboardingState({ ...readyInput, validationIssues: [issue("error")] }).step, "minimum-settings");
    assert.equal(deriveOnboardingState(readyInput).step, "first-search");
  });

  test("does not block on an optional unavailable Python worker", () => {
    const result = deriveOnboardingState({ ...readyInput, capabilityHealth: [health("unavailable")] });
    assert.equal(result.step, "first-search");
    assert.deepEqual(result.blockingHealth, []);
  });

  test("completes only after the first search succeeds", () => {
    const result = deriveOnboardingState({ ...readyInput, firstSearchCompleted: true });
    assert.deepEqual(result, {
      step: "complete",
      title: "LLM Wiki is ready",
      nextAction: "Continue from the Project Hub or open the advanced control plane when needed.",
      blockingHealth: [],
      blockingSettings: [],
    });
  });

  test("prioritizes required repair over settings and search", () => {
    const result = deriveOnboardingState({
      ...readyInput,
      capabilityHealth: [health("unavailable", "settings-platform")],
      validationIssues: [issue("error")],
      firstSearchCompleted: true,
    });
    assert.equal(result.step, "capabilities");
    assert.equal(result.blockingHealth.length, 1);
    assert.equal(result.blockingSettings.length, 1);
  });

  test("ignores warning-only settings issues and validates Project IDs", () => {
    assert.equal(deriveOnboardingState({ ...readyInput, projectId: "alpha" }).step, "project");
    assert.equal(deriveOnboardingState({ ...readyInput, validationIssues: [issue("warning")] }).step, "first-search");
  });
});
