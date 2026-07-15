import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import { canonicalDigest } from "../src/canonical.js";
import {
  dreamTimeSourceFingerprint,
  DreamTimeStore,
  runDreamTimeProposalWorker,
} from "../src/dreamtime.js";
import { SimulatedInterruptionError } from "../src/errors.js";
import type { DreamTimeWorkerInput, MemoryProposalCandidate, MemoryRevision } from "../src/types.js";
import { makeMemorySection } from "../src/validation.js";
import { allow, checkpointCandidate, emptySections, LATER, modelLock, NOW } from "./helpers.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function memoryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llmwiki-dreamtime-"));
  roots.push(root);
  return root;
}

function store(root: string, options: Partial<ConstructorParameters<typeof DreamTimeStore>[0]> = {}): DreamTimeStore {
  return new DreamTimeStore({
    memoryRoot: root,
    projectId: "project/demo",
    profileId: "agent/researcher",
    clock: () => NOW,
    ...options,
  });
}

function transition(proposal: { fingerprint: string }, token: string, expectedRevision = 0) {
  return {
    presentedFingerprint: proposal.fingerprint,
    expectedRevision,
    transitionToken: token,
    actor: "owner",
    authorize: allow,
  };
}

describe("Dream Time governed memory", () => {
  test("a stale scope lock left by a crashed process is recovered conservatively", async () => {
    const root = await memoryRoot();
    const lockDirectory = join(root, "demo", "researcher");
    const lockPath = join(lockDirectory, ".lock");
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(lockPath, JSON.stringify({ schemaVersion: 1, ownerId: "crashed-owner", pid: 123, acquiredAt: "2020-01-01T00:00:00.000Z" }), "utf8");
    await utimes(lockPath, new Date(0), new Date(0));
    const memory = store(root, { lockTimeoutMs: 100, lockRetryMs: 5, staleLockMs: 10 });
    const proposal = await memory.createProposal(checkpointCandidate({ proposalId: "memory-proposal/stale-lock" }), "owner");
    assert.equal(proposal.proposalId, "memory-proposal/stale-lock");
  });

  test("proposal is immutable candidate state until explicit approval commits a revision", async () => {
    const root = await memoryRoot();
    const memory = store(root);
    const exact = "  checkpoint with leading space\n\n";
    const proposal = await memory.createProposal(checkpointCandidate({
      candidateDiff: [{ operation: "replace", section: "recentContext", beforeHash: null, after: makeMemorySection(exact, ["thread/message-1"]) }],
    }), "owner");
    assert.equal((await memory.listRevisions()).length, 0);
    assert.equal((await memory.readProposal(proposal.proposalId))?.fingerprint, proposal.fingerprint);

    const result = await memory.approve(proposal.proposalId, transition(proposal, "approve-on-device-a"));
    assert.equal(result.status, "approved");
    assert.equal(result.idempotent, false);
    assert.equal(result.revision?.sections.recentContext.content, exact);
    assert.equal((await memory.listEvents()).length, 1);
    assert.equal((await memory.readDecision(proposal.proposalId))?.state, "approved");

    const replay = await memory.approve(proposal.proposalId, transition(proposal, "approve-on-device-a"));
    assert.equal(replay.status, "approved");
    assert.equal(replay.idempotent, true);
    assert.equal(replay.revision?.revisionId, result.revision?.revisionId);
    assert.equal((await memory.listEvents()).length, 1);

    const allFiles = await readAllFiles(root);
    assert.equal(allFiles.includes("approve-on-device-a"), false);
    assert.equal(allFiles.includes(canonicalDigest({ unrelated: true })), false);
  });

  test("concurrent creation cannot overwrite an immutable Proposal ID", async () => {
    const root = await memoryRoot();
    const deviceA = store(root);
    const deviceB = store(root);
    const proposalId = "memory-proposal/same-id" as const;
    const outcomes = await Promise.allSettled([
      deviceA.createProposal(checkpointCandidate({ proposalId }), "owner"),
      deviceB.createProposal(checkpointCandidate({
        proposalId,
        candidateDiff: [{ operation: "replace", section: "openItems", beforeHash: null, after: makeMemorySection("Different", ["thread/message-2"]) }],
      }), "owner"),
    ]);
    assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["fulfilled", "rejected"]);
    assert.equal((await deviceA.readProposal(proposalId))?.proposalId, proposalId);
  });

  test("rejection is terminal, idempotent, and never creates a memory revision", async () => {
    const root = await memoryRoot();
    const memory = store(root);
    const proposal = await memory.createProposal(checkpointCandidate(), "owner");
    const request = { ...transition(proposal, "reject-on-device-a"), reason: "Evidence is insufficient" };
    const first = await memory.reject(proposal.proposalId, request);
    const second = await memory.reject(proposal.proposalId, request);
    assert.equal(first.status, "rejected");
    assert.equal(first.revision, null);
    assert.equal(second.idempotent, true);
    assert.equal((await memory.listRevisions()).length, 0);
    assert.equal((await memory.listEvents()).length, 1);
  });

  test("two devices racing the same expected revision yield one commit and one stale decision", async () => {
    const root = await memoryRoot();
    const deviceA = store(root);
    const deviceB = store(root);
    const proposalA = await deviceA.createProposal(checkpointCandidate({ proposalId: "memory-proposal/device-a" }), "owner");
    const proposalB = await deviceB.createProposal(checkpointCandidate({
      proposalId: "memory-proposal/device-b",
      candidateDiff: [{ operation: "replace", section: "openItems", beforeHash: null, after: makeMemorySection("Device B", ["thread/message-2"]) }],
    }), "owner");

    const results = await Promise.all([
      deviceA.approve(proposalA.proposalId, transition(proposalA, "device-a-transition")),
      deviceB.approve(proposalB.proposalId, transition(proposalB, "device-b-transition")),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), ["approved", "stale"]);
    assert.equal((await deviceA.listRevisions()).length, 1);
    assert.equal((await deviceB.listEvents()).length, 2);
  });

  test("tampered fingerprint, expired proposal, and denied actor fail closed", async () => {
    const root = await memoryRoot();
    let now = NOW;
    const memory = store(root, { clock: () => now });
    const tampered = await memory.createProposal(checkpointCandidate({ proposalId: "memory-proposal/tampered" }), "owner");
    await assert.rejects(() => memory.approve(tampered.proposalId, {
      ...transition(tampered, "tampered-transition"),
      presentedFingerprint: canonicalDigest({ tampered: true }),
    }), /fingerprint/);
    assert.equal(await memory.readDecision(tampered.proposalId), null);
    const proposalPath = join(root, "demo", "researcher", "proposals", "tampered.json");
    const tamperedRecord = JSON.parse(await readFile(proposalPath, "utf8"));
    tamperedRecord.createdBy = "intruder";
    await writeFile(proposalPath, JSON.stringify(tamperedRecord), "utf8");
    await assert.rejects(() => memory.readProposal(tampered.proposalId), /fingerprint mismatch/);

    const denied = await memory.createProposal(checkpointCandidate({ proposalId: "memory-proposal/denied" }), "owner");
    await assert.rejects(() => memory.approve(denied.proposalId, {
      ...transition(denied, "denied-transition"),
      authorize: async () => ({ allowed: false, policyVersion: "test-policy/v1", reason: "Not an owner" }),
    }), /not authorized/);
    assert.equal(await memory.readDecision(denied.proposalId), null);

    const expired = await memory.createProposal(checkpointCandidate({ proposalId: "memory-proposal/expired" }), "owner");
    now = "2026-07-17T00:00:00.000Z";
    const expiredResult = await memory.approve(expired.proposalId, transition(expired, "expired-transition"));
    assert.equal(expiredResult.status, "expired");
    assert.equal(expiredResult.revision, null);
  });

  test("protected directives survive and block mutation of locked sections", async () => {
    const root = await memoryRoot();
    const memory = store(root);
    const stable = makeMemorySection("Protected fact", ["artifact/evidence-1"]);
    const firstProposal = await memory.createProposal(checkpointCandidate({
      proposalId: "memory-proposal/protected-seed",
      operation: "learn",
      candidateDiff: [{ operation: "replace", section: "stableMemory", beforeHash: null, after: stable }],
      protectedDirectives: [{
        directiveId: "directive/protect-fact",
        kind: "protected",
        section: "stableMemory",
        contentHash: stable.contentHash,
        reason: "Owner-protected durable fact",
      }],
    }), "owner");
    const first = await memory.approve(firstProposal.proposalId, transition(firstProposal, "protect-seed"));
    const revision = first.revision!;

    const replacement = makeMemorySection("Changed fact", ["artifact/evidence-2"]);
    const secondProposal = await memory.createProposal(checkpointCandidate({
      proposalId: "memory-proposal/protected-change",
      operation: "review",
      sourceIdentities: {
        revisionIds: [revision.revisionId],
        artifactIds: ["artifact/evidence-2"],
        cutoffAt: NOW,
      },
      expectedRevision: expected(revision),
      candidateDiff: [{ operation: "replace", section: "stableMemory", beforeHash: stable.contentHash, after: replacement }],
      protectedDirectives: revision.protectedDirectives,
      unresolvedConflicts: revision.unresolvedConflicts,
    }), "owner");
    await assert.rejects(() => memory.approve(secondProposal.proposalId, transition(secondProposal, "protected-change", 1)), /protected memory section/);
    assert.equal((await memory.readCurrentRevision())?.sections.stableMemory.content, "Protected fact");
  });

  test("unresolved conflicts are retained and block mutation of their section", async () => {
    const root = await memoryRoot();
    const memory = store(root);
    const initial = makeMemorySection("Conflicting context", ["thread/message-a"]);
    const conflict = {
      conflictId: "conflict/context-a-b",
      section: "recentContext" as const,
      reason: "Two sources disagree",
      sourceRefs: ["thread/message-a", "thread/message-b"],
      resolved: false as const,
    };
    const seed = await memory.createProposal(checkpointCandidate({
      proposalId: "memory-proposal/conflict-seed",
      candidateDiff: [{ operation: "replace", section: "recentContext", beforeHash: null, after: initial }],
      unresolvedConflicts: [conflict],
    }), "owner");
    const seeded = await memory.approve(seed.proposalId, transition(seed, "conflict-seed"));
    const revision = seeded.revision!;
    const attempted = await memory.createProposal(checkpointCandidate({
      proposalId: "memory-proposal/conflict-change",
      sourceIdentities: { revisionIds: [revision.revisionId], artifactIds: [], cutoffAt: NOW },
      expectedRevision: expected(revision),
      candidateDiff: [{ operation: "replace", section: "recentContext", beforeHash: initial.contentHash, after: makeMemorySection("Winner", ["thread/message-a"]) }],
      unresolvedConflicts: [conflict],
    }), "owner");
    await assert.rejects(() => memory.approve(attempted.proposalId, transition(attempted, "conflict-change", 1)), /unresolved conflict/);
    assert.equal((await memory.readCurrentRevision())?.sections.recentContext.content, "Conflicting context");
  });

  test("approval recovers idempotently after interruption just after immutable revision write", async () => {
    const root = await memoryRoot();
    let failOnce = true;
    const memory = store(root, {
      faultInjector: (point) => {
        if (failOnce) {
          failOnce = false;
          throw new SimulatedInterruptionError(point);
        }
      },
    });
    const proposal = await memory.createProposal(checkpointCandidate({ proposalId: "memory-proposal/recover" }), "owner");
    await assert.rejects(() => memory.approve(proposal.proposalId, transition(proposal, "recovery-token")), SimulatedInterruptionError);
    assert.equal((await memory.listRevisions()).length, 1);
    assert.equal((await memory.listEvents()).length, 0);
    assert.equal(await memory.readDecision(proposal.proposalId), null);

    const recovered = await memory.approve(proposal.proposalId, transition(proposal, "recovery-token"));
    assert.equal(recovered.status, "approved");
    assert.equal(recovered.idempotent, true);
    assert.equal((await memory.listRevisions()).length, 1);
    assert.equal((await memory.listEvents()).length, 1);
    assert.equal((await memory.readDecision(proposal.proposalId))?.revisionId, recovered.revision?.revisionId);
  });

  test("terminal transition recovers from an event-only interrupted commit", async () => {
    const root = await memoryRoot();
    let failOnce = true;
    const memory = store(root, {
      faultInjector: (point) => {
        if (point === "after-event-write" && failOnce) {
          failOnce = false;
          throw new SimulatedInterruptionError(point);
        }
      },
    });
    const proposal = await memory.createProposal(checkpointCandidate({ proposalId: "memory-proposal/recover-event" }), "owner");
    const request = { ...transition(proposal, "event-recovery-token"), reason: "Reject with recovery" };
    await assert.rejects(() => memory.reject(proposal.proposalId, request), SimulatedInterruptionError);
    assert.equal((await memory.listEvents()).length, 1);
    assert.equal(await memory.readDecision(proposal.proposalId), null);
    const recovered = await memory.reject(proposal.proposalId, request);
    assert.equal(recovered.status, "rejected");
    assert.equal(recovered.idempotent, true);
    assert.equal((await memory.listEvents()).length, 1);
    assert.equal((await memory.readDecision(proposal.proposalId))?.state, "rejected");
  });

  test("proposal worker receives a frozen capability-free input and cannot rewrite source locks", async () => {
    const root = await memoryRoot();
    const memory = store(root);
    const input: DreamTimeWorkerInput = {
      operation: "checkpoint",
      projectId: "project/demo",
      profileId: "agent/researcher",
      sourceIdentities: { threadId: "thread/fixture", revisionIds: [], artifactIds: [], cutoffAt: NOW },
      expectedRevision: { revisionId: null, revision: 0, fingerprint: null },
      sourceFingerprint: canonicalDigest({ placeholder: true }),
      currentSections: emptySections(),
      protectedDirectives: [],
      unresolvedConflicts: [],
      modelLock,
      expiresAt: LATER,
    };
    input.sourceFingerprint = dreamTimeSourceFingerprint(input);
    const proposal = await runDreamTimeProposalWorker(memory, {
      async generate(locked) {
        assert.equal(Object.isFrozen(locked), true);
        assert.equal(Object.isFrozen(locked.currentSections), true);
        assert.equal("store" in locked, false);
        return workerCandidate(locked);
      },
    }, input, "owner");
    assert.equal(proposal.sourceFingerprint, input.sourceFingerprint);

    const secondInput: DreamTimeWorkerInput = {
      ...input,
      sourceIdentities: { ...input.sourceIdentities, threadId: "thread/other" },
      sourceFingerprint: canonicalDigest({ placeholder: "second" }),
    };
    secondInput.sourceFingerprint = dreamTimeSourceFingerprint(secondInput);
    await assert.rejects(() => runDreamTimeProposalWorker(memory, {
      async generate(locked) {
        return {
          ...workerCandidate(locked),
          expectedRevision: { revisionId: null, revision: 7, fingerprint: null },
        };
      },
    }, secondInput, "owner"), /changed locked field expectedRevision/);
  });

  test("candidate beforeHash is checked again at approval", async () => {
    const root = await memoryRoot();
    const memory = store(root);
    const proposal = await memory.createProposal(checkpointCandidate({
      proposalId: "memory-proposal/bad-before",
      candidateDiff: [{
        operation: "replace",
        section: "recentContext",
        beforeHash: canonicalDigest({ not: "the base" }),
        after: makeMemorySection("candidate", ["thread/message-1"]),
      }],
    }), "owner");
    await assert.rejects(() => memory.approve(proposal.proposalId, transition(proposal, "bad-before")), /beforeHash/);
    assert.equal((await memory.listRevisions()).length, 0);
  });
});

function expected(revision: MemoryRevision) {
  return {
    revisionId: revision.revisionId,
    revision: revision.revision,
    fingerprint: revision.fingerprint,
  };
}

function workerCandidate(input: Readonly<DreamTimeWorkerInput>): MemoryProposalCandidate {
  return {
    operation: input.operation,
    projectId: input.projectId,
    profileId: input.profileId,
    sourceIdentities: input.sourceIdentities,
    expectedRevision: input.expectedRevision,
    sourceFingerprint: input.sourceFingerprint,
    candidateDiff: [{ operation: "replace", section: "recentContext", beforeHash: null, after: makeMemorySection("Worker candidate", ["thread/message-1"]) }],
    protectedDirectives: input.protectedDirectives,
    unresolvedConflicts: input.unresolvedConflicts,
    provenance: [{ kind: "thread", id: "thread/fixture", revision: 1 }],
    warnings: [],
    modelLock: input.modelLock,
    expiresAt: input.expiresAt,
  };
}

async function readAllFiles(root: string): Promise<string> {
  const chunks: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else chunks.push(await readFile(path, "utf8"));
    }
  }
  await walk(root);
  return chunks.join("\n");
}
