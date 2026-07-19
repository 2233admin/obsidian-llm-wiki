import type { Operation, OperationContext } from '../core/types.js';
import { ProblemIntakeError } from '../../../packages/problem-intake/dist/src/index.js';
import {
  badRequest,
  conflict,
  internal,
  notFound,
  unsupported,
} from '../core/types.js';
import { touchMarkdown } from '../core/write-policy.js';
import { resolveProjectContext } from '../project/project-context.js';
import {
  ProblemIntakeExecutionError,
  type ProblemIntakeDependencies,
  type ProjectId,
} from './contracts.js';
import { ProblemIntakeExecutor } from './executor.js';
import {
  createExecFileObcRunner,
  runObcProblemScan,
  type ObcRunner,
} from './obc-runner.js';
import { canonicalProjectId, requiredString } from './safety.js';

const PROJECT_RE = /^project\/([a-z0-9][a-z0-9-]*)$/;

export interface ProblemIntakeOperationOptions {
  obcRunner?: ObcRunner;
}

function canonicalProject(
  vaultPath: string,
  value: unknown,
  operation: string,
): { projectId: ProjectId; slug: string } {
  const projectId = canonicalProjectId(value, 'project');
  const match = PROJECT_RE.exec(projectId);
  if (!match) throw badRequest('project must use canonical project/<lowercase-kebab-slug>');
  const context = resolveProjectContext(vaultPath, projectId, operation, {
    recordCompatibility: false,
  });
  if (context.projectId !== projectId || context.slug !== match[1]) {
    throw conflict('Project Context does not match the requested canonical Project ID');
  }
  return { projectId, slug: context.slug };
}

function assertActor(ctx: OperationContext, actor: unknown): string {
  const parsed = requiredString(actor, 'actor', 128);
  const authenticated = ctx.config.collaboration?.actor?.trim();
  if (authenticated && authenticated !== parsed) {
    throw badRequest('actor must match the authenticated collaboration actor');
  }
  return parsed;
}

function translate(error: unknown): Error {
  if (error instanceof ProblemIntakeError) {
    switch (error.code) {
      case 'OBSERVATION_NOT_FOUND':
        return notFound(error.message, error.data);
      case 'REVISION_CONFLICT':
      case 'INVALID_TRANSITION':
      case 'TRANSITION_TOKEN_REUSED':
      case 'OUTCOME_UNKNOWN':
        return conflict(error.message, error.data);
      case 'UNVERIFIED_PATCH':
        return unsupported(error.message, error.data);
      case 'CONSENT_REQUIRED':
        return badRequest(error.message, error.data);
      default:
        return badRequest(error.message, error.data);
    }
  }
  if (!(error instanceof ProblemIntakeExecutionError)) {
    return error instanceof Error ? error : internal('Problem Intake failed');
  }
  switch (error.code) {
    case 'INVALID_INPUT':
      return badRequest(error.message, error.data);
    case 'NOT_FOUND':
      return notFound(error.message, error.data);
    case 'CONFLICT':
    case 'OUTCOME_UNKNOWN':
      return conflict(error.message, error.data);
    case 'UNAVAILABLE':
      return unsupported(error.message, error.data);
    case 'APPROVAL_REQUIRED':
      return badRequest(error.message, error.data);
  }
}

async function callTranslated<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw translate(error);
  }
}

function problemRoot(slug: string): string {
  return `01-Projects/${slug}/problem-intake/**`;
}

function effectPath(result: unknown): unknown {
  return (result as { result?: { path?: unknown } } | undefined)?.result?.path;
}

/**
 * Produces unregistered Operations. The root operation catalog deliberately
 * owns final registration and aliases, while this module owns execution.
 */
export function makeProblemIntakeOps(
  vaultPath: string,
  dependencies: ProblemIntakeDependencies,
  options: ProblemIntakeOperationOptions = {},
): Operation[] {
  const executor = new ProblemIntakeExecutor(dependencies);
  const obcRunner = options.obcRunner ?? createExecFileObcRunner();
  return [
    {
      name: 'problem.intake.scan',
      namespace: 'problem' as Operation['namespace'],
      description: 'Run the first-party OBC read-only scan and persist bounded provider-neutral Problem Observations.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        targets: (_ctx, params) => {
          const { slug } = canonicalProject(vaultPath, params.project, 'problem.intake.scan');
          return [problemRoot(slug)];
        },
        audit: 'required',
      },
      params: {
        project: { type: 'string', required: true, description: 'Canonical Project ID' },
      },
      handler: async (_ctx, params) => callTranslated(async () => {
        const project = canonicalProject(vaultPath, params.project, 'problem.intake.scan');
        return runObcProblemScan({
          projectId: project.projectId,
          vaultPath,
          runner: obcRunner,
          executor,
        });
      }),
    },
    {
      name: 'problem.intake.observe',
      namespace: 'problem' as Operation['namespace'],
      description: 'Normalize and persist one provider-neutral finding without creating Work-OS or remote work.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        targets: (_ctx, params) => {
          const finding = params.finding as { projectId?: unknown } | undefined;
          const { slug } = canonicalProject(
            vaultPath,
            finding?.projectId,
            'problem.intake.observe',
          );
          return [problemRoot(slug)];
        },
        audit: 'required',
      },
      params: {
        finding: { type: 'object', required: true, description: 'Strict normalized Problem Finding' },
      },
      handler: async (_ctx, params) => callTranslated(async () => {
        const finding = params.finding as { projectId?: unknown } | undefined;
        canonicalProject(vaultPath, finding?.projectId, 'problem.intake.observe');
        return executor.observe(params.finding);
      }),
    },
    {
      name: 'problem.intake.list',
      namespace: 'problem' as Operation['namespace'],
      description: 'List bounded Problem Observations for one canonical Project.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Canonical Project ID' },
      },
      handler: async (_ctx, params) => callTranslated(async () => {
        const project = canonicalProject(vaultPath, params.project, 'problem.intake.list');
        return executor.list(project.projectId);
      }),
    },
    {
      name: 'problem.intake.lifecycle.apply',
      namespace: 'problem' as Operation['namespace'],
      description: 'Apply one revision-locked observation lifecycle transition with a replay-safe token.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        targets: (_ctx, params) => {
          const { slug } = canonicalProject(
            vaultPath,
            params.projectId,
            'problem.intake.lifecycle.apply',
          );
          return [problemRoot(slug)];
        },
        audit: 'required',
      },
      params: {
        projectId: { type: 'string', required: true },
        observationId: { type: 'string', required: true },
        action: { type: 'string', required: true, enum: ['acknowledge', 'dismiss', 'reopen', 'resolve'] },
        actor: { type: 'string', required: true },
        reason: { type: 'string', required: true },
        expectedRevision: { type: 'number', required: true },
        transitionToken: { type: 'string', required: true },
      },
      handler: async (ctx, params) => callTranslated(async () => {
        const project = canonicalProject(
          vaultPath,
          params.projectId,
          'problem.intake.lifecycle.apply',
        );
        return executor.lifecycleApply({
          ...params,
          projectId: project.projectId,
          actor: assertActor(ctx, params.actor),
        });
      }),
    },
    {
      name: 'problem.intake.verification.apply',
      namespace: 'problem' as Operation['namespace'],
      description: 'Record bounded reproduced, not-reproduced, or provider-failed verification evidence without changing Work-OS issue state.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        targets: (_ctx, params) => {
          const { slug } = canonicalProject(
            vaultPath,
            params.projectId,
            'problem.intake.verification.apply',
          );
          return [problemRoot(slug)];
        },
        audit: 'required',
      },
      params: {
        projectId: { type: 'string', required: true },
        observationId: { type: 'string', required: true },
        expectedRevision: { type: 'number', required: true },
        status: {
          type: 'string',
          required: true,
          enum: ['reproduced', 'not_reproduced', 'provider_failed'],
        },
        actor: { type: 'string', required: true },
        providerVersion: { type: 'string', required: true },
        evidenceRefs: { type: 'array', required: true },
      },
      handler: async (ctx, params) => callTranslated(async () => {
        const project = canonicalProject(
          vaultPath,
          params.projectId,
          'problem.intake.verification.apply',
        );
        return executor.verificationApply({
          ...params,
          projectId: project.projectId,
          actor: assertActor(ctx, params.actor),
        });
      }),
    },
    {
      name: 'problem.intake.issue.plan',
      namespace: 'problem' as Operation['namespace'],
      description: 'Create a pure immutable Issue Change Plan from one reviewed Problem Observation.',
      mutating: false,
      params: {
        projectId: { type: 'string', required: true },
        observationId: { type: 'string', required: true },
        actor: { type: 'string', required: true },
        priority: { type: 'number', required: false },
        existingIssue: { type: 'string', required: false },
        action: { type: 'string', required: false, enum: ['update', 'comment'] },
        warnings: { type: 'array', required: false },
      },
      handler: async (_ctx, params) => callTranslated(async () => {
        const project = canonicalProject(
          vaultPath,
          params.projectId,
          'problem.intake.issue.plan',
        );
        return executor.issuePlan({
          ...params,
          projectId: project.projectId,
          actor: assertActor(_ctx, params.actor),
        });
      }),
    },
    {
      name: 'problem.intake.issue.apply',
      namespace: 'problem' as Operation['namespace'],
      description: 'Apply a current Issue Change Plan only through canonical project.issue/project.comment operations.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        targets: (_ctx, params) => {
          const plan = params.plan as { projectId?: unknown } | undefined;
          const { slug } = canonicalProject(
            vaultPath,
            plan?.projectId,
            'problem.intake.issue.apply',
          );
          return [problemRoot(slug), `01-Projects/${slug}/issues/**`];
        },
        audit: 'required',
        effects: (_ctx, _params, result) => [touchMarkdown(effectPath(result), 'modify')],
      },
      params: {
        plan: { type: 'object', required: true },
        presentedFingerprint: { type: 'string', required: true },
        actor: { type: 'string', required: true },
        transitionToken: { type: 'string', required: true },
      },
      handler: async (ctx, params) => callTranslated(async () => {
        const plan = params.plan as { projectId?: unknown } | undefined;
        canonicalProject(vaultPath, plan?.projectId, 'problem.intake.issue.apply');
        return executor.issueApply(
          {
            ...params,
            actor: assertActor(ctx, params.actor),
          },
          ctx,
        );
      }),
    },
    {
      name: 'problem.intake.contribution.plan',
      namespace: 'problem' as Operation['namespace'],
      description: 'Create an exact secret-safe local/Issue/verified-draft-PR contribution preview.',
      mutating: false,
      params: {
        projectId: { type: 'string', required: true },
        observationId: { type: 'string', required: true },
        choice: { type: 'string', required: true, enum: ['local_only', 'submit_issue', 'prepare_pull_request'] },
        actor: { type: 'string', required: true },
        reason: { type: 'string', required: false },
        repository: { type: 'string', required: false },
        title: { type: 'string', required: false },
        body: { type: 'string', required: false },
        labels: { type: 'array', required: false },
      },
      handler: async (ctx, params) => callTranslated(async () => {
        const project = canonicalProject(
          vaultPath,
          params.projectId,
          'problem.intake.contribution.plan',
        );
        return executor.contributionPlan({
          ...params,
          projectId: project.projectId,
          actor: assertActor(ctx, params.actor),
        });
      }),
    },
    {
      name: 'problem.intake.contribution.apply',
      namespace: 'problem' as Operation['namespace'],
      description: 'Apply one current explicitly approved external contribution through a governed adapter; merge is unsupported.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        targets: (_ctx, params) => {
          const plan = params.plan as {
            projectId?: unknown;
            disposition?: { choice?: unknown };
            provider?: unknown;
            repository?: unknown;
          } | undefined;
          const { slug } = canonicalProject(
            vaultPath,
            plan?.projectId,
            'problem.intake.contribution.apply',
          );
          if (plan?.disposition?.choice === 'local_only') return [problemRoot(slug)];
          const target = (params.plan as { target?: { provider?: unknown } } | undefined)?.target;
          const provider = requiredString(target?.provider, 'plan.target.provider', 128);
          return [problemRoot(slug), `external/${provider}/**`];
        },
        audit: 'required',
      },
      params: {
        plan: { type: 'object', required: true },
        presentedFingerprint: { type: 'string', required: true },
        approved: { type: 'boolean', required: true },
        actor: { type: 'string', required: true },
        workRunId: { type: 'string', required: true },
        approvalToken: { type: 'string', required: true },
        transitionToken: { type: 'string', required: true },
        action: {
          type: 'string',
          required: false,
          enum: ['create_issue', 'push_branch', 'create_draft_pull_request', 'mark_ready_for_review'],
        },
        pullRequestId: { type: 'string', required: false },
        expectedPullRequestRevision: { type: 'string', required: false },
      },
      handler: async (ctx, params) => callTranslated(async () => {
        const plan = params.plan as { projectId?: unknown } | undefined;
        canonicalProject(vaultPath, plan?.projectId, 'problem.intake.contribution.apply');
        return executor.contributionApply({
          ...params,
          actor: assertActor(ctx, params.actor),
        });
      }),
    },
  ];
}
