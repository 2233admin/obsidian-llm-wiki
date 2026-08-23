export interface CompileArtifactReceipt {
  artifactId: string;
  relativePath: string;
  stagedPath: string;
  proposedTarget: string;
  contentDigest: string;
  mediaType: string;
}

export interface CompileVerificationCheck {
  checkId: string;
  passed: boolean;
  message: string;
}

export interface CompileVerificationReport {
  artifactIds: string[];
  checks: CompileVerificationCheck[];
  passed: boolean;
  acceptanceCoverage: number;
  recommendedDecision: "promote" | "request_changes" | "human_review";
}

export interface CompilePromotionReceipt {
  status: "promoted" | "not-promoted" | "awaiting-approval";
  targets: string[];
  promotedAt?: string;
}

export interface CompileResult {
  ok: boolean;
  topic: string;
  sourcesCompiled: number;
  conceptsCreated: number;
  contradictions: number;
  error?: string;
  timestamp: string;
  artifacts?: CompileArtifactReceipt[];
}

export interface CompileStatus {
  dirty: string[];
  dirtyCount: number;
  threshold: number;
  running: boolean;
  lastRun: string | null;
  lastResult: CompileResult | null;
  autoCompile: boolean;
  schedulingMode: "durable" | "legacy-threshold";
  maintenance?: {
    eligible: number;
    deferred: number;
    quarantined: number;
    nextWakeAt?: string;
  };
}
