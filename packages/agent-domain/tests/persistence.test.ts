import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import { canonicalDigest } from "../src/canonical.js";
import { AgentDomainService } from "../src/service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function service(): Promise<{ root: string; domain: AgentDomainService }> {
  const root = await mkdtemp(join(tmpdir(), "llmwiki-agent-domain-"));
  roots.push(root);
  return {
    root,
    domain: new AgentDomainService({ stateRoot: root, clock: () => "2026-07-15T00:00:00.000Z" }),
  };
}

async function seed(domain: AgentDomainService): Promise<void> {
  const created = await domain.createProfile({
    profileId: "agent/researcher",
    displayName: "Researcher",
    role: "Research",
    responsibilities: ["Gather evidence"],
    capabilityClaims: ["source-synthesis"],
    constitution: { principles: ["Cite sources"], instructions: ["Preserve provenance"] },
    defaultModelPolicy: { mode: "local", provider: "local", model: "fixture" },
    actor: "owner",
  });
  assert.equal(created.status, "committed");
  const bound = await domain.createBinding({
    projectId: "project/demo",
    projectContextFingerprint: canonicalDigest({ project: "demo" }),
    profileId: "agent/researcher",
    profileRevision: 1,
    role: "Project researcher",
    connectorGrantRefs: ["grant/repo-read"],
    actor: "owner",
  });
  assert.equal(bound.status, "committed");
}

describe("copy-on-write Agent Domain stores", () => {
  test("a conservatively stale owner lock is quarantined after a crashed writer", async () => {
    const root = await mkdtemp(join(tmpdir(), "llmwiki-agent-domain-stale-lock-"));
    roots.push(root);
    const lockPath = join(root, "profiles", "stale-lock", ".lock");
    await mkdir(join(root, "profiles", "stale-lock"), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ schemaVersion: 1, ownerId: "crashed-owner", pid: 123, acquiredAt: "2020-01-01T00:00:00.000Z" }), "utf8");
    await utimes(lockPath, new Date(0), new Date(0));
    const domain = new AgentDomainService({
      stateRoot: root,
      clock: () => "2026-07-15T00:00:00.000Z",
      lockTimeoutMs: 100,
      lockRetryMs: 5,
      staleLockMs: 10,
    });
    const result = await domain.createProfile({
      profileId: "agent/stale-lock",
      displayName: "Recovered writer",
      role: "Recovery",
      constitution: { principles: ["Recover conservatively"], instructions: ["Preserve owner metadata"] },
      actor: "owner",
    });
    assert.equal(result.status, "committed");
  });

  test("Profile mutations are immutable, revision-checked, and stable-ID", async () => {
    const { root, domain } = await service();
    await seed(domain);
    const updated = await domain.updateProfile("agent/researcher", 1, { role: "Lead research" }, "owner");
    assert.equal(updated.status, "committed");
    assert.equal(updated.record.revision, 2);
    assert.equal(updated.record.profileId, "agent/researcher");

    const stale = await domain.updateProfile("agent/researcher", 1, { role: "Stale writer" }, "other-device");
    assert.equal(stale.status, "conflict");
    assert.equal(stale.actualRevision, 2);

    const first = await domain.profiles.readRevision("agent/researcher", 1);
    assert.equal(first?.role, "Research");
    const revisionFiles = await readdir(join(root, "profiles", "researcher", "revisions"));
    assert.deepEqual(revisionFiles.sort(), ["000000000001.json", "000000000002.json"]);
    const persisted = await readFile(join(root, "profiles", "researcher", "revisions", "000000000001.json"), "utf8");
    assert.match(persisted, /\"role\":\"Research\"/);
    const tampered = JSON.parse(persisted);
    tampered.role = "Tampered after commit";
    await writeFile(join(root, "profiles", "researcher", "revisions", "000000000001.json"), JSON.stringify(tampered), "utf8");
    await assert.rejects(
      () => domain.profiles.read("agent/researcher"),
      (error: unknown) => {
        assert.match((error as Error).message, /predecessor lock mismatch/);
        assert.doesNotMatch(JSON.stringify(error), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      },
    );
  });

  test("shared records reject secrets and machine paths before persistence", async () => {
    const { root, domain } = await service();
    await assert.rejects(() => domain.createProfile({
      profileId: "agent/unsafe",
      displayName: "Unsafe",
      role: "C:\\Users\\alice\\vault",
      constitution: { principles: ["test"], instructions: ["test"] },
      defaultModelPolicy: { mode: "cloud", provider: "x", model: "y" },
      actor: "owner",
    }), /absolute paths/);
    await assert.rejects(() => domain.createProfile({
      profileId: "agent/unsafe",
      displayName: "Unsafe",
      role: "Research",
      constitution: { principles: ["test"], instructions: ["Bearer abcdefghijklmnopqrstuvwxyz"] },
      actor: "owner",
    }), /Secret material/);
    await assert.rejects(() => readdir(join(root, "profiles", "unsafe")), /ENOENT/);
  });

  test("Binding locks an existing Profile revision and disabled latest revisions cannot be bypassed", async () => {
    const { domain } = await service();
    await seed(domain);
    await assert.rejects(() => domain.createBinding({
      projectId: "project/missing",
      projectContextFingerprint: canonicalDigest({ project: "missing" }),
      profileId: "agent/researcher",
      profileRevision: 99,
      role: "Invalid",
      actor: "owner",
    }), /does not exist/);

    const thread = await domain.createThread({
      threadId: "thread/first",
      projectId: "project/demo",
      bindingId: "binding/demo/researcher",
      bindingRevision: 1,
      profileId: "agent/researcher",
      profileRevision: 1,
      title: "First thread",
      actor: "owner",
    });
    assert.equal(thread.status, "committed");

    const disabled = await domain.updateBinding("binding/demo/researcher", 1, { enabled: false }, "owner");
    assert.equal(disabled.status, "committed");
    await assert.rejects(() => domain.createThread({
      threadId: "thread/old-binding-bypass",
      projectId: "project/demo",
      bindingId: "binding/demo/researcher",
      bindingRevision: 1,
      profileId: "agent/researcher",
      profileRevision: 1,
      title: "Must fail",
      actor: "owner",
    }), /latest Binding revision/);
    await assert.rejects(() => domain.createThread({
      threadId: "thread/disabled",
      projectId: "project/demo",
      bindingId: "binding/demo/researcher",
      bindingRevision: 2,
      profileId: "agent/researcher",
      profileRevision: 1,
      title: "Must fail",
      actor: "owner",
    }), /Disabled/);
  });

  test("durable Threads store ordered references, not message bodies, and enforce lifecycle", async () => {
    const { domain } = await service();
    await seed(domain);
    const created = await domain.createThread({
      threadId: "thread/project-room",
      projectId: "project/demo",
      bindingId: "binding/demo/researcher",
      bindingRevision: 1,
      profileId: "agent/researcher",
      profileRevision: 1,
      title: "Project room",
      actor: "owner",
    });
    assert.equal(created.status, "committed");
    const appended = await domain.appendThreadReference("thread/project-room", 1, {
      kind: "artifact",
      referenceId: "artifact/report-1",
      contentHash: canonicalDigest({ artifact: "report-1" }),
      citations: ["source/report-1"],
    }, "owner");
    assert.equal(appended.status, "committed");
    assert.deepEqual(Object.keys(appended.record.references[0]!).sort(), ["citations", "contentHash", "kind", "ordinal", "recordedAt", "referenceId"]);
    assert.equal(appended.record.references[0]!.ordinal, 1);

    const closed = await domain.transitionThread("thread/project-room", 2, "closed", "owner");
    assert.equal(closed.status, "committed");
    await assert.rejects(() => domain.appendThreadReference("thread/project-room", 3, {
      kind: "message",
      referenceId: "message/2",
    }, "owner"), /Only an open Thread/);
    await assert.rejects(() => domain.transitionThread("thread/project-room", 3, "closed", "owner"), /Invalid Thread lifecycle/);
  });

  test("ephemeral Threads remain in memory and receive no Project binding", async () => {
    const { domain } = await service();
    const thread = domain.createEphemeralThread({
      profileId: "agent/researcher",
      profileRevision: 1,
      title: "Scratchpad",
    });
    assert.equal(thread.durability, "ephemeral");
    assert.equal("projectId" in thread, false);
    assert.equal("bindingId" in thread, false);
  });
});
