import { InMemoryProblemIntake } from '../../../packages/problem-intake/dist/src/index.js';
import type {
  GovernedContributionPort,
  ProblemIntakeDependencies,
  ProjectOperationPort,
} from './contracts.js';
import {
  JsonFileLocalIssueReceiptStore,
  JsonFileProblemObservationRepository,
} from './durable-store.js';

export interface ProductionProblemIntakeOptions {
  contribution?: GovernedContributionPort;
}

/**
 * Shared production wiring for the MCP server and Obsidian in-process host.
 *
 * Remote contribution remains fail-closed unless a governed forge port is
 * supplied; that port owns the sole remote receipt authority.
 */
export function createProductionProblemIntakeDependencies(
  vaultPath: string,
  projectOperations: ProjectOperationPort,
  options: ProductionProblemIntakeOptions = {},
): ProblemIntakeDependencies {
  return {
    domain: new InMemoryProblemIntake(
      new JsonFileProblemObservationRepository(vaultPath),
    ),
    issueReceipts: new JsonFileLocalIssueReceiptStore(vaultPath),
    projectOperations,
    ...(options.contribution ? { contribution: options.contribution } : {}),
  };
}
