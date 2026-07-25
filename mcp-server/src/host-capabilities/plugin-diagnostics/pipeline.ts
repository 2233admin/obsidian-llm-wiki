import {
  toProblemIntakeDiagnosticCandidates,
  validatePluginDiagnosticReport,
  type ProblemIntakeDiagnosticCandidate,
} from "./contracts.js";

export interface PluginDiagnosticObservationReceipt {
  observationId: string;
}

export interface PluginDiagnosticPipelineReceipt {
  traceId: string;
  providerId: string;
  candidateCount: number;
  observationIds: string[];
}

/**
 * Strict bridge from an authorized Host Capability result to Problem Intake.
 *
 * Validation and complete candidate conversion happen before the first
 * callback. An undeclared, secret-bearing, unbounded, or identity-conflicting
 * payload therefore cannot cause partial downstream persistence.
 */
export async function submitPluginDiagnosticReportToProblemIntake(
  rawReport: unknown,
  observe: (
    candidate: ProblemIntakeDiagnosticCandidate,
  ) => Promise<PluginDiagnosticObservationReceipt>,
): Promise<PluginDiagnosticPipelineReceipt> {
  const report = validatePluginDiagnosticReport(rawReport);
  const candidates = toProblemIntakeDiagnosticCandidates(report);
  const observationIds: string[] = [];
  for (const candidate of candidates) {
    const receipt = await observe(structuredClone(candidate));
    if (
      !receipt ||
      typeof receipt.observationId !== "string" ||
      !/^problem\/[a-z0-9][a-z0-9._-]{0,159}$/.test(receipt.observationId)
    ) {
      throw new Error(
        "Problem Intake observe callback returned an invalid observation receipt",
      );
    }
    observationIds.push(receipt.observationId);
  }
  return {
    traceId: report.scan.traceId,
    providerId: report.provider.id,
    candidateCount: candidates.length,
    observationIds,
  };
}
