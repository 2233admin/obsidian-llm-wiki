import { randomUUID } from "node:crypto";
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from "./errors.js";
import { assertSafeSharedState } from "./security.js";
import type {
  AgentProfile,
  AgentProfileCreate,
  AgentProfileId,
  AgentProfilePatch,
  EphemeralThread,
  ProjectAgentBinding,
  ProjectAgentBindingCreate,
  ProjectAgentBindingId,
  ProjectAgentBindingPatch,
  StoreMutationResult,
  Thread,
  ThreadCreate,
  ThreadId,
  ThreadLifecycle,
  ThreadReferenceCreate,
} from "./types.js";
import { AgentProfileStore, type PersistenceOptions, ProjectAgentBindingStore, ThreadStore } from "./persistence.js";
import { bindingIdFor, parseAgentProfileId, parseProjectId, parseThreadId } from "./validation.js";

export interface AgentDomainServiceOptions extends PersistenceOptions {}

export class AgentDomainService {
  readonly profiles: AgentProfileStore;
  readonly bindings: ProjectAgentBindingStore;
  readonly threads: ThreadStore;

  constructor(options: AgentDomainServiceOptions) {
    this.profiles = new AgentProfileStore(options);
    this.bindings = new ProjectAgentBindingStore(options);
    this.threads = new ThreadStore(options);
  }

  createProfile(input: AgentProfileCreate): Promise<StoreMutationResult<AgentProfile>> {
    return this.profiles.create(input);
  }

  updateProfile(profileId: AgentProfileId, expectedRevision: number, patch: AgentProfilePatch, actor: string): Promise<StoreMutationResult<AgentProfile>> {
    return this.profiles.update(profileId, expectedRevision, patch, actor);
  }

  async createBinding(input: ProjectAgentBindingCreate): Promise<StoreMutationResult<ProjectAgentBinding>> {
    parseProjectId(input.projectId);
    const profile = await this.profiles.readRevision(parseAgentProfileId(input.profileId), input.profileRevision);
    if (!profile) throw new DomainNotFoundError(`Agent Profile ${input.profileId} revision ${input.profileRevision} does not exist`);
    return this.bindings.create(input);
  }

  async updateBinding(
    bindingId: ProjectAgentBindingId,
    expectedRevision: number,
    patch: ProjectAgentBindingPatch,
    actor: string,
  ): Promise<StoreMutationResult<ProjectAgentBinding>> {
    const current = await this.bindings.read(bindingId);
    if (!current) throw new DomainNotFoundError(`Project Agent Binding ${bindingId} does not exist`);
    if (patch.profileRevision !== undefined) {
      const profile = await this.profiles.readRevision(current.profileId, patch.profileRevision);
      if (!profile) throw new DomainNotFoundError(`Agent Profile ${current.profileId} revision ${patch.profileRevision} does not exist`);
    }
    return this.bindings.update(bindingId, expectedRevision, patch, actor);
  }

  async createThread(input: ThreadCreate): Promise<StoreMutationResult<Thread>> {
    const projectId = parseProjectId(input.projectId);
    const profileId = parseAgentProfileId(input.profileId);
    const expectedBindingId = bindingIdFor(projectId, profileId);
    if (input.bindingId !== expectedBindingId) throw new DomainValidationError("Thread binding ID does not match its Project and Profile");
    const binding = await this.bindings.read(input.bindingId);
    if (!binding) throw new DomainNotFoundError(`Project Agent Binding ${input.bindingId} revision ${input.bindingRevision} does not exist`);
    if (binding.revision !== input.bindingRevision) throw new DomainConflictError("Thread must lock the latest Binding revision", {
      requestedBindingRevision: input.bindingRevision,
      currentBindingRevision: binding.revision,
    });
    if (!binding.enabled) throw new DomainConflictError("Disabled Project Agent Binding cannot open a durable Thread", { bindingId: binding.bindingId });
    if (binding.profileRevision !== input.profileRevision) throw new DomainConflictError("Thread Profile revision does not match locked Binding Profile revision", {
      bindingProfileRevision: binding.profileRevision,
      threadProfileRevision: input.profileRevision,
    });
    const profile = await this.profiles.readRevision(profileId, input.profileRevision);
    if (!profile) throw new DomainNotFoundError(`Agent Profile ${profileId} revision ${input.profileRevision} does not exist`);
    return this.threads.create(input);
  }

  appendThreadReference(threadId: ThreadId, expectedRevision: number, reference: ThreadReferenceCreate, actor: string): Promise<StoreMutationResult<Thread>> {
    return this.threads.appendReference(threadId, expectedRevision, reference, actor);
  }

  transitionThread(threadId: ThreadId, expectedRevision: number, lifecycle: ThreadLifecycle, actor: string): Promise<StoreMutationResult<Thread>> {
    return this.threads.transition(threadId, expectedRevision, lifecycle, actor);
  }

  createEphemeralThread(input: {
    threadId?: ThreadId;
    profileId: AgentProfileId;
    profileRevision: number;
    title: string;
  }): EphemeralThread {
    assertSafeSharedState(input, "EphemeralThread");
    if (!Number.isInteger(input.profileRevision) || input.profileRevision < 1) throw new DomainValidationError("profileRevision must be positive");
    return {
      schemaVersion: 1,
      threadId: input.threadId ? parseThreadId(input.threadId) : `thread/ephemeral-${randomUUID()}`,
      durability: "ephemeral",
      lifecycle: "open",
      profileId: parseAgentProfileId(input.profileId),
      profileRevision: input.profileRevision,
      title: input.title,
      references: [],
    };
  }
}
