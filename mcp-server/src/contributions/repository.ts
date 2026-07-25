import type {
  ContributionTransport,
  ContributionTransportRegistry,
  RepositoryCandidate,
  ResolvedRepository,
} from './contracts.js';
import { ContributionError } from './errors.js';
import { assertSha256, fingerprint } from './fingerprint.js';

const PROJECT_RE = /^project\/[a-z0-9][a-z0-9-]*$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

function assertHttpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ContributionError('INVALID_INPUT', `${label} must be an absolute URL`);
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new ContributionError(
      'SECRET_OR_PATH_UNSAFE',
      `${label} must be credential-free HTTPS without query or fragment`,
    );
  }
  return url.toString().replace(/\/$/, '');
}

export function assertCanonicalProjectId(value: string): void {
  if (!PROJECT_RE.test(value)) {
    throw new ContributionError(
      'INVALID_INPUT',
      'projectId must use canonical project/<lowercase-kebab-slug>',
    );
  }
}
export function resolveRepository(
  candidates: RepositoryCandidate[],
  selectedRepositoryId?: string,
): ResolvedRepository {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new ContributionError('PROVIDER_UNAVAILABLE', 'No governed repository binding is available');
  }
  const validated = candidates.map((candidate, index) => {
    if (
      !candidate
      || typeof candidate !== 'object'
      || !candidate.id
      || !candidate.provider
      || !SAFE_SEGMENT_RE.test(candidate.owner)
      || !SAFE_SEGMENT_RE.test(candidate.name)
      || !['origin', 'upstream', 'configured'].includes(candidate.role)
    ) {
      throw new ContributionError('INVALID_INPUT', `repositoryCandidates[${index}] is invalid`);
    }
    assertSha256(candidate.provenance?.evidenceDigest, `repositoryCandidates[${index}].provenance.evidenceDigest`);
    return {
      ...candidate,
      canonicalUrl: assertHttpsUrl(candidate.canonicalUrl, `repositoryCandidates[${index}].canonicalUrl`),
      apiEndpoint: assertHttpsUrl(candidate.apiEndpoint, `repositoryCandidates[${index}].apiEndpoint`),
    };
  });

  const duplicateIds = validated
    .map((candidate) => candidate.id)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new ContributionError('INVALID_INPUT', 'Repository candidate ids must be unique');
  }

  let selected: RepositoryCandidate | undefined;
  if (selectedRepositoryId) {
    selected = validated.find((candidate) => candidate.id === selectedRepositoryId);
    if (!selected) {
      throw new ContributionError('AMBIGUOUS_REPOSITORY', 'Selected repository is not a preflight candidate');
    }
  } else if (validated.length === 1) {
    [selected] = validated;
  } else {
    throw new ContributionError(
      'AMBIGUOUS_REPOSITORY',
      'Origin/upstream repository mapping is ambiguous and requires explicit selection',
      {
        candidates: validated.map(({ id, provider, role, owner, name, provenance }) => ({
          id,
          provider,
          role,
          owner,
          name,
          provenance,
        })),
      },
    );
  }

  return {
    ...selected,
    mappingFingerprint: fingerprint(selected),
  };
}

export class StaticContributionTransportRegistry implements ContributionTransportRegistry {
  private readonly transports = new Map<string, ContributionTransport>();

  constructor(transports: ContributionTransport[]) {
    for (const transport of transports) {
      if (this.transports.has(transport.provider)) {
        throw new ContributionError('INVALID_INPUT', `Duplicate contribution transport: ${transport.provider}`);
      }
      this.transports.set(transport.provider, transport);
    }
  }

  get(provider: string): ContributionTransport | undefined {
    return this.transports.get(provider);
  }
}
