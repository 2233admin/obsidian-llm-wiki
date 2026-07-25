import {
  PROJECT_HUB_PROJECTION_SCHEMA_VERSION,
  type ObservationLifecycle,
  type ProjectHubProjectionInput,
  type ProviderHealthProjectionInput,
  validateProjectHubProjectionInput,
} from "./contracts.js";

export type ProjectionHealth = "healthy" | "degraded" | "unavailable" | "empty";
export type Freshness = "current" | "stale" | "unknown";

export interface ProjectHubVisualTriageProjection {
  schemaVersion: typeof PROJECT_HUB_PROJECTION_SCHEMA_VERSION;
  projectId: string;
  generatedAt: string;
  readOnly: true;
  sections: {
    visual: {
      owner: "visual-workspace";
      health: ProjectionHealth;
      freshness: Freshness;
      documents: Array<{
        documentId: string;
        path: string;
        revision: number;
        sourceObservedAt: string;
        sourceFreshness: Freshness;
        projectionStatus: "current" | "stale" | "failed" | "unavailable";
        linkedWorkItems: Array<{
          entity: string;
          state: string;
          reviewedAt?: string;
        }>;
      }>;
    };
    triage: {
      owner: "problem-intake";
      health: ProjectionHealth;
      freshness: Freshness;
      summary: Record<
        ObservationLifecycle | "recurring" | "issue-linked",
        number
      >;
      providers: Array<
        ProviderHealthProjectionInput & { freshness: Freshness }
      >;
      observations: Array<{
        observationId: string;
        lifecycle: ObservationLifecycle;
        severity: "info" | "warning" | "error";
        occurrenceCount: number;
        firstObservedAt: string;
        lastObservedAt: string;
        providerId: string;
        providerHealth: ProviderHealthProjectionInput["health"] | "unknown";
        providerFreshness: Freshness;
        newlyVerified: boolean;
        trace: {
          observation: string;
          localIssue: {
            entity: string;
            state: string;
          } | null;
          upstream: Array<{
            kind: "issue" | "pull-request";
            provider: string;
            remoteRef: string;
            state: string;
          }>;
          workRuns: Array<{
            workRunId: string;
            state: string;
          }>;
          verifications: Array<{
            verificationId: string;
            status: "passed" | "failed" | "unknown";
            observedAt: string;
            evidenceRefs: string[];
          }>;
        };
      }>;
    };
  };
  mutationRoutes: {
    maps: "visual.map.plan";
    observations: "problem.intake.lifecycle.apply";
    issuePlans: "problem.intake.issue.plan";
    localIssues: "project.issue.*";
    contributions: "problem.intake.contribution.plan";
    remoteMutations: "governed tracker or forge adapter";
  };
}

export interface ProjectHubCanvasProjection {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

export interface ProjectHubBaseProjection {
  schemaVersion: 1;
  sourceOwner: "problem-intake";
  filters: {
    projectId: string;
    observationLifecycles: ObservationLifecycle[];
  };
  fields: string[];
  rows: Array<Record<string, unknown>>;
  readOnly: true;
}

function freshnessForProvider(
  provider: ProviderHealthProjectionInput | undefined,
  generatedAt: string,
): Freshness {
  if (!provider?.observedAt) return "unknown";
  if (
    provider.expiresAt &&
    Date.parse(provider.expiresAt) <= Date.parse(generatedAt)
  ) {
    return "stale";
  }
  if (provider.health === "unavailable" || provider.health === "disabled") {
    return "stale";
  }
  return "current";
}

function sourceFreshness(document: {
  sourceHash?: string;
  currentSourceHash?: string;
  projectionStatus: string;
}): Freshness {
  if (
    document.projectionStatus === "stale" ||
    document.projectionStatus === "failed"
  ) {
    return "stale";
  }
  if (!document.sourceHash || !document.currentSourceHash) return "unknown";
  return document.sourceHash === document.currentSourceHash
    ? "current"
    : "stale";
}

function aggregateFreshness(values: Freshness[]): Freshness {
  if (values.some((value) => value === "stale")) return "stale";
  if (values.some((value) => value === "unknown")) return "unknown";
  return "current";
}

export function composeProjectHubVisualTriageProjection(
  value: unknown,
): ProjectHubVisualTriageProjection {
  const input = validateProjectHubProjectionInput(value);
  const providers = new Map(
    input.providerHealth.map((provider) => [provider.providerId, provider]),
  );
  const visualDocuments = input.visualDocuments.map((document) => ({
    documentId: document.documentId,
    path: document.path,
    revision: document.revision,
    sourceObservedAt: document.sourceObservedAt,
    sourceFreshness: sourceFreshness(document),
    projectionStatus: document.projectionStatus,
    linkedWorkItems: structuredClone(document.linkedWorkItems),
  }));
  const visualFreshness = aggregateFreshness(
    visualDocuments.map((document) => document.sourceFreshness),
  );
  const visualHealth: ProjectionHealth = visualDocuments.length === 0
    ? "empty"
    : visualDocuments.some(
          (document) =>
            document.projectionStatus === "failed" ||
            document.projectionStatus === "unavailable",
        )
      ? "unavailable"
      : visualFreshness === "current"
        ? "healthy"
        : "degraded";

  const providerRows = input.providerHealth.map((provider) => ({
    ...structuredClone(provider),
    freshness: freshnessForProvider(provider, input.generatedAt),
  }));
  const observations = input.observations.map((observation) => {
    const provider = providers.get(observation.providerId);
    const providerFreshness = freshnessForProvider(provider, input.generatedAt);
    const providerHealth: ProviderHealthProjectionInput["health"] | "unknown" =
      provider?.health ?? "unknown";
    const latestVerification = [...observation.verifications].sort((left, right) =>
      right.observedAt.localeCompare(left.observedAt),
    )[0];
    return {
      observationId: observation.observationId,
      lifecycle: observation.lifecycle,
      severity: observation.severity,
      occurrenceCount: observation.occurrenceCount,
      firstObservedAt: observation.firstObservedAt,
      lastObservedAt: observation.lastObservedAt,
      providerId: observation.providerId,
      providerHealth,
      providerFreshness,
      newlyVerified:
        providerFreshness === "current" &&
        latestVerification?.status === "passed" &&
        Date.parse(latestVerification.observedAt) >=
          Date.parse(observation.lastObservedAt),
      trace: {
        observation: observation.observationId,
        localIssue: observation.linkedIssue
          ? structuredClone(observation.linkedIssue)
          : null,
        upstream: structuredClone(observation.contributions),
        workRuns: structuredClone(observation.workRuns),
        verifications: structuredClone(observation.verifications),
      },
    };
  });
  const count = (lifecycle: ObservationLifecycle): number =>
    observations.filter((item) => item.lifecycle === lifecycle).length;
  const triageFreshness = aggregateFreshness([
    ...providerRows.map((provider) => provider.freshness),
    ...observations.map((observation) => observation.providerFreshness),
  ]);
  const triageHealth: ProjectionHealth =
    observations.length === 0 && providerRows.length === 0
      ? "empty"
      : providerRows.some(
            (provider) =>
              provider.health === "unavailable" ||
              provider.health === "disabled",
          ) ||
          observations.some((observation) =>
            observation.trace.verifications.some(
              (verification) => verification.status === "failed",
            ),
          )
        ? "degraded"
        : "healthy";

  return {
    schemaVersion: PROJECT_HUB_PROJECTION_SCHEMA_VERSION,
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    readOnly: true,
    sections: {
      visual: {
        owner: "visual-workspace",
        health: visualHealth,
        freshness: visualDocuments.length ? visualFreshness : "unknown",
        documents: visualDocuments,
      },
      triage: {
        owner: "problem-intake",
        health: triageHealth,
        freshness:
          observations.length || providerRows.length
            ? triageFreshness
            : "unknown",
        summary: {
          untriaged: count("untriaged"),
          acknowledged: count("acknowledged"),
          dismissed: count("dismissed"),
          resolved: count("resolved"),
          reopened: count("reopened"),
          recurring: observations.filter((item) => item.occurrenceCount > 1)
            .length,
          "issue-linked": observations.filter((item) => item.trace.localIssue)
            .length,
        },
        providers: providerRows,
        observations,
      },
    },
    mutationRoutes: {
      maps: "visual.map.plan",
      observations: "problem.intake.lifecycle.apply",
      issuePlans: "problem.intake.issue.plan",
      localIssues: "project.issue.*",
      contributions: "problem.intake.contribution.plan",
      remoteMutations: "governed tracker or forge adapter",
    },
  };
}

export function renderProjectHubVisualTriageText(
  projection: ProjectHubVisualTriageProjection,
): string {
  const lines = [
    `# Visual and problem trace for ${projection.projectId}`,
    "",
    "## Visual workspaces",
    `Health: ${projection.sections.visual.health}; freshness: ${projection.sections.visual.freshness}`,
  ];
  for (const document of projection.sections.visual.documents) {
    lines.push(
      `- ${document.documentId} — revision ${document.revision}; source ${document.sourceFreshness}; projection ${document.projectionStatus}; ${document.path}`,
    );
    for (const workItem of document.linkedWorkItems) {
      lines.push(`  - ${workItem.entity}: ${workItem.state}`);
    }
  }
  lines.push(
    "",
    "## Problem triage",
    `Health: ${projection.sections.triage.health}; freshness: ${projection.sections.triage.freshness}`,
  );
  for (const observation of projection.sections.triage.observations) {
    lines.push(
      `- ${observation.observationId} — ${observation.lifecycle}; ${observation.severity}; provider ${observation.providerId} (${observation.providerFreshness})`,
    );
    if (observation.trace.localIssue) {
      lines.push(
        `  - Local issue: ${observation.trace.localIssue.entity} (${observation.trace.localIssue.state})`,
      );
    }
    for (const upstream of observation.trace.upstream) {
      lines.push(
        `  - Upstream ${upstream.kind}: ${upstream.remoteRef} (${upstream.state})`,
      );
    }
    for (const workRun of observation.trace.workRuns) {
      lines.push(`  - Work Run: ${workRun.workRunId} (${workRun.state})`);
    }
    for (const verification of observation.trace.verifications) {
      lines.push(
        `  - Verification: ${verification.verificationId} (${verification.status})`,
      );
    }
  }
  lines.push(
    "",
    "Mutations route to Visual Workspace, Problem Intake, Work-OS, and governed tracker or forge adapters.",
  );
  return `${lines.join("\n")}\n`;
}

export function renderProjectHubVisualTriageBase(
  projection: ProjectHubVisualTriageProjection,
): ProjectHubBaseProjection {
  return {
    schemaVersion: 1,
    sourceOwner: "problem-intake",
    filters: {
      projectId: projection.projectId,
      observationLifecycles: [
        "untriaged",
        "acknowledged",
        "dismissed",
        "resolved",
        "reopened",
      ],
    },
    fields: [
      "observationId",
      "lifecycle",
      "severity",
      "occurrenceCount",
      "firstObservedAt",
      "lastObservedAt",
      "providerId",
      "providerHealth",
      "providerFreshness",
      "linkedIssue",
      "upstreamRefs",
      "workRunIds",
      "workRunCount",
      "verificationStatus",
    ],
    rows: projection.sections.triage.observations.map((observation) => ({
      observationId: observation.observationId,
      lifecycle: observation.lifecycle,
      severity: observation.severity,
      occurrenceCount: observation.occurrenceCount,
      firstObservedAt: observation.firstObservedAt,
      lastObservedAt: observation.lastObservedAt,
      providerId: observation.providerId,
      providerHealth: observation.providerHealth,
      providerFreshness: observation.providerFreshness,
      linkedIssue: observation.trace.localIssue?.entity ?? null,
      upstreamRefs: observation.trace.upstream.map(
        (contribution) => contribution.remoteRef,
      ),
      workRunIds: observation.trace.workRuns.map((run) => run.workRunId),
      workRunCount: observation.trace.workRuns.length,
      verificationStatus:
        [...observation.trace.verifications].sort((left, right) =>
          right.observedAt.localeCompare(left.observedAt),
        )[0]?.status ?? "unknown",
    })),
    readOnly: true,
  };
}

export function renderProjectHubVisualTriageCanvas(
  projection: ProjectHubVisualTriageProjection,
): ProjectHubCanvasProjection {
  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];
  projection.sections.visual.documents.forEach((document, index) => {
    nodes.push({
      id: `visual-${index + 1}`,
      type: "file",
      file: document.path,
      x: 0,
      y: index * 180,
      width: 360,
      height: 140,
      llmwikiOwner: "visual-workspace",
      freshness: document.sourceFreshness,
    });
  });
  projection.sections.triage.observations.forEach((observation, index) => {
    const observationNode = `observation-${index + 1}`;
    nodes.push({
      id: observationNode,
      type: "text",
      text: `${observation.observationId}\n${observation.lifecycle} · ${observation.severity}\nProvider: ${observation.providerId} (${observation.providerFreshness})`,
      x: 480,
      y: index * 180,
      width: 400,
      height: 140,
      llmwikiOwner: "problem-intake",
    });
    if (observation.trace.localIssue) {
      const issueNode = `issue-${index + 1}`;
      nodes.push({
        id: issueNode,
        type: "text",
        text: `${observation.trace.localIssue.entity}\n${observation.trace.localIssue.state}`,
        x: 960,
        y: index * 180,
        width: 360,
        height: 120,
        llmwikiOwner: "work-os",
      });
      edges.push({
        id: `edge-observation-issue-${index + 1}`,
        fromNode: observationNode,
        toNode: issueNode,
        label: "proposes / links",
      });
    }
    observation.trace.upstream.forEach((upstream, upstreamIndex) => {
      const upstreamNode = `upstream-${index + 1}-${upstreamIndex + 1}`;
      nodes.push({
        id: upstreamNode,
        type: "text",
        text: `${upstream.kind}: ${upstream.remoteRef}\n${upstream.state}`,
        x: 1_400,
        y: index * 180 + upstreamIndex * 110,
        width: 400,
        height: 100,
        llmwikiOwner: "governed-tracker-or-forge",
      });
      edges.push({
        id: `edge-observation-upstream-${index + 1}-${upstreamIndex + 1}`,
        fromNode: observationNode,
        toNode: upstreamNode,
        label: "contributes",
      });
    });
    observation.trace.workRuns.forEach((workRun, workRunIndex) => {
      const workRunNode = `work-run-${index + 1}-${workRunIndex + 1}`;
      nodes.push({
        id: workRunNode,
        type: "text",
        text: `${workRun.workRunId}\n${workRun.state}`,
        x: 1_840,
        y: index * 180 + workRunIndex * 110,
        width: 360,
        height: 100,
        llmwikiOwner: "work-driver",
      });
      edges.push({
        id: `edge-observation-work-run-${index + 1}-${workRunIndex + 1}`,
        fromNode: observationNode,
        toNode: workRunNode,
        label: "executed by",
      });
    });
    observation.trace.verifications.forEach(
      (verification, verificationIndex) => {
        const verificationNode = `verification-${index + 1}-${verificationIndex + 1}`;
        nodes.push({
          id: verificationNode,
          type: "text",
          text: `${verification.verificationId}\n${verification.status}`,
          x: 2_240,
          y: index * 180 + verificationIndex * 110,
          width: 360,
          height: 100,
          llmwikiOwner: "verification",
        });
        edges.push({
          id: `edge-observation-verification-${index + 1}-${verificationIndex + 1}`,
          fromNode: observationNode,
          toNode: verificationNode,
          label: "verified by",
        });
      },
    );
  });
  return { nodes, edges };
}
