import type {
  ApplyVisualEditPlanResult,
  MindMapDocument,
  Sha256Digest,
  VisualEditPlan,
} from "../../../packages/visual-workspace/dist/src/index.js";
import {
  assertSafeControlPlaneMutation,
  safePresentationText,
} from "../control-plane-client";
import type { SettingsOperationTransport } from "../settings-client";
import type {
  AskMateCapabilityState,
  AskMateClarification,
  AskMateContext,
} from "./interaction-model";

export const ASK_MATE_OPERATIONS = {
  readMap: "visual.map.read",
  readContext: "visual.context.read",
  planMap: "visual.map.plan",
  applyMap: "visual.map.apply",
  planIssue: "problem.intake.issue.plan",
  applyIssue: "problem.intake.issue.apply",
  planContribution: "problem.intake.contribution.plan",
  applyContribution: "problem.intake.contribution.apply",
} as const;

export interface AskMateMapReadResult {
  projectId: `project/${string}`;
  path: string;
  source: string;
  sourceSha256: Sha256Digest;
  document: MindMapDocument;
  documentFingerprint: Sha256Digest;
  managedMarkdown: string;
}

export interface AskMateMapPlanResult {
  projectId: `project/${string}`;
  path: string;
  plan: VisualEditPlan;
}

export interface AskMateMapApplyResult extends ApplyVisualEditPlanResult {
  projectId: `project/${string}`;
  receiptPath: string;
}

export interface AskMatePlanInput {
  project: `project/${string}`;
  path: string;
  nextDocument: MindMapDocument;
  actor: string;
  origin?: "user" | "assistant" | "import";
  warnings?: string[];
  acceptedGraphEvidence?: AskMateGraphEvidence[];
  clarificationAnswers?: Record<string, string>;
}

export interface AskMateContextReadResult {
  projectId: `project/${string}`;
  context: {
    kind: "managed_map" | "markdown_note" | "selection" | "canvas" | "project";
    path?: string;
    sourceLabel: string;
  };
  document?: MindMapDocument;
  documentFingerprint?: Sha256Digest;
  targetPath?: string;
  adoptionRequired: boolean;
  readOnly: boolean;
  warnings: string[];
  clarifications: AskMateClarification[];
  capabilities: AskMateCapabilityState;
}

export interface AskMateIssueChangePlan {
  schemaVersion: 1;
  projectId: `project/${string}`;
  observationId: string;
  observationRevision: number;
  existingIssueEntity: string | null;
  action: "create" | "update" | "comment";
  operation: string;
  payload: {
    title: string;
    description: string;
    body: string;
    priority: 0 | 1 | 2 | 3 | 4;
  };
  evidenceRefs: unknown[];
  warnings: string[];
  actor: string;
  fingerprint: Sha256Digest;
}

export interface AskMateExternalContributionPlan {
  schemaVersion: 1;
  id: string;
  disposition: {
    choice: "local_only" | "submit_issue" | "prepare_pull_request";
    [key: string]: unknown;
  };
  projectId: `project/${string}`;
  observationId: string;
  observationRevision: number;
  target: Record<string, unknown> | null;
  content: Record<string, unknown> | null;
  patch: Record<string, unknown> | null;
  executionProjection: Record<string, unknown> | null;
  redactions: string[];
  warnings: string[];
  actor: string;
  fingerprint: Sha256Digest;
}

export type AskMateContributionPlanResult =
  | {
    available: true;
    plan: AskMateExternalContributionPlan;
  }
  | {
    available: false;
    choice: "prepare_pull_request";
    observationId: string;
    reason: string;
    fallback: "submit_issue";
    warnings: string[];
  };

export type AskMateContributionAction =
  | "create_issue"
  | "push_branch"
  | "create_draft_pull_request"
  | "mark_ready_for_review";

export function isManagedProjectMapPath(
  projectId: `project/${string}`,
  path: string,
): boolean {
  const match = /^project\/([a-z0-9][a-z0-9-]*)$/.exec(projectId);
  if (!match || path.includes("\\")) return false;
  const prefix = `01-Projects/${match[1]}/maps/`;
  if (!path.startsWith(prefix)) return false;
  const relativePath = path.slice(prefix.length);
  return relativePath.length > ".md".length
    && relativePath.endsWith(".md")
    && !relativePath.startsWith(".llmwiki/")
    && relativePath.split("/").every(segment =>
      segment.length > 0 && segment !== "." && segment !== "..");
}

interface AdapterGraphQueryResult {
  snapshots: Array<{
    adapter: string;
    status: "ok" | "error";
    graph: {
      edges: Array<{
        from: string;
        to: string;
        type: "link" | "backlink" | "tag";
        evidence?: Array<{
          adapter: string;
          relation: string;
          confidence: "extracted" | "inferred" | "ambiguous" | "unknown";
          sourcePath?: string;
        }>;
      }>;
    };
  }>;
}

export interface AskMateGraphEvidence {
  id: string;
  adapter: string;
  relation: string;
  from: string;
  to: string;
  confidence: "extracted" | "inferred" | "ambiguous" | "unknown";
  evidenceRefs: string[];
}

/**
 * Thin Operation client. It owns no map state and deliberately has no Vault API
 * dependency; all reads, plans, and writes cross the shared Operation boundary.
 */
export class AskMateOperationClient {
  constructor(private readonly transport: SettingsOperationTransport) {}

  readMap(project: `project/${string}`, path: string): Promise<AskMateMapReadResult> {
    return this.transport.invoke(ASK_MATE_OPERATIONS.readMap, { project, path });
  }

  readContext(context: AskMateContext): Promise<AskMateContextReadResult> {
    if (!context.kind || context.kind === "managed_map") {
      if (!context.path) return Promise.reject(new Error("A managed map context requires a path"));
      return this.readMap(context.projectId, context.path).then(read => ({
        projectId: read.projectId,
        context: {
          kind: "managed_map",
          path: read.path,
          sourceLabel: read.path,
        },
        document: read.document,
        documentFingerprint: read.documentFingerprint,
        targetPath: read.path,
        adoptionRequired: false,
        readOnly: false,
        warnings: [],
        clarifications: [],
        capabilities: {
          model: "degraded",
          graphify: "degraded",
          problemIntake: "degraded",
          messages: [
            "Manual outline editing does not require a model provider.",
            "Optional capability health is resolved lazily by its owning Operation.",
          ],
        },
      }));
    }
    return this.transport.invoke(ASK_MATE_OPERATIONS.readContext, {
      project: context.projectId,
      context: {
        kind: context.kind,
        ...(context.path ? { path: context.path } : {}),
        ...(context.selection ? { selection: context.selection } : {}),
        ...(context.canvasNodeIds?.length ? { canvasNodeIds: context.canvasNodeIds } : {}),
      },
    });
  }

  async queryGraphEvidence(path: string): Promise<AskMateGraphEvidence[]> {
    const result = await this.transport.invoke<AdapterGraphQueryResult>(
      "graph.adapters.query",
      { adapters: ["graphify"] },
    );
    return result.snapshots
      .filter(snapshot => snapshot.status === "ok")
      .flatMap(snapshot => snapshot.graph.edges.flatMap((edge, edgeIndex) => {
        const relevantEvidence = (edge.evidence ?? [])
          .filter(evidence => evidence.adapter === "graphify")
          .filter(evidence => edge.from === path || edge.to === path || evidence.sourcePath === path);
        return relevantEvidence.map((evidence, evidenceIndex) => ({
          id: `${snapshot.adapter}:${edgeIndex}:${evidenceIndex}:${edge.from}:${edge.to}`,
          adapter: evidence.adapter,
          relation: evidence.relation,
          from: edge.from,
          to: edge.to,
          confidence: evidence.confidence,
          evidenceRefs: evidence.sourcePath ? [evidence.sourcePath] : [],
        }));
      }));
  }

  planMap(input: AskMatePlanInput): Promise<AskMateMapPlanResult> {
    return this.transport.invoke(ASK_MATE_OPERATIONS.planMap, {
      project: input.project,
      path: input.path,
      nextDocument: input.nextDocument,
      actor: input.actor,
      origin: input.origin ?? "user",
      ...(input.warnings?.length ? { warnings: input.warnings } : {}),
      ...(input.acceptedGraphEvidence?.length
        ? { acceptedGraphEvidence: input.acceptedGraphEvidence }
        : {}),
      ...(input.clarificationAnswers && Object.keys(input.clarificationAnswers).length
        ? { clarificationAnswers: input.clarificationAnswers }
        : {}),
    });
  }

  applyMap(input: {
    project: `project/${string}`;
    plan: VisualEditPlan;
    presentedFingerprint: Sha256Digest;
    actor: string;
    transitionToken: string;
  }): Promise<AskMateMapApplyResult> {
    return this.transport.invoke(ASK_MATE_OPERATIONS.applyMap, input);
  }

  planIssue(input: {
    projectId: `project/${string}`;
    observationId: string;
    actor: string;
    priority?: 0 | 1 | 2 | 3 | 4;
    existingIssue?: string;
    action?: "update" | "comment";
    warnings?: string[];
  }): Promise<AskMateIssueChangePlan> {
    return this.transport.invoke(ASK_MATE_OPERATIONS.planIssue, input);
  }

  applyIssue(input: {
    plan: AskMateIssueChangePlan;
    presentedFingerprint: Sha256Digest;
    actor: string;
    transitionToken: string;
  }): Promise<Record<string, unknown>> {
    return this.transport.invoke(ASK_MATE_OPERATIONS.applyIssue, input);
  }

  planContribution(input: {
    projectId: `project/${string}`;
    observationId: string;
    choice: "local_only" | "submit_issue" | "prepare_pull_request";
    actor: string;
    reason?: string;
    repository?: string;
    title?: string;
    body?: string;
    labels?: string[];
  }): Promise<AskMateContributionPlanResult> {
    assertSafeControlPlaneMutation(input, "askMate.contributionPlan");
    assertSafeContributionText(input);
    return this.transport.invoke(ASK_MATE_OPERATIONS.planContribution, input);
  }

  applyContribution(input: {
    plan: AskMateExternalContributionPlan;
    presentedFingerprint: Sha256Digest;
    approved: true;
    actor: string;
    workRunId: string;
    approvalToken: string;
    transitionToken: string;
    action: AskMateContributionAction;
    pullRequestId?: string;
    expectedPullRequestRevision?: string;
  }): Promise<Record<string, unknown>> {
    return this.transport.invoke(ASK_MATE_OPERATIONS.applyContribution, input);
  }
}

function assertSafeContributionText(value: unknown, path = "askMate.contributionPlan"): void {
  if (typeof value === "string") {
    if (value.trim() && safePresentationText(value) === "[redacted unsafe value]") {
      throw new Error(`${path} must not contain credentials or machine-local absolute paths`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeContributionText(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assertSafeContributionText(item, `${path}.${key}`);
  }
}
